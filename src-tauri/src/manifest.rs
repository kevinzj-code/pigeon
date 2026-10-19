//! What the engine runs, pinned by hash.
//!
//! `models.json` beside `Cargo.toml` names the GGUF file Pigeon fetches on
//! first run (one from Patch v10, 2026-10-14: every Pigeon in his nest runs on
//! Qwen3-VL 2B, and the planner's Qwen3.5 2B left): where it comes from, how
//! big it is, and the SHA-256 it must have. It is compiled into the binary, so a shipped Pigeon can only ever
//! fetch the files its source named — the page cannot supply a URL and neither
//! can a config file on disk.
//!
//! The hash is the one the bench was measured on (Patch v10's nest, 293/308
//! and 2/100 leaks on `Qwen3VL-2B-Instruct-Q4_K_M` from Qwen, 2026-10-13). Changing a line here changes
//! the model, and the bench is the review for that change.
//! `scripts/models-manifest.mjs --check` compares these entries with what
//! Hugging Face currently publishes; it is a manual check, never part of the
//! test suite, because the suite runs offline.
//!
//! The licence texts are embedded too, so they can be written beside the
//! weights BEFORE the first byte downloads — attribution is a precondition of
//! the download, not a courtesy after it.

use serde::{Deserialize, Serialize};
use std::sync::OnceLock;

use crate::Role;

pub const MODELS_JSON: &str = include_str!("../models.json");
pub const LICENCE_LLAMA_CPP: &str = include_str!("../licences/llama.cpp-MIT.txt");
pub const LICENCE_QWEN: &str = include_str!("../licences/Qwen-Apache-2.0.txt");
pub const LICENCE_NOMIC: &str = include_str!("../licences/Nomic-Apache-2.0.txt");

#[derive(Deserialize, Serialize, Clone, Debug)]
pub struct Manifest {
    pub schema: u32,
    pub llama_cpp: LlamaCpp,
    pub models: Vec<ModelSpec>,
    /// The picture model: Peek's, and the base the picture Pigeons are
    /// trained on. Not a role a wake starts and never part of the first-run
    /// download — it is fetched only when a person asks for it from Peek.
    #[serde(default)]
    pub picture: Option<PictureSpec>,
    /// The embedding model a grounded Pigeon's `hybrid-v1` search embeds the
    /// question with (format §8.7): a second pinned identity beside the
    /// base. Fetched only when such a Pigeon asks for it.
    #[serde(default)]
    pub embedding: Option<EmbeddingSpec>,
}

/// A vision base and the projector that lets it see, fetched together.
#[derive(Deserialize, Serialize, Clone, Debug)]
pub struct PictureSpec {
    pub id: String,
    pub name: String,
    pub quant: String,
    pub file: String,
    pub url: String,
    pub bytes: u64,
    pub sha256: String,
    /// Measured with one 768×576 picture: 3.0 GB resident (2026-09-21).
    pub resident_mb: u64,
    pub licence: Licence,
    pub projector: FileSpec,
}

#[derive(Deserialize, Serialize, Clone, Debug)]
pub struct EmbeddingSpec {
    pub id: String,
    pub name: String,
    pub quant: String,
    pub file: String,
    pub url: String,
    pub bytes: u64,
    pub sha256: String,
    pub resident_mb: u64,
    pub licence: Licence,
    pub dims: u32,
    pub pooling: String,
    pub document_prefix: String,
    pub query_prefix: String,
}

/// One pinned file: where it comes from, its size and its hash.
#[derive(Deserialize, Serialize, Clone, Debug)]
pub struct FileSpec {
    pub file: String,
    pub url: String,
    pub bytes: u64,
    pub sha256: String,
}

impl PictureSpec {
    /// Both files, base first, as (file, url, bytes, sha256).
    pub fn files(&self) -> [FileSpec; 2] {
        [
            FileSpec { file: self.file.clone(), url: self.url.clone(), bytes: self.bytes, sha256: self.sha256.clone() },
            self.projector.clone(),
        ]
    }
}

