//! Rides through the whole engine, against real weights and real exam sets.
//! Skipped (and passing) unless these are set:
//!
//!   PIGEON_MODELS_DIR       the folder holding Qwen3VL-2B-Instruct-Q4_K_M.gguf,
//!                           with the projector in projectors/
//!   PIGEON_RIDES_DIR        the folder holding seed-run-spike.pigeon
//!   PIGEON_SEED_RUN_HOLDOUT the Seed Run holdout (200 boards)
//!   PIGEON_QWEN3VL_PIGEONS  (one test) the folder holding seed-run-v2.pigeon,
//!                           which carries its projector

use std::path::PathBuf;
use std::sync::{mpsc, Arc, Mutex};

use pigeon_engine::{Engine, Sink};
use serde_json::{json, Value};

struct Here {
    models: PathBuf,
    pigeon: PathBuf,
    rows: Vec<Value>,
}

fn here() -> Option<Here> {
    let var = |k: &str| std::env::var_os(k).map(PathBuf::from);
    let (Some(models), Some(rides), Some(holdout)) = (var("PIGEON_MODELS_DIR"), var("PIGEON_RIDES_DIR"), var("PIGEON_SEED_RUN_HOLDOUT")) else {
        eprintln!("PIGEON_MODELS_DIR, PIGEON_RIDES_DIR and PIGEON_SEED_RUN_HOLDOUT not all set: skipping");
        return None;
    };
    let rows = std::fs::read_to_string(holdout).ok()?.lines().filter(|l| !l.trim().is_empty()).filter_map(|l| serde_json::from_str(l).ok()).collect();
    Some(Here { models, pigeon: rides.join("seed-run-spike.pigeon"), rows })
}

fn engine(h: &Here, grammar_first: bool) -> Engine {
    let cfg = json!({ "base_dirs": [h.models], "projector_dirs": [h.models.join("projectors")], "context_tokens": 4096, "grammar_first_always": grammar_first });
    Engine::new(&cfg.to_string()).unwrap()
}

fn events() -> (Sink, mpsc::Receiver<Value>) {
    let (tx, rx) = mpsc::channel();
    let tx = Mutex::new(tx);
    (Sink::Callback(Arc::new(move |e: &Value| { let _ = tx.lock().unwrap().send(e.clone()); })), rx)
}

fn load(e: &Engine, path: &PathBuf) -> u64 {
    let (sink, rx) = events();
    e.load(&json!({ "path": path }), sink);
    loop {
        let ev = rx.recv().unwrap();
        match ev["type"].as_str() {
            Some("progress") => continue,
            Some("loaded") => return ev["pigeon"].as_u64().unwrap(),
            _ => panic!("{ev}"),
        }
    }
}

/// Every row, four at a time; the label each was answered with.
fn ride(e: &Engine, pigeon: u64, rows: &[Value]) -> Vec<String> {
    let mut out = vec![String::new(); rows.len()];
    for group in (0..rows.len()).collect::<Vec<_>>().chunks(4) {
        let rxs: Vec<(usize, mpsc::Receiver<Value>)> = group
            .iter()
            .map(|&i| {
                let (sink, rx) = events();
                e.ask(&json!({ "pigeon": pigeon, "input": rows[i]["question"], "picture": { "path": rows[i]["image"] }, "options": { "stream": false } }), Vec::new(), sink);
                (i, rx)
            })
            .collect();
        for (i, rx) in rxs {
            let ev = rx.recv().unwrap();
            assert_eq!(ev["type"], "answer", "{ev}");
            out[i] = ev["answer"]["value"].as_str().unwrap_or("(off contract)").to_string();
        }
    }
    out
}

