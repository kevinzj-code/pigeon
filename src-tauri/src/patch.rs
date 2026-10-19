//! Patch, from a sealed pack.
//!
//! Patch is the default Pigeon: the planner and category prompts, the
//! tunables, the skills' JavaScript and the category adapter all travel as ONE
//! sealed `skillpack` whose id is `patch`. This module decides which pack is
//! Patch at launch, holds it in memory, and puts its adapter where the engine
//! can load it.
//!
//! Two places a pack can come from:
//!   * bundled — `resource_dir()/patch.pigeon` (a debug build also looks in the
//!     checkout's `pack/` and then `dist/`);
//!   * imported — `app_data_dir/patch/patch.pigeon`, written only by `import`.
//!
//! Each candidate must pass every check in `check_pack` — a strict ZIP sealed
//! by a trusted, unrevoked key; the right kind and id; a whole version; the
//! category base models.json pins; an adapter that hashes to the pack's own
//! `adapter_sha256` (that hash, not models.json's, is the authority for the
//! adapter); every prompt and the tunables present and readable; and the pack's
//! copy of every host-API module byte-identical to what this build was made
//! against (`host-api.json`). The higher version wins, a tie goes to the
//! bundled pack, and an imported pack that is refused falls back to the bundled
//! one with a note saying why.
//!
//! The adapter is extracted to `app_data_dir/patch/v<version>-<sha8>/
//! pigeon-category.lora.gguf` — never into `adapters/`, where every file is
//! taken for a persona — and re-hashed at every launch. `patch_status` tells the
//! page what Patch is: data only, never a path.
//!
//! Where the bundled pack comes from: `npm run pack:patch` writes
//! `pack/patch.pigeon` and `pack/host-api.json`, and `npm run build` merges
//! `tauri.release.conf.json`, which bundles both as resources. The base
//! `tauri.conf.json` bundles neither, because Tauri's build script refuses a
//! resource that does not exist, and dev and test builds must not need a pack.

use std::collections::BTreeMap;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager};

use crate::pigeon::{self, seal, ImportOutcome};
use crate::{manifest, weights, zip_store, Role};

pub const PACK_FILE: &str = "patch.pigeon";
/// D84: Patch from v6, his sealed pack beside the Pigeons it needs.
pub const NEST_FILE: &str = "patch.nest";
pub const HOST_API_FILE: &str = "host-api.json";
pub const PATCH_ID: &str = "patch";
/// The app-data subdirectory that holds the imported pack and the extractions.
pub const DIR: &str = "patch";
/// Emitted after an imported pack is stored.
pub const EVENT_CHANGED: &str = "patch-changed";
/// Emitted once the launch-time choice has settled, so a page waiting on
/// `patch_status` can ask once more instead of every half second.
pub const EVENT_SETTLED: &str = "patch-settled";
pub const NO_HOST_API: &str = "this build has no host-api.json";
const NO_PACK: &str = "no Patch pack was found in this build";

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum PackSource {
    Bundled,
    Imported,
}

/// What this build was compiled against, for the host-API check.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum HostApi {
    /// `code/<path>` → the sha256 its bytes must have.
    Map(BTreeMap<String, String>),
    Missing,
    Broken(String),
}

/// Everything `check_pack` compares a pack against, so it is testable
/// without an app.
#[derive(Clone, Debug)]
pub struct SelectCtx {
    pub trusted: Vec<pigeon::TrustedKey>,
    /// models.json's category base.
    pub category_file: String,
    pub category_sha256: String,
    pub host_api: HostApi,
    /// A release build refuses to run Patch without a host-API map; a debug
    /// build skips the check and says so. A parameter, not a `cfg`, so both
    /// behaviours are tested.
    pub require_host_api: bool,
    /// D84: the ids of the Pigeons installed for Patch. `None` skips the
    /// check, for an import whose Pigeons may arrive beside it in a nest.
    pub installed: Option<Vec<String>>,
}

/// One pack that passed every check. The bytes themselves are not kept here:
/// only what Patch runs on, plus what the adapter extraction needs to find its
/// entry again.
#[derive(Clone, Debug)]
pub struct Pack {
    /// The whole `pigeon.json`. Kept for reference; the `pigeon-pack` scheme
    /// deliberately does NOT serve it — only `code/**/*.js`.
    #[allow(dead_code)]
    pub manifest: Value,
    pub name: String,
    pub version: u64,
    pub head: Option<String>,
    pub categories: Value,
    /// Role → the prompt file's JSON.
    pub prompts: BTreeMap<String, Value>,
    pub tunables: Value,
    /// ONLY `code/**.js` entries — never a prompt, the seal or the adapter.
    /// Served to the page by the `pigeon-pack` scheme (`serve`).
    pub code: BTreeMap<String, Vec<u8>>,
    /// sha256 of the whole pack file.
    pub sha256: String,
    pub sealed_by: String,
    pub source: PackSource,
    /// D84: the ids of the Pigeons the pack's code asks. Empty for a pack made
    /// before `needs` (v5 and earlier), which carries its own adapter.
    pub needs: Vec<String>,
    /// The Pigeons his nest carries, as (id, member file). Empty for a pack
    /// that came on its own.
    pub members: Vec<(String, String)>,
    /// The nest he was chosen from, which the engine loads his Pigeons
    /// from by member. Set once chosen; never serialised.
    pub nest: Option<PathBuf>,
}

impl Pack {
    /// `v<version>-<first 8 hex of the pack's sha256>` — the extraction's
    /// directory and the code base's path segment.
    pub fn slot(&self) -> String {
        format!("v{}-{}", self.version, &self.sha256[..8])
    }

    pub fn code_base(&self) -> String {
        format!("pigeon-pack://localhost/{}/code/", self.slot())
    }
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    seal::to_hex(&Sha256::digest(bytes))
}

