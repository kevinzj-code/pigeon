//! Asking a Pigeon (spec §8): the chat a Runner builds before the base's own
//! chat template is applied, and what the model's text is read as afterwards.
//!
//! This is what makes a Pigeon answer the same in every Runner. Nothing here
//! adds a system prompt, an instruction or an example: anything added changes
//! the shape the adapter was trained on.

use serde::Serialize;
use serde_json::Value;

use crate::check::Refused;
use crate::manifest::Manifest;
use crate::material::{self, Chunk, INPUT_SLOT, MATERIAL_SLOT};
use crate::skill;

pub const IMAGE_SLOT: &str = "{image}";

/// The template with its slots filled in ONE left-to-right pass, every other
/// byte left alone (§8.2). One pass matters: text put into one slot is never
/// scanned for further slots, so a question that contains `{material}` stays
/// exactly as typed. The input is trimmed. `{material}` is filled only when
/// there is material (a grounded Pigeon). `{image}` is taken out, with the one
/// newline after it — the picture travels as its own part, before the text
/// (§8.3).
pub fn fill(template: &str, input: &str, material: Option<&str>) -> String {
    let input = input.trim();
    let mut out = String::with_capacity(template.len() + input.len() + material.map_or(0, str::len));
    let mut rest = template;
    while !rest.is_empty() {
        if let Some(after) = rest.strip_prefix(INPUT_SLOT) {
            out.push_str(input);
            rest = after;
        } else if let (Some(after), Some(material)) = (rest.strip_prefix(MATERIAL_SLOT), material) {
            out.push_str(material);
            rest = after;
        } else if let Some(after) = rest.strip_prefix(IMAGE_SLOT) {
            rest = after.strip_prefix('\n').unwrap_or(after);
        } else {
            let first = rest.chars().next().map_or(1, char::len_utf8);
            let next = rest[first..].find('{').map_or(rest.len(), |i| i + first);
            out.push_str(&rest[..next]);
            rest = &rest[next..];
        }
    }
    out
}

/// Several sections as one material block: each `[§n] Title\ntext`, joined by a
/// blank line (§9.3).
pub fn material_block(sections: &[&Chunk]) -> String {
    sections.iter().map(|c| material::material_block(c)).collect::<Vec<_>>().join("\n\n")
}

/// D86, D87: a Pigeon's fixed earlier turns, sent after the system message
/// and before any history.
pub const SHOTS_FILE: &str = "shots.json";

/// `shots.json`: a list of `{ "user", "pigeon" }` turns, both text.
pub fn parse_shots(raw: &[u8]) -> Result<Vec<Turn>, String> {
    let v: Value = serde_json::from_slice(raw).map_err(|e| format!("{SHOTS_FILE} could not be read — {e}"))?;
    let list = v.as_array().ok_or_else(|| format!("{SHOTS_FILE} must be a list of turns"))?;
    list.iter()
        .map(|t| match (t.get("user").and_then(Value::as_str), t.get("pigeon").and_then(Value::as_str)) {
            (Some(user), Some(pigeon)) => Ok(Turn { user: user.to_string(), pigeon: Some(pigeon.to_string()) }),
            _ => Err(format!("each turn in {SHOTS_FILE} has a user and a pigeon, both text")),
        })
        .collect()
}

/// One earlier exchange: what the person sent and what the Pigeon returned.
/// `pigeon` is None when no reply is replayed (E19): the person's words go
/// alone, as a host sends them when it dropped or never got the reply.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Turn {
    pub user: String,
    pub pigeon: Option<String>,
}

#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
pub struct Message {
    pub role: &'static str,
    pub content: String,
    /// The newest message of a picture Pigeon: the picture is its own content
    /// part, before this text.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub image_first: bool,
}

/// What a Runner needs beyond the manifest to build one prompt.
#[derive(Debug, Clone, Copy, Default)]
pub struct Ask<'a> {
    pub input: &'a str,
    /// `system_prompt.txt`, required for a `persona` and allowed in any kind
    /// trained with one (D85). Sent unchanged (D3).
    pub system_prompt: Option<&'a str>,
    /// `shots.json` (D86): sent verbatim, always, before any history.
    pub shots: &'a [Turn],
    /// Earlier exchanges, oldest first. Sent only under `history: as_sent`,
    /// and only the last `max_turns` of them (§5.6).
    pub history: &'a [Turn],
    /// The sections retrieval chose, for a `grounded` Pigeon.
    pub sections: &'a [&'a Chunk],
}

