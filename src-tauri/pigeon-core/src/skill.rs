//! `skill` — a Pigeon whose answer is a recipe naming parts, and the data that
//! draws it (Flight School's `PIGEON-FORMAT.md` §9).
//!
//! **Rendering is concatenation.** `skill/skill.json` supplies strings and this
//! module joins them; nothing in a `.pigeon` is ever executed. The reference is
//! Flight School's `pigeon/ask.py::render_with_skill`, and the fixture test
//! below renders with Flight School's own payload and compares against the
//! drawings its `facegrammar.render` produced.

use serde::Deserialize;
use serde_json::Value;

/// How this app can draw a skill, by method and version (§9.2). A skill is
/// accepted by HOW it is drawn, not by its name: its parts table ships inside
/// the `.pigeon` and its name and version are still checked against
/// `pigeon.json`, so a new skill opens without an app update. A method this app
/// cannot perform is refused by name — drawing with the wrong one would make a
/// well-formed picture of the wrong thing.
pub const RENDERERS: &[(&str, u64)] = &[("concat", 1)];

/// Skills packed before `render` existed. Each was concatenation, so each is
/// read as `concat` v1; every other skill must say how it is drawn.
pub const LEGACY: &[(&str, u64)] = &[("face-grammar", 1)];

pub const PAYLOAD_FILE: &str = "skill/skill.json";

/// A skill version may be written as `1` or `"1"` — Flight School's manifest
/// uses the number and its payload the string.
pub fn version_of(v: &Value) -> Option<u64> {
    v.as_u64().or_else(|| v.as_str().and_then(|s| s.trim().parse().ok()))
}

pub fn renderer_list() -> String {
    RENDERERS.iter().map(|(m, v)| format!("{m} v{v}")).collect::<Vec<_>>().join(", ")
}

/// `render` in `skill/skill.json`: `{ "method": "concat", "version": 1 }`.
#[derive(Deserialize, Debug, Clone)]
pub struct Render {
    pub method: String,
    #[serde(default)]
    pub version: Value,
}

fn default_wrapper() -> String {
    "{parts}".into()
}

/// `skill/skill.json`. `order` is required here even though the reference
/// falls back to the parts table's key order: a JSON object has no order a
/// second reader is obliged to keep, so without `order` two apps could draw
/// the same recipe differently.
#[derive(Deserialize, Debug, Clone)]
pub struct Payload {
    pub name: String,
    pub version: Value,
    #[serde(default = "default_wrapper")]
    pub wrapper: String,
    #[serde(default)]
    pub head: String,
    pub order: Vec<String>,
    pub parts: serde_json::Map<String, Value>,
    /// How it is drawn. Absent only on a `LEGACY` skill.
    #[serde(default)]
    pub render: Option<Render>,
    /// The JSON Schema a recipe obeys, its enums built from the parts tables.
    /// When `output_contract.constrained` is set, this is what a Runner builds
    /// its grammar from (§8.4); the building is the engine's.
    #[serde(default)]
    pub recipe_schema: Value,
}

/// Why a payload was not accepted. `render` marks the one refusal that means
/// "update the reader" rather than "the file is wrong".
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Trouble {
    pub render: bool,
    pub why: String,
}

impl Payload {
    /// Parse, and check the payload is the skill the manifest named.
    pub fn parse(bytes: &[u8], name: &str, version: Option<u64>) -> Result<Payload, String> {
        Payload::parse_coded(bytes, name, version).map_err(|t| t.why)
    }

    /// `parse`, saying which of the spec's two refusals a failure is:
    /// `unknown_render` for a method this reader cannot perform, `bad_payload`
    /// for everything else (§10.3).
    pub fn parse_coded(bytes: &[u8], name: &str, version: Option<u64>) -> Result<Payload, Trouble> {
        Payload::parse_inner(bytes, name, version).map_err(|(render, why)| Trouble { render, why })
    }

