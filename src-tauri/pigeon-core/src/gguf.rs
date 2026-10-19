//! Reading a base model's identity out of its own GGUF header.
//!
//! Port of Flight School's `pigeon/gguf.py` (`read_header`, `base_identity`,
//! `same_base`) — see `docs`/`PIGEON-FORMAT.md` §3 for the format this reads
//! and the reasoning behind `same_base`'s comparison rules. Only the KV pairs
//! are read, never the tensor data that follows them, so identifying a 4 GB
//! model costs one bounded read near the front of the file.

use std::collections::HashMap;
use std::fs;
use std::path::Path;

const MAGIC: &[u8; 4] = b"GGUF";

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Value {
    Str(String),
    Other,
}

impl Value {
    pub fn as_str(&self) -> Option<&str> {
        match self {
            Value::Str(s) => Some(s),
            Value::Other => None,
        }
    }
}

struct Cursor<'a> {
    b: &'a [u8],
    pos: usize,
}

impl<'a> Cursor<'a> {
    fn u32(&mut self) -> Result<u32, String> {
        let v = self.b.get(self.pos..self.pos + 4).ok_or("truncated GGUF header")?;
        self.pos += 4;
        Ok(u32::from_le_bytes(v.try_into().unwrap()))
    }
    fn u64(&mut self) -> Result<u64, String> {
        let v = self.b.get(self.pos..self.pos + 8).ok_or("truncated GGUF header")?;
        self.pos += 8;
        Ok(u64::from_le_bytes(v.try_into().unwrap()))
    }
    fn i32(&mut self) -> Result<i32, String> {
        Ok(self.u32()? as i32)
    }
    fn bytes(&mut self, n: usize) -> Result<&'a [u8], String> {
        let v = self.b.get(self.pos..self.pos + n).ok_or("truncated GGUF header")?;
        self.pos += n;
        Ok(v)
    }
    fn string(&mut self) -> Result<String, String> {
        let len = self.u64()? as usize;
        Ok(String::from_utf8_lossy(self.bytes(len)?).into_owned())
    }
    /// Skip one value of the given GGUF metadata type without allocating for
    /// types this app never reads (int arrays, floats, arrays of arrays...).
    fn skip_value(&mut self, kind: u32) -> Result<(), String> {
        match kind {
            0 | 1 | 7 => { self.bytes(1)?; } // u8/i8/bool
            2 | 3 => { self.bytes(2)?; } // u16/i16
            4 | 5 | 6 => { self.bytes(4)?; } // u32/i32/f32
            10 | 11 | 12 => { self.bytes(8)?; } // u64/i64/f64
            8 => { self.string()?; } // string
            9 => {
                // array: elem type (u32) + count (u64) + values
                let elem = self.u32()?;
                let count = self.u64()?;
                for _ in 0..count {
                    self.skip_value(elem)?;
                }
            }
            other => return Err(format!("unknown GGUF value type {other}")),
        }
        Ok(())
    }
}

/// Every key/value pair in a GGUF file's header, stopping before tensor data.
/// Non-string values are kept as `Value::Other` — nothing this reader needs
/// is anything but a string.
pub fn read_header(bytes: &[u8]) -> Result<HashMap<String, Value>, String> {
    if bytes.len() < 4 || &bytes[0..4] != MAGIC {
        return Err("not a GGUF file — bad magic".into());
    }
    let mut c = Cursor { b: bytes, pos: 4 };
    let _version = c.u32()?;
    let _tensor_count = c.u64()?;
    let kv_count = c.u64()?;

    let mut out = HashMap::with_capacity(kv_count as usize);
    for _ in 0..kv_count {
        let key = c.string()?;
        let kind = c.i32()? as u32;
        if kind == 8 {
            let s = c.string()?;
            out.insert(key, Value::Str(s));
        } else {
            c.skip_value(kind)?;
            out.insert(key, Value::Other);
        }
    }
    Ok(out)
}

