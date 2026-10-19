//! Running many requests at once (INTERFACE.md §6.4).
//!
//! A lane is one llama.cpp context with its own thread. It belongs to one
//! Pigeon while it has work, and that Pigeon's requests run in it together:
//! every step, one decode carries each of them a token (or its whole prompt),
//! so the weights are read once for all of them. Different Pigeons run in
//! different lanes at the same time, up to `parallel` lanes per base. A lane
//! never switches adapters while its own Pigeon has work, because each switch
//! makes llama.cpp re-plan its graph (measured: 849 switches cost 12 s of a
//! 39 s run).
//!
//! A request that arrives when every lane is busy with other Pigeons does not
//! wait for any of their answers to finish: it joins the least busy lane that
//! has room, as a guest, and that lane takes turns between its Pigeon and the
//! guest, one decode each per step. Only when every lane is full — `parallel`
//! lanes of `SEQS` requests each, or no cells left — does a request queue, and
//! then it starts in the first place that frees up.

use std::collections::VecDeque;
use std::sync::atomic::Ordering;
use std::sync::{Arc, Condvar, Mutex};

use serde_json::{json, Value};

use crate::decode::Decoder;
use crate::llama::{Batch, Context, ContextParams, Part};
use crate::pigeons::{Base, Loaded};
use crate::prefix::{self, Store};
use crate::prep::Job;

/// How long a lane woken from idle waits for the rest of a group of asks.
const GATHER_MS: u64 = 2;

/// Requests one lane runs together.
pub const SEQS: usize = 4;

struct Lane {
    base: Arc<Base>,
    /// The Pigeon this lane belongs to while it has work (its address,
    /// only ever compared).
    owner: Option<usize>,
    /// Requests given to it and not yet finished.
    seqs: usize,
    /// Cells promised to them.
    reserved: usize,
    inbox: Vec<Job>,
    retire: bool,
    /// Requests it is running now, for `info`.
    running: usize,
    /// What its context costs: llama.cpp's own figure once it is made, an
    /// estimate until then.
    bytes: u64,
    /// E26: cells its kept prompts hold, as its thread last said.
    kept_cells: usize,
    /// E26: the Pigeons whose prompts it keeps (their keys), as its thread
    /// last said; and the Pigeon whose adapter its context has set now. An
    /// idle lane that holds a Pigeon's prompt is the one its next ask should
    /// take: elsewhere the prompt is read whole again and the adapter switch
    /// re-plans the graph (14 ms).
    kept_for: Vec<usize>,
    last_owner: Option<usize>,
    /// E26: a request needs the room; the thread forgets every kept prompt
    /// before it starts anything else.
    drop_kept: bool,
}

#[derive(Default)]
struct State {
    lanes: Vec<(u64, Lane)>,
    waiting: VecDeque<Job>,
    next: u64,
}

pub struct Scheduler {
    state: Mutex<State>,
    /// Every lane's thread: `stop_all` joins them, so a lane's last hold on
    /// its base is gone before it returns.
    threads: Mutex<Vec<std::thread::JoinHandle<()>>>,
    wake: Condvar,
    parallel: usize,
    cells: u32,
    always_scan: bool,
    /// E26: cells each lane may keep Pigeons' prompts in; 0 is off.
    prefix_cells: usize,
    /// `memory_limit_bytes`, judged against weights the engine holds (set by
    /// the engine) plus every context's real allocation.
    limit: Option<u64>,
    weights: std::sync::atomic::AtomicU64,
    /// The largest context allocation seen, for estimating the next.
    largest: std::sync::atomic::AtomicU64,
}

impl Scheduler {
    pub fn new(parallel: usize, cells: u32, always_scan: bool, limit: Option<u64>, prefix_cells: usize) -> Arc<Scheduler> {
        Arc::new(Scheduler {
            state: Mutex::new(State::default()),
            threads: Mutex::new(Vec::new()),
            wake: Condvar::new(),
            parallel,
            cells,
            always_scan,
            prefix_cells,
            limit,
            weights: Default::default(),
            largest: Default::default(),
        })
    }

