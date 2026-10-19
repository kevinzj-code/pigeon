//! The model store: every model this Mac keeps, in Pigeon's `models/` folder.
//!
//! Decided 2026-09-21: models live in Pigeon, and Flight School borrows them.
//! Pigeon's own running copies sit at the top of `models/` as they always
//! have (`weights::own_dir`). Beside them now:
//!
//! ```text
//!   projectors/          vision projectors
//!   training/            the MLX copies Flight School trains from (HF layout)
//!   borrowers/<app>.json which of these another app relies on
//! ```
//!
//! Each borrowing app writes its own file under `borrowers/`; Pigeon only
//! reads them. That is what lets Pigeon say "Flight School uses this" before
//! removing a file — and why it asks, rather than refuses: the person may mean
//! it. A removal goes to the Trash, never straight off the disk.

use serde::Serialize;
use std::path::{Component, Path, PathBuf};
use tauri::AppHandle;

use crate::manifest;
use crate::weights;

/// One thing in the store, as Settings lists it.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Stored {
    /// Store-relative path: `Qwen2.5-1.5B-Instruct-Q4_K_M.gguf`,
    /// `projectors/…`, `training/hub/models--…`.
    pub path: String,
    pub name: String,
    pub bytes: u64,
    /// "model" · "projector" · "training copy"
    pub kind: String,
    /// Who relies on it, in words: "Pigeon — the planner", "Flight School".
    pub used_by: Vec<String>,
    /// Apps OTHER than Pigeon that rely on it — the ones removal must ask about.
    pub borrowers: Vec<String>,
}

/* Links are not followed: a Hugging Face cache keeps each file once under
   blobs/ and links to it from snapshots/, so following them counts every
   training copy twice. A top-level model that IS a link still counts, through
   the caller's own metadata, because list_in only walks real folders. */
fn size_of(p: &Path) -> u64 {
    let Ok(m) = std::fs::symlink_metadata(p) else { return 0 };
    if m.is_file() { return m.len(); }
    if m.is_dir() {
        return std::fs::read_dir(p).map(|rd| rd.flatten().map(|e| size_of(&e.path())).sum()).unwrap_or(0);
    }
    0
}

/// `borrowers/*.json` as (app name, store-relative paths). An entry covers
/// everything under it: "training/hub" borrows every training copy.
pub fn borrowers_in(store: &Path) -> Vec<(String, Vec<String>)> {
    let Ok(rd) = std::fs::read_dir(store.join("borrowers")) else { return Vec::new() };
    let mut out = Vec::new();
    for e in rd.flatten() {
        if e.path().extension().is_none_or(|x| x != "json") { continue; }
        let Ok(text) = std::fs::read_to_string(e.path()) else { continue };
        let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) else { continue };
        let app = v.get("app").and_then(|a| a.as_str()).unwrap_or("Another app").to_string();
        let files = v.get("files").and_then(|f| f.as_array())
            .map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect()).unwrap_or_default();
        out.push((app, files));
    }
    out.sort();
    out
}

fn covers(entry: &str, path: &str) -> bool {
    path == entry || path.starts_with(&format!("{}/", entry.trim_end_matches('/'))) || entry.starts_with(&format!("{path}/"))
}

pub fn borrowers_of(store: &Path, path: &str) -> Vec<String> {
    borrowers_in(store).into_iter().filter(|(_, fs)| fs.iter().any(|f| covers(f, path))).map(|(a, _)| a).collect()
}

/// What Pigeon itself runs from the store, by file name.
fn pigeon_uses(file: &str) -> Option<String> {
    let m = manifest::manifest().ok()?;
    for spec in &m.models {
        if spec.file == file {
            return Some(match spec.role.as_str() {
                "category" => "Pigeon — the router and every text Pigeon".into(),
                other => format!("Pigeon — {other}"),
            });
        }
    }
    None
}