pub fn read_header_file(path: &Path) -> Result<HashMap<String, Value>, String> {
    // The header sits at the front and is mostly tokenizer arrays — a few MB
    // at most — while the file is gigabytes. Read a prefix and double it only
    // while the parser says the header runs past what was read, so an import
    // that scans every installed model never loads one whole.
    use std::io::Read;
    let err = |e: std::io::Error| format!("could not read {}: {e}", path.display());
    let mut file = fs::File::open(path).map_err(err)?;
    let len = file.metadata().map(|m| m.len()).unwrap_or(u64::MAX);
    let mut buf = Vec::new();
    let mut limit: u64 = 16 << 20;
    loop {
        let want = limit.min(len);
        let before = buf.len();
        if (before as u64) < want {
            (&mut file).take(want - before as u64).read_to_end(&mut buf).map_err(err)?;
        }
        match read_header(&buf) {
            Err(e) if e.contains("truncated") && buf.len() > before && (buf.len() as u64) < len => limit *= 2,
            other => return other,
        }
    }
}

/// Written out (in a refusal's `needs`), an empty field is left out rather
/// than written as `""` (D63).
#[derive(serde::Serialize, serde::Deserialize, Clone, Debug, Default, PartialEq, Eq)]
#[serde(default)]
pub struct Identity {
    #[serde(skip_serializing_if = "String::is_empty")]
    pub arch: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub name: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub size: String,
    /// `general.finetune` (spec §7.2, D12): what tells Qwen3-VL-2B Instruct
    /// from Thinking. `None` when the header, or an older manifest, has none.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub finetune: Option<String>,
}

/// `{arch, name, size}` from `general.architecture`, `general.basename` (or
/// `general.name`), `general.size_label`. A missing field is an empty string
/// rather than an error — `same_base` treats an empty field as never matching
/// anything, which is the refusal this app wants when a header is thin.
pub fn base_identity(kv: &HashMap<String, Value>) -> Identity {
    let get = |k: &str| kv.get(k).and_then(Value::as_str).unwrap_or("").to_string();
    let name = {
        let basename = get("general.basename");
        if !basename.is_empty() { basename } else { get("general.name") }
    };
    let finetune = Some(get("general.finetune")).filter(|f| !f.is_empty());
    Identity { arch: get("general.architecture"), name, size: get("general.size_label"), finetune }
}

fn normalize(s: &str) -> String {
    s.chars().filter(|c| c.is_alphanumeric()).map(|c| c.to_ascii_lowercase()).collect()
}

/// Two identities name the same base model at possibly different
/// quantizations or with different converter-chosen names — `arch` must
/// agree exactly, `size` after stripping punctuation/spaces, and `name` by
/// prefix agreement after the same normalization (one converter writes
/// `"Qwen2.5"`, another `"Qwen2.5 1.5B Instruct"` for the same model). An
/// empty field never matches — a thin header refuses rather than guesses.
///
/// `want` is the identity a Pigeon's manifest names and `have` an installed
/// base's own header. When the manifest names a `finetune`, the header must
/// have an equal one (spec §7.2 rule 4); a manifest written before Draft 3
/// names none, and the rule is skipped.
pub fn same_base(want: &Identity, have: &Identity) -> bool {
    let (a, b) = (want, have);
    if a.arch.is_empty() || b.arch.is_empty() || a.arch != b.arch {
        return false;
    }
    let (sa, sb) = (normalize(&a.size), normalize(&b.size));
    if sa.is_empty() || sb.is_empty() || sa != sb {
        return false;
    }
    let (na, nb) = (normalize(&a.name), normalize(&b.name));
    if na.is_empty() || nb.is_empty() {
        return false;
    }
    if !(na.starts_with(&nb) || nb.starts_with(&na)) {
        return false;
    }
    match want.finetune.as_deref().filter(|f| !f.is_empty()) {
        Some(f) => have.finetune.as_deref().map(normalize).is_some_and(|h| !h.is_empty() && h == normalize(f)),
        None => true,
    }
}

#[cfg(any(test, feature = "test-support"))]
pub mod test_support {
    use std::collections::HashMap;

