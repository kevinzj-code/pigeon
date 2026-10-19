//! Checking and loading a Pigeon (INTERFACE.md §5.2, §5.3): the file read
//! once, its base found and loaded once, its adapter attached, and its
//! `prompt_check` proven against the base's own template with the picture
//! counted by the projector itself.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use pigeon_core::ask::{self, PromptCheck};
use pigeon_core::blob::Blob;
use pigeon_core::check::{self, Refused, Report};
use pigeon_core::manifest::{History, Manifest};
use pigeon_core::material::{ChunkIndex, Embeddings};
use pigeon_core::{actions, nest, skill, zip_store};
use serde_json::Value;

use crate::embed::Embedder;
use crate::llama::{Adapter, Model, Part, Projector};

/// A Pigeon file, read: the whole file mapped, and where this Pigeon's bytes
/// sit in it (a nest member is a slice of the nest).
pub struct Opened {
    pub path: PathBuf,
    blob: Blob,
    start: usize,
    len: usize,
}

impl Opened {
    pub fn open(path: &Path, member: Option<&str>) -> Result<Opened, Refused> {
        let blob = Blob::open(path).map_err(|e| Refused::BadZip(format!("{} could not be read — {e}", path.display())))?;
        let (start, len) = match member {
            None => (0, blob.len()),
            Some(name) => {
                let members = nest::members(&blob)?;
                let (_, bytes) = members.into_iter().find(|(f, _)| f == name).ok_or_else(|| Refused::BadZip(format!("the nest has no member {name}")))?;
                (bytes.as_ptr() as usize - blob.as_ptr() as usize, bytes.len())
            }
        };
        Ok(Opened { path: path.to_path_buf(), blob, start, len })
    }

    pub fn bytes(&self) -> &[u8] {
        &self.blob[self.start..self.start + self.len]
    }

    /// One entry's bytes, and where they start in the file on disk.
    fn entry(&self, name: &str) -> Option<(&[u8], u64)> {
        let bytes = self.bytes();
        let entries = zip_store::list_entries(bytes).ok()?;
        let data = zip_store::get(&entries, bytes, name).ok().flatten()?;
        let at = (data.as_ptr() as usize - self.blob.as_ptr() as usize) as u64;
        Some((data, at))
    }

    fn text(&self, name: &str) -> Option<String> {
        self.entry(name).map(|(b, _)| String::from_utf8_lossy(b).into_owned())
    }
}

/// A projector, with the lock its `tokenize` and `encode` need.
pub struct Pictures {
    pub projector: Projector,
    pub lock: Mutex<()>,
    pub file: String,
    pub sha256: String,
    pub bytes: u64,
}

/// A base, loaded once, shared by every Pigeon on it.
pub struct Base {
    pub file: String,
    pub path: PathBuf,
    pub model: Arc<Model>,
    pub template: String,
    pub projectors: Mutex<Vec<Arc<Pictures>>>,
    /// Bytes a context of one cell costs: both caches over every layer.
    pub kv_bytes_per_cell: u64,
    pub used: Mutex<Instant>,
}

impl Base {
    pub fn load(path: &Path) -> Result<Base, String> {
        let model = Model::load(path)?;
        let kv_bytes_per_cell = model.kv_bytes_per_cell();
        let template = model.chat_template().ok_or("the base has no chat template, so no Pigeon on it can be asked the way it was trained")?;
        Ok(Base {
            file: path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
            path: path.to_path_buf(),
            model: Arc::new(model),
            template,
            projectors: Mutex::new(Vec::new()),
            kv_bytes_per_cell,
            used: Mutex::new(Instant::now()),
        })
    }

    pub fn touch(&self) {
        if let Ok(mut u) = self.used.lock() {
            *u = Instant::now();
        }
    }

    pub fn weights_bytes(&self) -> u64 {
        self.model.size() + self.projectors.lock().map(|p| p.iter().map(|x| x.bytes).sum()).unwrap_or(0)
    }
}

/// What the file says about `KEY(…)` answers.
pub enum ActionsFile {
    NoFile,
    Skipped,
    File(Value),
}