/// Everything in the store, largest first. Pure over a folder, so it tests
/// without an app.
pub fn list_in(store: &Path, pigeon: impl Fn(&str) -> Option<String>) -> Vec<Stored> {
    let mut out = Vec::new();
    let mut push = |path: String, name: String, full: &Path, kind: &str| {
        let borrowers = borrowers_of(store, &path);
        let mut used_by: Vec<String> = pigeon(&name).into_iter().collect();
        used_by.extend(borrowers.iter().cloned());
        out.push(Stored { bytes: size_of(full), path, name, kind: kind.into(), used_by, borrowers });
    };
    if let Ok(rd) = std::fs::read_dir(store) {
        for e in rd.flatten() {
            let name = e.file_name().to_string_lossy().into_owned();
            if e.path().is_file() && name.ends_with(".gguf") { push(name.clone(), name, &e.path(), "model"); }
        }
    }
    if let Ok(rd) = std::fs::read_dir(store.join("projectors")) {
        for e in rd.flatten() {
            let name = e.file_name().to_string_lossy().into_owned();
            if name.ends_with(".gguf") { push(format!("projectors/{name}"), name, &e.path(), "projector"); }
        }
    }
    if let Ok(rd) = std::fs::read_dir(store.join("training").join("hub")) {
        for e in rd.flatten() {
            let dir = e.file_name().to_string_lossy().into_owned();
            let Some(repo) = dir.strip_prefix("models--") else { continue };
            let size = size_of(&e.path());
            if size < 1_000_000 { continue; } // an empty or aborted download
            push(format!("training/hub/{dir}"), repo.replacen("--", "/", 1), &e.path(), "training copy");
        }
    }
    out.sort_by(|a, b| b.bytes.cmp(&a.bytes));
    out
}

/// A store-relative path the page may name: no parent steps, no absolute
/// paths, nothing outside the three places models live.
fn safe_relative(path: &str) -> Option<PathBuf> {
    let p = Path::new(path);
    if p.components().any(|c| !matches!(c, Component::Normal(_))) { return None; }
    let first = p.components().next()?.as_os_str().to_string_lossy().into_owned();
    let top_level_model = p.components().count() == 1 && first.ends_with(".gguf");
    (top_level_model || first == "projectors" || first == "training").then(|| p.to_path_buf())
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(tag = "status", rename_all = "kebab-case")]
pub enum RemoveOutcome {
    /// Another app relies on it. Nothing was touched; ask, then call again
    /// with `confirmed`.
    NeedsConfirm { borrowers: Vec<String> },
    /// In the Trash.
    Removed { bytes: u64 },
}

/// Moves one stored file to the Trash. `trash` is where; the app passes
/// ~/.Trash, tests pass a temp folder.
pub fn remove_in(store: &Path, trash: &Path, path: &str, confirmed: bool) -> Result<RemoveOutcome, String> {
    /* The page names an ENTRY from this store's own list, never a place: a
       name the listing did not produce is refused before anything is built
       from it. `safe_relative` is the second lock on the same door. */
    if !list_in(store, |_| None).iter().any(|x| x.path == path) {
        return Err(format!("“{path}” is not a model this store keeps"));
    }
    let rel = safe_relative(path).ok_or_else(|| format!("“{path}” is not a model this store keeps"))?;
    let full = store.join(&rel);
    if !full.exists() { return Err(format!("“{path}” is not on this Mac any more")); }
    let borrowers = borrowers_of(store, path);
    if !borrowers.is_empty() && !confirmed {
        return Ok(RemoveOutcome::NeedsConfirm { borrowers });
    }
    let bytes = size_of(&full);
    std::fs::create_dir_all(trash).map_err(|e| e.to_string())?;
    let name = rel.file_name().unwrap().to_string_lossy().into_owned();
    let mut dest = trash.join(&name);
    let mut n = 2;
    while dest.exists() { dest = trash.join(format!("{name} {n}")); n += 1; }
    std::fs::rename(&full, &dest).map_err(|e| format!("could not move “{name}” to the Trash: {e}"))?;
    Ok(RemoveOutcome::Removed { bytes })
}

fn trash_dir() -> Result<PathBuf, String> {
    let home = std::env::var_os("HOME").ok_or("no home folder")?;
    Ok(PathBuf::from(home).join(".Trash"))
}

#[tauri::command]
pub fn models_on_this_mac<R: tauri::Runtime>(app: AppHandle<R>) -> Result<Vec<Stored>, String> {
    let store = weights::own_dir(&app)?;
    /* Picture Pigeons name their base by file and their projector by hash;
       a projector's hash is what the app's hash cache knows of it. */
    let pictures: Vec<(String, String, String)> = weights::personas(&app)
        .into_iter()
        .filter_map(|p| Some((p.name, p.contract.base_file?, p.contract.projector?)))
        .collect();
    let hashes = crate::hashes::of(&app);
    let marker = |name: &str| hashes.known(&store.join("projectors").join(name));
    Ok(list_in(&store, |name| {
        pigeon_uses(name).or_else(|| {
            let sha = marker(name);
            let who: Vec<&str> = pictures
                .iter()
                .filter(|(_, base, proj)| base == name || sha.as_deref().map(str::trim) == Some(proj.as_str()))
                .map(|(n, _, _)| n.as_str())
                .collect();
            (!who.is_empty()).then(|| format!("Pigeon — {}", who.join(", ")))
        })
    }))
}