    fn parse_inner(bytes: &[u8], name: &str, version: Option<u64>) -> Result<Payload, (bool, String)> {
        let p: Payload = serde_json::from_slice(bytes).map_err(|e| (false, format!("{PAYLOAD_FILE} could not be read — {e}")))?;
        if p.name != name || version_of(&p.version) != version {
            return Err((false, format!(
                "{PAYLOAD_FILE} is \"{}\" v{}, but pigeon.json names \"{name}\" v{} — a recipe is only drawn with the table it was trained against",
                p.name,
                version_of(&p.version).map(|v| v.to_string()).unwrap_or_else(|| "?".into()),
                version.map(|v| v.to_string()).unwrap_or_else(|| "?".into()),
            )));
        }
        if p.order.is_empty() {
            return Err((false, format!("{PAYLOAD_FILE} has no `order`, so the parts cannot be drawn the same way twice")));
        }
        let (method, method_version) = match &p.render {
            Some(r) => (r.method.as_str(), version_of(&r.version)),
            None if LEGACY.iter().any(|(n, v)| *n == name && Some(*v) == version) => ("concat", Some(1)),
            None => {
                return Err((true, format!(
                    "{PAYLOAD_FILE} does not say how \"{name}\" is drawn — it needs \"render\": {{\"method\": \"concat\", \"version\": 1}}"
                )))
            }
        };
        if !RENDERERS.iter().any(|(m, v)| *m == method && Some(*v) == method_version) {
            return Err((true, format!(
                "this Pigeon's skill is drawn with \"{method}\" v{}, which this app cannot do (it can draw with {}) — update the app",
                method_version.map(|v| v.to_string()).unwrap_or_else(|| "?".into()),
                renderer_list()
            )));
        }
        // concat v1's shape: one slot, and a table of strings for every key it draws.
        if p.wrapper.matches("{parts}").count() != 1 {
            return Err((false, format!("{PAYLOAD_FILE} 'wrapper' must contain {{parts}} exactly once")));
        }
        for key in &p.order {
            let Some(table) = p.parts.get(key).and_then(Value::as_object) else {
                return Err((false, format!("{PAYLOAD_FILE} has no parts table for \"{key}\"")));
            };
            if !table.values().all(Value::is_string) {
                return Err((false, format!("{PAYLOAD_FILE} parts.{key} must map each name to a string")));
            }
            for (name, frag) in table {
                if let Some(what) = active_markup(frag.as_str().unwrap_or_default()) {
                    return Err((false, format!(
                        "{PAYLOAD_FILE} parts.{key}.{name} carries {what}, and a drawing is shapes only — a saved drawing is opened in browsers, where that would run"
                    )));
                }
            }
        }
        for (label, text) in [("head", p.head.as_str()), ("wrapper", p.wrapper.as_str())] {
            if let Some(what) = active_markup(text) {
                return Err((false, format!("{PAYLOAD_FILE} {label} carries {what}, and a drawing is shapes only")));
            }
        }
        Ok(p)
    }
}

/// What an SVG fragment may not carry. The drawing is shown in the app through
/// an `<img>`, where none of this runs — but `pigeon_save_drawing` writes it
/// to a file and Copy puts it on the clipboard, and an SVG opened from disk in
/// a browser runs its scripts. Names the first offender, for the refusal.
fn active_markup(text: &str) -> Option<&'static str> {
    let lower = text.to_ascii_lowercase();
    let compact: String = lower.chars().filter(|c| !c.is_whitespace()).collect();
    if compact.contains("<script") {
        return Some("a <script> element");
    }
    if compact.contains("<foreignobject") {
        return Some("a <foreignObject> element");
    }
    if compact.contains("<iframe") || compact.contains("<embed") || compact.contains("<object") {
        return Some("an embedded document");
    }
    if compact.contains("javascript:") || compact.contains("data:text/html") {
        return Some("a script URL");
    }
    if lower.contains("<set") || lower.contains("<animate") {
        // SMIL can set href/onload-equivalents on the fly.
        return Some("an animation element");
    }
    if compact.contains("href=") || compact.contains("xlink:href") {
        return Some("a link");
    }
    // on<anything>= — onload, onclick, onbegin … An attribute name starts
    // after whitespace or a quote, never inside a word, so `lower` (with its
    // whitespace) is the text to check, not `compact`.
    let bytes = lower.as_bytes();
    for i in 0..bytes.len().saturating_sub(3) {
        if &bytes[i..i + 2] == b"on" && (i == 0 || !bytes[i - 1].is_ascii_alphanumeric()) {
            let rest = &lower[i + 2..];
            let name_len = rest.bytes().take_while(|b| b.is_ascii_alphabetic()).count();
            if name_len > 0 && rest[name_len..].trim_start().starts_with('=') {
                return Some("an event handler");
            }
        }
    }
    None
}