    /// A minimal GGUF header buffer holding only string KV pairs — enough to
    /// exercise `read_header`/`base_identity` without a real model file.
    pub fn build_header(kv: &[(&str, &str)]) -> Vec<u8> {
        let mut out = Vec::new();
        out.extend_from_slice(b"GGUF");
        out.extend_from_slice(&3u32.to_le_bytes()); // version
        out.extend_from_slice(&0u64.to_le_bytes()); // tensor_count
        out.extend_from_slice(&(kv.len() as u64).to_le_bytes()); // kv_count
        for (k, v) in kv {
            out.extend_from_slice(&(k.len() as u64).to_le_bytes());
            out.extend_from_slice(k.as_bytes());
            out.extend_from_slice(&8u32.to_le_bytes()); // type: string
            out.extend_from_slice(&(v.len() as u64).to_le_bytes());
            out.extend_from_slice(v.as_bytes());
        }
        out
    }

    /// What a `.pigeon`'s adapter looks like to `read_header`: enough to be
    /// accepted as a LoRA adapter, nothing a server could load.
    pub fn lora_bytes() -> Vec<u8> {
        build_header(&[("general.architecture", "qwen2"), ("general.type", "adapter"), ("adapter.type", "lora")])
    }

    /// A second, different adapter, for tests that install one over another.
    pub fn lora_bytes_v2() -> Vec<u8> {
        build_header(&[("general.architecture", "qwen2"), ("general.type", "adapter"), ("adapter.type", "lora"), ("general.name", "v2")])
    }

    #[allow(dead_code)]
    pub fn empty() -> HashMap<String, super::Value> {
        HashMap::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identity_is_read_from_the_header() {
        let bytes = test_support::build_header(&[
            ("general.architecture", "qwen2"),
            ("general.basename", "Qwen2.5"),
            ("general.size_label", "1.5B"),
        ]);
        let kv = read_header(&bytes).expect("header");
        let id = base_identity(&kv);
        assert_eq!(id, Identity { arch: "qwen2".into(), name: "Qwen2.5".into(), size: "1.5B".into(), finetune: None });
    }

    #[test]
    fn name_falls_back_to_general_name() {
        let bytes = test_support::build_header(&[
            ("general.architecture", "qwen2"),
            ("general.name", "Qwen2.5 1.5B Instruct"),
            ("general.size_label", "1.5B"),
        ]);
        let id = base_identity(&read_header(&bytes).unwrap());
        assert_eq!(id.name, "Qwen2.5 1.5B Instruct");
    }

    #[test]
    fn same_base_survives_a_different_quantization_and_naming_noise() {
        let a = Identity { arch: "qwen2".into(), name: "Qwen2.5".into(), size: "1.5B".into(), finetune: None };
        let b = Identity { arch: "qwen2".into(), name: "Qwen2.5 1.5B Instruct".into(), size: "1.5B".into(), finetune: None };
        assert!(same_base(&a, &b));
    }

    #[test]
    fn a_different_architecture_is_not_the_same_base() {
        let a = Identity { arch: "qwen2".into(), name: "Qwen2.5".into(), size: "1.5B".into(), finetune: None };
        let b = Identity { arch: "llama".into(), name: "Qwen2.5".into(), size: "1.5B".into(), finetune: None };
        assert!(!same_base(&a, &b));
    }

    #[test]
    fn a_different_size_of_the_same_family_is_not_the_same_base() {
        let a = Identity { arch: "qwen2".into(), name: "Qwen2.5".into(), size: "1.5B".into(), finetune: None };
        let b = Identity { arch: "qwen2".into(), name: "Qwen2.5".into(), size: "3B".into(), finetune: None };
        assert!(!same_base(&a, &b));
    }

    #[test]
    fn an_instruct_pigeon_does_not_load_on_thinking_and_an_old_manifest_skips_the_rule() {
        let id = |f: Option<&str>| Identity { arch: "qwen3vl".into(), name: "qwen3vl".into(), size: "2B".into(), finetune: f.map(String::from) };
        assert!(same_base(&id(Some("instruct")), &id(Some("Instruct"))));
        assert!(!same_base(&id(Some("instruct")), &id(Some("thinking"))));
        assert!(!same_base(&id(Some("instruct")), &id(None)), "a header without a finetune does not match one that is named");
        assert!(same_base(&id(None), &id(Some("thinking"))), "a manifest from before Draft 3 names none");
    }

    #[test]
    fn not_a_gguf_is_refused_by_name() {
        assert!(read_header(b"definitely not a gguf file").is_err());
    }
}
