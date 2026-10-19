//! `pigeon.json`, the manifest (spec §5), as typed data.
//!
//! These types are read LENIENTLY: a field that is absent or has a shape this
//! reader does not know becomes its default, so a host can still read the
//! manifest of a file it installed long ago. Whether a file may be loaded at
//! all is `check::check`'s decision, made on the raw JSON, field by field, with
//! a code for each refusal — never this parser's.

use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Value;

use crate::{gguf, skill};

/// A field that is informational, or checked elsewhere: the wrong shape reads
/// as the default instead of failing the whole manifest.
fn lenient<'de, D: Deserializer<'de>, T: serde::de::DeserializeOwned + Default>(d: D) -> Result<T, D::Error> {
    Ok(serde_json::from_value(Value::deserialize(d)?).unwrap_or_default())
}

/// `inputs`, keeping the entries that are text.
fn strings<'de, D: Deserializer<'de>>(d: D) -> Result<Vec<String>, D::Error> {
    Ok(match Value::deserialize(d)? {
        Value::Array(a) => a.into_iter().filter_map(|v| v.as_str().map(String::from)).collect(),
        _ => Vec::new(),
    })
}

#[derive(Deserialize, Debug, Clone, PartialEq, Eq)]
pub struct SkillRef {
    pub name: String,
    #[serde(default)]
    pub version: Value,
}

