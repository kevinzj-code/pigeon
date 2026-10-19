//! The conformance kit's adapter (spec §16.2): one case folder in, one JSON
//! object out. `src/bin/pigeon-kit.rs` is this behind a command line, and
//! `tests/conformance.rs` runs every case through it.
//!
//! A case's `machine` gives each base's identity as already read from its
//! GGUF header, so the kit needs no model files: it tests the decision, not
//! the parsing. Which keys are trusted comes from the case too: `pigeon_keys`
//! and `registry_keys`, as public keys in hex.

use std::path::Path;

use serde_json::{json, Value};

use crate::check::{self, Embedder, Host, InstalledBase, Machine, Refused, Trust};
use crate::manifest::Manifest;
use crate::registry::{self, Registry};
use crate::{actions, ask, gguf, material, nest, skill, zip_store};

fn text(v: &Value, key: &str) -> String {
    v.get(key).and_then(Value::as_str).unwrap_or_default().to_string()
}

fn strings(v: &Value, key: &str) -> Vec<String> {
    v.get(key).and_then(Value::as_array).map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect()).unwrap_or_default()
}

fn refused(r: &Refused) -> Value {
    r.json()
}

fn unsupported(detail: impl Into<String>) -> Value {
    json!({ "result": "unsupported", "detail": detail.into() })
}

/// §13.2 steps 0 to 3 for a window of `window` pixels: the size to capture at,
/// and the kept part as `[left, top, width, height]` in that capture.
fn frames_op(request: &Value) -> Value {
    let size = |i: usize| request["window"].get(i).and_then(Value::as_f64).unwrap_or(0.0);
    match actions::capture_plan(size(0), size(1), &request["frames"]) {
        None => json!({ "result": "skipped" }),
        Some(p) => json!({ "result": "followed", "capture": [p.width, p.height], "kept": [p.kept.x, p.kept.y, p.kept.width, p.kept.height] }),
    }
}

