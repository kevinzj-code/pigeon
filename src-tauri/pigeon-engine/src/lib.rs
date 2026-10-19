//! `pigeon-engine` — does what a `.pigeon` file says, with the model in the
//! host's own process (INTERFACE.md, Draft 6).
//!
//! One base is loaded once and any number of Pigeons hang off it. Everything
//! the spec's §8 requires is `pigeon-core`'s own code: the check, the template
//! filled in one pass, the picture first, retrieval, the chat template
//! rendered with minijinja, the answer read. This crate adds llama.cpp
//! (`llama.rs`, the only unsafe code), the decoding rules (`decode.rs`) and
//! running many requests at once (`lanes.rs`).
//!
//! The Rust API mirrors the C functions of the interface: `Engine::new`,
//! `check`, `load`, `unload`, `ask`, `cancel`, `info`, `poll`, with the same
//! JSON in and out. Events go to a callback or to the `poll` queue (E1).

// Every unsafe call is in llama.rs (llama.cpp) or apple.rs (the frame
// pictures); the compiler holds the rest of the crate to it.
#![deny(unsafe_code)]

#[cfg(target_os = "macos")]
#[allow(unsafe_code)]
mod apple;
mod config;
mod decode;
mod embed;
mod events;
#[allow(unsafe_code)]
pub mod llama;
mod lanes;
mod pigeons;
mod prefix;
mod prep;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::Instant;

use pigeon_core::check::{Host, Machine, Refused, Trust};
use pigeon_core::hashes::HashCache;
use pigeon_core::registry::{self, Registry};
use pigeon_core::{nest, scan};
use serde_json::{json, Value};

pub use config::Config;
pub use events::{Callback, Sink};

use events::{Out, Queue};
use pigeons::{Base, Failed, Here, Loaded, Opened};

/// The llama.cpp commit `llama-cpp-sys-2` 0.1.158 carries.
pub const LLAMA_CPP_COMMIT: &str = "26394b4";

/// A question embedded as `hybrid-v1` retrieval embeds it, with the model at
/// `path`. For tests that hold the engine's embeddings against another
/// runtime's; a host never needs it.
#[doc(hidden)]
pub fn embed_question(path: &Path, prefix: &str, question: &str) -> Result<Vec<f32>, String> {
    embed::Embedder::load(path, "")?.embed(prefix, question)
}

/// Encoded frames, oldest first, made into the picture a `frames` ask shows
/// the model (E12): each cut to the kept part, stacked, written as JPEG 0.85.
/// For a host that shows or logs what the Pigeon saw; the ask makes its own.
#[cfg(target_os = "macos")]
pub fn compose_frames(frames_block: &Value, encoded: &[Vec<u8>]) -> Result<Vec<u8>, String> {
    let images = encoded.iter().map(|b| apple::Image::decode(b)).collect::<Result<Vec<_>, _>>()?;
    prep::compose(frames_block, images).map_err(|(_, m)| m)
}

/// A PNG or JPEG with its longer side brought down to `max_side` pixels, as
/// JPEG 0.85, or None when it already fits. For a host handing a picture to
/// a Pigeon that reads at its own, smaller size (Peek): the projector would
/// shrink it anyway, and the vision encoder and the picture's prefill both
/// cost by the picture token, so a smaller picture is a faster answer.
#[cfg(target_os = "macos")]
pub fn fit_picture(encoded: &[u8], max_side: usize) -> Result<Option<Vec<u8>>, String> {
    match apple::Image::decode(encoded)?.scaled(max_side)? {
        Some(smaller) => smaller.jpeg().map(Some),
        None => Ok(None),
    }
}

/// The runtime stamp (§7, E10, E26) of an engine made with the default
/// prefix cache. A score belongs to the build and to the prefix-cache
/// setting it was measured with: an engine's own stamp, with its own
/// setting, is `Engine::version` (`pigeon_info().version`), which is what a
/// check ride records (D98).
pub fn version() -> &'static str {
    static V: std::sync::OnceLock<String> = std::sync::OnceLock::new();
    V.get_or_init(|| version_with(config::PREFIX_CACHE_DEFAULT))
}

/// The stamp for an engine whose `prefix_cache_tokens` is `prefix_cache_tokens`.
pub fn version_with(prefix_cache_tokens: u32) -> String {
    let prefix = if prefix_cache_tokens == 0 { "off".to_string() } else { prefix_cache_tokens.to_string() };
    format!("libpigeon 0.1.0 (llama.cpp {LLAMA_CPP_COMMIT}; spec 1; prefix-cache {prefix})")
}

pub struct Engine {
    inner: Arc<Inner>,
}

struct Slot {
    path: PathBuf,
    member: Option<String>,
    id: String,
    kind: String,
    loaded: Option<Arc<Loaded>>,
}

