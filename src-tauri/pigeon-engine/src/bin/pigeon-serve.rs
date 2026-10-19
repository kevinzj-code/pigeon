//! For benches only: the engine behind one loopback HTTP endpoint, so a
//! Node bench can ask Pigeons the way the app does with the switch on.
//!
//!   pigeon-serve --nest <patch.nest> [--models <dir>] [--port 8150] [--context 8192]
//!                [--parallel 1] [--max-bases 2] [--idle <seconds>] [--prefix-cache <cells>, 0 = off]
//!                [--log <file>: every ask and its raw answer, one JSON line each]
//!
//! `GET /info` answers the engine's `info()`, and `POST /ask` may carry a
//! `picture` path (Peek).
//!
//! `POST /ask` with `{ "id", "input", "values"?, "max_tokens"? }` asks the
//! nest's member whose id that is and answers `{ "text", "confidence",
//! "tokens", "prompt_tokens", "prompt_tokens_reused", "host_values", "stopped" }`, or `{ "error" }`.
//! `GET /health` answers once the engine is made. Loopback only. Each
//! connection is served on its own thread, so a bench that asks several
//! pieces at once (the transcript bench, as the app's tidier does) reaches
//! the engine's own batching; a bench that asks one at a time is unchanged.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpListener;
use std::path::PathBuf;
use std::sync::{mpsc, Arc, Mutex};

use pigeon_engine::{Engine, Sink};
use serde_json::{json, Value};

fn finish(start: impl FnOnce(Sink)) -> Value {
    let (tx, rx) = mpsc::channel::<Value>();
    let tx = Mutex::new(tx);
    start(Sink::Callback(Arc::new(move |e: &Value| {
        if !matches!(e["type"].as_str(), Some("progress") | Some("piece")) {
            let _ = tx.lock().map(|t| t.send(e.clone()));
        }
    })));
    rx.recv().unwrap_or(json!({ "type": "error", "message": "the engine stopped" }))
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let opt = |k: &str| args.iter().position(|a| a == k).and_then(|i| args.get(i + 1)).cloned();
    let nest = PathBuf::from(opt("--nest").expect("--nest <patch.nest>"));
    let home = std::env::var("HOME").unwrap_or_default();
    let models = opt("--models").map(PathBuf::from).unwrap_or_else(|| PathBuf::from(&home).join("Library/Application Support/mode.airoplane.pigeon/models"));
    let port = opt("--port").unwrap_or_else(|| "8150".into());
    let context: u32 = opt("--context").and_then(|c| c.parse().ok()).unwrap_or(8192);
    let parallel: usize = opt("--parallel").and_then(|c| c.parse().ok()).unwrap_or(1);
    let max_bases: usize = opt("--max-bases").and_then(|c| c.parse().ok()).unwrap_or(2);
    let idle: u64 = opt("--idle").and_then(|c| c.parse().ok()).unwrap_or(0);
    // E26: cells per context for kept prompts; 0 is off. Absent: the engine's default.
    let prefix: Option<u64> = opt("--prefix-cache").and_then(|c| c.parse().ok());
    // Every ask and its raw answer, one JSON line each, for comparing runs.
    let log = opt("--log").map(PathBuf::from);
    let bases = vec![models.clone()];
    let mut cfg = json!({ "base_dirs": bases, "projector_dirs": [models.join("projectors")], "embedding_dirs": [models], "context_tokens": context,
                      "parallel": parallel, "max_bases_loaded": max_bases, "idle_unload_s": idle });
    if let Some(n) = prefix {
        cfg["prefix_cache_tokens"] = n.into();
    }
    let engine = Arc::new(Engine::new(&cfg.to_string()).unwrap_or_else(|e| panic!("{e}")));

    // Members by id, from each member's own manifest.
    /* Mapped, not read: only the directories and each member's pigeon.json
       are looked at here, and a read kept the whole nest counted as dirty
       after it was freed (NOTES, v10's idle footprint). */
    let bytes = pigeon_core::blob::Blob::open(&nest).expect("the nest");
    let members: HashMap<String, String> = pigeon_core::nest::members(&bytes)
        .expect("a nest")
        .into_iter()
        .filter_map(|(file, inner)| {
            let raw = pigeon_core::zip_store::read(inner, "pigeon.json").ok()??;
            let m: Value = serde_json::from_slice(&raw).ok()?;
            let id = m["id"].as_str()?.to_string();
            (m["kind"] != "skillpack").then_some((id, file))
        })
        .collect();
    let loaded: Arc<Mutex<HashMap<String, u64>>> = Arc::new(Mutex::new(HashMap::new()));
    let members = Arc::new(members);
    let nest = Arc::new(nest);
    let log = Arc::new(Mutex::new(log));

    let listener = TcpListener::bind(format!("127.0.0.1:{port}")).expect("the port");
    eprintln!("pigeon-serve on 127.0.0.1:{port}, {} Pigeons in {}", members.len(), nest.display());
    for stream in listener.incoming().flatten() {
        let (engine, nest, members, loaded, log) = (engine.clone(), nest.clone(), members.clone(), loaded.clone(), log.clone());
        std::thread::spawn(move || serve(stream, &engine, &nest, &members, &loaded, &log));
    }
}

