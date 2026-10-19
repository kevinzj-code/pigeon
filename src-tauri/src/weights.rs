//! Where the weights are — decided here, never by the page.
//!
//! A model file can be in one of two places, tried in this order:
//!
//!   1. an environment override (`PIGEON_PLANNER_MODEL`, `PIGEON_CATEGORY_MODEL`),
//!      honoured only when it names a file that exists — the courtesy
//!      `scripts/models.mjs` extends, kept for benches and experiments;
//!   2. Pigeon's OWN directory, `app_data_dir/models`, which is where the
//!      first-run download puts a file once its hash has been checked.
//!
//! The rail says which of the two it is (`own · bundled`, `from LLAMA_SERVER`).
//!
//! `Located` carries a real path and is deliberately NOT serialisable: the
//! engine hands it to `Command::new`, and the status the page sees carries the
//! file's NAME and its SOURCE only.
//!
//! `write_notices` puts the licence texts and an ATTRIBUTION.md beside the
//! weights. The downloader calls it before it opens a connection; attribution
//! is a precondition of the download, not something done after.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::manifest::{self, Manifest, ModelSpec};
use crate::Role;

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum Source {
    Own,
    Env,
}

/// A base model on this Mac. Not `Serialize` on purpose (see the module doc).
#[derive(Clone, Debug)]
pub struct Located {
    pub path: PathBuf,
    pub source: Source,
}

/// What `models_status` reports for one entry — the page sees these words and
/// a byte count, never a path.
#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "kebab-case", tag = "state")]
pub enum WeightState {
    Present { verified: bool },
    Partial { have_bytes: u64 },
    Missing,
}

fn is_readable_file(p: &Path) -> bool {
    std::fs::metadata(p).map(|m| m.is_file()).unwrap_or(false)
}

/// `app_data_dir/<name>`, created on demand. An empty `name` is the app data
/// directory itself.
pub fn app_subdir<R: tauri::Runtime>(app: &AppHandle<R>, name: &str) -> Result<PathBuf, String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("no app data directory: {e}"))?;
    let dir = if name.is_empty() { root } else { root.join(name) };
    std::fs::create_dir_all(&dir).map_err(|e| format!("could not create {}: {e}", dir.display()))?;
    Ok(dir)
}

/// `app_data_dir/models`, created on demand.
pub fn own_dir<R: tauri::Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    app_subdir(app, "models")
}

fn env_var_for(role: Role) -> &'static str {
    match role {
        Role::Category => "PIGEON_CATEGORY_MODEL",
        // Its base comes from the picture Pigeon being asked, not the environment.
        Role::Vision => "PIGEON_VISION_MODEL",
    }
}

/// The environment's model for a role, if it names a file that exists. A
/// value that does not is ignored rather than trusted — the posture
/// `find_tesseract` and `port_for` take.
pub fn env_override(role: Role) -> Option<PathBuf> {
    let p = PathBuf::from(std::env::var_os(env_var_for(role))?);
    is_readable_file(&p).then_some(p)
}

/// The lookup, with its inputs as arguments so it is testable without an app:
/// env, then own.
pub fn locate_in(spec: &ModelSpec, env: Option<PathBuf>, own: &Path) -> Option<(PathBuf, Source)> {
    if let Some(p) = env {
        return Some((p, Source::Env));
    }
    let mine = own.join(&spec.file);
    if is_readable_file(&mine) {
        return Some((mine, Source::Own));
    }
    None
}

/// What the page is told about a model's file: verified means the hash cache
/// knows it as the pinned hash — which the downloader records — without
/// reading it here.
pub fn state_in(spec: &ModelSpec, own: &Path, hashes: &crate::hashes::Hashes) -> WeightState {
    let mine = own.join(&spec.file);
    if is_readable_file(&mine) {
        return WeightState::Present { verified: hashes.known(&mine).as_deref() == Some(spec.sha256.as_str()) };
    }
    let part = part_path(&mine);
    if let Ok(meta) = std::fs::metadata(&part) {
        if meta.is_file() && meta.len() > 0 {
            return WeightState::Partial { have_bytes: meta.len() };
        }
    }
    WeightState::Missing
}

/// `<file>.part`: the in-progress download the next attempt resumes from.
pub fn part_path(dest: &Path) -> PathBuf {
    let mut s = dest.as_os_str().to_owned();
    s.push(".part");
    PathBuf::from(s)
}