struct Inner {
    cfg: Config,
    registries: Vec<Registry>,
    hashes: Mutex<HashCache>,
    next: AtomicU64,
    next_pigeon: AtomicU64,
    queue: Arc<Queue>,
    pigeons: Mutex<HashMap<u64, Slot>>,
    bases: Mutex<Vec<Arc<Base>>>,
    embedders: Mutex<Vec<Arc<embed::Embedder>>>,
    loading: Mutex<()>,
    sched: Arc<lanes::Scheduler>,
    cancels: Mutex<HashMap<u64, Arc<AtomicBool>>>,
    prep: Mutex<mpsc::Sender<Asked>>,
    preparing: AtomicU64,
    stopped: AtomicBool,
}

struct Asked {
    request: Value,
    attachments: Vec<Vec<u8>>,
    out: Out,
    cancel: Arc<AtomicBool>,
    asked: Instant,
}

impl Engine {
    /// `pigeon_engine_new`. An error is `{code, message}`.
    pub fn new(config_json: &str) -> Result<Engine, Value> {
        let cfg = Config::parse(config_json).map_err(|e| json!({ "code": "bad_request", "message": e }))?;
        llama::init();
        let trust = Trust { pigeons: &cfg.trusted_pigeon_keys, registries: &cfg.trusted_registry_keys };
        let raw: Vec<Vec<u8>> = cfg.registries.iter().filter_map(|p| std::fs::read(p).ok()).collect();
        let (registries, _ignored) = registry::open_all(&raw.iter().map(Vec::as_slice).collect::<Vec<_>>(), &trust);
        let hashes = HashCache::open(cfg.hash_cache.as_deref().unwrap_or(Path::new("")));
        let (tx, rx) = mpsc::channel::<Asked>();
        let inner = Arc::new(Inner {
            sched: lanes::Scheduler::new(cfg.parallel, cfg.context_tokens, cfg.grammar_first_always, cfg.memory_limit_bytes, cfg.prefix_cache_tokens as usize),
            cfg,
            registries,
            hashes: Mutex::new(hashes),
            next: AtomicU64::new(0),
            next_pigeon: AtomicU64::new(0),
            queue: Arc::new(Queue::default()),
            pigeons: Mutex::new(HashMap::new()),
            bases: Mutex::new(Vec::new()),
            embedders: Mutex::new(Vec::new()),
            loading: Mutex::new(()),
            cancels: Mutex::new(HashMap::new()),
            prep: Mutex::new(tx),
            preparing: AtomicU64::new(0),
            stopped: AtomicBool::new(false),
        });
        // Asks are prepared on one thread, in the order they came, so `ask`
        // returns at once and a request's events stay in order.
        let weak = Arc::downgrade(&inner);
        std::thread::Builder::new()
            .name("pigeon-ask".into())
            .spawn(move || {
                for a in rx {
                    let Some(inner) = weak.upgrade() else { return };
                    // E23: a panic ends that request (its way out says so as
                    // it unwinds); the thread lives on for the next ask.
                    let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| inner.prepare(a)));
                }
            })
            .map_err(|e| json!({ "code": "model_failed", "message": e.to_string() }))?;
        // E17: the idle watch. It holds no strong reference between looks,
        // so it never keeps a dropped engine alive.
        if let Some(period) = inner.cfg.idle_period() {
            let weak = Arc::downgrade(&inner);
            let tick = (period / 4).clamp(std::time::Duration::from_millis(100), std::time::Duration::from_secs(30));
            std::thread::Builder::new()
                .name("pigeon-idle".into())
                .spawn(move || loop {
                    std::thread::sleep(tick);
                    let Some(inner) = weak.upgrade() else { return };
                    if inner.stopped.load(Ordering::Relaxed) {
                        return;
                    }
                    inner.unload_idle(period);
                })
                .map_err(|e| json!({ "code": "model_failed", "message": e.to_string() }))?;
        }
        Ok(Engine { inner })
    }

    /// This engine's runtime stamp, its prefix-cache setting included (E26, D98).
    pub fn version(&self) -> String {
        version_with(self.inner.cfg.prefix_cache_tokens)
    }

    /// `pigeon_check`: the report or refusal, with no model loaded.
    pub fn check(&self, request: &Value) -> Value {
        let Some(path) = request.get("path").and_then(Value::as_str) else {
            return json!({ "result": "error", "code": "bad_request", "message": "path is required" });
        };
        let member = request.get("member").and_then(Value::as_str);
        let opened = match Opened::open(Path::new(path), member) {
            Ok(o) => o,
            Err(r) => return r.json(),
        };
        if member.is_none() && nest::is_nest(opened.bytes()) {
            let members = match nest::members(opened.bytes()) {
                Ok(m) => m,
                Err(r) => return r.json(),
            };
            let checked: Vec<nest::Member> = members.into_iter().map(|(file, bytes)| nest::Member { file, outcome: self.inner.checked(bytes) }).collect();
            return nest::json(&checked);
        }
        match self.inner.checked(opened.bytes()) {
            Ok(r) => r.json(),
            Err(r) => r.json(),
        }
    }

    /// `pigeon_load`: events `progress`, then `loaded` or `refused` (or `error`).
    pub fn load(&self, request: &Value, sink: Sink) -> u64 {
        let id = self.inner.next.fetch_add(1, Ordering::Relaxed) + 1;
        let out = Out::new(id, sink, self.inner.queue.clone());
        let inner = self.inner.clone();
        let request = request.clone();
        std::thread::Builder::new()
            .name(format!("pigeon-load-{id}"))
            .spawn(move || inner.load(&request, &out))
            .ok();
        id
    }

    /// `pigeon_unload`.
    pub fn unload(&self, pigeon: u64) {
        if let Ok(mut p) = self.inner.pigeons.lock() {
            p.remove(&pigeon);
        }
    }

    /// `pigeon_ask`: events `piece`… then `answer` (or `error`).
    pub fn ask(&self, request: &Value, attachments: Vec<Vec<u8>>, sink: Sink) -> u64 {
        let id = self.inner.next.fetch_add(1, Ordering::Relaxed) + 1;
        let out = Out::new(id, sink, self.inner.queue.clone());
        let cancel = Arc::new(AtomicBool::new(false));
        if let Ok(mut c) = self.inner.cancels.lock() {
            c.retain(|_, f| Arc::strong_count(f) > 1);
            c.insert(id, cancel.clone());
        }
        self.inner.preparing.fetch_add(1, Ordering::Relaxed);
        let asked = Asked { request: request.clone(), attachments, out: out.clone(), cancel, asked: Instant::now() };
        let sent = self.inner.prep.lock().map(|tx| tx.send(asked).is_ok()).unwrap_or(false);
        if !sent {
            out.error("model_failed", "the engine has stopped");
        }
        id
    }

    /// `pigeon_fetch`. E22: version 1 has no downloader, and an engine with
    /// downloads on is refused when it is made, so every fetch ends at once
    /// with `downloads_off`.
    pub fn fetch(&self, _request: &Value, sink: Sink) -> u64 {
        let id = self.inner.next.fetch_add(1, Ordering::Relaxed) + 1;
        Out::new(id, sink, self.inner.queue.clone()).error("downloads_off", "this engine has no downloader (E22); fetch the file the refusal's needs names yourself");
        id
    }

    /// For a host's boundary: a request number whose one event is this error,
    /// for a call that could not be read (its JSON is not JSON, a string is
    /// not UTF-8) but should still answer the way every request does.
    pub fn fail(&self, code: &str, message: &str, sink: Sink) -> u64 {
        let id = self.inner.next.fetch_add(1, Ordering::Relaxed) + 1;
        Out::new(id, sink, self.inner.queue.clone()).error(code, message);
        id
    }

    /// For a host's boundary: an event it made itself (a call that failed
    /// before it had a request number, E23), into the `poll` queue.
    pub fn post(&self, event: Value) {
        self.inner.queue.push(event);
    }

    /// `pigeon_cancel`: stops within one token. Unknown or finished: nothing.
    pub fn cancel(&self, request: u64) {
        if let Some(f) = self.inner.cancels.lock().ok().and_then(|c| c.get(&request).cloned()) {
            f.store(true, Ordering::Relaxed);
            self.inner.sched.cancel();
        }
    }

    /// Frees every model, context and projector, and returns once they are
    /// gone. A host MUST let this happen before its process exits: Metal
    /// asserts at exit when GPU memory is still held, which ends the process
    /// with a crash report. Everything running is cancelled first. `Drop`
    /// calls it too.
    pub fn shutdown(&self) {
        self.inner.stopped.store(true, Ordering::Relaxed);
        if let Ok(c) = self.inner.cancels.lock() {
            for f in c.values() {
                f.store(true, Ordering::Relaxed);
            }
        }
        if let Ok(mut p) = self.inner.pigeons.lock() {
            p.clear();
        }
        let bases: Vec<Arc<Base>> = self.inner.bases.lock().map(|mut b| b.drain(..).collect()).unwrap_or_default();
        self.inner.sched.stop_all(std::time::Duration::from_secs(30));
        if let Ok(mut e) = self.inner.embedders.lock() {
            e.clear();
        }
        drop(bases);
    }

    /// Pigeon `pigeon` ready to be asked: its base loaded again if the idle
    /// unload took it, the Pigeon attached again, and a lane's context made
    /// on its base. Nothing is asked. For a host that can see a question
    /// coming (someone typing) and would rather pay the load then.
    pub fn warm(&self, pigeon: u64) -> Result<(), Value> {
        let p = self.inner.pigeon(pigeon).map_err(|(code, message)| json!({ "code": code, "message": message }))?;
        self.inner.sched.warm(&p.base);
        Ok(())
    }

    /// `pigeon_poll`.
    pub fn poll(&self) -> Option<Value> {
        self.inner.queue.pop()
    }

    /// `pigeon_info`: what is loaded, and what it costs.
    pub fn info(&self) -> Value {
        let (queued, running, lanes) = self.inner.sched.counts();
        let slots = self.inner.pigeons.lock().map(|p| p.iter().map(|(n, s)| (*n, s.id.clone(), s.kind.clone(), s.loaded.clone())).collect::<Vec<_>>()).unwrap_or_default();
        let bases: Vec<Value> = self
            .inner
            .bases
            .lock()
            .map(|b| b.clone())
            .unwrap_or_default()
            .iter()
            .map(|b| {
                let (n_lanes, lane_bytes, kept) = lanes.iter().find(|(f, _, _, _)| *f == b.file).map_or((0, 0, 0), |x| (x.1, x.2, x.3));
                let projectors: Vec<String> = b.projectors.lock().map(|p| p.iter().map(|x| x.file.clone()).collect()).unwrap_or_default();
                json!({
                    "file": b.file,
                    "bytes_in_memory": b.weights_bytes() + lane_bytes,
                    "idle_s": b.used.lock().map(|u| u.elapsed().as_secs()).unwrap_or(0),
                    "projector": projectors.first(),
                    "contexts": n_lanes,
                    // E26: cells of its contexts holding kept prompts.
                    "prefix_tokens": kept,
                    "pigeons": slots.iter().filter(|s| s.3.as_ref().is_some_and(|l| Arc::ptr_eq(&l.base, b))).map(|s| s.0).collect::<Vec<_>>(),
                })
            })
            .collect();
        let pigeons: Vec<Value> = slots
            .iter()
            .map(|(n, id, kind, l)| {
                let mut p = json!({ "pigeon": n, "id": id, "kind": kind, "loaded": l.is_some() });
                if let Some(t) = l.as_ref().and_then(|l| l.picture_tokens) {
                    p["picture_tokens"] = t.into();
                }
                p
            })
            .collect();
        let embedders: Vec<Value> = self.inner.embedders.lock().map(|e| e.iter().map(|x| json!({ "file": x.file, "bytes_in_memory": x.bytes })).collect()).unwrap_or_default();
        json!({
            "version": version_with(self.inner.cfg.prefix_cache_tokens), "backend": "metal", "bases": bases, "pigeons": pigeons, "embedding_models": embedders,
            "idle_unload_s": self.inner.cfg.idle_period().map(|d| d.as_secs()),
            "queued": queued + self.inner.preparing.load(Ordering::Relaxed) as usize, "running": running,
        })
    }
}

