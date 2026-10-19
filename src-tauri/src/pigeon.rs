//! Importing a `.pigeon` (or `.nest`) file — the format Flight School trains
//! and packs — and running one: where it is installed, the commands the page
//! calls, and the events it hears.
//!
//! The READING is not here. `pigeon-core` (the workspace crate beside this
//! one) reads and checks a file exactly as the format spec says — the strict
//! ZIP, the manifest, the import check with its refusal codes, retrieval,
//! skills, seals — and is held to the spec's conformance kit. `validate` is
//! that check with this app's three answers filled in: the bases installed,
//! the projectors and embedding model on this Mac, and the keys it trusts.
//! The one rule the check exists for: an installed model with the same
//! identity as the one a Pigeon was trained on loads it, even at a different
//! quantization; a different model refuses and names the one needed.
//!
//! `install` only ever runs after `validate` has returned `Ok` — a file that
//! fails validation is never copied anywhere.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

use pigeon_core::{ask, check, material, nest, zip_store};
#[cfg(test)]
use pigeon_core::gguf;

use crate::weights;

/* The reader itself is `pigeon-core`: the strict ZIP, the manifest, the import
   check and its refusal codes, retrieval, skills and seals. What stays here is
   what only this app does — where a Pigeon is installed, the commands the page
   calls, and the events it hears. */
pub use pigeon_core::card::readable as card_readable;
pub use pigeon_core::check::{BaseMatch, InstalledBase, Refused, Report, MATERIAL_FILE, SKILLPACK, SUPPORTED_FORMAT_VERSION};
pub use pigeon_core::manifest::{plain_id, Manifest, PROJECTOR_FILE};
pub use pigeon_core::revision::{icon_path, payload_path};
pub use pigeon_core::{blob, revision, seal, skill};

/// Bumped when the sidecar learns a field an older one cannot be trusted to
/// lack. 2: `skill` and `retrieval` — before it, a grounded or skill Pigeon was
/// installed as though it were plain freeform.
pub const SIDECAR_VERSION: u32 = 9; // 3: the icon is kept beside the adapter; 4: the maker's card;
// 5: picture Pigeons — the projector, the base file and actions.json. A picture
// Pigeon an older Pigeon installed was written without them, looked like a
// text Pigeon, and never showed Play; at launch it is rebuilt from its kept file.
// 6: `answer_type` — a reasoned Pigeon's answer is the label or JSON inside its
// last <do>, and a sidecar without the field would match the whole text.
// 7: `base_identity` — a Pigeon accepted on another file of its base rides on
// the category server by identity, where before it was matched by file name and
// never loaded.
// 8: `notes` — every warning from the import check, kept so the Pigeon's page
// can show them after the Meet sheet has closed.
// 9: format Draft 8 — a crop past the window's edge is trimmed (D70), so a
// Pigeon whose actions.json was set aside for one now keeps it and plays; and
// stacked frames with no gap are the format's `actions_skipped` (D72), not this
// app's `cannot_play`. Its notes are worked out again.

/// One line of a trusted-keys file. The reader takes plain public keys; the
/// id and the revoked flag are this app's own bookkeeping — a key is revoked
/// by leaving it off the list the reader is given (format §15.2).
#[derive(Deserialize, Debug, Clone, PartialEq, Eq)]
pub struct TrustedKey {
    pub id: String,
    pub ed25519_pub_hex: String,
    #[serde(default)]
    pub revoked: bool,
}

/// A trusted-keys file: a JSON array of `{id, ed25519_pub_hex, revoked}`.
/// Refuses a malformed key, an id that is not the key's own, or an id listed
/// twice — a revocation must not be undone by a second, unrevoked copy.
pub fn parse_trusted(json: &str) -> Result<Vec<TrustedKey>, String> {
    let keys: Vec<TrustedKey> = serde_json::from_str(json).map_err(|e| format!("trusted keys could not be read — {e}"))?;
    let mut seen = std::collections::HashSet::new();
    for k in &keys {
        let lower_hex = k.ed25519_pub_hex.len() == 64 && k.ed25519_pub_hex.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b));
        if !lower_hex {
            return Err(format!("trusted key {} is not 64 lowercase hex characters", k.id));
        }
        if seal::key_id_of(&k.ed25519_pub_hex).as_deref() != Some(k.id.as_str()) {
            return Err(format!("trusted key {} does not have its own key's id", k.id));
        }
        if !seen.insert(k.id.as_str()) {
            return Err(format!("trusted key {} is listed twice", k.id));
        }
    }
    Ok(keys)
}

/// The public keys the reader is told to trust: every key that is not revoked.
pub fn public_keys(keys: &[TrustedKey]) -> Vec<String> {
    keys.iter().filter(|k| !k.revoked).map(|k| k.ed25519_pub_hex.clone()).collect()
}

/// Whether the archive is sealed, and by whom, against this app's key list. A
/// seal by a key the list marks revoked says so, instead of "does not trust".
pub fn seal_check(entries: &[zip_store::Entry], bytes: &[u8], keys: &[TrustedKey]) -> Result<seal::Sealed, String> {
    Ok(match seal::check(entries, bytes, &public_keys(keys))? {
        seal::Sealed::Untrusted { key, .. } if keys.iter().any(|k| k.revoked && k.id == key) => {
            let why = format!("sealed by key {key}, which has been revoked");
            seal::Sealed::Untrusted { key, why }
        }
        other => other,
    })
}

/// RFC 8032 §7.1 TEST 1 — published, so trusted under `cfg(test)` only.
#[cfg(test)]
pub fn test_key() -> TrustedKey {
    let ed25519_pub_hex = seal::test_key();
    TrustedKey { id: seal::key_id_of(&ed25519_pub_hex).unwrap_or_default(), ed25519_pub_hex, revoked: false }
}

/// Every key this build trusts to seal a PIGEON (and Patch's skill pack). A
/// shipped file that does not parse trusts nothing (a test holds the shipped
/// file to parsing).
pub fn trusted_keys() -> Vec<TrustedKey> {
    #[allow(unused_mut)]
    let mut keys = parse_trusted(include_str!("../keys/seal-keys.json")).unwrap_or_default();
    #[cfg(test)]
    keys.push(test_key());
    keys
}

/// Every key this build trusts to seal a base REGISTRY — a separate list, and
/// a key on one is not trusted for the other (format §15.2). Airoplane Mode's
/// registry key seals nothing else.
pub fn registry_keys() -> Vec<TrustedKey> {
    parse_trusted(include_str!("../keys/registry-keys.json")).unwrap_or_default()
}

/// The sealed base registry this build ships with (format §7.4, D73): it is
/// updated with the app, not fetched. From `pigeon-format/registry/`.
pub(crate) const REGISTRY_ZIP: &[u8] = include_bytes!("../registry/registry.zip");

/// The registries this app trusts, opened once under the registry keys. One
/// that does not open is ignored, never fatal, and the reason is logged (D44):
/// Pigeons are then checked as though no registry were published.
pub fn registries() -> &'static [pigeon_core::registry::Registry] {
    static OPENED: std::sync::OnceLock<Vec<pigeon_core::registry::Registry>> = std::sync::OnceLock::new();
    OPENED.get_or_init(|| open_registries(&[REGISTRY_ZIP]))
}

fn open_registries(zips: &[&[u8]]) -> Vec<pigeon_core::registry::Registry> {
    let keys = public_keys(&registry_keys());
    let (opened, refused) = pigeon_core::registry::open_all(zips, &check::Trust { pigeons: &[], registries: &keys });
    for u in refused {
        plog!("pigeon", "the base registry is not used ({}) — {}", u.code, u.why);
    }
    opened
}

/// A stock projector a picture Pigeon names and does not carry, which this
/// Mac does not have and a trusted registry lists (§13.1): what to download,
/// from where, and under which licence — shown before anything downloads
/// (§16.4).
#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
pub struct ProjectorDownload {
    pub sha256: String,
    pub file: String,
    pub bytes: Option<u64>,
    pub registry_id: Option<String>,
    pub license: Option<String>,
    pub license_url: Option<String>,
    /// The host it downloads from, as the registry's address names it.
    pub host: Option<String>,
}

/// The stock projector this Pigeon still needs downloaded, if any. `here` is
/// what this Mac holds; a carried projector needs nothing.
pub fn projector_to_download(m: &Manifest, entries: &[zip_store::Entry], bytes: &[u8], here: &Here, registries: &[pigeon_core::registry::Registry]) -> Option<ProjectorDownload> {
    if !m.takes_pictures() || zip_store::get(entries, bytes, PROJECTOR_FILE).ok().flatten().is_some() {
        return None;
    }
    let sha = m.base_model.mmproj.as_ref()?.sha256.as_deref()?.trim();
    if here.projectors.iter().any(|p| p == sha) {
        return None;
    }
    let (base, file) = registries.iter().find_map(|r| r.stock_projector(sha))?;
    Some(ProjectorDownload {
        sha256: sha.to_string(),
        file: file.file.clone(),
        bytes: file.bytes,
        registry_id: base.id.clone(),
        license: base.license.clone(),
        license_url: base.license_url.clone(),
        host: file.url.as_deref().and_then(|u| u.strip_prefix("https://")).and_then(|r| r.split('/').next()).filter(|h| !h.is_empty()).map(String::from),
    })
}

/// D74 (format §13.1): a copy of a Pigeon already here that differs from the
/// kept one only by carrying, or leaving out, its stock projector. Which copy
/// stays: the one this Mac can run, the smaller when it can run both.
#[derive(Serialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Keep {
    /// The copy here stays and nothing changes.
    Yours,
    /// This copy carries the projector the smaller one here needs: the
    /// projector goes into the store, and the smaller copy stays.
    YoursWithItsProjector,
    /// This is the smaller copy, and this Mac has its projector: it replaces
    /// the larger one here.
    This,
}

/// `same` compares the new file (first) with the kept one (second).
pub fn keep_which(same: pigeon_core::same::Same, projector_here: bool) -> Option<Keep> {
    use pigeon_core::same::Same;
    match (same, projector_here) {
        (Same::Identical, _) => None,
        (Same::FirstCarries, true) => Some(Keep::Yours),
        (Same::FirstCarries, false) => Some(Keep::YoursWithItsProjector),
        (Same::SecondCarries, true) => Some(Keep::This),
        (Same::SecondCarries, false) => Some(Keep::Yours),
    }
}

/// D74 for a file whose weights and contract are already here: the kept copy
/// compared with this one (D79 for seals), and whether this Mac has the
/// projector. `None` when there is no kept copy, or they are not such a pair.
fn same_copy<R: tauri::Runtime>(app: &AppHandle<R>, m: &Manifest, bytes: &[u8], here: &Here) -> Option<Keep> {
    let kept = pigeons_dir(app).ok()?.join(format!("{}.pigeon", m.id));
    let kept = blob::Blob::open(&kept).ok()?;
    let same = pigeon_core::same::same_pigeon(bytes, &kept, &public_keys(&trusted_keys()), registries())?;
    let sha = m.base_model.mmproj.as_ref().and_then(|p| p.sha256.as_deref()).map(str::trim).unwrap_or_default();
    keep_which(same, here.projectors.iter().any(|p| p == sha))
}

/// A grounded Pigeon's section titles, in order, once each — what it covers,
/// for a "that isn't in here" reply to offer.
pub fn section_titles(index: &material::ChunkIndex) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    index.chunks.iter()
        .map(|c| c.title.trim().to_string())
        .filter(|t| !t.is_empty() && seen.insert(t.clone()))
        .collect()
}

/// What a grounded Pigeon covers. Reads only its material; no model.
#[tauri::command]
pub async fn pigeon_contents<R: tauri::Runtime>(app: AppHandle<R>, pigeon: String) -> Result<Vec<String>, String> {
    let Some(p) = weights::persona_by_id(&app, &pigeon) else {
        return Err(format!("no such Pigeon: \"{pigeon}\""));
    };
    if p.contract.kind != "grounded" {
        return Ok(Vec::new());
    }
    let dir = p.path.parent().map(Path::to_path_buf).unwrap_or_default();
    let raw = std::fs::read(payload_path(&dir, &p.id, "material"))
        .map_err(|_| format!("\"{}\" has lost its material ({MATERIAL_FILE}) — import it again", p.name))?;
    let index: material::ChunkIndex =
        serde_json::from_slice(&raw).map_err(|e| format!("{MATERIAL_FILE} could not be read — {e}"))?;
    Ok(section_titles(&index))
}

#[cfg(test)]
mod card_tests {
    use super::*;

    #[test]
    fn a_card_is_kept_only_when_it_says_what_the_pigeon_does_briefly() {
        assert!(card_readable(&serde_json::json!({ "does": "Sort coin photos by type.", "surprise": 1 })));
        assert!(!card_readable(&serde_json::json!({ "does": "" })));
        assert!(!card_readable(&serde_json::json!({ "does": "x".repeat(61) })));
        assert!(!card_readable(&serde_json::json!("not an object")));
        let m: Manifest = serde_json::from_value(serde_json::json!({
            "format_version": 1, "name": "n", "id": "n", "kind": "freeform",
            "base_model": { "file": "b.gguf", "arch": "qwen2", "name": "Qwen2.5", "size": "1.5B" },
            "prompt_template": "{input}"
        })).unwrap();
        assert!(m.card.is_none(), "a Pigeon without a card still reads");
    }

    #[test]
    fn the_shipped_key_lists_parse_and_no_key_is_on_both() {
        let pigeons = parse_trusted(include_str!("../keys/seal-keys.json")).expect("seal-keys.json");
        let registries = parse_trusted(include_str!("../keys/registry-keys.json")).expect("registry-keys.json");
        assert!(!pigeons.is_empty() && !registries.is_empty());
        assert!(registries.iter().all(|r| pigeons.iter().all(|p| p.id != r.id)), "one key, one purpose");
        // A revoked key is simply not among the keys the reader is given.
        let k = test_key();
        assert_eq!(public_keys(&[k.clone(), TrustedKey { revoked: true, ..k.clone() }]), vec![k.ed25519_pub_hex.clone()]);
        let one = |id: &str, revoked: bool| format!(r#"{{"id":"{id}","ed25519_pub_hex":"{}","revoked":{revoked}}}"#, k.ed25519_pub_hex);
        assert_eq!(parse_trusted(&format!("[{}]", one(&k.id, false))).unwrap(), vec![k.clone()]);
        assert!(parse_trusted(&format!("[{},{}]", one(&k.id, true), one(&k.id, false))).unwrap_err().contains("twice"));
        assert!(parse_trusted(&format!("[{}]", one("0000000000000000", false))).is_err());
    }
}

/// The pure form, testable without an `AppHandle`: every `.gguf` in the given
/// directories whose header reads, in the order the directories were given,
/// with its hash when the app's hash cache already knows it. Nothing is hashed
/// here: a base without a known hash still loads by identity.
pub fn installed_bases_in(dirs: &[PathBuf], hashes: &crate::hashes::Hashes) -> Vec<InstalledBase> {
    pigeon_core::scan::bases(dirs, &|p: &Path| hashes.known(p))
}

/// Every base model this machine has — Pigeon's own `models` directory (the
/// same place `weights.rs` looks for the planner and category models).
pub fn installed_bases<R: tauri::Runtime>(app: &AppHandle<R>) -> Vec<InstalledBase> {
    let dirs: Vec<PathBuf> = weights::own_dir(app).ok().into_iter().collect();
    let mut bases = installed_bases_in(&dirs, &crate::hashes::of(app));
    /* A text Pigeon runs on the category server, so when several files of its
       base are here, that is the one its "same base, other file" warning
       should name. The check takes the first file of the same base it finds. */
    let category = crate::manifest::manifest().ok().and_then(|m| m.for_role(crate::Role::Category)).map(|s| s.file.clone());
    bases.sort_by_key(|b| Some(&b.file) != category.as_ref());
    bases
}

/// `installed`, with the hash of the base file this Pigeon was measured on
/// filled in when the cache does not know it yet: that one file is read and
/// hashed, once, so the exact-file match can be made. No other base is hashed
/// to check one Pigeon.
fn with_named_hash<R: tauri::Runtime>(app: &AppHandle<R>, installed: &[InstalledBase], entries: &[zip_store::Entry], bytes: &[u8]) -> Vec<InstalledBase> {
    let mut out = installed.to_vec();
    let named = zip_store::get(entries, bytes, "pigeon.json")
        .ok()
        .flatten()
        .and_then(|raw| serde_json::from_slice::<serde_json::Value>(raw).ok())
        .and_then(|m| m["base_model"]["file"].as_str().map(String::from));
    let Some(named) = named.filter(|f| plain_id(f)) else { return out };
    let dirs: Vec<PathBuf> = weights::own_dir(app).ok().into_iter().collect();
    let hashes = crate::hashes::of(app);
    for b in out.iter_mut().filter(|b| b.file == named && b.sha256.is_none()) {
        if let Some(path) = dirs.iter().map(|d| d.join(&named)).find(|p| p.is_file()) {
            b.sha256 = hashes.hash(&path);
        }
    }
    out
}

/// What this Mac holds, as the reader needs it told: the projectors in the
/// store, by hash, and the one embedding model this build names.
pub struct Here {
    pub projectors: Vec<String>,
    pub embedders: Vec<check::Embedder>,
}

impl Here {
    pub fn of<R: tauri::Runtime>(app: &AppHandle<R>) -> Here {
        let store = weights::own_dir(app).map(|d| d.join("projectors"));
        Here::with_projectors(store.map(|s| projectors_in(&s, &crate::hashes::of(app))).unwrap_or_default())
    }

    /// What this Mac holds as far as the hash cache already knows: nothing is
    /// hashed. For the launch-time re-check.
    pub fn known<R: tauri::Runtime>(app: &AppHandle<R>) -> Here {
        let hashes = crate::hashes::of(app);
        let store = weights::own_dir(app).map(|d| d.join("projectors"));
        Here::with_projectors(store.map(|s| pigeon_core::scan::hashes(&[s], &|p: &Path| hashes.known(p))).unwrap_or_default())
    }

    pub fn with_projectors(projectors: Vec<String>) -> Here {
        let embedders = crate::manifest::manifest()
            .ok()
            .and_then(|m| m.embedding.clone())
            .map(|e| check::Embedder { sha256: e.sha256, dims: Some(e.dims), query_prefix: Some(e.query_prefix) })
            .into_iter()
            .collect();
        Here { projectors, embedders }
    }
}

/// The format's import check (§7.3), by `pigeon-core`, with this app's answers
/// to the three things the reader leaves to its host: the bases installed, the
/// projectors and embedding model on this Mac, and the keys it trusts.
#[cfg_attr(not(test), allow(dead_code))] // the tests' door into `validate_entries`
pub fn validate(bytes: &[u8], installed: &[InstalledBase]) -> Result<Report, Refused> {
    let entries = check::list(bytes)?;
    validate_entries(&entries, bytes, installed, &Here::with_projectors(Vec::new()))
}

/// `validate`, against a directory the caller already listed — so a single
/// import does not re-parse the ZIP's central directory to ask the same
/// question twice.
fn validate_entries(entries: &[zip_store::Entry], bytes: &[u8], installed: &[InstalledBase], here: &Here) -> Result<Report, Refused> {
    let (pigeons, registry_keys) = (public_keys(&trusted_keys()), public_keys(&registry_keys()));
    let host = check::Host {
        machine: Some(check::Machine { bases: installed, projectors: &here.projectors, embedders: &here.embedders }),
        trust: check::Trust { pigeons: &pigeons, registries: &registry_keys },
        registries: registries(),
    };
    check::check_entries(entries, bytes, &host)
}

/// What a picture Pigeon presses (format §13.2).
pub use pigeon_core::actions::ACTIONS_FILE;

/// One thing the import check said about a Pigeon that a person should know:
/// its code, and the specific file, field or key it is about. The page words
/// it; Rust never sends a finished sentence.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct Note {
    pub code: String,
    #[serde(default)]
    pub detail: serde_json::Value,
}

/// The code for this app's own refusal to play from an `actions.json` the
/// reader kept. Not one of the format's codes: the format lets a file through
/// that this build still cannot play, which the spec allows as long as the
/// person is told why (§13.2, D68).
pub const CANNOT_PLAY: &str = "cannot_play";

/// This app's note on a file that is the same Pigeon as one already here but
/// for its stock projector (D74): `keeps` is `this` or
/// `yours_with_its_projector`. Not one of the format's codes.
pub const SAME_PIGEON: &str = "same_pigeon";

/// Why this build cannot play from an `actions.json` the reader kept, as a
/// note — or None when it can. This app's own choices, beyond the format's:
/// - `key`: a key whose `code` is not one a Mac keyboard has. The format
///   counts only that key as not listed (D68); this app plays all of a
///   Pigeon's keys or none, so it declines the Pigeon and says which key.
/// - `no_keys`: nothing to press.
/// A crop past the window's edge is trimmed, as the recorder does (D70), and
/// stacked frames without a gap are the format's own `actions_skipped` (D72),
/// so neither is this app's to refuse.
fn cannot_play(v: &serde_json::Value) -> Option<Note> {
    let note = |cause: &str, more: serde_json::Value| {
        let mut detail = serde_json::json!({ "cause": cause });
        if let (Some(d), Some(m)) = (detail.as_object_mut(), more.as_object()) {
            d.extend(m.clone());
        }
        Some(Note { code: CANNOT_PLAY.into(), detail })
    };
    let keys = v.get("keys").and_then(|k| k.as_object());
    if let Some((name, k)) = keys.and_then(|keys| keys.iter().find(|(_, k)| !pigeon_core::actions::listed(k))) {
        return note("key", serde_json::json!({ "key": name, "code": k.get("code").cloned().unwrap_or(serde_json::Value::Null) }));
    }
    if keys.is_none_or(|k| k.is_empty()) {
        return note("no_keys", serde_json::json!({}));
    }
    None
}

/// Whether a carried `actions.json` is one this build can play from: one the
/// reader keeps (§13.2), and nothing `cannot_play` objects to. One it cannot
/// play from is not kept — a Pigeon without it still answers; it just cannot
/// play, and its notes say why.
fn actions_ok(entries: &[zip_store::Entry], bytes: &[u8], takes_pictures: bool) -> bool {
    let Ok(Some(raw)) = zip_store::get(entries, bytes, ACTIONS_FILE) else { return false };
    pigeon_core::actions::usable(raw, takes_pictures).is_ok_and(|v| cannot_play(&v).is_none())
}