/// Where one role's base model is, or None if it is not on this machine yet.
pub fn locate<R: tauri::Runtime>(app: &AppHandle<R>, role: Role) -> Result<Option<Located>, String> {
    let m = manifest::manifest()?;
    let Some(spec) = m.for_role(role) else { return Ok(None) };
    let own = own_dir(app)?;
    Ok(locate_in(spec, env_override(role), &own).map(|(path, source)| Located { path, source }))
}

/* ── personas: the adapters Lane B may wear ──────────────────────────────── */

/// What an imported Pigeon's manifest said about how to RUN it, written into
/// the sidecar beside the adapter by `pigeon::install` and read back here.
///
/// Every field is optional because a hand-dropped `.lora.gguf` has no sidecar
/// at all, and that is a supported thing to have: it is a persona with no
/// measured budget, which is what every persona was before `.pigeon` files
/// existed. An absent `kind` therefore means `persona` — never a one-shot job,
/// because running an unknown adapter as a one-shot with no template would be
/// guessing at what it is.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct Contract {
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default = "persona_kind")]
    pub kind: String,
    /// The user turn it was trained with, `{input}` marking where the text
    /// goes. Stays in Rust: the page says what to run, never how to phrase it.
    #[serde(default)]
    pub prompt_template: Option<String>,
    /// `output_contract.max_tokens` — the budget measured on its own test.
    #[serde(default)]
    pub max_tokens: Option<u32>,
    #[serde(default)]
    pub output_type: Option<String>,
    /// `output_contract.answer` — for a `reasoned` Pigeon, what the answer
    /// inside its last `<do>…</do>` is: `label` or `json`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub answer_type: Option<String>,
    /// A classifier's `labels.txt`, one per line.
    #[serde(default)]
    pub labels: Vec<String>,
    /// `pigeon::SIDECAR_VERSION` at the time it was written; 0 for a sidecar
    /// written by hand or by an older build, which the launch repair rebuilds.
    #[serde(default)]
    pub sidecar: u32,
    /// The skill that draws this Pigeon's recipe (format §9), and its version.
    /// Its parts table sits beside the adapter as `<id>.skill.json`.
    #[serde(default)]
    pub skill: Option<String>,
    #[serde(default)]
    pub skill_version: Option<u64>,
    /// How a grounded Pigeon's material is chosen (format §8). The material
    /// sits beside the adapter as `<id>.material.json`.
    #[serde(default)]
    pub retrieval: Option<String>,
    /// The maker's card (format §2.1), kept as the file carried it when it says
    /// what the Pigeon does; the page shows it as the maker's words.
    #[serde(default)]
    pub card: Option<serde_json::Value>,
    /// A voice's measured memory shape (lanebbench --shape): "A" when it passed
    /// with earlier turns sent, "B" when it only passed with the newest message
    /// alone. Absent for a voice nobody has measured.
    #[serde(default)]
    pub shape: Option<String>,
    /// What can be put in (format §2.2), already normalised by
    /// `pigeon::Manifest::declared_inputs`. A sidecar written before the field
    /// existed — or dropped in by hand beside a bare `.lora.gguf` — has none,
    /// and none means text, which is what it takes. That is why
    /// `SIDECAR_VERSION` is not bumped for this: an older sidecar CAN be
    /// trusted to lack it, because no file that could have declared it was
    /// written before the field was.
    #[serde(default = "text_only")]
    pub inputs: Vec<String>,
    /// A picture Pigeon's projector, by sha256 — set only when its base sees
    /// pictures. Present means it runs on the vision server, never the
    /// category one: that server has no projector and would refuse the adapter.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub projector: Option<String>,
    /// The base file it was trained on, so the vision server can start the
    /// right one. Absent on sidecars written before it was recorded.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_file: Option<String>,
    /// The base it was trained on, by identity (format §7.2): what decides
    /// whether it can ride on a server running another file of that base.
    /// Absent on sidecars written before `SIDECAR_VERSION` 7.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_identity: Option<pigeon_core::gguf::Identity>,
    /// What its import check said (`pigeon::notes_for`), for its page.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub notes: Vec<crate::pigeon::Note>,
    /// The words every one of its examples was asked with, when they were all
    /// the same — "Which breed is this?". A picture sent with nothing typed is
    /// asked with these, because that is the only way it was ever trained.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_input: Option<String>,
    /// D83: a base Pigeon — no adapter, its base alone with its prompts. Its
    /// sidecar is all that sits in the adapters folder; the engine asks it
    /// from the kept `.pigeon`. No `SIDECAR_VERSION` bump: nothing written
    /// before this field could have been one, so an older sidecar lacks it.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub base_only: bool,
}