impl Drop for Engine {
    fn drop(&mut self) {
        self.shutdown();
    }
}

impl Inner {
    fn trust(&self) -> Trust<'_> {
        Trust { pigeons: &self.cfg.trusted_pigeon_keys, registries: &self.cfg.trusted_registry_keys }
    }

    fn folders(&self) -> scan::Folders {
        scan::Folders { base_dirs: self.cfg.base_dirs.clone(), projector_dirs: self.cfg.projector_dirs.clone(), embedding_dirs: self.cfg.embedding_dirs.clone() }
    }

    fn save_hashes(&self, cache: &mut HashCache) {
        if self.cfg.hash_cache.is_some() {
            let _ = cache.save();
        }
    }

    /// The check, against the folders scanned for this Pigeon (§7.3).
    fn checked(&self, bytes: &[u8]) -> Result<pigeon_core::Report, Refused> {
        let scanned = {
            let Ok(mut cache) = self.hashes.lock() else { return Err(Refused::BadZip("the hash cache is poisoned".into())) };
            let s = scan::for_pigeon(&self.folders(), bytes, &mut cache);
            self.save_hashes(&mut cache);
            s
        };
        let host = Host { machine: Some(Machine { bases: &scanned.bases, projectors: &scanned.projectors, embedders: &scanned.embedders }), trust: self.trust(), registries: &self.registries };
        pigeon_core::check::check(bytes, &host)
    }

    fn load(self: &Arc<Self>, request: &Value, out: &Out) {
        let Some(path) = request.get("path").and_then(Value::as_str) else { return out.error("bad_request", "path is required") };
        let member = request.get("member").and_then(Value::as_str).map(String::from);
        match self.load_file(Path::new(path), member.as_deref(), Some(out)) {
            Ok(loaded) => {
                let n = self.next_pigeon.fetch_add(1, Ordering::Relaxed) + 1;
                let mut ev = loaded.report.clone();
                ev["type"] = "loaded".into();
                ev["pigeon"] = n.into();
                ev["base"] = json!({ "file": loaded.base.file, "loaded": true });
                if let Ok(mut p) = self.pigeons.lock() {
                    p.insert(n, Slot { path: PathBuf::from(path), member, id: loaded.manifest.id.clone(), kind: loaded.manifest.kind.clone(), loaded: Some(Arc::new(loaded)) });
                }
                out.send(ev);
            }
            Err(Failed::Refused(r)) => {
                let mut ev = r.json();
                ev["type"] = "refused".into();
                out.send(ev);
            }
            Err(Failed::NoProjector { needs, carried }) => {
                let mut ev = Refused::NoProjector(needs).json();
                ev["type"] = "refused".into();
                ev["carried"] = carried.into();
                out.send(ev);
            }
            Err(Failed::Mismatch { at, rendered }) => {
                let mut ev = Refused::PromptMismatch { at }.json();
                ev["type"] = "refused".into();
                ev["rendered"] = rendered.into();
                out.send(ev);
            }
            Err(Failed::Error(code, message)) => out.error(code, message),
        }
    }

    /// Check, find the base, load it once, attach the adapter, prove the prompt.
    fn load_file(self: &Arc<Self>, path: &Path, member: Option<&str>, out: Option<&Out>) -> Result<Loaded, Failed> {
        // A load that panicked (E23) ended its own request; the next one loads.
        let _one_at_a_time = self.loading.lock().unwrap_or_else(|p| p.into_inner());
        let progress = |stage: &str| {
            if let Some(o) = out {
                o.send(json!({ "type": "progress", "stage": stage }));
            }
        };
        progress("check");
        let opened = Opened::open(path, member)?;
        let report = self.checked(opened.bytes())?;
        let file = report.base_file.clone().ok_or_else(|| Failed::Error("model_failed", "the check found no base".into()))?;
        let base_path = scan::ggufs(&self.cfg.base_dirs)
            .into_iter()
            .find(|p| p.file_name().is_some_and(|n| n.to_string_lossy() == file))
            .ok_or_else(|| Failed::Error("model_failed", format!("{file} is not in the engine's base folders")))?;
        let base = self.base(&base_path, &progress)?;
        progress("adapter");
        let here = Here { registries: &self.registries, projector_dirs: &self.cfg.projector_dirs, embedding_dirs: &self.cfg.embedding_dirs, hashes: &self.hashes, embedders: &self.embedders };
        let loaded = pigeons::attach(&opened, report, base, &here);
        if let Ok(mut cache) = self.hashes.lock() {
            self.save_hashes(&mut cache);
        }
        self.count_weights();
        loaded
    }

    /// The base at `path`, loaded once; the least recently used one is
    /// unloaded first when `max_bases_loaded` or the memory limit says so.
    fn base(self: &Arc<Self>, path: &Path, progress: &dyn Fn(&str)) -> Result<Arc<Base>, Failed> {
        if let Some(b) = self.bases.lock().ok().and_then(|b| b.iter().find(|x| x.path == path).cloned()) {
            b.touch();
            return Ok(b);
        }
        // What it will cost: its weights and one context, judged with what
        // is held now (weights and every context's real allocation).
        let file_bytes = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);
        let context = self.sched.next_context_unknown();
        loop {
            let count = self.bases.lock().map(|b| b.len()).unwrap_or(0);
            let fits = self.sched.fits(file_bytes + context);
            if count == 0 || (count < self.cfg.max_bases_loaded && fits) {
                if !fits && count == 0 && self.sched.contexts_bytes() == 0 {
                    return Err(Failed::Error("out_of_memory", format!("this base needs about {} MB with one context, past the memory limit", (file_bytes + context) >> 20)));
                }
                break;
            }
            self.evict_oldest();
            self.sched.wait_retired(std::time::Duration::from_secs(5));
        }
        progress("base");
        let b = Arc::new(Base::load(path).map_err(|e| Failed::Error("model_failed", e))?);
        if let Ok(mut all) = self.bases.lock() {
            all.push(b.clone());
        }
        Ok(b)
    }

    /// Unloads the base used longest ago, with its Pigeons; their numbers
    /// stay valid and they load again on their next ask.
    fn evict_oldest(&self) {
        let gone = {
            let Ok(mut all) = self.bases.lock() else { return };
            let Some(at) = all.iter().enumerate().min_by_key(|(_, b)| b.used.lock().map(|u| *u).unwrap_or_else(|_| Instant::now())).map(|(i, _)| i) else { return };
            all.remove(at)
        };
        self.forget_base(gone);
    }

    /// E17: unloads every base that has answered nothing for `period`. A base
    /// with work waiting or running is not idle, however long ago it was
    /// asked, and counts as used now. Holds the loader's lock, so a base is
    /// never unloaded while a Pigeon is being attached to it.
    fn unload_idle(&self, period: std::time::Duration) {
        let _one_at_a_time = self.loading.lock().unwrap_or_else(|p| p.into_inner());
        let all: Vec<Arc<Base>> = self.bases.lock().map(|b| b.clone()).unwrap_or_default();
        for b in all {
            if self.sched.busy(&b) {
                b.touch();
                continue;
            }
            if b.used.lock().map_or(false, |u| u.elapsed() >= period) {
                let gone = self.bases.lock().ok().and_then(|mut v| v.iter().position(|x| Arc::ptr_eq(x, &b)).map(|i| v.remove(i)));
                if let Some(gone) = gone {
                    self.forget_base(gone);
                }
            }
        }
    }

    /// A base taken off the list: its Pigeons stop holding it, and its lanes
    /// stop once idle, which is when its memory goes.
    fn forget_base(&self, gone: Arc<Base>) {
        if let Ok(mut p) = self.pigeons.lock() {
            for s in p.values_mut() {
                if s.loaded.as_ref().is_some_and(|l| Arc::ptr_eq(&l.base, &gone)) {
                    s.loaded = None;
                }
            }
        }
        self.sched.retire(&gone);
        self.count_weights();
    }

    /// Tells the scheduler what the weights the engine holds come to.
    fn count_weights(&self) {
        let bases: u64 = self.bases.lock().map(|b| b.iter().map(|x| x.weights_bytes()).sum()).unwrap_or(0);
        let embedders: u64 = self.embedders.lock().map(|e| e.iter().map(|x| x.bytes).sum()).unwrap_or(0);
        self.sched.set_weights(bases + embedders);
    }

    /// The Pigeon numbered `n`, loading it again if its base was unloaded.
    fn pigeon(self: &Arc<Self>, n: u64) -> Result<Arc<Loaded>, (&'static str, String)> {
        let (path, member, loaded) = {
            let p = self.pigeons.lock().map_err(|_| ("model_failed", "poisoned".to_string()))?;
            let s = p.get(&n).ok_or(("unknown_pigeon", format!("no loaded Pigeon is number {n}")))?;
            (s.path.clone(), s.member.clone(), s.loaded.clone())
        };
        if let Some(l) = loaded {
            l.base.touch();
            return Ok(l);
        }
        let l = Arc::new(self.load_file(&path, member.as_deref(), None).map_err(|f| match f {
            Failed::Refused(r) => ("model_failed", r.message()),
            Failed::Mismatch { at, .. } => ("model_failed", Refused::PromptMismatch { at }.message()),
            Failed::NoProjector { needs, .. } => ("model_failed", Refused::NoProjector(needs).message()),
            Failed::Error(c, m) => (c, m),
        })?);
        if let Ok(mut p) = self.pigeons.lock() {
            if let Some(s) = p.get_mut(&n) {
                s.loaded = Some(l.clone());
            }
        }
        Ok(l)
    }

    fn prepare(self: &Arc<Self>, a: Asked) {
        /// Counted out of `queued` however preparing ends, a panic included.
        struct Prepared<'a>(&'a AtomicU64);
        impl Drop for Prepared<'_> {
            fn drop(&mut self) {
                self.0.fetch_sub(1, Ordering::Relaxed);
            }
        }
        let prepared = Prepared(&self.preparing);
        let Some(n) = a.request.get("pigeon").and_then(Value::as_u64) else {
            return a.out.error("bad_request", "pigeon is required, and must be a number");
        };
        let pigeon = match self.pigeon(n) {
            Ok(p) => p,
            Err((code, m)) => return a.out.error(code, m),
        };
        let ready = prep::prepare(pigeon, &a.request, &a.attachments, a.out.clone(), a.cancel.clone(), a.asked, self.cfg.context_tokens);
        drop(prepared);
        match ready {
            Ok(prep::Ready::Job(job)) => self.sched.submit(job),
            Ok(prep::Ready::Now(ev)) => a.out.send(ev),
            Err((code, m)) => a.out.error(code, m),
        }
    }
}

