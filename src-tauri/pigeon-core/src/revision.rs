//! A retrained Pigeon does not simply replace the one it retrains
//! (decided 2026-09-21: "the old one stays live until the new one passes").
//!
//! Importing a Pigeon whose id is already here sets the old files aside in
//! `adapters/previous/<id>/` and installs the new ones. The new revision is
//! then asked its own carried examples (`pigeon_check_ride`):
//!
//! - all right → the old one goes to the Trash;
//! - any wrong → the two SWAP: the old one is live again, the new one waits
//!   in `previous/`, and the person may still choose it ("Use the new one").
//!
//! Nothing is ever deleted outright; what goes, goes to the Trash. Only one
//! revision is kept aside per Pigeon — a third import sends the oldest to the
//! Trash.

use std::path::{Path, PathBuf};

pub const DIR: &str = "previous";

/// A payload kept beside its adapter — `<id>.material.json` or
/// `<id>.skill.json`. Read on every run, so it is copied out of the archive
/// once rather than re-read from a `.pigeon` that also holds a whole adapter.
pub fn payload_path(adapters: &Path, id: &str, what: &str) -> PathBuf {
    adapters.join(format!("{id}.{what}.json"))
}

/// Kept beside the adapter as `<id>.icon.png`.
pub fn icon_path(adapters: &Path, id: &str) -> PathBuf {
    adapters.join(format!("{id}.icon.png"))
}

/// Every file that makes up one installed Pigeon, as (where it lives, its
/// name). The kept `.pigeon` lives in a different folder from the rest.
fn parts(adapters: &Path, pigeons: &Path, id: &str) -> Vec<PathBuf> {
    vec![
        adapters.join(format!("{id}.lora.gguf")),
        adapters.join(format!("{id}.lora.json")),
        icon_path(adapters, id),
        payload_path(adapters, id, "skill"),
        payload_path(adapters, id, "material"),
        payload_path(adapters, id, "actions"),
        pigeons.join(format!("{id}.pigeon")),
    ]
}

fn aside(adapters: &Path, id: &str) -> PathBuf {
    adapters.join(DIR).join(id)
}

/// The same rule `pigeon::plain_id` applies at import, applied again here
/// because every function below turns `id` into a directory name and a
/// Trash label. A bad id is a refusal, never a path.
fn checked(id: &str) -> Result<(), String> {
    if crate::manifest::plain_id(id) {
        Ok(())
    } else {
        Err(format!("\"{id}\" is not a Pigeon's id"))
    }
}

/// Whether `dir` holds Pigeon `id`: its adapter, or its sidecar alone — a
/// base Pigeon (D83) carries no adapter, so its sidecar is what is installed.
fn holds(dir: &Path, id: &str) -> bool {
    dir.join(format!("{id}.lora.gguf")).is_file() || dir.join(format!("{id}.lora.json")).is_file()
}

pub fn has_previous(adapters: &Path, id: &str) -> bool {
    holds(&aside(adapters, id), id)
}

/// Moved into `trash` under its own name, numbered when that is taken.
pub fn to_trash(path: &Path, trash: &Path, label: &str) -> Result<(), String> {
    std::fs::create_dir_all(trash).map_err(|e| e.to_string())?;
    let mut dest = trash.join(label);
    let mut n = 2;
    while dest.exists() {
        dest = trash.join(format!("{label} {n}"));
        n += 1;
    }
    std::fs::rename(path, &dest).map_err(|e| format!("could not move {label} to the Trash: {e}"))
}

/// Before a new revision is installed over `id`: the current files go aside.
/// Returns whether there was anything to set aside.
pub fn set_aside(adapters: &Path, pigeons: &Path, id: &str, trash: &Path) -> Result<bool, String> {
    checked(id)?;
    if !holds(adapters, id) {
        return Ok(false);
    }
    let dir = aside(adapters, id);
    if dir.exists() {
        to_trash(&dir, trash, &format!("{id} (older Pigeon)"))?;
    }
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    for p in parts(adapters, pigeons, id).into_iter().filter(|p| p.exists()) {
        std::fs::rename(&p, dir.join(p.file_name().unwrap())).map_err(|e| format!("could not set the old Pigeon aside: {e}"))?;
    }
    Ok(true)
}

/// The live revision and the one aside change places.
pub fn swap(adapters: &Path, pigeons: &Path, id: &str) -> Result<(), String> {
    checked(id)?;
    let dir = aside(adapters, id);
    if !has_previous(adapters, id) {
        return Err(format!("there is no other version of \"{id}\" on this Mac"));
    }
    let hold = adapters.join(DIR).join(format!("{id}.swapping"));
    let _ = std::fs::remove_dir(&hold);
    std::fs::create_dir_all(&hold).map_err(|e| e.to_string())?;
    let live: Vec<PathBuf> = parts(adapters, pigeons, id).into_iter().filter(|p| p.exists()).collect();
    for p in &live {
        std::fs::rename(p, hold.join(p.file_name().unwrap())).map_err(|e| e.to_string())?;
    }
    for p in parts(adapters, pigeons, id) {
        let from = dir.join(p.file_name().unwrap());
        if from.exists() {
            std::fs::rename(&from, &p).map_err(|e| e.to_string())?;
        }
    }
    std::fs::remove_dir(&dir).map_err(|e| e.to_string())?;
    std::fs::rename(&hold, &dir).map_err(|e| e.to_string())
}