fn text_only() -> Vec<String> {
    vec!["text".into()]
}

fn persona_kind() -> String {
    "persona".into()
}

impl Default for Contract {
    fn default() -> Self {
        Contract {
            label: None,
            kind: persona_kind(),
            prompt_template: None,
            max_tokens: None,
            output_type: None,
            answer_type: None,
            labels: Vec::new(),
            sidecar: 0,
            skill: None,
            skill_version: None,
            retrieval: None,
            card: None,
            shape: None,
            inputs: text_only(),
            projector: None,
            base_file: None,
            base_identity: None,
            notes: Vec::new(),
            default_input: None,
            base_only: false,
        }
    }
}

/// The shape a contract records, when it is one this build knows.
pub fn measured_shape(contract: &Contract) -> Option<String> {
    contract.shape.as_deref().filter(|s| *s == "A" || *s == "B").map(String::from)
}

impl Contract {
    /// A voice, to be worn in a conversation. Everything else is a job: one
    /// input, one output, its own template and budget (`pigeon::pigeon_run`).
    pub fn conversational(&self) -> bool {
        self.kind == "persona"
    }
}

/// One installed Pigeon found on disk. `id` is the file's stem — the name the
/// page uses; the path stays here. `path` is its adapter, or its sidecar for a
/// base Pigeon, which has no adapter (`bytes` 0); only its folder is used.
#[derive(Clone, Debug)]
pub struct PersonaFile {
    pub id: String,
    pub name: String,
    pub path: PathBuf,
    pub bytes: u64,
    pub contract: Contract,
}

/// What the page is told about a Pigeon: a name, a size, and enough of its
/// contract to know which door to send it through — never a path, and never
/// the template, which Rust renders.
#[derive(Serialize, Clone, Debug)]
pub struct PersonaInfo {
    /// True for a picture Pigeon: it runs on the vision server, and a pasted
    /// picture is its input rather than something to read the text off.
    pub vision: bool,
    /// The model it runs on, by file name: a picture Pigeon's own base, None
    /// for everything on the category server (the page names that one).
    pub base: Option<String>,
    pub id: String,
    pub name: String,
    pub bytes: u64,
    /// True when the running category server has this adapter loaded, so the
    /// page can say which are usable now and which need a wake.
    pub loaded: bool,
    pub kind: String,
    pub max_tokens: Option<u32>,
    pub output_type: Option<String>,
    pub labels: Vec<String>,
    /// The skill that draws its answer, when it has one.
    pub skill: Option<String>,
    /// Set for a grounded Pigeon: how it picks its material.
    pub retrieval: Option<String>,
    /// Its `icon.png` as a `data:image/png;base64,…` URL, when it carried a
    /// good one — the page shows it as the avatar. Never a path.
    pub icon: Option<String>,
    /// The maker's card, when the file carried one Pigeon can use.
    pub card: Option<serde_json::Value>,
    /// The measured memory shape, "A" or "B"; None when unmeasured.
    pub shape: Option<String>,
    /// What this Pigeon says it takes in: `["text"]` for every file written so
    /// far. The page shows it on the Pigeon's facts and uses it to decide
    /// whether a pasted picture is an input or something to explain.
    pub inputs: Vec<String>,
    /// What its import check said, for its page to word (`pigeon::Note`).
    pub notes: Vec<crate::pigeon::Note>,
    /// A picture Pigeon made by recording: which key each answer presses, and
    /// how its pictures were made (its actions.json). None for everything else.
    pub presses: Option<serde_json::Value>,
    /// D83: a base Pigeon, with no training of its own.
    pub base_only: bool,
    /// What its maker's `report.json` says about where the score was taken
    /// (`report_facts`). None when this app kept no file for it.
    pub report: Option<serde_json::Value>,
}

/// From a `.pigeon`'s `report.json`, the four things its page says about the
/// maker's score: the engine it was measured in (D98), how many rows another
/// model judged, where the rows came from (D95) and where it was trained
/// (D97). A field the file does not carry is null; a file with no report, or
/// one that cannot be read, gives every field null.
pub fn report_facts(pigeon: &[u8]) -> serde_json::Value {
    let ride = pigeon_core::zip_store::list_entries(pigeon)
        .ok()
        .and_then(|entries| pigeon_core::zip_store::get(&entries, pigeon, "report.json").ok().flatten().map(<[u8]>::to_vec))
        .and_then(|raw| serde_json::from_slice::<serde_json::Value>(&raw).ok())
        .map(|r| r["check_ride"].clone())
        .unwrap_or(serde_json::Value::Null);
    let text = |k: &str| ride.get(k).and_then(|v| v.as_str()).map(str::trim).filter(|s| !s.is_empty()).map(String::from);
    serde_json::json!({
        "engine": text("engine"),
        "graded_by_model": ride.get("graded_by_model").and_then(serde_json::Value::as_u64),
        "rows_source": text("rows_source"),
        "trained_where": text("trained_where"),
    })
}