/// Against real weights and Patch's nest, when `PIGEON_MODELS_DIR` and
/// `PIGEON_PREFIX_NEST` are set (skipped otherwise): `warm` after an idle
/// unload, a picture brought down to size before Peek, and the tidier's
/// pieces streamed in order.
#[cfg(all(test, target_os = "macos"))]
mod live {
    use super::*;
    use std::sync::mpsc;

    fn env(k: &str) -> Option<PathBuf> {
        std::env::var_os(k).map(PathBuf::from)
    }

    fn collect() -> (Sink, mpsc::Receiver<Value>) {
        let (tx, rx) = mpsc::channel();
        let tx = Mutex::new(tx);
        (Sink::Callback(Arc::new(move |e: &Value| { let _ = tx.lock().unwrap().send(e.clone()); })), rx)
    }

    /// Every event up to and including the final one.
    fn all(rx: &mpsc::Receiver<Value>) -> Vec<Value> {
        let mut out = Vec::new();
        loop {
            let ev = rx.recv().unwrap();
            let last = !matches!(ev["type"].as_str(), Some("progress") | Some("piece"));
            out.push(ev);
            if last {
                return out;
            }
        }
    }

    fn load(e: &Engine, nest: &Path, member: &str) -> u64 {
        let (sink, rx) = collect();
        e.load(&json!({ "path": nest, "member": member }), sink);
        let ev = all(&rx).pop().unwrap();
        assert_eq!(ev["type"], "loaded", "{ev}");
        ev["pigeon"].as_u64().unwrap()
    }

