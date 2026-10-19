//! pigeon-engine, in this process: every model the app asks.
//!
//! Patch's router and planner asks, the transcript tidier, Pen and Peek are
//! Pigeons in Patch's nest, loaded from it by member (`ask_patch`). A Pigeon
//! job (`pigeon_run`), a voice (`chat_complete` with a persona) and a picture
//! Pigeon at play (`play.rs`) are asked from the file this app kept at import
//! (`pigeons/<id>.pigeon`): the engine reads the file, never this app's
//! unpacked copies.
//!
//! The engine is made on first use and freed when the models sleep and when
//! the app quits (Metal aborts a process that exits holding GPU memory). The
//! first time llama.cpp's shaders are compiled on a Mac takes about 22 s, and
//! the page is told so while it happens (`engine-preparing`).

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, SystemTime};

use pigeon_engine::{Engine, Sink};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};

/// `{ "on": true }` while the engine is getting ready for the first time on
/// this Mac, `{ "on": false }` when it is ready.
pub const PREPARING: &str = "engine-preparing";
/// The engine's settings in this app (INTERFACE.md §5.1). Two contexts, each
/// as long as the server gives a voice, so a conversation that works with the
/// switch off still fits with it on: about 1.2 GB allocated per context.
const PARALLEL: usize = 2;
const CONTEXT_TOKENS: u32 = 8192;
const MAX_BASES: usize = 2;
/// E26's budget for kept prompts, per lane, in this app: three quarters of
/// the context. The engine's own default is 2,048, which is what Flight
/// School pins and what the engine's stamp says on its own; a Pen chat past
/// about 2,000 tokens of history was not kept at all under it and re-read
/// its whole history every turn. Kept cells are the cells the chat already
/// used, shared, so this costs no memory; a request that needs the room
/// takes it. The app's stamp names it (`prefix-cache 6144`), and the app's
/// numbers of record were measured again under it (NOTES, 2026-10-15).
const PREFIX_CACHE_TOKENS: u32 = 6144;
/// How long making the engine may take before the page says why.
const PREPARING_AFTER: Duration = Duration::from_millis(700);

#[derive(Default)]
pub struct InProcess {
    engine: Mutex<Option<Arc<Engine>>>,
    /// Pigeon numbers, by file (and nest member) and the file's modified
    /// time: a file imported again is loaded again.
    loaded: Mutex<HashMap<(PathBuf, Option<String>), (SystemTime, u64)>>,
}

/// The file this app kept for Pigeon `id`, if there is one: what the engine
/// is asked with.
pub fn wanted<R: tauri::Runtime>(app: &AppHandle<R>, id: &str) -> Option<PathBuf> {
    if !pigeon_core::plain_id(id) {
        return None;
    }
    let kept = crate::weights::app_subdir(app, "pigeons").ok()?.join(format!("{id}.pigeon"));
    kept.is_file().then_some(kept)
}

fn config<R: tauri::Runtime>(app: &AppHandle<R>) -> Result<Value, String> {
    let models = crate::weights::own_dir(app)?;
    let data = crate::weights::app_subdir(app, "")?;
    // The engine reads registries from files; this build's sealed one is
    // compiled in, so it is written beside the engine's other state.
    let registry = crate::weights::app_subdir(app, "engine")?.join("registry.zip");
    if std::fs::read(&registry).ok().as_deref() != Some(crate::pigeon::REGISTRY_ZIP) {
        std::fs::write(&registry, crate::pigeon::REGISTRY_ZIP).map_err(|e| format!("could not write the registry for the engine: {e}"))?;
    }
    let base_dirs = vec![models.clone()];
    Ok(json!({
        "base_dirs": base_dirs,
        "projector_dirs": [models.join("projectors")],
        "embedding_dirs": [models],
        "registries": [registry],
        "trusted_pigeon_keys": crate::pigeon::public_keys(&crate::pigeon::trusted_keys()),
        "trusted_registry_keys": crate::pigeon::public_keys(&crate::pigeon::registry_keys()),
        "hash_cache": data.join(crate::hashes::FILE),
        "max_bases_loaded": MAX_BASES,
        // E17: the person's sleep period, which the server watch used to apply.
        "idle_unload_s": app.try_state::<crate::engine::Engine>().and_then(|e| e.idle_period()).map_or(0, |d| d.as_secs()),
        "parallel": PARALLEL,
        "context_tokens": CONTEXT_TOKENS,
        "prefix_cache_tokens": PREFIX_CACHE_TOKENS,
    }))
}

