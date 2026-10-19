//! The import check (spec §7.3): the steps a Reader runs, in order, before a
//! `.pigeon` is loaded, stopping at the first refusal.
//!
//! The one rule this whole module exists for: an installed model with the same
//! identity (§7.2) as the one a Pigeon was trained on loads it, even at a
//! different quantization, with a warning; a different model refuses and names
//! the one needed; and a machine with no models at all is `no_base` rather
//! than `wrong_base` — the same refusal, a different reason.
//!
//! Every refusal and warning has a stable code (Appendix A) and a sentence
//! that names exactly what failed. Codes are the contract; a host may word the
//! sentence its own way.

use serde::Serialize;
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};

use crate::manifest::{History, Manifest, PROJECTOR_FILE};
use crate::registry::{self, Registry};
use crate::{actions, ask, card, gguf, manifest, material, seal, skill, zip_store};

/// `format_version` newer than this is refused rather than misread.
pub const SUPPORTED_FORMAT_VERSION: u64 = 1;

/// Every `kind` this reader runs. Anything else is refused BY NAME — never read
/// as "probably freeform". That refusal is what lets a new kind ship without a
/// format bump, and it only holds while every reader keeps it.
pub const KINDS: [&str; 6] = ["classifier", "extractor", "persona", "router", "freeform", "grounded"];

/// The one kind that may carry `code/`, and only under a trusted seal (§15.3).
/// Reserved: a general reader refuses it (`unsupported_kind`), and a host that
/// runs skill packs defines its own runtime outside this crate.
pub const SKILLPACK: &str = "skillpack";

/// Every `output_contract.type` this reader knows (§5.4). An unknown one is
/// refused by name, never treated as `text`.
pub const OUTPUT_TYPES: [&str; 4] = ["label", "json", "text", "reasoned"];

pub const MANIFEST_FILE: &str = "pigeon.json";
pub const ADAPTER_FILE: &str = "adapter.lora.gguf";
pub const MATERIAL_FILE: &str = "material/chunks.json";

/// One installed base model, as far as identifying it goes: never its full
/// bytes, and its hash only when the host already knows it — an import must
/// not cost re-hashing a multi-gigabyte file.
#[derive(Debug, Clone)]
pub struct InstalledBase {
    pub file: String,
    pub identity: gguf::Identity,
    pub sha256: Option<String>,
}

/// An embedding model the machine holds, for `hybrid-v1` (§9.4). The hash is
/// the rule; `dims` and `query_prefix`, when the host knows them, are held
/// against what the file's vectors were made with.
#[derive(Debug, Clone)]
pub struct Embedder {
    pub sha256: String,
    pub dims: Option<u32>,
    pub query_prefix: Option<String>,
}

/// What this machine has. All of it is the caller's to find.
#[derive(Debug, Clone, Copy)]
pub struct Machine<'a> {
    pub bases: &'a [InstalledBase],
    /// sha256 of every projector available: installed, or one the host can
    /// fetch from a registry it trusts.
    pub projectors: &'a [String],
    pub embedders: &'a [Embedder],
}

/// Which seal keys the host trusts, as public keys: 64 hex characters each.
/// One key, one purpose (§15.2): a key on one list is not trusted for the
/// other. An empty list trusts nobody. A key the host has revoked is simply
/// not on its list.
#[derive(Debug, Clone, Copy, Default)]
pub struct Trust<'a> {
    pub pigeons: &'a [String],
    pub registries: &'a [String],
}

#[derive(Debug, Clone, Copy, Default)]
pub struct Host<'a> {
    /// `None` checks the file only (§7.3 steps 1–5): no base, no projector and
    /// no embedding model is looked for.
    pub machine: Option<Machine<'a>>,
    pub trust: Trust<'a>,
    /// The registries the host has opened and trusts (`registry::open_all`).
    /// A projector one lists for the Pigeon's base is downloadable, and so
    /// counts as available (§7.3 step 6); and a base one lists is what a
    /// refusal's `needs` is filled from.
    pub registries: &'a [Registry],
}

/// What step 6 decided, when it decided to load at all — `wrong` and `missing`
/// never reach a report; they are refusals.
#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum BaseMatch {
    Exact,
    SameBaseOtherQuant,
}

/// What a self-test may claim (§12.2): pass/fail only where the answer is
/// checked exactly.
#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SelfTest {
    Verdict,
    Samples,
}

/// A warning never stops a Pigeon from loading (Appendix A.2).
#[derive(Debug, Clone, PartialEq)]
pub enum Warning {
    /// Loads on the same model, but not the exact file it was measured on.
    /// `have` is the installed file that matched.
    SameBaseOtherQuant { trained_on: String, have: String },
    /// The card breaks §11 and is not shown (the field).
    CardSkipped(String),
    /// A label, JSON or reasoned Pigeon with a temperature above 0 (the one
    /// written); it runs at 0.
    TemperatureIgnored(f64),
    /// A data-only Pigeon sealed by a key the host does not trust (why).
    UntrustedSeal(String),
    /// A picture Pigeon trained on a 4-bit base.
    TrainedQuantized,
    /// No `prompt_check`: nothing proves its prompt matches training.
    PromptUnchecked,
    /// `actions.json` cannot be acted on (§13.2, D54, D66, D67, D69): it is not
    /// used, the Pigeon presses nothing and is not played. The cause is one of
    /// `actions::Skip`'s.
    ActionsSkipped { cause: &'static str, why: String },
    /// A file the registry lists for this base is installed, and its own
    /// header says it is a different one. The entry (its id) is ignored for
    /// this check. D46.
    RegistryDisagrees(String),
}

impl Warning {
    pub fn code(&self) -> &'static str {
        match self {
            Warning::SameBaseOtherQuant { .. } => "same_base_other_quant",
            Warning::CardSkipped(_) => "card_skipped",
            Warning::TemperatureIgnored(_) => "temperature_ignored",
            Warning::UntrustedSeal(_) => "untrusted_seal",
            Warning::TrainedQuantized => "trained_quantized",
            Warning::PromptUnchecked => "prompt_unchecked",
            Warning::ActionsSkipped { .. } => "actions_skipped",
            Warning::RegistryDisagrees(_) => "registry_disagrees",
        }
    }

    /// What a host needs to word the warning its own way: the specific file,
    /// field or key, never a sentence.
    pub fn detail(&self) -> Value {
        match self {
            Warning::SameBaseOtherQuant { trained_on, have } => serde_json::json!({ "tested_on": trained_on, "here": have }),
            Warning::CardSkipped(field) => serde_json::json!({ "field": field }),
            Warning::TemperatureIgnored(t) => serde_json::json!({ "temperature": t }),
            Warning::UntrustedSeal(why) => serde_json::json!({ "why": why }),
            Warning::ActionsSkipped { cause, why } => serde_json::json!({ "cause": cause, "why": why }),
            Warning::RegistryDisagrees(entry) => serde_json::json!({ "entry": entry }),
            Warning::TrainedQuantized | Warning::PromptUnchecked => serde_json::json!({}),
        }
    }