#[derive(Deserialize, Debug, Clone, Default, PartialEq, Eq)]
pub struct MaterialSpec {
    #[serde(default, deserialize_with = "lenient")]
    pub retrieval: String,
    #[serde(default, deserialize_with = "lenient")]
    pub sections: u64,
    /// `hybrid-v1`: the embedding model the file's vectors were made with —
    /// a second pinned identity (§9.4).
    #[serde(default, deserialize_with = "lenient")]
    pub embedding: Option<EmbeddingRef>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct EmbeddingRef {
    #[serde(default)]
    pub model: String,
    pub file: String,
    pub sha256: String,
    #[serde(default)]
    pub dims: u32,
}

#[derive(Deserialize, Debug, Clone, PartialEq, Eq)]
pub struct BaseModelSpec {
    /// The GGUF the maker's test ran on (D15). Not the identity.
    pub file: String,
    #[serde(default, deserialize_with = "lenient")]
    pub sha256: Option<String>,
    #[serde(default)]
    pub arch: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub size: String,
    /// Part of the identity since Draft 3 (D12). Absent on older files.
    #[serde(default, deserialize_with = "lenient")]
    pub finetune: Option<String>,
    #[serde(default, deserialize_with = "lenient")]
    pub quant: Option<String>,
    #[serde(default, deserialize_with = "lenient")]
    pub repo: Option<String>,
    #[serde(default, deserialize_with = "lenient")]
    pub registry_id: Option<String>,
    /// Informational (D11): the base can take a picture. It does NOT decide
    /// whether a projector is needed — `inputs` does.
    #[serde(default, deserialize_with = "lenient")]
    pub vision: bool,
    /// The projector the adapter was trained and tested with. Its hash is the
    /// identity: two Pigeons naming the same hash share one copy.
    #[serde(default, deserialize_with = "lenient")]
    pub mmproj: Option<ProjectorSpec>,
}

impl BaseModelSpec {
    /// The identity this manifest names (§7.2).
    pub fn identity(&self) -> gguf::Identity {
        gguf::Identity {
            arch: self.arch.clone(),
            name: self.name.clone(),
            size: self.size.clone(),
            finetune: self.finetune.clone().filter(|f| !f.is_empty()),
        }
    }
}

#[derive(Deserialize, Debug, Clone, PartialEq, Eq)]
pub struct ProjectorSpec {
    #[serde(default, deserialize_with = "lenient")]
    pub file: String,
    #[serde(default, deserialize_with = "lenient")]
    pub sha256: Option<String>,
}

/// Where a picture Pigeon carries its projector inside the `.pigeon`, when it
/// carries one (§13.1).
pub const PROJECTOR_FILE: &str = "projector.gguf";

/// `output_contract` — what the run MEASURED, not what it planned. The spec is
/// blunt about the difference: "a plan once claimed 120 against 303 real
/// tokens and starved its own test".
#[derive(Deserialize, Debug, Clone, Default, PartialEq, Eq)]
pub struct OutputContract {
    /// `label`, `json`, `text` or `reasoned` (§5.4).
    #[serde(rename = "type", default, deserialize_with = "lenient")]
    pub kind: Option<String>,
    /// `reasoned` only: the type of the answer inside `<do>…</do>`.
    #[serde(default, deserialize_with = "lenient")]
    pub answer: Option<String>,
    #[serde(default, deserialize_with = "lenient")]
    pub max_tokens: Option<u32>,
    #[serde(default, deserialize_with = "strings")]
    pub fields: Vec<String>,
    /// Answers are limited to the allowed set while they are generated (D20).
    #[serde(default, deserialize_with = "lenient")]
    pub constrained: bool,
    /// D86: fields (for `json`, named in `output_schema`) or the word `label`
    /// whose allowed values the host supplies with each ask.
    #[serde(default, deserialize_with = "strings")]
    pub host_values: Vec<String>,
    /// D88: the JSON Schema a constrained `json` answer is held to, with its
    /// properties in the order the answer writes them.
    #[serde(default, deserialize_with = "lenient")]
    pub output_schema: Option<Value>,
}

/// `history` (§5.6): how much of a conversation a Runner sends.
#[derive(Deserialize, Debug, Clone, Default, PartialEq, Eq)]
pub struct History {
    #[serde(default, deserialize_with = "lenient")]
    pub shape: String,
    #[serde(default, deserialize_with = "lenient")]
    pub max_turns: Option<u32>,
}

/// `trained_from` (D16): what the adapter was actually trained on.
#[derive(Deserialize, Debug, Clone, Default, PartialEq, Eq)]
pub struct TrainedFrom {
    #[serde(default, deserialize_with = "lenient")]
    pub repo: Option<String>,
    #[serde(default, deserialize_with = "lenient")]
    pub revision: Option<String>,
    /// `bf16`, `f16`, `8bit` or `4bit`.
    #[serde(default, deserialize_with = "lenient")]
    pub precision: Option<String>,
}

/// `prompt_check` (§8.6): one input and the exact prompt training built from
/// it. `input` is a string, `{input, sections}` or `{text, image}`.
#[derive(Deserialize, Debug, Clone, PartialEq, Eq)]
pub struct PromptCheck {
    #[serde(default)]
    pub input: Value,
    #[serde(default, deserialize_with = "lenient")]
    pub canonical: String,
}

#[derive(Deserialize, Debug, Clone, PartialEq)]
pub struct Manifest {
    pub format_version: u64,
    pub name: String,
    pub id: String,
    pub kind: String,
    pub base_model: BaseModelSpec,
    pub prompt_template: String,
    #[serde(default, deserialize_with = "lenient")]
    pub output_contract: Option<OutputContract>,
    /// §10 — the answer is a recipe, drawn by this named skill.
    #[serde(default)]
    pub skill: Option<SkillRef>,
    /// §9 — how a grounded Pigeon's material is chosen per question.
    #[serde(default, deserialize_with = "lenient")]
    pub material: Option<MaterialSpec>,
    /// §11 — the maker's card, as written. `card::readable` says whether a
    /// host may show it.
    #[serde(default)]
    pub card: Option<Value>,
    /// What can be PUT IN: `["text"]` or `["image", "text"]`. Declared by the
    /// maker rather than inferred, because nobody can tell a breed sorter from
    /// a receipt reader by looking at it.
    #[serde(default, deserialize_with = "strings")]
    pub inputs: Vec<String>,
    /// §5.5 — as written. `Report::temperature` is the one to run at.
    #[serde(default, deserialize_with = "lenient")]
    pub temperature: Option<f64>,
    #[serde(default, deserialize_with = "lenient")]
    pub history: Option<History>,
    #[serde(default, deserialize_with = "lenient")]
    pub trained_from: Option<TrainedFrom>,
    #[serde(default, deserialize_with = "lenient")]
    pub prompt_check: Option<PromptCheck>,
    /// D83: no trained weights; the base is loaded with nothing attached.
    #[serde(default)]
    pub base_only: bool,
}

/// The input kinds this reader knows.
pub const INPUT_KINDS: [&str; 2] = ["text", "image"];

impl Manifest {
    /// What the file says it takes, with anything this build does not know
    /// dropped and the empty case read as text. Never empty.
    pub fn declared_inputs(&self) -> Vec<String> {
        let mut out: Vec<String> = Vec::new();
        for k in self.inputs.iter().map(|s| s.trim().to_ascii_lowercase()).filter(|s| INPUT_KINDS.contains(&s.as_str())) {
            if !out.contains(&k) {
                out.push(k);
            }
        }
        if out.is_empty() {
            out.push("text".into());
        }
        out
    }