    #[test]
    fn warm_reloads_after_the_idle_unload_fit_picture_cuts_peeks_tokens_and_the_tidier_streams() {
        let (Some(models), Some(nest)) = (env("PIGEON_MODELS_DIR"), env("PIGEON_PREFIX_NEST")) else {
            eprintln!("skipped: set PIGEON_MODELS_DIR and PIGEON_PREFIX_NEST");
            return;
        };
        let cfg = json!({ "base_dirs": [&models], "projector_dirs": [models.join("projectors")], "context_tokens": 4096, "idle_unload_s": 1 });
        let e = Engine::new(&cfg.to_string()).unwrap();
        let router = load(&e, &nest, "patch-router.pigeon");

        // Warm: a lane on the base before anything is asked.
        e.warm(router).unwrap();
        let info = e.info();
        assert_eq!(info["bases"].as_array().map(Vec::len), Some(1), "{info}");
        assert_eq!(info["bases"][0]["contexts"], 1, "a lane was made by warm: {info}");
        // Idle 1 s: the base goes. Warm brings it and a lane back; the ask then answers.
        let t = Instant::now();
        while !e.info()["bases"].as_array().unwrap().is_empty() && t.elapsed().as_secs() < 10 {
            std::thread::sleep(std::time::Duration::from_millis(200));
        }
        assert!(e.info()["bases"].as_array().unwrap().is_empty(), "the idle unload took the base");
        let t = Instant::now();
        e.warm(router).unwrap();
        let warmed_ms = t.elapsed().as_millis();
        let info = e.info();
        assert_eq!(info["bases"][0]["contexts"], 1, "after the unload, warm made a lane again: {info}");
        let (sink, rx) = collect();
        e.ask(&json!({ "pigeon": router, "input": "convert 5 miles to km" }), Vec::new(), sink);
        let ev = all(&rx).pop().unwrap();
        assert_eq!(ev["raw"], "conversion", "{ev}");
        println!("warm after the idle unload: {warmed_ms} ms; the ask after it: {} ms", ev["stats"]["total_ms"]);

        // Peek: a 3000 × 2000 picture, whole and brought down to 1024.
        let big = apple::Image::from_rgba(3000, 2000, &(0..3000 * 2000 * 4).map(|i| (i % 251) as u8).collect::<Vec<u8>>()).unwrap().jpeg().unwrap();
        let small = fit_picture(&big, 1024).unwrap().expect("a 3000-wide picture is brought down");
        assert!(fit_picture(&small, 1024).unwrap().is_none(), "once down, it stays");
        let peek = load(&e, &nest, "peek.pigeon");
        let mut tokens = Vec::new();
        for pic in [big, small] {
            let (sink, rx) = collect();
            e.ask(&json!({ "pigeon": peek, "input": "What is this?", "picture": { "attachment": 0 }, "options": { "max_tokens": 4, "temperature": 0 } }), vec![pic], sink);
            let ev = all(&rx).pop().unwrap();
            assert_eq!(ev["type"], "answer", "{ev}");
            tokens.push((ev["stats"]["prompt_tokens"].as_u64().unwrap(), ev["stats"]["first_piece_ms"].as_u64().unwrap_or(0)));
        }
        println!("peek prompt tokens and first piece: whole {:?}, at 1024 {:?}", tokens[0], tokens[1]);
        assert!(tokens[1].0 < tokens[0].0, "fewer picture tokens at 1024: {tokens:?}");

        // The tidier, streamed: the pieces in order add up to the answer.
        let tidier = load(&e, &nest, "tidier.pigeon");
        let (sink, rx) = collect();
        e.ask(&json!({ "pigeon": tidier, "input": "so we met on tuesday and. the budget was. fine", "options": { "stream": true, "max_tokens": 40 } }), Vec::new(), sink);
        let evs = all(&rx);
        let pieces: String = evs.iter().filter(|e| e["type"] == "piece").map(|e| e["text"].as_str().unwrap()).collect();
        let last = evs.last().unwrap();
        assert_eq!(last["type"], "answer", "{last}");
        assert!(evs.len() > 3, "pieces came one by one: {}", evs.len());
        assert_eq!(pieces.trim(), last["raw"].as_str().unwrap(), "the pieces add up to the answer");
        println!("tidier: {} pieces for {:?}", evs.len() - 1, last["raw"]);
        e.shutdown();
    }
}

