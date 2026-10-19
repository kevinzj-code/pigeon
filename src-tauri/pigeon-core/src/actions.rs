//! `actions.json` (spec §13.2): what a picture Pigeon presses. A Pigeon trained
//! by recording someone use an app answers with labels such as `KEY(Confirm)`,
//! and this file says which key that is.
//!
//! A host MUST NOT press anything not listed under `keys`. So the question
//! this module answers is narrow: for this label, is there a key — yes, and
//! which, or no.

use serde_json::Value;

pub const ACTIONS_FILE: &str = "actions.json";

/// The name inside `KEY(…)`, when the label is exactly that.
pub fn key_name(label: &str) -> Option<&str> {
    label.strip_prefix("KEY(")?.strip_suffix(')').filter(|name| !name.is_empty() && !name.contains('\n'))
}

/// The `format_version` of `actions.json` this reader knows.
pub const SUPPORTED_ACTIONS_VERSION: u64 = 1;

/// Why an `actions.json` is skipped (§13.2, D54, D66, D67, D69): a stable
/// cause a host can word, and a sentence naming exactly what failed. Skipped
/// means the Pigeon loads with `actions_skipped`, presses nothing, and is not
/// played.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Skip {
    /// `unreadable`, `no_version`, `newer`, `no_frames`, `keys`, `no_pictures`,
    /// `crop`, `stack`, `max_side` or `gap`.
    pub cause: &'static str,
    pub why: String,
}

fn skip(cause: &'static str, why: impl Into<String>) -> Skip {
    Skip { cause, why: why.into() }
}

fn whole(v: Option<&Value>) -> Option<i64> {
    v.filter(|v| v.is_i64() || v.is_u64()).and_then(Value::as_i64)
}

/// `actions.json` as a value, when it is one a host can act on. Otherwise why
/// not, in the order §13.2 lists the reasons.
pub fn read(raw: &[u8]) -> Result<Value, Skip> {
    let v: Value = serde_json::from_slice(raw).map_err(|e| skip("unreadable", format!("{ACTIONS_FILE} could not be read — {e}")))?;
    if !v.is_object() {
        return Err(skip("unreadable", format!("{ACTIONS_FILE} is not a JSON object")));
    }
    // D67: a version, as a whole number. D66: not one newer than this reader.
    match v.get("format_version") {
        Some(f) if f.is_u64() && f.as_u64().is_some_and(|n| n > SUPPORTED_ACTIONS_VERSION) => {
            return Err(skip("newer", format!("{ACTIONS_FILE} is version {f}, and this reader knows version {SUPPORTED_ACTIONS_VERSION}")))
        }
        Some(f) if whole(Some(f)).is_some() => {}
        _ => return Err(skip("no_version", format!("{ACTIONS_FILE} does not give its format_version as a whole number"))),
    }
    // D69: without `frames` nobody can know how the training pictures were made.
    let Some(frames) = v.get("frames").filter(|f| !f.is_null()) else {
        return Err(skip("no_frames", format!("{ACTIONS_FILE} does not say how its pictures were made (no frames)")));
    };
    if !matches!(v.get("keys"), None | Some(Value::Object(_))) {
        return Err(skip("keys", format!("{ACTIONS_FILE} `keys` is not an object")));
    }
    followable(frames)?;
    Ok(v)
}

/// §13.2 step 0 (D70): the crop moved inside the window and cut to fit — `x`
/// and `y` into 0 to 1, then `w = min(w, 1 − x)` and `h = min(h, 1 − y)`. No
/// crop is the whole window. Every later step uses these values.
pub fn trim([x, y, w, h]: [f64; 4]) -> [f64; 4] {
    let (x, y) = (x.clamp(0.0, 1.0), y.clamp(0.0, 1.0));
    [x, y, w.min(1.0 - x), h.min(1.0 - y)]
}