/// Every warning the check raised, base first, then this app's own reason it
/// cannot play, if it has one.
pub fn notes_for(report: &Report) -> Vec<Note> {
    let mut notes: Vec<Note> = report.warnings.iter().map(|w| Note { code: w.code().into(), detail: w.detail() }).collect();
    notes.sort_by_key(|n| n.code != "same_base_other_quant");
    notes.extend(report.actions.as_ref().and_then(cannot_play));
    notes
}

/// A picture Pigeon's keys, as the page shows them: the answer, the key it
/// presses, and how long. None when it carries no actions.json.
pub fn presses_in(adapters: &Path, id: &str) -> Option<serde_json::Value> {
    let v: serde_json::Value = serde_json::from_slice(&std::fs::read(payload_path(adapters, id, "actions")).ok()?).ok()?;
    let keys: Vec<serde_json::Value> = v["keys"].as_object()?.iter()
        .map(|(answer, k)| serde_json::json!({ "answer": format!("KEY({answer})"), "key": k["name"], "hold_ms": k["hold_ms"] }))
        .collect();
    Some(serde_json::json!({ "keys": keys, "not_pressed": v["not_pressed"], "frames": v["frames"] }))
}

/// A classifier's `labels.txt`, one label per line, blank lines dropped. Empty
/// for every other kind — and for a classifier that somehow lost the file,
/// which `validate` already refuses before this is reached.
fn labels_in(entries: &[zip_store::Entry], bytes: &[u8]) -> Vec<String> {
    let Ok(Some(raw)) = zip_store::get(entries, bytes, "labels.txt") else { return Vec::new() };
    ask::labels(&String::from_utf8_lossy(raw))
}

fn pigeons_dir<R: tauri::Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    weights::app_subdir(app, "pigeons")
}

/// Where a set-aside Pigeon goes when it is no longer wanted. A test app has
/// its own, inside its own data folder.
fn trash_dir() -> Result<PathBuf, String> {
    // A test never puts anything in the person's Trash.
    if cfg!(test) {
        return Ok(std::env::temp_dir().join("pigeon-test-trash"));
    }
    let home = std::env::var_os("HOME").ok_or("no home folder")?;
    Ok(PathBuf::from(home).join(".Trash"))
}

/// The picture a `.pigeon` carries at its root (512×512 recommended), shown as
/// the Pigeon's avatar.
pub const ICON_FILE: &str = "icon.png";
/// Past this an "icon" is not an icon: Flight School's flat 512×512 pigeon is
/// tens of kilobytes, and every list call carries it to the page.
pub const ICON_MAX_BYTES: usize = 1 << 20;

/// Whether bytes are a PNG worth showing as an avatar: the signature, `IHDR`
/// first, 16 to 1024 pixels a side, and not too many bytes. Not a decoder —
/// the page shows it through an `<img>`, which is the sandbox — only the check
/// that keeps a mislabelled or enormous file out of every list.
pub fn icon_ok(bytes: &[u8]) -> bool {
    const SIG: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a];
    if bytes.len() < 24 || bytes.len() > ICON_MAX_BYTES || bytes[..8] != SIG || &bytes[12..16] != b"IHDR" {
        return false;
    }
    let side = |at: usize| u32::from_be_bytes([bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]]);
    (16..=1024).contains(&side(16)) && (16..=1024).contains(&side(20))
}

/// Extract the adapter, write it (and a sidecar `weights::persona_label`
/// already knows how to read) into the adapters folder, atomically — the
/// same `.part`-then-rename convention `store.rs` and the downloader use.
/// The original file is kept too, in a separate `pigeons/` folder, for
/// provenance a later feature might want (a README, a report, examples);
/// nothing reads it back yet.
/// A filesystem failure as a sentence somebody can act on.
///
/// Every path written here is inside the app's own data directory and was built
/// here, so naming it in an error tells the reader nothing they can do anything
/// about — it puts seventy characters of somebody else's directory layout in a
/// toast and buries the one part that matters. The OS's own reason is that part
/// ("Permission denied", "No space left on device"), so it is kept and the path
/// is dropped. The rest of this file already talks this way: "has lost its
/// material — import it again".
fn fs_trouble(doing: &str, e: &std::io::Error) -> String {
    format!("{doing} — {e}")
}

pub fn install<R: tauri::Runtime>(
    app: &AppHandle<R>,
    bytes: &[u8],
    manifest: &Manifest,
    adapter: Option<&[u8]>,
    source: Option<&Path>,
    notes: &[Note],
) -> Result<(), String> {
    let dir = weights::personas_dir(app)?;
    if manifest.takes_pictures() {
        let store = weights::own_dir(app)?.join("projectors");
        keep_projector(&store, manifest, bytes, &crate::hashes::of(app))?;
    }
    /* A new revision of a Pigeon already here: the old one is set aside, not
       overwritten, until the new one passes its own examples (revision.rs). */
    revision::set_aside(&dir, &pigeons_dir(app)?, &manifest.id, &trash_dir()?)?;
    /* A base Pigeon (D83) has no weights to copy: its sidecar says
       `base_only`, and the engine asks it from the kept file. */
    if let Some(adapter) = adapter {
        let dest = dir.join(format!("{}.lora.gguf", manifest.id));
        let tmp = dir.join(format!("{}.lora.gguf.part", manifest.id));
        std::fs::write(&tmp, adapter)
            .map_err(|e| fs_trouble(&format!("\"{}\" could not be written to this Mac", manifest.name), &e))?;
        std::fs::rename(&tmp, &dest).map_err(|e| {
            let _ = std::fs::remove_file(&tmp);
            fs_trouble(&format!("\"{}\" could not be installed", manifest.name), &e)
        })?;
    }

    write_sidecar(&dir, manifest, bytes, notes)?;

    /* The original is kept for sidecar repair. From a file, it is COPIED from
       that file — which on APFS is a clone that shares its blocks and costs no
       space, where writing the bytes out would be a second 875 MB for a
       picture Pigeon. From memory (a nest member), the bytes are written. */
    if let Ok(store) = pigeons_dir(app) {
        let kept = store.join(format!("{}.pigeon", manifest.id));
        let _ = std::fs::remove_file(&kept);
        let copied = source.is_some_and(|src| std::fs::copy(src, &kept).is_ok());
        if !copied {
            let _ = std::fs::write(&kept, bytes);
        }
    }

    Ok(())
}

/// The projector a picture Pigeon names, in `store`, if this Mac has it: a
/// file the hash cache knows by that hash, or — once — one it does not know
/// whose bytes hash to it (the stock projector Flight School downloaded has
/// never been hashed until something asks). One copy per hash, whatever it is
/// called.
pub fn projector_in(store: &Path, sha: &str, hashes: &crate::hashes::Hashes) -> Option<PathBuf> {
    let files = pigeon_core::scan::ggufs(&[store.to_path_buf()]);
    if let Some(path) = files.iter().find(|p| hashes.known(p).as_deref() == Some(sha)) {
        return Some(path.clone());
    }
    files.into_iter().filter(|p| hashes.known(p).is_none()).find(|p| hashes.hash(p).as_deref() == Some(sha))
}

/// Every projector in `store`, by hash — what the import check is told this
/// Mac holds. One the cache does not know is hashed once, as `projector_in`
/// does.
pub fn projectors_in(store: &Path, hashes: &crate::hashes::Hashes) -> Vec<String> {
    pigeon_core::scan::hashes(&[store.to_path_buf()], &|p: &Path| hashes.hash(p))
}

/// Put a picture Pigeon's projector in the store, unless the store already
/// holds that hash. The carried bytes must BE the hash the manifest names — a
/// projector that differs from the one the adapter learned with loads without
/// complaint and answers wrong, so it is refused here instead.
fn keep_projector(store: &Path, manifest: &Manifest, bytes: &[u8], hashes: &crate::hashes::Hashes) -> Result<PathBuf, String> {
    let spec = manifest.base_model.mmproj.as_ref().ok_or_else(|| Refused::ProjectorUnnamed.message())?;
    let sha = spec.sha256.as_deref().map(str::trim).unwrap_or_default();
    std::fs::create_dir_all(store).map_err(|e| fs_trouble("the projector folder could not be made", &e))?;
    if let Some(have) = projector_in(store, sha, hashes) {
        return Ok(have);
    }
    let entries = zip_store::list_entries(bytes)?;
    let carried = zip_store::get(&entries, bytes, PROJECTOR_FILE)?
        .ok_or_else(|| format!("this Pigeon sees pictures through {}, and this machine does not have it — download the picture model first", spec.file))?;
    if crate::download::sha256_hex(carried) != sha {
        return Err(format!(
            "\"{}\" carries a projector that is not the one it was trained with — the file is damaged or was repacked wrong",
            manifest.name
        ));
    }
    // Its own name when free; a different projector under that name keeps both.
    let plain = Path::new(&spec.file).file_name().map(|n| n.to_string_lossy().into_owned()).filter(|n| n.ends_with(".gguf"));
    let mut dest = store.join(plain.unwrap_or_else(|| format!("{}.gguf", &sha[..12.min(sha.len())])));
    if dest.exists() {
        dest = store.join(format!("{}-{}.gguf", dest.file_stem().unwrap().to_string_lossy(), &sha[..12.min(sha.len())]));
    }
    let tmp = dest.with_extension("gguf.part");
    std::fs::write(&tmp, carried).map_err(|e| fs_trouble("the projector could not be written to this Mac", &e))?;
    std::fs::rename(&tmp, &dest).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        fs_trouble("the projector could not be installed", &e)
    })?;
    hashes.record(&dest, sha);
    Ok(dest)
}

/// Delete an installed persona's files, given the directories directly — the
/// inverse of `install`, and what the tests exercise. The adapter must exist
/// to name a real persona; the sidecar, any payload and the kept original are
/// each removed best-effort, since a freeform Pigeon never had a payload and
/// a persona installed before "pigeons/" existed never had a kept original.
pub fn remove_persona_in(adapters: &Path, pigeons: Option<&Path>, id: &str) -> Result<(), String> {
    /* The id arrives from the page, and it is about to become part of five
       delete paths. It must be one plain file-name component — no separator,
       no `..`, nothing that could walk out of the adapters folder. */
    if !plain_id(id) {
        return Err(format!("no such Pigeon: \"{id}\""));
    }
    /* A base Pigeon (D83) has no adapter: its sidecar is what names it. */
    let adapter = adapters.join(format!("{id}.lora.gguf"));
    let sidecar = adapters.join(format!("{id}.lora.json"));
    let first = if adapter.is_file() {
        adapter
    } else if is_base_sidecar(&sidecar) {
        sidecar.clone()
    } else {
        return Err(format!("no such Pigeon: \"{id}\""));
    };
    std::fs::remove_file(&first)
        .map_err(|e| fs_trouble(&format!("\"{id}\" could not be removed"), &e))?;
    let _ = std::fs::remove_file(&sidecar);
    let _ = std::fs::remove_file(payload_path(adapters, id, "skill"));
    let _ = std::fs::remove_file(payload_path(adapters, id, "material"));
    let _ = std::fs::remove_file(payload_path(adapters, id, "embeddings"));
    let _ = std::fs::remove_file(payload_path(adapters, id, "actions"));
    let _ = std::fs::remove_file(icon_path(adapters, id));
    if let Some(pigeons) = pigeons {
        let _ = std::fs::remove_file(pigeons.join(format!("{id}.pigeon")));
    }
    Ok(())
}

/// Delete an installed persona from this Mac — the page's own door onto
/// `remove_persona_in`.
///
/// A persona a running model server already loaded is not force-unloaded
/// here — its files are simply gone, and, like a newly imported one, only a
/// restart makes the running server agree with what the app now shows. The
/// caller decides whether to offer that restart.
#[tauri::command]
pub async fn pigeon_remove<R: tauri::Runtime>(app: AppHandle<R>, id: String) -> Result<(), String> {
    let dir = weights::personas_dir(&app)?;
    /* No kept-original folder means nothing kept to remove — never a path
       relative to wherever the process happened to be started. */
    let store = pigeons_dir(&app).ok();
    remove_persona_in(&dir, store.as_deref(), &id)?;
    // A version kept aside goes with it — to the Trash.
    let _ = revision::settle(&dir, &id, &trash_dir()?);
    // Its play logs — frames of the person's screen — go outright.
    if let Ok(plays) = weights::app_subdir(&app, "plays") {
        let _ = std::fs::remove_dir_all(plays.join(&id));
    }
    Ok(())
}

/// The contract, not just a label: the user turn it was trained with and the
/// budget its own test measured. Dropping these is what made a note-titler
/// ramble for 400 tokens. One writer, used by a fresh install, by a re-import,
/// and by the launch-time repair, so the three cannot drift apart.
fn write_sidecar(dir: &Path, manifest: &Manifest, bytes: &[u8], notes: &[Note]) -> Result<(), String> {
    write_sidecar_keeping(dir, manifest, bytes, None, notes)
}

/// `write_sidecar` for the SAME training — a launch-time repair, or the same
/// weights re-imported — which keeps a voice's measured shape: the weights it
/// was measured on are the weights still here.
fn rewrite_sidecar(dir: &Path, manifest: &Manifest, bytes: &[u8], notes: &[Note]) -> Result<(), String> {
    let shape = std::fs::read_to_string(dir.join(format!("{}.lora.json", manifest.id)))
        .ok()
        .and_then(|t| serde_json::from_str::<weights::Contract>(&t).ok())
        .and_then(|c| c.shape);
    write_sidecar_keeping(dir, manifest, bytes, shape, notes)
}

fn write_sidecar_keeping(dir: &Path, manifest: &Manifest, bytes: &[u8], shape: Option<String>, notes: &[Note]) -> Result<(), String> {
    let entries = zip_store::list_entries(bytes)?;
    /* Payloads first, so a sidecar that names a skill or a retrieval always
       has its data beside it; one a re-import no longer carries is removed. */
    let grounded = manifest.kind == "grounded";
    /* A picture Pigeon made by recording carries what it presses (Flight
       School's actions.json, format §6a) — kept beside it for play. */
    let plays = actions_ok(&entries, bytes, manifest.takes_pictures());
    let hybrid = grounded && manifest.material.as_ref().is_some_and(|m| m.retrieval == "hybrid-v1");
    for (what, file, wanted) in [("material", MATERIAL_FILE, grounded), ("embeddings", material::EMBEDDINGS_FILE, hybrid), ("skill", skill::PAYLOAD_FILE, manifest.skill.is_some()), ("actions", ACTIONS_FILE, plays)] {
        let dest = payload_path(dir, &manifest.id, what);
        match zip_store::get(&entries, bytes, file)? {
            Some(raw) if wanted => {
                std::fs::write(&dest, raw)
                    .map_err(|e| fs_trouble(&format!("what \"{}\" ships with could not be written", manifest.name), &e))?
            }
            _ => {
                let _ = std::fs::remove_file(&dest);
            }
        }
    }
    /* The icon, when it is one. Never a reason to refuse an import: a missing
       or broken icon means initials, and one a re-import no longer carries (or
       carries broken) is removed rather than left showing the old picture. */
    let icon = icon_path(dir, &manifest.id);
    match zip_store::get(&entries, bytes, ICON_FILE)? {
        Some(raw) if icon_ok(raw) => {
            std::fs::write(&icon, raw)
                .map_err(|e| fs_trouble(&format!("\"{}\"'s picture could not be written", manifest.name), &e))?
        }
        _ => {
            let _ = std::fs::remove_file(&icon);
        }
    }
    let sidecar = dir.join(format!("{}.lora.json", manifest.id));
    let contract = weights::Contract {
        label: Some(manifest.name.clone()),
        kind: manifest.kind.clone(),
        prompt_template: Some(manifest.prompt_template.clone()),
        max_tokens: manifest.output_contract.as_ref().and_then(|o| o.max_tokens),
        output_type: manifest.output_contract.as_ref().and_then(|o| o.kind.clone()),
        answer_type: manifest.output_contract.as_ref().and_then(|o| o.answer.clone()),
        labels: labels_in(&entries, bytes),
        sidecar: SIDECAR_VERSION,
        skill: manifest.skill.as_ref().map(|s| s.name.clone()),
        skill_version: manifest.skill_version(),
        retrieval: manifest.material.as_ref().filter(|_| grounded).map(|m| m.retrieval.clone()),
        card: manifest.card.clone().filter(card_readable),
        /* A new import is a new training: its shape is measured again, not
           inherited. Only `rewrite_sidecar`, for the same weights, passes one. */
        shape,
        inputs: manifest.declared_inputs(),
        projector: manifest.base_model.mmproj.as_ref().filter(|_| manifest.takes_pictures()).and_then(|m| m.sha256.clone()),
        base_file: Some(manifest.base_model.file.clone()),
        base_identity: Some(manifest.base_model.identity()),
        notes: notes.to_vec(),
        default_input: shared_example_input(&entries, bytes),
        base_only: manifest.base_only,
    };
    std::fs::write(&sidecar, serde_json::to_vec_pretty(&contract).unwrap())
        .map_err(|e| fs_trouble(&format!("what \"{}\" is could not be written down", manifest.name), &e))
}

/// The text every carried example was asked with, when it is one and the
/// same (format §3: `examples/NNN.prompt.txt`). A picture job trained on a
/// fixed question has exactly this shape; anything else has none.
fn shared_example_input(entries: &[zip_store::Entry], bytes: &[u8]) -> Option<String> {
    let mut seen: Option<String> = None;
    for e in entries.iter().filter(|e| e.name.starts_with("examples/") && e.name.ends_with(".prompt.txt")) {
        let text = String::from_utf8_lossy(zip_store::get(entries, bytes, &e.name).ok()??).trim().to_string();
        match &seen {
            _ if text.is_empty() => return None,
            None => seen = Some(text),
            Some(s) if *s == text => {}
            Some(_) => return None,
        }
    }
    seen
}

/// Rebuild any sidecar that lacks a current contract from the `.pigeon` kept
/// beside it.
///
/// An import made by an earlier build wrote `{label, kind}` and nothing else,
/// and re-importing the same file could not fix it — an identical adapter was
/// reported "already there" before the sidecar was touched. A build before
/// `SIDECAR_VERSION` 2 installed a grounded or skill Pigeon as plain freeform.
/// The original file is kept in `pigeons/` for exactly this kind of recovery,
/// so the fix needs nothing from the person. Returns how many were repaired.
/// The base was checked when the file was imported, so it is not re-checked.
///
/// Kept files are always written as `<id>.pigeon`, so the sidecar is checked
/// by that name first and the archive — which holds a whole adapter — is only
/// read when it actually needs rebuilding. This runs before the window opens.
pub fn repair_sidecars_in(adapters: &Path, pigeons: &Path, installed: &[InstalledBase], here: &Here) -> usize {
    rebuild_sidecars_in(adapters, pigeons, installed, here, |c| c.prompt_template.is_some() && c.sidecar >= SIDECAR_VERSION)
}

/// Every kept Pigeon whose sidecar `current` does not accept is rebuilt from
/// its kept file, its notes from the check run again here.
fn rebuild_sidecars_in(adapters: &Path, pigeons: &Path, installed: &[InstalledBase], here: &Here, current: impl Fn(&weights::Contract) -> bool) -> usize {
    let Ok(entries) = std::fs::read_dir(pigeons) else { return 0 };
    let mut repaired = 0;
    for path in entries.filter_map(|e| e.ok()).map(|e| e.path()) {
        if path.extension().and_then(|e| e.to_str()) != Some("pigeon") {
            continue;
        }
        let Some(id) = path.file_stem().and_then(|s| s.to_str()) else { continue };
        if !adapters.join(format!("{id}.lora.gguf")).is_file() && !is_base_sidecar(&adapters.join(format!("{id}.lora.json"))) {
            continue;
        }
        let ok = std::fs::read_to_string(adapters.join(format!("{id}.lora.json")))
            .ok()
            .and_then(|t| serde_json::from_str::<weights::Contract>(&t).ok())
            .is_some_and(|c| current(&c));
        if ok {
            continue;
        }
        // Mapped, not read: a picture Pigeon's kept file is most of a gigabyte.
        let Ok(blob) = blob::Blob::open(&path) else { continue };
        let bytes: &[u8] = &blob;
        let Ok(Some(raw)) = zip_store::read(bytes, "pigeon.json") else { continue };
        let Ok(manifest) = serde_json::from_slice::<Manifest>(&raw) else { continue };
        /* Its notes come from the check run again here, against what this Mac
           knows. A file the check would refuse today keeps no notes; it was
           let in under an older rule. */
        let notes = check::list(bytes).and_then(|entries| validate_entries(&entries, bytes, installed, here)).map(|r| notes_for(&r)).unwrap_or_default();
        if manifest.id == id && rewrite_sidecar(adapters, &manifest, bytes, &notes).is_ok() {
            repaired += 1;
        }
    }
    repaired
}

pub fn repair_sidecars<R: tauri::Runtime>(app: &AppHandle<R>) {
    if let (Ok(adapters), Ok(pigeons)) = (weights::personas_dir(app), pigeons_dir(app)) {
        repair_sidecars_in(&adapters, &pigeons, &installed_bases(app), &Here::known(app));
    }
}

/// Told to the page when Pigeons' details change without anything it did.
pub const PIGEONS_CHANGED: &str = "pigeons-changed";

/// A note that says this Mac's base has the same name as the one its Pigeon
/// was tested on but was never hashed: what hashing that base will settle.
fn unconfirmed_base(n: &Note) -> bool {
    n.code == "same_base_other_quant" && n.detail.get("tested_on").is_some() && n.detail.get("tested_on") == n.detail.get("here")
}

/// The base file each installed Pigeon names, where this Mac has it and the
/// hash cache does not know it yet. Pigeons installed before the cache say
/// "not confirmed" until these are hashed.
fn unhashed_named_bases<R: tauri::Runtime>(app: &AppHandle<R>) -> Vec<PathBuf> {
    let hashes = crate::hashes::of(app);
    let dirs: Vec<PathBuf> = weights::own_dir(app).ok().into_iter().collect();
    let mut out: Vec<PathBuf> = Vec::new();
    for file in weights::personas(app).into_iter().filter_map(|p| p.contract.base_file).filter(|f| plain_id(f)) {
        if let Some(path) = dirs.iter().map(|d| d.join(&file)).find(|p| p.is_file()) {
            if hashes.known(&path).is_none() && !out.contains(&path) {
                out.push(path);
            }
        }
    }
    out
}