/// A frames bench for a playing Pigeon, against real weights: the same 60
/// frames judged one lane at a time, two in flight in one lane, and two
/// lanes, with frames per second and the time from ask to answer for each.
/// Needs `PIGEON_MODELS_DIR`, `PIGEON_PLAY_PIGEON` (a picture Pigeon with
/// `actions.frames`) and `PIGEON_FRAMES_DIR` (the frames are written there,
/// for a second bench to reuse); skipped otherwise.
#[cfg(all(test, target_os = "macos"))]
mod play_bench {
    use super::*;
    use std::sync::mpsc;

    fn env(k: &str) -> Option<PathBuf> {
        std::env::var_os(k).map(PathBuf::from)
    }

    /// 60 frames, 768 × 432, each a different scene: a moving block on a
    /// gradient, so no two prompts share a picture.
    fn frames(dir: &Path) -> Vec<Vec<u8>> {
        std::fs::create_dir_all(dir).unwrap();
        (0..60)
            .map(|i| {
                let (w, h) = (768usize, 432usize);
                let mut rgba = vec![0u8; w * h * 4];
                for y in 0..h {
                    for x in 0..w {
                        let p = (y * w + x) * 4;
                        let inside = x >= 60 + i * 10 && x < 160 + i * 10 && y >= 100 + (i % 7) * 30 && y < 200 + (i % 7) * 30;
                        rgba[p] = if inside { 240 } else { (x * 255 / w) as u8 };
                        rgba[p + 1] = if inside { 40 } else { (y * 255 / h) as u8 };
                        rgba[p + 2] = if inside { 40 } else { 120 };
                        rgba[p + 3] = 255;
                    }
                }
                let jpeg = apple::Image::from_rgba(w, h, &rgba).unwrap().jpeg().unwrap();
                std::fs::write(dir.join(format!("{i:02}.jpg")), &jpeg).unwrap();
                jpeg
            })
            .collect()
    }

