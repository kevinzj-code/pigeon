//! Pigeon's one file on disk.
//!
//! The page hands over a JSON string. It does NOT hand over a path — the path is
//! built here from `app_data_dir`, the same way `llm_base_for` builds an address
//! from a loopback constant and `web_search` builds a URL from a compile-time
//! host. That is the whole invariant: the webview names *what* to store, never
//! *where*, so this command cannot be talked into writing somewhere else.
//!
//! Writes go to a temporary file and are renamed into place. A rename within one
//! directory is atomic on every filesystem this ships to, so a crash or a power
//! cut mid-write leaves the previous transcript intact rather than a truncated
//! one. Losing the last exchange is a nuisance; losing the file is not.
//!
//! The two halves are split deliberately: `write_atomic` and `read_opt` take a
//! path and nothing else, so they are testable without an `AppHandle`, and the
//! `#[tauri::command]` wrappers do nothing but resolve the directory.

use std::fs;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

/// Write `json` to `path` without ever leaving a half-written file there.
fn write_atomic(path: &Path, json: &str) -> Result<(), String> {
    // The path is this app's own and was built here, so naming it in the error
    // helps nobody: what the reader can act on is the reason the OS gave.
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, json.as_bytes()).map_err(|e| format!("your chats could not be written to this Mac — {e}"))?;
    fs::rename(&tmp, path).map_err(|e| {
        // The temp file is litter if the rename failed; do not leave it behind.
        let _ = fs::remove_file(&tmp);
        format!("your chats could not be saved — {e}")
    })
}

/// Read `path`, treating "not there yet" as a normal answer rather than an
/// error — it is what the very first launch looks like, and the frontend needs
/// to tell it apart from a real failure.
fn read_opt(path: &Path) -> Result<Option<String>, String> {
    match fs::read_to_string(path) {
        Ok(s) => Ok(Some(s)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("your chats are on this Mac but could not be read — {e}")),
    }
}

fn state_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(crate::weights::app_subdir(app, "")?.join("state.json"))
}

/// Where each chat lives: `app_data_dir/chats/<id>.json`. `state.json` is the
/// index — settings, the active chat, the chat ids in order — so a reaction
/// in one chat rewrites that chat's file and the small index, never every
/// conversation the person has ever had. A `state.json` from before this
/// layout carries the chats inline; it is read as it is, and the page's next
/// save writes the new layout over it.
fn chats_dir(app: &AppHandle) -> Result<PathBuf, String> {
    crate::weights::app_subdir(app, "chats")
}