    /// The weights the engine holds now: bases, projectors, embedding models.
    pub fn set_weights(&self, bytes: u64) {
        self.weights.store(bytes, Ordering::Relaxed);
    }

    /// What one more context on `base` will cost, before it is made: the
    /// largest one made so far, or its cache plus llama.cpp's usual working
    /// buffers (329 MiB measured on Qwen3-VL 2B).
    pub fn next_context(&self, base: &Base) -> u64 {
        match self.largest.load(Ordering::Relaxed) {
            0 => base.kv_bytes_per_cell * self.cells as u64 + (329 << 20),
            n => n,
        }
    }

    /// The same, for a base not loaded yet: the largest context made so far,
    /// or Qwen3-VL 2B's measured cost (112 KiB a cell, 329 MiB of buffers).
    pub fn next_context_unknown(&self) -> u64 {
        match self.largest.load(Ordering::Relaxed) {
            0 => self.cells as u64 * (112 << 10) + (329 << 20),
            n => n,
        }
    }

    /// Waits a little for idle contexts of unloaded bases to go, so the
    /// memory they free is counted as free.
    pub fn wait_retired(&self, wait: std::time::Duration) {
        let t = std::time::Instant::now();
        while t.elapsed() < wait && self.state.lock().map_or(false, |st| st.lanes.iter().any(|(_, l)| l.retire && l.seqs == 0)) {
            self.wake.notify_all();
            std::thread::sleep(std::time::Duration::from_millis(5));
        }
    }

    /// Bytes every context holds now.
    pub fn contexts_bytes(&self) -> u64 {
        self.state.lock().map(|st| st.lanes.iter().map(|(_, l)| l.bytes).sum()).unwrap_or(0)
    }

    /// Whether `more` bytes still fit under the limit.
    pub fn fits(&self, more: u64) -> bool {
        self.limit.map_or(true, |limit| self.weights.load(Ordering::Relaxed) + self.contexts_bytes() + more <= limit)
    }

    pub fn submit(self: &Arc<Self>, job: Job) {
        let Ok(mut st) = self.state.lock() else { return job.out.error("model_failed", "the scheduler stopped") };
        st.waiting.push_back(job);
        self.place_waiting(&mut st);
        self.wake.notify_all();
    }

    /// Places as many waiting requests as fit, oldest first.
    fn place_waiting(self: &Arc<Self>, st: &mut State) {
        let mut still = VecDeque::new();
        while let Some(job) = st.waiting.pop_front() {
            if job.cancel.load(Ordering::Relaxed) {
                finish_unstarted(&job);
                continue;
            }
            if let Err(job) = self.place(st, job) {
                still.push_back(job);
            }
        }
        st.waiting = still;
    }