fn serve(stream: std::net::TcpStream, engine: &Engine, nest: &PathBuf, members: &HashMap<String, String>, loaded: &Mutex<HashMap<String, u64>>, log: &Mutex<Option<PathBuf>>) {
    {
        let mut reader = BufReader::new(stream.try_clone().expect("stream"));
        let mut line = String::new();
        if reader.read_line(&mut line).is_err() {
            return;
        }
        let mut length = 0usize;
        loop {
            let mut h = String::new();
            if reader.read_line(&mut h).is_err() || h.trim().is_empty() {
                break;
            }
            if let Some(v) = h.to_ascii_lowercase().strip_prefix("content-length:") {
                length = v.trim().parse().unwrap_or(0);
            }
        }
        let mut body = vec![0u8; length];
        let _ = reader.read_exact(&mut body);
        let reply = if line.starts_with("GET /health") {
            json!({ "status": "ok" })
        } else if line.starts_with("GET /info") {
            engine.info()
        } else if line.starts_with("POST /ask") {
            let req: Value = serde_json::from_slice(&body).unwrap_or(Value::Null);
            let answer = ask(engine, nest, members, loaded, req.clone());
            if let Ok(guard) = log.lock() {
                if let Some(path) = guard.as_ref() {
                    use std::io::Write as _;
                    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
                        let _ = writeln!(f, "{}", json!({ "id": req["id"], "input": req["input"], "values": req["values"], "text": answer["text"], "error": answer["error"], "prompt_tokens": answer["prompt_tokens"], "prompt_tokens_reused": answer["prompt_tokens_reused"] }));
                    }
                }
            }
            answer
        } else {
            json!({ "error": "unknown path" })
        };
        let text = reply.to_string();
        let mut out = stream;
        let _ = write!(out, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{text}", text.len());
    }
}

fn ask(engine: &Engine, nest: &PathBuf, members: &HashMap<String, String>, loaded: &Mutex<HashMap<String, u64>>, req: Value) -> Value {
    let Some(id) = req["id"].as_str() else { return json!({ "error": "id is required" }) };
    let Some(member) = members.get(id) else { return json!({ "error": format!("no Pigeon {id} in the nest") }) };
    // Loaded once however many ask at once: the map is held through the load.
    let n = {
        let mut held = loaded.lock().unwrap_or_else(|p| p.into_inner());
        match held.get(id) {
            Some(n) => *n,
            None => {
                let ev = finish(|sink| {
                    engine.load(&json!({ "path": nest, "member": member }), sink);
                });
                let Some(n) = ev["pigeon"].as_u64().filter(|_| ev["type"] == "loaded") else { return json!({ "error": ev }) };
                held.insert(id.to_string(), n);
                n
            }
        }
    };
    let mut request = json!({ "pigeon": n, "input": req["input"], "options": { "stream": false } });
    if let Some(m) = req["max_tokens"].as_u64() {
        request["options"]["max_tokens"] = m.into();
    }
    if !req["values"].is_null() {
        request["values"] = req["values"].clone();
    }
    if let Some(p) = req["picture"].as_str() {
        request["picture"] = json!({ "path": p });
    }
    let ev = finish(|sink| {
        engine.ask(&request, Vec::new(), sink);
    });
    if ev["type"] != "answer" {
        return json!({ "error": ev["message"] });
    }
    json!({ "text": ev["raw"], "confidence": ev["confidence"], "tokens": ev["stats"]["answer_tokens"], "prompt_tokens": ev["stats"]["prompt_tokens"], "prompt_tokens_reused": ev["stats"]["prompt_tokens_reused"], "host_values": ev["answer"]["host_values"], "stopped": ev["stopped"] })
}