#[test]
fn checking_the_greedy_pick_first_gives_the_same_labels_as_the_grammar_first_on_all_200_boards() {
    let Some(h) = here() else { return };
    let fast = {
        let e = engine(&h, false);
        let p = load(&e, &h.pigeon);
        ride(&e, p, &h.rows)
    };
    let full = {
        let e = engine(&h, true);
        let p = load(&e, &h.pigeon);
        ride(&e, p, &h.rows)
    };
    assert_eq!(fast.len(), 200);
    let differ: Vec<usize> = (0..fast.len()).filter(|&i| fast[i] != full[i]).collect();
    assert!(differ.is_empty(), "rows that differ: {differ:?}");
    let right = fast.iter().zip(&h.rows).filter(|(a, r)| Some(a.as_str()) == r["answer"].as_str()).count();
    assert_eq!(right, 168, "the spike's score on these files (higher is better)");
}

#[test]
fn info_says_what_is_loaded_and_shutdown_frees_it() {
    let Some(h) = here() else { return };
    let e = engine(&h, false);
    let p = load(&e, &h.pigeon);
    let info = e.info();
    assert_eq!(info["version"], "libpigeon 0.1.0 (llama.cpp 26394b4; spec 1)");
    assert_eq!(info["bases"][0]["file"], "Qwen3VL-2B-Instruct-Q4_K_M.gguf");
    assert_eq!(info["bases"][0]["pigeons"], json!([p]));
    assert_eq!(info["pigeons"][0]["picture_tokens"], 64, "counted by the projector at load");
    e.shutdown();
    assert_eq!(e.info()["bases"], json!([]));
}

/// The quit crash: Metal asserts at process exit when GPU memory is still
/// held. Run in a child process, since the failure is the process ending.
#[test]
fn a_loaded_engine_is_dropped_without_a_crash_at_exit() {
    const CHILD: &str = "PIGEON_ENGINE_DROP_CHILD";
    if let Ok(how) = std::env::var(CHILD) {
        let h = here().unwrap();
        // Four contexts at once: shutdown must outlast every lane's thread.
        let cfg = json!({ "base_dirs": [h.models], "projector_dirs": [h.models.join("projectors")], "context_tokens": 4096, "parallel": 4 });
        let e = Engine::new(&cfg.to_string()).unwrap();
        let p = load(&e, &h.pigeon);
        let q = load(&e, &h.pigeon);
        let rxs: Vec<_> = (0..8)
            .map(|i| {
                let (sink, rx) = events();
                let row = &h.rows[i];
                e.ask(&json!({ "pigeon": if i % 2 == 0 { p } else { q }, "input": row["question"], "picture": { "path": row["image"] } }), Vec::new(), sink);
                rx
            })
            .collect();
        for rx in rxs {
            while rx.recv().unwrap()["type"] == "piece" {}
        }
        if how == "leak" {
            std::mem::forget(e);
        } else {
            drop(e);
        }
        std::process::exit(0);
    }
    if here().is_none() {
        return;
    }
    let run = |how: &str| {
        std::process::Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "a_loaded_engine_is_dropped_without_a_crash_at_exit", "--test-threads=1", "--nocapture"])
            .env(CHILD, how)
            .output()
            .unwrap()
    };
    let dropped = run("drop");
    assert!(dropped.status.success(), "dropping a loaded engine, then exiting: {}", String::from_utf8_lossy(&dropped.stderr));
    let leaked = run("leak");
    assert!(!leaked.status.success(), "the control: exiting with the engine still loaded must fail, or this test proves nothing");
    assert!(String::from_utf8_lossy(&leaked.stderr).contains("GGML_ASSERT"));
}

/// E14: a projector only inside the file is refused for the host to install.
#[test]
fn a_projector_carried_only_in_the_file_is_refused_with_no_projector() {
    let (Some(h), Some(dir)) = (here(), std::env::var_os("PIGEON_QWEN3VL_PIGEONS").map(PathBuf::from)) else { return };
    let empty = std::env::temp_dir().join(format!("pigeon-engine-no-projectors-{}", std::process::id()));
    std::fs::create_dir_all(&empty).unwrap();
    let cfg = json!({ "base_dirs": [h.models], "projector_dirs": [empty], "context_tokens": 4096 });
    let e = Engine::new(&cfg.to_string()).unwrap();
    let (sink, rx) = events();
    e.load(&json!({ "path": dir.join("seed-run-v2.pigeon") }), sink);
    let ev = loop {
        let ev = rx.recv().unwrap();
        if ev["type"] != "progress" {
            break ev;
        }
    };
    let _ = std::fs::remove_dir(&empty);
    assert_eq!(ev["type"], "refused", "{ev}");
    assert_eq!(ev["code"], "no_projector");
    assert_eq!(ev["carried"], true);
    assert_eq!(ev["needs"]["file"], "mmproj-Qwen3VL-2B-Instruct-Q8_0.gguf");
    assert_eq!(ev["needs"]["identity"]["arch"], "qwen3vl");
}