    fn place(self: &Arc<Self>, st: &mut State, job: Job) -> Result<(), Job> {
        let base = Arc::as_ptr(&job.pigeon.base);
        let mine = key(&job.pigeon);
        let need = job.need();
        let cells = self.cells as usize;
        let on_base = |l: &Lane| Arc::as_ptr(&l.base) == base && !l.retire;
        let room = |l: &Lane| l.seqs < SEQS && l.reserved + l.kept_cells + need <= cells;
        // 1. A lane already running this Pigeon, with room.
        // 2. An idle lane on this base: the one keeping this Pigeon's prompt
        //    first (E26: the prompt is shared there and nowhere else), then
        //    the one whose adapter is already this Pigeon's, then any.
        // 3. A new lane, while there are fewer than `parallel`.
        // 4. As a guest in the least busy lane with room.
        let idle_rank = |l: &Lane| match (l.kept_for.contains(&mine), l.last_owner == Some(mine)) {
            (true, _) => 0,
            (false, true) => 1,
            (false, false) => 2,
        };
        let pick = st
            .lanes
            .iter()
            .enumerate()
            .filter(|(_, (_, l))| on_base(l) && l.owner == Some(mine) && room(l))
            .min_by_key(|(_, (_, l))| l.seqs)
            .or_else(|| st.lanes.iter().enumerate().filter(|(_, (_, l))| on_base(l) && l.seqs == 0).min_by_key(|(_, (_, l))| idle_rank(l)))
            .map(|(i, _)| i);
        let i = match pick {
            Some(i) => i,
            None if st.lanes.iter().filter(|(_, l)| on_base(l)).count() < self.parallel && self.fits_locked(st, self.next_context(&job.pigeon.base)) => self.start_lane(st, &job.pigeon.base),
            None => match st.lanes.iter().enumerate().filter(|(_, (_, l))| on_base(l) && room(l)).min_by_key(|(_, (_, l))| l.seqs) {
                Some((i, _)) => i,
                // E26: a lane whose kept prompts are all that stand in the
                // way gives them up rather than make this request wait.
                None => match st.lanes.iter().position(|(_, l)| on_base(l) && l.kept_cells > 0 && l.seqs < SEQS && l.reserved + need <= cells) {
                    Some(i) => {
                        let l = &mut st.lanes[i].1;
                        l.drop_kept = true;
                        l.kept_cells = 0;
                        l.kept_for.clear();
                        i
                    }
                    None => return Err(job),
                },
            },
        };
        let lane = &mut st.lanes[i].1;
        if lane.seqs == 0 {
            lane.owner = Some(mine);
        }
        lane.seqs += 1;
        lane.reserved += need;
        lane.inbox.push(job);
        Ok(())
    }

    fn fits_locked(&self, st: &State, more: u64) -> bool {
        self.limit.map_or(true, |limit| self.weights.load(Ordering::Relaxed) + st.lanes.iter().map(|(_, l)| l.bytes).sum::<u64>() + more <= limit)
    }

    /// A new lane on `base`, its thread started; its index in `st.lanes`.
    fn start_lane(self: &Arc<Self>, st: &mut State, base: &Arc<Base>) -> usize {
        st.next += 1;
        let id = st.next;
        let bytes = self.next_context(base);
        st.lanes.push((id, Lane { base: base.clone(), owner: None, seqs: 0, reserved: 0, inbox: Vec::new(), retire: false, running: 0, bytes, kept_cells: 0, kept_for: Vec::new(), last_owner: None, drop_kept: false }));
        let me = self.clone();
        let base = base.clone();
        if let Ok(t) = std::thread::Builder::new().name(format!("pigeon-lane-{id}")).spawn(move || {
            // E23: a panic in a lane ends what it was running (each
            // request's way out says so as it unwinds); the lane goes,
            // what was waiting for it fails, and the next ask makes a
            // new one.
            let keep = me.clone();
            if std::panic::catch_unwind(std::panic::AssertUnwindSafe(move || me.run_lane(id, base))).is_err() {
                keep.lane_failed(id);
            }
        }) {
            if let Ok(mut all) = self.threads.lock() {
                all.retain(|t| !t.is_finished());
                all.push(t);
            }
        }
        st.lanes.len() - 1
    }

    /// A lane ready on `base` before anything is asked of it: the context
    /// (its cache and buffers) is made now, on the lane's thread, so the
    /// first ask does not wait for it. Nothing when one is there already.
    pub fn warm(self: &Arc<Self>, base: &Arc<Base>) {
        let Ok(mut st) = self.state.lock() else { return };
        if st.lanes.iter().any(|(_, l)| Arc::ptr_eq(&l.base, base) && !l.retire) {
            return;
        }
        if self.fits_locked(&st, self.next_context(base)) {
            self.start_lane(&mut st, base);
        }
    }