/// The icon kept beside an adapter, as a URL the page can put in an `<img>`.
/// Checked again on the way out: the adapters folder is one a person can drop
/// files into by hand.
pub fn icon_data_url(adapters: &Path, id: &str) -> Option<String> {
    let path = crate::pigeon::icon_path(adapters, id);
    let meta = std::fs::metadata(&path).ok();
    let stamp = (meta.as_ref().and_then(|m| m.modified().ok()), meta.as_ref().map_or(0, |m| m.len()));
    if let Some((at, len, url)) = ICONS.lock().ok().as_deref().and_then(|c| c.get(&path)) {
        if (*at, *len) == stamp {
            return url.clone();
        }
    }
    let url = std::fs::read(&path)
        .ok()
        .filter(|bytes| crate::pigeon::icon_ok(bytes))
        .map(|bytes| format!("data:image/png;base64,{}", crate::capture::base64(&bytes)));
    if let Ok(mut c) = ICONS.lock() {
        c.insert(path, (stamp.0, stamp.1, url.clone()));
    }
    url
}

/// `app_data_dir/adapters`: where a trained persona is dropped. Created on
/// demand so the folder exists to be found.
pub fn personas_dir<R: tauri::Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    app_subdir(app, "adapters")
}

/// The sidecar `<stem>.json` beside an adapter: `label` alone is the shape
/// Flight School and Loft already write by hand, and an imported `.pigeon`
/// adds the rest of its contract. A file with no sidecar, or one that will not
/// parse, is the default contract — a persona with nothing measured.
fn persona_contract(path: &Path) -> Contract {
    let sidecar = path.with_extension("json");
    std::fs::read_to_string(&sidecar)
        .ok()
        .and_then(|text| serde_json::from_str::<Contract>(&text).ok())
        .unwrap_or_default()
}


/// The display name: the sidecar's `label`, else the stem with its separators
/// turned back into spaces.
fn persona_name(contract: &Contract, id: &str) -> String {
    if let Some(l) = contract.label.as_deref() {
        if !l.trim().is_empty() {
            return l.trim().to_string();
        }
    }
    id.replace("---", " — ").replace(['-', '_'], " ")
}

/// Every persona adapter in the folder, sorted by name.
///
/// A path holding a comma or a colon is skipped: those are the separators in
/// llama-server's `--lora-scaled` argument, and a file name that breaks the
/// argument would take the whole server down rather than just itself.
pub fn personas_in(dir: &Path) -> Vec<PersonaFile> {
    /* Listed, parsed and sorted once per change to the folder: the list is
       asked for at boot, on every engine transition and by both windows, and
       reading every sidecar again each time is work with one answer. The
       signature is every file's name, size and modified time — a dropped
       adapter, an edited sidecar or a repacked import all change it. */
    let signature = folder_signature(dir);
    if let Some((sig, cached)) = PERSONAS.lock().ok().as_deref().and_then(|c| c.get(dir)) {
        if *sig == signature {
            return cached.clone();
        }
    }
    let out = read_personas_in(dir);
    if let Ok(mut c) = PERSONAS.lock() {
        c.insert(dir.to_path_buf(), (signature, out.clone()));
    }
    out
}

type Signature = Vec<(String, u64, Option<std::time::SystemTime>)>;
static PERSONAS: std::sync::Mutex<std::collections::BTreeMap<PathBuf, (Signature, Vec<PersonaFile>)>> =
    std::sync::Mutex::new(std::collections::BTreeMap::new());
static ICONS: std::sync::Mutex<std::collections::BTreeMap<PathBuf, (Option<std::time::SystemTime>, u64, Option<String>)>> =
    std::sync::Mutex::new(std::collections::BTreeMap::new());

fn folder_signature(dir: &Path) -> Signature {
    let Ok(entries) = std::fs::read_dir(dir) else { return Vec::new() };
    let mut sig: Signature = entries
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let m = e.metadata().ok()?;
            Some((e.file_name().to_string_lossy().into_owned(), m.len(), m.modified().ok()))
        })
        .collect();
    sig.sort();
    sig
}