/// `frames.crop` as four numbers, `None` when there is no crop, or an error
/// when it is something other than four numbers.
fn crop_of(frames: &Value) -> Result<Option<[f64; 4]>, Skip> {
    let Some(crop) = frames.get("crop").filter(|c| !c.is_null()) else { return Ok(None) };
    let parts: Vec<f64> = crop.as_array().map(|a| a.iter().filter_map(Value::as_f64).collect()).unwrap_or_default();
    match <[f64; 4]>::try_from(parts) {
        Ok(v) if crop.as_array().map_or(0, Vec::len) == 4 => Ok(Some(v)),
        _ => Err(skip("crop", "frames.crop is not four numbers")),
    }
}

/// D66: a `frames` block a host can follow exactly — or the first thing it
/// cannot. A host never guesses past one of these. Whether the kept part
/// rounds to under a pixel needs the window, so `capture_plan` checks that.
pub fn followable(frames: &Value) -> Result<(), Skip> {
    if !frames.is_object() {
        return Err(skip("no_frames", "frames is not an object"));
    }
    if let Some(crop) = crop_of(frames)? {
        // D70 trimmed first; D75 plain double arithmetic, no tolerance.
        let [_, _, w, h] = trim(crop);
        if w <= 0.01 || h <= 0.01 {
            return Err(skip("crop", "frames.crop keeps 1% or less of the window, once trimmed to it"));
        }
    }
    let stack = whole(frames.get("stack")).filter(|n| (1..=4).contains(n));
    let Some(stack) = stack else {
        return Err(skip("stack", "frames.stack is not a whole number from 1 to 4"));
    };
    // D77.
    if !whole(frames.get("max_side")).is_some_and(|n| n >= 64) {
        return Err(skip("max_side", "frames.max_side is not a whole number of at least 64"));
    }
    // D76: when given, a number of at least 0, whatever the stack.
    let gap = frames.get("gap_ms").filter(|g| !g.is_null());
    if gap.is_some_and(|g| !g.as_f64().is_some_and(|g| g >= 0.0)) {
        return Err(skip("gap", "frames.gap_ms is not a time of at least 0"));
    }
    // D72: required when frames are stacked.
    if stack > 1 && gap.is_none() {
        return Err(skip("gap", "frames.stack is above 1 and frames.gap_ms is not given"));
    }
    Ok(())
}

/// `read`, for a Pigeon: only one that takes pictures has actions at all.
pub fn usable(raw: &[u8], takes_pictures: bool) -> Result<Value, Skip> {
    if !takes_pictures {
        return Err(skip("no_pictures", "this Pigeon takes no pictures"));
    }
    read(raw)
}

/// A rectangle of pixels, from the top left.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rect {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

/// What a host captures, and what is kept of it (§13.2 steps 2 and 3, E12).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CapturePlan {
    /// The size to ask the system to capture the whole window at.
    pub width: u32,
    pub height: u32,
    /// The kept part of that capture: all of it when there is no crop.
    pub kept: Rect,
}

/// §13.2 steps 0 to 3, as arithmetic: given the window's own size in pixels
/// (points times the screen's scale) and a `frames` block, the size to capture
/// the window at and the rectangle to keep. The same rounding as the Pigeon
/// app's capture helper (`captureSize` and `Crop.rect` in Eye.swift): the crop
/// trimmed to the window first (D70), halves away from zero, each side on its
/// own, the right and bottom edges clipped to the frame. `None` when `frames`
/// cannot be followed, or the kept part rounds to under 1 pixel in this
/// window — a host never falls back to the whole window.
pub fn capture_plan(window_width: f64, window_height: f64, frames: &Value) -> Option<CapturePlan> {
    followable(frames).ok()?;
    if !(window_width.is_finite() && window_height.is_finite() && window_width > 0.0 && window_height > 0.0) {
        return None;
    }
    let max_side = whole(frames.get("max_side"))? as f64;
    let [x, y, w, h] = trim(crop_of(frames).ok()?.unwrap_or([0.0, 0.0, 1.0, 1.0]));
    let k = (max_side / (window_width * w).max(window_height * h)).min(1.0);
    let (cw, ch) = ((window_width * k).round(), (window_height * k).round());
    let (left, top) = ((x * cw).round(), (y * ch).round());
    let (right, bottom) = ((left + (w * cw).round()).min(cw), (top + (h * ch).round()).min(ch));
    if right - left < 1.0 || bottom - top < 1.0 {
        return None;
    }
    let kept = Rect { x: left as u32, y: top as u32, width: (right - left) as u32, height: (bottom - top) as u32 };
    Some(CapturePlan { width: cw as u32, height: ch as u32, kept })
}