    /// A cancelled request still waiting ends now.
    pub fn cancel(self: &Arc<Self>) {
        if let Ok(mut st) = self.state.lock() {
            self.place_waiting(&mut st);
        }
        self.wake.notify_all();
    }

    /// Every lane stops once idle; returns when they all have, or after `wait`.
    pub fn stop_all(self: &Arc<Self>, wait: std::time::Duration) -> bool {
        if let Ok(mut st) = self.state.lock() {
            for (_, l) in st.lanes.iter_mut() {
                l.retire = true;
            }
            self.place_waiting(&mut st);
        }
        self.wake.notify_all();
        let t = std::time::Instant::now();
        loop {
            if self.state.lock().map_or(true, |st| st.lanes.is_empty() && st.waiting.is_empty()) {
                let threads: Vec<_> = self.threads.lock().map(|mut t| t.drain(..).collect()).unwrap_or_default();
                for t in threads {
                    let _ = t.join();
                }
                return true;
            }
            if t.elapsed() > wait {
                return false;
            }
            self.wake.notify_all();
            std::thread::sleep(std::time::Duration::from_millis(5));
        }
    }

    /// A lane whose thread panicked: taken off the list, its waiting work
    /// failed, and anything waiting for room placed again.
    fn lane_failed(self: &Arc<Self>, id: u64) {
        let mut st = self.state.lock().unwrap_or_else(|p| p.into_inner());
        if let Some(at) = st.lanes.iter().position(|(i, _)| *i == id) {
            let (_, lane) = st.lanes.remove(at);
            for job in lane.inbox {
                job.out.error("internal", "the engine failed inside before this request started (a bug in the engine); ask again");
            }
        }
        self.place_waiting(&mut st);
        drop(st);
        self.wake.notify_all();
    }

    /// Whether anything asked of this base is waiting or running.
    pub fn busy(&self, base: &Arc<Base>) -> bool {
        let Ok(st) = self.state.lock() else { return true };
        st.waiting.iter().any(|j| Arc::ptr_eq(&j.pigeon.base, base))
            || st.lanes.iter().any(|(_, l)| Arc::ptr_eq(&l.base, base) && (l.seqs > 0 || !l.inbox.is_empty()))
    }

    /// The lanes on this base stop once they are idle.
    pub fn retire(&self, base: &Arc<Base>) {
        if let Ok(mut st) = self.state.lock() {
            for (_, l) in st.lanes.iter_mut().filter(|(_, l)| Arc::ptr_eq(&l.base, base)) {
                l.retire = true;
            }
        }
        self.wake.notify_all();
    }

    /// (requests waiting, requests running, (base file, contexts, their bytes,
    /// cells of kept prompts) per base)
    pub fn counts(&self) -> (usize, usize, Vec<(String, usize, u64, usize)>) {
        let Ok(st) = self.state.lock() else { return (0, 0, Vec::new()) };
        let mut per: Vec<(String, usize, u64, usize)> = Vec::new();
        for (_, l) in &st.lanes {
            match per.iter_mut().find(|(f, _, _, _)| *f == l.base.file) {
                Some(x) => {
                    x.1 += 1;
                    x.2 += l.bytes;
                    x.3 += l.kept_cells;
                }
                None => per.push((l.base.file.clone(), 1, l.bytes, l.kept_cells)),
            }
        }
        (st.waiting.len() + st.lanes.iter().map(|(_, l)| l.inbox.len()).sum::<usize>(), st.lanes.iter().map(|(_, l)| l.running).sum(), per)
    }