fn is_sha256(s: &str) -> bool {
    s.len() == 64 && s.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

fn json_entry(entries: &[zip_store::Entry], bytes: &[u8], field: &str, name: &str) -> Result<Value, String> {
    let raw = zip_store::get(entries, bytes, name)?.ok_or_else(|| format!("{field} names {name}, which is not in the pack"))?;
    serde_json::from_slice(raw).map_err(|e| format!("{name} could not be read — {e}"))
}

/// Every check a pack must pass to be Patch. The reason on refusal names the
/// one thing that failed, and never a path.
#[cfg(test)]
pub fn check_pack(bytes: &[u8], ctx: &SelectCtx, source: PackSource) -> Result<Pack, String> {
    check_pack_with(bytes, ctx, source, ctx.installed.as_deref())
}

/// A candidate file, which is Patch's nest (D84) or, before v6, his pack on
/// its own: the pack's bytes and, for a nest, its Pigeons as (id, member).
/// A nest must carry exactly one skill pack; its other members are named by
/// their own manifests' ids (the engine checks each in full when it loads it).
pub fn open_candidate(bytes: &[u8]) -> Result<(&[u8], Option<Vec<(String, String)>>), String> {
    if !pigeon_core::nest::is_nest(bytes) {
        return Ok((bytes, None));
    }
    let members = pigeon_core::nest::members(bytes).map_err(|r| format!("not a valid nest — {}", r.message()))?;
    let mut pack = None;
    let mut pigeons = Vec::new();
    for (file, inner) in members {
        let manifest: Option<Value> = zip_store::read(inner, "pigeon.json").ok().flatten().and_then(|raw| serde_json::from_slice(&raw).ok());
        let field = |k: &str| manifest.as_ref().and_then(|m| m.get(k)).and_then(Value::as_str).map(String::from);
        match (field("kind").as_deref(), field("id")) {
            (Some(pigeon::SKILLPACK), _) if pack.is_some() => return Err("this nest carries two skill packs".into()),
            (Some(pigeon::SKILLPACK), _) => pack = Some(inner),
            (_, Some(id)) if pigeon::plain_id(&id) => pigeons.push((id, file)),
            _ => return Err(format!("{file} in this nest could not be read")),
        }
    }
    Ok((pack.ok_or("this nest carries no skill pack")?, Some(pigeons)))
}

/// `check_pack`, for a candidate that may be a nest: a nest's pack is held to
/// the Pigeons in that same nest, not to anything else on this Mac.
pub fn check_candidate(bytes: &[u8], ctx: &SelectCtx, source: PackSource) -> Result<(Pack, Vec<u8>), String> {
    let (pack_bytes, members) = open_candidate(bytes)?;
    let ids: Option<Vec<String>> = members.as_ref().map(|m| m.iter().map(|(id, _)| id.clone()).collect());
    let mut pack = check_pack_with(pack_bytes, ctx, source, ids.as_deref().or(ctx.installed.as_deref()))?;
    pack.members = members.unwrap_or_default();
    Ok((pack, pack_bytes.to_vec()))
}

fn check_pack_with(bytes: &[u8], ctx: &SelectCtx, source: PackSource, installed: Option<&[String]>) -> Result<Pack, String> {
    let entries = zip_store::list_entries(bytes).map_err(|e| format!("not a valid skill pack — {e}"))?;
    let sealed_by = match pigeon::seal_check(&entries, bytes, &ctx.trusted) {
        Err(why) => return Err(format!("its seal is broken — {why}")),
        Ok(seal::Sealed::No) => return Err("this skill pack is not sealed, and a skill pack carries code".into()),
        Ok(seal::Sealed::Untrusted { why, .. }) => return Err(format!("its seal is broken — {why}")),
        Ok(seal::Sealed::By(key)) => key,
    };
    let raw = zip_store::get(&entries, bytes, "pigeon.json")?
        .ok_or("not a valid skill pack — no pigeon.json at the root")?;
    let manifest: Value = serde_json::from_slice(raw).map_err(|e| format!("pigeon.json could not be read — {e}"))?;
    let text = |v: &Value| v.as_str().map(String::from);

    let kind = manifest.get("kind").and_then(|k| k.as_str()).unwrap_or_default();
    if kind != pigeon::SKILLPACK {
        return Err(format!("this is a \"{kind}\" file, not a skill pack"));
    }
    let id = manifest.get("id").and_then(|k| k.as_str()).unwrap_or_default();
    if id != PATCH_ID {
        return Err(format!("this skill pack is \"{id}\", and the only skill pack this app runs is Patch"));
    }
    match manifest.get("format_version").and_then(Value::as_u64) {
        Some(v) if v <= pigeon::SUPPORTED_FORMAT_VERSION => {}
        Some(v) => return Err(format!("packed in a newer format (v{v}) than this app reads — update the app")),
        None => return Err("pigeon.json has no format_version".into()),
    }
    let version = match manifest.get("version").and_then(Value::as_u64) {
        Some(v) if v >= 1 => v,
        _ => return Err("its version must be a whole number, 1 or more".into()),
    };

    /* D84: the Pigeons the pack's code asks, by id. A pack that names them
       carries no model of its own: its router, planner and prompts are those
       Pigeons. One made before `needs` carries the category adapter and its
       prompts, and is checked as it always was. */
    let needs = match manifest.get("needs") {
        None => None,
        Some(Value::Array(ids)) => Some(
            ids.iter()
                .map(|v| v.as_str().filter(|id| pigeon::plain_id(id)).map(String::from))
                .collect::<Option<Vec<_>>>()
                .ok_or("needs must list Pigeon ids, each a plain name")?,
        ),
        Some(_) => return Err("needs must be a list of Pigeon ids".into()),
    };
    /* Before v6 the pack carried the category adapter: still checked, so a
       damaged v5 is refused as it always was, though the engine asks the
       patch-router Pigeon in his nest instead. */
    if needs.is_none() {
        let category = manifest.pointer("/models/category").cloned().unwrap_or(Value::Null);
        let base_file = category.get("file").and_then(text).unwrap_or_default();
        let base_sha = category.get("sha256").and_then(text).unwrap_or_default();
        if base_file != ctx.category_file || base_sha != ctx.category_sha256 {
            return Err(format!(
                "made for a different category model ({}) — this build runs {}",
                if base_file.is_empty() { "none named" } else { base_file.as_str() },
                ctx.category_file
            ));
        }
        let adapter_entry = category.get("adapter").and_then(text).ok_or("pigeon.json names no category adapter")?;
        let adapter_sha256 = category.get("adapter_sha256").and_then(text).unwrap_or_default();
        if !is_sha256(&adapter_sha256) {
            return Err("pigeon.json's adapter_sha256 is not 64 lowercase hex characters".into());
        }
        let adapter = zip_store::get(&entries, bytes, &adapter_entry)?
            .ok_or_else(|| format!("its category adapter ({adapter_entry}) is not in the pack"))?;
        if sha256_hex(adapter) != adapter_sha256 {
            return Err("its category adapter does not match the hash pigeon.json gives for it".into());
        }
    }
    if let (Some(needs), Some(installed)) = (&needs, installed) {
        if let Some(missing) = needs.iter().find(|id| !installed.contains(id)) {
            return Err(format!("it needs the Pigeon \"{missing}\", which is not installed"));
        }
    }

    let entry = manifest.pointer("/code/entry").and_then(text).unwrap_or_default();
    if !(entry.starts_with("code/") && entry.ends_with(".js")) || zip_store::get(&entries, bytes, &entry)?.is_none() {
        return Err("code.entry must name a code/…/.js file in the pack".into());
    }

    let empty = serde_json::Map::new();
    let prompt_names = match manifest.get("prompts").and_then(Value::as_object) {
        Some(p) => p,
        // From v6 the prompts are the Pigeons' own.
        None if needs.is_some() => &empty,
        None => return Err("pigeon.json names no prompts".into()),
    };
    let mut prompts = BTreeMap::new();
    for (role, name) in prompt_names {
        let Some(name) = name.as_str() else { return Err(format!("prompts.{role} is not a file name")) };
        prompts.insert(role.clone(), json_entry(&entries, bytes, &format!("prompts.{role}"), name)?);
    }
    let tunables_name = manifest.get("tunables").and_then(text).ok_or("pigeon.json names no tunables")?;
    let tunables = json_entry(&entries, bytes, "tunables", &tunables_name)?;

    if let HostApi::Map(map) = &ctx.host_api {
        for (path, sha) in map {
            let ours = zip_store::get(&entries, bytes, &format!("code/{path}"))?;
            if ours.map(sha256_hex).as_deref() != Some(sha.as_str()) {
                return Err(format!("made for a different Pigeon build ({path})"));
            }
        }
    } else if ctx.require_host_api {
        return Err(NO_HOST_API.into());
    }

    let code = entries
        .iter()
        .filter(|e| e.name.starts_with("code/") && e.name.ends_with(".js"))
        .map(|e| (e.name.clone(), e.data(bytes).to_vec()))
        .collect();

    Ok(Pack {
        name: manifest.get("name").and_then(text).unwrap_or_else(|| "Patch".into()),
        head: manifest.pointer("/source/head").and_then(text),
        categories: manifest.get("categories").cloned().unwrap_or(Value::Null),
        manifest,
        version,
        prompts,
        tunables,
        code,
        sha256: sha256_hex(bytes),
        sealed_by,
        source,
        needs: needs.unwrap_or_default(),
        members: Vec::new(),
        nest: None,
    })
}

#[derive(Debug)]
pub enum Selection {
    /// `bytes` is the chosen pack's file, handed on to the extraction.
    Ready { pack: Pack, note: Option<String> },
    Unavailable { reason: String, note: Option<String> },
}

fn joined(notes: Vec<String>) -> Option<String> {
    (!notes.is_empty()).then(|| notes.join("; "))
}

/// Which pack is Patch. Pure: the caller opens the files (mapped, at launch,
/// so a nest's members are read only where they are looked at).
pub fn choose<B: std::ops::Deref<Target = [u8]>>(bundled: Option<B>, imported: Option<B>, ctx: &SelectCtx) -> Selection {
    if bundled.is_none() && imported.is_none() {
        return Selection::Unavailable { reason: NO_PACK.into(), note: None };
    }
    let mut notes = Vec::new();
    match &ctx.host_api {
        HostApi::Missing if ctx.require_host_api => {
            return Selection::Unavailable { reason: NO_HOST_API.into(), note: None }
        }
        HostApi::Missing => notes.push("host-api.json was not found, so this debug build skipped the host-API check".into()),
        HostApi::Broken(e) => {
            return Selection::Unavailable { reason: format!("host-api.json could not be read — {e}"), note: None }
        }
        HostApi::Map(_) => {}
    }
    let checked = |bytes: Option<B>, source| bytes.map(|b| check_candidate(&b, ctx, source));
    let b = checked(bundled, PackSource::Bundled);
    let i = checked(imported, PackSource::Imported);
    let ((pack, _), note) = match (b, i) {
        (Some(Ok(b)), Some(Ok(i))) if i.0.version > b.0.version => (i, None),
        (Some(Ok(b)), Some(Ok(i))) if i.0.version < b.0.version => {
            let why = format!("the imported Patch (v{}) is older than the one this build ships (v{}), so it was not used", i.0.version, b.0.version);
            (b, Some(why))
        }
        (Some(Ok(b)), Some(Ok(_))) | (Some(Ok(b)), None) => (b, None),
        (Some(Ok(b)), Some(Err(e))) => (b, Some(format!("the imported Patch was not used — {e}"))),
        (Some(Err(e)), Some(Ok(i))) => (i, Some(format!("the bundled Patch was not used — {e}"))),
        (None, Some(Ok(i))) => (i, None),
        (Some(Err(be)), Some(Err(ie))) => {
            notes.push(format!("the imported Patch was not used — {ie}"));
            return Selection::Unavailable { reason: be, note: joined(notes) };
        }
        (Some(Err(e)), None) | (None, Some(Err(e))) => return Selection::Unavailable { reason: e, note: joined(notes) },
        (None, None) => return Selection::Unavailable { reason: NO_PACK.into(), note: None },
    };
    notes.extend(note);
    Selection::Ready { pack, note: joined(notes) }
}

/* ── extraction ─────────────────────────────────────────────────────────── */

/// `.part`, fsync, rename — and the `.part` removed if any step fails.
fn write_atomic(dest: &Path, bytes: &[u8]) -> Result<(), String> {
    let part = weights::part_path(dest);
    let name = dest.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let written = (|| -> std::io::Result<()> {
        let mut f = std::fs::File::create(&part)?;
        f.write_all(bytes)?;
        f.sync_all()?;
        std::fs::rename(&part, dest)
    })();
    written.map_err(|e| {
        let _ = std::fs::remove_file(&part);
        format!("could not write {name}: {e}")
    })
}

/// Removes every `v*` directory under `root`: where builds before the nest
/// extracted Patch's category adapter. Nothing is extracted now (D84: the
/// router is a Pigeon in his nest, loaded from it). Launch-time only.
pub fn sweep_slots(root: &Path) {
    if let Ok(listing) = std::fs::read_dir(root) {
        for e in listing.filter_map(|e| e.ok()) {
            let name = e.file_name().to_string_lossy().into_owned();
            if name.starts_with('v') && e.path().is_dir() {
                let _ = std::fs::remove_dir_all(e.path());
            }
        }
    }
}

/* ── the managed state ──────────────────────────────────────────────────── */

#[derive(Debug)]
enum Active {
    /// Launch selection has not run yet.
    Starting,
    Ready { pack: Arc<Pack>, note: Option<String> },
    Unavailable { reason: String, note: Option<String> },
}

#[derive(Debug)]
enum Extract {
    Pending,
    Done,
    Failed(String),
}

#[derive(Debug)]
struct Inner {
    active: Active,
    extract: Extract,
}

/// Patch as this run knows him. The adapter extraction runs on its own thread
/// and signals `changed` when it lands; `wait` is how the engine holds a wake
/// until it has.
pub struct PatchState {
    inner: Mutex<Inner>,
    changed: Condvar,
}

impl Default for PatchState {
    fn default() -> Self {
        PatchState { inner: Mutex::new(Inner { active: Active::Starting, extract: Extract::Pending }), changed: Condvar::new() }
    }
}

/// What `patch_status` returns. Data only — never a path.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct PatchStatus {
    pub state: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sealed_by: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<PackSource>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub head: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub categories: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prompts: Option<BTreeMap<String, Value>>,
    /// D84: the Pigeons he asks, by id, and those his nest carries. Shown in
    /// his details so nothing the app runs is out of sight.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub needs: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pigeons: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tunables: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code_base: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
}

