//! Turning an ask request into a prompt (§8.1–§8.3, §9): validated, filled,
//! retrieved for, rendered through the base's own template, and tokenized.

use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::time::Instant;

use pigeon_core::ask::{self, Turn};
use pigeon_core::{actions, material};
use serde_json::{json, Value};

use crate::events::Out;
use crate::llama::{Chunks, Part, Projector};
use crate::pigeons::Loaded;

/// A request ready to run.
pub struct Job {
    pub out: Out,
    pub pigeon: Arc<Loaded>,
    pub parts: Vec<Part>,
    /// The projector's cut of the prompt, when it has a picture in it.
    pub chunks: Option<Arc<Chunks>>,
    pub prompt_tokens: usize,
    pub max_tokens: usize,
    /// The grammar this ask decodes under: the Pigeon's own, or one built
    /// from the host's values (E20).
    pub grammar: Option<String>,
    /// E20, E21: the value lists the answer was held to, as the host sent
    /// them; reported inside the answer as `host_values`.
    pub host_values: Option<Value>,
    pub temperature: f64,
    pub as_measured: bool,
    pub history_used: usize,
    /// Grounded: the sections shown, as (ordinal, title).
    pub sections: Option<Vec<(u32, String)>>,
    /// E15: the host named them.
    pub sections_given: bool,
    pub stream: bool,
    pub cancel: Arc<AtomicBool>,
    pub asked: Instant,
}

impl Job {
    /// Cells this request may fill: its prompt and its longest answer.
    pub fn need(&self) -> usize {
        self.prompt_tokens + self.max_tokens
    }
}

/// What a request comes to before any model runs.
pub enum Ready {
    Job(Job),
    /// Answered without the model: `capture_for` (E12) or retrieval that
    /// found nothing (§9.5).
    Now(Value),
}