/// E15: Pat's own check rides, each asked with the section its maker's test
/// gave it, answer as that test's llama.cpp did at least as often as when
/// the engine searched (16/17 and 12/13 of the rows it searched right).
#[test]
fn pats_check_rides_with_their_own_sections_given_match_the_makers_answers() {
    let (Some(h), Some(dir)) = (here(), std::env::var_os("PIGEON_QWEN3VL_PIGEONS").map(PathBuf::from)) else { return };
    let cfg = json!({ "base_dirs": [h.models], "projector_dirs": [h.models.join("projectors")], "embedding_dirs": [h.models], "context_tokens": 4096 });
    let e = Engine::new(&cfg.to_string()).unwrap();
    for (file, floor) in [("pat---local-draft.pigeon", 16), ("pat-v2.pigeon", 12)] {
        let path = dir.join(file);
        let p = load(&e, &path);
        let bytes = std::fs::read(&path).unwrap();
        let entries = pigeon_core::zip_store::list_entries(&bytes).unwrap();
        let get = |n: &str| pigeon_core::zip_store::get(&entries, &bytes, n).unwrap().unwrap();
        let index: pigeon_core::material::ChunkIndex = serde_json::from_slice(get("material/chunks.json")).unwrap();
        let report: Value = serde_json::from_slice(get("report.json")).unwrap();
        let rows = report["check_ride"]["rows"].as_array().unwrap();
        let mut same = 0;
        for row in rows {
            let (chunk, q) = pigeon_core::material::split_carried(&index, row["question"].as_str().unwrap()).expect("each row carries its section");
            let (sink, rx) = events();
            e.ask(&json!({ "pigeon": p, "input": q, "sections": [chunk.ordinal], "options": { "stream": false } }), Vec::new(), sink);
            let ev = rx.recv().unwrap();
            assert_eq!(ev["sections_given"], true, "{ev}");
            assert_eq!(ev["sections"][0]["ordinal"], chunk.ordinal);
            same += usize::from(ev["raw"] == row["actual"]);
        }
        eprintln!("{file}: {same}/{} the same as its maker's ride", rows.len());
        assert!(same >= floor, "{file}: {same}/{}", rows.len());
    }
    // A section the file does not have is the caller's mistake.
    let p = load(&e, &dir.join("pat-v2.pigeon"));
    let (sink, rx) = events();
    e.ask(&json!({ "pigeon": p, "input": "x", "sections": [9999] }), Vec::new(), sink);
    assert_eq!(rx.recv().unwrap()["code"], "bad_request");
}