/// A recipe's value is absent when Python's `not value` would say so: missing,
/// null, false, empty string, empty list.
fn absent(v: Option<&Value>) -> bool {
    match v {
        None | Some(Value::Null) | Some(Value::Bool(false)) => true,
        Some(Value::String(s)) => s.is_empty(),
        Some(Value::Array(a)) => a.is_empty(),
        _ => false,
    }
}

/// The recipe, as the model's answer text. Strict JSON: an answer that is not
/// a recipe is reported, never cleaned up into one.
pub fn parse_recipe(answer: &str) -> Result<Value, String> {
    let v: Value = serde_json::from_str(answer.trim()).map_err(|_| {
        let shown: String = answer.chars().take(120).collect();
        format!("this Pigeon answers with a recipe, and that was not JSON: {shown}")
    })?;
    if !v.is_object() {
        return Err("this Pigeon answers with a recipe, and that was not a JSON object".into());
    }
    Ok(v)
}

/// Draw a recipe: `head`, then each named part's fragment in `order`, inside
/// `wrapper`. A part name the payload does not carry is a miss, never repaired
/// to the nearest known one (§9.3).
pub fn render(payload: &Payload, recipe: &Value) -> Result<String, String> {
    let empty = serde_json::Map::new();
    let mut frags = String::from(payload.head.as_str());
    for key in &payload.order {
        let value = recipe.get(key);
        if absent(value) {
            continue;
        }
        let table = payload.parts.get(key).and_then(Value::as_object).unwrap_or(&empty);
        let names: Vec<&Value> = match value {
            Some(Value::Array(a)) => a.iter().collect(),
            Some(v) => vec![v],
            None => Vec::new(),
        };
        for name in names {
            let fragment = name.as_str().and_then(|n| table.get(n)).and_then(Value::as_str);
            match fragment {
                Some(f) => frags.push_str(f),
                None => {
                    return Err(format!("the answer names {key}={name}, which this Pigeon's skill does not carry"));
                }
            }
        }
    }
    Ok(payload.wrapper.replace("{parts}", &frags))
}

#[cfg(test)]
mod tests {
    use super::*;

    const FACE_GRAMMAR: &[u8] = include_bytes!("../tests/fixtures/face-grammar.skill.json");
    const FACE_RENDERS: &str = include_str!("../tests/fixtures/face-grammar.renders.json");

    #[test]
    fn a_parts_table_with_scripts_links_or_handlers_is_refused_by_name() {
        let base = serde_json::from_slice::<serde_json::Value>(FACE_GRAMMAR).unwrap();
        let poison = |frag: &str| {
            let mut v = base.clone();
            let key = v["order"][0].as_str().unwrap().to_string();
            let table = v["parts"][&key].as_object_mut().unwrap();
            let first = table.keys().next().unwrap().clone();
            table.insert(first, serde_json::Value::String(frag.to_string()));
            serde_json::to_vec(&v).unwrap()
        };
        for (frag, what) in [
            ("<circle r='1'/><script>alert(1)</script>", "<script>"),
            ("<foreignObject><body onload=x></body></foreignObject>", "foreignObject"),
            ("<a href='javascript:alert(1)'><circle/></a>", "script URL"),
            ("<circle onclick='x'/>", "event handler"),
            ("<image xlink:href='http://x/y.png'/>", "link"),
            ("<set attributeName='href' to='x'/>", "animation"),
            ("<SCRIPT>x</SCRIPT>", "<script>"),
            ("< script >x", "<script>"),
        ] {
            let err = Payload::parse(&poison(frag), "face-grammar", Some(1)).unwrap_err();
            assert!(err.contains(what) || err.contains(&what.to_lowercase()), "{frag} → {err}");
        }
        assert!(Payload::parse(FACE_GRAMMAR, "face-grammar", Some(1)).is_ok(), "the real one still parses");
        assert!(Payload::parse(&poison("<circle cx='1' cy='2' r='3' fill='#f00'/><text>one</text>"), "face-grammar", Some(1)).is_ok());
    }

    /// The cross-app agreement: Flight School's payload, Flight School's
    /// drawings, this renderer.
    #[test]
    fn renders_exactly_what_flight_school_draws() {
        let payload = Payload::parse(FACE_GRAMMAR, "face-grammar", Some(1)).unwrap();
        let cases: Vec<Value> = serde_json::from_str(FACE_RENDERS).unwrap();
        assert!(!cases.is_empty());
        for case in cases {
            assert_eq!(render(&payload, &case["recipe"]).unwrap(), case["svg"].as_str().unwrap(), "{}", case["recipe"]);
        }
    }