/// The chat, in order (§8.1): the file's system prompt (D85), its fixed turns
/// (D86), the declared history, then the newest message filled into the
/// template.
pub fn messages(m: &Manifest, ask: &Ask) -> Vec<Message> {
    let plain = |role, content: String| Message { role, content, image_first: false };
    let mut out = Vec::new();
    if let Some(system) = ask.system_prompt {
        out.push(plain("system", system.to_string()));
    }
    for shot in ask.shots {
        out.push(plain("user", shot.user.clone()));
        out.push(plain("assistant", shot.pigeon.clone().unwrap_or_default()));
    }
    if let Some(h) = m.history.as_ref().filter(|h| h.shape == "as_sent") {
        let keep = h.max_turns.unwrap_or(0) as usize;
        for turn in &ask.history[ask.history.len().saturating_sub(keep)..] {
            out.push(plain("user", turn.user.trim().to_string()));
            if let Some(reply) = &turn.pigeon {
                out.push(plain("assistant", reply.clone()));
            }
        }
    }
    let block = (m.kind == "grounded").then(|| material_block(ask.sections));
    out.push(Message { role: "user", content: fill(&m.prompt_template, ask.input, block.as_deref()), image_first: m.takes_pictures() });
    out
}

/// §8.6: the prompt a Runner built for `prompt_check.input`, written in
/// canonical form, against the one training built. They must be equal byte for
/// byte; the refusal reports the first position where they are not.
pub fn prompt_matches(built: &str, canonical: &str) -> Result<(), Refused> {
    if built == canonical {
        return Ok(());
    }
    let at = built.bytes().zip(canonical.bytes()).position(|(a, b)| a != b).unwrap_or(built.len().min(canonical.len()));
    Err(Refused::PromptMismatch { at })
}

/// What `prompt_check.input` asks with (§8.6): a string for a text Pigeon,
/// `{ input, sections }` for a grounded one, `{ text, image }` for a picture
/// one. Returned as (the input, the ordinals of the sections shown with it).
/// Never with history.
pub fn check_input(input: &Value) -> Option<(String, Vec<u32>)> {
    if let Some(text) = input.as_str() {
        return Some((text.to_string(), Vec::new()));
    }
    let given = input.as_object()?;
    if given.contains_key("image") {
        return Some((given.get("text")?.as_str()?.to_string(), Vec::new()));
    }
    let sections = given.get("sections").and_then(Value::as_array).map(|a| a.iter().filter_map(|n| n.as_u64().map(|n| n as u32)).collect());
    Some((given.get("input")?.as_str()?.to_string(), sections.unwrap_or_default()))
}

/// A picture as an engine's chat template writes it, and how many placeholder
/// tokens the base makes of it at the size it was trained at. `N` belongs to
/// the picture and the base, not to the engine (D37).
#[derive(Debug, Clone, Copy)]
pub struct Picture<'a> {
    /// The picture's whole markup, start token through end token.
    pub markup: &'a str,
    pub tokens: u32,
}

/// A rendered prompt in canonical form (§8.6): each picture, from its start
/// token through its placeholders to its end token, written as `<image:N>`.
pub fn canonical(rendered: &str, picture: Option<&Picture>) -> String {
    match picture {
        Some(p) if !p.markup.is_empty() => rendered.replace(p.markup, &format!("<image:{}>", p.tokens)),
        _ => rendered.to_string(),
    }
}

/// What a Pigeon's `prompt_check` came to (§8.6).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PromptCheck {
    /// The file has none: it runs, with the warning `prompt_unchecked`.
    Unchecked,
    Matches { rendered: String },
    /// `at` is the first differing byte; the refusal is `prompt_mismatch`.
    Differs { rendered: String, at: usize },
}

/// The base's own chat template (its GGUF `tokenizer.chat_template`), run the
/// way transformers and llama.cpp run it, with the assistant turn opened.
#[cfg(feature = "chat-template")]
pub mod template {
    use super::Message;
    use minijinja::{context, Environment, Error, ErrorKind, Value};

    /// The chat as a template sees it. A picture Pigeon's newest message is a
    /// list of parts, the picture first (§8.3).
    fn as_values(messages: &[Message]) -> Vec<Value> {
        messages
            .iter()
            .map(|m| {
                let content = if m.image_first {
                    Value::from_serialize(serde_json::json!([{ "type": "image" }, { "type": "text", "text": m.content }]))
                } else {
                    Value::from(m.content.clone())
                };
                context! { role => m.role, content => content }
            })
            .collect()
    }