    pub fn message(&self) -> String {
        match self {
            Warning::SameBaseOtherQuant { trained_on, have } if trained_on == have => format!(
                "trained against {have}; this machine has a file of that name and the same base, but not known to be the very file it was measured on — loads, but that is documented behavior"
            ),
            Warning::SameBaseOtherQuant { trained_on, have } => format!(
                "trained against {trained_on}; this machine has the same base as {have} — loads, but that is documented behavior, not the file it was measured on"
            ),
            Warning::CardSkipped(field) => format!("its card is not shown — {field} breaks the card rules"),
            Warning::TemperatureIgnored(t) => {
                format!("pigeon.json asks for temperature {t}, but its answers are checked exactly, so it runs at 0")
            }
            Warning::UntrustedSeal(why) => format!("{why} — it loads as an unsealed Pigeon"),
            Warning::TrainedQuantized => {
                "trained on a 4-bit model — it may answer worse here than its maker's score suggests".into()
            }
            Warning::PromptUnchecked => {
                "packed without a prompt check, so nothing proves it is asked the way it was trained".into()
            }
            Warning::ActionsSkipped { why, .. } => format!("its actions.json is not used, so it presses nothing and cannot play — {why}"),
            Warning::RegistryDisagrees(id) => format!(
                "the registry's entry \"{id}\" lists a file on this machine whose own header says it is a different model, so that entry was not used"
            ),
        }
    }
}

/// A successful check (§7.3 step 7).
#[derive(Debug, Clone, PartialEq)]
pub struct Report {
    pub manifest: Manifest,
    /// `None` when only the file was checked.
    pub base_match: Option<BaseMatch>,
    pub warnings: Vec<Warning>,
    /// The card, when there is one and it passes §11.
    pub card: Option<Value>,
    /// The temperature to run at, after §5.5.
    pub temperature: f64,
    pub self_test: SelfTest,
    /// The id of the trusted key that sealed this file. `None` unless a seal
    /// verified.
    pub sealed_by: Option<String>,
    /// `pigeon.json` exactly as the file wrote it, unknown fields included.
    pub manifest_json: Value,
    /// What it takes: `["text"]` or `["image", "text"]`.
    pub inputs: Vec<String>,
    /// How much of a conversation it is sent (§5.6). `shape` is `none` when
    /// the file says nothing.
    pub history: History,
    /// `actions.json`, when a picture Pigeon carries a readable one (§13.2).
    pub actions: Option<Value>,
    /// The installed base file that matched. `None` when only the file was
    /// checked.
    pub base_file: Option<String>,
}

/// What a host needs in order to offer a download and show the licence first
/// (spec §16.4), on `wrong_base`, `no_base` and `no_projector`. `file` and
/// `identity` are always there: the file missing — the base, or for
/// `no_projector` the projector — and the base's identity. The rest is filled
/// only when a trusted registry lists the base; `bytes` is that file's size
/// when the registry lists the file itself.
#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
pub struct Needs {
    pub file: String,
    pub identity: gguf::Identity,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub registry_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub license: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub license_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bytes: Option<u64>,
}

impl Needs {
    /// `entry` is the registry's entry for the Pigeon's base, when one is in
    /// use; `rows` its files, or its projectors.
    fn of(file: &str, identity: &gguf::Identity, entry: Option<&registry::Base>, projector: bool) -> Needs {
        let rows = entry.map(|b| if projector { &b.projectors } else { &b.files });
        Needs {
            file: file.to_string(),
            identity: identity.clone(),
            registry_id: entry.and_then(|b| b.id.clone()),
            license: entry.and_then(|b| b.license.clone()),
            license_url: entry.and_then(|b| b.license_url.clone()),
            bytes: rows.and_then(|rows| rows.iter().find(|r| r.file == file)).and_then(|r| r.bytes),
        }
    }
}

impl Report {
    /// The one warning a host MUST show (§16.4), as a sentence.
    pub fn base_warning(&self) -> Option<String> {
        self.warnings.iter().find(|w| matches!(w, Warning::SameBaseOtherQuant { .. })).map(Warning::message)
    }

    pub fn warning_codes(&self) -> Vec<&'static str> {
        self.warnings.iter().map(Warning::code).collect()
    }

    /// The report as JSON, for an engine to hand a host. `result`,
    /// `base_match`, `temperature` and `self_test` are the conformance kit's
    /// own; each warning is its code and its sentence.
    pub fn json(&self) -> Value {
        let warnings: Vec<Value> =
            self.warnings.iter().map(|w| serde_json::json!({ "code": w.code(), "message": w.message(), "detail": w.detail() })).collect();
        let mut history = serde_json::json!({ "shape": if self.history.shape.is_empty() { "none" } else { self.history.shape.as_str() } });
        if let Some(turns) = self.history.max_turns {
            history["max_turns"] = turns.into();
        }
        serde_json::json!({
            "result": "accepted",
            "base_match": self.base_match,
            "warnings": warnings,
            "manifest": self.manifest_json,
            "card": self.card,
            "temperature": self.temperature,
            "self_test": self.self_test,
            "sealed_by": self.sealed_by,
            "inputs": self.inputs,
            "history": history,
            "actions": self.actions,
            "base": self.base_file.as_ref().map(|file| serde_json::json!({ "file": file })),
        })
    }
}

/// Every distinct way a file is refused, each naming exactly what failed
/// rather than a generic message. `code()` is the spec's stable code;
/// `message()` is the friendly text.
#[derive(Debug, Clone, PartialEq)]
pub enum Refused {
    /// Not a ZIP archive at all (why).
    NotAZip(String),
    /// A ZIP that breaks a strict rule of §3.2 (the rule).
    BadZip(String),
    NoManifest,
    /// `pigeon.json` is not valid JSON, or a field has the wrong type or value.
    BadManifest(String),
    /// A required field is absent (its name).
    MissingField(String),
    NewerFormat { found: u64, supported: u64 },
    TemplateMissingInputSlot,
    UnknownKind(String),
    /// A known kind this reader does not run. For a skill pack, `sealed_by` is
    /// the trusted key that sealed it — a host with its own skill-pack runtime
    /// takes it from there — and `pack_needs` the Pigeons it asks (D90).
    UnsupportedKind { kind: String, sealed_by: Option<String>, pack_needs: Option<Vec<String>> },
    /// D91: host values for fields the file's `host_values` does not name.
    HostValuesUnnamed(String),
    UnknownOutputType(String),
    MaterialSlotMissing,
    MaterialSlotOnWrongKind(String),
    UnknownRetrieval(String),
    NoSections,
    /// `hybrid-v1` whose vectors were made with a model this machine does not
    /// hold (its file name).
    EmbeddingModel(String),
    BadPayload(String),
    /// A skill drawn by a method this reader cannot perform (why).
    UnknownRender(String),
    MissingRequiredFile { kind: String, file: String },
    /// The adapter is not a GGUF LoRA adapter (why).
    NotALora(String),
    /// Bases are installed, but none has the same identity.
    WrongBase(Needs),
    /// No bases at all: the same refusal, a different reason.
    NoBaseInstalled(Needs),
    /// A `code/` entry in a Pigeon whose kind is not `skillpack` (the kind).
    CodeInWrongKind(String),
    /// A `seal.json` that is present and malformed, or does not verify (why).
    BrokenSeal(String),
    /// A seal by a key the host does not trust, where trust is required (why).
    UntrustedSeal(String),
    /// A skill pack with no seal at all.
    CodeWithoutSeal,
    /// A picture Pigeon that does not say which projector it was trained with,
    /// by hash — without one, a mismatched projector would load and answer
    /// wrong without any error.
    ProjectorUnnamed,
    /// The carried `projector.gguf` does not hash to `mmproj.sha256`.
    ProjectorMismatch,
    /// No projector with `mmproj.sha256` is carried or available.
    NoProjector(Needs),
    /// An `id` that is not one plain file-name component.
    BadId(String),
    /// The Runner's prompt for `prompt_check.input` differs from `canonical`,
    /// first at this byte (§8.6).
    PromptMismatch { at: usize },
    /// A ZIP of Pigeons without `nest.json` (§14).
    NotANest,
}