fn read_personas_in(dir: &Path) -> Vec<PersonaFile> {
    let Ok(entries) = std::fs::read_dir(dir) else { return Vec::new() };
    let mut out: Vec<PersonaFile> = entries
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let file = e.file_name().to_string_lossy().into_owned();
            let id = file.strip_suffix(".lora.gguf").or_else(|| file.strip_suffix(".lora.json"))?;
            // A sidecar beside its adapter is found by the adapter.
            if file.ends_with(".lora.json") && dir.join(format!("{id}.lora.gguf")).exists() {
                return None;
            }
            persona_at(dir, id)
        })
        .collect();
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    out
}

pub fn personas<R: tauri::Runtime>(app: &AppHandle<R>) -> Vec<PersonaFile> {
    personas_dir(app).map(|d| personas_in(&d)).unwrap_or_default()
}

/// One persona by id, found directly rather than by listing and reading every
/// sidecar in the folder — for a caller (a chat turn, a Pigeon run) that
/// already knows exactly which persona it wants. Applies the same rules
/// `personas_in` filters by, so the two agree on what counts as a persona.
pub fn persona_by_id<R: tauri::Runtime>(app: &AppHandle<R>, id: &str) -> Option<PersonaFile> {
    if !crate::pigeon::plain_id(id) {
        return None;
    }
    persona_at(&personas_dir(app).ok()?, id)
}

/// The Pigeon `id` in the adapters folder `dir`: its adapter, or — for a base
/// Pigeon (D83), which has none — its sidecar saying `base_only`. A sidecar
/// with no adapter that does not say so is an orphan, not a Pigeon.
fn persona_at(dir: &Path, id: &str) -> Option<PersonaFile> {
    if id.contains(',') || id.contains(':') {
        return None;
    }
    let adapter = dir.join(format!("{id}.lora.gguf"));
    if is_readable_file(&adapter) {
        let bytes = std::fs::metadata(&adapter).map(|m| m.len()).unwrap_or(0);
        let contract = persona_contract(&adapter);
        return Some(PersonaFile { name: persona_name(&contract, id), id: id.to_string(), path: adapter, bytes, contract });
    }
    let sidecar = dir.join(format!("{id}.lora.json"));
    let contract = persona_contract(&sidecar);
    (contract.base_only && is_readable_file(&sidecar))
        .then(|| PersonaFile { name: persona_name(&contract, id), id: id.to_string(), path: sidecar, bytes: 0, contract })
}

/// Today's date as `YYYY-MM-DD`, from the system clock, without a calendar
/// crate. (Howard Hinnant's civil-from-days.)
fn today_iso() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let z = secs.div_euclid(86_400) + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    format!("{y:04}-{m:02}-{d:02}")
}

/// The licence text this build carries for an SPDX id, if it carries one.
/// Apache-2.0 is the licence's own terms, cut from Qwen's notice without
/// Qwen's header: a base a registry lists need not be Qwen's.
fn licence_text(spdx: &str) -> Option<&'static str> {
    match spdx {
        "Apache-2.0" => {
            let text = manifest::LICENCE_QWEN;
            let at = text.find("Apache License\n")?;
            Some(&text[text[..at].rfind('\n').map_or(0, |i| i + 1)..])
        }
        _ => None,
    }
}

/// Beside a projector fetched from a registry (the needs-projector flow):
/// `<file>.LICENSE.txt`, saying what it is, where it came from and under what
/// licence, with that licence's text when this build carries it. Written
/// before the download starts, as `write_notices` is for the app's own models.
pub fn write_projector_notice(dest: &Path, base: &pigeon_core::registry::Base, file: &pigeon_core::registry::File) -> Result<PathBuf, String> {
    let name = dest.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| file.file.clone());
    let notice = dest.with_file_name(format!("{}.LICENSE.txt", name.trim_end_matches(".gguf")));
    let whose = base.id.clone().unwrap_or_else(|| format!("{} {}", base.identity.name, base.identity.size).trim().to_string());
    let spdx = base.license.as_deref().map(str::trim).filter(|s| !s.is_empty());
    let url = base.license_url.as_deref().unwrap_or("no address given");
    let mut out = format!(
        "{name} — the picture reader (projector) for {whose}\n\
         Written by Pigeon on {} before the download began. Fetched from {} and kept only if its SHA-256 matches:\n\
         \x20 sha256 {}\n\x20 bytes  {}\n\
         Licence: {} — {url}\n\n",
        today_iso(),
        file.url.as_deref().unwrap_or("the address the registry gives"),
        file.sha256,
        file.bytes.map_or("not stated".to_string(), |b| b.to_string()),
        spdx.unwrap_or("not stated by the registry"),
    );
    match spdx.and_then(licence_text) {
        Some(text) => out.push_str(text),
        None => out.push_str(&format!("This build does not carry the text of {}. It is at {url}.\n", spdx.unwrap_or("its licence"))),
    }
    std::fs::write(&notice, out).map_err(|e| format!("could not write the projector's licence — {e}"))?;
    Ok(notice)
}

