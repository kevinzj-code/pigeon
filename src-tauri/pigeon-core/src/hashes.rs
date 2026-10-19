//! What a model file's sha256 is, without hashing gigabytes every launch
//! (INTERFACE.md §5.1, E11).
//!
//! One file per host, at a path the host names, mapping a model file's path to
//! its size, its modified time and its sha256. Nothing is ever written into a
//! model folder. An entry is believed only while the file's size and modified
//! time are still the ones it was hashed at; otherwise it is hashed again.
//!
//! - Nothing is hashed at launch. A file is hashed the first time something
//!   needs its hash (`hash`).
//! - A projector is hashed again each time it is loaded (`rehash`): there the
//!   hash is the rule, and a file swapped in place with the same size and time
//!   would otherwise be believed.
//! - A download is hashed to be verified, so that hash is kept (`record`).
//!
//! A cache that is missing or unreadable is an empty one. It is never a reason
//! for anything to fail; at worst a file is hashed again.

use std::collections::BTreeMap;
use std::io::Read;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

const VERSION: u32 = 1;

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
struct Entry {
    bytes: u64,
    /// Nanoseconds since the Unix epoch.
    modified_ns: u64,
    sha256: String,
}

#[derive(Serialize, Deserialize, Default)]
struct OnDisk {
    version: u32,
    files: BTreeMap<String, Entry>,
}

pub struct HashCache {
    path: PathBuf,
    files: BTreeMap<String, Entry>,
    dirty: bool,
}

/// The size and modified time a file has now.
fn stamp(file: &Path) -> std::io::Result<(u64, u64)> {
    let meta = std::fs::metadata(file)?;
    let modified = meta.modified()?.duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos() as u64).unwrap_or(0);
    Ok((meta.len(), modified))
}

fn key(file: &Path) -> String {
    file.canonicalize().unwrap_or_else(|_| file.to_path_buf()).to_string_lossy().into_owned()
}

/// The sha256 of a file's bytes, read a megabyte at a time.
pub fn sha256_file(file: &Path) -> std::io::Result<String> {
    let mut f = std::fs::File::open(file)?;
    let mut h = Sha256::new();
    let mut buf = vec![0u8; 1 << 20];
    loop {
        let n = f.read(&mut buf)?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
    }
    Ok(crate::seal::to_hex(&h.finalize()))
}

impl HashCache {
    /// The cache at `path`. Missing, unreadable or from another version, it
    /// starts empty.
    pub fn open(path: &Path) -> HashCache {
        let files = std::fs::read(path)
            .ok()
            .and_then(|raw| serde_json::from_slice::<OnDisk>(&raw).ok())
            .filter(|d| d.version == VERSION)
            .map(|d| d.files)
            .unwrap_or_default();
        HashCache { path: path.to_path_buf(), files, dirty: false }
    }

    /// The hash, if it is already known for the file as it is now. Never reads
    /// the file's bytes.
    pub fn known(&self, file: &Path) -> Option<String> {
        let e = self.files.get(&key(file))?;
        let (bytes, modified_ns) = stamp(file).ok()?;
        (e.bytes == bytes && e.modified_ns == modified_ns).then(|| e.sha256.clone())
    }

    /// The hash: the known one, or the file read and hashed now and kept.
    pub fn hash(&mut self, file: &Path) -> std::io::Result<String> {
        match self.known(file) {
            Some(sha) => Ok(sha),
            None => self.rehash(file),
        }
    }

    /// The file hashed now, whatever is known — what a projector gets each
    /// time it is loaded.
    pub fn rehash(&mut self, file: &Path) -> std::io::Result<String> {
        let before = stamp(file)?;
        let sha = sha256_file(file)?;
        // A file that changed while it was read is not recorded.
        if stamp(file)? == before {
            self.put(file, before, &sha);
        }
        Ok(sha)
    }

    /// A hash learned another way — a download that was just verified.
    pub fn record(&mut self, file: &Path, sha256: &str) -> std::io::Result<()> {
        let now = stamp(file)?;
        self.put(file, now, &sha256.to_ascii_lowercase());
        Ok(())
    }

    fn put(&mut self, file: &Path, (bytes, modified_ns): (u64, u64), sha: &str) {
        let entry = Entry { bytes, modified_ns, sha256: sha.to_string() };
        if self.files.insert(key(file), entry.clone()).as_ref() != Some(&entry) {
            self.dirty = true;
        }
    }

    /// Write the cache if anything changed: to a temporary file beside it,
    /// then renamed over it, so a reader never sees half a cache.
    pub fn save(&mut self) -> std::io::Result<()> {
        if !self.dirty {
            return Ok(());
        }
        if let Some(dir) = self.path.parent().filter(|d| !d.as_os_str().is_empty()) {
            std::fs::create_dir_all(dir)?;
        }
        let body = serde_json::to_vec_pretty(&OnDisk { version: VERSION, files: self.files.clone() }).map_err(std::io::Error::other)?;
        let tmp = self.path.with_extension("part");
        std::fs::write(&tmp, body)?;
        std::fs::rename(&tmp, &self.path)?;
        self.dirty = false;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_hash_is_kept_believed_while_the_file_is_unchanged_and_never_written_beside_it() {
        let root = std::env::temp_dir().join(format!("pigeon-core-hashes-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let models = root.join("models");
        std::fs::create_dir_all(&models).unwrap();
        let file = models.join("base.gguf");
        std::fs::write(&file, b"weights").unwrap();
        let at = root.join("cache").join("pigeon-hashes.json");

        let mut cache = HashCache::open(&at);
        assert_eq!(cache.known(&file), None, "nothing is hashed until it is asked for");
        let sha = cache.hash(&file).unwrap();
        assert_eq!(sha, sha256_file(&file).unwrap());
        cache.save().unwrap();
        assert_eq!(std::fs::read_dir(&models).unwrap().count(), 1, "nothing is written into a model folder");

        // Another launch believes it without reading the file.
        let reopened = HashCache::open(&at);
        assert_eq!(reopened.known(&file).as_deref(), Some(sha.as_str()));

        // A different size is a different file: not believed.
        std::fs::write(&file, b"other weights").unwrap();
        assert_eq!(reopened.known(&file), None);
        let mut reopened = reopened;
        assert_ne!(reopened.hash(&file).unwrap(), sha);

        // A download records what it verified; a broken cache is an empty one.
        let fetched = models.join("fetched.gguf");
        std::fs::write(&fetched, b"f").unwrap();
        reopened.record(&fetched, &sha256_file(&fetched).unwrap().to_ascii_uppercase()).unwrap();
        assert_eq!(reopened.known(&fetched), Some(sha256_file(&fetched).unwrap()));
        std::fs::write(&at, b"not json").unwrap();
        assert_eq!(HashCache::open(&at).known(&fetched), None);
        let _ = std::fs::remove_dir_all(&root);
    }
}