    fn engine(models: &Path, parallel: usize) -> Engine {
        let cfg = json!({ "base_dirs": [models], "projector_dirs": [models.join("projectors")], "context_tokens": 4096, "parallel": parallel });
        Engine::new(&cfg.to_string()).unwrap()
    }

    fn load(e: &Engine, path: &Path) -> u64 {
        let (tx, rx) = mpsc::channel::<Value>();
        let tx = Mutex::new(tx);
        e.load(&json!({ "path": path }), Sink::Callback(Arc::new(move |ev: &Value| { let _ = tx.lock().unwrap().send(ev.clone()); })));
        loop {
            let ev = rx.recv().unwrap();
            if ev["type"] == "progress" { continue; }
            assert_eq!(ev["type"], "loaded", "{ev}");
            return ev["pigeon"].as_u64().unwrap();
        }
    }

    /// Judges every frame with `in_flight` asks at once; (seconds, latencies ms).
    fn run(e: &Arc<Engine>, pigeon: u64, frames: &[Vec<u8>], in_flight: usize) -> (f64, Vec<u64>) {
        let t0 = Instant::now();
        let next = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let lat = Arc::new(Mutex::new(Vec::new()));
        let threads: Vec<_> = (0..in_flight)
            .map(|_| {
                let (e, next, lat, frames) = (e.clone(), next.clone(), lat.clone(), frames.to_vec());
                std::thread::spawn(move || loop {
                    let i = next.fetch_add(1, Ordering::Relaxed);
                    if i >= frames.len() { return; }
                    let (tx, rx) = mpsc::channel::<Value>();
                    let tx = Mutex::new(tx);
                    let t = Instant::now();
                    e.ask(&json!({ "pigeon": pigeon, "input": "What do you do next?", "frames": [{ "attachment": 0 }], "options": { "stream": false } }), vec![frames[i].clone()],
                        Sink::Callback(Arc::new(move |ev: &Value| { if ev["type"] != "piece" { let _ = tx.lock().unwrap().send(ev.clone()); } })));
                    let ev = rx.recv().unwrap();
                    assert_eq!(ev["type"], "answer", "{ev}");
                    lat.lock().unwrap().push(t.elapsed().as_millis() as u64);
                })
            })
            .collect();
        for t in threads { t.join().unwrap(); }
        let mut l = lat.lock().unwrap().clone();
        l.sort_unstable();
        (t0.elapsed().as_secs_f64(), l)
    }