/// A chat's id as the page made it: letters, digits, `-` and `_` — one file
/// name component, never a path.
fn chat_file_ok(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

fn chat_path(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    if !chat_file_ok(id) {
        return Err(format!("\"{id}\" is not a chat id"));
    }
    Ok(chats_dir(app)?.join(format!("{id}.json")))
}

/// The index plus every chat it names, as the one blob the page has always
/// read. Pure over the two roots, so the tests can build a folder and read it.
fn assemble(index_raw: &str, chats: &Path) -> String {
    let Ok(mut v) = serde_json::from_str::<serde_json::Value>(index_raw) else { return index_raw.to_string() };
    let Some(ids) = v.get("chatIds").and_then(|x| x.as_array()).cloned() else { return index_raw.to_string() };
    let mut list = Vec::with_capacity(ids.len());
    let mut named = std::collections::HashSet::new();
    for id in ids.iter().filter_map(|x| x.as_str()).filter(|id| chat_file_ok(id)) {
        named.insert(format!("{id}.json"));
        let Ok(raw) = fs::read_to_string(chats.join(format!("{id}.json"))) else { continue };
        if let Ok(c) = serde_json::from_str::<serde_json::Value>(&raw) {
            list.push(c);
        }
    }
    /* A file the index does not name is a save that never finished (or a chat
       deleted while its file could not be): not a chat any more. */
    if let Ok(rd) = fs::read_dir(chats) {
        for e in rd.filter_map(|e| e.ok()) {
            let name = e.file_name().to_string_lossy().to_string();
            if name.ends_with(".json") && !named.contains(&name) {
                let _ = fs::remove_file(e.path());
            }
        }
    }
    if let Some(o) = v.as_object_mut() {
        o.remove("chatIds");
        o.insert("chats".into(), serde_json::Value::Array(list));
    }
    serde_json::to_string(&v).unwrap_or_else(|_| index_raw.to_string())
}

/// `settings.theme` from the saved file, read before the window is shown so
/// its first frame is the right colour rather than light paper under a dark
/// page. Nothing else is read; a missing or unreadable file is None.
pub fn saved_theme(app: &AppHandle) -> Option<String> {
    let raw = std::fs::read_to_string(state_path(app).ok()?).ok()?;
    let v: serde_json::Value = serde_json::from_str(&raw).ok()?;
    v.get("settings")?.get("theme")?.as_str().map(String::from)
}

/// The saved chats, or None on a first launch.
#[tauri::command]
pub async fn load_state(app: AppHandle) -> Result<Option<String>, String> {
    let Some(raw) = read_opt(&state_path(&app)?)? else { return Ok(None) };
    Ok(Some(assemble(&raw, &chats_dir(&app)?)))
}

/// Replace the index — settings, the active chat, the chat ids. The page
/// supplies the JSON; it never supplies a path. Written after the chats it
/// names, by the page's own ordering, so a crash between the two leaves the
/// old index over files it does not name, and nothing is lost.
#[tauri::command]
pub async fn save_state(app: AppHandle, json: String) -> Result<(), String> {
    write_atomic(&state_path(&app)?, &json)
}

/// One chat, by the id the page gave it.
#[tauri::command]
pub async fn save_chat(app: AppHandle, id: String, json: String) -> Result<(), String> {
    write_atomic(&chat_path(&app, &id)?, &json)
}

/// A deleted chat's file. Gone is gone: a missing file is not an error.
#[tauri::command]
pub async fn remove_chat(app: AppHandle, id: String) -> Result<(), String> {
    match fs::remove_file(chat_path(&app, &id)?) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("the chat could not be removed — {e}")),
    }
}

/// The two settings the menu-bar windows draw with — the theme and how long
/// the last wake took — read from the index alone, so a window that shows
/// one line never parses every chat to find it.
#[tauri::command]
pub async fn settings_peek(app: AppHandle) -> Result<serde_json::Value, String> {
    let raw = read_opt(&state_path(&app)?)?.unwrap_or_default();
    let v: serde_json::Value = serde_json::from_str(&raw).unwrap_or(serde_json::Value::Null);
    let s = v.get("settings").cloned().unwrap_or(serde_json::Value::Null);
    Ok(serde_json::json!({
        "theme": s.get("theme").and_then(|t| t.as_str()),
        "lastWakeMs": s.get("lastWakeMs").and_then(|n| n.as_u64()),
        /* For Play from the menu bar and the summon bar: the game played last,
           and the way each game takes keys. */
        "playLastApp": s.get("playLastApp").and_then(|t| t.as_str()),
        "playHow": s.get("playHow").filter(|v| v.is_object()),
    }))
}

/// Move a state file this build cannot read out of the way, and answer with the
/// name it was given.
///
/// The page decides WHEN — it is the only side that knows the file would not
/// parse — and this decides WHERE, as everything else here does: a sibling of
/// `state.json` in the same directory, named after it, never a path that came
/// off the page. A rename within one directory, so the old file is never read,
/// copied or truncated; if the rename fails nothing has been touched and the
/// page holds its writes instead.
fn keep_aside(path: &Path, stamp: u64) -> Result<String, String> {
    let name = format!("state.unreadable-{stamp}.json");
    let dest = path.with_file_name(&name);
    fs::rename(path, &dest).map_err(|e| format!("the unreadable chats file could not be moved aside: {e}"))?;
    Ok(name)
}