impl PatchStatus {
    fn bare(state: &'static str, reason: Option<String>, note: Option<String>) -> Self {
        PatchStatus {
            state,
            reason,
            name: None,
            version: None,
            sealed_by: None,
            source: None,
            head: None,
            categories: None,
            prompts: None,
            needs: None,
            pigeons: None,
            tunables: None,
            code_base: None,
            note,
        }
    }
}

impl PatchState {
    fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(|p| p.into_inner())
    }

    fn set_ready(&self, pack: Pack, note: Option<String>) -> Arc<Pack> {
        let pack = Arc::new(pack);
        let mut g = self.lock();
        g.active = Active::Ready { pack: pack.clone(), note };
        g.extract = Extract::Pending;
        drop(g);
        self.changed.notify_all();
        pack
    }

    fn set_unavailable(&self, reason: String, note: Option<String>) {
        let mut g = self.lock();
        g.active = Active::Unavailable { reason, note };
        drop(g);
        self.changed.notify_all();
    }

    fn set_extracted(&self, result: Result<(), String>) {
        let mut g = self.lock();
        g.extract = match result {
            Ok(()) => Extract::Done,
            Err(e) => Extract::Failed(e),
        };
        drop(g);
        self.changed.notify_all();
    }

    /// Block until Patch is settled — ready with his adapter on disk, or
    /// unavailable — or until `timeout`.
    pub fn wait(&self, timeout: Duration) {
        let deadline = Instant::now() + timeout;
        let mut g = self.lock();
        loop {
            let settled = match (&g.active, &g.extract) {
                (Active::Starting, _) => false,
                (Active::Ready { .. }, Extract::Pending) => false,
                _ => true,
            };
            let now = Instant::now();
            if settled || now >= deadline {
                return;
            }
            g = match self.changed.wait_timeout(g, deadline - now) {
                Ok((g, _)) => g,
                Err(p) => p.into_inner().0,
            };
        }
    }

    /// The chosen pack, once launch selection has made Patch ready.
    pub fn pack(&self) -> Option<Arc<Pack>> {
        match &self.lock().active {
            Active::Ready { pack, .. } => Some(pack.clone()),
            _ => None,
        }
    }

    pub fn active_version(&self) -> Option<u64> {
        match &self.lock().active {
            Active::Ready { pack, .. } => Some(pack.version),
            _ => None,
        }
    }

    /// The pack whose code may be served: selected, and his adapter not known
    /// to have failed. A pending extraction does not hold the code back — the
    /// JavaScript does not depend on the adapter.
    fn servable(&self) -> Option<Arc<Pack>> {
        let g = self.lock();
        match (&g.active, &g.extract) {
            (Active::Ready { .. }, Extract::Failed(_)) => None,
            (Active::Ready { pack, .. }, _) => Some(pack.clone()),
            _ => None,
        }
    }

    pub fn status(&self) -> PatchStatus {
        let g = self.lock();
        match &g.active {
            Active::Starting => PatchStatus::bare("loading", None, None),
            Active::Unavailable { reason, note } => PatchStatus::bare("unavailable", Some(reason.clone()), note.clone()),
            Active::Ready { pack, note } => {
                let (state, reason) = match &g.extract {
                    Extract::Pending => ("loading", None),
                    Extract::Done => ("ready", None),
                    Extract::Failed(e) => ("unavailable", Some(format!("Patch's adapter could not be put in place — {e}"))),
                };
                PatchStatus {
                    state,
                    reason,
                    name: Some(pack.name.clone()),
                    version: Some(pack.version),
                    sealed_by: Some(pack.sealed_by.clone()),
                    source: Some(pack.source),
                    head: pack.head.clone(),
                    categories: Some(pack.categories.clone()),
                    prompts: Some(pack.prompts.clone()),
                    needs: Some(pack.needs.clone()),
                    pigeons: Some(pack.members.iter().map(|(id, _)| id.clone()).collect()),
                    tunables: Some(pack.tunables.clone()),
                    code_base: Some(pack.code_base()),
                    note: note.clone(),
                }
            }
        }
    }
}

/* ── the app side ───────────────────────────────────────────────────────── */

fn first_file(candidates: Vec<PathBuf>) -> Option<PathBuf> {
    candidates.into_iter().find(|p| p.is_file())
}

/// The repository this binary was built from — a debug build's fallback for
/// the pack and host-api files, and nothing a release knows about.
#[cfg(any(debug_assertions, test))]
fn checkout() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("..")
}

/// The bundled Patch: his nest when the build carries one (D84), otherwise a
/// pack on its own, in the resources and then, for a debug build, the
/// checkout's `pack/` and `dist/`.
fn bundled_pack_path<R: tauri::Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    let mut dirs = Vec::new();
    if let Ok(res) = app.path().resource_dir() {
        dirs.push(res);
    }
    #[cfg(debug_assertions)]
    {
        dirs.push(checkout().join("pack"));
        dirs.push(checkout().join("dist"));
    }
    first_file(dirs.iter().flat_map(|d| [d.join(NEST_FILE), d.join(PACK_FILE)]).collect())
}

/// An imported Patch: his nest, or a pack on its own from before v6.
fn imported_pack_path(root: &Path) -> Option<PathBuf> {
    first_file(vec![root.join(NEST_FILE), root.join(PACK_FILE)])
}

fn host_api<R: tauri::Runtime>(app: &AppHandle<R>) -> HostApi {
    let mut c = Vec::new();
    if let Ok(res) = app.path().resource_dir() {
        c.push(res.join(HOST_API_FILE));
    }
    #[cfg(debug_assertions)]
    {
        c.push(checkout().join("pack").join(HOST_API_FILE));
    }
    let Some(path) = first_file(c) else { return HostApi::Missing };
    match std::fs::read(&path).map_err(|e| e.to_string()).and_then(|b| {
        serde_json::from_slice::<BTreeMap<String, String>>(&b).map_err(|e| e.to_string())
    }) {
        Ok(map) => HostApi::Map(map),
        Err(e) => HostApi::Broken(e),
    }
}

/// Where the Pigeons Patch's pack asks are kept (D84): beside the pack, in
/// Patch's own folder, not among the person's Pigeons.
pub const PIGEONS_DIR: &str = "pigeons";

/// The ids of the Pigeons kept for Patch: every `<id>.pigeon` in `dir`.
pub fn pigeon_ids_in(dir: &Path) -> Vec<String> {
    let Ok(listing) = std::fs::read_dir(dir) else { return Vec::new() };
    let mut ids: Vec<String> = listing
        .filter_map(|e| e.ok())
        .filter_map(|e| e.file_name().to_str().and_then(|n| n.strip_suffix(".pigeon")).map(String::from))
        .filter(|id| pigeon::plain_id(id))
        .collect();
    ids.sort();
    ids
}

fn patch_pigeon_ids<R: tauri::Runtime>(app: &AppHandle<R>) -> Vec<String> {
    weights::app_subdir(app, DIR).map(|d| pigeon_ids_in(&d.join(PIGEONS_DIR))).unwrap_or_default()
}