#[derive(Deserialize, Serialize, Clone, Debug)]
pub struct LlamaCpp {
    pub build: String,
    pub spdx: String,
    pub notice: String,
}

#[derive(Deserialize, Serialize, Clone, Debug)]
pub struct Licence {
    pub spdx: String,
    pub holder: String,
    pub notice: String,
}

#[derive(Deserialize, Serialize, Clone, Debug)]
pub struct AdapterSpec {
    /// Free text. On the category adapter it says what the entry is: a
    /// description of the adapter in the BUNDLED Patch pack, kept for the
    /// attribution record and the fit arithmetic. It is not what the app loads
    /// by — the category adapter comes out of a sealed pack, and that pack's
    /// `models.category.adapter_sha256` is the hash it is checked against
    /// (`patch.rs`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    pub file: String,
    pub bytes: u64,
    pub sha256: String,
}

#[derive(Deserialize, Serialize, Clone, Debug)]
pub struct ModelSpec {
    pub id: String,
    pub role: String,
    pub name: String,
    pub quant: String,
    pub file: String,
    pub url: String,
    pub bytes: u64,
    pub sha256: String,
    /// What the running server holds, weights plus an 8k context, in MB.
    /// Loft's measured `req_mb` for the same files.
    pub resident_mb: u64,
    pub licence: Licence,
    /// The category model carries Pigeon's own adapter, shipped in the bundle
    /// rather than downloaded; it is listed so its hash is checked too.
    pub adapter: Option<AdapterSpec>,
    /// Task adapters: trained for one job, loaded INERT beside the applied one
    /// and raised per request by the command that needs them. Not personas —
    /// a transcript repairer is not a voice — so they never reach Lane B's
    /// list. Defaulted so an older manifest without the key still parses.
    #[serde(default)]
    pub tasks: Vec<AdapterSpec>,
}

/// One row of "what is bundled and under what terms", for the sheet and for
/// ATTRIBUTION.md.
#[derive(Serialize, Clone, Debug)]
pub struct Notice {
    pub name: String,
    pub spdx: String,
}

impl ModelSpec {
    /// None for a role this build does not have: refused by `parse`.
    pub fn role(&self) -> Option<Role> {
        match self.role.as_str() {
            "category" => Some(Role::Category),
            _ => None,
        }
    }
    /// Weights plus the adapter it must load, in MB, for the fit arithmetic.
    pub fn need_mb(&self) -> u64 {
        self.resident_mb + self.adapter.as_ref().map(|a| a.bytes / (1024 * 1024)).unwrap_or(0)
    }
}

impl Manifest {
    pub fn for_role(&self, role: Role) -> Option<&ModelSpec> {
        self.models.iter().find(|m| m.role() == Some(role))
    }

    pub fn notices(&self) -> Vec<Notice> {
        let mut out = vec![
            Notice { name: format!("llama.cpp ({})", self.llama_cpp.build), spdx: self.llama_cpp.spdx.clone() },
        ];
        for m in &self.models {
            out.push(Notice { name: m.name.clone(), spdx: m.licence.spdx.clone() });
        }
        // Peek's base is the category model's: one notice, not two.
        if let Some(p) = self.picture.as_ref().filter(|p| self.models.iter().all(|m| m.file != p.file)) {
            out.push(Notice { name: p.name.clone(), spdx: p.licence.spdx.clone() });
        }
        if let Some(e) = &self.embedding {
            out.push(Notice { name: e.name.clone(), spdx: e.licence.spdx.clone() });
        }
        out
    }
}

