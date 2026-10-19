//! E26 against real weights: every answer the same with prefix reuse on and
//! off, reuse actually happening on, and nothing reused off. Patch's asks
//! check and router take turns in one lane (so two Pigeons keep prompts side
//! by side), and Peek is asked about a picture twice (only text before a
//! picture is ever shared, and Peek has none).
//!
//!     PIGEON_MODELS_DIR=<bases, projectors/> PIGEON_PREFIX_NEST=<patch.nest> \
//!     PIGEON_PREFIX_PICTURE=<a png> cargo test -p pigeon-engine --release --test prefix_reuse -- --nocapture
//!
//! Skipped unless the first two are set.

use std::path::PathBuf;
use std::sync::{mpsc, Arc, Mutex};

use pigeon_engine::{Engine, Sink};
use serde_json::{json, Value};

const MESSAGES: [&str; 12] = [
    "convert 5 miles to km", "my morse code is rusty", "what is 15% off 80", "tell me about magnesium",
    "write me a short poem about the sea", "how many days until christmas", "i need to compress my schedule this week",
    "split an 84.50 bill 4 ways", "the whole project is an anagram of chaos", "what changed between the old and new version",
    "round 3.14159 to two places", "settle this: pineapple on pizza, yes or no",
];

fn events() -> (Sink, mpsc::Receiver<Value>) {
    let (tx, rx) = mpsc::channel();
    let tx = Mutex::new(tx);
    (Sink::Callback(Arc::new(move |e: &Value| { let _ = tx.lock().unwrap().send(e.clone()); })), rx)
}

fn last(rx: &mpsc::Receiver<Value>) -> Value {
    loop {
        let ev = rx.recv().unwrap();
        if !matches!(ev["type"].as_str(), Some("progress") | Some("piece")) {
            return ev;
        }
    }
}

fn load(e: &Engine, nest: &PathBuf, member: &str) -> u64 {
    let (sink, rx) = events();
    e.load(&json!({ "path": nest, "member": member }), sink);
    let ev = last(&rx);
    assert_eq!(ev["type"], "loaded", "{ev}");
    ev["pigeon"].as_u64().unwrap()
}

fn ask(e: &Engine, req: Value, attachments: Vec<Vec<u8>>) -> Value {
    let (sink, rx) = events();
    e.ask(&req, attachments, sink);
    let ev = last(&rx);
    assert_eq!(ev["type"], "answer", "{ev}");
    ev
}

/// (Pigeon, raw answer, tokens reused) for every ask, in order; and info.
fn ride(models: &PathBuf, nest: &PathBuf, picture: Option<&[u8]>, prefix: u32) -> (Vec<(String, String, u64)>, Value) {
    let cfg = json!({ "base_dirs": [models], "projector_dirs": [models.join("projectors")], "context_tokens": 4096, "prefix_cache_tokens": prefix });
    let e = Engine::new(&cfg.to_string()).unwrap();
    let asks = load(&e, nest, "patch-asks.pigeon");
    let router = load(&e, nest, "patch-router.pigeon");
    let mut out = Vec::new();
    for m in MESSAGES {
        for (name, p) in [("asks", asks), ("router", router)] {
            let ev = ask(&e, json!({ "pigeon": p, "input": m }), Vec::new());
            out.push((name.to_string(), ev["raw"].as_str().unwrap().to_string(), ev["stats"]["prompt_tokens_reused"].as_u64().unwrap()));
        }
    }
    if let Some(png) = picture {
        let peek = load(&e, nest, "peek.pigeon");
        for q in ["What is the total?", "What is the first line?"] {
            // Peek's file says 0.7, so two rides of his never match on their
            // own; at 0 (E4) the comparison is of reuse, not of the sampler.
            let ev = ask(&e, json!({ "pigeon": peek, "input": q, "picture": { "attachment": 0 }, "options": { "temperature": 0 } }), vec![png.to_vec()]);
            out.push(("peek".into(), ev["raw"].as_str().unwrap().to_string(), ev["stats"]["prompt_tokens_reused"].as_u64().unwrap()));
        }
    }
    let info = e.info();
    (out, info)
}

