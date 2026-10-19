//! The maker's card (spec §11): what a host shows before anyone uses a
//! Pigeon. Display text only — a card that breaks the rules is skipped with a
//! warning that names the field, and the Pigeon still loads (D8).

use serde_json::Value;

/// (field, most code points). Text that is too long is refused, never cut: a
/// cut sentence is a different sentence.
pub const TEXT_LIMITS: [(&str, usize); 4] = [("does", 60), ("input_hint", 40), ("output_noun", 24), ("talks_like", 60)];
pub const MAX_EXAMPLES: usize = 5;

fn whole(v: Option<&Value>) -> Option<i64> {
    v.filter(|v| v.is_i64() || v.is_u64()).and_then(Value::as_i64)
}

/// The first field that breaks §11, or `None` for a card a host may show.
pub fn problem(card: &Value) -> Option<String> {
    let Some(card) = card.as_object() else { return Some("card must be an object".into()) };
    if !card.get("does").and_then(Value::as_str).is_some_and(|s| !s.trim().is_empty()) {
        return Some("card.does".into());
    }
    for (key, limit) in TEXT_LIMITS {
        match card.get(key) {
            None | Some(Value::Null) => {}
            Some(Value::String(s)) if s.chars().count() <= limit => {}
            Some(_) => return Some(format!("card.{key}")),
        }
    }
    match card.get("examples") {
        None | Some(Value::Null) => {}
        Some(Value::Array(ex)) if ex.len() <= MAX_EXAMPLES && ex.iter().all(|e| e.get("input").is_some_and(Value::is_string) && e.get("output").is_some_and(Value::is_string)) => {}
        Some(_) => return Some("card.examples".into()),
    }
    match card.get("input_stats") {
        None | Some(Value::Null) => {}
        Some(stats) => {
            let ok = |k: &str| ["p50", "p95"].iter().all(|p| stats.get(k).and_then(|s| s.get(p)).and_then(Value::as_f64).is_some_and(|n| n >= 0.0));
            if !(stats.is_object() && ok("words") && ok("lines")) {
                return Some("card.input_stats".into());
            }
        }
    }
    match card.get("check") {
        None | Some(Value::Null) => {}
        Some(c) if c.is_object() && whole(c.get("passed")).is_some() && whole(c.get("total")).is_some() => {}
        Some(_) => return Some("card.check".into()),
    }
    match card.get("revision") {
        None | Some(Value::Null) => {}
        Some(r) if whole(Some(r)).is_some_and(|n| n >= 1) => {}
        Some(_) => return Some("card.revision".into()),
    }
    None
}

/// Whether a card may be shown: it passes every rule in §11.
pub fn readable(card: &Value) -> bool {
    problem(card).is_none()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_card_is_kept_only_when_it_passes_every_rule_and_the_field_is_named() {
        assert!(readable(&json!({ "does": "Sort coin photos by type.", "surprise": 1 })));
        assert_eq!(problem(&json!({ "does": "" })).as_deref(), Some("card.does"));
        assert_eq!(problem(&json!({ "does": "x".repeat(61) })).as_deref(), Some("card.does"));
        assert!(readable(&json!({ "does": "é".repeat(60) })), "lengths are code points, not bytes");
        assert_eq!(problem(&json!("not an object")).as_deref(), Some("card must be an object"));
        assert_eq!(problem(&json!({ "does": "d", "output_noun": "n".repeat(25) })).as_deref(), Some("card.output_noun"));
        assert_eq!(problem(&json!({ "does": "d", "examples": [{ "input": 3, "output": "x" }] })).as_deref(), Some("card.examples"));
        assert_eq!(problem(&json!({ "does": "d", "check": { "passed": 1.5, "total": 2 } })).as_deref(), Some("card.check"));
        assert_eq!(problem(&json!({ "does": "d", "revision": 0 })).as_deref(), Some("card.revision"));
        assert!(readable(&json!({ "does": "d", "input_stats": { "words": { "p50": 4, "p95": 5.5 }, "lines": { "p50": 1, "p95": 1 } }, "check": { "passed": 5, "total": 6 }, "revision": 1 })));
    }
}