#[tauri::command]
pub fn models_remove<R: tauri::Runtime>(app: AppHandle<R>, path: String, confirmed: bool) -> Result<RemoveOutcome, String> {
    remove_in(&weights::own_dir(&app)?, &trash_dir()?, &path, confirmed)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("pigeon-test-modelstore-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }
    fn borrow(store: &Path, files: &[&str]) {
        std::fs::create_dir_all(store.join("borrowers")).unwrap();
        std::fs::write(store.join("borrowers/flight-school.json"),
            serde_json::json!({ "app": "Flight School", "files": files }).to_string()).unwrap();
    }

    #[test]
    fn lists_models_projectors_and_training_copies_with_who_uses_them() {
        let s = tmp("list");
        std::fs::write(s.join("teacher.gguf"), vec![0u8; 30]).unwrap();
        std::fs::write(s.join("router.gguf"), vec![0u8; 20]).unwrap();
        std::fs::create_dir_all(s.join("projectors")).unwrap();
        std::fs::write(s.join("projectors/p.gguf"), vec![0u8; 10]).unwrap();
        std::fs::create_dir_all(s.join("training/hub/models--mlx-community--Qwen-VL")).unwrap();
        std::fs::write(s.join("training/hub/models--mlx-community--Qwen-VL/w"), vec![0u8; 2_000_000]).unwrap();
        borrow(&s, &["teacher.gguf", "training/hub"]);
        let got = list_in(&s, |f| (f == "router.gguf").then(|| "Pigeon — the router".to_string()));
        let find = |p: &str| got.iter().find(|x| x.path == p).unwrap();
        assert_eq!(find("training/hub/models--mlx-community--Qwen-VL").name, "mlx-community/Qwen-VL");
        assert_eq!(find("training/hub/models--mlx-community--Qwen-VL").borrowers, vec!["Flight School"]);
        assert_eq!(find("teacher.gguf").used_by, vec!["Flight School"]);
        assert_eq!(find("router.gguf").used_by, vec!["Pigeon — the router"]);
        assert!(find("router.gguf").borrowers.is_empty());
        assert_eq!(find("projectors/p.gguf").kind, "projector");
        assert_eq!(got[0].path, "training/hub/models--mlx-community--Qwen-VL", "largest first");
    }

    #[test]
    fn removing_a_borrowed_file_asks_first_then_goes_to_the_trash() {
        let s = tmp("rm");
        let trash = tmp("rm-trash");
        std::fs::write(s.join("teacher.gguf"), b"weights").unwrap();
        borrow(&s, &["teacher.gguf"]);
        assert_eq!(remove_in(&s, &trash, "teacher.gguf", false).unwrap(),
            RemoveOutcome::NeedsConfirm { borrowers: vec!["Flight School".into()] });
        assert!(s.join("teacher.gguf").exists(), "asking touches nothing");
        assert_eq!(remove_in(&s, &trash, "teacher.gguf", true).unwrap(), RemoveOutcome::Removed { bytes: 7 });
        assert!(!s.join("teacher.gguf").exists());
        assert_eq!(std::fs::read(trash.join("teacher.gguf")).unwrap(), b"weights");
    }

    #[test]
    fn a_file_nobody_borrows_goes_without_asking() {
        let s = tmp("free");
        let trash = tmp("free-trash");
        std::fs::write(s.join("old.gguf"), b"x").unwrap();
        assert_eq!(remove_in(&s, &trash, "old.gguf", false).unwrap(), RemoveOutcome::Removed { bytes: 1 });
    }

    #[test]
    fn the_page_cannot_name_anything_outside_the_store() {
        let s = tmp("escape");
        let trash = tmp("escape-trash");
        for bad in ["../state.json", "/etc/hosts", "borrowers/flight-school.json", "adapters/x.lora.gguf", "training/../../x"] {
            assert!(remove_in(&s, &trash, bad, true).is_err(), "{bad} should be refused");
        }
    }
}

/// This Mac's real store, as Settings would list it:
///   cargo test -- --ignored list_this_macs_store --nocapture
#[cfg(test)]
mod real {
    #[test]
    #[ignore]
    fn list_this_macs_store() {
        let home = std::path::PathBuf::from(std::env::var_os("HOME").unwrap());
        let store = home.join("Library/Application Support/mode.airoplane.pigeon/models");
        for m in super::list_in(&store, super::pigeon_uses) {
            println!("{:>7.2} GB  {:<14} {:<44} {}", m.bytes as f64 / 1e9, m.kind, m.name, if m.used_by.is_empty() { "—".into() } else { m.used_by.join(", ") });
        }
    }
}