/// A loaded Pigeon: everything an ask needs, read once.
pub struct Loaded {
    pub manifest: Manifest,
    pub report: Value,
    pub base: Arc<Base>,
    pub pictures: Option<Arc<Pictures>>,
    /// None for a base Pigeon (D83): the base answers with nothing attached.
    pub adapter: Option<Adapter>,
    pub labels: Vec<String>,
    pub skill: Option<skill::Payload>,
    pub actions: ActionsFile,
    pub index: Option<ChunkIndex>,
    pub embeddings: Option<Embeddings>,
    pub embedder: Option<Arc<Embedder>>,
    pub system_prompt: Option<String>,
    /// `shots.json` (D86), sent before any history.
    pub shots: Vec<ask::Turn>,
    /// The grammar for a constrained answer. None when the host supplies
    /// values (E20): the grammar is then built for each ask.
    pub grammar: Option<String>,
    pub temperature: f64,
    pub max_tokens: Option<u32>,
    /// What the base's template writes for a picture.
    pub picture_markup: Option<String>,
    /// The picture's placeholder count at the size it was trained at, as the
    /// projector counted it at load.
    pub picture_tokens: Option<u32>,
    pub history: History,
}

impl Loaded {
    pub fn reading(&self) -> ask::Reading<'_> {
        ask::Reading {
            output_type: self.manifest.output_type().unwrap_or("text"),
            inner: self.manifest.output_contract.as_ref().and_then(|o| o.answer.as_deref()),
            labels: &self.labels,
            skill: self.skill.as_ref(),
            shown: None,
            actions: match &self.actions {
                ActionsFile::NoFile => actions::Keys::NoFile,
                ActionsFile::Skipped => actions::Keys::Skipped,
                ActionsFile::File(v) => actions::Keys::File(v),
            },
        }
    }
}

/// Why a load failed: the file's or the machine's fault (a refusal, §4), or
/// the engine's (an error).
pub enum Failed {
    Refused(Refused),
    /// `no_projector` at load: the projector is not on disk (E14). `carried`
    /// when the file holds it, for the host to install first.
    NoProjector { needs: pigeon_core::Needs, carried: bool },
    /// `prompt_mismatch`, with the prompt this engine built, for whoever
    /// has to find out why.
    Mismatch { at: usize, rendered: String },
    Error(&'static str, String),
}

impl From<Refused> for Failed {
    fn from(r: Refused) -> Failed {
        Failed::Refused(r)
    }
}

/// Everything `load` needs from the engine, borrowed.
pub struct Here<'a> {
    pub registries: &'a [pigeon_core::registry::Registry],
    pub projector_dirs: &'a [PathBuf],
    pub embedding_dirs: &'a [PathBuf],
    pub hashes: &'a Mutex<pigeon_core::hashes::HashCache>,
    pub embedders: &'a Mutex<Vec<Arc<Embedder>>>,
}

/// The installed file in `dirs` whose sha256 is `want`, hashing again the
/// one that matches (E11: for projectors the hash is the rule). A file named
/// `named` is tried first.
fn by_hash(dirs: &[PathBuf], want: &str, named: &str, hashes: &Mutex<pigeon_core::hashes::HashCache>) -> Option<PathBuf> {
    let mut files = pigeon_core::scan::ggufs(dirs);
    files.sort_by_key(|p| p.file_name().map_or(true, |n| n.to_string_lossy() != named));
    let mut cache = hashes.lock().ok()?;
    let known = files.iter().find(|p| cache.known(p).as_deref() == Some(want)).cloned();
    let found = known.or_else(|| files.iter().find(|p| cache.known(p).is_none() && cache.hash(p).ok().as_deref() == Some(want)).cloned())?;
    (cache.rehash(&found).ok().as_deref() == Some(want)).then_some(found)
}