    /// What the template writes for one picture, start token through end
    /// token: the text a picture message adds over the same message without
    /// one. Found by rendering, so it holds for any base's template.
    pub fn picture_markup(template: &str) -> Result<String, String> {
        let with = |image_first| [Message { role: "user", content: "\u{1}".into(), image_first }];
        let (plain, pictured) = (render(template, &with(false))?, render(template, &with(true))?);
        let start = plain.bytes().zip(pictured.bytes()).take_while(|(a, b)| a == b).count();
        let end = plain[start..].bytes().rev().zip(pictured[start..].bytes().rev()).take_while(|(a, b)| a == b).count();
        let markup = &pictured[start..pictured.len() - end];
        if markup.is_empty() || !pictured.is_char_boundary(start) {
            return Err("this chat template writes nothing for a picture".into());
        }
        Ok(markup.to_string())
    }

    /// The prompt for `prompt_check.input`, built by §8.1–§8.3 with no
    /// history, rendered through `template`, written in canonical form, and
    /// compared with `canonical` byte for byte. `system_prompt` is the file's,
    /// for a persona; `index` its material, for a grounded Pigeon; `picture`
    /// is needed for a picture Pigeon, and its `tokens` is the engine's count.
    pub fn prompt_check(
        m: &crate::manifest::Manifest,
        system_prompt: Option<&str>,
        shots: &[super::Turn],
        index: Option<&crate::material::ChunkIndex>,
        template: &str,
        picture: Option<&super::Picture>,
    ) -> Result<super::PromptCheck, String> {
        let Some(pc) = &m.prompt_check else { return Ok(super::PromptCheck::Unchecked) };
        let (input, wanted) = super::check_input(&pc.input).ok_or("prompt_check.input is not one of the three shapes")?;
        let chunks = index.map(|i| i.chunks.as_slice()).unwrap_or_default();
        let sections: Vec<&crate::material::Chunk> = wanted.iter().filter_map(|o| chunks.iter().find(|c| c.ordinal == *o)).collect();
        // Never with history: `canonical` is one input, as training built it.
        let messages = super::messages(m, &super::Ask { input: &input, system_prompt, shots, history: &[], sections: &sections });
        let rendered = super::canonical(&render(template, &messages)?, picture);
        Ok(match super::prompt_matches(&rendered, &pc.canonical) {
            Ok(()) => super::PromptCheck::Matches { rendered },
            Err(crate::check::Refused::PromptMismatch { at }) => super::PromptCheck::Differs { rendered, at },
            Err(_) => unreachable!("prompt_matches refuses only with prompt_mismatch"),
        })
    }

    pub fn render(template: &str, messages: &[Message]) -> Result<String, String> {
        let mut env = Environment::new();
        env.set_trim_blocks(true);
        env.set_lstrip_blocks(true);
        env.set_unknown_method_callback(minijinja_contrib::pycompat::unknown_method_callback);
        env.add_function("raise_exception", |msg: String| -> Result<Value, Error> { Err(Error::new(ErrorKind::InvalidOperation, msg)) });
        env.render_str(template, context! { messages => as_values(messages), add_generation_prompt => true })
            .map_err(|e| format!("the chat template could not be rendered — {e}"))
    }
}

/// `labels.txt`: one label per line, trimmed, blank lines dropped.
pub fn labels(text: &str) -> Vec<String> {
    text.lines().map(|l| l.trim().to_string()).filter(|l| !l.is_empty()).collect()
}

/// The line of `labels.txt` that equals the text, compared case-insensitively
/// (ASCII) after trimming, spelled as `labels.txt` spells it (D5). No other
/// repair: never the "nearest" label.
pub fn match_label<'a>(labels: &'a [String], text: &str) -> Option<&'a str> {
    let text = text.trim();
    labels.iter().map(String::as_str).find(|l| l.eq_ignore_ascii_case(text))
}

/// A `reasoned` answer (D26): the content of the LAST complete `<do>…</do>`,
/// and everything before that `<do>` as the reasoning, both trimmed. Anything
/// after its `</do>` is ignored. `None` without a complete pair.
pub fn last_do(text: &str) -> Option<(&str, &str)> {
    let at = text.rfind("<do>")?;
    let inner = &text[at + "<do>".len()..];
    let end = inner.find("</do>")?;
    Some((text[..at].trim(), inner[..end].trim()))
}