/// Run the case in `dir` and return what a conforming implementation prints.
pub fn run(dir: &Path) -> Value {
    let case: Value = match std::fs::read(dir.join("case.json")).map_err(|e| e.to_string()).and_then(|b| serde_json::from_slice(&b).map_err(|e| e.to_string())) {
        Ok(c) => c,
        Err(e) => return unsupported(format!("case.json could not be read — {e}")),
    };
    let read = |name: &str| std::fs::read(dir.join(name)).unwrap_or_default();
    let bytes = read("input.pigeon");
    let op = text(&case, "op");
    let pretend = Pretend::new(&case["machine"]);
    let trust = pretend.trust();
    match op.as_str() {
        "registry" => return registry_op(&read("registry.zip"), &trust, &case["request"]),
        "frames" => return frames_op(&case["request"]),
        "check" => {
            // A registry that is refused is not used (§7.4).
            let registry_zip = read("registry.zip");
            let (opened, _) = registry::open_all(&[registry_zip.as_slice()], &trust);
            let host = pretend.host(trust, &opened);
            // A nest is checked by `check` too: the case has input.nest instead.
            if !dir.join("input.nest").exists() {
                return checked(&bytes, &host);
            }
            return match nest::check(&read("input.nest"), &host) {
                Err(r) => refused(&r),
                Ok(members) => {
                    let mut out = nest::json(&members);
                    if let Some(each) = out["members"].as_array_mut() {
                        each.iter_mut().for_each(as_the_kit_prints);
                    }
                    out
                }
            };
        }
        _ => {}
    }
    let opened = check::list(&bytes).and_then(|entries| {
        let raw = zip_store::get(&entries, &bytes, check::MANIFEST_FILE).map_err(Refused::BadZip)?.ok_or(Refused::NoManifest)?;
        let m: Manifest = serde_json::from_slice(raw).map_err(|e| Refused::BadManifest(e.to_string()))?;
        Ok((entries, m))
    });
    let (entries, m) = match opened {
        Ok(x) => x,
        Err(r) => return refused(&r),
    };
    let entry = |name: &str| zip_store::get(&entries, &bytes, name).ok().flatten();
    let utf8 = |name: &str| entry(name).map(|b| String::from_utf8_lossy(b).into_owned());
    let index: Option<material::ChunkIndex> = entry(check::MATERIAL_FILE).and_then(|raw| serde_json::from_slice(raw).ok());
    let shots: Vec<ask::Turn> = entry(ask::SHOTS_FILE).and_then(|raw| ask::parse_shots(raw).ok()).unwrap_or_default();
    let req = &case["request"];
    /* D91: values for a field the file does not name are refused before
       anything is built or read. */
    if matches!(op.as_str(), "prompt" | "answer") {
        let named = m.output_contract.as_ref().map(|o| o.host_values.clone()).unwrap_or_default();
        let unnamed: Vec<&String> = req["host_values"].as_object().map(|o| o.keys().filter(|k| !named.contains(k)).collect()).unwrap_or_default();
        if !unnamed.is_empty() {
            return refused(&Refused::HostValuesUnnamed(unnamed.iter().map(|s| s.as_str()).collect::<Vec<_>>().join(", ")));
        }
    }
    match op.as_str() {
        "prompt" => {
            let history: Vec<ask::Turn> = req["history"].as_array().map(|a| a.iter().map(|t| ask::Turn { user: text(t, "user"), pigeon: t["pigeon"].as_str().map(String::from) }).collect()).unwrap_or_default();
            let wanted: Vec<u64> = req["sections"].as_array().map(|a| a.iter().filter_map(Value::as_u64).collect()).unwrap_or_default();
            let chunks = index.map(|i| i.chunks).unwrap_or_default();
            let sections: Vec<&material::Chunk> = wanted.iter().filter_map(|o| chunks.iter().find(|c| c.ordinal as u64 == *o)).collect();
            let system = utf8("system_prompt.txt");
            let input = text(req, "input");
            let messages = ask::messages(&m, &ask::Ask { input: &input, system_prompt: system.as_deref(), shots: &shots, history: &history, sections: &sections });
            let mut out = json!({ "messages": messages });
            if req.get("chat_template").is_some() {
                match rendered(req, &messages) {
                    Ok(text) => out["rendered"] = json!(text),
                    Err(e) => return unsupported(e),
                }
            }
            out
        }
        "prompt_check" => {
            let system = utf8("system_prompt.txt");
            let template = text(req, "chat_template");
            let markup = text(&req["picture"], "markup");
            let picture = req["picture"]["tokens"].as_u64().map(|tokens| ask::Picture { markup: &markup, tokens: tokens as u32 });
            match ask::template::prompt_check(&m, system.as_deref(), &shots, index.as_ref(), &template, picture.as_ref()) {
                // A file without one still runs, with a warning (§8.6).
                Ok(ask::PromptCheck::Unchecked) => json!({ "result": "accepted", "warnings": ["prompt_unchecked"] }),
                Ok(ask::PromptCheck::Matches { rendered }) => json!({ "result": "accepted", "warnings": [], "rendered": rendered }),
                Ok(ask::PromptCheck::Differs { rendered, at }) => {
                    let mut out = Refused::PromptMismatch { at }.json();
                    out["rendered"] = json!(rendered);
                    out
                }
                Err(e) => unsupported(e),
            }
        }
        "retrieve" => {
            let Some(index) = index else { return refused(&Refused::BadPayload(format!("{} could not be read", check::MATERIAL_FILE))) };
            let method = m.material.as_ref().map(|x| x.retrieval.clone()).unwrap_or_default();
            let embeddings = if method == "hybrid-v1" {
                match material::Embeddings::parse(entry(material::EMBEDDINGS_FILE).unwrap_or_default()) {
                    Ok(e) => Some(e),
                    Err(e) => return refused(&Refused::BadPayload(e)),
                }
            } else {
                None
            };
            let mut picks: Vec<Vec<u32>> = Vec::new();
            for q in req["questions"].as_array().map(Vec::as_slice).unwrap_or_default() {
                let question = text(q, "question");
                // The kit cannot run an embedding model: a hybrid-v1 question's
                // vector comes with the case, already unit length.
                let qvec = embeddings.as_ref().and_then(|e| e.unpack(&text(q, "f16")));
                if embeddings.is_some() && qvec.is_none() {
                    return unsupported("a hybrid-v1 question needs its vector in f16");
                }
                let found = match material::find(&index, &method, &question, embeddings.as_ref().zip(qvec.as_deref())) {
                    Ok(found) => found,
                    Err(_) => return refused(&Refused::UnknownRetrieval(method)),
                };
                picks.push(found.iter().map(|c| c.ordinal).collect());
            }
            json!({ "picks": picks })
        }
        "answer" => {
            let labels = ask::labels(&utf8("labels.txt").unwrap_or_default());
            let payload = match &m.skill {
                None => None,
                Some(s) => match skill::Payload::parse_coded(entry(skill::PAYLOAD_FILE).unwrap_or_default(), &s.name, m.skill_version()) {
                    Ok(p) => Some(p),
                    Err(t) => return refused(&if t.render { Refused::UnknownRender(t.why) } else { Refused::BadPayload(t.why) }),
                },
            };
            let acts = entry(actions::ACTIONS_FILE).map(|raw| actions::usable(raw, m.takes_pictures()));
            let shown: Vec<u32> = req["shown"].as_array().map(|a| a.iter().filter_map(|n| n.as_u64().map(|n| n as u32)).collect()).unwrap_or_default();
            let reading = ask::Reading {
                output_type: m.output_type().unwrap_or("text"),
                inner: m.output_contract.as_ref().and_then(|o| o.answer.as_deref()),
                labels: &labels,
                skill: payload.as_ref(),
                shown: (m.kind == "grounded").then_some(shown.as_slice()),
                // A skipped actions.json presses nothing (D54).
                actions: match &acts {
                    None => actions::Keys::NoFile,
                    Some(Ok(a)) => actions::Keys::File(a),
                    Some(Err(_)) => actions::Keys::Skipped,
                },
            };
            let mut out = ask::answer(&reading, &text(req, "raw"));
            // D86, D91: the host's lists are reported with the answer.
            if let Some(given) = req["host_values"].as_object().filter(|o| !o.is_empty()) {
                out["host_values"] = Value::Object(given.clone());
            }
            out
        }
        other => unsupported(format!("unknown op {other}")),
    }
}