/// Attaches a checked Pigeon to `base` (already loaded) and proves its prompt.
pub fn attach(opened: &Opened, report: Report, base: Arc<Base>, here: &Here) -> Result<Loaded, Failed> {
    let m = report.manifest.clone();
    let model_failed = |e: String| Failed::Error("model_failed", e);

    // The projector, by hash, shared by every picture Pigeon on this base.
    let pictures = if m.takes_pictures() {
        let want = m.base_model.mmproj.as_ref().and_then(|p| p.sha256.as_ref()).map(|s| s.to_ascii_lowercase()).unwrap_or_default();
        let have = base.projectors.lock().ok().and_then(|p| p.iter().find(|x| x.sha256 == want).cloned());
        Some(match have {
            Some(p) => p,
            None => {
                // E14: projectors load only from files on disk. One carried
                // only inside the Pigeon is refused, for the host to install.
                let path = by_hash(here.projector_dirs, &want, m.base_model.mmproj.as_ref().map_or("", |p| p.file.as_str()), here.hashes).ok_or_else(|| Failed::NoProjector {
                    needs: projector_needs(&m, here.registries),
                    carried: opened.entry(pigeon_core::manifest::PROJECTOR_FILE).is_some(),
                })?;
                let projector = Projector::load(&path, &base.model).map_err(model_failed)?;
                let bytes = projector.allocated();
                let p = Arc::new(Pictures {
                    projector,
                    lock: Mutex::new(()),
                    file: path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
                    sha256: want,
                    bytes,
                });
                if let Ok(mut all) = base.projectors.lock() {
                    all.push(p.clone());
                }
                p
            }
        })
    } else {
        None
    };

    let adapter = if m.base_only {
        None
    } else {
        let (_, at) = opened.entry(check::ADAPTER_FILE).ok_or_else(|| Failed::Refused(Refused::MissingRequiredFile { kind: m.kind.clone(), file: check::ADAPTER_FILE.into() }))?;
        Some(Adapter::load(&base.model, &opened.path, at).map_err(model_failed)?)
    };

    let labels = ask::labels(&opened.text("labels.txt").unwrap_or_default());
    let skill = match &m.skill {
        None => None,
        Some(s) => {
            let raw = opened.entry(skill::PAYLOAD_FILE).map(|(b, _)| b).unwrap_or_default();
            Some(skill::Payload::parse_coded(raw, &s.name, m.skill_version()).map_err(|t| if t.render { Refused::UnknownRender(t.why) } else { Refused::BadPayload(t.why) })?)
        }
    };
    let actions = match (opened.entry(actions::ACTIONS_FILE), &report.actions) {
        (None, _) => ActionsFile::NoFile,
        (Some(_), Some(v)) => ActionsFile::File(v.clone()),
        (Some(_), None) => ActionsFile::Skipped,
    };
    let index: Option<ChunkIndex> = opened.entry(check::MATERIAL_FILE).and_then(|(raw, _)| serde_json::from_slice(raw).ok());
    let hybrid = m.material.as_ref().is_some_and(|x| x.retrieval == "hybrid-v1");
    let (embeddings, embedder) = if hybrid {
        let raw = opened.entry(pigeon_core::material::EMBEDDINGS_FILE).map(|(b, _)| b).unwrap_or_default();
        let e = Embeddings::parse(raw).map_err(Refused::BadPayload)?;
        let want = e.model.sha256.to_ascii_lowercase();
        let have = here.embedders.lock().ok().and_then(|all| all.iter().find(|x| x.sha256 == want).cloned());
        let embedder = match have {
            Some(x) => x,
            None => {
                let path = by_hash(here.embedding_dirs, &want, &e.model.file, here.hashes).ok_or_else(|| Refused::EmbeddingModel(e.model.file.clone()))?;
                let x = Arc::new(Embedder::load(&path, &want).map_err(model_failed)?);
                if let Ok(mut all) = here.embedders.lock() {
                    all.push(x.clone());
                }
                x
            }
        };
        (Some(e), Some(embedder))
    } else {
        (None, None)
    };
    let system_prompt = opened.text("system_prompt.txt");
    let shots = match opened.entry(ask::SHOTS_FILE) {
        Some((raw, _)) => ask::parse_shots(raw).map_err(Refused::BadPayload)?,
        None => Vec::new(),
    };

    // §8.4: constrained answers get the allowed set as a grammar.
    let oc = m.output_contract.clone().unwrap_or_default();
    let grammar = if !oc.constrained || m.output_type() == Some("reasoned") || !oc.host_values.is_empty() {
        None
    } else if m.output_type() == Some("label") {
        Some(label_grammar(&labels))
    } else if let Some(schema) = oc.output_schema.as_ref() {
        Some(crate::llama::json_schema_grammar(&schema.to_string()).map_err(model_failed)?)
    } else if let Some(s) = skill.as_ref().filter(|s| !s.recipe_schema.is_null()) {
        Some(crate::llama::json_schema_grammar(&s.recipe_schema.to_string()).map_err(model_failed)?)
    } else {
        return Err(Failed::Error("model_failed", "this Pigeon is constrained but has no allowed set the engine can build a grammar from".into()));
    };

    // §8.6, before first use: the prompt for `prompt_check.input`, rendered
    // through this base's own template, with the picture counted by the
    // projector that will see it.
    let (picture_markup, picture_tokens) = match &pictures {
        None => (None, None),
        Some(p) => {
            let markup = ask::template::picture_markup(&base.template).map_err(model_failed)?;
            let n = match m.prompt_check.as_ref().and_then(|pc| pc.input.get("image")).and_then(Value::as_str) {
                Some(name) => {
                    let (img, _) = opened.entry(name).ok_or_else(|| Failed::Refused(Refused::MissingRequiredFile { kind: m.kind.clone(), file: name.into() }))?;
                    Some(count_picture(p, img).map_err(model_failed)?)
                }
                None => None,
            };
            (Some(markup), n)
        }
    };
    let picture = picture_markup.as_deref().zip(picture_tokens).map(|(markup, tokens)| ask::Picture { markup, tokens });
    match ask::template::prompt_check(&m, system_prompt.as_deref(), &shots, index.as_ref(), &base.template, picture.as_ref()).map_err(model_failed)? {
        PromptCheck::Unchecked | PromptCheck::Matches { .. } => {}
        PromptCheck::Differs { at, rendered } => return Err(Failed::Mismatch { at, rendered }),
    }

    Ok(Loaded {
        report: report.json(),
        temperature: report.temperature,
        history: report.history.clone(),
        manifest: m,
        base,
        pictures,
        adapter,
        labels,
        skill,
        actions,
        index,
        embeddings,
        embedder,
        system_prompt,
        shots,
        grammar,
        max_tokens: oc.max_tokens,
        picture_markup,
        picture_tokens,
    })
}