impl InProcess {
    /// The engine, made on first use. Blocking: call off the async runtime.
    fn engine<R: tauri::Runtime>(&self, app: &AppHandle<R>) -> Result<Arc<Engine>, String> {
        let mut slot = self.engine.lock().map_err(|_| "the engine's lock is poisoned")?;
        if let Some(e) = slot.as_ref() {
            return Ok(e.clone());
        }
        let cfg = config(app)?;
        // llama.cpp compiles its Metal shaders the first time on a Mac, inside
        // Engine::new; macOS keeps them after. Only a slow start says so.
        let done = Arc::new(AtomicBool::new(false));
        let (d, a) = (done.clone(), app.clone());
        std::thread::spawn(move || {
            std::thread::sleep(PREPARING_AFTER);
            if !d.load(Ordering::SeqCst) {
                let _ = a.emit(PREPARING, json!({ "on": true }));
            }
        });
        let t0 = std::time::Instant::now();
        let made = Engine::new(&cfg.to_string());
        done.store(true, Ordering::SeqCst);
        let _ = app.emit(PREPARING, json!({ "on": false }));
        let e = Arc::new(made.map_err(|e| {
            crate::log::write("engine", &format!("would not start: {} {}", e["code"].as_str().unwrap_or(""), e["message"].as_str().unwrap_or("")));
            e["message"].as_str().unwrap_or("the engine would not start").to_string()
        })?);
        crate::log::write("engine", &format!("started in {} ms · {} · memory: {}", t0.elapsed().as_millis(), e.version(), crate::log::memory_now()));
        *slot = Some(e.clone());
        watch_idle(Arc::downgrade(&e));
        Ok(e)
    }

    /// Frees the engine and everything it loaded. Blocks until it is gone.
    pub fn sleep(&self) {
        let gone = self.engine.lock().ok().and_then(|mut e| e.take());
        if let Ok(mut l) = self.loaded.lock() {
            l.clear();
        }
        if let Some(e) = gone {
            let before = crate::log::footprint_mb();
            let held = bases(&e);
            e.shutdown();
            crate::log::write(
                "unload",
                &format!("engine freed ({}) · memory {}", names(&held), before_after(before, crate::log::footprint_mb())),
            );
        }
    }

    /// The engine's number for the Pigeon in `kept` (a member of it, when
    /// it is a nest), loading it if need be.
    fn number(&self, engine: &Engine, kept: &Path, member: Option<&str>) -> Result<u64, String> {
        let modified = std::fs::metadata(kept).and_then(|m| m.modified()).map_err(|e| e.to_string())?;
        let key = (kept.to_path_buf(), member.map(String::from));
        if let Some((m, n)) = self.loaded.lock().ok().and_then(|l| l.get(&key).copied()) {
            if m == modified {
                return Ok(n);
            }
            engine.unload(n);
        }
        let t0 = std::time::Instant::now();
        let ev = finish(|sink| {
            let mut req = json!({ "path": kept });
            if let Some(m) = member {
                req["member"] = m.into();
            }
            engine.load(&req, sink);
        })?;
        let who = who(kept, member);
        match ev["type"].as_str() {
            Some("loaded") => {
                let n = ev["pigeon"].as_u64().ok_or("the engine gave no number")?;
                crate::log::write("load", &format!("{who} as Pigeon {n} in {} ms", t0.elapsed().as_millis()));
                for w in ev["warnings"].as_array().into_iter().flatten() {
                    crate::log::write("warning", &format!("{who}: {} — {}", w["code"].as_str().unwrap_or("?"), w["message"].as_str().unwrap_or("")));
                }
                if let Ok(mut l) = self.loaded.lock() {
                    l.insert(key, (modified, n));
                }
                Ok(n)
            }
            _ => {
                crate::log::write("refusal", &format!("{who}: {} — {}", ev["code"].as_str().unwrap_or("?"), ev["message"].as_str().unwrap_or("")));
                Err(ev["message"].as_str().unwrap_or("the engine would not load this Pigeon").to_string())
            }
        }
    }
}

/// Where a request's `piece` events go while it is answered, when a caller
/// wants them (the transcript tidier shows its repair growing).
pub type OnPiece = Arc<dyn Fn(&str) + Send + Sync>;

/// Runs one engine call to its final event (`loaded`, `refused`, `answer`,
/// `error`), skipping `progress` and `piece`.
fn finish(start: impl FnOnce(Sink)) -> Result<Value, String> {
    finish_with(start, None)
}

/// The same, each `piece` handed to `on_piece` as it comes, in order.
fn finish_with(start: impl FnOnce(Sink), on_piece: Option<OnPiece>) -> Result<Value, String> {
    let (tx, rx) = mpsc::channel::<Value>();
    let tx = Mutex::new(tx);
    start(Sink::Callback(Arc::new(move |e: &Value| match e["type"].as_str() {
        Some("progress") => {}
        Some("piece") => {
            if let (Some(f), Some(text)) = (&on_piece, e["text"].as_str()) {
                f(text);
            }
        }
        _ => {
            if let Ok(t) = tx.lock() {
                let _ = t.send(e.clone());
            }
        }
    })));
    rx.recv_timeout(Duration::from_secs(300)).map_err(|_| "the engine did not answer".to_string())
}

