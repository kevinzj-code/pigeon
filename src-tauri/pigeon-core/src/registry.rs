//! The base registry (spec §7.4): a published list of known bases that says
//! where a base's files are, what its licence is, and which projector goes
//! with it.
//!
//! A registry is published SEALED: a strict ZIP holding `registry.json` and
//! `seal.json`, sealed exactly as §15.1 seals a Pigeon. It is used only when
//! its seal verifies against a key the host trusts FOR REGISTRIES — a separate
//! list from the keys it trusts for Pigeons (§15.2). A tampered copy could
//! otherwise point a host at a different 1 GB file while every hash in it
//! still matched.
//!
//! A registry is optional. The identity rule (§7.2) always applies, and a base
//! that is in no registry still loads by identity.

use serde::{Deserialize, Serialize};

use crate::check::{self, Trust};
use crate::{gguf, seal, zip_store};

pub const REGISTRY_FILE: &str = "registry.json";

#[derive(Deserialize, Debug, Clone, PartialEq, Eq)]
pub struct Registry {
    #[serde(default)]
    pub registry_version: Option<u64>,
    #[serde(default)]
    pub updated: Option<String>,
    pub bases: Vec<Base>,
    /// The id of the registry key that sealed it. Set by `open`.
    #[serde(skip)]
    pub sealed_by: String,
}

#[derive(Deserialize, Debug, Clone, Default, PartialEq, Eq)]
pub struct IdentitySpec {
    #[serde(default)]
    pub arch: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub size: String,
    #[serde(default)]
    pub finetune: Option<String>,
}

#[derive(Deserialize, Debug, Clone, PartialEq, Eq)]
pub struct Base {
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub identity: IdentitySpec,
    /// Further spellings of `name` that converters are known to write.
    #[serde(default)]
    pub names: Vec<String>,
    /// The BASE's licence (SPDX), which a host shows before downloading or
    /// shipping it.
    #[serde(default)]
    pub license: Option<String>,
    #[serde(default)]
    pub license_url: Option<String>,
    #[serde(default)]
    pub files: Vec<File>,
    /// The stock projectors for this base (§13.1).
    #[serde(default)]
    pub projectors: Vec<File>,
    /// Vision bases: the text this base's chat template writes for one
    /// picture (D51). Optional (D62): this crate can also find it by rendering
    /// the template (`ask::template::picture_markup`). Kept, so it is never
    /// silently dropped.
    #[serde(default)]
    pub picture_markup: Option<String>,
}

/// One pinned file. Every download is checked against `sha256` before use.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
pub struct File {
    pub file: String,
    pub sha256: String,
    #[serde(default)]
    pub bytes: Option<u64>,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default, skip_serializing)]
    pub quant: Option<String>,
    #[serde(default, skip_serializing)]
    pub recommended: bool,
}

impl Base {
    pub fn identity(&self) -> gguf::Identity {
        let i = &self.identity;
        gguf::Identity { arch: i.arch.clone(), name: i.name.clone(), size: i.size.clone(), finetune: i.finetune.clone() }
    }

    /// The entry's identity under its own name and under each spelling of it
    /// that converters are known to write (D45).
    pub fn spellings(&self) -> Vec<gguf::Identity> {
        let own = self.identity();
        let others: Vec<gguf::Identity> = self.names.iter().map(|name| gguf::Identity { name: name.clone(), ..own.clone() }).collect();
        std::iter::once(own).chain(others).collect()
    }

    /// Whether a GGUF header's identity is this entry's base.
    pub fn is_header(&self, header: &gguf::Identity) -> bool {
        self.spellings().iter().any(|s| gguf::same_base(s, header))
    }

    /// The file a host downloads by default, and a Writer tests on (D33).
    pub fn recommended_file(&self) -> Option<&File> {
        self.files.iter().find(|f| f.recommended)
    }

    pub fn recommended_projector(&self) -> Option<&File> {
        self.projectors.iter().find(|f| f.recommended)
    }
}

impl Registry {
    pub fn base(&self, id: &str) -> Option<&Base> {
        self.bases.iter().find(|b| b.id.as_deref() == Some(id))
    }

