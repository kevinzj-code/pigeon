//! The bytes of an opened `.pigeon`, without reading them into memory.
//!
//! A picture Pigeon carries its projector (decided 2026-09-21), so the file is
//! ~875 MB where a text Pigeon is ~21 MB. Reading that into a `Vec` — and then
//! copying it again to hold it while the person decides — cost two gigabytes
//! of RAM on a machine whose models already take most of its memory.
//!
//! A `Blob` is the file memory-mapped, read-only: the kernel pages in what is
//! actually touched — the ZIP directory, the manifest, the adapter — and the
//! projector's pages only when they are hashed or written out. Every function
//! that took `&[u8]` still does; a `Blob` derefs to one. Held imports share it
//! through an `Arc` rather than copying it.
//!
//! One risk, stated rather than hidden: if the file is truncated while mapped,
//! touching the missing pages raises SIGBUS. A `.pigeon` a person just picked
//! is not being written to, and the window is the minutes between "Add" and
//! "Yes".

use std::ops::Deref;
use std::path::{Path, PathBuf};

pub enum Blob {
    Mapped { ptr: *mut libc::c_void, len: usize, path: PathBuf },
    /// A member of a `.nest`, or a test's bytes.
    Owned(Vec<u8>),
}

// The mapping is read-only and never written through, so sharing it across
// threads is sharing an immutable slice.
unsafe impl Send for Blob {}
unsafe impl Sync for Blob {}

impl Blob {
    pub fn open(path: &Path) -> std::io::Result<Blob> {
        use std::os::fd::AsRawFd;
        let file = std::fs::File::open(path)?;
        let len = file.metadata()?.len() as usize;
        if len == 0 {
            return Ok(Blob::Owned(Vec::new()));
        }
        // SAFETY: a fresh read-only private mapping of a file we just opened;
        // the length is the file's own. Unmapped in Drop.
        let ptr = unsafe { libc::mmap(std::ptr::null_mut(), len, libc::PROT_READ, libc::MAP_PRIVATE, file.as_raw_fd(), 0) };
        if ptr == libc::MAP_FAILED {
            return Err(std::io::Error::last_os_error());
        }
        Ok(Blob::Mapped { ptr, len, path: path.to_path_buf() })
    }

    pub fn owned(bytes: Vec<u8>) -> Blob { Blob::Owned(bytes) }

    /// Where it came from, when it came from a file — so a kept copy can be a
    /// clone of that file (free on APFS) instead of a second gigabyte.
    pub fn source(&self) -> Option<&Path> {
        match self { Blob::Mapped { path, .. } => Some(path), Blob::Owned(_) => None }
    }
}

impl Deref for Blob {
    type Target = [u8];
    fn deref(&self) -> &[u8] {
        match self {
            // SAFETY: the mapping lives as long as `self` and is `len` long.
            Blob::Mapped { ptr, len, .. } => unsafe { std::slice::from_raw_parts(*ptr as *const u8, *len) },
            Blob::Owned(v) => v,
        }
    }
}

impl Drop for Blob {
    fn drop(&mut self) {
        if let Blob::Mapped { ptr, len, .. } = self {
            // SAFETY: exactly the mapping `open` made.
            unsafe { libc::munmap(*ptr, *len) };
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_mapped_file_reads_as_its_bytes_and_remembers_where_it_is() {
        let p = std::env::temp_dir().join(format!("pigeon-test-blob-{}", std::process::id()));
        std::fs::write(&p, b"PK\x05\x06 the bytes").unwrap();
        let b = Blob::open(&p).unwrap();
        assert_eq!(&b[..], b"PK\x05\x06 the bytes");
        assert_eq!(b.source(), Some(p.as_path()));
        drop(b);
        let _ = std::fs::remove_file(&p);
    }

    #[test]
    fn an_empty_file_is_an_empty_blob_not_a_failed_map() {
        let p = std::env::temp_dir().join(format!("pigeon-test-blob-empty-{}", std::process::id()));
        std::fs::write(&p, b"").unwrap();
        assert!(Blob::open(&p).unwrap().is_empty());
        let _ = std::fs::remove_file(&p);
    }
}