    fn run_lane(self: Arc<Self>, id: u64, base: Arc<Base>) {
        // E26: the kept prompts' sequences come after the requests'. Off, the
        // context is made exactly as before.
        let keeping = self.prefix_cells > 0;
        let n_seq_max = SEQS + if keeping { prefix::KEEP } else { 0 };
        let mut store: Option<Store<crate::pigeons::Loaded>> = keeping.then(|| Store::new(SEQS as i32, self.prefix_cells));
        let params = ContextParams { n_ctx: self.cells, n_batch: self.cells, n_seq_max: n_seq_max as u32, kv_unified: true, embeddings: false, n_ubatch: None };
        let mut ctx = match Context::new(&base.model, &params) {
            Ok(c) => {
                self.largest.fetch_max(c.allocated(), Ordering::Relaxed);
                if let Ok(mut st) = self.state.lock() {
                    if let Some((_, lane)) = st.lanes.iter_mut().find(|(i, _)| *i == id) {
                        lane.bytes = c.allocated();
                    }
                }
                Some(c)
            }
            Err(e) => {
                // Everything given to this lane fails with the reason; the
                // lane goes, and the next request tries again.
                if let Ok(mut st) = self.state.lock() {
                    if let Some(at) = st.lanes.iter().position(|(i, _)| *i == id) {
                        let (_, lane) = st.lanes.remove(at);
                        for job in lane.inbox {
                            job.out.error("model_failed", e.clone());
                        }
                    }
                }
                return;
            }
        };
        let mut run: Vec<Seq> = Vec::new();
        let mut batch = Batch::new(self.cells as usize);
        let mut turn = 0usize;
        loop {
            {
                let Ok(mut st) = self.state.lock() else { return };
                loop {
                    let Some(at) = st.lanes.iter().position(|(i, _)| *i == id) else { return };
                    let lane = &mut st.lanes[at].1;
                    if lane.drop_kept {
                        lane.drop_kept = false;
                        if let (Some(c), Some(store)) = (ctx.as_mut(), store.as_mut()) {
                            for q in store.drop_all() {
                                c.forget(q);
                            }
                        }
                    }
                    for job in lane.inbox.drain(..) {
                        let slot = (0..SEQS as i32).find(|s| !run.iter().any(|q| q.slot == *s)).unwrap_or(0);
                        let mut seq = Seq::new(job, slot, &base, self.always_scan);
                        if let Some(c) = ctx.as_mut() {
                            c.forget(slot);
                            if let Some(store) = store.as_mut() {
                                seq.share_prefix(c, store);
                            }
                        }
                        run.push(seq);
                    }
                    lane.kept_cells = store.as_ref().map_or(0, Store::cells);
                    lane.kept_for = store.as_ref().map_or_else(Vec::new, Store::owners);
                    lane.running = run.len();
                    if !run.is_empty() {
                        break;
                    }
                    if lane.retire {
                        st.lanes.remove(at);
                        drop(ctx.take());
                        return;
                    }
                    st = match self.wake.wait(st) {
                        Ok(s) => s,
                        Err(_) => return,
                    };
                    // Woken from idle with work: requests sent together are
                    // usually still arriving, a millisecond or two apart.
                    // Starting them in one step lets one decode carry them all.
                    if st.lanes.iter().any(|(i, l)| *i == id && !l.inbox.is_empty()) {
                        drop(st);
                        std::thread::sleep(std::time::Duration::from_millis(GATHER_MS));
                        st = match self.state.lock() {
                            Ok(s) => s,
                            Err(_) => return,
                        };
                    }
                }
            }
            let Some(c) = ctx.as_mut() else { return };
            let last_adapter = step(c, &mut run, &mut batch, &mut turn, self.cells as i32);
            // E26: a prompt whose text before its first picture is now in the
            // cache is kept for its Pigeon's next ask.
            if let Some(store) = store.as_mut() {
                let mut kept = false;
                for s in run.iter_mut().filter(|s| s.next >= 1 && s.failed.is_none()) {
                    let Some(tokens) = s.prefix.take() else { continue };
                    let n = tokens.len() as i32;
                    if let Some((seq, forget)) = store.keep(&s.job.pigeon, tokens) {
                        for q in forget {
                            c.forget(q);
                        }
                        c.share(s.slot, seq, n);
                        kept = true;
                    }
                }
                if kept {
                    if let Ok(mut st) = self.state.lock() {
                        if let Some((_, lane)) = st.lanes.iter_mut().find(|(i, _)| *i == id) {
                            // A request may have just claimed the room (drop_kept).
                            if !lane.drop_kept {
                                lane.kept_cells = store.cells();
                                lane.kept_for = store.owners();
                            }
                        }
                    }
                }
            }
            let done: Vec<Seq> = {
                let (done, still): (Vec<Seq>, Vec<Seq>) = run.drain(..).partition(|s| s.stopped.is_some());
                run = still;
                done
            };
            if done.is_empty() {
                continue;
            }
            for s in &done {
                c.forget(s.slot);
                s.finish();
            }
            if let Ok(mut st) = self.state.lock() {
                if let Some((_, lane)) = st.lanes.iter_mut().find(|(i, _)| *i == id) {
                    lane.seqs -= done.len();
                    lane.reserved -= done.iter().map(|s| s.job.need()).sum::<usize>();
                    lane.running = run.len();
                    if last_adapter.is_some() {
                        lane.last_owner = last_adapter;
                    }
                    if lane.seqs == 0 {
                        lane.owner = None;
                    } else if !run.iter().any(|s| Some(key(&s.job.pigeon)) == lane.owner) {
                        // The owner's work is done; a guest now owns the lane.
                        lane.owner = run.first().map(|s| key(&s.job.pigeon));
                    }
                }
                self.place_waiting(&mut st);
            }
            self.wake.notify_all();
        }
    }
}