/// Write the licence texts and an attribution record beside the weights.
/// Idempotent, and called before any download starts.
pub fn write_notices(dir: &Path, m: &Manifest) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| format!("could not create {}: {e}", dir.display()))?;
    let put = |name: &str, text: &str| {
        std::fs::write(dir.join(name), text).map_err(|e| format!("could not write {name}: {e}"))
    };
    put("LICENSE-llama.cpp.txt", manifest::LICENCE_LLAMA_CPP)?;
    put("LICENSE-Qwen.txt", manifest::LICENCE_QWEN)?;
    if m.embedding.is_some() {
        put("LICENSE-Nomic.txt", manifest::LICENCE_NOMIC)?;
    }

    let mut md = String::new();
    md.push_str("# What is in this folder, and whose it is\n\n");
    md.push_str(&format!("Written by Pigeon on {} before any download began. ", today_iso()));
    md.push_str("Each file below is fetched from the URL shown and kept only if its SHA-256 matches.\n\n");
    md.push_str("| Model | File | Bytes | SHA-256 | Licence | Source |\n|---|---|---|---|---|---|\n");
    for s in &m.models {
        md.push_str(&format!(
            "| {} ({}) | `{}` | {} | `{}` | {} — {} | {} |\n",
            s.name, s.quant, s.file, s.bytes, s.sha256, s.licence.spdx, s.licence.holder, s.url
        ));
        if let Some(a) = &s.adapter {
            md.push_str(&format!(
                "| Pigeon category adapter | `{}` | {} | `{}` | Pigeon's own licence (Apache-2.0) | ships in the app |\n",
                a.file, a.bytes, a.sha256
            ));
        }
    }
    if let Some(p) = &m.picture {
        for (what, f) in [(format!("{} ({})", p.name, p.quant), &p.files()[0]), (format!("{} projector", p.name), &p.files()[1])] {
            md.push_str(&format!(
                "| {what} — only when asked for, from Peek | `{}` | {} | `{}` | {} — {} (see LICENSE-Qwen.txt) | {} |\n",
                f.file, f.bytes, f.sha256, p.licence.spdx, p.licence.holder, f.url
            ));
        }
    }
    md.push_str(&format!(
        "\nThe server that runs them is llama.cpp build {} (MIT; see LICENSE-llama.cpp.txt), linked against OpenSSL 3 (Apache-2.0; see LICENSE-OpenSSL.txt).\n",
        m.llama_cpp.build
    ));
    put("ATTRIBUTION.md", &md)
}

