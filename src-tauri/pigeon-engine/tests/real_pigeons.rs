//! Every real Pigeon loaded through the engine: checked, its base found, its
//! adapter attached, and its `prompt_check` proven against the base's own
//! template, with a picture's `N` counted by the projector (spec §8.6).
//!
//!     PIGEON_MODELS_DIR=<folder of bases, projectors in projectors/> \
//!     PIGEON_PIGEONS_DIR=<folder of .pigeon files>[:<another>…] \
//!     [PIGEON_EXPECT_REFUSED=<file>:<code>,…] \
//!     cargo test -p pigeon-engine --release --test real_pigeons -- --nocapture
//!
//! A file named in PIGEON_EXPECT_REFUSED must be refused with that code; any
//! other refusal or error fails the test. Skipped unless both folders are set.

use std::path::PathBuf;
use std::sync::{mpsc, Arc, Mutex};

use pigeon_engine::{Engine, Sink};
use serde_json::{json, Value};

#[test]
fn every_real_pigeon_loads_with_its_prompt_proven() {
    let (Some(models), Some(dirs)) = (std::env::var_os("PIGEON_MODELS_DIR").map(PathBuf::from), std::env::var_os("PIGEON_PIGEONS_DIR")) else {
        eprintln!("skipped: set PIGEON_MODELS_DIR and PIGEON_PIGEONS_DIR");
        return;
    };
    let expect: Vec<(String, String)> = std::env::var("PIGEON_EXPECT_REFUSED")
        .unwrap_or_default()
        .split(',')
        .filter_map(|x| x.split_once(':').map(|(f, c)| (f.trim().to_string(), c.trim().to_string())))
        .collect();
    let mut files: Vec<PathBuf> = std::env::split_paths(&dirs)
        .flat_map(|d| std::fs::read_dir(d).into_iter().flatten().flatten().map(|e| e.path()))
        .filter(|p| p.extension().is_some_and(|x| x == "pigeon"))
        .collect();
    files.sort();
    assert!(!files.is_empty(), "no .pigeon files in PIGEON_PIGEONS_DIR");
    let cfg = json!({ "base_dirs": [models], "projector_dirs": [models.join("projectors")], "embedding_dirs": [models], "context_tokens": 4096 });
    let engine = Engine::new(&cfg.to_string()).unwrap();
    let mut failed = Vec::new();
    for path in &files {
        let name = path.file_name().unwrap().to_string_lossy().into_owned();
        let (tx, rx) = mpsc::channel();
        let tx = Mutex::new(tx);
        engine.load(&json!({ "path": path }), Sink::Callback(Arc::new(move |e: &Value| { let _ = tx.lock().unwrap().send(e.clone()); })));
        let ev = loop {
            let ev: Value = rx.recv().unwrap();
            if ev["type"] != "progress" {
                break ev;
            }
        };
        let got = match ev["type"].as_str() {
            Some("loaded") => "loaded".to_string(),
            _ => ev["code"].as_str().unwrap_or("?").to_string(),
        };
        let wanted = expect.iter().find(|(f, _)| *f == name).map(|(_, c)| c.as_str()).unwrap_or("loaded");
        let n = engine.info()["pigeons"].as_array().and_then(|a| a.last().cloned()).and_then(|p| p["picture_tokens"].as_u64());
        eprintln!("{name}\t{got}{}{}", n.map(|n| format!("\tN = {n}, counted")).unwrap_or_default(), ev.get("position").map(|p| format!("\tat byte {p}")).unwrap_or_default());
        if got != wanted {
            failed.push(format!("{name}: {got}, wanted {wanted}: {ev}"));
        }
    }
    assert!(failed.is_empty(), "{} of {} Pigeons:\n  {}", failed.len(), files.len(), failed.join("\n  "));
}