/// At launch, off the main thread and once: hash each base an installed
/// Pigeon names that the cache does not know, then rebuild the notes of every
/// Pigeon still saying its base is not confirmed, and tell the page.
pub fn confirm_bases_at_launch<R: tauri::Runtime>(app: AppHandle<R>) {
    std::thread::spawn(move || {
        let todo = unhashed_named_bases(&app);
        if todo.is_empty() {
            return;
        }
        let hashes = crate::hashes::of(&app);
        let hashed = todo.iter().filter(|p| hashes.hash(p).is_some()).count();
        if hashed == 0 {
            return;
        }
        let (Ok(adapters), Ok(pigeons)) = (weights::personas_dir(&app), pigeons_dir(&app)) else { return };
        let rebuilt = rebuild_sidecars_in(&adapters, &pigeons, &installed_bases(&app), &Here::known(&app), |c| !c.notes.iter().any(unconfirmed_base));
        if rebuilt > 0 {
            let _ = app.emit(PIGEONS_CHANGED, ());
        }
    });
}

/// The adapter a checked file installs, or None for a base Pigeon (D83),
/// which carries none — the check has already refused a file whose adapter
/// does not agree with its `base_only`, so this is the second guard.
fn adapter_of<'a>(entries: &[zip_store::Entry], bytes: &'a [u8], m: &Manifest) -> Result<Option<&'a [u8]>, String> {
    match zip_store::get(entries, bytes, "adapter.lora.gguf") {
        Ok(None) if m.base_only => Ok(None),
        Ok(Some(a)) if !m.base_only => Ok(Some(a)),
        _ => Err("this file is missing the Pigeon’s trained weights, so it can’t be added".into()),
    }
}

/// Whether `sidecar` is a base Pigeon's (D83): with no adapter beside it, the
/// sidecar is what is installed.
fn is_base_sidecar(sidecar: &Path) -> bool {
    std::fs::read_to_string(sidecar)
        .ok()
        .and_then(|t| serde_json::from_str::<weights::Contract>(&t).ok())
        .is_some_and(|c| c.base_only)
}

/// A byte-for-byte match against what is already installed under this id —
/// the same training re-imported is neither an error nor a second copy. A
/// base Pigeon (D83) has no adapter to compare: its prompts are in the file,
/// so the kept file itself is what must match.
fn already_installed<R: tauri::Runtime>(app: &AppHandle<R>, manifest: &Manifest, adapter: Option<&[u8]>, bytes: &[u8]) -> bool {
    let Ok(dir) = weights::personas_dir(app) else { return false };
    let Some(adapter) = adapter else {
        let kept = pigeons_dir(app).map(|p| p.join(format!("{}.pigeon", manifest.id)));
        return is_base_sidecar(&dir.join(format!("{}.lora.json", manifest.id)))
            && !dir.join(format!("{}.lora.gguf", manifest.id)).exists()
            && kept.is_ok_and(|k| std::fs::metadata(&k).is_ok_and(|m| m.len() == bytes.len() as u64) && std::fs::read(&k).is_ok_and(|e| e == bytes))
            && !contract_differs_in(&dir, manifest);
    };
    let path = dir.join(format!("{}.lora.gguf", manifest.id));
    // Sizes first: a different size already answers, without reading an adapter.
    if std::fs::metadata(&path).map(|m| m.len() != adapter.len() as u64).unwrap_or(true) {
        return false;
    }
    std::fs::read(&path).map(|e| e == adapter).unwrap_or(false) && !contract_differs_in(&dir, manifest)
}

/// A re-pack of the SAME weights can still say something new: how its
/// material is searched, its answer budget, its revision. "Already here"
/// means the weights and the contract are what is here; a changed contract
/// goes through the normal install, so the sidecar, the payloads and the kept
/// copy follow it and a Finder open offers the update instead of "already
/// have". Measured 2026-09-30: a Reader re-packed from keyword-overlap-v1 to
/// v2 was shown "Already have" and kept searching the old way.
fn contract_differs_in(dir: &Path, manifest: &Manifest) -> bool {
    let Ok(text) = std::fs::read_to_string(dir.join(format!("{}.lora.json", manifest.id))) else { return false };
    let Ok(c) = serde_json::from_str::<weights::Contract>(&text) else { return false };
    let revision = |card: &Option<serde_json::Value>| card.as_ref().and_then(|v| v.get("revision")).and_then(|r| r.as_u64());
    /* The stored contract keeps a card only when it is readable, so the file's
       card is compared the same way — else a card that breaks the spec would
       offer "Update" on every opening, for ever. */
    let as_stored = manifest.card.clone().filter(card_readable);
    c.prompt_template.as_deref() != Some(manifest.prompt_template.as_str())
        || c.retrieval != manifest.material.as_ref().filter(|_| manifest.kind == "grounded").map(|m| m.retrieval.clone())
        || c.max_tokens != manifest.output_contract.as_ref().and_then(|o| o.max_tokens)
        || revision(&c.card) != revision(&as_stored)
}

/// What one imported file (or one member of a `.nest`) came to. Kept
/// separate from `Refused`/`Report` because this is what crosses the IPC
/// boundary to the page, and it must be able to say "already had it" — a
/// third outcome neither of those two types has a place for.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "kebab-case", tag = "status")]
pub enum ImportOutcome {
    Added {
        file: String,
        /// The installed id, so the page can ask it its examples.
        id: String,
        name: String,
        kind: String,
        /// True when it replaced a Pigeon already here — which is set aside
        /// until this one passes (`pigeon_check_ride`).
        replaced: bool,
        /// A picture Pigeon.
        vision: bool,
        base_match: BaseMatch,
        /// Everything the check said about it, for the page to word.
        notes: Vec<Note>,
        sealed_by: Option<String>,
    },
    Already { file: String, name: String },
    /// D74: a copy of a Pigeon already here that differs only by its stock
    /// projector; `keeps` says which copy stayed.
    Kept { file: String, name: String, keeps: Keep },
    /// A newer Patch, stored for the next launch (`patch::import`). `from` is
    /// the version running now, if any; `message` says a restart is needed.
    Upgraded { file: String, name: String, from: Option<u64>, to: u64, message: String },
    /// `code` is the format's refusal code (`not_a_zip`, `wrong_base`, …)
    /// when the reader refused it, else this app's own word for why.
    Refused { file: String, reason: String, code: String },
}

pub const SKILLPACK_IN_NEST: &str = "a skill pack cannot travel in a nest";

/// Whether a nest carries a skill pack: then it is Patch's (D84).
pub fn nest_carries_skillpack(bytes: &[u8]) -> bool {
    nest::members(bytes).is_ok_and(|members| members.iter().any(|(_, inner)| declared_kind(inner).as_deref() == Some(SKILLPACK)))
}

/// The `kind` a file's manifest declares, read without judging anything else.
fn declared_kind(bytes: &[u8]) -> Option<String> {
    let raw = zip_store::read(bytes, "pigeon.json").ok()??;
    serde_json::from_slice::<serde_json::Value>(&raw).ok()?.get("kind")?.as_str().map(String::from)
}

/// `declared_kind`, against a directory the caller already listed.
fn declared_kind_in(entries: &[zip_store::Entry], bytes: &[u8]) -> Option<String> {
    let raw = zip_store::get(entries, bytes, "pigeon.json").ok()??;
    serde_json::from_slice::<serde_json::Value>(raw).ok()?.get("kind")?.as_str().map(String::from)
}

/// Validate, then install, one `.pigeon`'s bytes. `display` is what the page
/// shows for this file — the file name, or (inside a `.nest`) the member
/// name — never a path.
pub fn add_one<R: tauri::Runtime>(
    app: &AppHandle<R>,
    installed: &[InstalledBase],
    bytes: &[u8],
    display: &str,
    source: Option<&Path>,
) -> ImportOutcome {
    /* Parsed once and threaded through the checks below — a `.pigeon` is
       validated by asking the same ZIP directory several questions, not by
       re-parsing it for each one. */
    let entries = match check::list(bytes) {
        Ok(e) => e,
        Err(refused) => return ImportOutcome::Refused { file: display.into(), reason: refused.message(), code: refused.code().into() },
    };

    /* A skill pack is Patch, and is checked as Patch — seal, base, adapter,
       host API — and stored as an upgrade rather than installed as a Pigeon.
       So is a nest that carries one (D84), with the Pigeons he needs. */
    if declared_kind_in(&entries, bytes).as_deref() == Some(SKILLPACK) || nest_carries_skillpack(bytes) {
        return crate::patch::import(app, bytes, display);
    }
    let installed = with_named_hash(app, installed, &entries, bytes);
    let here = Here::of(app);
    let report = match validate_entries(&entries, bytes, &installed, &here) {
        Ok(r) => r,
        Err(refused) => return ImportOutcome::Refused { file: display.into(), reason: refused.message(), code: refused.code().into() },
    };
    let adapter = match adapter_of(&entries, bytes, &report.manifest) {
        Ok(a) => a,
        Err(reason) => return ImportOutcome::Refused { file: display.into(), reason, code: "bad_adapter".into() },
    };
    let m = &report.manifest;
    if already_installed(app, m, adapter, bytes) {
        /* D74: the same Pigeon with or without its stock projector. The copy
           kept is the one this Mac can run, the smaller when it can run both;
           a larger copy never replaces a smaller one that runs. */
        match same_copy(app, m, bytes, &here) {
            Some(Keep::Yours) => return ImportOutcome::Already { file: display.into(), name: m.name.clone() },
            Some(Keep::YoursWithItsProjector) => {
                let kept = weights::own_dir(app).map(|d| d.join("projectors")).and_then(|store| keep_projector(&store, m, bytes, &crate::hashes::of(app)));
                return match kept {
                    Ok(_) => ImportOutcome::Kept { file: display.into(), name: m.name.clone(), keeps: Keep::YoursWithItsProjector },
                    Err(reason) => ImportOutcome::Refused { file: display.into(), reason, code: "projector_not_kept".into() },
                };
            }
            Some(Keep::This) | None => {}
        }
        let keeps_this = same_copy(app, m, bytes, &here) == Some(Keep::This);
        /* Same training, but the manifest may say more than the sidecar an
           older build wrote — so the contract is refreshed even when the
           weights are not. */
        if let Ok(dir) = weights::personas_dir(app) {
            let _ = rewrite_sidecar(&dir, m, bytes, &notes_for(&report));
        }
        /* And the kept copy becomes this one: it is what a later repair rebuilds
           from, and a re-pack of the same training can carry more (a key list,
           a card) that the older copy would silently take away again. */
        if let Ok(store) = pigeons_dir(app) {
            let kept = store.join(format!("{}.pigeon", m.id));
            let _ = std::fs::remove_file(&kept);
            if !source.is_some_and(|src| std::fs::copy(src, &kept).is_ok()) {
                let _ = std::fs::write(&kept, bytes);
            }
        }
        if keeps_this {
            return ImportOutcome::Kept { file: display.into(), name: m.name.clone(), keeps: Keep::This };
        }
        return ImportOutcome::Already { file: display.into(), name: m.name.clone() };
    }
    let notes = notes_for(&report);
    match install(app, bytes, m, adapter, source, &notes) {
        Ok(_) => ImportOutcome::Added {
            file: display.into(),
            id: m.id.clone(),
            name: m.name.clone(),
            kind: m.kind.clone(),
            replaced: weights::personas_dir(app).is_ok_and(|d| revision::has_previous(&d, &m.id)),
            vision: m.takes_pictures(),
            base_match: report.base_match.unwrap_or(BaseMatch::SameBaseOtherQuant),
            notes,
            sealed_by: report.sealed_by.clone(),
        },
        Err(e) => ImportOutcome::Refused { file: display.into(), reason: e, code: "install_failed".into() },
    }
}

/// One file installed straight away, without the Meet sheet — what the
/// tests (and nothing else, now that every import is met first) install
/// with: a `.nest` fans out into its `.pigeon` members (§7 — `nest.json`
/// itself is ignored, a bad member does not block the good ones); anything
/// else is validated as a single Pigeon.
#[cfg(test)]
pub fn add_bytes<R: tauri::Runtime>(
    app: &AppHandle<R>,
    installed: &[InstalledBase],
    bytes: &[u8],
    display: &str,
    source: Option<&Path>,
) -> Vec<ImportOutcome> {
    if !display.to_lowercase().ends_with(".nest") {
        return vec![add_one(app, installed, bytes, display, source)];
    }
    if nest_carries_skillpack(bytes) {
        return vec![crate::patch::import(app, bytes, display)];
    }
    let members = match nest::members(bytes) {
        Ok(m) => m,
        Err(refused) => return vec![ImportOutcome::Refused { file: display.into(), reason: refused.message(), code: refused.code().into() }],
    };
    members
        .into_iter()
        .map(|(name, inner)| match declared_kind(inner).as_deref() {
            Some(SKILLPACK) => ImportOutcome::Refused { file: name, reason: SKILLPACK_IN_NEST.into(), code: "skillpack_in_nest".into() },
            _ => add_one(app, installed, inner, &name, None),
        })
        .collect()
}

#[cfg(test)]
pub fn add_path<R: tauri::Runtime>(app: &AppHandle<R>, installed: &[InstalledBase], path: &Path) -> Vec<ImportOutcome> {
    let display = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| path.display().to_string());
    match blob::Blob::open(path) {
        Ok(b) => add_bytes(app, installed, &b, &display, b.source()),
        Err(e) => vec![ImportOutcome::Refused { file: display, reason: format!("could not read the file: {e}"), code: "unreadable".into() }],
    }
}


/* ── meeting a Pigeon before it is added ─────────────────────────────────────
   Opening a file no longer installs it. It is checked, held in memory under an
   opaque id, and described to the page — what its maker says it does, how its
   base matched, whether it replaces one already here — and only `pigeon_add`
   with that id installs it. The page is never told a path: a held file is named
   by the id and by the file name the person already saw. */

/// How long a checked file waits for a yes before it is let go.
pub const HOLD_FOR: std::time::Duration = std::time::Duration::from_secs(600);
/// How long one waiting on its base model is held: through a download of
/// several gigabytes, after which the page adds it (Download, then add).
pub const HOLD_THROUGH_DOWNLOAD: std::time::Duration = std::time::Duration::from_secs(2 * 60 * 60);

/// Held files by id, each with the moment it is let go.
#[derive(Default)]
pub struct HeldImports(Mutex<std::collections::HashMap<String, (std::sync::Arc<blob::Blob>, String, std::time::Instant)>>);

pub fn hold_expired(until: std::time::Instant, now: std::time::Instant) -> bool {
    now >= until
}

/// What one opened file (or `.nest` member) is, before anything is installed.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "kebab-case", tag = "status")]
pub enum Meet {
    /// Checked and held under `id`. `update` when another training of the same
    /// Pigeon is installed, which this one would replace.
    Ready {
        id: String,
        file: String,
        pigeon_id: String,
        name: String,
        kind: String,
        card: Option<serde_json::Value>,
        base_match: BaseMatch,
        /// Everything the check said about it, for the page to word.
        notes: Vec<Note>,
        sealed_by: Option<String>,
        update: bool,
        installed_revision: Option<u64>,
        revision: Option<u64>,
        /// D83: a base Pigeon, its maker's prompts on a base with no
        /// training of its own — so the sheet does not call it trained.
        base_only: bool,
    },
    /// A skill pack, held under `id` and checked as Patch when added.
    Patch { id: String, file: String },
    /// `base_only` as on `Ready`, so the sheet words a base Pigeon the same.
    Already { file: String, name: String, base_only: bool },
    /// The base it needs is not here: `missing` when this Mac has no model at
    /// all for it, otherwise a different one. Held under `id` for as long as a
    /// download takes, so the page can add it when the download lands.
    NeedsBase { id: String, file: String, name: Option<String>, reason: String, missing: bool },
    /// A picture Pigeon that leaves out its stock projector (§13.1), which this
    /// Mac does not have and a trusted registry lists. Held, like `NeedsBase`,
    /// for as long as the download takes; the page shows the licence first.
    NeedsProjector { id: String, file: String, name: String, projector: ProjectorDownload },
    /// `code` is the format's refusal code (`not_a_zip`, `wrong_base`, …)
    /// when the reader refused it, else this app's own word for why.
    Refused { file: String, reason: String, code: String },
}

/// Held by sharing the mapped file, never by copying it: an 875 MB picture
/// Pigeon waiting ten minutes for a yes must not cost 875 MB of RAM.
fn hold<R: tauri::Runtime>(app: &AppHandle<R>, blob: &std::sync::Arc<blob::Blob>, display: &str, hold_for: std::time::Duration) -> String {
    static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
    let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let id = format!("m{nanos:x}{:x}", NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed));
    let state: State<HeldImports> = app.state();
    let mut held = state.0.lock().unwrap_or_else(|p| p.into_inner());
    let now = std::time::Instant::now();
    held.retain(|_, v| !hold_expired(v.2, now));
    held.insert(id.clone(), (blob.clone(), display.to_string(), now + hold_for));
    id
}

pub fn inspect_one<R: tauri::Runtime>(app: &AppHandle<R>, installed: &[InstalledBase], held: &std::sync::Arc<blob::Blob>, display: &str) -> Meet {
    let bytes: &[u8] = held;
    let entries = match check::list(bytes) {
        Ok(e) => e,
        Err(refused) => return Meet::Refused { file: display.into(), reason: refused.message(), code: refused.code().into() },
    };
    if declared_kind_in(&entries, bytes).as_deref() == Some(SKILLPACK) {
        return Meet::Patch { id: hold(app, held, display, HOLD_FOR), file: display.into() };
    }
    let installed = with_named_hash(app, installed, &entries, bytes);
    let here = Here::of(app);
    let report = match validate_entries(&entries, bytes, &installed, &here) {
        Ok(r) => r,
        Err(r @ (Refused::WrongBase(_) | Refused::NoBaseInstalled(_))) => {
            let name = zip_store::get(&entries, bytes, "pigeon.json")
                .ok()
                .flatten()
                .and_then(|raw| serde_json::from_slice::<serde_json::Value>(raw).ok())
                .and_then(|v| v.get("name").and_then(|n| n.as_str()).map(String::from));
            let missing = matches!(r, Refused::NoBaseInstalled(_));
            return Meet::NeedsBase { id: hold(app, held, display, HOLD_THROUGH_DOWNLOAD), file: display.into(), name, reason: r.message(), missing };
        }
        Err(r) => return Meet::Refused { file: display.into(), reason: r.message(), code: r.code().into() },
    };
    let adapter = match adapter_of(&entries, bytes, &report.manifest) {
        Ok(a) => a,
        Err(reason) => return Meet::Refused { file: display.into(), reason, code: "bad_adapter".into() },
    };
    let m = &report.manifest;
    if let Some(projector) = projector_to_download(m, &entries, bytes, &here, registries()) {
        return Meet::NeedsProjector { id: hold(app, held, display, HOLD_THROUGH_DOWNLOAD), file: display.into(), name: m.name.clone(), projector };
    }
    let mut notes = notes_for(&report);
    if already_installed(app, m, adapter, bytes) {
        match same_copy(app, m, bytes, &here) {
            None | Some(Keep::Yours) => return Meet::Already { file: display.into(), name: m.name.clone(), base_only: m.base_only },
            Some(keep) => notes.push(Note { code: SAME_PIGEON.into(), detail: serde_json::json!({ "keeps": keep }) }),
        }
    }
    let installed_contract = weights::personas_dir(app)
        .ok()
        .and_then(|dir| std::fs::read_to_string(dir.join(format!("{}.lora.json", m.id))).ok())
        .and_then(|t| serde_json::from_str::<weights::Contract>(&t).ok());
    let revision_of = |card: &Option<serde_json::Value>| card.as_ref().and_then(|v| v.get("revision")).and_then(|r| r.as_u64());
    Meet::Ready {
        id: hold(app, held, display, HOLD_FOR),
        file: display.into(),
        pigeon_id: m.id.clone(),
        name: m.name.clone(),
        kind: m.kind.clone(),
        card: m.card.clone().filter(card_readable),
        base_match: report.base_match.unwrap_or(BaseMatch::SameBaseOtherQuant),
        update: installed_contract.is_some() && !notes.iter().any(|n| n.code == SAME_PIGEON),
        notes,
        sealed_by: report.sealed_by.clone(),
        installed_revision: installed_contract.as_ref().and_then(|c| revision_of(&c.card)),
        revision: revision_of(&m.card),
        base_only: m.base_only,
    }
}

pub fn inspect_bytes<R: tauri::Runtime>(app: &AppHandle<R>, installed: &[InstalledBase], held: &std::sync::Arc<blob::Blob>, display: &str) -> Vec<Meet> {
    if !display.to_lowercase().ends_with(".nest") {
        return vec![inspect_one(app, installed, held, display)];
    }
    let bytes: &[u8] = held;
    /* D84: a nest carrying a skill pack is Patch with the Pigeons he needs.
       It is met as one Patch update and kept whole; his Pigeons are his, not
       added to the person's own. */
    if nest_carries_skillpack(bytes) {
        return vec![Meet::Patch { id: hold(app, held, display, HOLD_FOR), file: display.into() }];
    }
    let members = match nest::members(bytes) {
        Ok(m) => m,
        Err(refused) => return vec![Meet::Refused { file: display.into(), reason: refused.message(), code: refused.code().into() }],
    };
    members
        .into_iter()
        .map(|(name, inner)| match declared_kind(inner).as_deref() {
            Some(SKILLPACK) => Meet::Refused { file: name, reason: SKILLPACK_IN_NEST.into(), code: "skillpack_in_nest".into() },
            // A nest member is held as its own bytes: small in practice, and
            // the nest's mapping cannot be handed out as a slice of itself.
            _ => inspect_one(app, installed, &std::sync::Arc::new(blob::Blob::owned(inner.to_vec())), &name),
        })
        .collect()
}

pub fn inspect_paths<R: tauri::Runtime>(app: &AppHandle<R>, paths: &[PathBuf]) -> Vec<Meet> {
    if paths.is_empty() {
        return Vec::new();
    }
    let installed = installed_bases(app);
    paths
        .iter()
        .flat_map(|path| {
            let display = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| path.display().to_string());
            match blob::Blob::open(path) {
                Ok(b) => inspect_bytes(app, &installed, &std::sync::Arc::new(b), &display),
                Err(e) => vec![Meet::Refused { file: display, reason: format!("could not read the file: {e}"), code: "unreadable".into() }],
            }
        })
        .inspect(log_meet)
        .collect()
}

fn codes(notes: &[Note]) -> String {
    if notes.is_empty() { "no warnings".into() } else { notes.iter().map(|n| n.code.as_str()).collect::<Vec<_>>().join(", ") }
}