/// A loaded Pigeon's identity while it is loaded: its address.
fn key(p: &Arc<Loaded>) -> usize {
    Arc::as_ptr(p) as usize
}

/// A request that never reached a lane, cancelled.
fn finish_unstarted(job: &Job) {
    job.out.send(json!({
        "type": "answer", "answer": { "kind": "off_contract", "raw": "" }, "raw": "", "stopped": "cancelled",
        "as_measured": job.as_measured, "history_used": job.history_used,
        "stats": { "prompt_tokens": job.prompt_tokens, "answer_tokens": 0, "first_piece_ms": null, "total_ms": job.asked.elapsed().as_millis() as u64 },
    }));
}

/// One request running in a lane.
struct Seq {
    job: Job,
    slot: i32,
    next: usize,
    n_past: i32,
    pending: Option<i32>,
    decoder: Result<Decoder, String>,
    bytes: Vec<u8>,
    sent: usize,
    tokens: usize,
    first_ms: Option<u64>,
    /// E18: the first token's probability, for a label answer.
    first_p: Option<f32>,
    stopped: Option<&'static str>,
    failed: Option<String>,
    /// E26: the prompt's text before its first picture, to keep once it is
    /// in the cache; and how many of its tokens were shared, not evaluated.
    prefix: Option<Vec<i32>>,
    reused: usize,
}

impl Seq {
    fn new(job: Job, slot: i32, base: &Base, always_scan: bool) -> Seq {
        let decoder = Decoder::new(&base.model, job.grammar.as_deref(), job.temperature, always_scan);
        let stopped = job.cancel.load(Ordering::Relaxed).then_some("cancelled");
        Seq { job, slot, next: 0, n_past: 0, pending: None, decoder, bytes: Vec::new(), sent: 0, tokens: 0, first_ms: None, first_p: None, stopped, failed: None, prefix: None, reused: 0 }
    }