/// Asks the Pigeon in `kept` with `request` (its `pigeon` filled in here) and
/// returns the engine's `answer` event, or the engine's error as text.
pub async fn ask<R: tauri::Runtime>(app: &AppHandle<R>, kept: &Path, request: Value, attachments: Vec<Vec<u8>>) -> Result<Value, String> {
    ask_in(app, kept, None, request, attachments, None).await
}

/// The same, with each `piece` handed to `on_piece` as the answer grows
/// (the request must ask for `stream`).
pub async fn ask_with<R: tauri::Runtime>(app: &AppHandle<R>, kept: &Path, request: Value, attachments: Vec<Vec<u8>>, on_piece: Option<OnPiece>) -> Result<Value, String> {
    ask_in(app, kept, None, request, attachments, on_piece).await
}

/// An `OnPiece` that emits each piece to the page as `event`, carrying the
/// number the page gave the request so several in flight stay apart, the
/// characters that just arrived, and `sofar`, the whole answer to here: a
/// page reads `sofar`, so an event it missed (its listener not yet
/// registered when the first came) costs it nothing.
pub fn emit_pieces<R: tauri::Runtime>(app: &AppHandle<R>, event: &'static str, piece: Option<u64>) -> Option<OnPiece> {
    let n = piece?;
    let app = app.clone();
    let sofar = Mutex::new(String::new());
    let f: OnPiece = Arc::new(move |text: &str| {
        let whole = match sofar.lock() {
            Ok(mut s) => { s.push_str(text); s.clone() }
            Err(_) => text.to_string(),
        };
        let _ = tauri::Emitter::emit(&app, event, json!({ "piece": n, "text": text, "sofar": whole }));
    });
    Some(f)
}

/// Asks one of Patch's Pigeons, by id, from his nest (D84), each `piece`
/// handed to `on_piece` as the answer grows when the request asks for
/// `stream`. An error names the Pigeon when his nest does not carry it.
pub async fn ask_patch_with<R: tauri::Runtime>(app: &AppHandle<R>, id: &str, request: Value, attachments: Vec<Vec<u8>>, on_piece: Option<OnPiece>) -> Result<Value, String> {
    let (nest, member) = crate::patch::pigeon_source(app, id).ok_or_else(|| format!("Patch's Pigeon \"{id}\" is not in his nest"))?;
    ask_in(app, &nest, Some(member), request, attachments, on_piece).await
}