/// E12 through the engine: the size to capture, then frames at that size
/// answered as a picture; a frame captured too large is the host's mistake.
#[test]
fn capture_for_then_frames_is_answered_and_an_oversized_frame_is_refused() {
    let Some(h) = here() else { return };
    let e = engine(&h, false);
    let p = load(&e, &h.pigeon);
    let ask = |req: Value, attachments: Vec<Vec<u8>>| {
        let (sink, rx) = events();
        e.ask(&req, attachments, sink);
        loop {
            let ev = rx.recv().unwrap();
            if ev["type"] != "piece" {
                break ev;
            }
        }
    };
    let plan = ask(json!({ "pigeon": p, "input": "", "capture_for": { "width": 256, "height": 256 } }), Vec::new());
    assert_eq!(plan["capture"], json!({ "width": 194, "height": 194 }), "seed-run's crop and max_side 160: {plan}");
    assert!(plan.get("answer").is_none());
    let frame: Vec<u8> = (0..194 * 194).flat_map(|i| [(i % 251) as u8, 90, 140, 255]).collect();
    let ev = ask(json!({ "pigeon": p, "input": "", "frames": [{ "attachment": 0, "raw": { "width": 194, "height": 194, "format": "rgba8" } }] }), vec![frame]);
    assert_eq!(ev["type"], "answer", "{ev}");
    assert_eq!(ev["answer"]["kind"], "label", "constrained to the labels: {ev}");
    let big = std::fs::read(h.rows[0]["image"].as_str().unwrap()).unwrap();
    let ev = ask(json!({ "pigeon": p, "input": "", "frames": [{ "attachment": 0 }] }), vec![big.clone()]);
    assert_eq!(ev["code"], "bad_request", "a 256-pixel board keeps 211 pixels, past max_side 160: {ev}");
    let ev = ask(json!({ "pigeon": p, "input": "", "frames": [{ "attachment": 0 }, { "attachment": 0 }] }), vec![big]);
    assert_eq!(ev["code"], "bad_request", "stack is 1: {ev}");
}

/// Section 4, as the spike measured it: a long answer streams, a cancel sent
/// at 400 ms stops it within a token, and the next request is answered as
/// before. Also: a cancelled request that never started ends at once, and
/// cancelling a finished or unknown request does nothing.
#[test]
fn streaming_and_cancel() {
    let (Some(h), Some(dir)) = (here(), std::env::var_os("PIGEON_QWEN3VL_PIGEONS").map(PathBuf::from)) else { return };
    let cfg = json!({ "base_dirs": [h.models], "projector_dirs": [h.models.join("projectors")], "embedding_dirs": [h.models], "context_tokens": 4096 });
    let e = Engine::new(&cfg.to_string()).unwrap();
    let board = load(&e, &h.pigeon);
    // pat-v2's check-ride row 1 runs to its full 172 tokens: a long answer.
    let pat_path = dir.join("pat-v2.pigeon");
    let pat = load(&e, &pat_path);
    let bytes = std::fs::read(&pat_path).unwrap();
    let entries = pigeon_core::zip_store::list_entries(&bytes).unwrap();
    let get = |n: &str| pigeon_core::zip_store::get(&entries, &bytes, n).unwrap().unwrap();
    let index: pigeon_core::material::ChunkIndex = serde_json::from_slice(get("material/chunks.json")).unwrap();
    let report: Value = serde_json::from_slice(get("report.json")).unwrap();
    let (chunk, q) = pigeon_core::material::split_carried(&index, report["check_ride"]["rows"][1]["question"].as_str().unwrap()).unwrap();
    let long = json!({ "pigeon": pat, "input": q, "sections": [chunk.ordinal], "options": { "stream": true } });

    // `after`: when to cancel, counted from the ask, or from the first piece.
    let run = |after_ms: u128, from_first_piece: bool| {
        let (sink, rx) = events();
        let t = std::time::Instant::now();
        let id = e.ask(&long, Vec::new(), sink);
        let (mut pieces, mut first_ms, mut text, mut cancelled_at) = (0, None::<u128>, String::new(), None::<u128>);
        let answer = loop {
            match rx.recv_timeout(std::time::Duration::from_millis(2)) {
                Ok(ev) if ev["type"] == "piece" => {
                    pieces += 1;
                    first_ms.get_or_insert(t.elapsed().as_millis());
                    text.push_str(ev["text"].as_str().unwrap());
                }
                Ok(ev) => break ev,
                Err(_) => {}
            }
            let due = if from_first_piece { first_ms.map(|f| f + after_ms) } else { Some(after_ms) };
            if cancelled_at.is_none() && due.is_some_and(|d| t.elapsed().as_millis() >= d) {
                e.cancel(id);
                cancelled_at = Some(t.elapsed().as_millis());
            }
        };
        let stopped = t.elapsed().as_millis();
        let at = cancelled_at.expect("still running when the cancel was due");
        eprintln!(
            "first piece {} ms; cancel sent {at} ms; answer {stopped} ms ({} ms after the cancel); {pieces} pieces, {} tokens; stopped {}",
            first_ms.unwrap_or(0),
            stopped - at,
            answer["stats"]["answer_tokens"],
            answer["stopped"]
        );
        assert_eq!(answer["stopped"], "cancelled");
        assert_eq!(answer["raw"].as_str().unwrap(), text.trim(), "the pieces are the raw answer");
        (id, stopped - at)
    };
    // While generating, a cancel stops it within a token.
    let (id, late) = run(400, true);
    assert!(late < 40, "stopped {late} ms after the cancel");
    // During the prompt's own decode, it stops when that decode ends: one
    // decode cannot be interrupted on Metal (llama.cpp's abort callback is CPU
    // only). Reported, not held to a number.
    run(400, false);
    e.cancel(id);
    e.cancel(987_654);

    // The next request answers exactly as before the cancel.
    let rows = &h.rows[..1];
    assert_eq!(ride(&e, board, rows), vec!["KEY(Up)".to_string()]);

    // Queued behind three long answers in one context, then cancelled: it
    // ends at once, never having started.
    let cfg = json!({ "base_dirs": [h.models], "projector_dirs": [h.models.join("projectors")], "embedding_dirs": [h.models], "context_tokens": 4096, "parallel": 1 });
    let e1 = Engine::new(&cfg.to_string()).unwrap();
    let n1 = load(&e1, &pat_path);
    let mut long1 = long.clone();
    long1["pigeon"] = n1.into();
    let busy: Vec<_> = (0..4).map(|_| { let (s, r) = events(); e1.ask(&long1, Vec::new(), s); r }).collect();
    let (s, r) = events();
    let waiting = e1.ask(&long1, Vec::new(), s);
    std::thread::sleep(std::time::Duration::from_millis(50));
    e1.cancel(waiting);
    let ev = r.recv().unwrap();
    assert_eq!(ev["stopped"], "cancelled", "{ev}");
    assert_eq!(ev["stats"]["answer_tokens"], 0);
    for r in busy {
        while r.recv().unwrap()["type"] == "piece" {}
    }
}