/// The log's line for a file checked before it is added.
fn log_meet(m: &Meet) {
    match m {
        Meet::Refused { file, reason, code } => crate::log::write("refusal", &format!("import {file}: {code} — {reason}")),
        Meet::Ready { file, pigeon_id, notes, .. } => crate::log::write("pigeon", &format!("checked {file} ({pigeon_id}): {}", codes(notes))),
        #[allow(unreachable_patterns)]
        _ => {}
    }
}

/// The log's line for a file added, or refused when it was.
fn log_outcome(o: &ImportOutcome) {
    match o {
        ImportOutcome::Refused { file, reason, code } => crate::log::write("refusal", &format!("import {file}: {code} — {reason}")),
        ImportOutcome::Added { file, id, notes, replaced, .. } => crate::log::write(
            "pigeon",
            &format!("added {file} as {id}{}: {}", if *replaced { " (replacing the copy here)" } else { "" }, codes(notes)),
        ),
        #[allow(unreachable_patterns)]
        _ => {}
    }
}

/// Pick files and describe them; nothing is installed.
#[tauri::command]
pub async fn pigeon_inspect_pick<R: tauri::Runtime>(app: AppHandle<R>) -> Result<Vec<Meet>, String> {
    use tauri_plugin_dialog::DialogExt;
    let picked = app
        .dialog()
        .file()
        .set_title("Add a Pigeon (or a whole nest)")
        .add_filter("Pigeon or nest", &["pigeon", "nest"])
        .blocking_pick_files();
    let Some(picked) = picked else { return Ok(Vec::new()) };
    let paths: Vec<PathBuf> = picked.iter().filter_map(|p| p.as_path().map(Path::to_path_buf)).collect();
    tauri::async_runtime::spawn_blocking(move || inspect_paths(&app, &paths)).await.map_err(|e| e.to_string())
}

/// Install what the person said yes to, by the ids `Meet` gave out.
#[tauri::command]
pub async fn pigeon_add<R: tauri::Runtime>(app: AppHandle<R>, ids: Vec<String>) -> Result<Vec<ImportOutcome>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let taken: Vec<Option<(std::sync::Arc<blob::Blob>, String)>> = {
            let state: State<HeldImports> = app.state();
            let mut held = state.0.lock().unwrap_or_else(|p| p.into_inner());
            let now = std::time::Instant::now();
            ids.iter()
                .map(|id| held.remove(id).filter(|v| !hold_expired(v.2, now)).map(|v| (v.0, v.1)))
                .collect()
        };
        let installed = installed_bases(&app);
        taken
            .into_iter()
            .map(|v| match v {
                Some((held, display)) => add_one(&app, &installed, &held, &display, held.source()),
                None => ImportOutcome::Refused {
                    file: "that Pigeon".into(),
                    reason: "it was checked too long ago and has been let go — open the file again".into(),
                    code: "expired".into(),
                },
            })
            .inspect(log_outcome)
            .collect()
    })
    .await
    .map_err(|e| e.to_string())
}

#[cfg(test)]
mod meet_tests {
    use super::*;

    #[test]
    fn a_held_file_is_let_go_when_its_time_is_up() {
        let at = std::time::Instant::now();
        assert!(!hold_expired(at + HOLD_FOR, at + std::time::Duration::from_secs(599)));
        assert!(hold_expired(at + HOLD_FOR, at + HOLD_FOR));
        // One waiting on its base outlasts a long download.
        assert!(!hold_expired(at + HOLD_THROUGH_DOWNLOAD, at + std::time::Duration::from_secs(90 * 60)));
    }

    #[test]
    fn a_meet_record_names_a_file_and_never_a_path() {
        for m in [
            Meet::Patch { id: "m1".into(), file: "patch.pigeon".into() },
            Meet::Already { file: "a.pigeon".into(), name: "A".into(), base_only: false },
            Meet::NeedsBase { id: "m2".into(), file: "b.pigeon".into(), name: Some("B".into()), reason: "needs its base".into(), missing: true },
            Meet::Refused { file: "c.pigeon".into(), reason: "not a zip".into(), code: "not_a_zip".into() },
        ] {
            let v = serde_json::to_value(&m).unwrap();
            assert!(v.get("path").is_none(), "{v}");
            assert!(v.get("status").and_then(|s| s.as_str()).is_some());
        }
        let v = serde_json::to_value(Meet::NeedsBase { id: "m3".into(), file: "b".into(), name: None, reason: "r".into(), missing: false }).unwrap();
        assert_eq!(v["status"], "needs-base");
        assert_eq!(v["id"], "m3", "Download, then add needs the id to add it by");
    }
}

/* ── running a one-shot Pigeon ──────────────────────────────────────────── */

/// How long one job may take. The same figure `task.rs` uses, for the same
/// reason: long enough for a slow machine, short enough that a wedged server
/// is reported rather than waited on.
const MAX_INPUT_CHARS: usize = 8_000;

#[derive(Deserialize)]
pub struct RunRequest {
    /// An installed Pigeon's id, as `personas_list` reported it. Never a path,
    /// and never a template — the template is the Pigeon's own, read from the
    /// contract on disk.
    pub pigeon: String,
    #[serde(default)]
    pub text: String,
    /// A picture, as a `data:image/…;base64,` URL — only for a picture Pigeon.
    #[serde(default)]
    pub image: Option<String>,
    /// One of the Pigeon's own carried examples, asked as it was made: for a
    /// grounded Pigeon the section the input already carries is the one shown,
    /// and nothing is searched (`material::split_carried`).
    #[serde(default)]
    pub example: bool,
    /// The example's expected answer. For a grounded Pigeon the reply then
    /// says whether the answer came from the same place (`same_source`).
    #[serde(default)]
    pub expect: Option<String>,
}

/// A pasted screenshot is a few MB; this is room for a large photo, and a cap
/// on what the page can make Rust hold.
const MAX_IMAGE_CHARS: usize = 24 * 1024 * 1024;

/// A picture the page sent, checked for being one: a data URL of a kind the
/// projector reads, base64 and nothing else. Returned as it came, because
/// llama-server takes exactly that shape.
pub(crate) fn picture_url(url: &str) -> Result<&str, String> {
    if url.len() > MAX_IMAGE_CHARS {
        return Err(format!("that picture is too large: {} MB, and the limit is {} MB", url.len() >> 20, MAX_IMAGE_CHARS >> 20));
    }
    let body = ["png", "jpeg", "jpg", "webp", "gif"]
        .iter()
        .find_map(|k| url.strip_prefix(&format!("data:image/{k};base64,")))
        .ok_or("that is not a picture this Pigeon can look at (PNG, JPEG, WebP or GIF)")?;
    if body.is_empty() || !body.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'+' || b == b'/' || b == b'=') {
        return Err("that picture did not arrive whole — try pasting it again".into());
    }
    Ok(url)
}

#[derive(Serialize)]
pub struct RunReply {
    pub text: String,
    pub ms: u64,
    pub tokens: u64,
    pub prompt_tokens: u64,
    /// The adapter actually worn, echoed back so the page says what did the
    /// work rather than what was asked for.
    pub pigeon: String,
    pub finish_reason: Option<String>,
    /// For a classifier: whether what came back was one of its own labels.
    /// `None` for every other kind. A label that did not match is reported as
    /// not matching rather than dressed up — see the module note below.
    pub matched_label: Option<bool>,
    /// Grounded: the sections the model was shown, so a person can judge a
    /// near miss beside the answer — nobody can from the text alone (§8.6).
    pub sections: Vec<Shown>,
    /// Grounded: sections the answer cites that it was never shown (§8.4).
    pub unsupported_citations: Vec<u32>,
    /// Grounded: the search found no section, so the model was never asked.
    pub no_material: bool,
    /// Grounded: the ordinal of the one section the answer came from — the
    /// one the page cites — or None when it declined or nothing matched.
    pub main: Option<u32>,
    /// Skill: the recipe drawn into its artefact (§9). Markup from a file
    /// someone else made — the page shows it as an image, never inline.
    pub rendered: Option<String>,
    /// Skill: why the answer could not be drawn — not a recipe, or a part the
    /// table does not carry. Reported, never repaired.
    pub render_error: Option<String>,
    /// Grounded, asked with `expect`: whether the answer came from the same
    /// section and sentence as the expected one.
    pub same_source: Option<material::SourceMatch>,
    /// Reasoned: what the Pigeon wrote before its answer. Shown, never acted on.
    pub reasoning: Option<String>,
}

#[derive(Serialize)]
pub struct Shown {
    pub ordinal: u32,
    pub title: String,
    /// The file the section was cut from, as the maker named it.
    pub file: String,
    pub text: String,
    /// Where in `text` the answer came from — the sentence sharing the most
    /// words with it, as UTF-16 offsets for the page to mark — or None.
    pub support: Option<(usize, usize)>,
    /// A second sentence the answer also came from, when it joins two clauses
    /// (see `material::support_scored`). Never set without `support`.
    pub also: Option<(usize, usize)>,
}

/// Run one Pigeon on one input, under its own contract.
///
/// This is the FOURTH door, and it is `task.rs`'s shape with the constant
/// swapped for a contract: the page names a Pigeon and supplies TEXT, and the
/// instruction — the `prompt_template` the adapter was trained with — comes
/// from the file it was imported from, never from the request. So this cannot
/// become another way to make the shell produce arbitrary prose either.
///
/// Greedy and fixed, like a task and unlike Lane B: a job must come back the
/// same way twice. The budget is `output_contract.max_tokens`, measured on the
/// run's own test, which is the whole reason a note-titler stops after a title.
///
/// **Classifiers are matched, not constrained.** A grammar would be better,
/// but on this llama.cpp build `/completion` is the only endpoint that takes
/// one and it ignores a per-request `lora` entirely, while this endpoint
/// honours the adapter and refuses a grammar. Loading a classifier applied at
/// launch would constrain it and simultaneously apply it to the category
/// router, which is the wall `chat.rs` exists to hold. So the answer is
/// checked against `labels.txt` after the fact, which is what the format spec
/// asks for, and an answer outside the set is reported as outside it.
#[tauri::command]
pub async fn pigeon_run<R: tauri::Runtime>(
    app: AppHandle<R>,
    req: RunRequest,
) -> Result<RunReply, String> {
    let Some(pigeon) = weights::persona_by_id(&app, &req.pigeon) else {
        return Err(format!("no such Pigeon: \"{}\"", req.pigeon));
    };
    if pigeon.contract.conversational() {
        return Err(format!(
            "\"{}\" is a voice, not a job — it belongs in the chat lane",
            pigeon.name
        ));
    }
    if pigeon.contract.prompt_template.is_none() {
        return Err(format!(
            "\"{}\" did not ship the prompt it was trained with, so there is no honest way to ask it",
            pigeon.name
        ));
    }
    let sees = pigeon.contract.projector.is_some();
    let picture = match req.image.as_deref() {
        Some(_) if !sees => {
            return Err(format!("\"{}\" cannot see pictures — it was trained on a model that reads text only", pigeon.name))
        }
        Some(url) => Some(picture_url(url)?.to_string()),
        None => None,
    };
    if req.text.trim().is_empty() && picture.is_none() {
        return Err("there was nothing to work on".into());
    }
    if req.text.chars().count() > MAX_INPUT_CHARS {
        return Err(format!(
            "that is too long for one pass: {} characters, and the limit is {MAX_INPUT_CHARS}",
            req.text.chars().count()
        ));
    }
    let adapters_dir = pigeon.path.parent().map(Path::to_path_buf).unwrap_or_default();

    /* §9: the parts table is loaded before anything is asked, so a skill this
       app cannot draw is refused by name rather than after a wasted run. */
    let payload = match &pigeon.contract.skill {
        None => None,
        Some(name) => {
            let version = pigeon.contract.skill_version;
            let raw = std::fs::read(payload_path(&adapters_dir, &pigeon.id, "skill")).map_err(|_| {
                format!("\"{}\" has lost its parts table ({}) — import it again", pigeon.name, skill::PAYLOAD_FILE)
            })?;
            Some(skill::Payload::parse(&raw, name, version)?)
        }
    };

    /* The engine asks the Pigeon from the file this app kept for it, in
       this process, and does §8 itself. */
    let kept = crate::inprocess::wanted(&app, &pigeon.id)
        .ok_or_else(|| format!("\"{}\" came without its .pigeon file, so it cannot be asked — add it again from its file", pigeon.name))?;
    app.state::<crate::engine::Engine>().touch();
    run_in_process(&app, &req, &pigeon, payload, picture, &kept).await
}

/// The model's text, read as this Pigeon's answer for the page, whichever
/// engine produced it.
#[allow(clippy::too_many_arguments)]
fn reply(pigeon: &weights::PersonaFile, payload: Option<&skill::Payload>, req: &RunRequest, mut shown: Vec<Shown>, said: String, ms: u64, tokens: u64, prompt_tokens: u64, finish_reason: Option<String>) -> RunReply {
    let grounded = pigeon.contract.kind == "grounded";
    /* A reasoned Pigeon's answer is what its last <do>…</do> holds (format
       §8.5, D26): that is what is matched, drawn and acted on. The reasoning
       before it is the maker's working, returned beside it and never acted
       on. Without a complete <do> the whole text comes back, and matches
       nothing. */
    let reasoned = pigeon.contract.output_type.as_deref() == Some("reasoned");
    let (text, reasoning) = match ask::last_do(&said).filter(|_| reasoned) {
        Some((reasoning, answer)) => (answer.to_string(), Some(reasoning.to_string())),
        None => (said, None),
    };
    let answers_with = if reasoned { pigeon.contract.answer_type.as_deref() } else { pigeon.contract.output_type.as_deref() };
    let matched_label = (answers_with == Some("label"))
        .then(|| reasoning.is_some() == reasoned && ask::match_label(&pigeon.contract.labels, &text).is_some());
    let ordinals: Vec<u32> = shown.iter().map(|s| s.ordinal).collect();
    let unsupported_citations =
        if grounded { material::unsupported_citations(&text, &ordinals) } else { Vec::new() };
    /* The one section the answer came from, and the sentence in it, so the
       page can underline the answer and open that sentence marked. Only that
       section carries a mark: a sentence in a section the answer did not come
       from is not where anything came from. */
    let supports: Vec<_> = shown.iter().map(|s| material::support_scored(&s.text, &text)).collect();
    let main_at = if grounded { material::main_section(&text, &ordinals, &supports) } else { None };
    for (i, s) in shown.iter_mut().enumerate() {
        let mine = if Some(i) == main_at { supports[i] } else { None };
        s.support = mine.map(|m| m.at);
        s.also = mine.and_then(|m| m.also);
    }
    let main = main_at.map(|i| shown[i].ordinal);
    let same_source = match (&req.expect, shown.as_slice()) {
        (Some(expected), [only]) if grounded => Some(material::same_source(only.ordinal, &only.text, expected, &text)),
        _ => None,
    };
    let (rendered, render_error) = match payload {
        None => (None, None),
        Some(p) => match skill::parse_recipe(&text).and_then(|recipe| skill::render(p, &recipe)) {
            Ok(drawn) => (Some(drawn), None),
            Err(e) => (None, Some(e)),
        },
    };

    RunReply {
        sections: shown,
        unsupported_citations,
        no_material: false,
        main,
        rendered,
        render_error,
        same_source,
        text,
        reasoning,
        ms,
        tokens,
        prompt_tokens,
        pigeon: pigeon.id.clone(),
        finish_reason,
        matched_label,
    }
}

/// `pigeon_run` through pigeon-engine. The engine
/// fills, retrieves, renders, constrains and decodes (§8); this keeps what
/// the page is shown the same as the server path: a carried example is
/// asked with its own section (E15), as `split_carried` does there.
async fn run_in_process<R: tauri::Runtime>(app: &AppHandle<R>, req: &RunRequest, pigeon: &weights::PersonaFile, payload: Option<skill::Payload>, picture: Option<String>, kept: &Path) -> Result<RunReply, String> {
    let adapters_dir = pigeon.path.parent().map(Path::to_path_buf).unwrap_or_default();
    let grounded = pigeon.contract.kind == "grounded";
    let index: Option<material::ChunkIndex> = if grounded {
        let raw = std::fs::read(payload_path(&adapters_dir, &pigeon.id, "material"))
            .map_err(|_| format!("\"{}\" has lost its material ({MATERIAL_FILE}) — import it again", pigeon.name))?;
        Some(serde_json::from_slice(&raw).map_err(|e| format!("{MATERIAL_FILE} could not be read — {e}"))?)
    } else {
        None
    };
    let mut request = serde_json::json!({ "input": req.text, "options": { "stream": false } });
    if let (Some(index), true) = (&index, req.example) {
        if let Some((chunk, question)) = material::split_carried(index, &req.text) {
            request["input"] = question.into();
            request["sections"] = serde_json::json!([chunk.ordinal]);
        }
    }
    let mut attachments = Vec::new();
    if let Some(url) = &picture {
        if req.text.trim().is_empty() {
            if let Some(d) = &pigeon.contract.default_input {
                request["input"] = d.clone().into();
            }
        }
        attachments.push(crate::inprocess::picture_bytes(url)?);
        request["picture"] = serde_json::json!({ "attachment": 0 });
    }
    let ev = crate::inprocess::ask(app, kept, request, attachments).await?;
    if ev["answer"]["kind"] == "no_section" {
        return Ok(RunReply {
            text: String::new(), ms: 0, tokens: 0, prompt_tokens: 0, pigeon: pigeon.id.clone(), finish_reason: None, matched_label: None,
            sections: Vec::new(), unsupported_citations: Vec::new(), no_material: true, main: None, rendered: None, render_error: None,
            same_source: None, reasoning: None,
        });
    }
    let shown: Vec<Shown> = ev["sections"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or_default()
        .iter()
        .filter_map(|s| {
            let o = s["ordinal"].as_u64()? as u32;
            let c = index.as_ref()?.chunks.iter().find(|c| c.ordinal == o)?;
            Some(Shown { ordinal: c.ordinal, title: c.title.clone(), file: c.file.clone(), text: c.text.clone(), support: None, also: None })
        })
        .collect();
    let stat = |k: &str| ev["stats"][k].as_u64().unwrap_or(0);
    let finish_reason = ev["stopped"].as_str().map(|s| match s {
        "end" => "stop".to_string(),
        "max_tokens" => "length".to_string(),
        other => other.to_string(),
    });
    let said = ev["raw"].as_str().unwrap_or_default().to_string();
    Ok(reply(pigeon, payload.as_ref(), req, shown, said, stat("total_ms"), stat("answer_tokens"), stat("prompt_tokens"), finish_reason))
}

/// One carried example, asked again on this Mac.
#[derive(Serialize, Debug)]
pub struct ExampleRun {
    pub expected: String,
    pub got: Option<String>,
    pub ok: bool,
    pub error: Option<String>,
    pub picture: bool,
    /// Grounded: the sentence each answer came from, and whether it is one.
    pub source: Option<material::SourceMatch>,
}

#[derive(Serialize, Debug)]
pub struct CheckRide {
    pub total: u32,
    pub passed: u32,
    pub results: Vec<ExampleRun>,
    /// Some example could not be asked at all (the models asleep, say): the
    /// ride did not happen, and nothing was swapped or thrown away.
    pub unchecked: bool,
    /// It failed, so the old revision is live again and the new one waits.
    pub reverted: bool,
    /// It passed, and the old revision went to the Trash.
    pub settled: bool,
}

/// The examples a `.pigeon` carries (format §6): `examples/NNN.txt` (or, beside
/// a picture, `NNN.prompt.txt`), `NNN.expected.txt`, and for a picture Pigeon
/// `NNN.jpg`/`.png`/`.webp`, as
/// (prompt, expected, picture as a data URL).
fn carried_examples(entries: &[zip_store::Entry], bytes: &[u8]) -> Vec<(String, String, Option<String>)> {
    let text = |name: &str| zip_store::get(entries, bytes, name).ok().flatten().map(|b| String::from_utf8_lossy(b).trim().to_string());
    let mut stems: Vec<&str> = entries
        .iter()
        .filter_map(|e| e.name.strip_prefix("examples/").and_then(|n| n.strip_suffix(".expected.txt")))
        .collect();
    stems.sort();
    stems
        .into_iter()
        .filter_map(|stem| {
            let expected = text(&format!("examples/{stem}.expected.txt"))?;
            // A picture example's words are `.prompt.txt`; a text example's input is `.txt`.
            let prompt = text(&format!("examples/{stem}.prompt.txt"))
                .or_else(|| text(&format!("examples/{stem}.txt")))
                .unwrap_or_default();
            let picture = [("jpg", "jpeg"), ("jpeg", "jpeg"), ("png", "png"), ("webp", "webp")].iter().find_map(|(ext, mime)| {
                zip_store::get(entries, bytes, &format!("examples/{stem}.{ext}"))
                    .ok()
                    .flatten()
                    .map(|b| format!("data:image/{mime};base64,{}", crate::capture::base64(b)))
            });
            Some((prompt, expected, picture))
        })
        .collect()
}

/// The check ride: the Pigeon just imported is asked every example it
/// carries, on this Mac, the way it will be asked for real. When it replaced
/// an older revision, the answer decides which one stays live — see
/// `revision.rs`. Greedy decoding, so the same file answers the same way here
/// as it did where it was made; a miss is a real miss.
#[tauri::command]
pub async fn pigeon_check_ride<R: tauri::Runtime>(app: AppHandle<R>, pigeon: String) -> Result<CheckRide, String> {
    let Some(p) = weights::persona_by_id(&app, &pigeon) else {
        return Err(format!("no such Pigeon: \"{pigeon}\""));
    };
    let adapters = weights::personas_dir(&app)?;
    let kept = pigeons_dir(&app)?.join(format!("{}.pigeon", p.id));
    let examples = match blob::Blob::open(&kept) {
        Ok(b) => zip_store::list_entries(&b).map(|entries| carried_examples(&entries, &b)).unwrap_or_default(),
        Err(_) => Vec::new(),
    };
    let label = p.contract.output_type.as_deref() == Some("label") || p.contract.answer_type.as_deref() == Some("label");
    let mut results = Vec::new();
    // A voice is not asked one input at a time; it has nothing to check here.
    if !p.contract.conversational() {
        for (prompt, expected, picture) in examples {
            let is_picture = picture.is_some();
            let run = pigeon_run(app.clone(), RunRequest { pigeon: p.id.clone(), text: prompt, image: picture, example: true, expect: Some(expected.clone()) }).await;
            results.push(match run {
                Ok(r) => {
                    let got = r.text.trim().to_string();
                    /* A grounded answer is checked on where it came from, not
                       its wording: a right answer in other words is right. */
                    let ok = match &r.same_source {
                        Some(m) => m.same,
                        None if label => got.eq_ignore_ascii_case(&expected),
                        None => got == expected,
                    };
                    ExampleRun { expected, got: Some(got), ok, error: None, picture: is_picture, source: r.same_source }
                }
                Err(e) => ExampleRun { expected, got: None, ok: false, error: Some(e), picture: is_picture, source: None },
            });
        }
    }
    let total = results.len() as u32;
    let passed = results.iter().filter(|r| r.ok).count() as u32;
    let unchecked = results.iter().any(|r| r.error.is_some());
    let (mut reverted, mut settled) = (false, false);
    if !unchecked && revision::has_previous(&adapters, &p.id) {
        if passed == total {
            settled = revision::settle(&adapters, &p.id, &trash_dir()?)?;
        } else {
            revision::swap(&adapters, &pigeons_dir(&app)?, &p.id)?;
            reverted = true;
            // The engine may hold the version just set aside.
            app.state::<crate::inprocess::InProcess>().sleep();
        }
    }
    Ok(CheckRide { total, passed, results, unchecked, reverted, settled })
}

/// "Use the new one anyway": after a failed check ride put the old revision
/// back, the person chose the new one. It goes live; the old one goes to the
/// Trash.
#[tauri::command]
pub async fn pigeon_use_new_revision<R: tauri::Runtime>(app: AppHandle<R>, pigeon: String) -> Result<(), String> {
    let adapters = weights::personas_dir(&app)?;
    if weights::persona_by_id(&app, &pigeon).is_none() || !revision::has_previous(&adapters, &pigeon) {
        return Err(format!("there is no other version of \"{pigeon}\" on this Mac"));
    }
    revision::swap(&adapters, &pigeons_dir(&app)?, &pigeon)?;
    revision::settle(&adapters, &pigeon, &trash_dir()?)?;
    // The engine may hold the version just set aside.
    app.state::<crate::inprocess::InProcess>().sleep();
    Ok(())
}

/// A drawing's file name from the Pigeon that drew it: "Icon Maker drawing.svg".
/// Only letters, digits, spaces, hyphens and underscores survive, so a name
/// from someone else's file cannot become a path.
pub fn drawing_file_name(pigeon_name: &str) -> String {
    let kept: String = pigeon_name
        .chars()
        .map(|c| if c.is_alphanumeric() || c == ' ' || c == '-' || c == '_' { c } else { ' ' })
        .collect();
    let squeezed = kept.split_whitespace().collect::<Vec<_>>().join(" ");
    let stem = if squeezed.is_empty() { "Pigeon".to_string() } else { squeezed.chars().take(60).collect() };
    format!("{stem} drawing.svg")
}

/// Save a drawing Pigeon's picture, through the native save dialog.
///
/// The page names the Pigeon and hands back the recipe it answered with — the
/// text, never the SVG and never a path. Rust draws that recipe again from the
/// Pigeon's own parts table, exactly as `pigeon_run` did (the same recipe
/// always draws the same picture), and writes THAT. So what lands on disk is
/// only ever markup this app drew, wherever the page's copy came from. The
/// person picks where it goes; the page learns the file's name and nothing
/// else. `Ok(None)` is a cancelled dialog.
#[tauri::command]
pub async fn pigeon_save_drawing<R: tauri::Runtime>(app: AppHandle<R>, req: RunRequest) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let Some(pigeon) = weights::persona_by_id(&app, &req.pigeon) else {
        return Err(format!("no such Pigeon: \"{}\"", req.pigeon));
    };
    let Some(name) = pigeon.contract.skill.as_ref() else {
        return Err(format!("\"{}\" does not draw", pigeon.name));
    };
    let adapters_dir = pigeon.path.parent().map(Path::to_path_buf).unwrap_or_default();
    let raw = std::fs::read(payload_path(&adapters_dir, &pigeon.id, "skill")).map_err(|_| {
        format!("\"{}\" has lost its parts table ({}) — import it again", pigeon.name, skill::PAYLOAD_FILE)
    })?;
    let payload = skill::Payload::parse(&raw, name, pigeon.contract.skill_version)?;
    let drawn = skill::parse_recipe(&req.text).and_then(|recipe| skill::render(&payload, &recipe))?;

    let picked = app
        .dialog()
        .file()
        .set_title("Save drawing")
        .set_file_name(drawing_file_name(&pigeon.name))
        .add_filter("SVG drawing", &["svg"])
        .blocking_save_file();
    let Some(picked) = picked else { return Ok(None) };
    let Some(path) = picked.as_path().map(Path::to_path_buf) else {
        return Err("that place can't be written to".into());
    };
    let path = if path.extension().is_some_and(|e| e.eq_ignore_ascii_case("svg")) { path } else { path.with_extension("svg") };
    std::fs::write(&path, drawn.as_bytes()).map_err(|e| format!("couldn't save the drawing — {e}"))?;
    Ok(path.file_name().map(|n| n.to_string_lossy().into_owned()))
}