    /// The first entry that is the same base as the identity a Pigeon's
    /// manifest names (§7.2), under the entry's own name or any spelling it
    /// accepts (D45).
    pub fn base_for(&self, wanted: &gguf::Identity) -> Option<&Base> {
        self.bases.iter().find(|b| b.spellings().iter().any(|s| gguf::same_base(wanted, s)))
    }

    /// Whether a projector hash is a stock one for some base here.
    pub fn stock_projector(&self, sha256: &str) -> Option<(&Base, &File)> {
        self.bases.iter().find_map(|b| b.projectors.iter().find(|p| p.sha256 == sha256).map(|p| (b, p)))
    }
}

/// `registry_version` newer than this is refused rather than misread.
pub const SUPPORTED_REGISTRY_VERSION: u64 = 1;

/// Why a registry is not used. `code` is `not_a_zip`, `bad_zip`, `broken_seal`
/// or `untrusted_seal` as for a Pigeon; `bad_registry` for one that is
/// unsealed or whose `registry.json` cannot be read; `newer_format` for a
/// `registry_version` this reader does not know (D44). A refused registry is
/// ignored: it never fails a Pigeon's check.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Unusable {
    pub code: &'static str,
    pub why: String,
}

/// Open a sealed registry. Unsealed, or sealed by anything but a trusted
/// registry key, it is not used.
pub fn open(bytes: &[u8], trust: &Trust) -> Result<Registry, Unusable> {
    let entries = check::list(bytes).map_err(|r| Unusable { code: r.code(), why: r.message() })?;
    let sealed_by = match seal::check(&entries, bytes, trust.registries) {
        Ok(seal::Sealed::By(key)) => key,
        Ok(seal::Sealed::No) => return Err(Unusable { code: "bad_registry", why: "a registry must be sealed, and this one is not".into() }),
        Ok(seal::Sealed::Untrusted { why, .. }) => return Err(Unusable { code: "untrusted_seal", why }),
        Err(why) => return Err(Unusable { code: "broken_seal", why }),
    };
    let unreadable = |why: String| Unusable { code: "bad_registry", why: format!("{REGISTRY_FILE} could not be read — {why}") };
    let raw = zip_store::get(&entries, bytes, REGISTRY_FILE).map_err(unreadable)?.ok_or_else(|| unreadable("it is not in the file".into()))?;
    let mut registry: Registry = serde_json::from_slice(raw).map_err(|e| unreadable(e.to_string()))?;
    let Some(found) = registry.registry_version else { return Err(unreadable("it has no registry_version".into())) };
    if found > SUPPORTED_REGISTRY_VERSION {
        return Err(Unusable { code: "newer_format", why: format!("this registry is version {found}, and this app reads version {SUPPORTED_REGISTRY_VERSION} — update the app") });
    }
    registry.sealed_by = sealed_by;
    Ok(registry)
}

/// Every registry that opens, in the order given. One that is refused is left
/// out, with why — for a host to log, never to fail on.
pub fn open_all(registries: &[&[u8]], trust: &Trust) -> (Vec<Registry>, Vec<Unusable>) {
    let (mut opened, mut refused) = (Vec::new(), Vec::new());
    for bytes in registries {
        match open(bytes, trust) {
            Ok(r) => opened.push(r),
            Err(u) => refused.push(u),
        }
    }
    (opened, refused)
}