/// Section 5: `info` says what is loaded, and a base past `max_bases_loaded`
/// unloads the one used longest ago, whose Pigeons keep their numbers and
/// load again when next asked. Needs PIGEON_OTHER_BASE_PIGEON: a Pigeon on
/// another base (the app's note-to-title, on Qwen2.5 1.5B).
#[test]
fn a_base_past_max_bases_loaded_unloads_the_one_used_longest_ago() {
    let (Some(h), Some(other)) = (here(), std::env::var_os("PIGEON_OTHER_BASE_PIGEON").map(PathBuf::from)) else { return };
    let cfg = json!({ "base_dirs": [h.models], "projector_dirs": [h.models.join("projectors")], "context_tokens": 4096, "max_bases_loaded": 1 });
    let e = Engine::new(&cfg.to_string()).unwrap();
    let board = load(&e, &h.pigeon);
    let files = |e: &Engine| e.info()["bases"].as_array().unwrap().iter().map(|b| b["file"].as_str().unwrap().to_string()).collect::<Vec<_>>();
    assert_eq!(files(&e), vec!["Qwen3VL-2B-Instruct-Q4_K_M.gguf"]);
    let info = e.info();
    assert!(info["bases"][0]["bytes_in_memory"].as_u64().unwrap() > 1_000_000_000);
    assert_eq!(info["bases"][0]["projector"], "mmproj-Qwen3VL-2B-Instruct-Q8_0.gguf");
    let title = load(&e, &other);
    assert_eq!(files(&e), vec![other_base(&other)], "the first base went when the second came");
    let info = e.info();
    let p = info["pigeons"].as_array().unwrap();
    assert!(p.iter().any(|x| x["pigeon"] == board && x["loaded"] == false), "{info}");
    assert!(p.iter().any(|x| x["pigeon"] == title && x["loaded"] == true), "{info}");
    // Its number still works: asked again, it loads again, and answers as before.
    assert_eq!(ride(&e, board, &h.rows[..1]), vec!["KEY(Up)".to_string()]);
    assert_eq!(files(&e), vec!["Qwen3VL-2B-Instruct-Q4_K_M.gguf"]);
    // With the default of two, both stay.
    let e2 = engine(&h, false);
    load(&e2, &h.pigeon);
    load(&e2, &other);
    assert_eq!(e2.info()["bases"].as_array().unwrap().len(), 2);
}