fn is_sha256(s: &str) -> bool {
    s.len() == 64 && s.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

/// Parse and check. The checks are the contract the downloader relies on: a
/// hash it can compare, a size it can measure, a URL on the one host the
/// manifest is allowed to name, and exactly one entry per role.
pub fn parse(json: &str) -> Result<Manifest, String> {
    let m: Manifest = serde_json::from_str(json).map_err(|e| format!("models.json: {e}"))?;
    if m.schema != 1 {
        return Err(format!("models.json: schema {} is not 1", m.schema));
    }
    let mut seen = std::collections::HashSet::new();
    for spec in &m.models {
        if !is_sha256(&spec.sha256) {
            return Err(format!("models.json: {} has no 64-hex sha256", spec.id));
        }
        if !spec.url.starts_with("https://huggingface.co/") {
            return Err(format!("models.json: {} is not fetched from huggingface.co", spec.id));
        }
        if spec.bytes == 0 || spec.resident_mb == 0 {
            return Err(format!("models.json: {} has no size", spec.id));
        }
        if !spec.file.ends_with(".gguf") || spec.file.contains('/') {
            return Err(format!("models.json: {} has a bad file name", spec.id));
        }
        if let Some(a) = &spec.adapter {
            if !is_sha256(&a.sha256) || a.bytes == 0 || a.file.contains('/') {
                return Err(format!("models.json: {}'s adapter is malformed", spec.id));
            }
        }
        let Some(role) = spec.role() else {
            return Err(format!("models.json: {} has the role \"{}\", which this build does not have", spec.id, spec.role));
        };
        if !seen.insert(role) {
            return Err(format!("models.json: two entries for the {} role", spec.role));
        }
    }
    if let Some(p) = &m.picture {
        for f in p.files() {
            if !is_sha256(&f.sha256) || f.bytes == 0 || !f.file.ends_with(".gguf") || f.file.contains('/') {
                return Err(format!("models.json: the picture model's {} is malformed", f.file));
            }
            if !f.url.starts_with("https://huggingface.co/") || !f.url.ends_with(&f.file) {
                return Err(format!("models.json: the picture model's {} is not fetched from huggingface.co by its name", f.file));
            }
        }
        if p.resident_mb == 0 {
            return Err("models.json: the picture model has no size".into());
        }
    }
    for role in Role::ALL {
        if !seen.contains(&role) {
            return Err(format!("models.json: no entry for the {} role", role.as_str()));
        }
    }
    Ok(m)
}

/// The embedded manifest, parsed once. A failure here is a build defect the
/// test below catches; at runtime it is reported, never unwrapped.
pub fn manifest() -> Result<&'static Manifest, String> {
    static M: OnceLock<Result<Manifest, String>> = OnceLock::new();
    M.get_or_init(|| parse(MODELS_JSON)).as_ref().map_err(|e| e.clone())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_embedded_manifest_parses() {
        manifest().expect("models.json");
    }

    #[test]
    fn every_model_has_a_hash_a_huggingface_url_and_a_size() {
        let m = manifest().unwrap();
        assert_eq!(m.models.len(), 1, "one model from Patch v10");
        for spec in &m.models {
            assert!(is_sha256(&spec.sha256), "{}", spec.id);
            assert!(spec.url.starts_with("https://huggingface.co/"), "{}", spec.id);
            assert!(spec.url.ends_with(&spec.file), "{}: url does not end in its file name", spec.id);
            assert!(spec.bytes > 100_000_000, "{}", spec.id);
        }
    }

    #[test]
    fn the_picture_model_is_pinned_apart_from_the_first_run_pair() {
        let m = manifest().unwrap();
        let p = m.picture.as_ref().expect("a picture model");
        // Peek sees through Qwen3-VL 2B, the category model's own base, so
        // his download is only its projector: the one the registry recommends.
        assert!(m.models.iter().any(|s| s.role == "category" && s.file == p.file));
        assert_eq!(p.projector.sha256, "f9a68fabba69c3b81e153367b2c7521030b0fa8bb0de400c9599c8e6725f9c82");
        assert_eq!(p.licence.notice, "Qwen-Apache-2.0.txt");
        let broken = MODELS_JSON.replace("https://huggingface.co/Qwen/Qwen3-VL-2B-Instruct-GGUF/resolve/52d6c8ffea26cc873ac5ad116f8631268d7eb503/mmproj", "https://example.com/mmproj");
        assert!(parse(&broken).unwrap_err().contains("picture model"));
    }

    #[test]
    fn each_role_appears_exactly_once() {
        let m = manifest().unwrap();
        assert!(m.for_role(Role::Category).is_some());
        assert!(m.for_role(Role::Category).unwrap().adapter.is_some(), "the category model carries the adapter");
    }

    /// One model, Qwen3-VL 2B: no Qwen3.5 2B on a fresh install from v10.
    #[test]
    fn the_first_run_download_is_one_model_of_1_1_gb() {
        let m = manifest().unwrap();
        let total: u64 = m.models.iter().map(|m| m.bytes).sum();
        // decimal GB, the unit the sheet shows
        assert_eq!(total / 100_000_000, 11, "{total} bytes is not 1.1 GB");
        assert!(m.models.iter().all(|s| !s.file.starts_with("Qwen3.5")), "Qwen3.5 is not fetched");
        assert_eq!(m.models[0].file, m.picture.as_ref().unwrap().file, "Peek's base is the same file");
    }

    #[test]
    fn a_role_this_build_does_not_have_is_refused() {
        let mut v: serde_json::Value = serde_json::from_str(MODELS_JSON).unwrap();
        let mut extra = v["models"][0].clone();
        extra["id"] = "planner".into();
        extra["role"] = "planner".into();
        v["models"].as_array_mut().unwrap().push(extra);
        let err = parse(&v.to_string()).unwrap_err();
        assert!(err.contains("which this build does not have"), "{err}");
    }

    #[test]
    fn a_manifest_missing_a_role_is_refused() {
        let mut v: serde_json::Value = serde_json::from_str(MODELS_JSON).unwrap();
        v["models"].as_array_mut().unwrap().pop();
        let err = parse(&v.to_string()).unwrap_err();
        assert!(err.contains("no entry for the category role"), "{err}");
    }

    #[test]
    fn a_url_off_huggingface_is_refused() {
        let doctored = MODELS_JSON.replacen("https://huggingface.co/Qwen", "https://example.com/Qwen", 1);
        let err = parse(&doctored).unwrap_err();
        assert!(err.contains("huggingface"), "{err}");
    }

    /// The adapter the app ships is the one the manifest describes. Skipped
    /// when the file is not in the checkout (it is git-tracked, so it should be).
    #[test]
    fn the_committed_adapter_matches_its_manifest_hash() {
        use sha2::{Digest, Sha256};
        let spec = manifest().unwrap().for_role(Role::Category).unwrap();
        let a = spec.adapter.as_ref().unwrap();
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../model").join(&a.file);
        let Ok(bytes) = std::fs::read(&path) else {
            eprintln!("(skipped: {} not in this checkout)", path.display());
            return;
        };
        assert_eq!(bytes.len() as u64, a.bytes, "adapter size");
        let hex = format!("{:x}", Sha256::digest(&bytes));
        assert_eq!(hex, a.sha256, "adapter sha256");
    }

    #[test]
    fn the_notices_name_every_licensor() {
        let names: Vec<String> = manifest().unwrap().notices().into_iter().map(|n| n.name).collect();
        assert!(names.iter().any(|n| n.starts_with("llama.cpp")));
        assert!(!names.iter().any(|n| n.starts_with("Qwen3.5")), "Qwen3.5 no longer ships");
        assert!(names.iter().any(|n| n.starts_with("Qwen3-VL")));
        assert!(!names.iter().any(|n| n.starts_with("OpenSSL")), "no OpenSSL ships any more");
        assert!(LICENCE_LLAMA_CPP.contains("MIT License"));
        assert!(LICENCE_QWEN.contains("Apache License"));
    }
}