    /// A picture Pigeon: `inputs` contains `"image"` (D11). A text Pigeon
    /// trained on a base that can see is still a text Pigeon. A file from
    /// before `inputs` existed said it with `base_model.vision` alone.
    pub fn takes_pictures(&self) -> bool {
        if self.inputs.is_empty() {
            return self.base_model.vision;
        }
        self.inputs.iter().any(|i| i == "image")
    }

    pub fn skill_version(&self) -> Option<u64> {
        self.skill.as_ref().and_then(|s| skill::version_of(&s.version))
    }

    /// `output_contract.type`, when the file has one.
    pub fn output_type(&self) -> Option<&str> {
        self.output_contract.as_ref().and_then(|o| o.kind.as_deref())
    }

    /// The type the checked answer has: the one inside `<do>…</do>` for a
    /// `reasoned` Pigeon, the output type itself otherwise.
    pub fn answer_type(&self) -> Option<&str> {
        let oc = self.output_contract.as_ref()?;
        oc.answer.as_deref().filter(|_| oc.kind.as_deref() == Some("reasoned")).or(oc.kind.as_deref())
    }
}

/// Whether an id may become one file-name component (§5.3). Hosts name files
/// after it — `<id>.lora.gguf`, `<id>.pigeon`, `previous/<id>/` — so an id is
/// a path fragment, and one carrying `..`, a separator, a drive letter or
/// nothing at all would let a file someone was sent write outside the host's
/// own folders. Checked once at validation, and again at every sink that takes
/// an id, so the two never disagree.
pub fn plain_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && !id.starts_with('.')
        && id.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | ' '))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_id_is_one_plain_file_name_component() {
        for ok in ["note-to-title", "Seed Run v2", "a.b_c", &"x".repeat(128)] {
            assert!(plain_id(ok), "{ok:?}");
        }
        for bad in ["", ".", "..", ".hidden", "a/b", "a\\b", "C:x", "é", &"x".repeat(129)] {
            assert!(!plain_id(bad), "{bad:?}");
        }
    }

    #[test]
    fn an_old_manifest_still_reads_and_a_new_one_keeps_its_draft_5_fields() {
        let old: Manifest = serde_json::from_value(serde_json::json!({
            "format_version": 1, "name": "n", "id": "n", "kind": "freeform",
            "base_model": { "file": "b.gguf", "arch": "qwen2", "name": "Qwen2.5", "size": "1.5B", "vision": true },
            "prompt_template": "{input}"
        }))
        .unwrap();
        assert!(old.card.is_none() && old.output_contract.is_none());
        assert_eq!(old.declared_inputs(), vec!["text"]);
        assert!(old.takes_pictures(), "before `inputs`, vision alone said it");
        assert_eq!(old.base_model.identity().finetune, None);

        let new: Manifest = serde_json::from_value(serde_json::json!({
            "format_version": 1, "name": "Seed Run", "id": "seed-run", "kind": "classifier",
            "base_model": { "file": "b.gguf", "sha256": null, "arch": "qwen3vl", "name": "qwen3vl", "size": "2B", "finetune": "instruct", "vision": true },
            "trained_from": { "repo": "r", "revision": "c", "precision": "bf16" },
            "prompt_template": "{input}", "inputs": ["text"],
            "output_contract": { "type": "reasoned", "answer": "label", "max_tokens": 80, "constrained": true },
            "temperature": 0, "history": { "shape": "none" },
            "prompt_check": { "input": "x", "canonical": "y" }
        }))
        .unwrap();
        assert!(!new.takes_pictures(), "a text Pigeon on a base that can see is a text Pigeon");
        assert_eq!((new.output_type(), new.answer_type()), (Some("reasoned"), Some("label")));
        assert_eq!(new.base_model.identity().finetune.as_deref(), Some("instruct"));
        assert_eq!(new.trained_from.unwrap().precision.as_deref(), Some("bf16"));
        assert!(new.output_contract.unwrap().constrained);
    }
}