/// The recipes a drawing Pigeon's card gives as example answers, in the order
/// and number the page shows them (card.js: input and output both strings, the
/// first five). Anything else on the card is ignored.
pub fn example_recipes(card: Option<&serde_json::Value>) -> Vec<String> {
    card.and_then(|c| c.get("examples"))
        .and_then(|e| e.as_array())
        .map(|list| {
            list.iter()
                .filter(|e| e.get("input").is_some_and(|v| v.is_string()))
                .filter_map(|e| e.get("output").and_then(|v| v.as_str()).map(String::from))
                .take(5)
                .collect()
        })
        .unwrap_or_default()
}

/// A drawing Pigeon's example answers, drawn — so its page shows the pictures
/// its maker's examples make, not the recipes. Drawn here from the Pigeon's own
/// parts table, the way `pigeon_run` draws an answer, and handed to the page in
/// memory; nothing is written. One entry per example the page shows: `None`
/// where a recipe does not draw. Empty for a Pigeon that does not draw.
#[tauri::command]
pub async fn pigeon_example_drawings<R: tauri::Runtime>(app: AppHandle<R>, pigeon: String) -> Result<Vec<Option<String>>, String> {
    let Some(p) = weights::persona_by_id(&app, &pigeon) else {
        return Err(format!("no such Pigeon: \"{pigeon}\""));
    };
    let Some(name) = p.contract.skill.as_ref() else { return Ok(Vec::new()) };
    let recipes = example_recipes(p.contract.card.as_ref());
    if recipes.is_empty() {
        return Ok(Vec::new());
    }
    let dir = p.path.parent().map(Path::to_path_buf).unwrap_or_default();
    let raw = std::fs::read(payload_path(&dir, &p.id, "skill"))
        .map_err(|_| format!("\"{}\" has lost its parts table ({}) — import it again", p.name, skill::PAYLOAD_FILE))?;
    let payload = skill::Payload::parse(&raw, name, p.contract.skill_version)?;
    Ok(recipes
        .iter()
        .map(|r| skill::parse_recipe(r).and_then(|recipe| skill::render(&payload, &recipe)).ok())
        .collect())
}

/* ── the import commands ────────────────────────────────────────────────── */

/// Files opened (double-click, or dropped on the Dock icon) before the main
/// window existed to show them. `pigeon_take_opens` drains it once the page
/// is ready to render results; a warm window gets a `pigeon-meet` event
/// instead (see `handle_opened`).
#[derive(Default)]
pub struct OpenedPigeons(Mutex<Vec<Meet>>);

#[tauri::command]
pub async fn pigeon_take_opens<R: tauri::Runtime>(app: AppHandle<R>) -> Result<Vec<Meet>, String> {
    let state: State<OpenedPigeons> = app.state();
    let mut queue = state.0.lock().unwrap();
    Ok(std::mem::take(&mut *queue))
}

/// The file-association path: `RunEvent::Opened` in `lib.rs` hands this
/// every path macOS says was opened with Pigeon. Run off the event thread
/// (importing reads a whole file and may hash one) and delivered live if a
/// window is already up, queued for `pigeon_take_opens` otherwise.
pub fn handle_opened<R: tauri::Runtime>(app: AppHandle<R>, paths: Vec<PathBuf>) {
    if paths.is_empty() {
        return;
    }
    tauri::async_runtime::spawn_blocking(move || {
        /* Described, not installed: a double-click opens the Meet sheet. */
        let all = inspect_paths(&app, &paths);
        /* A window that exists — shown or hidden in the menu bar — has its
           page up and listening. Bring it forward and hand the sheet over
           live; the queue below is for the cold launch, when there is no
           page yet. (A hidden window used to be treated as no window, and a
           Pigeon double-clicked while Pigeon sat in the menu bar was queued
           for a boot that never came.) */
        if let Some(window) = app.get_webview_window("main") {
            if !window.is_visible().unwrap_or(false) {
                crate::tray::show_main(&app);
            }
            let _ = window.emit("pigeon-meet", &all);
            return;
        }
        let state: State<OpenedPigeons> = app.state();
        state.0.lock().unwrap().extend(all);
    });
}

#[cfg(test)]
mod tests {
    #[test]
    fn a_drawing_pigeons_examples_are_the_ones_the_page_shows() {
        let card = serde_json::json!({ "examples": [
            { "input": "a red hat", "output": "{\"hat\":\"red\"}" },
            { "input": 3, "output": "skipped: input is not text" },
            { "input": "no output" },
            { "input": "b", "output": "2" }, { "input": "c", "output": "3" }, { "input": "d", "output": "4" },
            { "input": "e", "output": "5" }, { "input": "f", "output": "6" }
        ] });
        assert_eq!(super::example_recipes(Some(&card)), vec!["{\"hat\":\"red\"}", "2", "3", "4", "5"]);
        assert!(super::example_recipes(None).is_empty());
        assert!(super::example_recipes(Some(&serde_json::json!({ "examples": "nope" }))).is_empty());
    }

    #[test]
    fn a_drawing_is_saved_under_the_pigeons_name_and_never_a_path() {
        assert_eq!(super::drawing_file_name("Icon Maker"), "Icon Maker drawing.svg");
        assert_eq!(super::drawing_file_name("../../etc/passwd"), "etc passwd drawing.svg");
        assert_eq!(super::drawing_file_name("a/b\\c:d"), "a b c d drawing.svg");
        assert_eq!(super::drawing_file_name("   "), "Pigeon drawing.svg");
        assert!(!super::drawing_file_name(&"x".repeat(200)).contains('/'));
    }

    use super::*;
    use crate::gguf::test_support::{build_header, lora_bytes, lora_bytes_v2};
    use crate::zip_store::test_support::build_store_zip;

    fn base(arch: &str, name: &str, size: &str, sha: Option<&str>) -> InstalledBase {
        InstalledBase {
            file: "Qwen2.5-1.5B-Instruct-Q4_K_M.gguf".into(),
            identity: gguf::Identity { arch: arch.into(), name: name.into(), size: size.into(), finetune: None },
            sha256: sha.map(String::from),
        }
    }

