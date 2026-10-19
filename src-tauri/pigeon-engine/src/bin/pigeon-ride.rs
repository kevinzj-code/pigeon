//! Asks every row of a holdout through the engine and prints the score.
//!
//!   pigeon-ride [options] <file.pigeon>=<holdout.jsonl>[=<earlier ride>] …
//!   pigeon-ride [options] --own <file.pigeon> …
//!
//! A holdout row is `{ "question", "answer", "image"?, "max_tokens"?, "values"?, "temperature"?, "history"?, "sections"? }`;
//! `history` (E3, E19) and `sections` (E15) go to the engine as they are (E25). Given several
//! Pigeons, their rows are interleaved in proportion, the way the engine spike
//! rode a picture set and a text set together. An earlier ride (a JSON file
//! with `answers: [...]`, or `rows: [{ "actual" }]`) is compared row by row.
//!
//! `--own` rides what a Pigeon carries: its `examples/` (each against its
//! `.expected.txt`), then its `report.json` check ride (each against what
//! that ride's runtime answered). A grounded row that already carries its
//! section is asked with the question alone, and the section the engine's
//! retrieval chose is compared with the one carried.
//!
//! `own:<file.pigeon>` rides one Pigeon that way among holdout rides.
//!
//! Options:
//!   --models <dir>     bases and embedding models here, projectors in <dir>/projectors
//!                      (default: the Pigeon app's)
//!   --parallel <n>     contexts per base (default 1)
//!   --at-once <n>      requests in flight (default 1)
//!   --context <n>      cells per context (default 4096)
//!   --limit <n>        first n rows of each set
//!   --grammar-first    apply the grammar to the whole vocabulary every step
//!   --given            ask grounded rows with their carried sections (E15)
//!   --streams          each Pigeon asks its rows one after another, all
//!                      Pigeons at once (instead of --at-once)
//!   --hash-cache <f>   keep model hashes here between rides (E11)
//!   --prefix-cache <n> cells per context for kept prompts (E26; default the
//!                      engine's, 2048; 0 turns prefix reuse off)
//!   --out <file>       write every answer as JSON
//!   --hold <seconds>   afterwards, print info() and the process id, and keep
//!                      everything loaded this long (to measure memory from outside)

use std::path::PathBuf;
use std::sync::{mpsc, Arc, Mutex};
use std::time::Instant;

use pigeon_core::{material, zip_store};
use pigeon_engine::{Engine, Sink};
use serde_json::{json, Value};

enum Picture {
    Path(String),
    Bytes(Vec<u8>),
}

struct Row {
    set: &'static str,
    question: String,
    expected: Option<String>,
    picture: Option<Picture>,
    earlier: Option<String>,
    /// The section a grounded row carried.
    carried: Option<u32>,
    /// A holdout row's own answer budget, sent as an override (E4): the
    /// app's tidier sizes each ask to its text.
    max_tokens: Option<u64>,
    /// A holdout row's host values (E20), sent as they are.
    values: Option<Value>,
    /// A holdout row's own temperature, sent as an override (E4).
    temperature: Option<f64>,
    /// A holdout row's earlier turns (E3, E19) and named sections (E15), sent as
    /// they are (E25). A row's own `sections` wins over `--given`.
    history: Option<Value>,
    sections: Option<Value>,
}

struct Ride {
    file: String,
    rows: Vec<Row>,
    pigeon: u64,
}

fn fail(msg: impl std::fmt::Display) -> ! {
    eprintln!("pigeon-ride: {msg}");
    std::process::exit(2)
}

fn read_jsonl(path: &str) -> Result<Vec<Value>, String> {
    std::fs::read_to_string(path)
        .map_err(|e| format!("{path}: {e}"))?
        .lines()
        .filter(|l| !l.trim().is_empty())
        .map(|l| serde_json::from_str(l).map_err(|e| format!("{path}: {e}")))
        .collect()
}

fn earlier(path: &str) -> Result<Vec<String>, String> {
    let v: Value = serde_json::from_str(&std::fs::read_to_string(path).map_err(|e| format!("{path}: {e}"))?).map_err(|e| format!("{path}: {e}"))?;
    if let Some(a) = v["answers"].as_array() {
        return Ok(a.iter().map(|x| x.as_str().unwrap_or_default().to_string()).collect());
    }
    Ok(v["rows"].as_array().ok_or(format!("{path} has neither answers nor rows"))?.iter().map(|r| r["actual"].as_str().unwrap_or_default().to_string()).collect())
}

