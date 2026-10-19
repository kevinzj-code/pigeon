//! What this Mac knows of its model files' sha256: one cache file for the app,
//! `pigeon-hashes.json` in its data folder — `pigeon-core`'s `HashCache`.
//!
//! The app no longer writes a `.sha256` marker beside a model. A marker an
//! earlier build wrote is still READ, once, when the cache knows nothing of
//! that file: it is what the downloader verified, and believing it saves
//! re-hashing gigabytes. It is copied into the cache and left where it is;
//! nothing here deletes or rewrites one.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};

use pigeon_core::hashes::HashCache;
use tauri::{AppHandle, Manager};

pub const FILE: &str = "pigeon-hashes.json";

/// One cache, shared by everything in the app that asks.
#[derive(Clone)]
pub struct Hashes(Arc<Mutex<HashCache>>);

/// Every cache opened in this process, by its path, so two callers asking for
/// the same file share one copy instead of overwriting each other's.
fn open() -> &'static Mutex<BTreeMap<PathBuf, Arc<Mutex<HashCache>>>> {
    static OPEN: OnceLock<Mutex<BTreeMap<PathBuf, Arc<Mutex<HashCache>>>>> = OnceLock::new();
    OPEN.get_or_init(Default::default)
}

/// `<file>.sha256`, the record an earlier build wrote beside a download.
fn legacy_marker(file: &Path) -> Option<String> {
    let mut s = file.as_os_str().to_owned();
    s.push(".sha256");
    let text = std::fs::read_to_string(PathBuf::from(s)).ok()?;
    let sha = text.trim().to_ascii_lowercase();
    (sha.len() == 64 && sha.bytes().all(|b| b.is_ascii_hexdigit())).then_some(sha)
}

impl Hashes {
    pub fn at(path: &Path) -> Hashes {
        let mut all = open().lock().unwrap_or_else(|p| p.into_inner());
        Hashes(all.entry(path.to_path_buf()).or_insert_with(|| Arc::new(Mutex::new(HashCache::open(path)))).clone())
    }

    fn with<T>(&self, f: impl FnOnce(&mut HashCache) -> T) -> T {
        let mut cache = self.0.lock().unwrap_or_else(|p| p.into_inner());
        let out = f(&mut cache);
        // A cache that cannot be written costs a re-hash later, nothing more.
        let _ = cache.save();
        out
    }

    /// The hash, when it is known without reading the file's bytes.
    pub fn known(&self, file: &Path) -> Option<String> {
        self.with(|c| {
            c.known(file).or_else(|| {
                let sha = legacy_marker(file)?;
                c.record(file, &sha).ok()?;
                Some(sha)
            })
        })
    }

    /// The hash, reading the file if it is not known.
    pub fn hash(&self, file: &Path) -> Option<String> {
        self.known(file).or_else(|| self.with(|c| c.hash(file).ok()))
    }

    /// A hash just verified another way: a finished download.
    pub fn record(&self, file: &Path, sha256: &str) {
        self.with(|c| {
            let _ = c.record(file, sha256);
        })
    }
}

/// The app's cache, in its own data folder.
pub fn of<R: tauri::Runtime>(app: &AppHandle<R>) -> Hashes {
    let dir = app.path().app_data_dir().unwrap_or_else(|_| std::env::temp_dir().join("mode.airoplane.pigeon"));
    Hashes::at(&dir.join(FILE))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_old_marker_is_read_once_into_the_cache_and_left_alone() {
        let root = std::env::temp_dir().join(format!("pigeon-test-hashes-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let model = root.join("m.gguf");
        std::fs::write(&model, b"weights").unwrap();
        let sha = pigeon_core::hashes::sha256_file(&model).unwrap();
        let marker = root.join("m.gguf.sha256");
        std::fs::write(&marker, format!("{sha}\n")).unwrap();
        let hashes = Hashes::at(&root.join("cache").join(FILE));
        assert_eq!(hashes.known(&model).as_deref(), Some(sha.as_str()));
        assert!(marker.is_file(), "an old marker is never deleted");
        std::fs::remove_file(&marker).unwrap();
        assert_eq!(hashes.known(&model).as_deref(), Some(sha.as_str()), "the cache has it now");
        // A new file gets no marker: what is learned goes to the cache only.
        let other = root.join("n.gguf");
        std::fs::write(&other, b"n").unwrap();
        assert!(hashes.hash(&other).is_some());
        let names: Vec<String> = std::fs::read_dir(&root).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).collect();
        assert!(!names.iter().any(|n| n.ends_with(".sha256")), "{names:?}");
        let _ = std::fs::remove_dir_all(&root);
    }
}