#[cfg(test)]
mod tests {
    #[test]
    fn a_report_gives_its_engine_judged_rows_and_provenance_or_nulls() {
        use pigeon_core::zip_store::test_support::build_store_zip;
        let report = br#"{ "check_ride": { "passed": 40, "total": 48, "graded_by_model": 12,
            "engine": "libpigeon 0.1.0 (llama.cpp 26394b4; spec 1; prefix-cache 2048)",
            "rows_source": "held out of round 3", "trained_where": "L40S, mlx-lm 0.26" } }"#;
        let with = build_store_zip(&[("pigeon.json", b"{}"), ("report.json", report)]);
        let r = report_facts(&with);
        assert_eq!(r["engine"], "libpigeon 0.1.0 (llama.cpp 26394b4; spec 1; prefix-cache 2048)");
        assert_eq!(r["graded_by_model"], 12);
        assert_eq!(r["rows_source"], "held out of round 3");
        assert_eq!(r["trained_where"], "L40S, mlx-lm 0.26");
        // An older file: a report without the newer fields.
        let old = build_store_zip(&[("pigeon.json", b"{}"), ("report.json", br#"{ "check_ride": { "passed": 1, "total": 2, "engine": " " } }"#)]);
        let r = report_facts(&old);
        assert!(r["engine"].is_null() && r["graded_by_model"].is_null() && r["rows_source"].is_null() && r["trained_where"].is_null(), "{r}");
        // No report, and not a zip at all: every field null, nothing thrown.
        assert!(report_facts(&build_store_zip(&[("pigeon.json", b"{}")]))["engine"].is_null());
        assert!(report_facts(b"junk")["engine"].is_null());
    }

    #[test]
    fn the_persona_list_is_read_again_only_when_the_folder_changes() {
        let root = std::env::temp_dir().join(format!("pigeon-personas-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        struct Dir(std::path::PathBuf);
        impl Dir { fn path(&self) -> &Path { &self.0 } }
        impl Drop for Dir { fn drop(&mut self) { let _ = std::fs::remove_dir_all(&self.0); } }
        let dir = Dir(root);
        std::fs::write(dir.path().join("a.lora.gguf"), b"x").unwrap();
        std::fs::write(dir.path().join("a.lora.json"), r#"{"label":"A"}"#).unwrap();
        assert_eq!(personas_in(dir.path()).iter().map(|p| p.name.as_str()).collect::<Vec<_>>(), vec!["A"]);
        /* Same folder, same answer, from the cache. */
        assert_eq!(personas_in(dir.path())[0].name, "A");
        std::thread::sleep(std::time::Duration::from_millis(20));
        std::fs::write(dir.path().join("a.lora.json"), r#"{"label":"A renamed"}"#).unwrap();
        assert_eq!(personas_in(dir.path())[0].name, "A renamed");
        std::fs::write(dir.path().join("b.lora.gguf"), b"y").unwrap();
        assert_eq!(personas_in(dir.path()).len(), 2);
    }

    use super::*;

    /// The licence gap Draft 8 left: a projector fetched from a registry gets
    /// its licence beside it, with the text when this build carries it.
    #[test]
    fn a_registry_projector_is_written_with_its_licence_beside_it() {
        let dir = std::env::temp_dir().join(format!("pigeon-test-projector-notice-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let file: pigeon_core::registry::File = serde_json::from_str(r#"{"file":"mmproj-Qwen3VL-2B-Instruct-Q8_0.gguf","sha256":"f9a6","bytes":445000000,"url":"https://huggingface.co/x/mmproj.gguf"}"#).unwrap();
        let base = |license: &str| -> pigeon_core::registry::Base {
            serde_json::from_str(&format!(r#"{{"id":"qwen3-vl-2b-instruct","identity":{{"arch":"qwen3vl","name":"qwen3vl","size":"2B"}},{license}"license_url":"https://example.org/LICENSE"}}"#)).unwrap()
        };
        let dest = dir.join("mmproj-Qwen3VL-2B-Instruct-Q8_0.gguf");

        let apache = std::fs::read_to_string(write_projector_notice(&dest, &base(r#""license":"Apache-2.0","#), &file).unwrap()).unwrap();
        assert!(dir.join("mmproj-Qwen3VL-2B-Instruct-Q8_0.LICENSE.txt").is_file());
        assert!(apache.starts_with("mmproj-Qwen3VL-2B-Instruct-Q8_0.gguf — the picture reader (projector) for qwen3-vl-2b-instruct"), "{apache}");
        assert!(apache.contains("sha256 f9a6") && apache.contains("bytes  445000000") && apache.contains("https://huggingface.co/x/mmproj.gguf"));
        assert!(apache.contains("Licence: Apache-2.0 — https://example.org/LICENSE"));
        assert!(apache.contains("TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION"), "the licence's own text");
        assert!(!apache.contains("Pigeon downloads on first run"), "not Qwen's header about the app's own models");

        for unknown in [r#""license":"CC-BY-NC-4.0","#, r#""license":"LicenseRef-Other","#, ""] {
            let other = std::fs::read_to_string(write_projector_notice(&dest, &base(unknown), &file).unwrap()).unwrap();
            assert!(other.contains("This build does not carry the text of") && other.contains("It is at https://example.org/LICENSE."), "{other}");
        }
        // Beside the projector, not mistaken for one.
        assert!(pigeon_core::scan::ggufs(&[dir.clone()]).is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    fn scratch(name: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("pigeon-weights-test-{name}"));
        let _ = std::fs::remove_dir_all(&p);
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    fn spec() -> ModelSpec {
        manifest::manifest().unwrap().for_role(Role::Category).unwrap().clone()
    }

    #[test]
    fn own_weights_are_found_in_the_models_folder() {
        let own = scratch("own");
        std::fs::write(own.join(&spec().file), b"mine").unwrap();
        let (p, src) = locate_in(&spec(), None, &own).unwrap();
        assert_eq!(src, Source::Own);
        assert!(p.starts_with(&own));
    }

    #[test]
    fn nothing_anywhere_is_missing_not_an_error() {
        let own = scratch("none");
        assert!(locate_in(&spec(), None, &own).is_none());
        assert_eq!(state_in(&spec(), &own, &crate::hashes::Hashes::at(&own.join(crate::hashes::FILE))), WeightState::Missing);
    }

    #[test]
    fn an_env_path_is_honoured_only_when_it_exists() {
        let own = scratch("env");
        let real = own.join("elsewhere.gguf");
        std::fs::write(&real, b"x").unwrap();
        let (p, src) = locate_in(&spec(), Some(real.clone()), &own).unwrap();
        assert_eq!((p, src), (real, Source::Env));
        // env_override itself refuses a path that is not a file
        std::env::set_var("PIGEON_CATEGORY_MODEL", own.join("does-not-exist.gguf"));
        assert!(env_override(Role::Category).is_none());
        std::env::remove_var("PIGEON_CATEGORY_MODEL");
    }

    #[test]
    fn a_part_file_reports_how_far_it_got_and_a_recorded_hash_means_verified() {
        let own = scratch("part");
        let hashes = crate::hashes::Hashes::at(&own.join(crate::hashes::FILE));
        let dest = own.join(&spec().file);
        std::fs::write(part_path(&dest), vec![0u8; 1234]).unwrap();
        assert_eq!(state_in(&spec(), &own, &hashes), WeightState::Partial { have_bytes: 1234 });
        std::fs::write(&dest, b"done").unwrap();
        assert_eq!(state_in(&spec(), &own, &hashes), WeightState::Present { verified: false });
        hashes.record(&dest, &spec().sha256);
        assert_eq!(state_in(&spec(), &own, &hashes), WeightState::Present { verified: true });
    }

    #[test]
    fn notices_carry_every_hash_and_licence() {
        let dir = scratch("notices");
        let m = manifest::manifest().unwrap();
        write_notices(&dir, m).unwrap();
        let md = std::fs::read_to_string(dir.join("ATTRIBUTION.md")).unwrap();
        for s in &m.models {
            assert!(md.contains(&s.sha256), "{} hash missing", s.id);
            assert!(md.contains(&s.url), "{} url missing", s.id);
        }
        assert!(md.contains("ed667c493b8f411dc892be44c928492f915de57c8ad4ce6d8381cf7efbc5315c"), "adapter hash");
        assert!(dir.join("LICENSE-llama.cpp.txt").exists());
        assert!(dir.join("LICENSE-Qwen.txt").exists());
        assert!(!dir.join("LICENSE-OpenSSL.txt").exists(), "no OpenSSL ships any more");
        // and it is idempotent
        write_notices(&dir, m).unwrap();
    }

    #[test]
    fn a_persona_is_named_by_its_sidecar_or_its_file_name() {
        let dir = scratch("personas");
        std::fs::write(dir.join("socratic-tutor.lora.gguf"), vec![0u8; 128]).unwrap();
        std::fs::write(dir.join("socratic-tutor.lora.json"), r#"{"label":"Socratic Tutor"}"#).unwrap();
        std::fs::write(dir.join("poet.lora.gguf"), vec![0u8; 64]).unwrap();
        // not adapters, and one that would break --lora-scaled's own separators
        std::fs::write(dir.join("notes.txt"), b"x").unwrap();
        std::fs::write(dir.join("a,b.lora.gguf"), b"x").unwrap();
        let found = personas_in(&dir);
        let names: Vec<&str> = found.iter().map(|p| p.name.as_str()).collect();
        assert_eq!(names, ["poet", "Socratic Tutor"], "{names:?}");
        assert_eq!(found[1].id, "socratic-tutor");
        assert_eq!(found[0].bytes, 64);
    }


    #[test]
    fn a_folder_with_nothing_in_it_is_no_personas_not_an_error() {
        assert!(personas_in(&scratch("no-personas")).is_empty());
        assert!(personas_in(Path::new("/does/not/exist")).is_empty());
    }

    #[test]
    fn the_date_is_iso_and_plausible() {
        let d = today_iso();
        assert_eq!(d.len(), 10, "{d}");
        assert!(d.starts_with("20"), "{d}");
    }
}