fn holdout(spec: &str) -> Result<Ride, String> {
    let p: Vec<&str> = spec.split('=').collect();
    if p.len() < 2 {
        return Err(format!("expected <file.pigeon>=<holdout.jsonl>, got {spec}"));
    }
    let before = p.get(2).map(|e| earlier(e)).transpose()?;
    let rows = read_jsonl(p[1])?
        .into_iter()
        .enumerate()
        .map(|(i, q)| Row {
            set: "holdout",
            question: q["question"].as_str().unwrap_or_default().to_string(),
            expected: q["answer"].as_str().map(String::from),
            picture: q["image"].as_str().map(|s| Picture::Path(s.to_string())),
            earlier: before.as_ref().and_then(|b| b.get(i).cloned()),
            carried: None,
            max_tokens: q["max_tokens"].as_u64(),
            values: q.get("values").filter(|v| !v.is_null()).cloned(),
            temperature: q["temperature"].as_f64(),
            history: q.get("history").filter(|v| !v.is_null()).cloned(),
            sections: q.get("sections").filter(|v| !v.is_null()).cloned(),
        })
        .collect();
    Ok(Ride { file: p[0].to_string(), rows, pigeon: 0 })
}

/// A Pigeon's own examples and check ride.
fn own(file: &str) -> Result<Ride, String> {
    let bytes = std::fs::read(file).map_err(|e| format!("{file}: {e}"))?;
    let entries = zip_store::list_entries(&bytes).map_err(|e| format!("{file}: {e}"))?;
    let get = |name: &str| zip_store::get(&entries, &bytes, name).ok().flatten();
    let text = |name: &str| get(name).map(|b| String::from_utf8_lossy(b).into_owned());
    let index: Option<material::ChunkIndex> = get("material/chunks.json").and_then(|raw| serde_json::from_slice(raw).ok());
    let split = |q: String| -> (String, Option<u32>) {
        match index.as_ref().and_then(|i| material::split_carried(i, &q)) {
            Some((chunk, rest)) => (rest.to_string(), Some(chunk.ordinal)),
            None => (q, None),
        }
    };
    let mut rows = Vec::new();
    let mut names: Vec<&str> = entries.iter().map(|e| e.name.as_str()).filter(|n| n.starts_with("examples/") && n.ends_with(".expected.txt")).collect();
    names.sort_unstable();
    for exp in names {
        let stem = exp.trim_end_matches(".expected.txt");
        let picture = ["jpg", "jpeg", "png"].iter().find_map(|x| get(&format!("{stem}.{x}"))).map(|b| Picture::Bytes(b.to_vec()));
        let question = text(&format!("{stem}.txt")).or_else(|| text(&format!("{stem}.prompt.txt"))).unwrap_or_default();
        let (question, carried) = split(question);
        rows.push(Row { set: "examples", question, expected: text(exp).map(|t| t.trim().to_string()), picture, earlier: None, carried, max_tokens: None, values: None, temperature: None, history: None, sections: None });
    }
    let report: Value = text("report.json").and_then(|r| serde_json::from_str(&r).ok()).unwrap_or(Value::Null);
    for r in report["check_ride"]["rows"].as_array().map(Vec::as_slice).unwrap_or_default() {
        if r.get("image").is_some_and(|i| !i.is_null()) {
            continue; // the ride's pictures are not inside the file
        }
        let (question, carried) = split(r["question"].as_str().unwrap_or_default().to_string());
        rows.push(Row { set: "check_ride", question, expected: r["expected"].as_str().map(String::from), picture: None, earlier: r["actual"].as_str().map(String::from), carried, max_tokens: None, values: None, temperature: None, history: None, sections: None });
    }
    Ok(Ride { file: file.to_string(), rows, pigeon: 0 })
}

/// The ask for one row (INTERFACE.md §6.1), pictures aside.
fn request_for(q: &Row, pigeon: u64, given: bool) -> Value {
    let mut req = json!({ "pigeon": pigeon, "input": q.question, "options": { "stream": false } });
    if let Some(n) = q.max_tokens {
        req["options"]["max_tokens"] = n.into();
    }
    if let Some(v) = &q.values {
        req["values"] = v.clone();
    }
    if let Some(t) = q.temperature {
        req["options"]["temperature"] = t.into();
    }
    if given {
        if let Some(o) = q.carried {
            req["sections"] = json!([o]);
        }
    }
    if let Some(h) = &q.history {
        req["history"] = h.clone();
    }
    if let Some(s) = &q.sections {
        req["sections"] = s.clone();
    }
    req
}