/// The prompt for `messages` through `request.chat_template`, in canonical
/// form: each picture written as `<image:N>`.
fn rendered(req: &Value, messages: &[ask::Message]) -> Result<String, String> {
    let built = ask::template::render(&text(req, "chat_template"), messages)?;
    let markup = text(&req["picture"], "markup");
    let picture = req["picture"]["tokens"].as_u64().map(|tokens| ask::Picture { markup: &markup, tokens: tokens as u32 });
    Ok(ask::canonical(&built, picture.as_ref()))
}

/// The machine a case pretends to be.
struct Pretend {
    here: bool,
    bases: Vec<InstalledBase>,
    projectors: Vec<String>,
    embedders: Vec<Embedder>,
    pigeon_keys: Vec<String>,
    registry_keys: Vec<String>,
}

impl Pretend {
    fn new(machine: &Value) -> Pretend {
        let bases = machine["bases"]
            .as_array()
            .map(|a| {
                a.iter()
                    .map(|b| {
                        let i = &b["identity"];
                        InstalledBase {
                            file: text(b, "file"),
                            sha256: b["sha256"].as_str().map(String::from),
                            identity: gguf::Identity { arch: text(i, "arch"), name: text(i, "name"), size: text(i, "size"), finetune: i["finetune"].as_str().map(String::from) },
                        }
                    })
                    .collect()
            })
            .unwrap_or_default();
        Pretend {
            here: !machine.is_null(),
            bases,
            projectors: strings(machine, "projectors"),
            embedders: strings(machine, "embedding_models").into_iter().map(|sha256| Embedder { sha256, dims: None, query_prefix: None }).collect(),
            pigeon_keys: strings(machine, "pigeon_keys"),
            registry_keys: strings(machine, "registry_keys"),
        }
    }