/// What a Runner returns (§8.5). `OffContract` is an answer, not an error: the
/// host decides what to show, and a repaired answer cannot be trusted to be
/// what the model said.
#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Answer {
    Label {
        value: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        reasoning: Option<String>,
    },
    Json {
        value: Value,
        #[serde(skip_serializing_if = "Option::is_none")]
        reasoning: Option<String>,
    },
    /// A skill's recipe, and what it draws. The artefact is untrusted markup:
    /// a host shows it the way an image is shown (§10.4).
    Recipe {
        value: Value,
        artefact: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        reasoning: Option<String>,
    },
    Text {
        value: String,
        /// Grounded: cited sections that were not shown (§9.6).
        #[serde(skip_serializing_if = "Option::is_none")]
        unsupported_citations: Option<Vec<u32>>,
    },
    OffContract { raw: String },
}

impl Answer {
    fn with_reasoning(self, text: &str) -> Answer {
        let said = Some(text.to_string());
        match self {
            Answer::Label { value, .. } => Answer::Label { value, reasoning: said },
            Answer::Json { value, .. } => Answer::Json { value, reasoning: said },
            Answer::Recipe { value, artefact, .. } => Answer::Recipe { value, artefact, reasoning: said },
            other => other,
        }
    }
}

/// What reading an answer needs from the file.
#[derive(Debug, Clone, Copy, Default)]
pub struct Reading<'a> {
    /// `output_contract.type`.
    pub output_type: &'a str,
    /// `output_contract.answer`, for `reasoned`.
    pub inner: Option<&'a str>,
    pub labels: &'a [String],
    /// The parts table, when the manifest has `skill`.
    pub skill: Option<&'a skill::Payload>,
    /// The ordinals shown to the model, for a `grounded` Pigeon.
    pub shown: Option<&'a [u32]>,
    /// The file's `actions.json`, for what a `KEY(…)` label presses.
    pub actions: crate::actions::Keys<'a>,
}

/// The answer object exactly as the conformance kit prints it, and as an
/// engine hands it to a host (INTERFACE.md §6.2): the typed answer, with
/// `action` and `not_pressed` when the file has an `actions.json`. Only what
/// the file lists under `keys` is ever an `action` (§13.2).
pub fn answer(r: &Reading, raw: &str) -> Value {
    use crate::actions::{self, Keys, Press};
    let typed = read_answer(r, raw);
    let mut out = serde_json::to_value(&typed).unwrap_or(Value::Null);
    let pressed = match (&typed, r.actions) {
        (_, Keys::NoFile) => return out,
        (Answer::Label { value, .. }, Keys::File(acts)) => actions::outcome(acts, value),
        _ => Press::Nothing,
    };
    let (action, not_pressed) = match pressed {
        Press::Action(a) => (a, Value::Null),
        Press::NotPressed(n) => (Value::Null, n),
        Press::Nothing => (Value::Null, Value::Null),
    };
    out["action"] = action;
    out["not_pressed"] = not_pressed;
    out
}