/// An engine error: (code, message).
pub type Bad = (&'static str, String);

fn bad(m: impl Into<String>) -> Bad {
    ("bad_request", m.into())
}

/// The one picture a request carries, as bytes.
fn picture_bytes(req: &Value, attachments: &[Vec<u8>]) -> Result<Option<Picture>, Bad> {
    let Some(p) = req.get("picture").filter(|p| !p.is_null()) else { return Ok(None) };
    if let Some(path) = p.get("path").and_then(Value::as_str) {
        let bytes = std::fs::read(path).map_err(|e| ("picture_unreadable", format!("{path} could not be read — {e}")))?;
        return Ok(Some(Picture::Encoded(bytes)));
    }
    let n = p.get("attachment").and_then(Value::as_u64).ok_or_else(|| bad("picture needs attachment or path"))? as usize;
    let bytes = attachments.get(n).ok_or_else(|| bad(format!("there is no attachment {n}")))?.clone();
    match p.get("raw") {
        None => Ok(Some(Picture::Encoded(bytes))),
        Some(raw) => {
            let w = raw.get("width").and_then(Value::as_u64).ok_or_else(|| bad("raw needs width"))? as u32;
            let h = raw.get("height").and_then(Value::as_u64).ok_or_else(|| bad("raw needs height"))? as u32;
            if raw.get("format").and_then(Value::as_str) != Some("rgba8") {
                return Err(("picture_unreadable", "a raw frame must be rgba8".into()));
            }
            if bytes.len() != (w as usize) * (h as usize) * 4 {
                return Err(("picture_unreadable", "the raw frame is not width × height × 4 bytes".into()));
            }
            let rgb: Vec<u8> = bytes.chunks_exact(4).flat_map(|p| [p[0], p[1], p[2]]).collect();
            Ok(Some(Picture::Rgb(w, h, rgb)))
        }
    }
}

/// E12, step 3: the frames a host captured at `capture_for`'s size, newest
/// last, each cut to the kept part, stacked and written as JPEG — the picture
/// Eye.swift writes from the same frames.
#[cfg(target_os = "macos")]
fn frames_picture(p: &Loaded, list: &Value, attachments: &[Vec<u8>]) -> Result<Vec<u8>, Bad> {
    use crate::apple::Image;
    let block = p.report.get("actions").filter(|a| !a.is_null()).and_then(actions::frames).ok_or(("picture_not_wanted", "this Pigeon has no actions.frames, so it cannot be played".to_string()))?;
    let list = list.as_array().ok_or_else(|| bad("frames must be a list"))?;
    let stack = block.get("stack").and_then(Value::as_u64).unwrap_or(1) as usize;
    if list.len() != stack {
        return Err(bad(format!("this Pigeon looks at {stack} frame(s) at once, and {} were sent", list.len())));
    }
    let mut images = Vec::with_capacity(stack);
    for (i, f) in list.iter().enumerate() {
        let image = match picture_bytes(&json!({ "picture": f }), attachments)? {
            Some(Picture::Encoded(b)) => Image::decode(&b),
            Some(Picture::Rgb(..)) | None => match (f.get("attachment").and_then(Value::as_u64).and_then(|n| attachments.get(n as usize)), f.get("raw")) {
                (Some(b), Some(raw)) => Image::from_rgba(raw["width"].as_u64().unwrap_or(0) as usize, raw["height"].as_u64().unwrap_or(0) as usize, b),
                _ => Err("a frame needs an attachment or a path".into()),
            },
        }
        .map_err(|e| ("picture_unreadable", format!("frame {i}: {e}")))?;
        images.push(image);
    }
    compose(block, images)
}

/// Each frame cut to the kept part as Eye cuts the frame it captured (§13.2's
/// arithmetic at the frame's own size, nothing shrunk), then stacked and
/// written as JPEG.
#[cfg(target_os = "macos")]
pub fn compose(block: &Value, images: Vec<crate::apple::Image>) -> Result<Vec<u8>, Bad> {
    let max_side = block.get("max_side").and_then(Value::as_u64).unwrap_or(0);
    let mut kept = Vec::with_capacity(images.len());
    for (i, image) in images.into_iter().enumerate() {
        let (w, h) = (image.width(), image.height());
        let mut whole = block.clone();
        whole["max_side"] = (w.max(h).max(64) as u64).into();
        let plan = actions::capture_plan(w as f64, h as f64, &whole).ok_or(("picture_unreadable", format!("frame {i}: its crop keeps under a pixel")))?;
        let r = plan.kept;
        if r.width.max(r.height) as u64 > max_side + 1 {
            return Err(bad(format!("frame {i} is {w} × {h}, larger than capture_for gives; capture it at that size")));
        }
        kept.push(image.crop(r.x, r.y, r.width, r.height).map_err(|e| ("picture_unreadable", format!("frame {i}: {e}")))?);
    }
    crate::apple::side_by_side(kept).and_then(|s| s.jpeg()).map_err(|e| ("model_failed", e))
}

#[cfg(not(target_os = "macos"))]
fn frames_picture(_: &Loaded, _: &Value, _: &[Vec<u8>]) -> Result<Vec<u8>, Bad> {
    Err(("model_failed", "frames are built on macOS only so far".into()))
}

enum Picture {
    Encoded(Vec<u8>),
    Rgb(u32, u32, Vec<u8>),
}

pub fn prepare(p: Arc<Loaded>, req: &Value, attachments: &[Vec<u8>], out: Out, cancel: Arc<AtomicBool>, asked: Instant, context_tokens: u32) -> Result<Ready, Bad> {
    let m = &p.manifest;

    // E12, step 1: the size to capture at, and nothing else.
    if let Some(window) = req.get("capture_for") {
        let frames = match p.report.get("actions") {
            Some(a) if !a.is_null() => actions::frames(a).cloned(),
            _ => None,
        };
        let frames = frames.ok_or(("picture_not_wanted", "this Pigeon has no actions.frames, so it cannot be played".to_string()))?;
        let w = window.get("width").and_then(Value::as_f64).ok_or_else(|| bad("capture_for needs width"))?;
        let h = window.get("height").and_then(Value::as_f64).ok_or_else(|| bad("capture_for needs height"))?;
        let plan = actions::capture_plan(w, h, &frames).ok_or(("picture_not_wanted", "these frames cannot be followed".to_string()))?;
        return Ok(Ready::Now(json!({ "type": "answer", "capture": { "width": plan.width, "height": plan.height } })));
    }

    let input = req.get("input").and_then(Value::as_str).ok_or_else(|| bad("input is required, and must be text"))?;
    let acts = p.report.get("actions").filter(|a| !a.is_null());
    let input = actions::input_or_question(input, acts).to_string();

    let picture = match req.get("frames").filter(|f| !f.is_null()) {
        None => picture_bytes(req, attachments)?,
        Some(_) if req.get("picture").is_some_and(|p| !p.is_null()) => return Err(bad("send frames or a picture, not both")),
        Some(list) => Some(Picture::Encoded(frames_picture(&p, list, attachments)?)),
    };
    match (m.takes_pictures(), picture.is_some()) {
        (true, false) => return Err(("picture_needed", "this Pigeon answers about a picture, and none was sent".into())),
        (false, true) => return Err(("picture_not_wanted", "this Pigeon reads text only".into())),
        _ => {}
    }

    // E3: history only when the file asks for it, and only up to max_turns.
    let history: Vec<Turn> = req
        .get("history")
        .and_then(Value::as_array)
        .map(|a| a.iter().map(|t| Turn { user: t["user"].as_str().unwrap_or_default().into(), pigeon: t["pigeon"].as_str().map(String::from) }).collect())
        .unwrap_or_default();
    let history_used = if p.history.shape == "as_sent" { history.len().min(p.history.max_turns.unwrap_or(0) as usize) } else { 0 };

    // E4: overrides, flagged.
    let opts = req.get("options").cloned().unwrap_or(Value::Null);
    let t_over = opts.get("temperature").and_then(Value::as_f64);
    let n_over = opts.get("max_tokens").and_then(Value::as_u64);
    let temperature = t_over.unwrap_or(p.temperature);
    let as_measured = t_over.map_or(true, |t| t == p.temperature) && n_over.map_or(true, |n| Some(n as u32) == p.max_tokens);
    let stream = opts.get("stream").and_then(Value::as_bool).unwrap_or(true);

    // §9: a grounded Pigeon's sections, by the file's method.
    let index = p.index.as_ref();
    let mut sections: Vec<&material::Chunk> = Vec::new();
    // E15: sections named by the host are used exactly, in order, unsearched.
    let given: Option<Vec<u64>> = match req.get("sections").filter(|s| !s.is_null()) {
        None => None,
        Some(s) => {
            if m.kind != "grounded" {
                return Err(bad("sections are for a grounded Pigeon"));
            }
            let ordinals: Vec<u64> = s.as_array().ok_or_else(|| bad("sections must be a list of ordinals"))?.iter().map(|o| o.as_u64().ok_or_else(|| bad("sections must be a list of ordinals"))).collect::<Result<_, _>>()?;
            if ordinals.is_empty() {
                return Err(bad("sections must name at least one section"));
            }
            Some(ordinals)
        }
    };
    if let Some(ordinals) = &given {
        let index = index.ok_or(("model_failed", "this Pigeon's material could not be read".to_string()))?;
        for o in ordinals {
            let chunk = index.chunks.iter().find(|c| c.ordinal as u64 == *o).ok_or_else(|| bad(format!("this Pigeon's material has no section {o}")))?;
            sections.push(chunk);
        }
    } else if m.kind == "grounded" {
        let index = index.ok_or(("model_failed", "this Pigeon's material could not be read".to_string()))?;
        let method = m.material.as_ref().map(|x| x.retrieval.as_str()).unwrap_or_default();
        let qvec = match (&p.embeddings, &p.embedder) {
            (Some(e), Some(x)) => Some(x.embed(&e.model.query_prefix, &input).map_err(|e| ("model_failed", e))?),
            _ => None,
        };
        sections = material::find(index, method, &input, p.embeddings.as_ref().zip(qvec.as_deref())).map_err(|e| ("model_failed", e))?;
        if sections.is_empty() {
            return Ok(Ready::Now(json!({
                "type": "answer", "answer": { "kind": "no_section" }, "stopped": "end",
                "as_measured": as_measured, "history_used": history_used, "sections": [],
                "stats": { "prompt_tokens": 0, "answer_tokens": 0, "first_piece_ms": null, "total_ms": asked.elapsed().as_millis() as u64 },
            })));
        }
    }

    let (grammar, host_values) = host_grammar(&p, req.get("values").filter(|v| !v.is_null()))?;
    let messages = ask::messages(m, &ask::Ask { input: &input, system_prompt: p.system_prompt.as_deref(), shots: &p.shots, history: &history, sections: &sections });
    let mut rendered = ask::template::render(&p.base.template, &messages).map_err(|e| ("model_failed", e))?;

    let (parts, chunks) = match (&p.pictures, picture) {
        (Some(pics), Some(pic)) => {
            let markup = p.picture_markup.as_deref().unwrap_or_default();
            if markup.is_empty() || !rendered.contains(markup) {
                return Err(("model_failed", "the base's template wrote no picture where the picture goes".into()));
            }
            rendered = rendered.replacen(markup, &Projector::marker(), 1);
            let _held = pics.lock.lock().map_err(|_| ("model_failed", "the projector's lock is poisoned".to_string()))?;
            let bitmap = match pic {
                Picture::Encoded(b) => pics.projector.bitmap(&b).map_err(|e| ("picture_unreadable", e))?,
                Picture::Rgb(w, h, rgb) => Projector::bitmap_rgb(w, h, &rgb).map_err(|e| ("picture_unreadable", e))?,
            };
            let chunks = pics.projector.tokenize(&rendered, &[&bitmap]).map_err(|e| ("model_failed", e))?;
            (chunks.parts(), Some(Arc::new(chunks)))
        }
        _ => (vec![Part::Text(p.base.model.tokenize(&rendered, true).map_err(|e| ("model_failed", e))?)], None),
    };
    let prompt_tokens: usize = parts.iter().map(|x| match x {
        Part::Text(t) => t.len(),
        Part::Image { tokens, .. } => *tokens,
    }).sum();
    let room = (context_tokens as usize).saturating_sub(prompt_tokens);
    let max_tokens = n_over.map(|n| n as usize).or(p.max_tokens.map(|n| n as usize)).unwrap_or(room);
    if prompt_tokens + max_tokens > context_tokens as usize || max_tokens == 0 {
        return Err(("too_long", format!("the prompt is {prompt_tokens} tokens and the answer may be {max_tokens}; a context holds {context_tokens}")));
    }
    let shown = (m.kind == "grounded").then(|| sections.iter().map(|c| (c.ordinal, c.title.clone())).collect());
    Ok(Ready::Job(Job { out, pigeon: p.clone(), parts, chunks, prompt_tokens, max_tokens, grammar, host_values, temperature, as_measured, history_used, sections: shown, sections_given: given.is_some(), stream, cancel, asked }))
}

/// E20: the grammar for one ask. A Pigeon whose file names `host_values`
/// is held to the lists the host sends for exactly those fields. Values for
/// a field the file does not name are refused as `host_values_unnamed`
/// (E21, spec D91); none, or an empty list, for one it names is
/// `bad_request`. Otherwise the Pigeon's own grammar.
fn host_grammar(p: &Loaded, values: Option<&Value>) -> Result<(Option<String>, Option<Value>), Bad> {
    let oc = p.manifest.output_contract.clone().unwrap_or_default();
    let Some(given) = values else {
        if let Some(field) = oc.host_values.first() {
            return Err(bad(format!("this Pigeon's answer is held to values the host gives for {field}, and none were sent")));
        }
        return Ok((p.grammar.clone(), None));
    };
    let given = given.as_object().ok_or_else(|| bad("values must be an object of value lists"))?;
    let unnamed: Vec<&str> = given.keys().filter(|k| !oc.host_values.contains(k)).map(String::as_str).collect();
    if !unnamed.is_empty() {
        return Err(("host_values_unnamed", pigeon_core::check::Refused::HostValuesUnnamed(unnamed.join(", ")).message()));
    }
    let mut lists: Vec<(String, Vec<Value>)> = Vec::new();
    for field in &oc.host_values {
        let list = given.get(field).and_then(Value::as_array).ok_or_else(|| bad(format!("values for {field} are needed, as a list")))?;
        if list.is_empty() {
            return Err(bad(format!("the values for {field} are empty, so no answer could be given")));
        }
        lists.push((field.clone(), list.clone()));
    }
    let grammar = if p.manifest.output_type() == Some("label") {
        // `label`: a choice among the file's own labels.
        let chosen: Vec<String> = lists[0].1.iter().map(|v| v.as_str().map(String::from)).collect::<Option<_>>().ok_or_else(|| bad("label values must be text"))?;
        if let Some(stray) = chosen.iter().find(|c| !p.labels.contains(c)) {
            return Err(bad(format!("{stray} is not one of this Pigeon's labels")));
        }
        crate::pigeons::label_grammar(&chosen)
    } else {
        let schema = oc.output_schema.as_ref().ok_or(("model_failed", "this Pigeon names host values but carries no output_schema".to_string()))?;
        let held = pigeon_core::values::with_values(schema, &lists).ok_or(("model_failed", "a host_values field is not in the output_schema".to_string()))?;
        crate::llama::json_schema_grammar(&held.to_string()).map_err(|e| ("model_failed", e))?
    };
    Ok((Some(grammar), Some(Value::Object(given.clone()))))
}