fn identity_words(i: &gguf::Identity) -> String {
    let mut parts = vec![i.arch.as_str(), i.name.as_str(), i.size.as_str()];
    if let Some(f) = i.finetune.as_deref() {
        parts.push(f);
    }
    parts.into_iter().filter(|p| !p.is_empty()).collect::<Vec<_>>().join(", ")
}

impl Refused {
    /// The stable machine-readable code (spec Appendix A.1).
    pub fn code(&self) -> &'static str {
        match self {
            Refused::NotAZip(_) => "not_a_zip",
            Refused::BadZip(_) => "bad_zip",
            Refused::NoManifest => "no_manifest",
            Refused::BadManifest(_) => "bad_manifest",
            Refused::MissingField(_) => "missing_field",
            Refused::NewerFormat { .. } => "newer_format",
            Refused::TemplateMissingInputSlot => "template_missing_input",
            Refused::UnknownKind(_) => "unknown_kind",
            Refused::UnsupportedKind { .. } => "unsupported_kind",
            Refused::UnknownOutputType(_) => "unknown_output_type",
            Refused::MaterialSlotMissing => "material_slot_missing",
            Refused::MaterialSlotOnWrongKind(_) => "material_slot_on_wrong_kind",
            Refused::UnknownRetrieval(_) => "unknown_retrieval",
            Refused::NoSections => "no_sections",
            Refused::EmbeddingModel(_) => "embedding_model_mismatch",
            Refused::BadPayload(_) => "bad_payload",
            Refused::UnknownRender(_) => "unknown_render",
            Refused::MissingRequiredFile { .. } => "missing_required_file",
            Refused::NotALora(_) => "not_a_lora",
            Refused::WrongBase { .. } => "wrong_base",
            Refused::NoBaseInstalled { .. } => "no_base",
            Refused::CodeInWrongKind(_) => "code_in_wrong_kind",
            Refused::BrokenSeal(_) => "broken_seal",
            Refused::UntrustedSeal(_) => "untrusted_seal",
            Refused::CodeWithoutSeal => "code_without_seal",
            Refused::ProjectorUnnamed => "projector_unnamed",
            Refused::ProjectorMismatch => "projector_mismatch",
            Refused::NoProjector(_) => "no_projector",
            Refused::BadId(_) => "bad_id",
            Refused::PromptMismatch { .. } => "prompt_mismatch",
            Refused::NotANest => "not_a_nest",
            Refused::HostValuesUnnamed(_) => "host_values_unnamed",
        }
    }

    pub fn message(&self) -> String {
        match self {
            Refused::NotAZip(e) | Refused::BadZip(e) => format!("not a valid .pigeon file — {e}"),
            Refused::NoManifest => "not a valid .pigeon file — no pigeon.json at the root".into(),
            Refused::BadManifest(e) => format!("pigeon.json could not be read — {e}"),
            Refused::MissingField(field) => format!("pigeon.json could not be read — it has no {field}"),
            Refused::NewerFormat { found, supported } => format!(
                "this Pigeon was packed in a newer format (v{found}) than this app reads (v{supported}) — update the app"
            ),
            Refused::TemplateMissingInputSlot => "pigeon.json's prompt_template has no {input} slot".into(),
            Refused::UnknownKind(kind) => format!(
                "this is a \"{kind}\" Pigeon, and this app only knows {} — update the app",
                KINDS.join(", ")
            ),
            Refused::UnsupportedKind { kind, sealed_by: Some(key), .. } if kind == SKILLPACK => {
                format!("this is a skill pack sealed by {key} — a skill pack is imported as Patch, not as a Pigeon")
            }
            Refused::UnsupportedKind { kind, .. } => format!("this is a \"{kind}\" Pigeon, which this app does not run"),
            Refused::UnknownOutputType(t) => format!(
                "this Pigeon answers with \"{t}\", and this app only knows {} — update the app",
                OUTPUT_TYPES.join(", ")
            ),
            Refused::MaterialSlotMissing => {
                "a grounded Pigeon needs {material} in its prompt_template — that slot is where its material goes".into()
            }
            Refused::MaterialSlotOnWrongKind(kind) => format!(
                "prompt_template has a {{material}} slot, but a {kind} Pigeon carries no material to put there"
            ),
            Refused::UnknownRetrieval(method) => format!(
                "this Pigeon finds its material with \"{method}\", which this app cannot do (it knows {}) — update the app",
                material::RETRIEVALS.join(", ")
            ),
            Refused::NoSections => "material.sections must say how many sections the material has, and at least one".into(),
            Refused::EmbeddingModel(file) => format!(
                "this Pigeon's material was embedded with \"{file}\", which is not the embedding model this app carries — update the app"
            ),
            Refused::BadPayload(e) | Refused::UnknownRender(e) | Refused::NotALora(e) => e.clone(),
            Refused::ProjectorUnnamed => {
                "this Pigeon sees pictures, but pigeon.json does not name its projector's sha256 — pack it again with Flight School".into()
            }
            Refused::ProjectorMismatch => {
                "this Pigeon carries a projector that is not the one it was trained with — the file is damaged or was repacked wrong".into()
            }
            Refused::NoProjector(needs) => format!(
                "this Pigeon sees pictures through {}, and this machine does not have it — download the picture model first",
                needs.file
            ),
            Refused::BadId(id) => format!(
                "pigeon.json's id is \"{}\", and an id must be a plain name — letters, digits, dashes, dots and spaces, nothing that looks like a path",
                id.chars().take(60).collect::<String>()
            ),
            Refused::MissingRequiredFile { kind, file } => {
                format!("a {kind} Pigeon needs {file}, and this one does not have it")
            }
            Refused::WrongBase(needs) => format!(
                "needs the base it was trained on — {} ({}) — and this machine has a different one. It will not load onto a different base; download that model first.",
                needs.file,
                identity_words(&needs.identity)
            ),
            Refused::NoBaseInstalled(needs) => format!(
                "needs the base it was trained on — {} ({}) — and this machine does not have it. It will not load onto a different base; download that model first.",
                needs.file,
                identity_words(&needs.identity)
            ),
            Refused::CodeInWrongKind(kind) => format!(
                "this {} Pigeon carries code, and only a sealed skill pack may — it was not loaded",
                if kind.is_empty() { "untyped" } else { kind.as_str() }
            ),
            Refused::BrokenSeal(why) => format!("this Pigeon's seal is broken, so it was not loaded — {why}"),
            Refused::UntrustedSeal(why) => format!("this skill pack was not loaded — {why}"),
            Refused::CodeWithoutSeal => {
                "this skill pack is not sealed, and a skill pack carries code — it was not loaded".into()
            }
            Refused::PromptMismatch { at } => format!(
                "this Pigeon would not be asked the way it was trained — the prompt differs from its own check at byte {at} — so it was not run"
            ),
            Refused::NotANest => "this is not a nest — a nest holds a readable nest.json and at least one .pigeon".into(),
            Refused::HostValuesUnnamed(f) => format!("values were sent for {f}, which this Pigeon does not take from the host — it was not asked"),
        }
    }
}