fn app_ctx<R: tauri::Runtime>(app: &AppHandle<R>) -> Result<SelectCtx, String> {
    let m = manifest::manifest()?;
    let spec = m.for_role(Role::Category).ok_or("models.json has no category model")?;
    Ok(SelectCtx {
        trusted: pigeon::trusted_keys(),
        category_file: spec.file.clone(),
        category_sha256: spec.sha256.clone(),
        host_api: host_api(app),
        require_host_api: !cfg!(debug_assertions),
        installed: Some(patch_pigeon_ids(app)),
    })
}

/// At launch, before the engine: choose Patch on a thread of its own, and
/// sweep away where older builds extracted his adapter. One line on stderr
/// says which Patch.
pub fn select_at_launch<R: tauri::Runtime>(app: &AppHandle<R>) {
    let state = app.state::<PatchState>();
    let ctx = match app_ctx(app) {
        Ok(c) => c,
        Err(e) => {
            plog!("patch", "unavailable — {e}");
            state.set_unavailable(e, None);
            return;
        }
    };
    let root = match weights::app_subdir(app, DIR) {
        Ok(r) => r,
        Err(_) => {
            let reason = "there is no app data directory to put Patch's adapter in".to_string();
            plog!("patch", "unavailable — {reason}");
            state.set_unavailable(reason, None);
            return;
        }
    };
    /* Reading two 38 MB packs and checking their seals and hashes took the
       main thread for the better part of a second before the window could
       show; the page already waits on patch_status ("loading"), and a wake
       waits on extraction, so the whole choice runs on the thread too. */
    let bundled_path = bundled_pack_path(app);
    let app = app.clone();
    std::thread::spawn(move || {
        let state = app.state::<PatchState>();
        /* Mapped, not read: a nest is ~200 MB of Pigeons the engine reads
           from the file itself when it loads one. Choosing Patch touches only
           the directories, each member's pigeon.json and the pack; the rest
           is never paged in, and what is paged in is the file's own clean
           pages, which the system can drop. Reading it whole kept ~200 MB
           counted against Pigeon after it was freed (NOTES, v10). */
        let open = |p: &Option<PathBuf>| p.as_ref().and_then(|p| pigeon_core::blob::Blob::open(p).ok());
        let bundled = open(&bundled_path);
        let imported_path = imported_pack_path(&root);
        let imported = open(&imported_path);
        match choose(bundled, imported, &ctx) {
            Selection::Unavailable { reason, note } => {
                plog!("patch", "unavailable — {reason}");
                state.set_unavailable(reason, note);
            }
            Selection::Ready { mut pack, note } => {
                let from = if pack.source == PackSource::Bundled { &bundled_path } else { &imported_path };
                pack.nest = from.clone().filter(|p| p.file_name().is_some_and(|n| n == NEST_FILE));
                plog!(
                    "patch",
                    "ready v{} {} sealed by {} · {} · memory: {}",
                    pack.version,
                    if pack.source == PackSource::Bundled { "bundled" } else { "imported" },
                    pack.sealed_by,
                    if pack.members.is_empty() { "no nest".to_string() } else { format!("nest of {} Pigeons", pack.members.len()) },
                    crate::log::memory_now()
                );
                state.set_ready(pack, note);
                sweep_slots(&root);
                app.state::<PatchState>().set_extracted(Ok(()));
            }
        }
        /* Settled, one way or the other: the page stops asking. */
        let _ = app.emit(EVENT_SETTLED, ());
    });
}

/// Where the engine finds Patch's Pigeon `id` (D84): his nest and its member
/// file. None when Patch is not ready, came without a nest, or carries no
/// such Pigeon. Rust-internal, like the adapter's path.
pub fn pigeon_source<R: tauri::Runtime>(app: &AppHandle<R>, id: &str) -> Option<(PathBuf, String)> {
    let pack = app.try_state::<PatchState>()?.pack()?;
    let nest = pack.nest.clone()?;
    pack.members.iter().find(|(m, _)| m == id).map(|(_, file)| (nest, file.clone()))
}

/// Hold a wake until Patch is settled, for at most `timeout`. Off the async
/// runtime: this is a condvar wait.
pub async fn wait_settled<R: tauri::Runtime>(app: &AppHandle<R>, timeout: Duration) {
    let app = app.clone();
    let _ = tauri::async_runtime::spawn_blocking(move || {
        if let Some(s) = app.try_state::<PatchState>() {
            s.wait(timeout);
        }
    })
    .await;
}

/// An imported skill pack: the same checks as selection, then stored only if
/// it is newer than the Patch running now. Pure but for the one file it
/// writes, `dir/patch.pigeon`. Returns whether it stored anything.
pub fn import_into(dir: &Path, bytes: &[u8], ctx: &SelectCtx, active: Option<u64>, display: &str) -> (ImportOutcome, bool) {
    let refused = |reason: String| (ImportOutcome::Refused { file: display.into(), reason, code: "patch_refused".into() }, false);
    /* A nest is Patch with the Pigeons he needs (D84), checked and kept
       whole; a pack on its own is held to what this app already has. */
    let is_nest = pigeon_core::nest::is_nest(bytes);
    let pack = match check_candidate(bytes, ctx, PackSource::Imported) {
        Ok((p, _)) => p,
        Err(e) => return refused(e),
    };
    match active {
        Some(have) if pack.version < have => {
            return refused(format!("older than the Patch you have (v{} < v{have})", pack.version))
        }
        Some(have) if pack.version == have => {
            return (ImportOutcome::Already { file: display.into(), name: pack.name }, false)
        }
        _ => {}
    }
    let (dest, other) = if is_nest { (dir.join(NEST_FILE), dir.join(PACK_FILE)) } else { (dir.join(PACK_FILE), dir.join(NEST_FILE)) };
    if std::fs::read(&dest).map(|b| b == bytes).unwrap_or(false) {
        return (ImportOutcome::Already { file: display.into(), name: pack.name }, false);
    }
    if let Err(e) = std::fs::create_dir_all(dir).map_err(|e| e.to_string()).and_then(|_| write_atomic(&dest, bytes)) {
        return refused(e);
    }
    // One imported Patch: the older shape goes, so launch never weighs both.
    let _ = std::fs::remove_file(other);
    let message = format!("Patch v{} is ready — restart Patch to use it", pack.version);
    (ImportOutcome::Upgraded { file: display.into(), name: pack.name, from: active, to: pack.version, message }, true)
}

/// `import_into` against this app's own directory and running Patch, and a
/// `patch-changed` event when a pack was stored.
pub fn import<R: tauri::Runtime>(app: &AppHandle<R>, bytes: &[u8], display: &str) -> ImportOutcome {
    let ctx = match app_ctx(app) {
        Ok(c) => c,
        Err(reason) => return ImportOutcome::Refused { file: display.into(), reason, code: "patch_refused".into() },
    };
    let Ok(dir) = weights::app_subdir(app, DIR) else {
        return ImportOutcome::Refused { file: display.into(), reason: "there is no app data directory to keep Patch in".into(), code: "no_data_folder".into() };
    };
    let active = app.try_state::<PatchState>().and_then(|s| s.active_version());
    let (outcome, stored) = import_into(&dir, bytes, &ctx, active, display);
    if stored {
        if let ImportOutcome::Upgraded { to, .. } = &outcome {
            let _ = app.emit(EVENT_CHANGED, serde_json::json!({ "version": to }));
        }
    }
    outcome
}

/* ── the pigeon-pack scheme ─────────────────────────────────────────────── */

/// The one custom scheme this app registers. Read-only, memory-only.
pub const SCHEME: &str = "pigeon-pack";
/// The only windows it answers.
pub const SCHEME_WINDOWS: [&str; 3] = ["main", crate::tray::POPOVER, crate::bar::BAR];
/// The embedded page's origin, allowed in every build.
const APP_ORIGIN: &str = "tauri://localhost";
/// The dev server's origins, allowed only in a debug build.
const DEV_ORIGINS: [&str; 2] = ["http://localhost:4173", "http://127.0.0.1:4173"];

/// `build.devUrl`'s origin (scheme://host[:port]), read from the config this
/// binary was built with.
fn conf_dev_origin() -> Option<String> {
    let conf: Value = serde_json::from_str(include_str!("../tauri.conf.json")).ok()?;
    let url = conf.pointer("/build/devUrl")?.as_str()?;
    let (scheme, rest) = url.split_once("://")?;
    let authority = rest.split(['/', '?', '#']).next()?;
    (!authority.is_empty()).then(|| format!("{scheme}://{authority}"))
}

fn origin_allowed(origin: &str, debug: bool) -> bool {
    origin == APP_ORIGIN
        || (debug && (DEV_ORIGINS.contains(&origin) || conf_dev_origin().as_deref() == Some(origin)))
}