async fn ask_in<R: tauri::Runtime>(app: &AppHandle<R>, kept: &Path, member: Option<String>, mut request: Value, attachments: Vec<Vec<u8>>, on_piece: Option<OnPiece>) -> Result<Value, String> {
    let (app, kept) = (app.clone(), kept.to_path_buf());
    tauri::async_runtime::spawn_blocking(move || {
        let me = app.state::<InProcess>();
        let engine = me.engine(&app)?;
        let (held, mem) = (bases(&engine), crate::log::footprint_mb());
        request["pigeon"] = me.number(&engine, &kept, member.as_deref())?.into();
        let ev = finish_with(|sink| {
            engine.ask(&request, attachments, sink);
        }, on_piece)?;
        let who = who(&kept, member.as_deref());
        log_base_changes(&held, &bases(&engine), mem, "on an ask");
        let st = &ev["stats"];
        match ev["type"].as_str() {
            Some("answer") => {
                crate::log::write(
                    "engine",
                    &format!(
                        "ask {who} · {} ms · prompt {} tokens ({} reused) · answer {} tokens",
                        st["total_ms"], st["prompt_tokens"], st["prompt_tokens_reused"].as_u64().unwrap_or(0), st["answer_tokens"]
                    ),
                );
                Ok(ev)
            }
            _ => {
                crate::log::write("refusal", &format!("ask {who}: {} — {}", ev["code"].as_str().unwrap_or("?"), ev["message"].as_str().unwrap_or("")));
                Err(ev["message"].as_str().unwrap_or("the engine could not answer").to_string())
            }
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Patch's three Pigeons a turn always asks, loaded ahead of the question:
/// someone is typing, so the base, the adapters and a lane's context are made
/// now rather than when Enter is pressed (after the idle unload, that is the
/// whole reload). Nothing is asked. Blocking: call off the async runtime.
pub fn warm_patch<R: tauri::Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    const FIRST: [&str; 3] = ["patch-router", "patch-asks", "patch-planner-trained"];
    let me = app.state::<InProcess>();
    let t0 = std::time::Instant::now();
    let (held, mem) = {
        let engine = me.engine(app)?;
        (bases(&engine), crate::log::footprint_mb())
    };
    let engine = me.engine(app)?;
    let mut warmed = Vec::new();
    for id in FIRST {
        let Some((nest, member)) = crate::patch::pigeon_source(app, id) else { continue };
        let n = me.number(&engine, &nest, Some(&member))?;
        engine.warm(n).map_err(|e| e["message"].as_str().unwrap_or("the engine could not warm").to_string())?;
        warmed.push(id);
    }
    let now = bases(&engine);
    if base_changes(&held, &now).0.is_empty() {
        return Ok(());
    }
    log_base_changes(&held, &now, mem, "warmed while typing");
    crate::log::write("engine", &format!("warm {} · {} ms", warmed.join(", "), t0.elapsed().as_millis()));
    Ok(())
}

// ── what the log says about the engine ────────────────────────────────────

/// "patch-router.pigeon" for a nest member, "pat-v2" for a kept file.
fn who(kept: &Path, member: Option<&str>) -> String {
    member.map(String::from).unwrap_or_else(|| kept.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default())
}

/// The bases the engine holds: file name and bytes in memory.
fn bases(engine: &Engine) -> Vec<(String, u64)> {
    engine.info()["bases"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|b| {
            let file = b["file"].as_str().unwrap_or("?");
            let name = Path::new(file).file_name().map_or(file.to_string(), |n| n.to_string_lossy().into_owned());
            (name, b["bytes_in_memory"].as_u64().unwrap_or(0))
        })
        .collect()
}

fn names(held: &[(String, u64)]) -> String {
    if held.is_empty() {
        return "no bases".into();
    }
    held.iter().map(|(n, b)| format!("{n} {} MB", b / (1024 * 1024))).collect::<Vec<_>>().join(", ")
}

fn before_after(before: Option<u64>, after: Option<u64>) -> String {
    let mb = |m: Option<u64>| m.map_or("unknown".into(), |m| format!("{m} MB"));
    format!("{} → {}", mb(before), mb(after))
}

/// Which bases came and went between two looks: (loaded, unloaded).
pub fn base_changes(before: &[(String, u64)], after: &[(String, u64)]) -> (Vec<(String, u64)>, Vec<(String, u64)>) {
    let has = |list: &[(String, u64)], n: &str| list.iter().any(|(m, _)| m == n);
    (
        after.iter().filter(|(n, _)| !has(before, n)).cloned().collect(),
        before.iter().filter(|(n, _)| !has(after, n)).cloned().collect(),
    )
}

fn log_base_changes(before: &[(String, u64)], after: &[(String, u64)], mem_before: Option<u64>, why: &str) {
    let (came, went) = base_changes(before, after);
    if came.is_empty() && went.is_empty() {
        return;
    }
    let mem = before_after(mem_before, crate::log::footprint_mb());
    if !came.is_empty() {
        crate::log::write("load", &format!("base {} {why} · memory {mem}", names(&came)));
    }
    if !went.is_empty() {
        crate::log::write("unload", &format!("base {} {why} · memory {mem}", names(&went)));
    }
}

/// How often the idle unload is looked for. The engine unloads on its own
/// and tells no one; the log learns of it by looking.
const IDLE_LOOK: Duration = Duration::from_secs(30);

/// While the engine is up, looks at its bases every 30 s and logs any that
/// went while nothing was asked: the idle unload, with memory before and after.
const SETTLE_LOOK: Duration = Duration::from_secs(5);
const SETTLE_TRIES: usize = 12;

/// Reads memory until two readings in a row differ by less than 8 MB, or
/// `tries` run out; the last reading.
pub fn settle(mut read: impl FnMut() -> Option<u64>, mut wait: impl FnMut(), tries: usize) -> Option<u64> {
    let mut prev = read();
    for _ in 0..tries {
        wait();
        let now = read();
        match (prev, now) {
            (Some(a), Some(b)) if a.abs_diff(b) < 8 => return now,
            _ => prev = now,
        }
    }
    prev
}

/// Holds the engine weakly: once it is freed, the watch ends.
fn watch_idle(engine: std::sync::Weak<Engine>) {
    let _ = std::thread::Builder::new().name("pigeon-idle-log".into()).spawn(move || {
        let mut last: Option<(Vec<(String, u64)>, Option<u64>)> = None;
        loop {
            std::thread::sleep(IDLE_LOOK);
            let Some(engine) = engine.upgrade() else { return };
            let now = (bases(&engine), crate::log::footprint_mb());
            drop(engine);
            if let Some((held, mem)) = &last {
                let (_, went) = base_changes(held, &now.0);
                if !went.is_empty() {
                    /* The engine frees a base's contexts a tick or two after
                       info() stops listing it (NOTES), so "after" is read once
                       memory stops falling, not at the moment it is noticed. */
                    let t0 = std::time::Instant::now();
                    let after = settle(crate::log::footprint_mb, || std::thread::sleep(SETTLE_LOOK), SETTLE_TRIES);
                    crate::log::write(
                        "unload",
                        &format!(
                            "idle unload: base {} · memory {} (settled {} s after it was noticed)",
                            names(&went),
                            before_after(*mem, after),
                            t0.elapsed().as_secs()
                        ),
                    );
                    last = Some((now.0, after));
                    continue;
                }
            }
            last = Some(now);
        }
    });
}

/// The picture inside a `data:image/…;base64,` URL the page sent.
pub fn picture_bytes(url: &str) -> Result<Vec<u8>, String> {
    let body = url.split_once(";base64,").map(|(_, b)| b).ok_or("that picture is not a data URL")?;
    unbase64(body).ok_or_else(|| "that picture did not arrive whole — try pasting it again".into())
}

fn unbase64(s: &str) -> Option<Vec<u8>> {
    let value = |c: u8| -> Option<u32> {
        Some(match c {
            b'A'..=b'Z' => c - b'A',
            b'a'..=b'z' => c - b'a' + 26,
            b'0'..=b'9' => c - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            _ => return None,
        } as u32)
    };
    let s = s.trim_end_matches('=').as_bytes();
    let mut out = Vec::with_capacity(s.len() * 3 / 4);
    for chunk in s.chunks(4) {
        let mut n = 0u32;
        for (i, &c) in chunk.iter().enumerate() {
            n |= value(c)? << (18 - 6 * i);
        }
        let bytes = [(n >> 16) as u8, (n >> 8) as u8, n as u8];
        match chunk.len() {
            4 => out.extend_from_slice(&bytes),
            3 => out.extend_from_slice(&bytes[..2]),
            2 => out.push(bytes[0]),
            _ => return None,
        }
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    #[test]
    fn base_changes_name_what_came_and_what_went() {
        let a = vec![("qwen3vl.gguf".to_string(), 10), ("qwen35.gguf".to_string(), 5)];
        let b = vec![("qwen3vl.gguf".to_string(), 12), ("other.gguf".to_string(), 7)];
        let (came, went) = super::base_changes(&a, &b);
        assert_eq!(came, vec![("other.gguf".to_string(), 7)]);
        assert_eq!(went, vec![("qwen35.gguf".to_string(), 5)]);
        assert_eq!(super::base_changes(&a, &a), (vec![], vec![]));
        assert_eq!(super::names(&[]), "no bases");
        assert_eq!(super::before_after(Some(500), None), "500 MB → unknown");
        // Memory falls for a few readings after an unload, then holds.
        let mut seq = vec![2220, 1400, 300, 70, 68].into_iter();
        let (mut waits, tries) = (0, 12);
        assert_eq!(super::settle(|| seq.next(), || waits += 1, tries), Some(68));
        assert_eq!(waits, 4);
        let mut falling = (0..).map(|i| Some(1000 - i * 50));
        assert_eq!(super::settle(|| falling.next().unwrap(), || {}, 3), Some(850), "gives up after its tries");
    }

    use super::*;

    /// Step 5, live: with the switch on, the app's own commands go through
    /// the engine — a job, a recipe, a grounded example with its own section
    /// (E15), a picture, a voice, and play's whole frames from Eye — in a data
    /// folder of the test's own. Needs real files:
    ///   PIGEON_QWEN3VL_PIGEONS=<dir>/qwen3vl-pigeons \
    ///   PIGEON_RIDES_DIR=<dir>/pigeon-engine-rides \
    ///   PIGEON_EYE_BIN=<pigeon-eye built from eye/Eye.swift> \
    ///   PIGEON_SEED_RUN_BOARD=<a 256-pixel Seed Run board> \
    ///   cargo test --lib -- --ignored --nocapture through_the_engine
    #[tokio::test]
    #[ignore]
    async fn jobs_voices_and_play_go_through_the_engine() {
        let var = |k: &str| std::env::var_os(k).map(PathBuf::from);
        let (Some(pigeons), Some(rides), Some(eye), Some(board)) = (var("PIGEON_QWEN3VL_PIGEONS"), var("PIGEON_RIDES_DIR"), var("PIGEON_EYE_BIN"), var("PIGEON_SEED_RUN_BOARD")) else {
            eprintln!("(skipped: set PIGEON_QWEN3VL_PIGEONS, PIGEON_RIDES_DIR, PIGEON_EYE_BIN, PIGEON_SEED_RUN_BOARD)");
            return;
        };
        let mut ctx = tauri::test::mock_context(tauri::test::noop_assets());
        ctx.config_mut().identifier = "mode.airoplane.pigeon.test-engine".into();
        let app = tauri::test::mock_builder()
            .manage(crate::engine::Engine::new())
            .manage(InProcess::default())
            .manage(crate::pigeon::HeldImports::default())
            .build(ctx)
            .expect("mock app");
        let app = app.handle().clone();
        let root = app.path().app_data_dir().unwrap();
        assert!(root.ends_with("mode.airoplane.pigeon.test-engine"));
        let _ = std::fs::remove_dir_all(&root);
        let real = PathBuf::from(std::env::var_os("HOME").unwrap()).join("Library/Application Support/mode.airoplane.pigeon/models");
        let own = crate::weights::own_dir(&app).unwrap();
        std::fs::create_dir_all(own.join("projectors")).unwrap();
        for f in ["Qwen3VL-2B-Instruct-Q4_K_M.gguf", "Qwen2.5-1.5B-Instruct-Q4_K_M.gguf", "nomic-embed-text-v1.5.Q8_0.gguf", "projectors/mmproj-Qwen3VL-2B-Instruct-Q8_0.gguf"] {
            std::os::unix::fs::symlink(real.join(f), own.join(f)).unwrap();
        }
        let installed = crate::pigeon::installed_bases(&app);
        for f in [pigeons.join("patch-motion.pigeon"), pigeons.join("icon-maker.pigeon"), pigeons.join("pat-v2.pigeon"), rides.join("seed-run-spike.pigeon"), rides.join("socratic-tutor-packed.pigeon")] {
            let out = crate::pigeon::add_path(&app, &installed, &f);
            assert!(matches!(out[0], crate::pigeon::ImportOutcome::Added { .. }), "{}: {out:?}", f.display());
        }
        let run = |id: &str, text: &str, image: Option<String>, example: bool| {
            crate::pigeon::pigeon_run(app.clone(), crate::pigeon::RunRequest { pigeon: id.into(), text: text.into(), image, example, expect: None })
        };

        let r = run("patch-motion", "come on Patch, ride the wind", None, false).await.unwrap();
        assert_eq!(r.text, r#"{"move":"glide"}"#, "its own example 001");
        let r = run("icon-maker", "Pigeon: Jolly Companion\nDoes: Finds the question hiding in an email.", None, false).await.unwrap();
        assert!(r.rendered.is_some(), "a recipe drawn: {:?} {:?}", r.text, r.render_error);
        let example = String::from_utf8(pigeon_core::zip_store::read(&std::fs::read(pigeons.join("pat-v2.pigeon")).unwrap(), "examples/001.txt").unwrap().unwrap()).unwrap();
        let r = run("pat-v2", &example, None, true).await.unwrap();
        assert!(!r.no_material && r.sections.len() == 1 && r.sections[0].ordinal == 43, "the example's own section, §43: {:?}", r.sections.iter().map(|s| s.ordinal).collect::<Vec<_>>());
        let url = format!("data:image/png;base64,{}", crate::capture::base64(&std::fs::read(&board).unwrap()));
        let r = run("seed-run-spike", "What do you do next?", Some(url), false).await.unwrap();
        assert_eq!(r.matched_label, Some(true), "a key, on the list: {}", r.text);

        // A voice: its file's system prompt, temperature and history.
        let reply = crate::chat::chat_complete(app.clone(), serde_json::from_value(json!({
            "messages": [{ "role": "user", "content": "my binary search returns -1 for a value I can see in the array" }],
            "persona": "socratic-tutor-packed",
        })).unwrap()).await.unwrap();
        eprintln!("voice: {:?} ({} tokens)", reply.text, reply.tokens);
        assert!(!reply.text.is_empty() && reply.persona.as_deref() == Some("socratic-tutor-packed"));

        // Play's path: Eye hands over whole frames, the engine cuts and asks.
        let dir = root.join("replay");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::copy(&board, dir.join("0001.png")).unwrap();
        let mut child = std::process::Command::new(&eye)
            .args(["replay", "--dir", &dir.to_string_lossy(), "--stack", "1", "--gap-ms", "0", "--max-side", "160", "--whole", "1"])
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .spawn()
            .unwrap();
        let mut out = std::io::BufReader::new(child.stdout.take().unwrap());
        let mut line = String::new();
        use std::io::{BufRead, Write};
        out.read_line(&mut line).unwrap();
        assert!(line.contains("\"ready\""), "{line}");
        let png = dir.join("f-0.png");
        writeln!(child.stdin.as_mut().unwrap(), "{}", json!({ "cmd": "frames", "out": [png] })).unwrap();
        line.clear();
        out.read_line(&mut line).unwrap();
        assert!(line.contains("\"frames\""), "{line}");
        let _ = child.kill();
        let frames = vec![std::fs::read(&png).unwrap()];
        let actions: Value = serde_json::from_slice(&pigeon_core::zip_store::read(&std::fs::read(rides.join("seed-run-spike.pigeon")).unwrap(), "actions.json").unwrap().unwrap()).unwrap();
        let shot = pigeon_engine::compose_frames(&actions["frames"], &frames).unwrap();
        assert_eq!(&shot[..2], &[0xFF, 0xD8]);
        let kept = wanted(&app, "seed-run-spike").unwrap();
        let ev = ask(&app, &kept, json!({ "input": "What do you do next?", "frames": [{ "attachment": 0 }] }), frames).await.unwrap();
        assert_eq!(ev["answer"]["kind"], "label", "{ev}");
        assert!(ev["answer"]["action"].is_object(), "and the key it presses: {ev}");

        app.state::<InProcess>().sleep();
        let _ = std::fs::remove_dir_all(&root);
    }

    /// D84 live: with the switch on, Lane A, the tidier, Pen and Peek are
    /// asked from Patch's nest (the checkout's pack/patch.nest). Needs the
    /// nest (`node scripts/pack-patch.mjs --nest-only`), Qwen3-VL 2B and its
    /// projector in the app's models folder, and Qwen3.5 2B in Loft's:
    ///   PIGEON_SEED_RUN_BOARD=<a picture> cargo test --lib -- --ignored --nocapture from_patchs_nest
    #[tokio::test]
    #[ignore]
    async fn lane_a_pen_and_peek_are_asked_from_patchs_nest() {
        let Some(board) = std::env::var_os("PIGEON_SEED_RUN_BOARD").map(PathBuf::from) else {
            eprintln!("(skipped: set PIGEON_SEED_RUN_BOARD)");
            return;
        };
        let mut ctx = tauri::test::mock_context(tauri::test::noop_assets());
        ctx.config_mut().identifier = "mode.airoplane.pigeon.test-nest".into();
        let app = tauri::test::mock_builder()
            .manage(crate::engine::Engine::new())
            .manage(InProcess::default())
            .manage(crate::patch::PatchState::default())
            .build(ctx)
            .expect("mock app");
        let app = app.handle().clone();
        let root = app.path().app_data_dir().unwrap();
        let _ = std::fs::remove_dir_all(&root);
        let real = PathBuf::from(std::env::var_os("HOME").unwrap()).join("Library/Application Support/mode.airoplane.pigeon/models");
        let own = crate::weights::own_dir(&app).unwrap();
        std::fs::create_dir_all(own.join("projectors")).unwrap();
        for f in ["Qwen3VL-2B-Instruct-Q4_K_M.gguf", "projectors/mmproj-Qwen3VL-2B-Instruct-Q8_0.gguf"] {
            std::os::unix::fs::symlink(real.join(f), own.join(f)).unwrap();
        }
        crate::patch::select_at_launch(&app);
        crate::patch::wait_settled(&app, Duration::from_secs(60)).await;
        let status = app.state::<crate::patch::PatchState>().status();
        assert_eq!(status.state, "ready", "{status:?}");
        assert_eq!(status.pigeons.as_ref().map(Vec::len), Some(14), "{status:?}");
        // A wake starts nothing: the one model ready, no process, the engine named.
        let woke = crate::engine::engine_wake(app.clone()).await.unwrap();
        assert_eq!(woke.category.phase, crate::engine::Phase::Ready, "{:?}", woke.category.detail);
        assert!(woke.category.pid.is_none(), "a server was started");
        assert_eq!(woke.binary.source, Some(crate::engine::BinarySource::InProcess));
        assert!(woke.peek.is_some(), "Peek can run from the nest");

        let ask = |id: &str, input: &str, values: Option<Value>, n: u32| {
            crate::complete_in_engine(&app, crate::PigeonAsk { id: id.into(), input: input.into(), values }, Some(n))
        };
        let r = ask("patch-router", "convert 5 miles to km", None, 12).await.unwrap();
        assert_eq!(r.text, "conversion");
        assert!(r.confidence.is_some_and(|c| c > 0.8), "{:?}", r.confidence);
        let r = ask("patch-asks", "he made a hash of the presentation", None, 6).await.unwrap();
        assert!(r.text == "YES" || r.text == "NO", "{}", r.text);
        let input = "TODAY\n2026-09-01 (Tuesday), timezone UTC, locale en-GB.\n\nSKILLS\nconvertLength — Convert a length between units.\n  needs: amount: number, from: string, to: string\n\nMESSAGE\nconvert 5 miles to km";
        // The trained planner in a v7 nest, the prompted one in a v6 nest.
        let r = match ask("patch-planner-trained", input, Some(json!({ "steps[].skill": ["convertLength"] })), 200).await {
            Ok(r) => r,
            Err(_) => ask("patch-planner", input, Some(json!({ "steps[].skill": ["convertLength"] })), 200).await.unwrap(),
        };
        let plan: Value = serde_json::from_str(&r.text).expect("a plan");
        assert!(plan["steps"].as_array().unwrap().iter().all(|s| s["skill"] == "convertLength"), "{plan}");
        assert!(ask("pen", "hello", None, 9).await.err().is_some_and(|e| e.contains("not one of the Pigeons")), "Pen has his own door");

        let tidy = crate::task::task_complete(app.clone(), serde_json::from_value(json!({ "task": "transcript-repair", "text": "so we met on tuesday and. the budget was. fine" })).unwrap()).await.unwrap();
        assert_eq!(tidy.adapter, "tidier");
        assert!(!tidy.text.is_empty());

        let chat = |v: Value| crate::chat::chat_complete(app.clone(), serde_json::from_value(v).unwrap());
        let pen = chat(json!({ "messages": [{ "role": "system", "content": "page rules" }, { "role": "user", "content": "what is 3 + 4" }, { "role": "user", "content": "say hello in one word" }] })).await.unwrap();
        assert!(!pen.text.is_empty() && pen.persona.is_none(), "{:?}", pen.text);
        let url = format!("data:image/png;base64,{}", crate::capture::base64(&std::fs::read(&board).unwrap()));
        let peek = chat(json!({ "messages": [{ "role": "user", "content": "What is in this picture?" }], "peek": true, "image": url })).await.unwrap();
        assert!(!peek.text.is_empty(), "peek with a picture");
        let words = chat(json!({ "messages": [{ "role": "user", "content": "What is in this picture?" }, { "role": "assistant", "content": peek.text }, { "role": "user", "content": "what colour is it" }], "peek": true })).await.unwrap();
        eprintln!("router ok · plan {plan} · tidy {:?}\npen {:?}\npeek {:?}\npeek-words {:?}", tidy.text, pen.text, peek.text, words.text);
        let info = app.state::<InProcess>().engine(&app).unwrap().info();
        let ids: Vec<&str> = info["pigeons"].as_array().unwrap().iter().filter_map(|p| p["id"].as_str()).collect();
        for id in ["patch-router", "patch-asks", "patch-planner", "tidier", "pen", "peek", "peek-words"] {
            assert!(ids.contains(&id), "info() shows {id}: {ids:?}");
        }

        app.state::<InProcess>().sleep();
        let _ = std::fs::remove_dir_all(&root);
    }

    /// Live: Pen's reply reaches the page as `chat-piece` events while it is
    /// written, each carrying the whole text so far. Needs Patch's nest and
    /// Qwen3-VL 2B in the app's models folder:
    ///   cargo test --lib -- --ignored --nocapture pen_streams
    #[tokio::test]
    #[ignore]
    async fn pen_streams_his_reply_as_chat_pieces() {
        let mut ctx = tauri::test::mock_context(tauri::test::noop_assets());
        ctx.config_mut().identifier = "mode.airoplane.pigeon.test-stream".into();
        let app = tauri::test::mock_builder()
            .manage(crate::engine::Engine::new())
            .manage(InProcess::default())
            .manage(crate::patch::PatchState::default())
            .build(ctx)
            .expect("mock app");
        let app = app.handle().clone();
        let root = app.path().app_data_dir().unwrap();
        let _ = std::fs::remove_dir_all(&root);
        let real = PathBuf::from(std::env::var_os("HOME").unwrap()).join("Library/Application Support/mode.airoplane.pigeon/models");
        let own = crate::weights::own_dir(&app).unwrap();
        std::fs::create_dir_all(own.join("projectors")).unwrap();
        for f in ["Qwen3VL-2B-Instruct-Q4_K_M.gguf", "projectors/mmproj-Qwen3VL-2B-Instruct-Q8_0.gguf"] {
            std::os::unix::fs::symlink(real.join(f), own.join(f)).unwrap();
        }
        crate::patch::select_at_launch(&app);
        crate::patch::wait_settled(&app, Duration::from_secs(60)).await;
        let got: Arc<Mutex<Vec<Value>>> = Arc::new(Mutex::new(Vec::new()));
        let g = got.clone();
        tauri::Listener::listen_any(&app, crate::chat::PIECE_EVENT, move |e| {
            if let Ok(v) = serde_json::from_str::<Value>(e.payload()) {
                g.lock().unwrap().push(v);
            }
        });
        let req: crate::chat::ChatRequest = serde_json::from_value(json!({
            "messages": [{ "role": "user", "content": "Tell me, in three or four sentences, what a pigeon is." }],
            "piece": 7, "max_tokens": 120
        })).unwrap();
        let reply = crate::chat::chat_complete(app.clone(), req).await.unwrap();
        let events = got.lock().unwrap().clone();
        eprintln!("{} pieces for {} tokens: {:?}", events.len(), reply.tokens, reply.text);
        assert!(events.len() >= 10, "pieces came as the reply was written: {}", events.len());
        assert!(events.iter().all(|e| e["piece"] == 7));
        let last = events.last().unwrap();
        assert_eq!(last["sofar"].as_str().unwrap().trim(), reply.text.trim(), "the last sofar is the reply");
        let lens: Vec<usize> = events.iter().map(|e| e["sofar"].as_str().unwrap().len()).collect();
        assert!(lens.windows(2).all(|w| w[1] >= w[0]), "sofar only grows: {lens:?}");
        app.state::<InProcess>().sleep();
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn base64_round_trips_with_the_apps_encoder() {
        for bytes in [&b""[..], b"f", b"fo", b"foo", b"foob", b"fooba", b"foobar", &[0, 255, 7, 128, 1]] {
            assert_eq!(unbase64(&crate::capture::base64(bytes)).as_deref(), Some(bytes));
        }
        assert_eq!(picture_bytes("data:image/png;base64,Zm9v").unwrap(), b"foo");
        assert!(picture_bytes("data:image/png;base64,Zm9v!").is_err());
        assert!(picture_bytes("Zm9v").is_err());
    }

}