impl Refused {
    /// What to fetch, on the three refusals a download can cure.
    pub fn needs(&self) -> Option<&Needs> {
        match self {
            Refused::WrongBase(n) | Refused::NoBaseInstalled(n) | Refused::NoProjector(n) => Some(n),
            _ => None,
        }
    }

    /// The refusal as JSON: its code, its sentence, and `needs` where it has one.
    pub fn json(&self) -> Value {
        let mut out = serde_json::json!({ "result": "refused", "code": self.code(), "message": self.message() });
        if let Some(needs) = self.needs() {
            out["needs"] = serde_json::to_value(needs).unwrap_or(Value::Null);
        }
        if let Refused::PromptMismatch { at } = self {
            out["position"] = (*at).into();
        }
        if let Refused::UnsupportedKind { pack_needs: Some(ids), .. } = self {
            out["pack_needs"] = ids.clone().into();
        }
        out
    }
}

/// The file a `kind` requires beyond `pigeon.json` and the adapter, if any.
fn required_file_for_kind(kind: &str) -> Option<&'static str> {
    match kind {
        "classifier" | "router" => Some("labels.txt"),
        "persona" => Some("system_prompt.txt"),
        // Not an optional extra: the material is where every answer comes from.
        "grounded" => Some(MATERIAL_FILE),
        _ => None,
    }
}

fn present<'a>(m: &'a Map<String, Value>, key: &str, at: &str) -> Result<&'a Value, Refused> {
    match m.get(key) {
        None | Some(Value::Null) => Err(Refused::MissingField(format!("{at}{key}"))),
        Some(v) => Ok(v),
    }
}

fn wrong_type(key: &str, at: &str, want: &str) -> Refused {
    Refused::BadManifest(format!("{at}{key} must be {want}"))
}

fn need_str<'a>(m: &'a Map<String, Value>, key: &str, at: &str) -> Result<&'a str, Refused> {
    present(m, key, at)?.as_str().ok_or_else(|| wrong_type(key, at, "text"))
}

fn need_obj<'a>(m: &'a Map<String, Value>, key: &str, at: &str) -> Result<&'a Map<String, Value>, Refused> {
    present(m, key, at)?.as_object().ok_or_else(|| wrong_type(key, at, "an object"))
}

fn need_int(m: &Map<String, Value>, key: &str, at: &str) -> Result<i64, Refused> {
    let v = present(m, key, at)?;
    if v.is_u64() && v.as_i64().is_none() {
        return Ok(i64::MAX);
    }
    v.as_i64().filter(|_| v.is_i64() || v.is_u64()).ok_or_else(|| wrong_type(key, at, "a whole number"))
}

/// A carried adapter must open as GGUF here before any engine is pointed at
/// it, and must say it is a LoRA adapter — an adapter that calls itself a
/// model is refused by name.
fn adapter_ok(bytes: &[u8]) -> Result<(), String> {
    let file = ADAPTER_FILE;
    let kv = gguf::read_header(bytes).map_err(|e| format!("{file} is not a GGUF file this app can read — {e}"))?;
    let stated = kv.get("general.type").and_then(gguf::Value::as_str);
    if let Some(t) = stated.filter(|t| *t != "adapter") {
        return Err(format!("{file} says it is a {t} and a Pigeon's adapter must be an adapter"));
    }
    if kv.get("adapter.type").and_then(gguf::Value::as_str) != Some("lora") {
        return Err(format!("{file} is not a LoRA adapter, and that is the only kind this app loads"));
    }
    Ok(())
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    seal::to_hex(&Sha256::digest(bytes))
}

/// The import check, §7.3 steps 1–7.
pub fn check(bytes: &[u8], host: &Host) -> Result<Report, Refused> {
    let entries = list(bytes)?;
    check_entries(&entries, bytes, host)
}

/// Step 1's first half: a strict ZIP, or which of the two refusals it is.
pub fn list(bytes: &[u8]) -> Result<Vec<zip_store::Entry>, Refused> {
    zip_store::list_entries(bytes).map_err(|e| if zip_store::has_end_record(bytes) { Refused::BadZip(e) } else { Refused::NotAZip(e) })
}