    #[test]
    fn an_unknown_part_is_a_miss_never_the_nearest_one() {
        let payload = Payload::parse(FACE_GRAMMAR, "face-grammar", Some(1)).unwrap();
        let err = render(&payload, &serde_json::json!({"eyes":"happpy","mouth":"grin"})).unwrap_err();
        assert!(err.contains("eyes=\"happpy\""), "{err}");
    }

    #[test]
    fn the_payload_must_be_the_skill_the_manifest_named() {
        assert!(Payload::parse(FACE_GRAMMAR, "face-grammar", Some(2)).is_err());
        assert!(Payload::parse(FACE_GRAMMAR, "chart-grammar", Some(1)).is_err());
    }

    #[test]
    fn versions_are_read_from_numbers_or_strings() {
        assert_eq!(version_of(&serde_json::json!(1)), Some(1));
        assert_eq!(version_of(&serde_json::json!("1")), Some(1));
        assert_eq!(version_of(&serde_json::json!("one")), None);
    }

    const LOOK: &[u8] = include_bytes!("../tests/fixtures/pigeon-look.skill.json");
    const LOOK_RENDERS: &str = include_str!("../tests/fixtures/pigeon-look.renders.json");

    fn edited(bytes: &[u8], edit: impl FnOnce(&mut Value)) -> Vec<u8> {
        let mut v: Value = serde_json::from_slice(bytes).unwrap();
        edit(&mut v);
        serde_json::to_vec(&v).unwrap()
    }

    /// The point of naming the method: Flight School's pigeon icons, a skill
    /// this app has no entry for, draw exactly as Flight School draws them.
    #[test]
    fn a_skill_it_has_never_seen_draws_by_its_method() {
        let payload = Payload::parse(LOOK, "pigeon-look", Some(1)).unwrap();
        let cases: Vec<Value> = serde_json::from_str(LOOK_RENDERS).unwrap();
        assert!(!cases.is_empty());
        for case in cases {
            assert_eq!(render(&payload, &case["recipe"]).unwrap(), case["svg"].as_str().unwrap(), "{}", case["recipe"]);
        }
    }

    #[test]
    fn a_method_this_app_cannot_perform_is_refused_by_name() {
        let layers = edited(LOOK, |v| v["render"] = serde_json::json!({"method": "layers", "version": 1}));
        let err = Payload::parse(&layers, "pigeon-look", Some(1)).unwrap_err();
        assert!(err.contains("\"layers\" v1") && err.contains("update the app"), "{err}");
        let v2 = edited(LOOK, |v| v["render"]["version"] = serde_json::json!(2));
        assert!(Payload::parse(&v2, "pigeon-look", Some(1)).unwrap_err().contains("\"concat\" v2"));
    }

    #[test]
    fn only_a_legacy_skill_may_leave_out_how_it_is_drawn() {
        // The face-grammar fixture is the payload as it shipped, before `render`.
        assert!(Payload::parse(FACE_GRAMMAR, "face-grammar", Some(1)).is_ok());
        let unsaid = edited(LOOK, |v| {
            v.as_object_mut().unwrap().remove("render");
        });
        assert!(Payload::parse(&unsaid, "pigeon-look", Some(1)).unwrap_err().contains("does not say how"));
    }

    #[test]
    fn a_concat_payload_has_one_slot_and_a_table_for_every_key() {
        let two = edited(LOOK, |v| v["wrapper"] = serde_json::json!("{parts}{parts}"));
        assert!(Payload::parse(&two, "pigeon-look", Some(1)).unwrap_err().contains("exactly once"));
        let missing = edited(LOOK, |v| {
            v["parts"].as_object_mut().unwrap().remove("hat");
        });
        assert!(Payload::parse(&missing, "pigeon-look", Some(1)).unwrap_err().contains("\"hat\""));
        let number = edited(LOOK, |v| v["parts"]["hat"]["crown"] = serde_json::json!(7));
        assert!(Payload::parse(&number, "pigeon-look", Some(1)).unwrap_err().contains("parts.hat"));
    }

    #[test]
    fn an_answer_that_is_not_a_recipe_is_reported_not_repaired() {
        assert!(parse_recipe("```json\n{\"eyes\":\"happy\"}\n```").is_err());
        assert!(parse_recipe("[1,2]").is_err());
        assert!(parse_recipe(" {\"eyes\":\"happy\"} ").is_ok());
    }
}