fn main() {
    if let Err(e) = run() {
        fail(e);
    }
}

fn run() -> Result<(), String> {
    let home = std::env::var("HOME").unwrap_or_default();
    let mut models = PathBuf::from(format!("{home}/Library/Application Support/mode.airoplane.pigeon/models"));
    let (mut parallel, mut at_once, mut context, mut limit, mut grammar_first) = (1usize, 1usize, 4096u32, None::<usize>, false);
    let (mut out, mut hash_cache, mut own_mode, mut given, mut streams) = (None::<String>, None::<String>, false, false, false);
    let mut hold = 0u64;
    let mut prefix_cache: Option<usize> = None;
    let mut specs: Vec<String> = Vec::new();
    let mut args = std::env::args().skip(1);
    while let Some(a) = args.next() {
        let mut num = |what: &str| args.next().and_then(|n| n.parse::<usize>().ok()).ok_or(format!("{what} needs a number"));
        match a.as_str() {
            "--models" => models = PathBuf::from(args.next().ok_or("--models needs a folder")?),
            "--parallel" => parallel = num("--parallel")?,
            "--at-once" => at_once = num("--at-once")?,
            "--context" => context = num("--context")? as u32,
            "--limit" => limit = Some(num("--limit")?),
            "--grammar-first" => grammar_first = true,
            "--own" => own_mode = true,
            "--given" => given = true,
            "--hold" => hold = num("--hold")? as u64,
            "--prefix-cache" => prefix_cache = Some(num("--prefix-cache")?),
            "--streams" => streams = true,
            "--out" => out = Some(args.next().ok_or("--out needs a file")?),
            "--hash-cache" => hash_cache = Some(args.next().ok_or("--hash-cache needs a file")?),
            spec => specs.push(spec.to_string()),
        }
    }
    let mut rides: Vec<Ride> = specs.iter().map(|s| match s.strip_prefix("own:") {
        Some(f) => own(f),
        None if own_mode => own(s),
        None => holdout(s),
    }).collect::<Result<_, _>>()?;
    if rides.is_empty() {
        return Err("usage: pigeon-ride [options] <file.pigeon>=<holdout.jsonl>[=<earlier ride>] …  or  --own <file.pigeon> …".into());
    }
    if let Some(n) = limit {
        rides.iter_mut().for_each(|r| r.rows.truncate(n));
    }
    let config = json!({
        "base_dirs": [models], "projector_dirs": [models.join("projectors")], "embedding_dirs": [models],
        "max_bases_loaded": 2, "parallel": parallel, "context_tokens": context, "grammar_first_always": grammar_first,
        "hash_cache": hash_cache,
    });
    let mut config = config;
    if let Some(n) = prefix_cache {
        config["prefix_cache_tokens"] = n.into();
    }
    let engine = Engine::new(&config.to_string()).map_err(|e| e.to_string())?;
    // D98: the stamp of this engine, its prefix-cache setting included (E26).
    let stamp = engine.version();
    println!("{stamp}");

    let t_load = Instant::now();
    for r in rides.iter_mut() {
        let (tx, rx) = mpsc::channel();
        let tx = Mutex::new(tx);
        engine.load(&json!({ "path": r.file }), Sink::Callback(Arc::new(move |e: &Value| { let _ = tx.lock().unwrap().send(e.clone()); })));
        loop {
            let e = rx.recv().map_err(|_| "the engine went away".to_string())?;
            match e["type"].as_str() {
                Some("loaded") => {
                    r.pigeon = e["pigeon"].as_u64().unwrap_or(0);
                    break;
                }
                Some("progress") => continue,
                _ => {
                    println!("{}: {} — {}", r.file, e["code"].as_str().unwrap_or("error"), e["message"].as_str().unwrap_or_default());
                    r.rows.clear();
                    break;
                }
            }
        }
    }
    let load_s = t_load.elapsed().as_secs_f64();

    // Rows from every ride, interleaved in proportion.
    let total: usize = rides.iter().map(|r| r.rows.len()).sum();
    let mut order: Vec<(usize, usize)> = Vec::with_capacity(total);
    let mut taken = vec![0usize; rides.len()];
    for _ in 0..total {
        let pick = (0..rides.len())
            .filter(|&i| taken[i] < rides[i].rows.len())
            .min_by(|&a, &b| {
                let fa = taken[a] as f64 / rides[a].rows.len() as f64;
                let fb = taken[b] as f64 / rides[b].rows.len() as f64;
                fa.partial_cmp(&fb).unwrap().then(a.cmp(&b))
            })
            .ok_or("no rows")?;
        order.push((pick, taken[pick]));
        taken[pick] += 1;
    }

    let (tx, rx) = mpsc::channel::<(usize, Value)>();
    let mut answers: Vec<Vec<Value>> = rides.iter().map(|r| vec![Value::Null; r.rows.len()]).collect();
    let submit = |k: usize, ri: usize, row: usize| {
        let (r, q) = (&rides[ri], &rides[ri].rows[row]);
        let mut req = request_for(q, r.pigeon, given);
        let mut attachments = Vec::new();
        match &q.picture {
            Some(Picture::Path(p)) => req["picture"] = json!({ "path": p }),
            Some(Picture::Bytes(b)) => {
                attachments.push(b.clone());
                req["picture"] = json!({ "attachment": 0 });
            }
            None => {}
        }
        let tx = Mutex::new(tx.clone());
        engine.ask(&req, attachments, Sink::Callback(Arc::new(move |e: &Value| {
            if matches!(e["type"].as_str(), Some("answer") | Some("error")) {
                let _ = tx.lock().unwrap().send((k, e.clone()));
            }
        })));
    };
    let t = Instant::now();
    if streams {
        // One stream per Pigeon: its next row goes in when its last answer comes back.
        let mut at = vec![0usize; rides.len()];
        let mut done = 0;
        for ri in 0..rides.len() {
            if !rides[ri].rows.is_empty() {
                submit(ri, ri, 0);
            }
        }
        while done < total {
            let (ri, e) = rx.recv().map_err(|_| "the engine went away".to_string())?;
            answers[ri][at[ri]] = e;
            at[ri] += 1;
            done += 1;
            if at[ri] < rides[ri].rows.len() {
                submit(ri, ri, at[ri]);
            }
        }
    } else {
        let (mut next, mut in_flight, mut done) = (0, 0, 0);
        while done < total {
            while in_flight < at_once && next < total {
                let (ri, row) = order[next];
                submit(next, ri, row);
                next += 1;
                in_flight += 1;
            }
            let (k, e) = rx.recv().map_err(|_| "the engine went away".to_string())?;
            let (ri, row) = order[k];
            answers[ri][row] = e;
            in_flight -= 1;
            done += 1;
        }
    }
    let seconds = t.elapsed().as_secs_f64();

    let said = |e: &Value| -> String {
        match e["answer"]["kind"].as_str() {
            Some("label") => e["answer"]["value"].as_str().unwrap_or_default().to_string(),
            _ => e["raw"].as_str().unwrap_or_default().to_string(),
        }
    };
    let mut report = json!({ "runtime": stamp, "load_seconds": load_s, "seconds": seconds, "at_once": at_once, "parallel": parallel, "prefix_cache_tokens": config["prefix_cache_tokens"], "rides": [] });
    for (ri, r) in rides.iter().enumerate() {
        let mut sets: Vec<&str> = r.rows.iter().map(|q| q.set).collect();
        sets.dedup();
        for set in sets {
            let idx: Vec<usize> = (0..r.rows.len()).filter(|&i| r.rows[i].set == set).collect();
            let got: Vec<&Value> = idx.iter().map(|&i| &answers[ri][i]).collect();
            let texts: Vec<String> = got.iter().map(|e| said(e)).collect();
            let errors = got.iter().filter(|e| e["type"] == "error").count();
            let right = idx.iter().zip(&texts).filter(|(&i, a)| r.rows[i].expected.as_deref() == Some(a.as_str())).count();
            let off = got.iter().filter(|e| e["answer"]["kind"] == "off_contract").count();
            let compared: Vec<usize> = idx.iter().copied().filter(|&i| r.rows[i].earlier.is_some()).collect();
            let same = compared.iter().filter(|&&i| r.rows[i].earlier.as_deref() == Some(said(&answers[ri][i]).as_str())).count();
            let carried: Vec<usize> = idx.iter().copied().filter(|&i| r.rows[i].carried.is_some()).collect();
            let same_section = carried.iter().filter(|&&i| answers[ri][i]["sections"].get(0).and_then(|s| s["ordinal"].as_u64()) == r.rows[i].carried.map(u64::from)).count();
            let no_section = got.iter().filter(|e| e["answer"]["kind"] == "no_section").count();
            let mut line = format!("{} [{set}]: {right}/{} exactly as expected (higher is better), {off} off-contract, {errors} errors", r.file, idx.len());
            if !compared.is_empty() {
                line += &format!(", {same}/{} same as the earlier ride", compared.len());
            }
            if !carried.is_empty() {
                line += &format!(", retrieval chose the carried section {same_section}/{} ({no_section} found none)", carried.len());
            }
            println!("{line}");
            // Answers to the same prompt that differ from the earlier ride:
            // where they first part, in bytes.
            for &i in &compared {
                let (q, mine) = (&r.rows[i], said(&answers[ri][i]));
                let same_prompt = q.carried.is_none() || answers[ri][i]["sections"].get(0).and_then(|s| s["ordinal"].as_u64()) == q.carried.map(u64::from);
                let theirs = q.earlier.as_deref().unwrap_or_default();
                if same_prompt && mine != theirs {
                    let at = mine.bytes().zip(theirs.bytes()).take_while(|(a, b)| a == b).count();
                    let row = idx.iter().position(|&j| j == i).unwrap_or(i);
                    let why = if at == mine.len() && answers[ri][i]["stopped"] == "max_tokens" { " — the engine stopped at the file's max_tokens; no drift" } else { "" };
                    println!("  row {row}: same prompt, answers part at byte {at} of {} (engine) and {} (earlier){why}", mine.len(), theirs.len());
                }
            }
            for e in got.iter().filter(|e| e["type"] == "error").take(3) {
                println!("  error: {e}");
            }
            let rows: Vec<Value> = idx
                .iter()
                .map(|&i| {
                    let q = &r.rows[i];
                    json!({ "question": q.question, "expected": q.expected, "earlier": q.earlier, "carried": q.carried, "engine": said(&answers[ri][i]), "event": answers[ri][i] })
                })
                .collect();
            report["rides"].as_array_mut().unwrap().push(json!({ "file": r.file, "set": set, "rows": rows, "right": right, "same_as_earlier": same, "compared": compared.len() }));
        }
    }
    let how = if streams { format!("{} Pigeons at once, one stream each", rides.len()) } else { format!("{at_once} at once") };
    println!("{total} asks in {seconds:.1} s (lower is better), {how}, parallel {parallel}; loading took {load_s:.1} s");
    if let Some(path) = out {
        std::fs::write(&path, serde_json::to_vec_pretty(&report).map_err(|e| e.to_string())?).map_err(|e| format!("{path}: {e}"))?;
    }
    if hold > 0 {
        println!("holding {hold} s, pid {}: {}", std::process::id(), engine.info());
        use std::io::Write;
        let _ = std::io::stdout().flush();
        std::thread::sleep(std::time::Duration::from_secs(hold));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// E25: a holdout row's `history` and `sections` reach the engine as they
    /// are; a row without them asks exactly as before.
    #[test]
    fn a_holdout_rows_history_and_sections_are_forwarded() {
        let dir = std::env::temp_dir().join(format!("pigeon-ride-e25-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let rows = dir.join("holdout.jsonl");
        std::fs::write(&rows, concat!(
            r#"{"question":"and the second?","answer":"B","history":[{"user":"first?","pigeon":"A"},{"user":"hello","pigeon":null}],"sections":[12,13]}"#, "\n",
            r#"{"question":"plain","answer":"C"}"#, "\n",
        )).unwrap();
        let ride = holdout(&format!("x.pigeon={}", rows.display())).unwrap();
        let with = request_for(&ride.rows[0], 3, false);
        assert_eq!(with["history"], json!([{ "user": "first?", "pigeon": "A" }, { "user": "hello", "pigeon": null }]));
        assert_eq!(with["sections"], json!([12, 13]));
        assert_eq!(with["pigeon"], 3);
        let without = request_for(&ride.rows[1], 3, true);
        assert_eq!(without, json!({ "pigeon": 3, "input": "plain", "options": { "stream": false } }));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