    fn trust(&self) -> Trust<'_> {
        Trust { pigeons: &self.pigeon_keys, registries: &self.registry_keys }
    }

    fn host<'a>(&'a self, trust: Trust<'a>, registries: &'a [Registry]) -> Host<'a> {
        Host {
            machine: self.here.then_some(Machine { bases: &self.bases, projectors: &self.projectors, embedders: &self.embedders }),
            trust,
            registries,
        }
    }
}

fn checked(bytes: &[u8], host: &Host) -> Value {
    let mut out = match check::check(bytes, host) {
        Ok(report) => report.json(),
        Err(r) => r.json(),
    };
    as_the_kit_prints(&mut out);
    out
}

/// The kit compares `warnings` as a sorted list of codes, where a report
/// gives each warning its code and its sentence.
fn as_the_kit_prints(report: &mut Value) {
    if let Some(warnings) = report.get_mut("warnings").and_then(Value::as_array_mut) {
        let mut codes: Vec<String> = warnings.iter().map(|w| text(w, "code")).collect();
        codes.sort_unstable();
        *warnings = codes.into_iter().map(Value::from).collect();
    }
}

/// §7.4: open a sealed registry, and look a base up by its identity — its
/// licence and the recommended pair, which is what a host shows and fetches.
fn registry_op(bytes: &[u8], trust: &Trust, req: &Value) -> Value {
    let reg = match registry::open(bytes, trust) {
        Ok(reg) => reg,
        Err(u) => return json!({ "result": "refused", "code": u.code, "detail": u.why }),
    };
    let mut out = json!({ "result": "accepted", "sealed_by": reg.sealed_by, "registry_version": reg.registry_version });
    if let Some(i) = req.get("identity") {
        let wanted = gguf::Identity { arch: text(i, "arch"), name: text(i, "name"), size: text(i, "size"), finetune: i["finetune"].as_str().map(String::from) };
        out["base"] = match reg.base_for(&wanted) {
            None => Value::Null,
            Some(b) => json!({ "id": b.id, "license": b.license, "license_url": b.license_url, "file": b.recommended_file(), "projector": b.recommended_projector() }),
        };
    }
    out
}

/// Whether every key in `want` is in `got` with an equal value — the kit's own
/// rule (`run.py`). Extra keys are ignored, except those an object lists under
/// `"$absent"`, which must not be there; a list must have the same length,
/// item for item; `warnings` is compared sorted.
pub fn same(want: &Value, got: &Value) -> bool {
    same_under(want, got, "")
}

fn same_under(want: &Value, got: &Value, key: &str) -> bool {
    match (want, got) {
        (Value::Object(w), _) => got.as_object().is_some_and(|g| {
            let absent = w.get("$absent").and_then(Value::as_array).into_iter().flatten().filter_map(Value::as_str);
            absent.clone().all(|k| !g.contains_key(k))
                && w.iter().filter(|(k, _)| k.as_str() != "$absent").all(|(k, v)| g.get(k).is_some_and(|x| same_under(v, x, k)))
        }),
        (Value::Array(w), Value::Array(g)) if key == "warnings" => {
            let sorted = |a: &[Value]| {
                let mut out: Vec<String> = a.iter().map(Value::to_string).collect();
                out.sort_unstable();
                out
            };
            sorted(w) == sorted(g)
        }
        (Value::Array(w), Value::Array(g)) => w.len() == g.len() && w.iter().zip(g).all(|(w, g)| same_under(w, g, "")),
        // Python compares 0 == 0.0 as equal; so does the kit.
        (Value::Number(n), _) => got.as_f64().is_some_and(|g| Some(g) == n.as_f64()),
        _ => want == got,
    }
}