#[test]
fn answers_are_the_same_with_prefix_reuse_on_and_off() {
    let var = |k: &str| std::env::var_os(k).map(PathBuf::from);
    let (Some(models), Some(nest)) = (var("PIGEON_MODELS_DIR"), var("PIGEON_PREFIX_NEST")) else {
        eprintln!("skipped: set PIGEON_MODELS_DIR and PIGEON_PREFIX_NEST");
        return;
    };
    let png = var("PIGEON_PREFIX_PICTURE").and_then(|p| std::fs::read(p).ok());
    let (off, _) = ride(&models, &nest, png.as_deref(), 0);
    let (on, info) = ride(&models, &nest, png.as_deref(), 2048);
    assert_eq!(off.len(), on.len());
    for ((who, a, r_off), (_, b, r_on)) in off.iter().zip(&on) {
        println!("{who:7} reused {r_on:4} (off {r_off}): {}", b.replace('\n', " "));
        assert_eq!(a, b, "{who}: an answer changed with reuse on");
        assert_eq!(*r_off, 0, "off reuses nothing");
    }
    // After each Pigeon's first ask, every ask shares its system prompt and shots.
    let reused = |who: &str| on.iter().filter(|x| x.0 == who).map(|x| x.2).collect::<Vec<_>>();
    let asks = reused("asks");
    assert_eq!(asks[0], 0, "nothing kept before the first ask");
    assert!(asks[1..].iter().all(|&n| n >= 800), "the asks check shares its ~900-token prefix: {asks:?}");
    let router = reused("router");
    assert!(router[1..].iter().all(|&n| n >= 16), "the router shares its prefix: {router:?}");
    // Peek has no system prompt: his prompt opens with the picture, so there is
    // nothing before it to share, and reuse rightly takes nothing.
    if png.is_some() {
        assert_eq!(reused("peek"), [0, 0], "Peek has no text before his picture");
    }
    let kept = info["bases"][0]["prefix_tokens"].as_u64().unwrap();
    println!("info: prefix_tokens {kept}, bytes_in_memory {}", info["bases"][0]["bytes_in_memory"]);
    assert!(kept > 0 && kept <= 2048, "{info}");
}

/// Two lanes, two Pigeons asked at the same time from two threads, in
/// whatever order the threads happen to arrive: every ask after a Pigeon's
/// first still finds its kept prompt. A lane keeps prompts for itself, so
/// this holds only because `place` prefers, among idle lanes, the one that
/// keeps this Pigeon's prompt; with "the first idle lane" an ask that arrived
/// second one round and first the next read its whole prompt again.
#[test]
fn an_ask_finds_its_kept_prompt_whichever_lane_is_idle_first() {
    let var = |k: &str| std::env::var_os(k).map(PathBuf::from);
    let (Some(models), Some(nest)) = (var("PIGEON_MODELS_DIR"), var("PIGEON_PREFIX_NEST")) else {
        eprintln!("skipped: set PIGEON_MODELS_DIR and PIGEON_PREFIX_NEST");
        return;
    };
    let cfg = json!({ "base_dirs": [models], "projector_dirs": [models.join("projectors")], "context_tokens": 4096, "parallel": 2 });
    let e = Arc::new(Engine::new(&cfg.to_string()).unwrap());
    let asks = load(&e, &nest, "patch-asks.pigeon");
    let router = load(&e, &nest, "patch-router.pigeon");
    let one = |e: Arc<Engine>, p: u64, who: &'static str, lead_ms: u64| {
        std::thread::spawn(move || {
            let mut reused = Vec::new();
            for (i, m) in MESSAGES.iter().enumerate() {
                // The two threads trade places as first to arrive.
                std::thread::sleep(std::time::Duration::from_millis(if i % 2 == 0 { lead_ms } else { 20 - lead_ms }));
                let ev = ask(&e, json!({ "pigeon": p, "input": m }), Vec::new());
                reused.push(ev["stats"]["prompt_tokens_reused"].as_u64().unwrap());
            }
            (who, reused)
        })
    };
    let a = one(e.clone(), asks, "asks", 0);
    let r = one(e.clone(), router, "router", 15);
    let (a, r) = (a.join().unwrap().1, r.join().unwrap().1);
    println!("asks reused {a:?}\nrouter reused {r:?}");
    let (queued, running, lanes) = (e.info()["queued"].clone(), e.info()["running"].clone(), e.info()["bases"][0]["contexts"].clone());
    println!("lanes {lanes}, queued {queued}, running {running}");
    assert_eq!(lanes, 2, "both lanes were made");
    assert!(a[1..].iter().all(|&n| n >= 800), "the asks check found its ~900-token prefix every time: {a:?}");
    assert!(r[1..].iter().all(|&n| n >= 16), "the router found its prefix every time: {r:?}");
    e.shutdown();
}