/// Whether a `keys` entry is one a host may press (D68): an object whose
/// `code` is a whole number from 0 to 127. Any other entry counts as not
/// listed; the file's other keys still work.
pub fn listed(entry: &Value) -> bool {
    entry.is_object() && whole(entry.get("code")).is_some_and(|c| (0..=127).contains(&c))
}

/// The key a label presses: its entry under `keys`, as the file wrote it
/// (`code`, `name`, `hold_ms`). `None` for a label that is not a key, and for
/// a key the file does not let a host press.
pub fn press<'a>(actions: &'a Value, label: &str) -> Option<&'a Value> {
    actions.get("keys")?.as_object()?.get(key_name(label)?).filter(|entry| listed(entry))
}

/// What a label means to a host that can press keys. It never presses
/// anything this does not return as `Action`.
#[derive(Debug, Clone, PartialEq)]
pub enum Press {
    /// The file's own declaration for this key, with `key`: the name inside
    /// `KEY(…)`. Copied out so a host need not open the file.
    Action(Value),
    /// A key deliberately left unlisted (recorded with ⌘, Ctrl or Option
    /// held): the file's `not_pressed` entry, with its `why`.
    NotPressed(Value),
    /// Not a key, or a key the file says nothing about.
    Nothing,
}

pub fn outcome(actions: &Value, label: &str) -> Press {
    let Some(name) = key_name(label) else { return Press::Nothing };
    if let Some(entry) = press(actions, label) {
        let mut action = serde_json::json!({ "key": name });
        if let (Some(out), Some(fields)) = (action.as_object_mut(), entry.as_object()) {
            out.extend(fields.iter().map(|(k, v)| (k.clone(), v.clone())));
        }
        return Press::Action(action);
    }
    let unlisted = actions.get("not_pressed").and_then(Value::as_array).and_then(|rows| rows.iter().find(|r| r.get("answer").and_then(Value::as_str) == Some(label)));
    unlisted.map_or(Press::Nothing, |row| Press::NotPressed(row.clone()))
}

/// What a Pigeon's `actions.json` is, as far as reading an answer goes.
#[derive(Debug, Clone, Copy, Default)]
pub enum Keys<'a> {
    /// The file has none: an answer carries no `action` or `not_pressed`.
    #[default]
    NoFile,
    /// It has one the check skipped (D54): both are `null`, and nothing is pressed.
    Skipped,
    /// It has one a host can act on.
    File(&'a Value),
}

/// The text every training row was asked with. When the person types nothing,
/// the host asks with it.
pub fn question(actions: &Value) -> Option<&str> {
    actions.get("question").and_then(Value::as_str).filter(|q| !q.trim().is_empty())
}

/// What to ask with: the person's input, or — when that is empty and the file
/// has one — its `question`.
pub fn input_or_question<'a>(input: &'a str, actions: Option<&'a Value>) -> &'a str {
    if input.trim().is_empty() {
        return actions.and_then(question).unwrap_or(input);
    }
    input
}

