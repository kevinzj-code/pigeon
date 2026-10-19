//! Finding what a machine holds: the folders a host names, turned into the
//! lists the check accepts (`check::Machine`).
//!
//! Reading a base's identity costs one bounded read of its header. Knowing a
//! file's sha256 costs reading all of it — gigabytes. So `scan` hashes nothing
//! itself: the caller says what a file's hash is, through `hash`; a file it
//! cannot answer for has none. A base without a hash still matches by identity
//! (with the other-file warning); a projector or embedding model without one
//! is not offered, because there the hash is the rule.
//!
//! `for_pigeon` is the engine's way in: it reads a hash cache (`hashes`), and
//! hashes only what this one Pigeon's check needs and the cache does not know.

use std::path::{Path, PathBuf};

use crate::check::{Embedder, InstalledBase, Machine};
use crate::gguf;

/// What a file's sha256 is, if the caller knows: lowercase hex.
pub type Hash<'a> = &'a dyn Fn(&Path) -> Option<String>;

/// Every `.gguf` directly inside `dirs`, in the order the folders were given
/// and by name within each.
pub fn ggufs(dirs: &[PathBuf]) -> Vec<PathBuf> {
    let mut out = Vec::new();
    for dir in dirs {
        let Ok(entries) = std::fs::read_dir(dir) else { continue };
        let mut found: Vec<PathBuf> = entries.filter_map(|e| e.ok()).map(|e| e.path()).filter(|p| p.extension().and_then(|e| e.to_str()) == Some("gguf")).collect();
        found.sort();
        out.extend(found);
    }
    out
}

/// Every base in `dirs`: each `.gguf` whose header reads, with its identity
/// from that header (§7.2) and its hash when the caller has one.
pub fn bases(dirs: &[PathBuf], hash: Hash) -> Vec<InstalledBase> {
    ggufs(dirs)
        .into_iter()
        .filter_map(|path| {
            let kv = gguf::read_header_file(&path).ok()?;
            let file = path.file_name()?.to_string_lossy().into_owned();
            Some(InstalledBase { file, identity: gguf::base_identity(&kv), sha256: hash(&path) })
        })
        .collect()
}

/// The hash of every file in `dirs` the caller can answer for.
pub fn hashes(dirs: &[PathBuf], hash: Hash) -> Vec<String> {
    ggufs(dirs).iter().filter_map(|path| hash(path)).collect()
}

/// A scanned machine, owning what `check::Machine` borrows.
#[derive(Debug, Clone, Default)]
pub struct Scanned {
    pub bases: Vec<InstalledBase>,
    pub projectors: Vec<String>,
    pub embedders: Vec<Embedder>,
}

impl Scanned {
    pub fn machine(&self) -> Machine<'_> {
        Machine { bases: &self.bases, projectors: &self.projectors, embedders: &self.embedders }
    }
}

/// The three folders lists of an engine's config, scanned.
pub fn scan(base_dirs: &[PathBuf], projector_dirs: &[PathBuf], embedding_dirs: &[PathBuf], hash: Hash) -> Scanned {
    Scanned {
        bases: bases(base_dirs, hash),
        projectors: hashes(projector_dirs, hash),
        embedders: hashes(embedding_dirs, hash).into_iter().map(|sha256| Embedder { sha256, dims: None, query_prefix: None }).collect(),
    }
}

/// The folders an engine is configured with (INTERFACE.md §5.1).
#[derive(Debug, Clone, Default)]
pub struct Folders {
    pub base_dirs: Vec<PathBuf>,
    pub projector_dirs: Vec<PathBuf>,
    pub embedding_dirs: Vec<PathBuf>,
}