#[tauri::command]
pub async fn keep_unreadable_state(app: AppHandle) -> Result<String, String> {
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    keep_aside(&state_path(&app)?, stamp)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let mut p = std::env::temp_dir();
        p.push(format!("pigeon-store-test-{name}.json"));
        let _ = fs::remove_file(&p);
        p
    }

    #[test]
    fn a_missing_file_is_not_an_error() {
        let p = scratch("missing");
        assert_eq!(read_opt(&p).expect("missing should be Ok"), None);
    }

    #[test]
    fn what_goes_in_comes_back() {
        let p = scratch("roundtrip");
        let blob = r#"{"version":1,"chats":[{"id":"a","title":"Hello"}]}"#;
        write_atomic(&p, blob).expect("write");
        assert_eq!(read_opt(&p).expect("read"), Some(blob.to_string()));
        let _ = fs::remove_file(&p);
    }

    /// The atomicity contract, as an assertion: after a write there is exactly
    /// one file, holding the NEW content. A surviving `.json.tmp` would mean a
    /// crash could leave the two disagreeing about which is the real transcript.
    #[test]
    fn a_write_leaves_no_temporary_behind() {
        let p = scratch("atomic");
        write_atomic(&p, "{\"version\":1,\"chats\":[]}").expect("first write");
        write_atomic(&p, "{\"version\":1,\"chats\":[1]}").expect("second write");
        assert!(!p.with_extension("json.tmp").exists(), "a .json.tmp survived");
        assert_eq!(read_opt(&p).expect("read"), Some("{\"version\":1,\"chats\":[1]}".to_string()));
        let _ = fs::remove_file(&p);
    }

    /// The whole point of the command: after it, the unreadable file is still
    /// on disk under a name that says what it is, and `state.json` is gone —
    /// so the next save writes a fresh one instead of replacing a history
    /// somebody may still want back.
    #[test]
    fn an_unreadable_file_is_kept_under_a_new_name() {
        let p = scratch("keep");
        write_atomic(&p, "{ truncated").expect("write");
        let name = keep_aside(&p, 1_757_000_000).expect("rename");
        assert_eq!(name, "state.unreadable-1757000000.json");
        let kept = p.with_file_name(&name);
        assert!(!p.exists(), "the unreadable file was left where it was");
        assert_eq!(fs::read_to_string(&kept).expect("kept"), "{ truncated");
        let _ = fs::remove_file(&kept);
    }

    /// Nothing to move is an error, not a silent success: the page holds its
    /// writes on a failure, and "there was no file" must not read as "the file
    /// is safely aside".
    #[test]
    fn keeping_a_file_that_is_not_there_fails() {
        let p = scratch("keep-missing");
        assert!(keep_aside(&p, 1).is_err());
    }

    #[test]
    fn the_index_and_its_chat_files_read_as_one_blob_and_orphans_go() {
        let dir = std::env::temp_dir().join(format!("pigeon-store-test-chats-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("a.json"), r#"{"id":"a","title":"first"}"#).unwrap();
        fs::write(dir.join("b.json"), r#"{"id":"b","title":"second"}"#).unwrap();
        fs::write(dir.join("orphan.json"), r#"{"id":"orphan"}"#).unwrap();
        let index = r#"{"version":4,"settings":{"theme":"dark"},"activeChatId":"b","chatIds":["b","a","missing","../x"]}"#;
        let blob: serde_json::Value = serde_json::from_str(&assemble(index, &dir)).unwrap();
        let titles: Vec<&str> = blob["chats"].as_array().unwrap().iter().map(|c| c["title"].as_str().unwrap()).collect();
        assert_eq!(titles, vec!["second", "first"], "in the index's order, missing ones skipped");
        assert!(blob.get("chatIds").is_none());
        assert_eq!(blob["settings"]["theme"], "dark");
        assert!(!dir.join("orphan.json").exists(), "a file the index does not name is removed");
        // A file from before this layout carries its chats inline and is read as it is.
        let legacy = r#"{"version":4,"chats":[{"id":"z"}],"settings":{}}"#;
        assert_eq!(assemble(legacy, &dir), legacy);
        assert!(!chat_file_ok("../x") && !chat_file_ok("") && !chat_file_ok("a/b") && chat_file_ok("k3j2_9-x"));
        let _ = fs::remove_dir_all(&dir);
    }
}