/// What a host needs to offer the projector (INTERFACE.md §4): the file the
/// Pigeon names, its base's identity, and the licence and size when a trusted
/// registry lists them.
fn projector_needs(m: &Manifest, registries: &[pigeon_core::registry::Registry]) -> pigeon_core::Needs {
    let identity = m.base_model.identity();
    let file = m.base_model.mmproj.as_ref().map(|p| p.file.clone()).unwrap_or_default();
    let entry = pigeon_core::registry::base_for(registries, &identity);
    pigeon_core::Needs {
        bytes: entry.and_then(|b| b.projectors.iter().find(|r| r.file == file)).and_then(|r| r.bytes),
        registry_id: entry.and_then(|b| b.id.clone()),
        license: entry.and_then(|b| b.license.clone()),
        license_url: entry.and_then(|b| b.license_url.clone()),
        file,
        identity,
    }
}

/// A grammar that admits exactly the lines of `labels.txt`.
pub fn label_grammar(labels: &[String]) -> String {
    let lit = |l: &String| {
        let mut out = String::from("\"");
        for c in l.chars() {
            match c {
                '"' => out.push_str("\\\""),
                '\\' => out.push_str("\\\\"),
                '\n' => out.push_str("\\n"),
                '\r' => out.push_str("\\r"),
                '\t' => out.push_str("\\t"),
                c => out.push(c),
            }
        }
        out.push('"');
        out
    };
    format!("root ::= {}", labels.iter().map(lit).collect::<Vec<_>>().join(" | "))
}

/// How many placeholder tokens the projector makes of this picture.
fn count_picture(p: &Pictures, encoded: &[u8]) -> Result<u32, String> {
    let _held = p.lock.lock().map_err(|_| "the projector's lock is poisoned")?;
    let bitmap = p.projector.bitmap(encoded)?;
    let chunks = p.projector.tokenize(&Projector::marker(), &[&bitmap])?;
    chunks
        .parts()
        .iter()
        .find_map(|x| match x {
            Part::Image { tokens, .. } => Some(*tokens as u32),
            _ => None,
        })
        .ok_or_else(|| "the projector made no picture of the prompt_check image".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_label_grammar_admits_each_line_as_written() {
        let g = label_grammar(&["KEY(Up)".into(), "say \"hi\"".into(), "a\\b".into()]);
        assert_eq!(g, r#"root ::= "KEY(Up)" | "say \"hi\"" | "a\\b""#);
    }
}