    /// E26: shares what this Pigeon's kept prompt has in common with this
    /// one, so only the rest is evaluated. Called with the slot just cleared.
    fn share_prefix(&mut self, c: &mut Context, store: &mut Store<crate::pigeons::Loaded>) {
        for q in store.purge() {
            c.forget(q);
        }
        if self.stopped.is_some() {
            return;
        }
        let whole = self.job.parts.len() == 1;
        let Some(Part::Text(tokens)) = self.job.parts.first() else { return };
        self.prefix = Some(tokens.clone());
        if let Some((seq, n)) = store.reuse(&self.job.pigeon, tokens, whole) {
            c.share(seq, self.slot, n as i32);
            self.n_past = n as i32;
            self.reused = n;
            if let Some(Part::Text(t)) = self.job.parts.first_mut() {
                t.drain(..n);
            }
        }
    }

    fn fail(&mut self, why: String) {
        self.failed = Some(why);
        self.stopped = Some("error");
    }

    /// The next whole characters, as a `piece`.
    fn stream(&mut self) {
        if !self.job.stream {
            self.sent = self.bytes.len();
            return;
        }
        let rest = &self.bytes[self.sent..];
        let whole = match std::str::from_utf8(rest) {
            Ok(s) => s.len(),
            Err(e) => e.valid_up_to(),
        };
        if whole > 0 {
            let text = String::from_utf8_lossy(&rest[..whole]).into_owned();
            self.sent += whole;
            self.job.out.send(json!({ "type": "piece", "text": text }));
        }
    }

    fn finish(&self) {
        let job = &self.job;
        if let Some(why) = &self.failed {
            return job.out.error("model_failed", why.clone());
        }
        let raw = String::from_utf8_lossy(&self.bytes).trim().to_string();
        let shown: Option<Vec<u32>> = job.sections.as_ref().map(|s| s.iter().map(|(o, _)| *o).collect());
        let mut reading = job.pigeon.reading();
        reading.shown = shown.as_deref();
        let answer = pigeon_core::ask::answer(&reading, &raw);
        let mut ev = json!({
            "type": "answer", "answer": answer, "raw": raw, "stopped": self.stopped.unwrap_or("end"),
            "as_measured": job.as_measured, "history_used": job.history_used,
            "stats": { "prompt_tokens": job.prompt_tokens, "prompt_tokens_reused": self.reused, "answer_tokens": self.tokens, "first_piece_ms": self.first_ms, "total_ms": job.asked.elapsed().as_millis() as u64 },
        });
        // E21: inside the answer, as the kit's answer object has them.
        if let (Some(v), Some(answer)) = (&job.host_values, ev["answer"].as_object_mut()) {
            answer.insert("host_values".into(), v.clone());
        }
        // E18: beside a label answer, never inside it.
        if let (Some(p), true) = (self.first_p, ev["answer"]["kind"] == "label") {
            ev["confidence"] = (p as f64).into();
        }
        if let Some(s) = &job.sections {
            ev["sections"] = Value::Array(s.iter().map(|(o, t)| json!({ "ordinal": o, "title": t })).collect());
            if job.sections_given {
                ev["sections_given"] = true.into();
            }
        }
        job.out.send(ev);
    }

    /// Takes the token chosen from `row`.
    fn take(&mut self, ctx: &Context, row: i32) {
        let t = match self.decoder.as_mut() {
            Ok(d) => d.next(ctx, row),
            Err(e) => {
                let e = e.clone();
                return self.fail(e);
            }
        };
        let Some(t) = t.filter(|t| !ctx.model().is_eog(*t)) else {
            self.stopped = Some("end");
            return;
        };
        if self.first_ms.is_none() {
            self.first_ms = Some(self.job.asked.elapsed().as_millis() as u64);
            if self.job.pigeon.manifest.output_type() == Some("label") {
                self.first_p = ctx.logits(row).and_then(|l| crate::decode::probability(l, t));
            }
        }
        self.tokens += 1;
        self.bytes.extend(ctx.model().piece(t));
        self.stream();
        if self.tokens >= self.job.max_tokens {
            self.stopped = Some("max_tokens");
        } else {
            self.pending = Some(t);
        }
    }
}