/// How a picture is built from a window (`frames`), as the file wrote it.
pub fn frames(actions: &Value) -> Option<&Value> {
    actions.get("frames").filter(|f| f.is_object())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_a_key_the_file_lists_is_pressed() {
        let actions = serde_json::json!({ "format_version": 1,
            "keys": { "Confirm": { "code": 7, "name": "X", "hold_ms": null } },
            "not_pressed": [{ "answer": "KEY(Save)", "key": "Cmd+S" }] });
        assert_eq!(press(&actions, "KEY(Confirm)").and_then(|k| k["code"].as_i64()), Some(7));
        assert_eq!(press(&actions, "KEY(Save)"), None);
        assert_eq!(press(&actions, "Confirm"), None);
        assert_eq!(press(&actions, "KEY()"), None);
        assert_eq!(key_name("KEY(Up)"), Some("Up"));
        assert_eq!(outcome(&actions, "KEY(Confirm)"), Press::Action(serde_json::json!({ "key": "Confirm", "code": 7, "name": "X", "hold_ms": null })));
        assert_eq!(outcome(&actions, "KEY(Save)"), Press::NotPressed(serde_json::json!({ "answer": "KEY(Save)", "key": "Cmd+S" })));
        assert_eq!(outcome(&actions, "KEY(Jump)"), Press::Nothing);
    }

    #[test]
    fn an_empty_input_is_asked_with_the_files_own_question() {
        let actions = serde_json::json!({ "format_version": 1, "question": "What do you do next?" });
        assert_eq!(input_or_question("  ", Some(&actions)), "What do you do next?");
        assert_eq!(input_or_question("go left", Some(&actions)), "go left");
        assert_eq!(input_or_question("", None), "");
    }

    #[test]
    fn an_actions_file_a_host_cannot_act_on_is_named_by_cause() {
        let ok = br#"{"format_version":1,"keys":{"Up":{"code":126}},"not_pressed":[],"frames":{"stack":1,"gap_ms":250,"max_side":768}}"#;
        assert!(read(ok).is_ok());
        assert!(read(br#"{"format_version":1,"frames":{"stack":1,"max_side":768}}"#).is_ok(), "no keys is an empty list");
        let cause = |raw: &str| read(raw.as_bytes()).unwrap_err().cause;
        let frames = r#""frames":{"stack":1,"max_side":768}"#;
        assert_eq!(cause("not json"), "unreadable");
        assert_eq!(cause("[]"), "unreadable");
        assert_eq!(cause(&format!(r#"{{{frames}}}"#)), "no_version", "D67");
        assert_eq!(cause(&format!(r#"{{"format_version":"1",{frames}}}"#)), "no_version");
        assert_eq!(cause(&format!(r#"{{"format_version":1.5,{frames}}}"#)), "no_version");
        assert_eq!(cause(&format!(r#"{{"format_version":2,{frames}}}"#)), "newer", "D66");
        assert_eq!(cause(r#"{"format_version":1}"#), "no_frames", "D69");
        assert_eq!(cause(&format!(r#"{{"format_version":1,"keys":[],{frames}}}"#)), "keys");
        assert_eq!(cause(r#"{"format_version":1,"frames":{"stack":1,"max_side":768,"crop":[0,0,1]}}"#), "crop");
        assert_eq!(cause(r#"{"format_version":1,"frames":{"stack":1,"max_side":768,"crop":[0,0,0.009,1]}}"#), "crop", "under 1%");
        assert_eq!(cause(r#"{"format_version":1,"frames":{"stack":1,"max_side":768,"crop":[0,0,0.01,1]}}"#), "crop", "1% or less");
        assert_eq!(cause(r#"{"format_version":1,"frames":{"stack":1,"max_side":768,"crop":[1.2,0,0.5,1]}}"#), "crop", "D70: trimmed, it keeps nothing");
        assert!(read(br#"{"format_version":1,"frames":{"stack":1,"max_side":768,"crop":[0.75,0,0.5,1]}}"#).is_ok(), "D70: past the edge is trimmed, not refused");
        assert!(read(br#"{"format_version":1,"frames":{"stack":1,"max_side":768,"crop":[0.99,0,0.5,1]}}"#).is_ok(), "D75: 1 - 0.99 is a hair above 1%, and followed");
        assert_eq!(cause(r#"{"format_version":1,"frames":{"stack":2,"max_side":768}}"#), "gap", "D72");
        assert_eq!(cause(r#"{"format_version":1,"frames":{"stack":2,"gap_ms":-1,"max_side":768}}"#), "gap", "D76");
        assert!(read(br#"{"format_version":1,"frames":{"stack":2,"gap_ms":0,"max_side":768}}"#).is_ok(), "D76: 0 is a time");
        assert_eq!(cause(r#"{"format_version":1,"frames":{"stack":1,"gap_ms":-1,"max_side":768}}"#), "gap", "D76: given, so at least 0, even unstacked");
        assert_eq!(cause(r#"{"format_version":1,"frames":{"stack":1,"max_side":768.5}}"#), "max_side", "D77");
        assert_eq!(cause(r#"{"format_version":1,"frames":{"stack":5,"max_side":768}}"#), "stack");
        assert_eq!(cause(r#"{"format_version":1,"frames":{"max_side":768}}"#), "stack");
        assert_eq!(cause(r#"{"format_version":1,"frames":{"stack":1,"max_side":63}}"#), "max_side");
        assert_eq!(usable(ok, false).unwrap_err().cause, "no_pictures");
    }

    #[test]
    fn a_key_with_a_bad_code_is_not_listed_and_the_others_still_work() {
        let actions = serde_json::json!({ "keys": { "Up": { "code": 126 }, "Jump": { "code": 900 }, "Fly": { "code": "7" }, "Swim": {}, "Dive": 7 } });
        assert!(press(&actions, "KEY(Up)").is_some());
        for bad in ["Jump", "Fly", "Swim", "Dive"] {
            assert_eq!(press(&actions, &format!("KEY({bad})")), None, "{bad}");
        }
    }

    /// The numbers Eye.swift's own self-test checks (`capture_size_fits_the_kept_part`),
    /// and the rounding §13.2 pins. The kit's `frames` group has the rest.
    #[test]
    fn the_capture_size_and_crop_are_eyes_arithmetic() {
        let frames = |crop: Option<[f64; 4]>| serde_json::json!({ "stack": 1, "gap_ms": 250, "max_side": 768, "crop": crop });
        let rect = |x, y, width, height| Rect { x, y, width, height };
        let half = capture_plan(3200.0, 2000.0, &frames(Some([0.0, 0.0, 0.5, 0.5]))).unwrap();
        assert_eq!((half.width, half.height, half.kept), (1536, 960, rect(0, 0, 768, 480)));
        let whole = capture_plan(3200.0, 2000.0, &frames(None)).unwrap();
        assert_eq!((whole.width, whole.height, whole.kept), (768, 480, rect(0, 0, 768, 480)));
        // Never enlarged.
        let small = capture_plan(320.0, 200.0, &frames(None)).unwrap();
        assert_eq!((small.width, small.height), (320, 200));
        // Each side rounded on its own, halves away from zero.
        let odd = capture_plan(1001.0, 999.0, &frames(Some([0.25, 0.1, 0.5, 0.8]))).unwrap();
        let k: f64 = 768.0 / (999.0 * 0.8);
        assert_eq!((odd.width, odd.height), ((1001.0 * k).round() as u32, (999.0 * k).round() as u32));
        assert_eq!(odd.kept.x, (0.25 * odd.width as f64).round() as u32);
        // D70: trimmed before the scale, so the trimmed size decides k.
        let past = capture_plan(3200.0, 2000.0, &frames(Some([0.9, 0.0, 0.5, 0.1]))).unwrap();
        assert_eq!((past.width, past.height, past.kept), (3200, 2000, rect(2880, 0, 320, 200)));
        let left = capture_plan(1000.0, 1000.0, &frames(Some([-0.1, 0.0, 0.5, 1.0]))).unwrap();
        assert_eq!(left.kept, rect(0, 0, 384, 768), "x moved to 0, the width kept at half");
        // A crop that keeps nothing of this window is not a whole-window fallback.
        assert_eq!(capture_plan(3200.0, 2000.0, &frames(Some([1.5, 0.0, 0.5, 0.5]))), None);
        assert_eq!(capture_plan(6000.0, 300.0, &frames(Some([0.0, 0.0, 1.0, 0.012]))), None, "rounds to under a pixel");
        assert_eq!(capture_plan(3200.0, 2000.0, &serde_json::json!({ "stack": 9, "max_side": 768 })), None);
    }
}