/// `check`, against a directory the caller already listed — so a single
/// import does not re-parse the ZIP's central directory to ask the same
/// question twice.
pub fn check_entries(entries: &[zip_store::Entry], bytes: &[u8], host: &Host) -> Result<Report, Refused> {
    let get = |name: &str| zip_store::get(entries, bytes, name).map_err(Refused::BadZip);
    let has = |name: &str| entries.iter().any(|e| e.name == name);
    let mut warnings: Vec<Warning> = Vec::new();

    // 1. Container.
    let manifest_bytes = get(MANIFEST_FILE)?.ok_or(Refused::NoManifest)?;
    let value: Value = serde_json::from_slice(manifest_bytes).map_err(|e| Refused::BadManifest(e.to_string()))?;
    let m = value.as_object().ok_or_else(|| Refused::BadManifest("it is not a JSON object".into()))?;

    // 2. Version.
    let found = need_int(m, "format_version", "")?;
    if found > SUPPORTED_FORMAT_VERSION as i64 {
        return Err(Refused::NewerFormat { found: found as u64, supported: SUPPORTED_FORMAT_VERSION });
    }

    /* 3. Code and seal, before the manifest is read as a Pigeon: `code/`
       belongs to a skill pack alone, a seal that is present must verify
       whatever the kind, and a skill pack must be sealed by a key the host
       trusts — and is then not this reader's to run. */
    let kind = m.get("kind").and_then(Value::as_str).unwrap_or_default();
    if kind != SKILLPACK && entries.iter().any(|e| e.name.starts_with("code/")) {
        return Err(Refused::CodeInWrongKind(kind.to_string()));
    }
    let sealed_by = match seal::check(entries, bytes, host.trust.pigeons).map_err(Refused::BrokenSeal)? {
        seal::Sealed::No if kind == SKILLPACK => return Err(Refused::CodeWithoutSeal),
        seal::Sealed::Untrusted { why, .. } if kind == SKILLPACK => return Err(Refused::UntrustedSeal(why)),
        seal::Sealed::By(key) if kind == SKILLPACK => {
            /* D90: refused as a kind, its list of Pigeons still read, so a host
               can say what the pack would have asked. Only a list of plain ids. */
            let pack_needs = m.get("needs").and_then(Value::as_array).and_then(|a| {
                a.iter().map(|v| v.as_str().filter(|id| manifest::plain_id(id)).map(String::from)).collect::<Option<Vec<_>>>()
            });
            return Err(Refused::UnsupportedKind { kind: kind.to_string(), sealed_by: Some(key), pack_needs });
        }
        seal::Sealed::No => None,
        seal::Sealed::Untrusted { why, .. } => {
            warnings.push(Warning::UntrustedSeal(why));
            None
        }
        seal::Sealed::By(key) => Some(key),
    };

    // 4. Fields.
    need_str(m, "name", "")?;
    let id = need_str(m, "id", "")?;
    if !manifest::plain_id(id) {
        return Err(Refused::BadId(id.to_string()));
    }
    let kind = need_str(m, "kind", "")?;
    if !KINDS.contains(&kind) {
        return Err(Refused::UnknownKind(kind.to_string()));
    }
    let base = need_obj(m, "base_model", "")?;
    for key in ["file", "arch", "name", "size"] {
        need_str(base, key, "base_model.")?;
    }
    // D83: a base Pigeon carries no trained weights.
    let base_only = match m.get("base_only") {
        None | Some(Value::Null) => false,
        Some(Value::Bool(b)) => *b,
        Some(_) => return Err(Refused::BadManifest("base_only must be true or false".into())),
    };
    let template = need_str(m, "prompt_template", "")?;
    let contract = need_obj(m, "output_contract", "")?;
    let output_type = need_str(contract, "type", "output_contract.")?;
    need_int(contract, "max_tokens", "output_contract.")?;
    let inputs = present(m, "inputs", "")?.as_array().ok_or_else(|| wrong_type("inputs", "", "a list"))?;
    if !template.contains(material::INPUT_SLOT) {
        return Err(Refused::TemplateMissingInputSlot);
    }
    if !OUTPUT_TYPES.contains(&output_type) {
        return Err(Refused::UnknownOutputType(output_type.to_string()));
    }
    let inner = contract.get("answer").filter(|v| !v.is_null());
    let inner_ok = inner.and_then(Value::as_str).is_some_and(|a| a == "label" || a == "json");
    if (output_type == "reasoned") != inner.is_some() || (inner.is_some() && !inner_ok) {
        return Err(Refused::BadManifest("output_contract.answer goes with a reasoned answer, and is label or json".into()));
    }
    // The type the checked answer has.
    let exact = inner.and_then(Value::as_str).unwrap_or(output_type);
    // D56: a router names where to send the input, so it answers with a label too.
    if matches!(kind, "classifier" | "router") && exact != "label" {
        return Err(Refused::BadManifest(format!("a {kind} answers with a label")));
    }
    match contract.get("constrained") {
        None | Some(Value::Bool(false)) => {}
        Some(Value::Bool(true)) if output_type != "text" => {}
        Some(Value::Bool(true)) => {
            return Err(Refused::BadManifest("output_contract.constrained cannot be set on a text answer".into()))
        }
        Some(_) => return Err(Refused::BadManifest("output_contract.constrained must be true or false".into())),
    }
    // D86, D88: values the host supplies per ask, and the schema they sit in.
    let constrained = contract.get("constrained") == Some(&Value::Bool(true));
    let host_values: Vec<&str> = match contract.get("host_values") {
        None | Some(Value::Null) => Vec::new(),
        Some(Value::Array(a)) => a
            .iter()
            .map(Value::as_str)
            .collect::<Option<Vec<_>>>()
            .ok_or_else(|| Refused::BadManifest("output_contract.host_values must be a list of field names".into()))?,
        Some(_) => return Err(Refused::BadManifest("output_contract.host_values must be a list of field names".into())),
    };
    let schema = contract.get("output_schema").filter(|s| !s.is_null());
    if let Some(s) = schema {
        if !s.is_object() {
            return Err(Refused::BadManifest("output_contract.output_schema must be a JSON Schema object".into()));
        }
        if exact != "json" {
            return Err(Refused::BadManifest("output_contract.output_schema goes with a json answer".into()));
        }
    }
    if !host_values.is_empty() && !constrained {
        return Err(Refused::BadManifest("output_contract.host_values needs a constrained answer".into()));
    }
    for field in &host_values {
        let named = match exact {
            "label" => *field == crate::values::LABEL,
            "json" => schema.is_some_and(|s| crate::values::field(s, field).is_some()),
            _ => false,
        };
        if !named {
            return Err(Refused::BadManifest(format!("output_contract.host_values names {field}, which is not a field of this answer")));
        }
    }
    let mut temperature = match m.get("temperature") {
        None => 0.0,
        Some(t) => t
            .as_f64()
            .filter(|t| (0.0..=2.0).contains(t))
            .ok_or_else(|| Refused::BadManifest("temperature must be a number from 0 to 2".into()))?,
    };
    if output_type != "text" && temperature > 0.0 {
        warnings.push(Warning::TemperatureIgnored(temperature));
        temperature = 0.0;
    }
    if let Some(history) = m.get("history").filter(|h| !h.is_null()) {
        match history.get("shape").and_then(Value::as_str) {
            Some("none") => {}
            Some("as_sent") => {
                let turns = history.get("max_turns");
                if !turns.is_some_and(|t| (t.is_i64() || t.is_u64()) && t.as_i64().is_none_or(|n| n >= 1)) {
                    return Err(Refused::BadManifest("history.max_turns must be a whole number, at least 1".into()));
                }
                if output_type != "text" || kind == "grounded" {
                    return Err(Refused::BadManifest(
                        "history as_sent needs a text answer and a kind other than grounded".into(),
                    ));
                }
            }
            _ => return Err(Refused::BadManifest("history.shape must be none or as_sent".into())),
        }
    }
    let prompt_check = m.get("prompt_check").filter(|p| !p.is_null());
    match prompt_check {
        None => warnings.push(Warning::PromptUnchecked),
        Some(pc) if pc.get("canonical").is_some_and(Value::is_string) && pc.get("input").is_some() => {}
        Some(_) => return Err(Refused::BadManifest("prompt_check must hold an input and its canonical prompt".into())),
    }
    // §8.6: the picture `prompt_check` names must be in the file.
    let check_picture = prompt_check.and_then(|pc| pc.get("input")).and_then(|i| i.as_object()).and_then(|i| i.get("image")).filter(|i| !i.is_null());
    let shown_card = match m.get("card") {
        None => None,
        Some(c) => match card::problem(c) {
            None => Some(c.clone()),
            Some(field) => {
                warnings.push(Warning::CardSkipped(field));
                None
            }
        },
    };
    let manifest: Manifest = serde_json::from_value(value.clone()).map_err(|e| Refused::BadManifest(e.to_string()))?;

    // 5. Files by kind.
    let grounded = kind == "grounded";
    let retrieval = m.get("material").and_then(|x| x.get("retrieval")).and_then(Value::as_str);
    /* D83: with base_only the adapter MUST be absent. Without it, a missing
       adapter stays `missing_required_file`, as the kit's `files/no-adapter`
       case says (the spec's "bad_manifest either way round" is raised with
       Kevin; the kit wins until he decides). */
    if base_only && has(ADAPTER_FILE) {
        return Err(Refused::BadManifest(format!("a base Pigeon (base_only) carries no {ADAPTER_FILE}")));
    }
    let mut needed: Vec<String> = if base_only { Vec::new() } else { vec![ADAPTER_FILE.into()] };
    needed.extend(required_file_for_kind(kind).map(String::from));
    if manifest.skill.is_some() {
        needed.push(skill::PAYLOAD_FILE.into());
    }
    if grounded && retrieval == Some("hybrid-v1") {
        needed.push(material::EMBEDDINGS_FILE.into());
    }
    if let Some(picture) = check_picture {
        needed.push(picture.as_str().map(String::from).unwrap_or_else(|| picture.to_string()));
    }
    if let Some(file) = needed.into_iter().find(|f| !has(f)) {
        return Err(Refused::MissingRequiredFile { kind: kind.to_string(), file });
    }
    if !base_only {
        adapter_ok(get(ADAPTER_FILE)?.unwrap_or_default()).map_err(Refused::NotALora)?;
    }
    if has(ask::SHOTS_FILE) {
        ask::parse_shots(get(ask::SHOTS_FILE)?.unwrap_or_default()).map_err(Refused::BadPayload)?;
    }

    /* §9.1: the slot and the kind imply each other, both ways. Either failure
       is silent at run time — an empty slot, or the literal text "{material}"
       sent to the model — so both are refused here. */
    let has_slot = template.contains(material::MATERIAL_SLOT);
    if grounded {
        if !has_slot {
            return Err(Refused::MaterialSlotMissing);
        }
        let spec = need_obj(m, "material", "")?;
        let retrieval = retrieval.unwrap_or_default();
        if !material::RETRIEVALS.contains(&retrieval) {
            return Err(Refused::UnknownRetrieval(retrieval.to_string()));
        }
        if !spec.get("sections").is_some_and(|s| (s.is_i64() || s.is_u64()) && s.as_i64().is_none_or(|n| n >= 1)) {
            return Err(Refused::NoSections);
        }
        let index = match serde_json::from_slice::<material::ChunkIndex>(get(MATERIAL_FILE)?.unwrap_or_default()) {
            Ok(index) if !index.chunks.is_empty() => index,
            Ok(_) => return Err(Refused::BadPayload(format!("{MATERIAL_FILE} has no sections in it"))),
            Err(e) => return Err(Refused::BadPayload(format!("{MATERIAL_FILE} could not be read — {e}"))),
        };
        /* hybrid-v1 (§9.4): the vectors must be in the file, made from these
           sections, and searched with the model they were made with — the
           second pinned identity, where the hash is the rule. */
        if retrieval == "hybrid-v1" {
            let e = material::Embeddings::parse(get(material::EMBEDDINGS_FILE)?.unwrap_or_default()).map_err(Refused::BadPayload)?;
            e.check_sections(&index).map_err(Refused::BadPayload)?;
            if let Some(machine) = &host.machine {
                let Some(ours) = machine.embedders.iter().find(|x| x.sha256 == e.model.sha256) else {
                    return Err(Refused::EmbeddingModel(e.model.file.clone()));
                };
                e.check_model(ours.dims, ours.query_prefix.as_deref()).map_err(Refused::BadPayload)?;
            }
        }
    } else if has_slot {
        return Err(Refused::MaterialSlotOnWrongKind(kind.to_string()));
    }

    /* §10.3: a skill is accepted by how it is drawn, not by its name. Its parts
       table must be in the file, be the skill the manifest names, and be drawn
       by a method this reader performs — a method it cannot is refused by
       name, because drawing the wrong way makes a well-formed picture of the
       wrong thing. */
    if let Some(s) = &manifest.skill {
        let raw = get(skill::PAYLOAD_FILE)?.unwrap_or_default();
        skill::Payload::parse_coded(raw, &s.name, manifest.skill_version())
            .map_err(|t| if t.render { Refused::UnknownRender(t.why) } else { Refused::BadPayload(t.why) })?;
    }

    /* §13.1: a picture Pigeon names its projector by hash. It carries the
       projector only when nobody else has it; carried bytes must BE that
       hash, since a projector that differs from the one the adapter learned
       with loads without complaint and answers wrong. */
    let pictures = inputs.iter().any(|i| i.as_str() == Some("image"));
    let mut projector_sha = "";
    if pictures {
        if manifest.trained_from.as_ref().and_then(|t| t.precision.as_deref()) == Some("4bit") {
            warnings.push(Warning::TrainedQuantized);
        }
        projector_sha = manifest.base_model.mmproj.as_ref().and_then(|p| p.sha256.as_deref()).map(str::trim).unwrap_or_default();
        if projector_sha.is_empty() {
            return Err(Refused::ProjectorUnnamed);
        }
        if let Some(carried) = get(PROJECTOR_FILE)? {
            if sha256_hex(carried) != projector_sha {
                return Err(Refused::ProjectorMismatch);
            }
            /* D57: the right hash is not enough. A carried projector goes to an
               engine that parses it in native code, so bytes that are not even
               a GGUF are refused before anything is written or loaded. */
            gguf::read_header(carried)
                .map_err(|e| Refused::BadPayload(format!("{PROJECTOR_FILE} is not a GGUF file this app can read — {e}")))?;
        }
    }

    /* §13.2: what a picture Pigeon presses. Optional, and never a reason to
       refuse: one that cannot be read, or that sits in a Pigeon that takes no
       pictures, is left out with a warning, and nothing is pressed. */
    let mut carried_actions = None;
    if let Some(raw) = get(actions::ACTIONS_FILE)? {
        match actions::usable(raw, pictures) {
            Ok(a) => carried_actions = Some(a),
            Err(skip) => warnings.push(Warning::ActionsSkipped { cause: skip.cause, why: skip.why }),
        }
    }

    // 6. The base. The hash is never the refusal rule; identity is.
    let mut base_match = None;
    let mut base_file = None;
    if let Some(machine) = &host.machine {
        let spec = &manifest.base_model;
        let needed = spec.identity();
        /* The registry's entry for this Pigeon's base, if a trusted registry
           has one. A file the entry lists by hash must really be that base:
           when one installed here says otherwise in its own header, the entry
           is ignored for this check, and the host is told (§7.4, D46). */
        let mut entry = registry::base_for(host.registries, &needed);
        if let Some(e) = entry {
            let lists = |sha: &str| e.files.iter().any(|f| f.sha256 == sha);
            if machine.bases.iter().any(|b| b.sha256.as_deref().is_some_and(lists) && !e.is_header(&b.identity)) {
                warnings.push(Warning::RegistryDisagrees(e.id.clone().unwrap_or_default()));
                entry = None;
            }
        }
        if machine.bases.is_empty() {
            return Err(Refused::NoBaseInstalled(Needs::of(&spec.file, &needed, entry, false)));
        }
        let exact = spec.sha256.as_deref().filter(|s| !s.is_empty()).is_some_and(|sha| {
            machine.bases.iter().any(|b| b.file == spec.file && b.sha256.as_deref() == Some(sha))
        });
        if exact {
            base_match = Some(BaseMatch::Exact);
            base_file = Some(spec.file.clone());
        } else if let Some(b) = machine.bases.iter().find(|b| gguf::same_base(&needed, &b.identity) || entry.is_some_and(|e| e.is_header(&b.identity))) {
            base_match = Some(BaseMatch::SameBaseOtherQuant);
            base_file = Some(b.file.clone());
            warnings.push(Warning::SameBaseOtherQuant { trained_on: spec.file.clone(), have: b.file.clone() });
        } else {
            return Err(Refused::WrongBase(Needs::of(&spec.file, &needed, entry, false)));
        }
        let listed = || entry.is_some_and(|b| b.projectors.iter().any(|p| p.sha256 == projector_sha));
        if pictures && !has(PROJECTOR_FILE) && !machine.projectors.iter().any(|p| p == projector_sha) && !listed() {
            let file = spec.mmproj.as_ref().map(|p| p.file.clone()).unwrap_or_default();
            return Err(Refused::NoProjector(Needs::of(&file, &needed, entry, true)));
        }
    }

    // 7. Result.
    let self_test = if matches!(kind, "classifier" | "router") || exact == "label" || (exact == "json" && manifest.skill.is_some()) {
        SelfTest::Verdict
    } else {
        SelfTest::Samples
    };
    let inputs = manifest.declared_inputs();
    let history = manifest.history.clone().unwrap_or_default();
    Ok(Report {
        manifest,
        base_match,
        warnings,
        card: shown_card,
        temperature,
        self_test,
        sealed_by,
        manifest_json: value.clone(),
        inputs,
        history,
        actions: carried_actions,
        base_file,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::gguf::test_support::lora_bytes;
    use crate::zip_store::test_support::build_store_zip;

    const MANIFEST: &str = r#"{"format_version":1,"name":"Key presser","id":"key-presser","kind":"classifier",
        "base_model":{"file":"VL-Q4.gguf","sha256":"aa","arch":"qwen3vl","name":"qwen3vl","size":"2B","finetune":"instruct",
                      "mmproj":{"file":"mmproj.gguf","sha256":"pp"}},
        "prompt_template":"{image}\n{input}","inputs":["image","text"],
        "output_contract":{"type":"label","max_tokens":8},"made_up_field":{"kept":true}}"#;
    const ACTIONS: &[u8] = br#"{"format_version":1,"keys":{"Up":{"code":126}},"question":"What next?","frames":{"stack":1,"gap_ms":250,"max_side":768}}"#;

    fn base(file: &str, sha: Option<&str>) -> InstalledBase {
        let identity = gguf::Identity { arch: "qwen3vl".into(), name: "qwen3vl".into(), size: "2B".into(), finetune: Some("instruct".into()) };
        InstalledBase { file: file.into(), identity, sha256: sha.map(String::from) }
    }

    fn pigeon(actions: &[u8]) -> Vec<u8> {
        build_store_zip(&[(MANIFEST_FILE, MANIFEST.as_bytes()), (ADAPTER_FILE, &lora_bytes()), ("labels.txt", b"KEY(Up)\n"), (actions::ACTIONS_FILE, actions)])
    }

    #[test]
    fn the_report_carries_what_an_engine_hands_a_host() {
        let (bases, projectors) = ([base("VL-Q8.gguf", None)], ["pp".to_string()]);
        let host = Host { machine: Some(Machine { bases: &bases, projectors: &projectors, embedders: &[] }), ..Default::default() };
        let report = check(&pigeon(ACTIONS), &host).expect("loads");
        let json = report.json();
        assert_eq!(json["manifest"]["made_up_field"]["kept"], true, "the manifest comes back as the file wrote it");
        assert_eq!(json["inputs"], serde_json::json!(["image", "text"]));
        assert_eq!(json["history"], serde_json::json!({ "shape": "none" }));
        assert_eq!(json["actions"]["question"], "What next?");
        assert_eq!(json["base"], serde_json::json!({ "file": "VL-Q8.gguf" }), "the file that matched, not the one named");
        assert_eq!(json["warnings"][0]["code"], "prompt_unchecked");
        assert!(json["warnings"][0]["detail"].is_object());
        assert!(json["warnings"][0]["message"].is_string());
        // An actions.json nobody can act on is left out, with a warning (D54).
        let skipped = check(&pigeon(b"[]"), &host).expect("still loads");
        assert!(skipped.actions.is_none() && skipped.warning_codes().contains(&"actions_skipped"));
        assert_eq!(skipped.json()["warnings"].as_array().unwrap().iter().find(|w| w["code"] == "actions_skipped").unwrap()["detail"]["cause"], "unreadable");
        // D66, D67, D69: what cannot be followed is skipped by cause, and never played.
        let cause = |raw: &[u8]| {
            let r = check(&pigeon(raw), &host).expect("still loads");
            assert!(r.actions.is_none());
            r.warnings.iter().find_map(|w| match w { Warning::ActionsSkipped { cause, .. } => Some(*cause), _ => None }).unwrap()
        };
        assert_eq!(cause(br#"{"format_version":1}"#), "no_frames");
        assert_eq!(cause(br#"{"frames":{"stack":1,"max_side":768}}"#), "no_version");
        assert_eq!(cause(br#"{"format_version":2,"frames":{"stack":1,"max_side":768}}"#), "newer");
        assert_eq!(cause(br#"{"format_version":1,"frames":{"stack":1,"max_side":32}}"#), "max_side");
        // No `keys` is an empty list of keys, not a broken file.
        let keyless = check(&pigeon(br#"{"format_version":1,"question":"What next?","frames":{"stack":1,"max_side":768}}"#), &host).expect("loads");
        assert!(keyless.actions.is_some() && !keyless.warning_codes().contains(&"actions_skipped"));
    }

    #[test]
    fn a_base_pigeon_carries_no_adapter_and_nothing_else_changes() {
        // D83. Pen's shape: a persona with its system prompt and no weights.
        let pen = r#"{"format_version":1,"name":"Pen","id":"pen","kind":"persona","base_only":true,
            "base_model":{"file":"VL-Q4.gguf","sha256":"aa","arch":"qwen3vl","name":"qwen3vl","size":"2B","finetune":"instruct"},
            "prompt_template":"{input}","inputs":["text"],"output_contract":{"type":"text","max_tokens":400}}"#;
        let lora = lora_bytes();
        let file = |m: &str, adapter: bool| {
            let mut entries: Vec<(&str, &[u8])> = vec![(MANIFEST_FILE, m.as_bytes()), ("system_prompt.txt", b"You write.")];
            if adapter {
                entries.push((ADAPTER_FILE, &lora));
            }
            build_store_zip(&entries)
        };
        let host = Host::default();
        let report = check(&file(pen, false), &host).expect("a base Pigeon loads with no adapter");
        assert!(report.manifest.base_only);
        // With base_only, an adapter is refused.
        assert_eq!(check(&file(pen, true), &host).unwrap_err().code(), "bad_manifest");
        // Without it, a missing adapter is what it always was (kit files/no-adapter).
        let plain = pen.replace(r#""base_only":true,"#, "");
        assert_eq!(check(&file(&plain, false), &host).unwrap_err().code(), "missing_required_file");
        assert!(!check(&file(&plain, true), &host).expect("an ordinary persona").manifest.base_only);
        assert_eq!(check(&file(&pen.replace("\"base_only\":true", "\"base_only\":\"yes\""), false), &host).unwrap_err().code(), "bad_manifest");
        // The kind's own rules still hold: a base persona still needs its system prompt.
        let bare = build_store_zip(&[(MANIFEST_FILE, pen.as_bytes())]);
        assert_eq!(check(&bare, &host).unwrap_err().code(), "missing_required_file");
    }

    #[test]
    fn host_values_name_fields_of_the_files_own_schema() {
        // D86, D88: the planner's shape, as a base Pigeon.
        let plan = |contract: &str| {
            let m = format!(r#"{{"format_version":1,"name":"Planner","id":"patch-planner","kind":"extractor","base_only":true,
                "base_model":{{"file":"Q.gguf","sha256":"aa","arch":"qwen35","name":"Qwen3.5","size":"2B"}},
                "prompt_template":"{{input}}","inputs":["text"],"output_contract":{contract}}}"#);
            check(&build_store_zip(&[(MANIFEST_FILE, m.as_bytes()), (ask::SHOTS_FILE, br#"[{"user":"a","pigeon":"b"}]"#)]), &Host::default())
        };
        let schema = r#""output_schema":{"type":"object","properties":{"steps":{"type":"array","items":{"type":"object","properties":{"skill":{"type":"string"}}}}}}"#;
        let ok = plan(&format!(r#"{{"type":"json","max_tokens":200,"constrained":true,"host_values":["steps[].skill"],{schema}}}"#)).expect("a field of its schema");
        assert_eq!(ok.manifest.output_contract.unwrap().host_values, vec!["steps[].skill".to_string()]);
        let code = |c: String| plan(&c).unwrap_err().code();
        assert_eq!(code(format!(r#"{{"type":"json","max_tokens":200,"constrained":true,"host_values":["steps[].nope"],{schema}}}"#)), "bad_manifest");
        assert_eq!(code(format!(r#"{{"type":"json","max_tokens":200,"host_values":["steps[].skill"],{schema}}}"#)), "bad_manifest", "host values need constrained");
        assert_eq!(code(r#"{"type":"json","max_tokens":200,"constrained":true,"host_values":["skill"]}"#.into()), "bad_manifest", "no schema to name it in");
        assert_eq!(code(format!(r#"{{"type":"text","max_tokens":200,{schema}}}"#)), "bad_manifest", "a schema goes with json");
        assert_eq!(code(r#"{"type":"json","max_tokens":200,"constrained":true,"host_values":"skill"}"#.into()), "bad_manifest");
        // A label's own value is the word "label".
        let labels = |hv: &str| {
            let m = format!(r#"{{"format_version":1,"name":"Asks","id":"patch-asks","kind":"classifier","base_only":true,
                "base_model":{{"file":"Q.gguf","sha256":"aa","arch":"qwen35","name":"Qwen3.5","size":"2B"}},
                "prompt_template":"{{input}}","inputs":["text"],"output_contract":{{"type":"label","max_tokens":6,"constrained":true,"host_values":{hv}}}}}"#);
            check(&build_store_zip(&[(MANIFEST_FILE, m.as_bytes()), ("labels.txt", b"YES\nNO\n")]), &Host::default())
        };
        assert!(labels(r#"["label"]"#).is_ok());
        assert_eq!(labels(r#"["skill"]"#).unwrap_err().code(), "bad_manifest");
        // A broken shots.json is the payload's fault.
        let broken = format!(r#"{{"format_version":1,"name":"N","id":"n","kind":"freeform","base_only":true,
            "base_model":{{"file":"Q.gguf","sha256":"aa","arch":"qwen35","name":"Qwen3.5","size":"2B"}},
            "prompt_template":"{{input}}","inputs":["text"],"output_contract":{{"type":"text","max_tokens":9}}}}"#);
        assert_eq!(check(&build_store_zip(&[(MANIFEST_FILE, broken.as_bytes()), (ask::SHOTS_FILE, b"[1]")]), &Host::default()).unwrap_err().code(), "bad_payload");
    }

    #[test]
    fn a_refusal_a_download_can_cure_says_what_to_fetch() {
        let bytes = pigeon(ACTIONS);
        let (thinking, none) = ([InstalledBase { identity: gguf::Identity { finetune: Some("thinking".into()), ..base("x", None).identity }, ..base("T.gguf", None) }], [] as [InstalledBase; 0]);
        let on = |bases: &[InstalledBase], projectors: &[String]| check(&bytes, &Host { machine: Some(Machine { bases, projectors, embedders: &[] }), ..Default::default() }).unwrap_err();
        let wrong = on(&thinking, &[]);
        assert_eq!((wrong.code(), wrong.json()["needs"]["file"].as_str()), ("wrong_base", Some("VL-Q4.gguf")));
        assert_eq!(wrong.json()["needs"]["identity"]["finetune"], "instruct");
        assert!(wrong.json()["needs"].get("license").is_none(), "no registry lists it, so there is no licence to show");
        // D63: an empty part of the identity is left out, never written as "".
        let blank = Needs::of("b.gguf", &gguf::Identity { arch: "qwen3vl".into(), ..Default::default() }, None, false);
        assert_eq!(serde_json::to_value(&blank).unwrap()["identity"], serde_json::json!({ "arch": "qwen3vl" }));
        assert_eq!(on(&none, &[]).code(), "no_base");
        let no_projector = on(&[base("VL-Q4.gguf", Some("aa"))], &[]);
        assert_eq!((no_projector.code(), no_projector.needs().map(|n| n.file.as_str())), ("no_projector", Some("mmproj.gguf")));
        assert!(Refused::NotANest.needs().is_none());
    }

    #[test]
    fn a_router_answers_with_a_label_and_a_carried_projector_must_be_a_gguf() {
        let m = MANIFEST.replace(r#""kind":"classifier""#, r#""kind":"router""#);
        let router = |answer: &str| build_store_zip(&[(MANIFEST_FILE, m.replace(r#""type":"label""#, answer).as_bytes()), (ADAPTER_FILE, &lora_bytes()), ("labels.txt", b"KEY(Up)\n")]);
        assert!(check(&router(r#""type":"label""#), &Host::default()).is_ok());
        assert_eq!(check(&router(r#""type":"text""#), &Host::default()).unwrap_err().code(), "bad_manifest", "D56");
        // D57: the bytes the manifest names, but not a GGUF.
        let junk = b"not a gguf at all";
        let named = MANIFEST.replace(r#""sha256":"pp""#, &format!(r#""sha256":"{}""#, sha256_hex(junk)));
        let carried = build_store_zip(&[(MANIFEST_FILE, named.as_bytes()), (ADAPTER_FILE, &lora_bytes()), ("labels.txt", b"KEY(Up)\n"), (PROJECTOR_FILE, junk)]);
        assert_eq!(check(&carried, &Host::default()).unwrap_err().code(), "bad_payload");
        let real = crate::gguf::test_support::build_header(&[("general.type", "projector")]);
        let named = MANIFEST.replace(r#""sha256":"pp""#, &format!(r#""sha256":"{}""#, sha256_hex(&real)));
        let carried = build_store_zip(&[(MANIFEST_FILE, named.as_bytes()), (ADAPTER_FILE, &lora_bytes()), ("labels.txt", b"KEY(Up)\n"), (PROJECTOR_FILE, &real)]);
        assert!(check(&carried, &Host::default()).is_ok());
    }
}