/// One step of a lane: each picture due is encoded and decoded, then one
/// decode per Pigeon present carries every one of its requests forward.
/// Returns the Pigeon whose adapter the context was left set to, if any.
fn step(ctx: &mut Context, run: &mut [Seq], batch: &mut Batch, turn: &mut usize, n_batch: i32) -> Option<usize> {
    for s in run.iter_mut() {
        if s.stopped.is_none() && s.job.cancel.load(Ordering::Relaxed) {
            s.stopped = Some("cancelled");
        }
    }
    // Pictures, one at a time: the projector is shared by every lane.
    for s in run.iter_mut().filter(|s| s.stopped.is_none() && s.pending.is_none()) {
        while let Some(Part::Image { .. }) = s.job.parts.get(s.next) {
            let (Some(pics), Some(chunks)) = (s.job.pigeon.pictures.clone(), s.job.chunks.clone()) else {
                s.fail("a picture with no projector".into());
                break;
            };
            if let Err(e) = ctx.use_adapter(s.job.pigeon.adapter.as_ref()) {
                s.fail(e);
                break;
            }
            let embd = pics.lock.lock().map_err(|_| "the projector's lock is poisoned".to_string()).and_then(|_held| pics.projector.encode(&chunks, s.next));
            match embd.and_then(|mut e| pics.projector.decode_image(ctx, &chunks, s.next, &mut e, s.n_past, s.slot, n_batch)) {
                Ok(next) => {
                    s.n_past = next;
                    s.next += 1;
                }
                Err(e) => {
                    s.fail(e);
                    break;
                }
            }
        }
    }
    // The Pigeons present, taking turns from a different one each step.
    let mut owners: Vec<usize> = Vec::new();
    for s in run.iter().filter(|s| s.stopped.is_none()) {
        let p = key(&s.job.pigeon);
        if !owners.contains(&p) {
            owners.push(p);
        }
    }
    if owners.is_empty() {
        return None;
    }
    let mut last = None;
    *turn = turn.wrapping_add(1);
    let k = *turn % owners.len();
    owners.rotate_left(k);
    for owner in owners {
        batch.clear();
        let mut rows: Vec<(usize, i32)> = Vec::new();
        let mut members: Vec<usize> = Vec::new();
        let mut adapter = None;
        for (i, s) in run.iter_mut().enumerate() {
            if s.stopped.is_some() || key(&s.job.pigeon) != owner {
                continue;
            }
            adapter = Some(s.job.pigeon.clone());
            members.push(i);
            if let Some(t) = s.pending.take() {
                match batch.add(t, s.n_past, s.slot, true) {
                    Ok(row) => rows.push((i, row)),
                    Err(e) => s.fail(e),
                }
                s.n_past += 1;
                continue;
            }
            let last = s.job.parts.len().saturating_sub(1);
            if let Some(Part::Text(tokens)) = s.job.parts.get(s.next) {
                let at_end = s.next == last;
                let n = tokens.len();
                let mut row = None;
                for (j, &t) in tokens.iter().enumerate() {
                    match batch.add(t, s.n_past + j as i32, s.slot, at_end && j + 1 == n) {
                        Ok(r) => row = Some(r),
                        Err(e) => {
                            s.fail(e);
                            break;
                        }
                    }
                }
                s.n_past += n as i32;
                s.next += 1;
                if at_end {
                    match row {
                        Some(r) => rows.push((i, r)),
                        None => s.fail("the prompt ended with nothing to answer".into()),
                    }
                }
            }
        }
        if batch.is_empty() {
            continue;
        }
        let Some(p) = adapter else { continue };
        last = Some(owner);
        let ok = ctx.use_adapter(p.adapter.as_ref()).and_then(|_| ctx.decode(batch));
        if let Err(e) = ok {
            for i in members {
                run[i].fail(e.clone());
            }
            continue;
        }
        for (i, row) in rows {
            run[i].take(ctx, row);
        }
    }
    last
}