fn other_base(path: &PathBuf) -> String {
    let bytes = std::fs::read(path).unwrap();
    let m: Value = serde_json::from_slice(&pigeon_core::zip_store::read(&bytes, "pigeon.json").unwrap().unwrap()).unwrap();
    m["base_model"]["file"].as_str().unwrap().to_string()
}

/// `info` counts what llama.cpp allocated (weights, projector, every
/// context's cache and working buffers), and `memory_limit_bytes` is judged
/// against that: a second context that would not fit is not made; the second
/// Pigeon runs as a guest in the first instead. A limit below one base is
/// `out_of_memory`.
#[test]
fn the_memory_limit_is_judged_on_what_llama_cpp_allocated() {
    let Some(h) = here() else { return };
    let rides = PathBuf::from(std::env::var_os("PIGEON_RIDES_DIR").unwrap());
    let cfg = |limit: u64| json!({ "base_dirs": [h.models], "projector_dirs": [h.models.join("projectors")], "context_tokens": 8192, "parallel": 2, "memory_limit_bytes": limit }).to_string();
    let e = Engine::new(&cfg(4_000_000_000)).unwrap();
    let board = load(&e, &h.pigeon);
    let notes = load(&e, &rides.join("note-to-title-spike.pigeon"));
    ride(&e, board, &h.rows[..1]);
    let one = e.info()["bases"][0]["bytes_in_memory"].as_u64().unwrap();
    eprintln!("one base, projector and one 8192-cell context: {} MB", one >> 20);
    assert!(one > 3_000_000_000, "{one}: weights 1.1 GB + projector ~0.8 GB + context 1.2 GB");
    // Two Pigeons at once: a second context (1.2 GB) would pass 4 GB, so
    // the second Pigeon joins the first context as a guest.
    let (s1, r1) = events();
    let (s2, r2) = events();
    e.ask(&json!({ "pigeon": notes, "input": "groceries for the week, milk eggs bread" }), Vec::new(), s1);
    e.ask(&json!({ "pigeon": board, "input": "", "picture": { "path": h.rows[1]["image"] } }), Vec::new(), s2);
    for r in [r1, r2] {
        while r.recv().unwrap()["type"] == "piece" {}
    }
    assert_eq!(e.info()["bases"][0]["contexts"], 1);
    drop(e);
    let tiny = Engine::new(&cfg(500_000_000)).unwrap();
    let (sink, rx) = events();
    tiny.load(&json!({ "path": h.pigeon }), sink);
    let ev = loop {
        let ev = rx.recv().unwrap();
        if ev["type"] != "progress" {
            break ev;
        }
    };
    assert_eq!(ev["code"], "out_of_memory", "{ev}");
}