/// The folders, scanned for one Pigeon's check. Every hash the cache already
/// knows is used. Beyond that, a file is hashed only when this check turns on
/// it: a base whose file name is the one the Pigeon was measured on (the
/// exact-file fast path), and — when the Pigeon needs one and no known hash is
/// it — the projectors and embedding models, until the one it names is found.
/// Nothing else is read. A Pigeon whose manifest cannot be read gets what the
/// cache knows, and its check says what is wrong with it.
pub fn for_pigeon(folders: &Folders, pigeon: &[u8], cache: &mut crate::hashes::HashCache) -> Scanned {
    let wants = Wants::of(pigeon);
    let known = |p: &Path| cache.known(p);
    let mut scanned = Scanned {
        bases: Vec::new(),
        projectors: hashes(&folders.projector_dirs, &known),
        embedders: hashes(&folders.embedding_dirs, &known).into_iter().map(|sha256| Embedder { sha256, dims: None, query_prefix: None }).collect(),
    };
    for path in ggufs(&folders.base_dirs) {
        let Ok(kv) = gguf::read_header_file(&path) else { continue };
        let Some(file) = path.file_name().map(|n| n.to_string_lossy().into_owned()) else { continue };
        let named = wants.base_file.as_deref() == Some(file.as_str());
        let sha256 = if named { cache.hash(&path).ok() } else { cache.known(&path) };
        scanned.bases.push(InstalledBase { file, identity: gguf::base_identity(&kv), sha256 });
    }
    // The file the Pigeon names is hashed first: it is almost always the one,
    // and a models folder can hold tens of gigabytes that are not.
    let mut find = |dirs: &[PathBuf], (want, named): &(String, String), have: &mut Vec<String>| {
        if have.iter().any(|h| h == want) {
            return;
        }
        let mut unknown: Vec<PathBuf> = ggufs(dirs).into_iter().filter(|p| cache.known(p).is_none()).collect();
        unknown.sort_by_key(|p| p.file_name().map_or(true, |n| n.to_string_lossy() != named.as_str()));
        for path in &unknown {
            let Ok(sha) = cache.hash(path) else { continue };
            have.push(sha.clone());
            if &sha == want {
                return;
            }
        }
    };
    if let Some(want) = &wants.projector {
        find(&folders.projector_dirs, want, &mut scanned.projectors);
    }
    if let Some(want) = &wants.embedder {
        let mut have: Vec<String> = scanned.embedders.iter().map(|e| e.sha256.clone()).collect();
        let before = have.len();
        find(&folders.embedding_dirs, want, &mut have);
        scanned.embedders.extend(have.into_iter().skip(before).map(|sha256| Embedder { sha256, dims: None, query_prefix: None }));
    }
    scanned
}

/// What one Pigeon's check could need a hash for.
#[derive(Default)]
struct Wants {
    base_file: Option<String>,
    /// (sha256, the file name the Pigeon gives it)
    projector: Option<(String, String)>,
    embedder: Option<(String, String)>,
}