/// The model's text, read as the answer the Pigeon promises (§8.5).
pub fn read_answer(r: &Reading, raw: &str) -> Answer {
    let raw = raw.trim();
    let off = || Answer::OffContract { raw: raw.to_string() };
    match r.output_type {
        "reasoned" => {
            let Some((reasoning, inner)) = last_do(raw) else { return off() };
            let read = read_answer(&Reading { output_type: r.inner.unwrap_or("label"), inner: None, ..*r }, inner);
            read.with_reasoning(reasoning)
        }
        "label" => match match_label(r.labels, raw) {
            Some(label) => Answer::Label { value: label.to_string(), reasoning: None },
            None => off(),
        },
        "json" => {
            let Ok(value) = serde_json::from_str::<Value>(raw) else { return off() };
            if !value.is_object() {
                return off();
            }
            match r.skill {
                None => Answer::Json { value, reasoning: None },
                Some(payload) => match skill::render(payload, &value) {
                    Ok(artefact) => Answer::Recipe { value, artefact, reasoning: None },
                    Err(_) => off(),
                },
            }
        }
        _ => Answer::Text {
            value: raw.to_string(),
            unsupported_citations: r.shown.map(|shown| material::unsupported_citations(raw, shown)),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_template_is_filled_in_one_pass_and_the_picture_slot_goes_with_its_newline() {
        assert_eq!(fill("Q: {input}\nA:", "  hi  ", None), "Q: hi\nA:");
        assert_eq!(fill("{material}\n\n{input}", "what is {material}?", Some("[§1] T\nbody {input}")), "[§1] T\nbody {input}\n\nwhat is {material}?");
        assert_eq!(fill("{image}\n{input}", "What next?", None), "What next?");
        assert_eq!(fill("{image}{input} {é}", "x", None), "x {é}");
        assert_eq!(fill("{material} {input}", "x", None), "{material} x", "no material, no slot");
    }

    #[test]
    fn a_reasoned_answer_is_its_last_do() {
        assert_eq!(last_do("<think>a <do>X</do></think><do> Y </do>tail"), Some(("<think>a <do>X</do></think>", "Y")));
        assert_eq!(last_do("<think>no answer</think>"), None);
        assert_eq!(last_do("<do>never closed"), None);
        let labels = vec!["KEY(Up)".to_string(), "KEY(Left)".to_string()];
        let r = Reading { output_type: "reasoned", inner: Some("label"), labels: &labels, ..Default::default() };
        assert_eq!(read_answer(&r, "<think>wall</think><do>key(left)</do>"), Answer::Label { value: "KEY(Left)".into(), reasoning: Some("<think>wall</think>".into()) });
        assert!(matches!(read_answer(&r, "<do>the left one</do>"), Answer::OffContract { .. }));
    }

    fn manifest(kind: &str, history: &str) -> Manifest {
        serde_json::from_str(&format!(r#"{{"format_version":1,"name":"N","id":"n","kind":"{kind}",
            "base_model":{{"file":"b.gguf","arch":"qwen3vl","name":"qwen3vl","size":"2B"}},
            "prompt_template":"{{input}}","inputs":["text"],"output_contract":{{"type":"text","max_tokens":9}}{history}}}"#)).unwrap()
    }

    #[test]
    fn any_kind_with_a_system_prompt_sends_it_first() {
        // D85: Patch's router and the tidier were trained with one.
        for kind in ["router", "freeform", "persona"] {
            let got = messages(&manifest(kind, ""), &Ask { input: " q ", system_prompt: Some("Route."), ..Default::default() });
            assert_eq!(got.iter().map(|m| (m.role, m.content.as_str())).collect::<Vec<_>>(), vec![("system", "Route."), ("user", "q")], "{kind}");
        }
        let got = messages(&manifest("freeform", ""), &Ask { input: "q", ..Default::default() });
        assert_eq!(got.len(), 1, "no file prompt, no system message");
    }

    #[test]
    fn a_history_turn_with_no_reply_sends_the_words_alone() {
        // E19: Pen's turn whose reply the figure guard dropped.
        let m = manifest("persona", r#","history":{"shape":"as_sent","max_turns":3}"#);
        let history = [Turn { user: " one ".into(), pigeon: Some("first".into()) }, Turn { user: "two".into(), pigeon: None }];
        let got = messages(&m, &Ask { input: "three", system_prompt: Some("S"), history: &history, ..Default::default() });
        let roles: Vec<(&str, &str)> = got.iter().map(|m| (m.role, m.content.as_str())).collect();
        assert_eq!(roles, vec![("system", "S"), ("user", "one"), ("assistant", "first"), ("user", "two"), ("user", "three")]);
    }

    #[test]
    fn fixed_turns_go_after_the_system_message_and_before_history() {
        // D86, D87: the asks check's shape.
        let shots = parse_shots(br#"[{"user":"round 12.7","pigeon":"YES"},{"user":"he rounded on me","pigeon":"NO"}]"#).unwrap();
        let m = manifest("classifier", "");
        let got = messages(&m, &Ask { input: "q", system_prompt: Some("One word."), shots: &shots, ..Default::default() });
        let roles: Vec<(&str, &str)> = got.iter().map(|m| (m.role, m.content.as_str())).collect();
        assert_eq!(roles, vec![("system", "One word."), ("user", "round 12.7"), ("assistant", "YES"), ("user", "he rounded on me"), ("assistant", "NO"), ("user", "q")]);
        // The shots are the file's text, untouched; only the newest message is trimmed.
        let spaced = parse_shots(br#"[{"user":" a ","pigeon":" b "}]"#).unwrap();
        assert_eq!(messages(&m, &Ask { input: "q", shots: &spaced, ..Default::default() })[0].content, " a ");
        for bad in [&br#"{}"#[..], br#"[{"user":"a"}]"#, br#"[{"user":"a","assistant":"b"}]"#, br#"[{"user":1,"pigeon":"b"}]"#, b"nope"] {
            assert!(parse_shots(bad).is_err(), "{}", String::from_utf8_lossy(bad));
        }
    }

    #[test]
    fn a_prompt_that_differs_from_its_check_reports_where() {
        assert_eq!(prompt_matches("abc", "abc"), Ok(()));
        assert_eq!(prompt_matches("abXd", "abcd"), Err(Refused::PromptMismatch { at: 2 }));
        assert_eq!(prompt_matches("ab", "abc"), Err(Refused::PromptMismatch { at: 2 }));
    }
}