/// D83: a base Pigeon is the base with nothing attached. Asked in the same
/// context straight after a Pigeon that wears an adapter, it answers exactly
/// as it does in a fresh engine that never loaded one, and the adapter
/// Pigeon still answers as before.
#[test]
fn a_base_pigeon_wears_no_adapter_even_after_one_that_does() {
    let Some(h) = here() else { return };
    let rides = PathBuf::from(std::env::var_os("PIGEON_RIDES_DIR").unwrap());
    let notes = rides.join("note-to-title-spike.pigeon");
    // note-to-title's own manifest, with base_only and no adapter.
    let bytes = std::fs::read(&notes).unwrap();
    let mut m: Value = serde_json::from_slice(&pigeon_core::zip_store::read(&bytes, "pigeon.json").unwrap().unwrap()).unwrap();
    m["id"] = "plain-base".into();
    m["base_only"] = true.into();
    let manifest = m.to_string();
    let dir = std::env::temp_dir().join(format!("base-pigeon-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let plain = dir.join("plain-base.pigeon");
    std::fs::write(&plain, pigeon_core::zip_store::test_support::build_store_zip(&[("pigeon.json", manifest.as_bytes())])).unwrap();

    let ride = |e: &Engine, pigeon: u64| {
        let (sink, rx) = events();
        e.ask(&json!({ "pigeon": pigeon, "input": "groceries for the week, milk eggs bread", "options": { "stream": false } }), Vec::new(), sink);
        let ev = rx.recv().unwrap();
        assert_eq!(ev["type"], "answer", "{ev}");
        ev["raw"].as_str().unwrap().to_string()
    };
    let cfg = json!({ "base_dirs": [h.models], "context_tokens": 4096, "parallel": 1 }).to_string();
    let fresh = Engine::new(&cfg).unwrap();
    let alone = ride(&fresh, load(&fresh, &plain));
    drop(fresh);

    let e = Engine::new(&cfg).unwrap();
    let titled = load(&e, &notes);
    let base = load(&e, &plain);
    let first = ride(&e, titled);
    assert_eq!(ride(&e, base), alone, "the base Pigeon wore the adapter left on the context");
    assert_eq!(ride(&e, titled), first, "the adapter Pigeon changed after the base Pigeon ran");
    assert_ne!(first, alone, "the adapter makes no difference here, so this proves nothing");
    let _ = std::fs::remove_dir_all(&dir);
}

/// E17: a base nobody has asked for `idle_unload_s` is unloaded, `info` says
/// so, and the next ask loads it again and answers as before.
#[test]
fn an_idle_base_is_unloaded_and_the_next_ask_loads_it_again() {
    let Some(h) = here() else { return };
    let rides = PathBuf::from(std::env::var_os("PIGEON_RIDES_DIR").unwrap());
    let cfg = json!({ "base_dirs": [h.models], "context_tokens": 4096, "idle_unload_s": 2 }).to_string();
    let e = Engine::new(&cfg).unwrap();
    let notes = load(&e, &rides.join("note-to-title-spike.pigeon"));
    let ask = |e: &Engine| {
        let (sink, rx) = events();
        e.ask(&json!({ "pigeon": notes, "input": "groceries for the week, milk eggs bread", "options": { "stream": false } }), Vec::new(), sink);
        let ev = rx.recv().unwrap();
        assert_eq!(ev["type"], "answer", "{ev}");
        ev["raw"].as_str().unwrap().to_string()
    };
    let first = ask(&e);
    let info = e.info();
    assert_eq!(info["idle_unload_s"], 2);
    assert_eq!(info["bases"].as_array().unwrap().len(), 1, "{info}");
    assert!(info["bases"][0]["idle_s"].as_u64().unwrap() < 2);
    // Asked again inside the period: still loaded.
    std::thread::sleep(std::time::Duration::from_millis(1200));
    assert_eq!(ask(&e), first);
    std::thread::sleep(std::time::Duration::from_millis(1200));
    assert_eq!(e.info()["bases"].as_array().unwrap().len(), 1, "asked 1.2 s ago, so not idle yet");
    // Then nobody asks.
    let t = std::time::Instant::now();
    while !e.info()["bases"].as_array().unwrap().is_empty() {
        assert!(t.elapsed().as_secs() < 10, "the idle base was never unloaded");
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
    let info = e.info();
    assert_eq!(info["pigeons"][0]["loaded"], false, "{info}");
    // The next ask loads it again and answers the same.
    assert_eq!(ask(&e), first);
    assert_eq!(e.info()["bases"].as_array().unwrap().len(), 1);
}

/// D86, D88, E20, E21: a base Pigeon with fixed turns and a schema whose
/// field the host fills per ask. The answer keeps to the host's list and
/// carries the lists it was held to as `host_values`; a field the file does
/// not name is `host_values_unnamed`; a missing list and a label that is not
/// the file's are `bad_request`.
#[test]
fn host_values_hold_the_answer_to_the_hosts_list() {
    let Some(h) = here() else { return };
    let dir = std::env::temp_dir().join(format!("host-values-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let base = r#""base_model":{"file":"Qwen3VL-2B-Instruct-Q4_K_M.gguf","arch":"qwen3vl","name":"qwen3vl","size":"2B","finetune":"instruct","vision":false}"#;
    let pick = format!(r#"{{"format_version":1,"name":"Pick","id":"pick","kind":"extractor","base_only":true,{base},
        "prompt_template":"{{input}}","inputs":["text"],"output_contract":{{"type":"json","max_tokens":40,"constrained":true,
        "host_values":["skill"],"output_schema":{{"type":"object","properties":{{"skill":{{"type":"string"}}}},"required":["skill"],"additionalProperties":false}}}}}}"#);
    let shots = br#"[{"user":"add 2 and 3","pigeon":"{\"skill\":\"sum\"}"}]"#;
    let yes = format!(r#"{{"format_version":1,"name":"Asks","id":"asks","kind":"classifier","base_only":true,{base},
        "prompt_template":"Is this a question? {{input}}","inputs":["text"],"output_contract":{{"type":"label","max_tokens":4,"constrained":true,"host_values":["label"]}}}}"#);
    let write = |name: &str, entries: &[(&str, &[u8])]| {
        let p = dir.join(name);
        std::fs::write(&p, pigeon_core::zip_store::test_support::build_store_zip(entries)).unwrap();
        p
    };
    let pick = write("pick.pigeon", &[("pigeon.json", pick.as_bytes()), ("system_prompt.txt", b"Name the skill."), ("shots.json", shots)]);
    let yes = write("asks.pigeon", &[("pigeon.json", yes.as_bytes()), ("labels.txt", b"YES\nNO\n")]);
    let e = Engine::new(&json!({ "base_dirs": [h.models], "context_tokens": 4096 }).to_string()).unwrap();
    let (pick, yes) = (load(&e, &pick), load(&e, &yes));
    let ask = |mut req: Value| {
        req["options"] = json!({ "stream": false });
        let (sink, rx) = events();
        e.ask(&req, Vec::new(), sink);
        rx.recv().unwrap()
    };
    let ev = ask(json!({ "pigeon": pick, "input": "multiply 4 by 5", "values": { "skill": ["product", "quotient"] } }));
    assert_eq!(ev["type"], "answer", "{ev}");
    assert!(["product", "quotient"].contains(&ev["answer"]["value"]["skill"].as_str().unwrap()), "{ev}");
    assert_eq!(ev["answer"]["host_values"], json!({ "skill": ["product", "quotient"] }), "E21: inside the answer");
    assert!(ev.get("values_given").is_none());
    // Held to one value, it can only say that one.
    let ev = ask(json!({ "pigeon": pick, "input": "multiply 4 by 5", "values": { "skill": ["reverse"] } }));
    assert_eq!(ev["answer"]["value"], json!({ "skill": "reverse" }), "{ev}");
    for bad in [json!({ "pigeon": pick, "input": "x" }), json!({ "pigeon": pick, "input": "x", "values": { "skill": [] } }),
                json!({ "pigeon": yes, "input": "x", "values": { "label": ["MAYBE"] } })] {
        assert_eq!(ask(bad.clone())["code"], "bad_request", "{bad}");
    }
    // E21, spec D91: values for a field the file does not name.
    let unnamed = ask(json!({ "pigeon": pick, "input": "x", "values": { "skill": ["a"], "other": ["b"] } }));
    assert_eq!(unnamed["code"], "host_values_unnamed", "{unnamed}");
    let ev = ask(json!({ "pigeon": yes, "input": "what time is it", "values": { "label": ["NO"] } }));
    assert_eq!(ev["answer"]["value"], "NO", "{ev}");
    assert!(ev["confidence"].as_f64().is_some(), "a label answer carries its confidence (E18)");
    let _ = std::fs::remove_dir_all(&dir);
}