    #[test]
    fn sixty_frames_one_lane_two_in_flight_and_two_lanes() {
        let (Some(models), Some(pigeon), Some(dir)) = (env("PIGEON_MODELS_DIR"), env("PIGEON_PLAY_PIGEON"), env("PIGEON_FRAMES_DIR")) else {
            eprintln!("skipped: set PIGEON_MODELS_DIR, PIGEON_PLAY_PIGEON and PIGEON_FRAMES_DIR");
            return;
        };
        let frames = frames(&dir);
        // `PIGEON_PLAY_ONLY`: one named row, so two processes can run the same
        // row side by side (two engines on one GPU).
        let only = std::env::var("PIGEON_PLAY_ONLY").ok();
        for (name, parallel, in_flight) in [("one lane, one at a time", 1, 1), ("one lane, two in flight", 1, 2), ("two lanes, two in flight", 2, 2), ("two lanes, four in flight", 2, 4)] {
            if only.as_deref().is_some_and(|o| o != name) { continue; }
            let e = Arc::new(engine(&models, parallel));
            let p = load(&e, &pigeon);
            // One frame first, off the clock: the base, projector and lane load.
            run(&e, p, &frames[..1], 1);
            let (secs, lat) = run(&e, p, &frames, in_flight);
            let mean = lat.iter().sum::<u64>() as f64 / lat.len() as f64;
            println!("{name:26} {:5.2} frames/s   ask→answer mean {mean:6.0} ms   p50 {:5} ms   p95 {:5} ms   prefix_tokens {}", frames.len() as f64 / secs, lat[lat.len() / 2], lat[lat.len() * 95 / 100], e.info()["bases"][0]["prefix_tokens"]);
            e.shutdown();
        }
    }
}