/// The revision aside is no longer wanted: to the Trash.
pub fn settle(adapters: &Path, id: &str, trash: &Path) -> Result<bool, String> {
    checked(id)?;
    let dir = aside(adapters, id);
    if !dir.exists() {
        return Ok(false);
    }
    to_trash(&dir, trash, &format!("{id} (older Pigeon)"))?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> (PathBuf, PathBuf, PathBuf) {
        let d = std::env::temp_dir().join(format!("pigeon-test-revision-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        let (a, p, t) = (d.join("adapters"), d.join("pigeons"), d.join("Trash"));
        for x in [&a, &p] {
            std::fs::create_dir_all(x).unwrap();
        }
        (a, p, t)
    }
    fn install(a: &Path, p: &Path, id: &str, v: &str) {
        std::fs::write(a.join(format!("{id}.lora.gguf")), v).unwrap();
        std::fs::write(a.join(format!("{id}.lora.json")), v).unwrap();
        std::fs::write(p.join(format!("{id}.pigeon")), v).unwrap();
    }
    fn live(a: &Path, id: &str) -> String {
        std::fs::read_to_string(a.join(format!("{id}.lora.gguf"))).unwrap()
    }

    #[test]
    fn an_id_that_walks_out_of_the_folder_is_refused_and_nothing_moves() {
        let (a, p, t) = tmp("walk");
        let outside = a.parent().unwrap().join("Documents");
        std::fs::create_dir_all(&outside).unwrap();
        std::fs::write(a.join("previous").join("x"), "").ok();
        for bad in ["../Documents", "/tmp/x", "..", ""] {
            assert!(set_aside(&a, &p, bad, &t).is_err());
            assert!(swap(&a, &p, bad).is_err());
            assert!(settle(&a, bad, &t).is_err());
        }
        assert!(outside.is_dir(), "the folder next door is untouched");
        assert!(!t.exists(), "nothing went to the Trash");
    }

    #[test]
    fn a_new_revision_sets_the_old_aside_and_they_can_trade_places() {
        let (a, p, t) = tmp("swap");
        assert!(!set_aside(&a, &p, "dogs", &t).unwrap(), "nothing to set aside the first time");
        install(&a, &p, "dogs", "old");
        assert!(set_aside(&a, &p, "dogs", &t).unwrap());
        assert!(!a.join("dogs.lora.gguf").exists() && has_previous(&a, "dogs"));
        install(&a, &p, "dogs", "new");
        swap(&a, &p, "dogs").unwrap();
        assert_eq!(live(&a, "dogs"), "old");
        assert_eq!(std::fs::read_to_string(p.join("dogs.pigeon")).unwrap(), "old", "the kept file travels with it");
        swap(&a, &p, "dogs").unwrap();
        assert_eq!(live(&a, "dogs"), "new");
        assert!(settle(&a, "dogs", &t).unwrap());
        assert!(!has_previous(&a, "dogs"));
        assert!(t.join("dogs (older Pigeon)").join("dogs.lora.gguf").is_file(), "the old one is in the Trash, not gone");
        let _ = std::fs::remove_dir_all(a.parent().unwrap());
    }

    /// D83: a base Pigeon is its sidecar and kept file, with no adapter. It is
    /// set aside and swapped like any other, and an adapter from a trained
    /// revision never stays live beside it.
    #[test]
    fn a_base_pigeon_with_no_adapter_is_a_revision_too() {
        let (a, p, t) = tmp("base");
        install(&a, &p, "plain", "trained");
        assert!(set_aside(&a, &p, "plain", &t).unwrap());
        std::fs::write(a.join("plain.lora.json"), "base").unwrap();
        std::fs::write(p.join("plain.pigeon"), "base").unwrap();
        assert!(!a.join("plain.lora.gguf").exists(), "the trained revision's adapter went aside with it");
        swap(&a, &p, "plain").unwrap();
        assert_eq!(live(&a, "plain"), "trained");
        swap(&a, &p, "plain").unwrap();
        assert!(!a.join("plain.lora.gguf").exists(), "the base revision is live again, with no adapter");
        assert_eq!(std::fs::read_to_string(a.join("plain.lora.json")).unwrap(), "base");
        // A base revision over a base revision is set aside by its sidecar alone.
        settle(&a, "plain", &t).unwrap();
        assert!(set_aside(&a, &p, "plain", &t).unwrap() && has_previous(&a, "plain"));
        let _ = std::fs::remove_dir_all(a.parent().unwrap());
    }
}