/// The first entry, across registries in order, that is the same base.
pub fn base_for<'a>(registries: &'a [Registry], wanted: &gguf::Identity) -> Option<&'a Base> {
    registries.iter().find_map(|r| r.base_for(wanted))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::zip_store::test_support::build_store_zip;
    use ring::signature::{Ed25519KeyPair, KeyPair};

    const REGISTRY: &[u8] = br#"{"registry_version":1,"updated":"2026-10-02","bases":[{"id":"qwen3-vl-2b-instruct",
        "identity":{"arch":"qwen3vl","name":"qwen3vl","size":"2B","finetune":"instruct"},"license":"Apache-2.0",
        "files":[{"file":"Qwen3VL-2B-Instruct-Q4_K_M.gguf","quant":"Q4_K_M","recommended":true,"sha256":"aa","bytes":1,"url":"https://x"}],
        "projectors":[{"file":"mmproj.gguf","recommended":true,"sha256":"pp","bytes":1,"url":"https://x"}],
        "picture_markup":"<|vision_start|><|image_pad|><|vision_end|>"}]}"#;

    fn sealed(files: &[(&str, &[u8])], seed: &[u8; 32]) -> (Vec<u8>, String) {
        let pair = Ed25519KeyPair::from_seed_unchecked(seed).unwrap();
        let key = seal::to_hex(pair.public_key().as_ref());
        let unsealed = build_store_zip(files);
        let message = seal::seal_message(&zip_store::list_entries(&unsealed).unwrap(), &unsealed);
        let json = format!(r#"{{"scheme":"{}","key":"{}","signature":"{}"}}"#, seal::SCHEME, seal::key_id_of(&key).unwrap(), seal::to_hex(pair.sign(&message).as_ref()));
        let mut all = files.to_vec();
        all.push((seal::SEAL_FILE, json.as_bytes()));
        (build_store_zip(&all), key)
    }

    #[test]
    fn a_registry_is_used_only_under_a_registry_key() {
        let (zip, key) = sealed(&[(REGISTRY_FILE, REGISTRY)], &[7; 32]);
        let keys = [key.clone()];
        let r = open(&zip, &Trust { pigeons: &[], registries: &keys }).expect("opens");
        assert_eq!(Some(&r.sealed_by), seal::key_id_of(&key).as_ref());
        let want = gguf::Identity { arch: "qwen3vl".into(), name: "Qwen3VL".into(), size: "2B".into(), finetune: Some("instruct".into()) };
        assert_eq!(r.base_for(&want).and_then(|b| b.id.as_deref()), Some("qwen3-vl-2b-instruct"));
        assert_eq!(r.base_for(&want).and_then(Base::recommended_projector).map(|p| p.sha256.as_str()), Some("pp"));
        assert_eq!(r.base_for(&want).and_then(|b| b.picture_markup.as_deref()), Some("<|vision_start|><|image_pad|><|vision_end|>"));
        assert!(r.stock_projector("pp").is_some() && r.stock_projector("zz").is_none());

        // One key, one purpose: the same key on the Pigeon list opens nothing.
        assert_eq!(open(&zip, &Trust { pigeons: &keys, registries: &[] }).unwrap_err().code, "untrusted_seal");
        let unsealed = build_store_zip(&[(REGISTRY_FILE, REGISTRY)]);
        assert_eq!(open(&unsealed, &Trust { pigeons: &[], registries: &keys }).unwrap_err().code, "bad_registry");
        let (tampered, _) = sealed(&[(REGISTRY_FILE, REGISTRY)], &[7; 32]);
        let mut tampered = tampered;
        let at = tampered.windows(10).position(|w| w == b"Apache-2.0").unwrap();
        tampered[at] = b'a';
        assert_eq!(open(&tampered, &Trust { pigeons: &[], registries: &keys }).unwrap_err().code, "broken_seal");
        // A registry from the future is not misread, and a refused one is left out.
        let newer = REGISTRY.to_vec().iter().map(|b| *b).collect::<Vec<u8>>();
        let newer = String::from_utf8(newer).unwrap().replace("\"registry_version\":1", "\"registry_version\":2");
        let (future, _) = sealed(&[(REGISTRY_FILE, newer.as_bytes())], &[7; 32]);
        let trust = Trust { pigeons: &[], registries: &keys };
        assert_eq!(open(&future, &trust).unwrap_err().code, "newer_format");
        let spelled = gguf::Identity { name: "Q3-VL".into(), ..want.clone() };
        assert!(r.base_for(&spelled).is_none(), "a spelling the entry does not list is not that base");
        let (opened, refused) = open_all(&[&future, &zip, &unsealed], &trust);
        assert_eq!((opened.len(), refused.len()), (1, 2));
        assert!(base_for(&opened, &want).is_some());
    }
}