/// Percent-decode once. `None` for a malformed escape or bytes that are not
/// UTF-8.
fn percent_decode(s: &str) -> Option<String> {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' {
            let hex = std::str::from_utf8(b.get(i + 1..i + 3)?).ok()?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            out.push(b[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

type Served = (u16, Vec<(String, String)>, Vec<u8>);

fn text_reply(status: u16, body: &str) -> Served {
    let mut headers = vec![
        ("Content-Type".to_string(), "text/plain; charset=utf-8".to_string()),
        ("Cache-Control".to_string(), "no-store".to_string()),
        ("X-Content-Type-Options".to_string(), "nosniff".to_string()),
    ];
    if status == 405 {
        headers.push(("Allow".to_string(), "GET".to_string()));
    }
    (status, headers, body.as_bytes().to_vec())
}

/// The `pigeon-pack` scheme, as a pure function of Patch's in-memory state.
/// It serves exactly the ACTIVE pack's `code/**/*.js` bytes, from memory, to
/// the app's own three windows, and never reads the filesystem.
///
/// Only GET: HEAD and everything else is 405, because a module import never
/// sends anything but GET and there is no reason to answer more. A request
/// from an origin outside the allow-list still gets its bytes but no
/// `Access-Control-Allow-Origin`, so a browser refuses them cross-origin; the
/// bytes are the same ones the pack already hands over, so withholding them
/// would protect nothing that the CORS refusal does not.
pub fn serve(state: &PatchState, method: &str, uri: &str, origin: Option<&str>, webview_label: &str, debug: bool) -> Served {
    if !SCHEME_WINDOWS.contains(&webview_label) {
        return text_reply(403, "not for this window");
    }
    if method != "GET" {
        return text_reply(405, "only GET");
    }
    let not_found = || text_reply(404, "not found");
    let Some(rest) = uri.strip_prefix("pigeon-pack://localhost/") else { return not_found() };
    if rest.contains(['?', '#']) {
        return not_found();
    }
    let lower = rest.to_ascii_lowercase();
    if ["%2f", "%5c", "%00"].iter().any(|e| lower.contains(e)) {
        return not_found();
    }
    let Some(path) = percent_decode(rest) else { return not_found() };
    let decoded_lower = path.to_ascii_lowercase();
    if path.contains(['\\', '\0', '%']) || decoded_lower.contains("%2e") || decoded_lower.contains("%2f") {
        return not_found();
    }
    if path.split('/').any(|seg| seg.is_empty() || seg == "." || seg == "..") {
        return not_found();
    }
    let Some(pack) = state.servable() else { return text_reply(503, "Patch is not ready") };
    let Some(file) = path.strip_prefix(&format!("{}/", pack.slot())) else { return not_found() };
    if !(file.starts_with("code/") && file.ends_with(".js")) {
        return not_found();
    }
    let Some(bytes) = pack.code.get(file) else { return not_found() };
    /* The prefix carries the pack's version and hash, so a module's URL names
       its bytes: the webview may keep them for good, and a second window or a
       restarted worker does not fetch all 311 again. A new pack is a new URL. */
    let mut headers = vec![
        ("Content-Type".to_string(), "text/javascript; charset=utf-8".to_string()),
        ("Cache-Control".to_string(), "public, max-age=31536000, immutable".to_string()),
        ("X-Content-Type-Options".to_string(), "nosniff".to_string()),
    ];
    if let Some(o) = origin.filter(|o| origin_allowed(o, debug)) {
        headers.push(("Access-Control-Allow-Origin".to_string(), o.to_string()));
    }
    (200, headers, bytes.clone())
}

/// The thin Tauri wrapper around `serve`. The state lookup is an in-memory
/// lock and a clone of an `Arc`, so the synchronous handler is enough.
pub fn scheme_handler<R: tauri::Runtime>(
    ctx: tauri::UriSchemeContext<'_, R>,
    request: tauri::http::Request<Vec<u8>>,
) -> tauri::http::Response<Vec<u8>> {
    let origin = request.headers().get("origin").and_then(|v| v.to_str().ok());
    let uri = request.uri().to_string();
    let (status, headers, body) = match ctx.app_handle().try_state::<PatchState>() {
        Some(state) => serve(&state, request.method().as_str(), &uri, origin, ctx.webview_label(), cfg!(debug_assertions)),
        None => text_reply(503, "Patch is not ready"),
    };
    let mut response = tauri::http::Response::builder().status(status);
    for (k, v) in headers {
        response = response.header(k, v);
    }
    response.body(body).unwrap_or_else(|_| {
        let mut r = tauri::http::Response::new(Vec::new());
        *r.status_mut() = tauri::http::StatusCode::INTERNAL_SERVER_ERROR;
        r
    })
}

#[tauri::command]
pub async fn patch_status<R: tauri::Runtime>(app: AppHandle<R>) -> Result<PatchStatus, String> {
    Ok(match app.try_state::<PatchState>() {
        Some(s) => s.status(),
        None => PatchStatus::bare("unavailable", Some("Patch was never selected".into()), None),
    })
}

#[cfg(test)]
pub(crate) mod test_support {
    //! Building sealed Patch packs in a test.
    use super::*;
    use crate::zip_store::test_support::build_store_zip;
    use ring::signature::{Ed25519KeyPair, KeyPair};

    pub const TEST1_SEED: [u8; 32] = [
        0x9d, 0x61, 0xb1, 0x9d, 0xef, 0xfd, 0x5a, 0x60, 0xba, 0x84, 0x4a, 0xf4, 0x92, 0xec, 0x2c, 0xc4, 0x44, 0x49, 0xc5,
        0x69, 0x7b, 0x32, 0x69, 0x19, 0x70, 0x3b, 0xac, 0x03, 0x1c, 0xae, 0x7f, 0x60,
    ];
    pub const BASE_FILE: &str = "Qwen3VL-2B-Instruct-Q4_K_M.gguf";
    pub const ADAPTER: &[u8] = b"GGUF pretend adapter bytes";
    pub const CONTRACTS: &[u8] = b"export const CONTRACTS = {};";

    pub fn base_sha() -> String {
        "1".repeat(64)
    }

    pub fn key_for(seed: &[u8; 32], revoked: bool) -> pigeon::TrustedKey {
        let pair = Ed25519KeyPair::from_seed_unchecked(seed).unwrap();
        let public = pair.public_key().as_ref();
        pigeon::TrustedKey { id: seal::key_id(public), ed25519_pub_hex: seal::to_hex(public), revoked }
    }

    pub fn ctx() -> SelectCtx {
        SelectCtx {
            trusted: vec![key_for(&TEST1_SEED, false)],
            category_file: BASE_FILE.into(),
            category_sha256: base_sha(),
            host_api: HostApi::Map(BTreeMap::from([("src/contracts.js".to_string(), sha256_hex(CONTRACTS))])),
            require_host_api: true,
            installed: None,
        }
    }

    pub fn manifest(version: u64) -> Value {
        serde_json::json!({
            "format_version": 1, "name": "Patch", "id": "patch", "kind": "skillpack", "version": version,
            "models": {
                "planner": { "name": "Qwen3.5 2B", "quant": "Q4_K_M", "file": "Qwen3.5-2B-Q4_K_M.gguf", "sha256": "2".repeat(64), "adapter": null },
                "category": { "name": "Qwen2.5 1.5B Instruct", "quant": "Q4_K_M", "file": BASE_FILE, "sha256": base_sha(),
                              "adapter": "adapters/category.lora.gguf", "adapter_sha256": sha256_hex(ADAPTER) }
            },
            "code": { "entry": "code/skills/index.js" },
            "prompts": { "planner": "prompts/planner.json", "category": "prompts/category.json" },
            "tunables": "tunables.json",
            "categories": ["maths", "units"],
            "source": { "repo": "pigeon", "head": "abc1234", "clean": true }
        })
    }

    /// Every file of a good pack, in packing order, seal not included.
    pub fn files(m: &Value) -> Vec<(String, Vec<u8>)> {
        vec![
            ("pigeon.json".into(), serde_json::to_vec(m).unwrap()),
            ("adapters/category.lora.gguf".into(), ADAPTER.to_vec()),
            ("prompts/planner.json".into(), br#"{"system":"plan"}"#.to_vec()),
            ("prompts/category.json".into(), br#"{"system":"sort"}"#.to_vec()),
            ("tunables.json".into(), br#"{"refuse_below":0.8}"#.to_vec()),
            ("code/skills/index.js".into(), b"export default [];".to_vec()),
            ("code/src/contracts.js".into(), CONTRACTS.to_vec()),
            ("code/src/lib/text.js".into(), b"export const t = 1;".to_vec()),
        ]
    }

    pub fn seal(files: &[(String, Vec<u8>)], seed: &[u8; 32]) -> Vec<u8> {
        let borrowed: Vec<(&str, &[u8])> = files.iter().map(|(n, d)| (n.as_str(), d.as_slice())).collect();
        let zip = build_store_zip(&borrowed);
        let msg = seal::seal_message(&zip_store::list_entries(&zip).unwrap(), &zip);
        let pair = Ed25519KeyPair::from_seed_unchecked(seed).unwrap();
        let seal = format!(
            r#"{{"scheme":"{}","key":"{}","signature":"{}"}}"#,
            seal::SCHEME,
            seal::key_id(pair.public_key().as_ref()),
            seal::to_hex(pair.sign(&msg).as_ref())
        );
        let mut all = borrowed;
        all.push((seal::SEAL_FILE, seal.as_bytes()));
        build_store_zip(&all)
    }

    pub fn pack(version: u64) -> Vec<u8> {
        seal(&files(&manifest(version)), &TEST1_SEED)
    }
}

#[cfg(test)]
mod tests {
    use super::test_support::*;
    use super::*;
    use crate::zip_store::test_support::build_store_zip;

    fn scratch(name: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("pigeon-patch-test-{name}"));
        let _ = std::fs::remove_dir_all(&p);
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    fn refused(bytes: &[u8], ctx: &SelectCtx) -> String {
        match check_pack(bytes, ctx, PackSource::Bundled) {
            Ok(p) => panic!("accepted v{}", p.version),
            Err(e) => e,
        }
    }

    fn with_manifest(edit: impl FnOnce(&mut Value)) -> Vec<u8> {
        let mut m = manifest(1);
        edit(&mut m);
        seal(&files(&m), &TEST1_SEED)
    }

    /// A v6 pack: `needs` and no model of its own, no prompts.
    fn v6(version: u64, needs: &[&str]) -> Vec<u8> {
        let mut m = manifest(version);
        let o = m.as_object_mut().unwrap();
        o.remove("models");
        o.remove("prompts");
        o.insert("needs".into(), serde_json::json!(needs));
        let files: Vec<(String, Vec<u8>)> = files(&m).into_iter().filter(|(n, _)| !n.starts_with("adapters/") && !n.starts_with("prompts/")).collect();
        seal(&files, &TEST1_SEED)
    }

    #[test]
    fn a_pack_with_needs_runs_only_when_every_pigeon_it_names_is_here() {
        // D84.
        let pack = v6(6, &["patch-router", "tidier"]);
        let mut ctx = ctx();
        ctx.installed = Some(vec!["patch-router".into(), "tidier".into(), "someone-else".into()]);
        let p = check_pack(&pack, &ctx, PackSource::Bundled).expect("every Pigeon it needs is here");
        assert_eq!(p.needs, vec!["patch-router".to_string(), "tidier".to_string()]);
        assert!(p.prompts.is_empty());

        ctx.installed = Some(vec!["patch-router".into()]);
        assert_eq!(refused(&pack, &ctx), "it needs the Pigeon \"tidier\", which is not installed");
        // An older pack that needs nothing is used instead, and the note says why.
        let (chosen, note) = ready(choose(Some(pack_v5()), Some(pack.clone()), &ctx));
        assert_eq!(chosen.version, 5);
        assert!(note.unwrap().contains("\"tidier\""));
        // With nothing older, Patch is unavailable and the reason names it.
        let (reason, _) = unavailable(choose(Some(pack), None, &ctx));
        assert!(reason.contains("\"tidier\""), "{reason}");

        assert!(refused(&v6_with(|m| m["needs"] = "patch-router".into()), &ctx).contains("list"));
        assert!(refused(&v6_with(|m| m["needs"] = serde_json::json!(["../x"])), &ctx).contains("plain name"));
    }

    fn member(id: &str) -> Vec<u8> {
        build_store_zip(&[("pigeon.json", format!(r#"{{"format_version":1,"id":"{id}","kind":"freeform"}}"#).as_bytes())])
    }

    fn nest(pack: &[u8], ids: &[&str]) -> Vec<u8> {
        let members: Vec<(String, Vec<u8>)> = ids.iter().map(|id| (format!("{id}.pigeon"), member(id))).collect();
        let mut files: Vec<(&str, &[u8])> = vec![("patch.pigeon", pack)];
        files.extend(members.iter().map(|(n, b)| (n.as_str(), b.as_slice())));
        files.push(("nest.json", br#"{"format_version":1,"name":"Patch"}"#));
        build_store_zip(&files)
    }

    #[test]
    fn a_nest_is_held_to_its_own_pigeons() {
        // D84: what a nest's pack needs must be in that nest, whatever else is installed.
        let pack = v6(6, &["patch-router", "tidier"]);
        let mut ctx = ctx();
        ctx.installed = Some(vec!["tidier".into(), "patch-router".into()]);
        let whole = nest(&pack, &["patch-router", "tidier", "pen"]);
        let (p, _) = ready(choose(Some(whole.clone()), None, &ctx));
        assert_eq!(p.members, vec![("patch-router".to_string(), "patch-router.pigeon".to_string()), ("tidier".into(), "tidier.pigeon".into()), ("pen".into(), "pen.pigeon".into())]);
        let short = nest(&pack, &["patch-router"]);
        let (reason, _) = unavailable(choose(Some(short), None, &ctx));
        assert!(reason.contains("\"tidier\""), "{reason}");
        assert!(open_candidate(&nest(&pack, &[])).is_ok(), "a nest of only a pack is a nest");
        let two = build_store_zip(&[("a.pigeon", &pack), ("b.pigeon", &pack), ("nest.json", br#"{"format_version":1}"#)]);
        assert!(open_candidate(&two).unwrap_err().contains("two skill packs"));
        let none = build_store_zip(&[("a.pigeon", &member("a")), ("nest.json", br#"{"format_version":1}"#)]);
        assert!(open_candidate(&none).unwrap_err().contains("no skill pack"));

        // An imported nest is stored whole, and the older lone pack goes.
        let dir = scratch("import-nest");
        std::fs::write(dir.join(PACK_FILE), pack_v5()).unwrap();
        let (outcome, stored) = import_into(&dir, &whole, &ctx, Some(5), "patch.nest");
        assert!(stored, "{outcome:?}");
        assert_eq!(std::fs::read(dir.join(NEST_FILE)).unwrap(), whole);
        assert!(!dir.join(PACK_FILE).exists());
        assert_eq!(imported_pack_path(&dir), Some(dir.join(NEST_FILE)));
    }

    fn pack_v5() -> Vec<u8> {
        pack(5)
    }

    /// What launch chooses from a nest opened mapped is what it chose from the
    /// nest read whole: the same pack, version, seal, members and code.
    fn same_choice(a: Selection, b: Selection) {
        let ((pa, na), (pb, nb)) = (ready(a), ready(b));
        assert_eq!(
            (pa.version, &pa.sealed_by, &pa.members, &pa.sha256, &pa.code, &pa.needs, na),
            (pb.version, &pb.sealed_by, &pb.members, &pb.sha256, &pb.code, &pb.needs, nb)
        );
    }

    #[test]
    fn a_mapped_nest_is_chosen_exactly_as_one_read_whole() {
        let ctx = ctx();
        let pack = pack(6);
        let whole = nest(&pack, &["patch-router", "tidier", "pen"]);
        let dir = scratch("mapped-nest");
        let file = dir.join(NEST_FILE);
        std::fs::write(&file, &whole).unwrap();
        let mapped = pigeon_core::blob::Blob::open(&file).unwrap();
        assert!(mapped.source().is_some(), "opened as a mapping, not read");
        same_choice(choose(Some(mapped), None, &ctx), choose(Some(whole), None, &ctx));
    }

    /// The same on the nest this build ships (pack/patch.nest), when the
    /// checkout has one.
    #[test]
    fn the_shipped_nest_mapped_is_chosen_as_when_read_whole() {
        let file = Path::new(env!("CARGO_MANIFEST_DIR")).join("../pack").join(NEST_FILE);
        if !file.is_file() {
            eprintln!("(skipped: no pack/patch.nest in this checkout)");
            return;
        }
        let m = manifest::manifest().unwrap();
        let spec = m.for_role(Role::Category).unwrap();
        let ctx = SelectCtx {
            trusted: pigeon::trusted_keys(),
            category_file: spec.file.clone(),
            category_sha256: spec.sha256.clone(),
            host_api: HostApi::Missing,
            require_host_api: false,
            installed: None,
        };
        let mapped = pigeon_core::blob::Blob::open(&file).unwrap();
        let read = std::fs::read(&file).unwrap();
        let (p, _) = ready(choose(Some(pigeon_core::blob::Blob::open(&file).unwrap()), None, &ctx));
        assert_eq!(p.members.len(), 10, "v10's nest: ten Pigeons beside the pack, {:?}", p.members);
        same_choice(choose(Some(mapped), None, &ctx), choose(Some(read), None, &ctx));
    }

    fn v6_with(edit: impl FnOnce(&mut Value)) -> Vec<u8> {
        let mut m = manifest(6);
        m.as_object_mut().unwrap().remove("models");
        m["needs"] = serde_json::json!([]);
        edit(&mut m);
        seal(&files(&m), &TEST1_SEED)
    }

    #[test]
    fn the_pigeons_kept_for_patch_are_the_plain_named_files_in_his_folder() {
        let dir = scratch("kept-ids");
        for f in ["tidier.pigeon", "patch-router.pigeon", "notes.txt", ".hidden.pigeon"] {
            std::fs::write(dir.join(f), b"").unwrap();
        }
        assert_eq!(pigeon_ids_in(&dir), vec!["patch-router".to_string(), "tidier".to_string()]);
        assert!(pigeon_ids_in(&dir.join("absent")).is_empty());
    }

    fn ready(sel: Selection) -> (Pack, Option<String>) {
        match sel {
            Selection::Ready { pack, note, .. } => (pack, note),
            Selection::Unavailable { reason, .. } => panic!("unavailable: {reason}"),
        }
    }

    fn unavailable(sel: Selection) -> (String, Option<String>) {
        match sel {
            Selection::Unavailable { reason, note } => (reason, note),
            Selection::Ready { pack, .. } => panic!("ready v{}", pack.version),
        }
    }

    #[test]
    fn a_good_pack_passes_and_carries_only_its_code_in_the_code_map() {
        let p = check_pack(&pack(1), &ctx(), PackSource::Bundled).expect("good pack");
        assert_eq!((p.version, p.name.as_str(), p.head.as_deref()), (1, "Patch", Some("abc1234")));
        assert_eq!(p.sealed_by, key_for(&TEST1_SEED, false).id);
        assert_eq!(p.code.keys().collect::<Vec<_>>(), ["code/skills/index.js", "code/src/contracts.js", "code/src/lib/text.js"]);
        assert_eq!(p.prompts.keys().collect::<Vec<_>>(), ["category", "planner"]);
        assert_eq!(p.tunables["refuse_below"], 0.8);
        assert_eq!(p.code_base(), format!("pigeon-pack://localhost/v1-{}/code/", &sha256_hex(&pack(1))[..8]));
    }

    #[test]
    fn nothing_at_all_is_unavailable() {
        let (reason, _) = unavailable(choose::<Vec<u8>>(None, None, &ctx()));
        assert_eq!(reason, NO_PACK);
    }

    #[test]
    fn the_bundled_pack_alone_is_chosen() {
        let (p, note) = ready(choose(Some(pack(1)), None, &ctx()));
        assert_eq!((p.version, p.source, note), (1, PackSource::Bundled, None));
    }

    #[test]
    fn a_higher_imported_pack_wins_an_equal_or_lower_one_does_not() {
        let (p, _) = ready(choose(Some(pack(1)), Some(pack(2)), &ctx()));
        assert_eq!((p.version, p.source), (2, PackSource::Imported));
        let (p, note) = ready(choose(Some(pack(2)), Some(pack(2)), &ctx()));
        assert_eq!((p.source, note), (PackSource::Bundled, None), "a tie goes to the bundled pack");
        let (p, note) = ready(choose(Some(pack(3)), Some(pack(2)), &ctx()));
        assert_eq!(p.version, 3);
        assert!(note.unwrap().contains("older"));
        let (p, _) = ready(choose(None, Some(pack(2)), &ctx()));
        assert_eq!(p.source, PackSource::Imported);
    }

    #[test]
    fn an_imported_pack_sealed_by_a_revoked_key_falls_back_with_a_note() {
        let other = [7u8; 32];
        let mut c = ctx();
        c.trusted.push(key_for(&other, true));
        let revoked = seal(&files(&manifest(5)), &other);
        let (p, note) = ready(choose(Some(pack(1)), Some(revoked), &c));
        assert_eq!((p.version, p.source), (1, PackSource::Bundled));
        let note = note.expect("a note");
        assert!(note.contains("imported") && note.contains("revoked"), "{note}");
    }

    #[test]
    fn unsealed_and_untrusted_packs_are_refused() {
        let f = files(&manifest(1));
        let borrowed: Vec<(&str, &[u8])> = f.iter().map(|(n, d)| (n.as_str(), d.as_slice())).collect();
        assert!(refused(&build_store_zip(&borrowed), &ctx()).contains("not sealed"));
        assert!(refused(&seal(&f, &[9u8; 32]), &ctx()).contains("does not trust"));
    }

    #[test]
    fn the_wrong_kind_or_id_is_refused_by_name() {
        assert!(refused(&with_manifest(|m| m["kind"] = "freeform".into()), &ctx()).contains("\"freeform\""));
        assert!(refused(&with_manifest(|m| m["id"] = "patchy".into()), &ctx()).contains("\"patchy\""));
    }

    #[test]
    fn a_version_that_is_not_a_whole_number_of_at_least_one_is_refused() {
        for bad in [serde_json::json!(0), serde_json::json!(1.5), serde_json::json!("2"), Value::Null] {
            assert!(refused(&with_manifest(|m| m["version"] = bad.clone()), &ctx()).contains("whole number"), "{bad}");
        }
    }

    #[test]
    fn a_different_category_base_is_refused() {
        let other = with_manifest(|m| m["models"]["category"]["sha256"] = "3".repeat(64).into());
        assert!(refused(&other, &ctx()).contains("different category model"));
        let renamed = with_manifest(|m| m["models"]["category"]["file"] = "Other.gguf".into());
        assert!(refused(&renamed, &ctx()).contains("Other.gguf"));
    }

    #[test]
    fn an_adapter_that_does_not_hash_to_the_packs_own_figure_is_refused() {
        let bad = with_manifest(|m| m["models"]["category"]["adapter_sha256"] = "4".repeat(64).into());
        assert!(refused(&bad, &ctx()).contains("does not match"));
    }

    #[test]
    fn a_missing_or_unreadable_prompt_or_tunables_is_refused() {
        let mut f = files(&manifest(1));
        f.retain(|(n, _)| n != "prompts/category.json");
        assert!(refused(&seal(&f, &TEST1_SEED), &ctx()).contains("prompts.category"));
        let mut f = files(&manifest(1));
        f.iter_mut().find(|(n, _)| n == "tunables.json").unwrap().1 = b"not json".to_vec();
        assert!(refused(&seal(&f, &TEST1_SEED), &ctx()).contains("tunables.json could not be read"));
        let no_entry = with_manifest(|m| m["code"]["entry"] = "code/skills/missing.js".into());
        assert!(refused(&no_entry, &ctx()).contains("code.entry"));
    }

    #[test]
    fn a_pack_made_against_different_host_modules_is_refused() {
        let mut c = ctx();
        c.host_api = HostApi::Map(BTreeMap::from([("src/contracts.js".to_string(), "5".repeat(64))]));
        assert_eq!(refused(&pack(1), &c), "made for a different Pigeon build (src/contracts.js)");
        c.host_api = HostApi::Map(BTreeMap::from([("src/schema.js".to_string(), sha256_hex(b"x"))]));
        assert_eq!(refused(&pack(1), &c), "made for a different Pigeon build (src/schema.js)", "absent is different too");
    }

    #[test]
    fn a_missing_host_api_map_stops_a_release_build_and_is_noted_in_a_debug_one() {
        let mut c = ctx();
        c.host_api = HostApi::Missing;
        let (reason, _) = unavailable(choose(Some(pack(1)), None, &c));
        assert_eq!(reason, NO_HOST_API);
        c.require_host_api = false;
        let (p, note) = ready(choose(Some(pack(1)), None, &c));
        assert_eq!(p.version, 1);
        assert!(note.unwrap().contains("skipped the host-API check"));
    }

    #[test]
    fn neither_usable_gives_the_bundled_reason_and_notes_the_imported_one() {
        let (reason, note) = unavailable(choose(Some(with_manifest(|m| m["id"] = "x".into())), Some(b"junk".to_vec()), &ctx()));
        assert!(reason.contains("\"x\""), "{reason}");
        assert!(note.unwrap().contains("not a valid skill pack"));
    }

    /// Flight School's fixture is sealed by the TEST key but carries no models
    /// and is not Patch — refused for that, specifically.
    #[test]
    fn the_flight_school_fixture_is_refused_for_what_it_lacks() {
        let zip = std::fs::read(Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/sealed-test.pigeon")).unwrap();
        let reason = refused(&zip, &ctx());
        assert!(reason.contains("\"test-pack\""), "{reason}");
        let mut c = ctx();
        c.trusted.clear();
        assert!(refused(&zip, &c).contains("seal is broken"));
    }

    #[test]
    fn old_extractions_are_swept_and_nothing_else_is() {
        let root = scratch("sweep");
        std::fs::create_dir_all(root.join("v5-deadbeef")).unwrap();
        std::fs::create_dir_all(root.join("keep-me")).unwrap();
        std::fs::write(root.join(PACK_FILE), b"the imported pack stays").unwrap();
        sweep_slots(&root);
        assert!(!root.join("v5-deadbeef").exists(), "an old extraction is removed");
        assert!(root.join("keep-me").exists() && root.join(PACK_FILE).exists());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn the_state_waits_for_the_extraction_and_the_status_carries_no_path() {
        let state = Arc::new(PatchState::default());
        assert_eq!(state.status().state, "loading");
        let p = check_pack(&pack(1), &ctx(), PackSource::Imported).unwrap();
        state.set_ready(p, None);
        assert_eq!(state.status().state, "loading");
        let started = Instant::now();
        state.wait(Duration::from_millis(50));
        assert!(started.elapsed() >= Duration::from_millis(50), "pending extraction is waited on");

        let s2 = state.clone();
        let t = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(20));
            s2.set_extracted(Ok(()));
        });
        state.wait(Duration::from_secs(10));
        t.join().unwrap();
        let status = state.status();
        assert_eq!((status.state, status.version, status.source), ("ready", Some(1), Some(PackSource::Imported)));
        let json = serde_json::to_string(&status).unwrap();
        assert!(!json.contains("/Users/") && !json.contains("Application Support"), "{json}");
        assert!(json.contains(r#""code_base":"pigeon-pack://localhost/v1-"#), "{json}");

        let off = PatchState::default();
        off.set_unavailable("gone".into(), None);
        off.wait(Duration::from_secs(10));
        assert_eq!(serde_json::to_value(off.status()).unwrap(), serde_json::json!({"state":"unavailable","reason":"gone"}));
    }

    /* ── the pigeon-pack scheme ── */

    const A1_CSP: &str = "default-src 'self'; script-src 'self' pigeon-pack:; worker-src blob:; child-src blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' ipc: http://ipc.localhost";

    fn served_state() -> (PatchState, String) {
        let state = PatchState::default();
        let p = check_pack(&pack(1), &ctx(), PackSource::Bundled).unwrap();
        let base = p.code_base();
        state.set_ready(p, None);
        (state, base)
    }

    fn header<'a>(headers: &'a [(String, String)], name: &str) -> Option<&'a str> {
        headers.iter().find(|(k, _)| k.eq_ignore_ascii_case(name)).map(|(_, v)| v.as_str())
    }

    fn get(state: &PatchState, uri: &str) -> u16 {
        serve(state, "GET", uri, Some(APP_ORIGIN), "main", false).0
    }

    #[test]
    fn a_code_file_is_served_with_exact_headers_to_the_app_origin() {
        let (state, base) = served_state();
        let (status, headers, body) = serve(&state, "GET", &format!("{base}src/lib/text.js"), Some("tauri://localhost"), "main", false);
        assert_eq!(status, 200);
        assert_eq!(body, b"export const t = 1;");
        let want: Vec<(String, String)> = [
            ("Content-Type", "text/javascript; charset=utf-8"),
            ("Cache-Control", "public, max-age=31536000, immutable"),
            ("X-Content-Type-Options", "nosniff"),
            ("Access-Control-Allow-Origin", "tauri://localhost"),
        ]
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect();
        assert_eq!(headers, want);
        assert_eq!(serve(&state, "GET", &format!("{base}skills/index.js"), None, "popover", false).0, 200, "the popover too");
    }

    #[test]
    fn an_origin_outside_the_allow_list_gets_the_bytes_but_no_acao() {
        let (state, base) = served_state();
        let uri = format!("{base}skills/index.js");
        for origin in [Some("https://evil.example"), Some("null"), None, Some("tauri://localhost.evil")] {
            let (status, headers, body) = serve(&state, "GET", &uri, origin, "main", true);
            assert_eq!((status, body.as_slice()), (200, b"export default [];".as_slice()), "{origin:?}");
            assert_eq!(header(&headers, "Access-Control-Allow-Origin"), None, "{origin:?}");
            assert_eq!(header(&headers, "Content-Type"), Some("text/javascript; charset=utf-8"));
        }
    }

    #[test]
    fn dev_origins_are_allowed_only_in_a_debug_build() {
        let (state, base) = served_state();
        let uri = format!("{base}skills/index.js");
        assert_eq!(conf_dev_origin().as_deref(), Some("http://localhost:4173"));
        for origin in ["http://localhost:4173", "http://127.0.0.1:4173"] {
            let acao = |debug| header(&serve(&state, "GET", &uri, Some(origin), "main", debug).1, "Access-Control-Allow-Origin").map(String::from);
            assert_eq!(acao(true).as_deref(), Some(origin));
            assert_eq!(acao(false), None, "{origin} in a release build");
        }
        let other = serve(&state, "GET", &uri, Some("http://localhost:5173"), "main", true).1;
        assert_eq!(header(&other, "Access-Control-Allow-Origin"), None);
    }

    #[test]
    fn nothing_but_code_under_the_active_prefix_is_served() {
        let (state, base) = served_state();
        let slot = base.trim_start_matches("pigeon-pack://localhost/").trim_end_matches("/code/").to_string();
        let root = format!("pigeon-pack://localhost/{slot}/");
        for uri in [
            format!("{root}prompts/planner.json"),
            format!("{root}pigeon.json"),
            format!("{root}seal.json"),
            format!("{root}adapters/category.lora.gguf"),
            format!("{root}code/prompts/planner.json"),
            format!("{base}skills/index.json"),
            format!("{base}skills/missing.js"),
            format!("{base}../pigeon.json"),
            format!("{base}skills/../src/contracts.js"),
            format!("{base}%2e%2e/pigeon.json"),
            format!("{base}%2E%2E/pigeon.json"),
            format!("{base}skills%2Findex.js"),
            format!("{base}skills%2findex.js"),
            format!("{base}skills%5Cindex.js"),
            format!("{base}skills\\index.js"),
            format!("{base}skills/index.js%00"),
            format!("{base}skills/%252e%252e/index.js"),
            format!("{base}skills//index.js"),
            format!("{base}./skills/index.js"),
            format!("{base}skills/index.js?x=1"),
            format!("{base}skills/index.js%zz"),
            format!("pigeon-pack://localhost//{slot}/code/skills/index.js"),
            format!("pigeon-pack://localhost/v2-{}/code/skills/index.js", &slot[3..]),
            format!("pigeon-pack://localhost/v1-00000000/code/skills/index.js"),
            format!("pigeon-pack://evil.example/{slot}/code/skills/index.js"),
            format!("pigeon-pack://localhost:80/{slot}/code/skills/index.js"),
            format!("http://pigeon-pack.localhost/{slot}/code/skills/index.js"),
            format!("pigeon-pack://localhost/code/skills/index.js"),
        ] {
            assert_eq!(get(&state, &uri), 404, "{uri}");
        }
        assert_eq!(get(&state, &format!("{base}skills/index.js")), 200);
        assert_eq!(get(&state, &format!("{base}src/%6Cib/text.js")), 200, "an ordinary escape decodes once");
    }

    #[test]
    fn methods_windows_and_readiness_are_refused_with_their_own_status() {
        let (state, base) = served_state();
        let uri = format!("{base}skills/index.js");
        for method in ["POST", "HEAD", "PUT", "OPTIONS", "DELETE"] {
            let (status, headers, _) = serve(&state, method, &uri, Some(APP_ORIGIN), "main", false);
            assert_eq!((status, header(&headers, "Allow")), (405, Some("GET")), "{method}");
        }
        for label in ["settings", "", "Main", "popover2"] {
            assert_eq!(serve(&state, "GET", &uri, Some(APP_ORIGIN), label, false).0, 403, "{label:?}");
        }

        let starting = PatchState::default();
        let (status, headers, body) = serve(&starting, "GET", &uri, Some(APP_ORIGIN), "main", false);
        assert_eq!((status, header(&headers, "Content-Type")), (503, Some("text/plain; charset=utf-8")));
        assert!(!body.is_empty() && body.len() < 64);
        assert_eq!(header(&headers, "Access-Control-Allow-Origin"), None);
        let off = PatchState::default();
        off.set_unavailable("gone".into(), None);
        assert_eq!(get(&off, &uri), 503);
        state.set_extracted(Err("disk full".into()));
        assert_eq!(get(&state, &uri), 503, "a failed adapter makes Patch unavailable, code and all");
    }

    #[test]
    fn a_newly_selected_pack_retires_the_old_prefix() {
        let (state, old_base) = served_state();
        let p2 = check_pack(&pack(2), &ctx(), PackSource::Imported).unwrap();
        let new_base = p2.code_base();
        state.set_ready(p2, None);
        assert_eq!(get(&state, &format!("{old_base}skills/index.js")), 404);
        assert_eq!(get(&state, &format!("{new_base}skills/index.js")), 200);
    }

    #[test]
    fn the_page_csp_is_the_measured_a1_policy() {
        let conf: Value =
            serde_json::from_str(&std::fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("tauri.conf.json")).unwrap())
                .unwrap();
        assert_eq!(conf.pointer("/app/security/csp").and_then(Value::as_str), Some(A1_CSP));
    }

    #[test]
    fn import_upgrades_only_forward() {
        let dir = scratch("import");
        let c = ctx();
        match import_into(&dir, &pack(2), &c, Some(1), "patch.pigeon") {
            (ImportOutcome::Upgraded { from, to, message, .. }, true) => {
                assert_eq!((from, to), (Some(1), 2));
                assert!(message.contains("restart Patch"));
            }
            other => panic!("{other:?}"),
        }
        assert_eq!(std::fs::read(dir.join(PACK_FILE)).unwrap(), pack(2));
        assert!(!weights::part_path(&dir.join(PACK_FILE)).exists());
        let json = serde_json::to_value(import_into(&scratch("import-json"), &pack(2), &c, None, "p.pigeon").0).unwrap();
        assert_eq!(json["status"], "upgraded");

        assert!(matches!(import_into(&dir, &pack(2), &c, Some(1), "p").0, ImportOutcome::Already { .. }), "already staged");
        assert!(matches!(import_into(&dir, &pack(1), &c, Some(1), "p"), (ImportOutcome::Already { .. }, false)));
        match import_into(&dir, &pack(1), &c, Some(3), "p").0 {
            ImportOutcome::Refused { reason, .. } => assert_eq!(reason, "older than the Patch you have (v1 < v3)"),
            other => panic!("{other:?}"),
        }
        let bad = with_manifest(|m| m["kind"] = "freeform".into());
        match import_into(&dir, &bad, &c, Some(1), "p") {
            (ImportOutcome::Refused { reason, .. }, false) => assert!(reason.contains("not a skill pack")),
            other => panic!("{other:?}"),
        }
        assert_eq!(std::fs::read(dir.join(PACK_FILE)).unwrap(), pack(2), "a refusal writes nothing");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