    /// The two fields every Pigeon states and most tests do not care about:
    /// what an answer is and what goes in. Left out when a test sets its own.
    fn stated(kind: &str, overrides: &str) -> String {
        let mut out = String::new();
        if !overrides.contains("\"output_contract\"") {
            let answer = if kind == "classifier" { "label" } else { "text" };
            out.push_str(&format!(r#","output_contract":{{"type":"{answer}","max_tokens":45}}"#));
        }
        if !overrides.contains("\"inputs\"") {
            out.push_str(r#","inputs":["text"]"#);
        }
        out
    }

    fn manifest_json(kind: &str, overrides: &str) -> Vec<u8> {
        let overrides = format!("{}{overrides}", stated(kind, overrides));
        format!(
            r#"{{"format_version":1,"name":"note-to-title","id":"note-to-title","kind":"{kind}",
                 "base_model":{{"file":"Qwen2.5-1.5B-Instruct-Q4_K_M.gguf","sha256":"deadbeef",
                                 "arch":"qwen2","name":"Qwen2.5","size":"1.5B"}},
                 "prompt_template":"{{input}}"{overrides}}}"#
        )
        .into_bytes()
    }

    fn pigeon_zip(files: &[(&str, &[u8])]) -> Vec<u8> {
        build_store_zip(files)
    }

    #[test]
    fn a_file_that_is_not_an_adapter_is_refused_before_the_server_sees_it() {
        let m = manifest_json("freeform", "");
        let not_gguf = pigeon_zip(&[("pigeon.json", &m), ("adapter.lora.gguf", b"x")]);
        let err = validate(&not_gguf, &[]).unwrap_err().message();
        assert!(err.contains("not a GGUF"), "{err}");
        let model = build_header(&[("general.architecture", "qwen2"), ("general.type", "model")]);
        let model_as_adapter = pigeon_zip(&[("pigeon.json", &m), ("adapter.lora.gguf", &model)]);
        let err = validate(&model_as_adapter, &[]).unwrap_err().message();
        assert!(err.contains("says it is a model"), "{err}");
        let other = build_header(&[("general.type", "adapter"), ("adapter.type", "control_vector")]);
        let other_adapter = pigeon_zip(&[("pigeon.json", &m), ("adapter.lora.gguf", &other)]);
        let err = validate(&other_adapter, &[]).unwrap_err().message();
        assert!(err.contains("not a LoRA"), "{err}");
    }

    fn vision_manifest(sha: &str) -> Vec<u8> {
        format!(
            r#"{{"format_version":1,"name":"Dog breeds","id":"dog-breeds","kind":"freeform","inputs":["image","text"],
                 "output_contract":{{"type":"text","max_tokens":45}},
                 "base_model":{{"file":"VL.gguf","arch":"qwen3vl","name":"Qwen3-VL","size":"2B","vision":true,
                                 "mmproj":{{"file":"mmproj-VL.gguf","sha256":"{sha}"}}}},
                 "prompt_template":"{{image}}\n{{input}}"}}"#
        )
        .into_bytes()
    }

    /// Qwen3-VL-2B's stock Q8_0 projector, as the shipped registry lists it.
    const QWEN3VL_PROJECTOR: &str = "f9a68fabba69c3b81e153367b2c7521030b0fa8bb0de400c9599c8e6725f9c82";

    #[test]
    fn the_shipped_registry_opens_under_the_shipped_key_and_a_broken_one_is_ignored() {
        let opened = registries();
        assert_eq!(opened.len(), 1, "registry.zip opens under registry-keys.json");
        assert_eq!(opened[0].sealed_by, "25660ed562d33a0d");
        let (base, file) = opened[0].stock_projector(QWEN3VL_PROJECTOR).expect("listed");
        assert_eq!((base.id.as_deref(), file.bytes), (Some("qwen3-vl-2b-instruct"), Some(445_053_216)));
        // D44: one that does not open is left out, never fatal.
        let mut tampered = REGISTRY_ZIP.to_vec();
        let at = tampered.windows(6).position(|w| w == b"Apache").unwrap();
        tampered[at] = b'a';
        assert!(open_registries(&[&tampered, b"not a zip"]).is_empty());
    }

    #[test]
    fn a_slim_picture_pigeon_loads_and_asks_for_its_stock_projector_with_its_licence() {
        let vl = [InstalledBase { file: "VL.gguf".into(), identity: gguf::Identity { arch: "qwen3vl".into(), name: "Qwen3-VL".into(), size: "2B".into(), finetune: None }, sha256: None }];
        let slim = pigeon_zip(&[("pigeon.json", &vision_manifest(QWEN3VL_PROJECTOR)), ("adapter.lora.gguf", &lora_bytes())]);
        let entries = check::list(&slim).unwrap();
        // Listed by the registry, so downloadable: the check accepts it (§13.1)…
        let report = validate_entries(&entries, &slim, &vl, &Here::with_projectors(Vec::new())).expect("a listed projector counts");
        // …and the app asks for the download before adding it, licence first.
        let need = projector_to_download(&report.manifest, &entries, &slim, &Here::with_projectors(Vec::new()), registries()).expect("needs its projector");
        assert_eq!((need.file.as_str(), need.bytes, need.license.as_deref()), ("mmproj-Qwen3VL-2B-Instruct-Q8_0.gguf", Some(445_053_216), Some("Apache-2.0")));
        assert!(need.license_url.as_deref().is_some_and(|u| u.starts_with("https://")));
        assert_eq!(need.host.as_deref(), Some("huggingface.co"));
        assert_eq!(projector_to_download(&report.manifest, &entries, &slim, &Here::with_projectors(vec![QWEN3VL_PROJECTOR.into()]), registries()), None, "installed: nothing to download");
        assert_eq!(projector_to_download(&report.manifest, &entries, &slim, &Here::with_projectors(Vec::new()), &[]), None, "no registry: the check itself refuses");
        let carried = pigeon_zip(&[("pigeon.json", &vision_manifest(QWEN3VL_PROJECTOR)), ("adapter.lora.gguf", &lora_bytes()), (PROJECTOR_FILE, b"GGUF")]);
        let ce = check::list(&carried).unwrap();
        assert_eq!(projector_to_download(&report.manifest, &ce, &carried, &Here::with_projectors(Vec::new()), registries()), None, "a carried one needs nothing");
        // With no projector of that hash and no registry listing it: no_projector, with needs (D59).
        let unlisted = pigeon_zip(&[("pigeon.json", &vision_manifest("abc")), ("adapter.lora.gguf", &lora_bytes())]);
        let refused = validate_entries(&check::list(&unlisted).unwrap(), &unlisted, &vl, &Here::with_projectors(Vec::new())).unwrap_err();
        assert_eq!(refused.code(), "no_projector");
    }

    /// D74: the copy kept is the one this Mac can run, the smaller when it can
    /// run both. `Same` compares the new file with the kept one.
    #[test]
    fn a_copy_with_or_without_its_projector_keeps_the_one_that_runs_and_the_smaller() {
        use pigeon_core::same::Same;
        assert_eq!(keep_which(Same::Identical, true), None, "the same file: the ordinary already-here");
        assert_eq!(keep_which(Same::FirstCarries, true), Some(Keep::Yours), "large over slim that runs: keep the slim");
        assert_eq!(keep_which(Same::FirstCarries, false), Some(Keep::YoursWithItsProjector), "large over slim that cannot run: its projector, then keep the slim");
        assert_eq!(keep_which(Same::SecondCarries, true), Some(Keep::This), "slim over large, projector here: keep the slim");
        assert_eq!(keep_which(Same::SecondCarries, false), Some(Keep::Yours), "slim over large, no projector: keep the large");
        assert_eq!(serde_json::to_value(Keep::YoursWithItsProjector).unwrap(), "yours_with_its_projector");
    }

    #[test]
    fn a_picture_pigeon_must_name_its_projector_and_it_must_be_carried_or_here() {
        let unnamed = vision_manifest("");
        let zip = pigeon_zip(&[("pigeon.json", &unnamed), ("adapter.lora.gguf", &lora_bytes()), (PROJECTOR_FILE, b"p")]);
        assert_eq!(validate(&zip, &[]).unwrap_err(), Refused::ProjectorUnnamed);
        let vl = [InstalledBase { file: "VL.gguf".into(), identity: gguf::Identity { arch: "qwen3vl".into(), name: "Qwen3-VL".into(), size: "2B".into(), finetune: None }, sha256: None }];
        // Not carried, and not on this Mac: refused, naming the projector.
        let named = vision_manifest("abc");
        let zip = pigeon_zip(&[("pigeon.json", &named), ("adapter.lora.gguf", &lora_bytes())]);
        let refused = validate(&zip, &vl).unwrap_err();
        assert_eq!((refused.code(), refused.needs().map(|n| n.file.as_str())), ("no_projector", Some("mmproj-VL.gguf")));
        // Not carried, but this Mac holds that hash (format D14): it loads.
        let entries = check::list(&zip).unwrap();
        assert!(validate_entries(&entries, &zip, &vl, &Here::with_projectors(vec!["abc".into()])).is_ok());
        // Carried bytes that are not the hash it names are refused.
        let wrong = pigeon_zip(&[("pigeon.json", &named), ("adapter.lora.gguf", &lora_bytes()), (PROJECTOR_FILE, b"p")]);
        assert_eq!(validate(&wrong, &vl).unwrap_err(), Refused::ProjectorMismatch);
        // Carried, the right hash, and not a GGUF: refused by the reader (D57).
        let sha = crate::download::sha256_hex(b"p");
        let junk = pigeon_zip(&[("pigeon.json", &vision_manifest(&sha)), ("adapter.lora.gguf", &lora_bytes()), (PROJECTOR_FILE, b"p")]);
        assert!(validate(&junk, &vl).unwrap_err().message().contains("not a GGUF"));
    }

    #[test]
    fn a_carried_projector_is_kept_once_per_hash_and_refused_when_it_is_not_that_hash() {
        let store = std::env::temp_dir().join(format!("pigeon-test-projectors-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&store);
        let good = crate::download::sha256_hex(b"projector bytes");
        let m: Manifest = serde_json::from_slice(&vision_manifest(&good)).unwrap();
        let zip = pigeon_zip(&[("pigeon.json", &vision_manifest(&good)), ("adapter.lora.gguf", &lora_bytes()), (PROJECTOR_FILE, b"projector bytes")]);
        let hashes = crate::hashes::Hashes::at(&store.with_extension("hashes.json"));
        let first = keep_projector(&store, &m, &zip, &hashes).unwrap();
        assert_eq!(std::fs::read(&first).unwrap(), b"projector bytes");
        assert_eq!(first.file_name().unwrap(), "mmproj-VL.gguf");
        // The same hash again is the same file — nothing new is written.
        assert_eq!(keep_projector(&store, &m, &zip, &hashes).unwrap(), first);
        assert_eq!(std::fs::read_dir(&store).unwrap().filter(|e| e.as_ref().unwrap().path().extension().is_some_and(|x| x == "gguf")).count(), 1);
        // No marker is written beside it; the app's hash cache knows it.
        assert!(!std::fs::read_dir(&store).unwrap().any(|e| e.unwrap().file_name().to_string_lossy().ends_with(".sha256")));
        // A copy the cache has never seen (the stock download) is found by its bytes.
        let fresh = crate::hashes::Hashes::at(&store.with_extension("fresh-hashes.json"));
        assert_eq!(projector_in(&store, &good, &fresh), Some(first.clone()));
        // Bytes that are not the named hash are refused, and nothing is left behind.
        let other = crate::download::sha256_hex(b"a different projector");
        let m2: Manifest = serde_json::from_slice(&vision_manifest(&other)).unwrap();
        let bad = pigeon_zip(&[("pigeon.json", &vision_manifest(&other)), ("adapter.lora.gguf", &lora_bytes()), (PROJECTOR_FILE, b"projector bytes")]);
        assert!(keep_projector(&store, &m2, &bad, &hashes).unwrap_err().contains("not the one it was trained with"));
        assert!(projector_in(&store, &other, &hashes).is_none());
        let _ = std::fs::remove_dir_all(&store);
        let _ = std::fs::remove_file(store.with_extension("hashes.json"));
        let _ = std::fs::remove_file(store.with_extension("fresh-hashes.json"));
    }

    #[test]
    fn a_picture_pigeon_an_older_pigeon_installed_is_repaired_at_launch() {
        let root = std::env::temp_dir().join(format!("pigeon-test-repair-vision-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let (adapters, pigeons) = (root.join("adapters"), root.join("pigeons"));
        std::fs::create_dir_all(&adapters).unwrap();
        std::fs::create_dir_all(&pigeons).unwrap();
        let zip = pigeon_zip(&[("pigeon.json", &vision_manifest("abc")), ("adapter.lora.gguf", &lora_bytes()), ("labels.txt", b"KEY(A)\nNONE\n")]);
        std::fs::write(pigeons.join("dog-breeds.pigeon"), &zip).unwrap();
        std::fs::write(adapters.join("dog-breeds.lora.gguf"), b"x").unwrap();
        // What an older Pigeon wrote: a current-looking contract with no picture fields.
        std::fs::write(adapters.join("dog-breeds.lora.json"), r#"{"label":"Dog breeds","kind":"classifier","prompt_template":"{input}","sidecar":4,"shape":"A"}"#).unwrap();
        assert_eq!(repair_sidecars_in(&adapters, &pigeons, &[], &Here::with_projectors(Vec::new())), 1);
        let c: weights::Contract = serde_json::from_str(&std::fs::read_to_string(adapters.join("dog-breeds.lora.json")).unwrap()).unwrap();
        assert_eq!((c.projector.as_deref(), c.base_file.as_deref()), (Some("abc"), Some("VL.gguf")));
        assert_eq!(c.base_identity.map(|i| i.arch), Some("qwen3vl".to_string()), "the base is recorded by identity too");
        assert_eq!(c.shape.as_deref(), Some("A"), "a repair keeps a measured shape: the weights are the same");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_picture_pigeon_keeps_what_it_presses_and_a_bad_file_is_not_kept() {
        let dir = std::env::temp_dir().join(format!("pigeon-test-actions-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let m: Manifest = serde_json::from_slice(&vision_manifest("abc")).unwrap();
        let good = br#"{"format_version":1,"keys":{"Confirm":{"code":7,"name":"X","hold_ms":95}},"not_pressed":[],"frames":{"stack":1,"max_side":768}}"#;
        let zip = pigeon_zip(&[("pigeon.json", &vision_manifest("abc")), ("adapter.lora.gguf", &lora_bytes()), (ACTIONS_FILE, good)]);
        write_sidecar(&dir, &m, &zip, &[]).unwrap();
        let p = presses_in(&dir, "dog-breeds").expect("kept");
        assert_eq!(p["keys"], serde_json::json!([{ "answer": "KEY(Confirm)", "key": "X", "hold_ms": 95 }]));
        let bad = br#"{"format_version":1,"keys":{"Confirm":{"code":900,"name":"X"}},"frames":{"stack":1,"max_side":768}}"#;
        let zip = pigeon_zip(&[("pigeon.json", &vision_manifest("abc")), ("adapter.lora.gguf", &lora_bytes()), (ACTIONS_FILE, bad)]);
        write_sidecar(&dir, &m, &zip, &[]).unwrap();
        assert!(presses_in(&dir, "dog-breeds").is_none(), "a key code no keyboard has is not kept");
        // No frames, or frames that cannot be followed: not kept, never a default (D66, D69).
        for broken in [&br#"{"format_version":1,"keys":{"Confirm":{"code":7}}}"#[..], br#"{"format_version":1,"keys":{"Confirm":{"code":7}},"frames":{"stack":9,"max_side":768}}"#] {
            let zip = pigeon_zip(&[("pigeon.json", &vision_manifest("abc")), ("adapter.lora.gguf", &lora_bytes()), (ACTIONS_FILE, broken)]);
            write_sidecar(&dir, &m, &zip, &[]).unwrap();
            assert!(presses_in(&dir, "dog-breeds").is_none());
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Every warning the check raises reaches the page as a note, the base
    /// one first, and this app's own reasons it cannot play are notes too —
    /// one cause each, so a Pigeon never silently lacks a Play button.
    #[test]
    fn every_warning_is_a_note_and_a_pigeon_that_cannot_play_says_why() {
        let v = |s: &str| serde_json::from_str::<serde_json::Value>(s).unwrap();
        let cause = |s: &str| cannot_play(&v(s)).map(|n| n.detail["cause"].as_str().unwrap().to_string());
        let frames = r#""frames":{"stack":1,"max_side":768}"#;
        assert_eq!(cause(&format!(r#"{{"format_version":1,"keys":{{"Up":{{"code":126}}}},{frames}}}"#)), None);
        assert_eq!(cause(&format!(r#"{{"format_version":1,{frames}}}"#)).as_deref(), Some("no_keys"), "nothing to press is said, not silent");
        assert_eq!(cause(r#"{"format_version":1,"keys":{"Up":{"code":126}},"frames":{"stack":1,"max_side":768,"crop":[0.75,0,0.5,1]}}"#), None, "D70: trimmed, so it plays");
        assert_eq!(cause(r#"{"format_version":1,"keys":{"Up":{"code":126}},"frames":{"stack":2,"gap_ms":250,"max_side":768}}"#), None);
        let key = cannot_play(&v(r#"{"format_version":1,"keys":{"Up":{"code":126},"Jump":{"code":900}}}"#)).unwrap();
        assert_eq!((key.code.as_str(), key.detail["cause"].as_str(), key.detail["key"].as_str()), (CANNOT_PLAY, Some("key"), Some("Jump")));
        assert_eq!(cause(r#"{"format_version":1,"keys":{"Up":"126"}}"#).as_deref(), Some("key"));

        // From a real check: a picture Pigeon on another file of its base, with
        // no prompt check, and keys this Mac cannot press.
        let vl = [InstalledBase { file: "VL-other.gguf".into(), identity: gguf::Identity { arch: "qwen3vl".into(), name: "Qwen3-VL".into(), size: "2B".into(), finetune: None }, sha256: None }];
        let acts = br#"{"format_version":1,"keys":{"Up":{"code":126},"Jump":{"code":900}},"frames":{"stack":1,"max_side":768}}"#;
        let zip = pigeon_zip(&[("pigeon.json", &vision_manifest("abc")), ("adapter.lora.gguf", &lora_bytes()), (ACTIONS_FILE, acts)]);
        let entries = check::list(&zip).unwrap();
        let report = validate_entries(&entries, &zip, &vl, &Here::with_projectors(vec!["abc".into()])).expect("loads");
        let codes: Vec<String> = notes_for(&report).into_iter().map(|n| n.code).collect();
        assert_eq!(codes, vec!["same_base_other_quant", "prompt_unchecked", CANNOT_PLAY], "the base note leads");
        assert_eq!(notes_for(&report)[0].detail, serde_json::json!({ "tested_on": "VL.gguf", "here": "VL-other.gguf" }));
    }

    /// Once a base it names is hashed, a Pigeon's "not confirmed" note is
    /// rebuilt from the check — and only those Pigeons are touched.
    #[test]
    fn a_base_hashed_after_launch_settles_the_not_confirmed_note() {
        let root = std::env::temp_dir().join(format!("pigeon-test-confirm-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let (adapters, pigeons) = (root.join("adapters"), root.join("pigeons"));
        std::fs::create_dir_all(&adapters).unwrap();
        std::fs::create_dir_all(&pigeons).unwrap();
        let zip = pigeon_zip(&[("pigeon.json", &manifest_json("freeform", "")), ("adapter.lora.gguf", &lora_bytes())]);
        std::fs::write(pigeons.join("note-to-title.pigeon"), &zip).unwrap();
        std::fs::write(adapters.join("note-to-title.lora.gguf"), lora_bytes()).unwrap();
        let unhashed = [base("qwen2", "Qwen2.5", "1.5B", None)];
        assert_eq!(repair_sidecars_in(&adapters, &pigeons, &unhashed, &Here::with_projectors(Vec::new())), 1);
        let notes = |dir: &Path| serde_json::from_str::<weights::Contract>(&std::fs::read_to_string(dir.join("note-to-title.lora.json")).unwrap()).unwrap().notes;
        assert!(notes(&adapters).iter().any(unconfirmed_base), "before the base is hashed it is not confirmed");
        let settled = |c: &weights::Contract| !c.notes.iter().any(unconfirmed_base);
        // Hashed now, and it is the very file: the note goes.
        assert_eq!(rebuild_sidecars_in(&adapters, &pigeons, &installed(), &Here::with_projectors(Vec::new()), settled), 1);
        assert!(!notes(&adapters).iter().any(|n| n.code == "same_base_other_quant"));
        assert_eq!(rebuild_sidecars_in(&adapters, &pigeons, &installed(), &Here::with_projectors(Vec::new()), settled), 0, "nothing left to settle");
        let _ = std::fs::remove_dir_all(&root);
    }

    /// A Pigeon installed before notes existed gets them at launch, from the
    /// check run again on its kept file — and nothing is hashed to do it.
    #[test]
    fn a_pigeon_already_installed_gets_its_notes_at_launch() {
        let root = std::env::temp_dir().join(format!("pigeon-test-notes-repair-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let (adapters, pigeons) = (root.join("adapters"), root.join("pigeons"));
        std::fs::create_dir_all(&adapters).unwrap();
        std::fs::create_dir_all(&pigeons).unwrap();
        let zip = pigeon_zip(&[("pigeon.json", &manifest_json("freeform", "")), ("adapter.lora.gguf", &lora_bytes())]);
        std::fs::write(pigeons.join("note-to-title.pigeon"), &zip).unwrap();
        std::fs::write(adapters.join("note-to-title.lora.gguf"), lora_bytes()).unwrap();
        std::fs::write(adapters.join("note-to-title.lora.json"), r#"{"label":"n","kind":"freeform","prompt_template":"{input}","sidecar":7}"#).unwrap();
        assert_eq!(repair_sidecars_in(&adapters, &pigeons, &installed(), &Here::with_projectors(Vec::new())), 1);
        let c: weights::Contract = serde_json::from_str(&std::fs::read_to_string(adapters.join("note-to-title.lora.json")).unwrap()).unwrap();
        assert_eq!(c.notes.iter().map(|n| n.code.as_str()).collect::<Vec<_>>(), vec!["prompt_unchecked"]);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_picture_is_a_data_url_of_a_known_kind_and_its_slot_leaves_the_text() {
        assert!(picture_url("data:image/jpeg;base64,/9j/4AAQ==").is_ok());
        assert!(picture_url("data:image/svg+xml;base64,PHN2Zz4=").is_err());
        assert!(picture_url("https://example.com/dog.jpg").is_err());
        assert!(picture_url("data:image/png;base64,abc\"},{\"x").is_err());
        assert!(picture_url("data:image/png;base64,").is_err());
        assert_eq!(ask::fill("{image}\n{input}", "  ", None), "");
        assert_eq!(ask::fill("{image}\n{input}", "which breed?", None), "which breed?");
        assert_eq!(ask::fill("Look: {image} {input}", "x", None), "Look:  x");
    }

    #[test]
    fn carried_examples_are_read_for_text_and_picture_pigeons_alike() {
        let zip = pigeon_zip(&[
            ("examples/001.txt", b"a note\n"), ("examples/001.expected.txt", b"A title\n"),
            ("examples/002.jpg", b"\xff\xd8"), ("examples/002.prompt.txt", b"Which breed is this?\n"), ("examples/002.expected.txt", b"boxer\n"),
        ]);
        let entries = zip_store::list_entries(&zip).unwrap();
        let ex = carried_examples(&entries, &zip);
        assert_eq!(ex.len(), 2);
        assert_eq!((ex[0].0.as_str(), ex[0].1.as_str(), ex[0].2.is_some()), ("a note", "A title", false));
        assert_eq!((ex[1].0.as_str(), ex[1].1.as_str()), ("Which breed is this?", "boxer"));
        assert!(ex[1].2.as_deref().unwrap().starts_with("data:image/jpeg;base64,"));
        // Only a question every example shares is a default one.
        assert_eq!(shared_example_input(&entries, &zip).as_deref(), Some("Which breed is this?"));
    }

    #[test]
    fn not_a_zip_is_refused() {
        assert_eq!(validate(b"plain bytes", &[]), Err(Refused::NotAZip("not a ZIP file — no end-of-central-directory record".into())));
    }

    #[test]
    fn a_zip_without_a_manifest_is_refused() {
        let zip = pigeon_zip(&[("adapter.lora.gguf", &lora_bytes())]);
        assert_eq!(validate(&zip, &[]), Err(Refused::NoManifest));
    }

    #[test]
    fn a_newer_format_is_refused_and_names_the_version() {
        let manifest = br#"{"format_version":2,"name":"n","id":"n","kind":"freeform","base_model":{"file":"f.gguf"},"prompt_template":"{input}"}"#;
        let zip = pigeon_zip(&[("pigeon.json", manifest), ("adapter.lora.gguf", &lora_bytes())]);
        assert_eq!(validate(&zip, &[]), Err(Refused::NewerFormat { found: 2, supported: 1 }));
    }

    #[test]
    fn an_id_that_is_a_path_is_refused_before_anything_is_written() {
        for bad in ["../../Documents", "/tmp/x", "a/b", "a\\b", "..", ".", "", ".hidden", "x:y", "a\u{0}b"] {
            let manifest = format!(
                r#"{{"format_version":1,"name":"n","id":{},"kind":"freeform","base_model":{{"file":"f.gguf"}},"prompt_template":"{{input}}"}}"#,
                serde_json::to_string(bad).unwrap()
            );
            let zip = pigeon_zip(&[("pigeon.json", manifest.as_bytes()), ("adapter.lora.gguf", &lora_bytes())]);
            assert_eq!(validate(&zip, &[]), Err(Refused::BadId(bad.to_string())), "{bad:?} must be refused");
        }
        assert!(plain_id("note-to-title"));
        assert!(plain_id("Dog breeds v2.1"));
        assert!(plain_id("socratic_tutor"));
        assert!(!plain_id(&"x".repeat(129)));
    }

    #[test]
    fn a_template_without_the_input_slot_is_rejected() {
        let manifest = manifest_t("freeform", "hello", "");
        let zip = pigeon_zip(&[("pigeon.json", &manifest), ("adapter.lora.gguf", &lora_bytes())]);
        assert_eq!(validate(&zip, &[]), Err(Refused::TemplateMissingInputSlot));
    }

    #[test]
    fn a_classifier_without_labels_txt_is_rejected() {
        let zip = pigeon_zip(&[("pigeon.json", &manifest_json("classifier", "")), ("adapter.lora.gguf", &lora_bytes())]);
        assert_eq!(
            validate(&zip, &[]),
            Err(Refused::MissingRequiredFile { kind: "classifier".into(), file: "labels.txt".into() })
        );
    }

    #[test]
    fn a_persona_without_its_prompt_is_rejected() {
        let zip = pigeon_zip(&[("pigeon.json", &manifest_json("persona", "")), ("adapter.lora.gguf", &lora_bytes())]);
        assert_eq!(
            validate(&zip, &[]),
            Err(Refused::MissingRequiredFile { kind: "persona".into(), file: "system_prompt.txt".into() })
        );
    }

    #[test]
    fn the_exact_file_is_the_fast_path_no_warning() {
        let zip = pigeon_zip(&[("pigeon.json", &manifest_json("freeform", "")), ("adapter.lora.gguf", &lora_bytes())]);
        let installed = [base("qwen2", "Qwen2.5", "1.5B", Some("deadbeef"))];
        let report = validate(&zip, &installed).expect("should load");
        assert_eq!(report.base_match, Some(BaseMatch::Exact));
        assert!(report.base_warning().is_none());
    }

    #[test]
    fn the_strict_hash_trap_same_base_other_quant_warns_and_loads() {
        let zip = pigeon_zip(&[("pigeon.json", &manifest_json("freeform", "")), ("adapter.lora.gguf", &lora_bytes())]);
        // Same identity, different hash (a different quantization) — must still load.
        let mut installed = [base("qwen2", "Qwen2.5 1.5B Instruct", "1.5B", Some("other-hash"))];
        installed[0].file = "Qwen2.5-1.5B-Instruct-Q4_0.gguf".into();
        let report = validate(&zip, &installed).expect("should load with a warning");
        assert_eq!(report.base_match, Some(BaseMatch::SameBaseOtherQuant));
        assert!(report.base_warning().is_some(), "the warning is the whole point of this case");
    }

    #[test]
    fn a_wrong_base_refuses_and_names_the_model_needed() {
        let zip = pigeon_zip(&[("pigeon.json", &manifest_json("freeform", "")), ("adapter.lora.gguf", &lora_bytes())]);
        let installed = [base("llama", "Llama-3", "8B", None)];
        match validate(&zip, &installed) {
            Err(Refused::WrongBase(needs)) => {
                assert_eq!(needs.file, "Qwen2.5-1.5B-Instruct-Q4_K_M.gguf");
                assert_eq!(needs.identity.arch, "qwen2");
                // D59: the shipped registry lists this base, so needs carries
                // its id, licence and the file's size.
                assert_eq!(needs.registry_id.as_deref(), Some("qwen2.5-1.5b-instruct"));
                assert_eq!(needs.license.as_deref(), Some("Apache-2.0"));
                assert!(needs.bytes.is_some_and(|b| b > 900_000_000));
            }
            other => panic!("expected WrongBase, got {other:?}"),
        }
    }

    /// A file written before `inputs` existed takes text, and says so. The
    /// default has to be the narrow claim: read the other way round, every
    /// Pigeon ever made would start claiming it could be sent a photograph.
    #[test]
    fn a_file_with_no_inputs_takes_text() {
        let m: Manifest = serde_json::from_slice(
            br#"{"format_version":1,"name":"n","id":"n","kind":"classifier","base_model":{"file":"f.gguf"},"prompt_template":"{input}"}"#,
        )
        .unwrap();
        assert!(m.inputs.is_empty());
        assert_eq!(m.declared_inputs(), vec!["text".to_string()]);
    }

    #[test]
    fn a_maker_can_declare_what_goes_in() {
        let m: Manifest =
            serde_json::from_slice(&manifest_json("classifier", r#","inputs":["text","image"]"#)).unwrap();
        assert_eq!(m.declared_inputs(), vec!["text".to_string(), "image".to_string()]);
    }

    /// Lenient in one direction only. A word this build does not know is
    /// dropped rather than refused — the file still installs — but it is never
    /// carried through as a claim, because the page would then promise
    /// something no lane can do. A list that empties out is text.
    #[test]
    fn an_input_this_build_cannot_honour_is_dropped_not_refused() {
        let m: Manifest =
            serde_json::from_slice(&manifest_json("classifier", r#","inputs":["TEXT","audio","image","image"]"#)).unwrap();
        assert_eq!(m.declared_inputs(), vec!["text".to_string(), "image".to_string()]);

        let only: Manifest =
            serde_json::from_slice(&manifest_json("classifier", r#","inputs":["audio"]"#)).unwrap();
        assert_eq!(only.declared_inputs(), vec!["text".to_string()]);

        let empty: Manifest =
            serde_json::from_slice(&manifest_json("classifier", r#","inputs":[]"#)).unwrap();
        assert_eq!(empty.declared_inputs(), vec!["text".to_string()]);
    }

    #[test]
    fn no_models_at_all_is_missing_not_wrong() {
        let zip = pigeon_zip(&[("pigeon.json", &manifest_json("freeform", "")), ("adapter.lora.gguf", &lora_bytes())]);
        assert!(matches!(validate(&zip, &[]), Err(Refused::NoBaseInstalled(_))));
    }

    /// The two fields that say how to RUN a Pigeon have to survive the import,
    /// because the lane that wears one has no other way to learn them. This is
    /// the regression for a note-titler that answered in two words and then
    /// filled another 390 tokens with repetition.
    #[test]
    fn the_contract_is_written_into_the_sidecar_and_read_back() {
        let dir = std::env::temp_dir().join("pigeon-test-contract-sidecar");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let contract = weights::Contract {
            label: Some("note-to-title".into()),
            kind: "freeform".into(),
            prompt_template: Some("{input}".into()),
            max_tokens: Some(45),
            output_type: Some("text".into()),
            ..Default::default()
        };
        std::fs::write(dir.join("note-to-title.lora.gguf"), vec![0u8; 32]).unwrap();
        std::fs::write(
            dir.join("note-to-title.lora.json"),
            serde_json::to_vec_pretty(&contract).unwrap(),
        )
        .unwrap();

        let found = weights::personas_in(&dir);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].name, "note-to-title");
        assert_eq!(found[0].contract.max_tokens, Some(45));
        assert_eq!(found[0].contract.prompt_template.as_deref(), Some("{input}"));
        assert!(!found[0].contract.conversational(), "freeform is a job, not a voice");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// A hand-dropped adapter predates `.pigeon` entirely and must keep
    /// working: no sidecar means a persona with nothing measured, never a
    /// one-shot job we would then have to invent a prompt for.
    #[test]
    fn an_adapter_with_no_sidecar_is_a_persona_with_no_contract() {
        let dir = std::env::temp_dir().join("pigeon-test-no-sidecar");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("socratic-tutor.lora.gguf"), vec![0u8; 16]).unwrap();

        let found = weights::personas_in(&dir);
        assert_eq!(found.len(), 1);
        assert!(found[0].contract.conversational(), "a bare adapter must stay a voice");
        assert_eq!(found[0].contract.max_tokens, None);
        assert_eq!(found[0].contract.prompt_template, None);
        assert_eq!(found[0].name, "socratic tutor");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// The regression for the import that "didn't really work": a sidecar
    /// written by an earlier build carries `kind` and no template, so a job
    /// was refused with "did not ship the prompt it was trained with" even
    /// though the file it came from did. The kept `.pigeon` repairs it.
    #[test]
    fn a_stale_sidecar_is_rebuilt_from_the_kept_pigeon() {
        let root = std::env::temp_dir().join("pigeon-test-repair");
        let _ = std::fs::remove_dir_all(&root);
        let (adapters, pigeons) = (root.join("adapters"), root.join("pigeons"));
        std::fs::create_dir_all(&adapters).unwrap();
        std::fs::create_dir_all(&pigeons).unwrap();
        let manifest = manifest_json("freeform", r#","output_contract":{"type":"text","max_tokens":45}"#);
        let zip = pigeon_zip(&[("pigeon.json", &manifest), ("adapter.lora.gguf", &lora_bytes())]);
        std::fs::write(pigeons.join("note-to-title.pigeon"), &zip).unwrap();
        std::fs::write(adapters.join("note-to-title.lora.gguf"), b"x").unwrap();
        std::fs::write(
            adapters.join("note-to-title.lora.json"),
            br#"{"kind":"freeform","label":"note-to-title","pigeon_id":"note-to-title"}"#,
        )
        .unwrap();

        assert_eq!(repair_sidecars_in(&adapters, &pigeons, &[], &Here::with_projectors(Vec::new())), 1);
        let found = weights::personas_in(&adapters);
        assert_eq!(found[0].contract.prompt_template.as_deref(), Some("{input}"));
        assert_eq!(found[0].contract.max_tokens, Some(45));
        // Already whole: a second pass touches nothing.
        assert_eq!(repair_sidecars_in(&adapters, &pigeons, &[], &Here::with_projectors(Vec::new())), 0);
        let _ = std::fs::remove_dir_all(&root);
    }

    /* ── grounded (§8) and skill (§9) ──────────────────────────────────────── */

    const CHUNKS: &[u8] = br#"{"chunks":[{"ordinal":1,"file":"m.md","title":"Downloads","text":"Models download with resumable range requests.","est_tokens":9}],"total_est_tokens":9}"#;
    const FACE_GRAMMAR: &[u8] = include_bytes!("../tests/fixtures/face-grammar.skill.json");
    const WHOLE: &str = r#","material":{"retrieval":"whole","sections":1}"#;

    /// A PNG's signature and IHDR — everything `icon_ok` reads.
    fn png(w: u32, h: u32) -> Vec<u8> {
        let mut b = vec![0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13];
        b.extend_from_slice(b"IHDR");
        b.extend_from_slice(&w.to_be_bytes());
        b.extend_from_slice(&h.to_be_bytes());
        b.extend_from_slice(&[8, 2, 0, 0, 0, 0, 0, 0, 0]);
        b
    }

    #[test]
    fn an_icon_is_a_png_of_a_sensible_size() {
        assert!(icon_ok(&png(512, 512)));
        assert!(icon_ok(&png(16, 1024)));
        assert!(!icon_ok(b"GIF89a, not a png at all, long enough"));
        assert!(!icon_ok(&png(8, 8)), "too small to be a picture");
        assert!(!icon_ok(&png(4096, 512)), "too wide a canvas");
        assert!(!icon_ok(&png(512, 512)[..20]), "cut short");
        let mut big = png(512, 512);
        big.resize(ICON_MAX_BYTES + 1, 0);
        assert!(!icon_ok(&big), "too many bytes");
    }

    /// An icon is decoration: a good one is kept and reaches the page, a bad
    /// one is left out without refusing anything, and a re-import without one
    /// takes the old picture away.
    #[test]
    fn the_icon_is_kept_when_it_is_a_png_and_left_out_when_it_is_not() {
        let dir = std::env::temp_dir().join("pigeon-test-icon");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let manifest_bytes = manifest_json("freeform", r#","output_contract":{"type":"text","max_tokens":45}"#);
        let manifest: Manifest = serde_json::from_slice(&manifest_bytes).unwrap();
        let icon = png(512, 512);
        let with = pigeon_zip(&[("pigeon.json", &manifest_bytes), ("adapter.lora.gguf", &lora_bytes()), (ICON_FILE, &icon)]);
        let broken = pigeon_zip(&[("pigeon.json", &manifest_bytes), ("adapter.lora.gguf", &lora_bytes()), (ICON_FILE, b"<svg/>")]);
        let without = pigeon_zip(&[("pigeon.json", &manifest_bytes), ("adapter.lora.gguf", &lora_bytes())]);

        write_sidecar(&dir, &manifest, &with, &[]).unwrap();
        assert_eq!(std::fs::read(icon_path(&dir, "note-to-title")).unwrap(), icon);
        let url = weights::icon_data_url(&dir, "note-to-title").unwrap();
        assert!(url.starts_with("data:image/png;base64,iVBORw0KGgo"), "{url}");

        assert!(write_sidecar(&dir, &manifest, &broken, &[]).is_ok(), "a broken icon never refuses the import");
        assert!(!icon_path(&dir, "note-to-title").exists());
        assert_eq!(weights::icon_data_url(&dir, "note-to-title"), None);

        write_sidecar(&dir, &manifest, &with, &[]).unwrap();
        write_sidecar(&dir, &manifest, &without, &[]).unwrap();
        assert!(!icon_path(&dir, "note-to-title").exists(), "a re-import with no icon takes the old one away");

        // A file dropped in by hand that is not a PNG never reaches the page.
        std::fs::write(icon_path(&dir, "note-to-title"), b"not a png").unwrap();
        assert_eq!(weights::icon_data_url(&dir, "note-to-title"), None);
        let _ = std::fs::remove_dir_all(&dir);
    }
    const FACE: &str = r#","skill":{"name":"face-grammar","version":1},"output_contract":{"type":"json","fields":["eyes","mouth","brows","extras"],"max_tokens":48}"#;

    fn manifest_t(kind: &str, template: &str, overrides: &str) -> Vec<u8> {
        let overrides = format!("{}{overrides}", stated(kind, overrides));
        format!(
            r#"{{"format_version":1,"name":"n","id":"n","kind":"{kind}",
                 "base_model":{{"file":"Qwen2.5-1.5B-Instruct-Q4_K_M.gguf","sha256":"deadbeef","arch":"qwen2","name":"Qwen2.5","size":"1.5B"}},
                 "prompt_template":"{template}"{overrides}}}"#
        )
        .into_bytes()
    }

    fn installed() -> [InstalledBase; 1] {
        [base("qwen2", "Qwen2.5", "1.5B", Some("deadbeef"))]
    }

    #[test]
    fn a_kind_this_app_does_not_know_is_refused_by_name_not_read_as_freeform() {
        let zip = pigeon_zip(&[("pigeon.json", &manifest_json("summoner", "")), ("adapter.lora.gguf", &lora_bytes())]);
        let err = validate(&zip, &installed()).unwrap_err();
        assert_eq!(err, Refused::UnknownKind("summoner".into()));
        assert!(err.message().contains("summoner") && err.message().contains("update the app"));
    }

    #[test]
    fn a_grounded_pigeon_with_its_material_loads() {
        let zip = pigeon_zip(&[
            ("pigeon.json", &manifest_t("grounded", "{material} {input}", WHOLE)),
            ("adapter.lora.gguf", &lora_bytes()),
            (MATERIAL_FILE, CHUNKS),
        ]);
        assert_eq!(validate(&zip, &installed()).expect("loads").base_match, Some(BaseMatch::Exact));
    }

    #[test]
    fn a_grounded_pigeon_without_its_material_is_rejected() {
        let zip = pigeon_zip(&[("pigeon.json", &manifest_t("grounded", "{material} {input}", WHOLE)), ("adapter.lora.gguf", &lora_bytes())]);
        assert_eq!(
            validate(&zip, &installed()),
            Err(Refused::MissingRequiredFile { kind: "grounded".into(), file: MATERIAL_FILE.into() })
        );
        let empty = pigeon_zip(&[
            ("pigeon.json", &manifest_t("grounded", "{material} {input}", WHOLE)),
            ("adapter.lora.gguf", &lora_bytes()),
            (MATERIAL_FILE, br#"{"chunks":[]}"#),
        ]);
        assert!(matches!(validate(&empty, &installed()), Err(Refused::BadPayload(_))));
    }

    #[test]
    fn the_material_slot_and_the_grounded_kind_imply_each_other_both_ways() {
        let no_slot = pigeon_zip(&[
            ("pigeon.json", &manifest_t("grounded", "{input}", WHOLE)),
            ("adapter.lora.gguf", &lora_bytes()),
            (MATERIAL_FILE, CHUNKS),
        ]);
        assert_eq!(validate(&no_slot, &installed()), Err(Refused::MaterialSlotMissing));
        let stray = pigeon_zip(&[("pigeon.json", &manifest_t("freeform", "{material} {input}", "")), ("adapter.lora.gguf", &lora_bytes())]);
        assert_eq!(validate(&stray, &installed()), Err(Refused::MaterialSlotOnWrongKind("freeform".into())));
    }

    #[test]
    fn a_retrieval_method_this_version_cannot_do_is_refused_and_named() {
        let zip = pigeon_zip(&[
            ("pigeon.json", &manifest_t("grounded", "{material} {input}", r#","material":{"retrieval":"embedding-v1","sections":1}"#)),
            ("adapter.lora.gguf", &lora_bytes()),
            (MATERIAL_FILE, CHUNKS),
        ]);
        let err = validate(&zip, &installed()).unwrap_err();
        assert_eq!(err, Refused::UnknownRetrieval("embedding-v1".into()));
        assert!(err.message().contains("embedding-v1") && err.message().contains("update the app"));
    }

    #[test]
    fn a_skill_pigeon_carrying_its_parts_table_loads() {
        let zip = pigeon_zip(&[
            ("pigeon.json", &manifest_t("freeform", "{input}", FACE)),
            ("adapter.lora.gguf", &lora_bytes()),
            (skill::PAYLOAD_FILE, FACE_GRAMMAR),
        ]);
        assert!(validate(&zip, &installed()).is_ok());
    }

    #[test]
    fn a_skill_is_accepted_by_how_it_is_drawn_not_by_its_name() {
        // A skill this app has no entry for opens: it says how it is drawn.
        let named = FACE.replace("face-grammar", "chart-grammar");
        let mut payload: serde_json::Value = serde_json::from_slice(FACE_GRAMMAR).unwrap();
        payload["name"] = "chart-grammar".into();
        payload["render"] = serde_json::json!({"method": "concat", "version": 1});
        let chart = serde_json::to_vec(&payload).unwrap();
        let zip = pigeon_zip(&[("pigeon.json", &manifest_t("freeform", "{input}", &named)), ("adapter.lora.gguf", &lora_bytes()), (skill::PAYLOAD_FILE, &chart)]);
        assert!(validate(&zip, &installed()).is_ok());

        // Drawn by a method this app cannot perform: refused, by name.
        payload["render"] = serde_json::json!({"method": "layers", "version": 1});
        let layers = serde_json::to_vec(&payload).unwrap();
        let zip = pigeon_zip(&[("pigeon.json", &manifest_t("freeform", "{input}", &named)), ("adapter.lora.gguf", &lora_bytes()), (skill::PAYLOAD_FILE, &layers)]);
        let err = validate(&zip, &installed()).unwrap_err();
        assert!(err.message().contains("layers") && err.message().contains("update the app"), "{}", err.message());

        // The table is still the contract: face-grammar v2 is not v1.
        let v2 = FACE.replace(r#""version":1"#, r#""version":2"#);
        let zip = pigeon_zip(&[("pigeon.json", &manifest_t("freeform", "{input}", &v2)), ("adapter.lora.gguf", &lora_bytes()), (skill::PAYLOAD_FILE, FACE_GRAMMAR)]);
        assert!(validate(&zip, &installed()).unwrap_err().message().contains("trained against"));
    }

    #[test]
    fn a_skill_pigeon_without_its_payload_is_rejected() {
        let zip = pigeon_zip(&[("pigeon.json", &manifest_t("freeform", "{input}", FACE)), ("adapter.lora.gguf", &lora_bytes())]);
        assert_eq!(
            validate(&zip, &installed()),
            Err(Refused::MissingRequiredFile { kind: "freeform".into(), file: skill::PAYLOAD_FILE.into() })
        );
    }

    /// The payloads travel beside the adapter, and a sidecar written by a
    /// build that did not know about them is rebuilt — before this, a grounded
    /// Pigeon was installed as plain freeform and answered from nothing.
    #[test]
    fn payloads_are_kept_beside_the_adapter_and_old_sidecars_are_rebuilt() {
        let root = std::env::temp_dir().join("pigeon-test-payloads");
        let _ = std::fs::remove_dir_all(&root);
        let (adapters, pigeons) = (root.join("adapters"), root.join("pigeons"));
        std::fs::create_dir_all(&adapters).unwrap();
        std::fs::create_dir_all(&pigeons).unwrap();
        let both = format!("{WHOLE}{FACE}");
        let icon = png(512, 512);
        let zip = pigeon_zip(&[
            ("pigeon.json", &manifest_t("grounded", "{material} {input}", &both)),
            ("adapter.lora.gguf", &lora_bytes()),
            (MATERIAL_FILE, CHUNKS),
            (skill::PAYLOAD_FILE, FACE_GRAMMAR),
            (ICON_FILE, &icon),
        ]);
        std::fs::write(pigeons.join("n.pigeon"), &zip).unwrap();
        std::fs::write(adapters.join("n.lora.gguf"), b"x").unwrap();
        // What the previous build wrote: a full template, and nothing else.
        std::fs::write(adapters.join("n.lora.json"), br#"{"kind":"grounded","label":"n","prompt_template":"{material} {input}"}"#).unwrap();

        assert_eq!(repair_sidecars_in(&adapters, &pigeons, &[], &Here::with_projectors(Vec::new())), 1);
        let found = weights::personas_in(&adapters);
        assert_eq!(found.len(), 1, "payload files must not be taken for adapters");
        let c = &found[0].contract;
        assert_eq!((c.sidecar, c.retrieval.as_deref(), c.skill.as_deref(), c.skill_version), (SIDECAR_VERSION, Some("whole"), Some("face-grammar"), Some(1)));
        assert_eq!(std::fs::read(payload_path(&adapters, "n", "material")).unwrap(), CHUNKS);
        assert_eq!(std::fs::read(payload_path(&adapters, "n", "skill")).unwrap(), FACE_GRAMMAR);
        assert_eq!(std::fs::read(icon_path(&adapters, "n")).unwrap(), icon, "an import from before icons gains its icon");
        assert_eq!(found.len(), 1, "the icon must not be taken for an adapter either");
        assert_eq!(repair_sidecars_in(&adapters, &pigeons, &[], &Here::with_projectors(Vec::new())), 0, "a current sidecar is left alone");
        let _ = std::fs::remove_dir_all(&root);
    }

    /// The same weights re-packed with a new retrieval method or revision are
    /// not "already here": the contract beside the adapter decides too.
    #[test]
    fn a_changed_contract_on_the_same_weights_is_not_already_installed() {
        let root = std::env::temp_dir().join("pigeon-test-contract-differs");
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let m: Manifest = serde_json::from_slice(&manifest_t("grounded", "{material} {input}", WHOLE)).unwrap();
        let same = weights::Contract {
            prompt_template: Some(m.prompt_template.clone()),
            retrieval: m.material.as_ref().map(|x| x.retrieval.clone()),
            max_tokens: m.output_contract.as_ref().and_then(|o| o.max_tokens),
            card: m.card.clone(),
            ..Default::default()
        };
        let sidecar = root.join(format!("{}.lora.json", m.id));
        // No sidecar at all: nothing to differ from.
        assert!(!contract_differs_in(&root, &m));
        std::fs::write(&sidecar, serde_json::to_vec(&same).unwrap()).unwrap();
        assert!(!contract_differs_in(&root, &m), "an identical contract is the same Pigeon");
        std::fs::write(&sidecar, serde_json::to_vec(&weights::Contract { retrieval: Some("keyword-overlap-v1".into()), ..same.clone() }).unwrap()).unwrap();
        assert!(contract_differs_in(&root, &m), "a different retrieval method is an update");
        let mut card = same.card.clone().unwrap_or_else(|| serde_json::json!({}));
        card["revision"] = serde_json::json!(7);
        std::fs::write(&sidecar, serde_json::to_vec(&weights::Contract { card: Some(card), ..same.clone() }).unwrap()).unwrap();
        assert!(contract_differs_in(&root, &m), "a different revision is an update");
        // A card too long to keep is not kept, and is not an update either.
        let mut long = m.clone();
        long.card = Some(serde_json::json!({ "does": "x".repeat(61), "revision": 3 }));
        std::fs::write(&sidecar, serde_json::to_vec(&weights::Contract { card: None, ..same.clone() }).unwrap()).unwrap();
        assert!(!contract_differs_in(&root, &long), "a card the app drops made every opening an update");
    }

    #[test]
    fn removing_a_persona_takes_the_adapter_its_sidecar_its_payload_and_the_kept_original() {
        let root = std::env::temp_dir().join("pigeon-test-remove");
        let _ = std::fs::remove_dir_all(&root);
        let (adapters, pigeons) = (root.join("adapters"), root.join("pigeons"));
        std::fs::create_dir_all(&adapters).unwrap();
        std::fs::create_dir_all(&pigeons).unwrap();
        std::fs::write(adapters.join("n.lora.gguf"), b"x").unwrap();
        std::fs::write(adapters.join("n.lora.json"), b"{}").unwrap();
        std::fs::write(payload_path(&adapters, "n", "skill"), b"{}").unwrap();
        std::fs::write(payload_path(&adapters, "n", "material"), b"{}").unwrap();
        std::fs::write(icon_path(&adapters, "n"), b"x").unwrap();
        std::fs::write(pigeons.join("n.pigeon"), b"x").unwrap();
        // A neighbour with a name that starts the same must survive.
        std::fs::write(adapters.join("nightly.lora.gguf"), b"x").unwrap();

        assert!(remove_persona_in(&adapters, Some(&pigeons), "n").is_ok());
        assert!(!adapters.join("n.lora.gguf").exists());
        assert!(!adapters.join("n.lora.json").exists());
        assert!(!payload_path(&adapters, "n", "skill").exists());
        assert!(!payload_path(&adapters, "n", "material").exists());
        assert!(!icon_path(&adapters, "n").exists());
        assert!(!pigeons.join("n.pigeon").exists());
        assert!(adapters.join("nightly.lora.gguf").exists(), "a same-prefix neighbour is untouched");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn removing_a_persona_missing_its_adapter_is_refused_by_name_and_nothing_partial_survives_the_check() {
        let root = std::env::temp_dir().join("pigeon-test-remove-missing");
        let _ = std::fs::remove_dir_all(&root);
        let (adapters, pigeons) = (root.join("adapters"), root.join("pigeons"));
        std::fs::create_dir_all(&adapters).unwrap();
        std::fs::create_dir_all(&pigeons).unwrap();
        // A sidecar with no adapter beside it — not a persona this app would
        // ever list, and not one it should half-delete either.
        std::fs::write(adapters.join("ghost.lora.json"), b"{}").unwrap();

        assert_eq!(remove_persona_in(&adapters, Some(&pigeons), "ghost"), Err("no such Pigeon: \"ghost\"".into()));
        assert!(adapters.join("ghost.lora.json").exists(), "refused before touching anything");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn removing_a_persona_refuses_an_id_that_is_really_a_path() {
        let root = std::env::temp_dir().join("pigeon-test-remove-traversal");
        let _ = std::fs::remove_dir_all(&root);
        let (adapters, outside) = (root.join("app").join("adapters"), root.join("outside"));
        std::fs::create_dir_all(&adapters).unwrap();
        std::fs::create_dir_all(&outside).unwrap();
        // A real adapter one level up — the thing a "../outside/victim" id would reach.
        std::fs::write(outside.join("victim.lora.gguf"), b"x").unwrap();

        for id in ["../../outside/victim", "../victim", "..", ".", "", "a/b", "a\\b", "/abs"] {
            assert!(remove_persona_in(&adapters, None, id).is_err(), "{id:?} must be refused");
        }
        assert!(outside.join("victim.lora.gguf").exists(), "nothing outside the adapters folder is touched");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn labels_come_off_labels_txt_one_per_line() {
        let zip = pigeon_zip(&[
            ("pigeon.json", &manifest_json("classifier", "")),
            ("adapter.lora.gguf", &lora_bytes()),
            ("labels.txt", b"urgent\n  waiting  \n\nlater\n"),
        ]);
        let labels = |zip: &[u8]| labels_in(&zip_store::list_entries(zip).unwrap(), zip);
        assert_eq!(labels(&zip), ["urgent", "waiting", "later"]);
        // Nothing to read is empty, not an error.
        assert!(labels(&pigeon_zip(&[("adapter.lora.gguf", &lora_bytes())])).is_empty());
    }

    #[test]
    fn the_template_puts_the_text_in_its_input_slot() {
        assert_eq!(ask::fill("{input}", "  a note  ", None), "a note");
        assert_eq!(ask::fill("Title this: {input}", "a note", None), "Title this: a note");
        // Every other byte is left exactly as it was.
        assert_eq!(ask::fill("### {input}\n---", "x", None), "### x\n---");
    }

    #[test]
    fn installed_bases_reads_real_gguf_files_and_their_markers() {
        let dir = std::env::temp_dir().join("pigeon-test-installed-bases");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let model = dir.join("Qwen2.5-1.5B-Instruct-Q4_K_M.gguf");
        std::fs::write(&model, build_header(&[
            ("general.architecture", "qwen2"),
            ("general.basename", "Qwen2.5"),
            ("general.size_label", "1.5B"),
        ])).unwrap();
        let hashes = crate::hashes::Hashes::at(&dir.with_extension("hashes.json"));
        hashes.record(&model, "deadbeef");
        // Not a GGUF at all — must be skipped rather than aborting the scan.
        std::fs::write(dir.join("readme.gguf"), b"not really a gguf").unwrap();

        let found = installed_bases_in(&[dir.clone()], &hashes);
        assert_eq!(found.len(), 1, "{found:?}");
        assert_eq!(found[0].identity.arch, "qwen2");
        assert_eq!(found[0].sha256.as_deref(), Some("deadbeef"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn an_import_hashes_the_base_file_it_names_once_and_no_other() {
        let mut ctx = tauri::test::mock_context(tauri::test::noop_assets());
        ctx.config_mut().identifier = "mode.airoplane.pigeon.test-named-hash".into();
        let app = tauri::test::mock_builder().build(ctx).expect("mock app");
        let handle = app.handle().clone();
        let root = handle.path().app_data_dir().unwrap();
        let _ = std::fs::remove_dir_all(&root);
        let own = weights::own_dir(&handle).unwrap();
        let header = build_header(&[("general.architecture", "qwen2"), ("general.basename", "Qwen2.5"), ("general.size_label", "1.5B")]);
        std::fs::write(own.join("Qwen2.5-1.5B-Instruct-Q4_K_M.gguf"), &header).unwrap();
        std::fs::write(own.join("Qwen2.5-1.5B-Instruct-F16.gguf"), [header.as_slice(), b"f16"].concat()).unwrap();
        let installed = installed_bases_in(&[own.clone()], &crate::hashes::of(&handle));
        assert!(installed.iter().all(|b| b.sha256.is_none()), "nothing is hashed to list the bases");
        let zip = pigeon_zip(&[("pigeon.json", &manifest_json("freeform", "")), ("adapter.lora.gguf", &lora_bytes())]);
        let entries = zip_store::list_entries(&zip).unwrap();
        let filled = with_named_hash(&handle, &installed, &entries, &zip);
        let sha = |file: &str| filled.iter().find(|b| b.file == file).and_then(|b| b.sha256.clone());
        assert_eq!(sha("Qwen2.5-1.5B-Instruct-Q4_K_M.gguf"), Some(crate::download::sha256_hex(&header)));
        assert_eq!(sha("Qwen2.5-1.5B-Instruct-F16.gguf"), None);
        assert!(!std::fs::read_dir(&own).unwrap().any(|e| e.unwrap().file_name().to_string_lossy().ends_with(".sha256")));
        let _ = std::fs::remove_dir_all(&root);
    }

    /// D83, end to end through the app's own door: a base Pigeon (a persona
    /// with its system prompt and no adapter) is met, added with no weights
    /// copied, listed from its sidecar, asked from its kept file, found
    /// "already here" when added again, replaced by a trained revision, and
    /// removed. The regression for "this file is missing the Pigeon's trained
    /// weights" on Flight School's Prompted card.
    #[test]
    fn a_base_pigeon_with_no_adapter_is_added_from_a_file() {
        let mut ctx = tauri::test::mock_context(tauri::test::noop_assets());
        ctx.config_mut().identifier = "mode.airoplane.pigeon.test-base-only".into();
        let app = tauri::test::mock_builder().manage(HeldImports::default()).build(ctx).expect("mock app");
        let handle = app.handle().clone();
        let root = handle.path().app_data_dir().unwrap();
        let _ = std::fs::remove_dir_all(&root);
        let manifest = manifest_json("persona", r#","base_only":true,"output_contract":{"type":"text","max_tokens":200}"#);
        let file = pigeon_zip(&[("pigeon.json", &manifest), ("system_prompt.txt", b"Explain it plainly."), ("icon.png", &png(64, 64))]);

        let met = inspect_bytes(&handle, &installed(), &std::sync::Arc::new(blob::Blob::owned(file.clone())), "plain.pigeon");
        assert!(matches!(&met[..], [Meet::Ready { pigeon_id, kind, update: false, .. }] if pigeon_id == "note-to-title" && kind == "persona"), "{met:?}");
        match &add_bytes(&handle, &installed(), &file, "plain.pigeon", None)[..] {
            [ImportOutcome::Added { id, replaced: false, .. }] => assert_eq!(id, "note-to-title"),
            other => panic!("{other:?}"),
        }
        let adapters = weights::personas_dir(&handle).unwrap();
        assert!(!adapters.join("note-to-title.lora.gguf").exists(), "no weights to copy");
        let found = weights::personas(&handle);
        assert_eq!(found.len(), 1, "{found:?}");
        assert!(found[0].contract.base_only && found[0].contract.conversational() && found[0].bytes == 0);
        assert_eq!(found[0].contract.max_tokens, Some(200));
        assert!(weights::icon_data_url(found[0].path.parent().unwrap(), "note-to-title").is_some(), "its page finds its icon beside the sidecar");
        assert!(weights::persona_by_id(&handle, "note-to-title").is_some_and(|p| p.contract.base_only));
        // The engine is asked with the kept file; nothing is attached.
        let kept = crate::inprocess::wanted(&handle, "note-to-title").expect("asked from its kept file");
        assert_eq!(std::fs::read(&kept).unwrap(), file);

        // The same file again is already here, met or added.
        let again = inspect_bytes(&handle, &installed(), &std::sync::Arc::new(blob::Blob::owned(file.clone())), "plain.pigeon");
        assert!(matches!(&again[..], [Meet::Already { base_only: true, .. }]), "{again:?}");
        assert!(matches!(&add_bytes(&handle, &installed(), &file, "plain.pigeon", None)[..], [ImportOutcome::Already { .. }]));
        // A new revision of its prompt is not "already here": it is an update.
        let reworded = pigeon_zip(&[("pigeon.json", &manifest), ("system_prompt.txt", b"Explain it in one sentence.")]);
        let met = inspect_bytes(&handle, &installed(), &std::sync::Arc::new(blob::Blob::owned(reworded.clone())), "plain.pigeon");
        assert!(matches!(&met[..], [Meet::Ready { update: true, .. }]), "{met:?}");
        assert!(matches!(&add_bytes(&handle, &installed(), &reworded, "plain.pigeon", None)[..], [ImportOutcome::Added { replaced: true, .. }]));
        assert!(revision::has_previous(&adapters, "note-to-title"), "the earlier wording is set aside until this one passes");
        // A trained revision replaces it like any other; then the base one is gone.
        let trained = pigeon_zip(&[("pigeon.json", &manifest_json("persona", "")), ("system_prompt.txt", b"Explain."), ("adapter.lora.gguf", &lora_bytes())]);
        assert!(matches!(&add_bytes(&handle, &installed(), &trained, "plain.pigeon", None)[..], [ImportOutcome::Added { replaced: true, .. }]));
        assert!(adapters.join("note-to-title.lora.gguf").is_file() && !weights::personas(&handle)[0].contract.base_only);
        revision::swap(&adapters, &pigeons_dir(&handle).unwrap(), "note-to-title").unwrap();
        assert!(!adapters.join("note-to-title.lora.gguf").exists(), "swapped back to the base revision, no adapter left live");
        assert!(weights::personas(&handle)[0].contract.base_only);

        remove_persona_in(&adapters, Some(&pigeons_dir(&handle).unwrap()), "note-to-title").unwrap();
        assert!(weights::personas(&handle).is_empty() && crate::inprocess::wanted(&handle, "note-to-title").is_none());
        assert!(remove_persona_in(&adapters, None, "note-to-title").is_err(), "removed once");
        // A sidecar left with no adapter that does not say base_only is no Pigeon.
        std::fs::write(adapters.join("orphan.lora.json"), r#"{"label":"Orphan","kind":"persona"}"#).unwrap();
        assert!(weights::personas(&handle).is_empty() && weights::persona_by_id(&handle, "orphan").is_none());
        let _ = std::fs::remove_dir_all(&root);
    }

    /// Patch's real Pigeons, as Flight School sealed them, through this app's
    /// own import check: every one is accepted on this Mac's bases and sealed
    /// by the key the shipped trust list names. Needs the files and the bases:
    ///   PATCH_PIGEONS_DIR=<dir>/patch-pigeons cargo test --lib -- --ignored --nocapture patchs_real_pigeons
    #[test]
    #[ignore]
    fn patchs_real_pigeons_are_accepted_and_sealed_by_the_shipped_key() {
        let Some(dir) = std::env::var_os("PATCH_PIGEONS_DIR").map(PathBuf::from) else { return };
        let shipped = parse_trusted(include_str!("../keys/seal-keys.json")).unwrap();
        assert!(shipped.iter().any(|k| k.id == "5bce0d9361532748" && !k.revoked), "the shipped trust list names the key");
        let home = PathBuf::from(std::env::var_os("HOME").unwrap());
        let dirs = [home.join("Library/Application Support/mode.airoplane.pigeon/models")];
        let hashes = crate::hashes::Hashes::at(&home.join("Library/Application Support/mode.airoplane.pigeon").join(crate::hashes::FILE));
        let installed = installed_bases_in(&dirs, &hashes);
        let ids = ["patch-router", "patch-planner-trained", "patch-asks", "patch-focus", "tidier", "ocr-tidy", "pen", "pen-no-figures", "peek", "peek-words"];
        for id in ids {
            let bytes = std::fs::read(dir.join(format!("{id}.pigeon"))).unwrap();
            let report = validate(&bytes, &installed).unwrap_or_else(|r| panic!("{id}: {}", r.message()));
            eprintln!("{id:28} sealed by {:?}, base {:?}", report.sealed_by, report.base_match);
            assert_eq!(report.manifest.id, id);
            assert_eq!(report.sealed_by.as_deref(), Some("5bce0d9361532748"), "{id}");
        }
    }

    /* ── seals and skill packs ─────────────────────────────────────────────── */

    use ring::signature::{Ed25519KeyPair, KeyPair};

    const TEST1_SEED: [u8; 32] = [
        0x9d, 0x61, 0xb1, 0x9d, 0xef, 0xfd, 0x5a, 0x60, 0xba, 0x84, 0x4a, 0xf4, 0x92, 0xec, 0x2c, 0xc4, 0x44, 0x49, 0xc5,
        0x69, 0x7b, 0x32, 0x69, 0x19, 0x70, 0x3b, 0xac, 0x03, 0x1c, 0xae, 0x7f, 0x60,
    ];
    const OTHER_SEED: [u8; 32] = [7; 32];

    /// The `seal.json` a packer holding `seed` writes for `files`.
    fn seal_for(files: &[(&str, &[u8])], seed: &[u8; 32]) -> Vec<u8> {
        let zip = pigeon_zip(files);
        let msg = seal::seal_message(&zip_store::list_entries(&zip).unwrap(), &zip);
        let pair = Ed25519KeyPair::from_seed_unchecked(seed).unwrap();
        format!(
            r#"{{"scheme":"{}","key":"{}","signature":"{}"}}"#,
            seal::SCHEME,
            seal::key_id(pair.public_key().as_ref()),
            seal::to_hex(pair.sign(&msg).as_ref())
        )
        .into_bytes()
    }

    fn sealed(files: &[(&str, &[u8])], seed: &[u8; 32]) -> Vec<u8> {
        let seal = seal_for(files, seed);
        let mut all = files.to_vec();
        all.push((seal::SEAL_FILE, &seal));
        pigeon_zip(&all)
    }

    fn broken(zip: &[u8]) -> String {
        match validate(zip, &installed()) {
            Err(Refused::BrokenSeal(why)) => why,
            other => panic!("expected BrokenSeal, got {other:?}"),
        }
    }

    #[test]
    fn a_sealed_data_pigeon_loads_and_says_who_sealed_it() {
        let manifest = manifest_json("freeform", "");
        let files: [(&str, &[u8]); 2] = [("pigeon.json", &manifest), ("adapter.lora.gguf", &lora_bytes())];
        let report = validate(&sealed(&files, &TEST1_SEED), &installed()).expect("loads");
        assert_eq!(report.sealed_by.as_deref(), Some(test_key().id.as_str()));
        // Unsealed data-only Pigeons stay valid, and say nobody sealed them.
        assert_eq!(validate(&pigeon_zip(&files), &installed()).unwrap().sealed_by, None);
    }

    #[test]
    fn any_change_after_sealing_breaks_the_seal() {
        let manifest = manifest_json("freeform", "");
        let files: [(&str, &[u8]); 2] = [("pigeon.json", &manifest), ("adapter.lora.gguf", &lora_bytes())];
        let seal = seal_for(&files, &TEST1_SEED);
        let with = |f: &[(&str, &[u8])]| pigeon_zip(&[f, &[(seal::SEAL_FILE, &seal[..])]].concat());
        broken(&with(&[("pigeon.json", &manifest), ("adapter.lora.gguf", &lora_bytes_v2())]));
        broken(&with(&[("pigeon.json", &manifest), ("adapter.lora.gguf", &lora_bytes()), ("README.md", b"hi")]));
        broken(&with(&[("pigeon.json", &manifest), ("adapter2.lora.gguf", b"x")]));
        assert!(broken(&pigeon_zip(&[(seal::SEAL_FILE, &seal), files[0], files[1]])).contains("last"));
        /* A seal by a key this app does not trust cannot be verified, so it says
           nothing: a data-only Pigeon loads as unsealed, with a warning (format
           §15.2). Only a skill pack is refused for it. */
        let report = validate(&sealed(&files, &OTHER_SEED), &installed()).expect("loads, unsealed");
        assert_eq!(report.sealed_by, None);
        assert!(report.warning_codes().contains(&"untrusted_seal"));
        let pack = manifest_json(SKILLPACK, "");
        let code: [(&str, &[u8]); 2] = [("pigeon.json", &pack), ("code/main.js", b"export {}")];
        assert_eq!(validate(&sealed(&code, &OTHER_SEED), &installed()).unwrap_err().code(), "untrusted_seal");
    }

    #[test]
    fn a_malformed_seal_json_is_a_broken_seal() {
        let manifest = manifest_json("freeform", "");
        let files: [(&str, &[u8]); 2] = [("pigeon.json", &manifest), ("adapter.lora.gguf", &lora_bytes())];
        let good = String::from_utf8(seal_for(&files, &TEST1_SEED)).unwrap();
        let extra = good.replace('}', r#","note":"hi"}"#);
        let long_key = good.replace("\"key\":\"", "\"key\":\"a");
        let upper_sig = {
            let at = good.find("\"signature\":\"").unwrap() + 13;
            format!("{}{}", &good[..at], good[at..].to_ascii_uppercase())
        };
        let other_scheme = good.replace(seal::SCHEME, "pigeon-seal-ed25519-v2");
        for bad in [extra, long_key, upper_sig, other_scheme, "[]".into(), "not json".into()] {
            let zip = pigeon_zip(&[files[0], files[1], (seal::SEAL_FILE, bad.as_bytes())]);
            broken(&zip);
        }
    }

    #[test]
    fn a_revoked_key_breaks_the_seal() {
        let manifest = manifest_json("freeform", "");
        let files: [(&str, &[u8]); 2] = [("pigeon.json", &manifest), ("adapter.lora.gguf", &lora_bytes())];
        let zip = sealed(&files, &TEST1_SEED);
        let entries = zip_store::list_entries(&zip).unwrap();
        let key = test_key();
        assert_eq!(seal_check(&entries, &zip, &[key.clone()]), Ok(seal::Sealed::By(key.id.clone())));
        let revoked = TrustedKey { revoked: true, ..key };
        let untrusted = |keys: &[TrustedKey]| match seal_check(&entries, &zip, keys) {
            Ok(seal::Sealed::Untrusted { why, .. }) => why,
            other => panic!("expected Untrusted, got {other:?}"),
        };
        assert!(untrusted(&[revoked]).contains("revoked"));
        assert!(untrusted(&[]).contains("does not trust"));
    }

    #[test]
    fn a_skill_pack_must_be_sealed_and_is_never_read_as_a_pigeon() {
        let manifest = manifest_json(SKILLPACK, "");
        let files: [(&str, &[u8]); 2] = [("pigeon.json", &manifest), ("code/main.js", b"export {}")];
        assert_eq!(validate(&pigeon_zip(&files), &installed()), Err(Refused::CodeWithoutSeal));
        let err = validate(&sealed(&files, &TEST1_SEED), &installed()).unwrap_err();
        assert_eq!(err, Refused::UnsupportedKind { kind: SKILLPACK.into(), sealed_by: Some(test_key().id), pack_needs: None });
        assert!(err.message().contains("imported as Patch"), "{}", err.message());
        // The import path checks it as Patch, and this one is not Patch.
        match crate::patch::import_into(
            &std::env::temp_dir().join("pigeon-test-skillpack-not-patch"),
            &sealed(&files, &TEST1_SEED),
            &crate::patch::test_support::ctx(),
            None,
            "x.pigeon",
        ) {
            (ImportOutcome::Refused { reason, .. }, false) => assert!(reason.contains("\"note-to-title\""), "{reason}"),
            other => panic!("{other:?}"),
        }
        // A tampered skill pack is a broken seal, never "not supported".
        let seal = seal_for(&files, &TEST1_SEED);
        broken(&pigeon_zip(&[files[0], ("code/main.js", b"evil()"), (seal::SEAL_FILE, &seal)]));
    }

    #[test]
    fn code_in_any_other_kind_is_refused_sealed_or_not() {
        let manifest = manifest_json("freeform", "");
        let files: [(&str, &[u8]); 3] = [("pigeon.json", &manifest), ("adapter.lora.gguf", &lora_bytes()), ("code/x.js", b"1")];
        assert_eq!(validate(&pigeon_zip(&files), &installed()), Err(Refused::CodeInWrongKind("freeform".into())));
        assert_eq!(validate(&sealed(&files, &TEST1_SEED), &installed()), Err(Refused::CodeInWrongKind("freeform".into())));
    }

    /// Flight School's packer and this reader must agree byte for byte. The
    /// fixture is produced in the Flight School repo; until it is copied in,
    /// this test has nothing to compare and says so.
    #[test]
    fn the_flight_school_sealed_fixture_verifies_here() {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures");
        let (Ok(zip), Ok(expected)) = (std::fs::read(dir.join("sealed-test.pigeon")), std::fs::read(dir.join("seal-message.txt")))
        else {
            eprintln!("skipped: tests/fixtures/sealed-test.pigeon and seal-message.txt are not there yet");
            return;
        };
        let entries = zip_store::list_entries(&zip).expect("the fixture obeys the strict rules");
        assert_eq!(seal::seal_message(&entries, &zip), expected, "the signed message differs from Flight School's");
        assert_eq!(seal_check(&entries, &zip, &[test_key()]), Ok(seal::Sealed::By(test_key().id)));
        assert_eq!(validate(&zip, &installed()), Err(Refused::UnsupportedKind { kind: SKILLPACK.into(), sealed_by: Some(test_key().id), pack_needs: None }));
        // As Patch it is refused for what it is: sealed, but not Patch.
        let reason = crate::patch::check_pack(&zip, &crate::patch::test_support::ctx(), crate::patch::PackSource::Imported)
            .unwrap_err();
        assert!(reason.contains("\"test-pack\""), "{reason}");
    }

    /// D84: a nest that carries a skill pack is Patch with the Pigeons he
    /// needs. It is one outcome, checked as Patch (here refused, because this
    /// build does not trust the test key), and none of its members becomes
    /// one of the person's Pigeons.
    #[test]
    fn a_nest_carrying_a_skill_pack_is_patch() {
        let app = tauri::test::mock_builder().build(tauri::test::mock_context(tauri::test::noop_assets())).expect("mock app");
        let nest = pigeon_zip(&[
            ("patch.pigeon", &crate::patch::test_support::pack(2)),
            ("broken.pigeon", b"not a zip"),
            (nest::NEST_FILE, br#"{"format_version":1}"#),
        ]);
        assert!(nest_carries_skillpack(&nest));
        let out = add_bytes(app.handle(), &[], &nest, "patch.nest", None);
        match &out[..] {
            [ImportOutcome::Refused { file, reason, .. }] => {
                assert_eq!(file, "patch.nest");
                assert!(!reason.contains("cannot travel"), "{reason}");
            }
            other => panic!("{other:?}"),
        }
        // A hand-zipped folder of Pigeons is not a nest (format §14).
        let folder = pigeon_zip(&[("broken.pigeon", b"not a zip")]);
        match &add_bytes(app.handle(), &[], &folder, "flock.nest", None)[..] {
            // The code travels with the sentence, for the log (DEV-4 Task 1).
            [ImportOutcome::Refused { file, reason, code }] => assert_eq!(
                (file.as_str(), reason.as_str(), code.as_str()),
                ("flock.nest", Refused::NotANest.message().as_str(), Refused::NotANest.code())
            ),
            other => panic!("{other:?}"),
        }
    }
}

#[cfg(test)]
mod picture_tests {
    use super::*;

    /// Milestone 3's "done when": a picture Pigeon made in Flight School
    /// answers a pasted picture in Pigeon. The real `.pigeon` (projector and
    /// all), imported through the same door the app uses, into a data folder
    /// of its own; the picture server started by `pigeon_run` itself; one
    /// picture of each breed. Ignored: it moves ~900 MB and loads 3 GB.
    ///   PIGEON_TEST_PIGEON=…/dog-breeds.pigeon PIGEON_TEST_PICTURES=…/images \
    ///   cargo test --lib -- --ignored --test-threads=1 a_picture_pigeon
    /// Skips when those, the sidecar, or the vision base are missing.
    /// P1's "done when": a picture Pigeon re-packed by Flight School says
    /// which key each answer presses. Imported through the app's own door
    /// into a data folder of the test's own. Needs no model.
    ///   PIGEON_TEST_PLAYER=…/game-p1.pigeon cargo test --lib -- --ignored a_repacked
    #[test]
    #[ignore]
    fn a_repacked_picture_pigeon_says_which_key_each_answer_presses() {
        let Some(file) = std::env::var_os("PIGEON_TEST_PLAYER") else { return };
        let mut ctx = tauri::test::mock_context(tauri::test::noop_assets());
        ctx.config_mut().identifier = "mode.airoplane.pigeon.test-player".into();
        let app = tauri::test::mock_builder().manage(crate::engine::Engine::new()).build(ctx).expect("mock app");
        let handle = app.handle().clone();
        let root = handle.path().app_data_dir().unwrap();
        assert!(root.ends_with("mode.airoplane.pigeon.test-player"));
        let _ = std::fs::remove_dir_all(&root);
        let home = PathBuf::from(std::env::var_os("HOME").unwrap());
        let base = home.join("Library/Application Support/mode.airoplane.pigeon/models/Qwen3VL-2B-Instruct-Q4_K_M.gguf");
        std::os::unix::fs::symlink(&base, weights::own_dir(&handle).unwrap().join(base.file_name().unwrap())).unwrap();
        let out = add_path(&handle, &installed_bases(&handle), Path::new(&file));
        eprintln!("{out:?}");
        let id = match &out[0] { ImportOutcome::Added { id, .. } => id.clone(), o => panic!("{o:?}") };
        let presses = presses_in(&weights::personas_dir(&handle).unwrap(), &id).expect("it says what it presses");
        eprintln!("{presses}");
        assert!(presses["keys"].as_array().unwrap().iter().any(|k| k["answer"] == "KEY(A)" && k["key"] == "A"));
        let _ = std::fs::remove_dir_all(&root);
    }
}