impl Wants {
    fn of(pigeon: &[u8]) -> Wants {
        let Ok(entries) = crate::zip_store::list_entries(pigeon) else { return Wants::default() };
        let get = |name: &str| crate::zip_store::get(&entries, pigeon, name).ok().flatten();
        let Some(m) = get(crate::check::MANIFEST_FILE).and_then(|raw| serde_json::from_slice::<crate::manifest::Manifest>(raw).ok()) else {
            return Wants::default();
        };
        let carried = get(crate::manifest::PROJECTOR_FILE).is_some();
        let hybrid = m.kind == "grounded" && m.material.as_ref().is_some_and(|x| x.retrieval == "hybrid-v1");
        Wants {
            base_file: Some(m.base_model.file.clone()),
            projector: m.base_model.mmproj.as_ref().and_then(|p| Some((p.sha256.clone()?, p.file.clone()))).filter(|_| m.takes_pictures() && !carried),
            embedder: get(crate::material::EMBEDDINGS_FILE)
                .filter(|_| hybrid)
                .and_then(|raw| crate::material::Embeddings::parse(raw).ok())
                .map(|e| (e.model.sha256, e.model.file)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::gguf::test_support::build_header;

    #[test]
    fn folders_become_the_lists_the_check_takes_and_nothing_is_hashed_unasked() {
        let root = std::env::temp_dir().join(format!("pigeon-core-scan-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let (models, projectors) = (root.join("models"), root.join("projectors"));
        std::fs::create_dir_all(&models).unwrap();
        std::fs::create_dir_all(&projectors).unwrap();
        let header = build_header(&[("general.architecture", "qwen3vl"), ("general.basename", "qwen3vl"), ("general.size_label", "2B"), ("general.finetune", "instruct")]);
        std::fs::write(models.join("b.gguf"), &header).unwrap();
        std::fs::write(models.join("a.gguf"), b"not a gguf").unwrap();
        std::fs::write(models.join("notes.txt"), b"x").unwrap();
        std::fs::write(projectors.join("known.gguf"), b"p").unwrap();
        std::fs::write(projectors.join("unknown.gguf"), b"q").unwrap();
        let known = |p: &Path| (p.file_name()?.to_str()? == "known.gguf").then(|| "abc".to_string());
        let got = scan(&[models.clone(), root.join("missing")], &[projectors], &[], &known);
        assert_eq!(got.bases.len(), 1, "a file whose header does not read is not a base");
        assert_eq!((got.bases[0].file.as_str(), got.bases[0].identity.finetune.as_deref(), got.bases[0].sha256.as_deref()), ("b.gguf", Some("instruct"), None));
        assert_eq!(got.projectors, vec!["abc".to_string()], "a projector nobody can vouch for is not offered");
        assert!(got.embedders.is_empty() && got.machine().bases.len() == 1);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_pigeon_check_hashes_only_what_it_turns_on() {
        use crate::gguf::test_support::lora_bytes;
        use crate::zip_store::test_support::build_store_zip;
        let root = std::env::temp_dir().join(format!("pigeon-core-scan-pigeon-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let (models, projectors) = (root.join("models"), root.join("projectors"));
        std::fs::create_dir_all(&models).unwrap();
        std::fs::create_dir_all(&projectors).unwrap();
        let header = build_header(&[("general.architecture", "qwen3vl"), ("general.basename", "qwen3vl"), ("general.size_label", "2B")]);
        std::fs::write(models.join("Q4.gguf"), &header).unwrap();
        std::fs::write(models.join("Q8.gguf"), [header.as_slice(), b"8"].concat()).unwrap();
        std::fs::write(projectors.join("a.gguf"), b"projector a").unwrap();
        std::fs::write(projectors.join("b.gguf"), b"projector b").unwrap();
        let want = crate::hashes::sha256_file(&projectors.join("a.gguf")).unwrap();
        let manifest = format!(r#"{{"format_version":1,"name":"n","id":"n","kind":"freeform","inputs":["image","text"],
            "base_model":{{"file":"Q4.gguf","arch":"qwen3vl","name":"qwen3vl","size":"2B","mmproj":{{"file":"a.gguf","sha256":"{want}"}}}},
            "prompt_template":"{{input}}","output_contract":{{"type":"text","max_tokens":4}}}}"#);
        let pigeon = build_store_zip(&[("pigeon.json", manifest.as_bytes()), ("adapter.lora.gguf", &lora_bytes())]);
        let folders = Folders { base_dirs: vec![models.clone()], projector_dirs: vec![projectors.clone()], embedding_dirs: vec![] };
        let mut cache = crate::hashes::HashCache::open(&root.join("hashes.json"));
        let got = for_pigeon(&folders, &pigeon, &mut cache);
        let sha_of = |file: &str| got.bases.iter().find(|b| b.file == file).and_then(|b| b.sha256.clone());
        assert!(sha_of("Q4.gguf").is_some(), "the file the Pigeon was measured on is hashed");
        assert!(sha_of("Q8.gguf").is_none(), "another file of the base is not");
        // D61: but every hash already known is used — for registry_disagrees too.
        cache.record(&models.join("Q8.gguf"), "88").unwrap();
        let again = for_pigeon(&folders, &pigeon, &mut cache);
        assert_eq!(again.bases.iter().find(|b| b.file == "Q8.gguf").and_then(|b| b.sha256.as_deref()), Some("88"));
        assert_eq!(got.projectors, vec![want.clone()], "projectors are hashed until the one it names is found");
        assert!(cache.known(&projectors.join("b.gguf")).is_none());
        let _ = std::fs::remove_dir_all(&root);
    }
}
