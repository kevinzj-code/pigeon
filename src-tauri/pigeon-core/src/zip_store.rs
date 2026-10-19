//! A reader for ZIP archives in STORE mode — no inflate, no `zip` crate.
//!
//! The `.pigeon`/`.nest` format spec (Flight School's `PIGEON-FORMAT.md`, §1)
//! guarantees every file in the archive is written uncompressed: the adapter
//! is already dense, so there is nothing deflate would save. That guarantee is
//! what makes a from-scratch reader small enough to be worth it instead of
//! pulling in the `zip` crate and its deflate dependency tree for a format
//! this app never writes, only opens.
//!
//! Three records, read back to front because that is the only order a ZIP
//! can be found in without scanning the whole file: the End Of Central
//! Directory record names where the central directory starts; the central
//! directory names every entry and where its local header is; the local
//! header is where the bytes actually start.

const EOCD_SIG: u32 = 0x0605_4b50;
const CDIR_SIG: u32 = 0x0201_4b50;
const LOCAL_SIG: u32 = 0x0403_4b50;
/// The largest a comment field can be (u16) — only used to say WHY a file
/// whose end record is not at the very end was refused.
const EOCD_SEARCH_WINDOW: usize = 22 + 65535;
const EOCD_LEN: usize = 22;
const CDIR_LEN: usize = 46;
const LOCAL_LEN: usize = 30;
/// The seal spec's strict rules: at most this many entries, names at most
/// this many bytes.
const MAX_ENTRIES: usize = 4096;
const MAX_NAME_BYTES: usize = 255;
/// UTF-8 name flag — the only general-purpose flag a packer may set.
const FLAG_UTF8: u16 = 0x0800;

pub struct Entry {
    pub name: String,
    local_header_offset: u32,
    compressed_size: u32,
    compression_method: u16,
    data_start: usize,
}

impl Entry {
    /// This entry's bytes. `list_entries` has already proved they lie inside
    /// `bytes`; handed a different buffer it returns nothing rather than panic.
    pub fn data<'a>(&self, bytes: &'a [u8]) -> &'a [u8] {
        bytes.get(self.data_start..self.data_start + self.compressed_size as usize).unwrap_or(&[])
    }
}

/// `^[A-Za-z0-9_-][A-Za-z0-9._-]*(/[A-Za-z0-9_-][A-Za-z0-9._-]*)*$`, on raw
/// bytes, at most 255 of them. Rules out `..`, `./`, a leading or trailing
/// `/`, backslashes, NUL, control characters and anything non-ASCII.
fn name_is_allowed(name: &[u8]) -> bool {
    if name.is_empty() || name.len() > MAX_NAME_BYTES {
        return false;
    }
    name.split(|&b| b == b'/').all(|segment| match segment.split_first() {
        Some((&first, rest)) => {
            (first.is_ascii_alphanumeric() || matches!(first, b'_' | b'-'))
                && rest.iter().all(|&b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'))
        }
        None => false,
    })
}

fn u16_at(b: &[u8], o: usize) -> Option<u16> {
    b.get(o..o + 2).map(|s| u16::from_le_bytes([s[0], s[1]]))
}

fn u32_at(b: &[u8], o: usize) -> Option<u32> {
    b.get(o..o + 4).map(|s| u32::from_le_bytes([s[0], s[1], s[2], s[3]]))
}

/// Whether the bytes have a ZIP end record anywhere it could be — the line
/// between "not a ZIP at all" (`not_a_zip`) and a ZIP that breaks a strict
/// rule (`bad_zip`), spec §7.3 step 1.
pub fn has_end_record(bytes: &[u8]) -> bool {
    let tail = &bytes[bytes.len().saturating_sub(EOCD_SEARCH_WINDOW)..];
    tail.windows(4).any(|w| w == EOCD_SIG.to_le_bytes())
}

/// Every entry in the archive, in central-directory order — or a refusal of
/// the WHOLE file. The seal spec's strict rules are enforced here, so no
/// caller can see an archive two ZIP readers would disagree about: plain
/// ASCII names, no duplicates (not even by case), stored entries with flags
/// 0 or 0x800, local headers that agree with the central directory, and a
/// layout with no byte unaccounted for — entries back to back from offset 0,
/// the central directory straight after, the end record in the last 22 bytes
/// with no comment, no zip64, at most 4096 entries.
pub fn list_entries(bytes: &[u8]) -> Result<Vec<Entry>, String> {
    let len = bytes.len();
    if len < EOCD_LEN || u32_at(bytes, len - EOCD_LEN) != Some(EOCD_SIG) {
        let tail = &bytes[len.saturating_sub(EOCD_SEARCH_WINDOW)..];
        let elsewhere = tail.windows(4).any(|w| w == EOCD_SIG.to_le_bytes());
        return Err(if elsewhere {
            "the end-of-central-directory record is not at the very end — the file has a comment or trailing bytes".into()
        } else {
            "not a ZIP file — no end-of-central-directory record".into()
        });
    }
    let eocd = len - EOCD_LEN;
    // In range: the record's 22 bytes were just found.
    let e16 = |o: usize| u16_at(bytes, eocd + o).unwrap_or(u16::MAX);
    let e32 = |o: usize| u32_at(bytes, eocd + o).unwrap_or(u32::MAX);
    let (disk, cd_disk, on_disk, count) = (e16(4), e16(6), e16(8), e16(10));
    let (cd_size, cd_offset) = (e32(12), e32(16));
    if e16(20) != 0 {
        return Err("the archive has a comment, which a packer never writes".into());
    }
    if cd_offset == 0xFFFF_FFFF || cd_size == 0xFFFF_FFFF || count == 0xFFFF || on_disk == 0xFFFF {
        return Err("zip64 archives are not supported".into());
    }
    if disk != 0 || cd_disk != 0 {
        return Err("split archives are not supported".into());
    }
    if on_disk != count {
        return Err("the end-of-central-directory record disagrees with itself about the entry count".into());
    }
    let count = count as usize;
    if count > MAX_ENTRIES {
        return Err(format!("{count} entries — more than the {MAX_ENTRIES} a Pigeon may hold"));
    }
    let (cd_offset, cd_size) = (cd_offset as usize, cd_size as usize);
    if cd_offset + cd_size != eocd {
        return Err("the central directory does not end where the end record begins".into());
    }

    let mut out = Vec::with_capacity(count);
    let mut seen = std::collections::HashSet::with_capacity(count);
    let mut pos = cd_offset;
    let mut next_local = 0usize;
    for _ in 0..count {
        let c = bytes.get(pos..eocd).filter(|c| c.len() >= CDIR_LEN).ok_or("truncated central directory entry")?;
        if u32_at(c, 0) != Some(CDIR_SIG) {
            return Err("malformed central directory".into());
        }
        let c16 = |o: usize| u16_at(c, o).unwrap_or(u16::MAX);
        let c32 = |o: usize| u32_at(c, o).unwrap_or(u32::MAX);
        let (flags, method) = (c16(8), c16(10));
        let (compressed_size, uncompressed_size) = (c32(20), c32(24));
        let (name_len, extra_len, comment_len) = (c16(28) as usize, c16(30) as usize, c16(32) as usize);
        let local_header_offset = c32(42);
        let raw_name = c.get(CDIR_LEN..CDIR_LEN + name_len).ok_or("truncated central directory entry")?;
        if !name_is_allowed(raw_name) {
            return Err(format!("entry name {:?} is not allowed in a Pigeon", String::from_utf8_lossy(raw_name)));
        }
        // ASCII, just checked.
        let name = String::from_utf8_lossy(raw_name).into_owned();
        if !seen.insert(name.to_ascii_lowercase()) {
            return Err(format!("{name} appears twice (names may not differ only by case)"));
        }
        if flags & !FLAG_UTF8 != 0 {
            return Err(format!("{name}: general-purpose flags {flags:#06x} — only 0 or 0x0800 are allowed"));
        }
        if method != 0 {
            return Err(format!("{name} is compressed — this reader only trusts store-mode ZIPs"));
        }
        if compressed_size == 0xFFFF_FFFF || uncompressed_size == 0xFFFF_FFFF {
            return Err("zip64 archives are not supported".into());
        }
        if compressed_size != uncompressed_size {
            return Err(format!("{name}: stored, but its compressed and uncompressed sizes differ"));
        }
        if local_header_offset as usize != next_local {
            return Err(format!("{name} does not start where the previous entry ends — the archive has gaps or extra bytes"));
        }

        let l = bytes.get(next_local..cd_offset).filter(|l| l.len() >= LOCAL_LEN).ok_or(format!("{name}: truncated local file header"))?;
        if u32_at(l, 0) != Some(LOCAL_SIG) {
            return Err(format!("{name}: malformed local file header"));
        }
        let l16 = |o: usize| u16_at(l, o).unwrap_or(u16::MAX);
        let l32 = |o: usize| u32_at(l, o).unwrap_or(u32::MAX);
        let (local_name_len, local_extra_len) = (l16(26) as usize, l16(28) as usize);
        let local_name = l.get(LOCAL_LEN..LOCAL_LEN + local_name_len);
        if l16(6) & !FLAG_UTF8 != 0 {
            return Err(format!("{name}: general-purpose flags {:#06x} in its local header — only 0 or 0x0800 are allowed", l16(6)));
        }
        if local_name != Some(raw_name) || l16(8) != method || l32(18) != compressed_size || l32(22) != uncompressed_size {
            return Err(format!("{name}: the local file header disagrees with the central directory"));
        }
        let data_start = next_local + LOCAL_LEN + local_name_len + local_extra_len;
        let data_end = data_start + compressed_size as usize;
        if data_end > cd_offset {
            return Err(format!("{name}: entry data runs into the central directory"));
        }
        out.push(Entry { name, local_header_offset, compressed_size, compression_method: method, data_start });
        next_local = data_end;
        pos += CDIR_LEN + name_len + extra_len + comment_len;
    }
    if next_local != cd_offset {
        return Err("the central directory does not start where the last entry's data ends".into());
    }
    if pos != eocd {
        return Err("the central directory's size does not match its entries".into());
    }
    Ok(out)
}

/// One entry's bytes by name, or `None` if no entry has that name.
///
/// Errs if the entry exists but is not stored (compression method != 0) — a
/// `.pigeon` this reader cannot trust is one it should refuse, not
/// misinterpret as truncated garbage.
pub fn read(bytes: &[u8], name: &str) -> Result<Option<Vec<u8>>, String> {
    Ok(get(&list_entries(bytes)?, bytes, name)?.map(<[u8]>::to_vec))
}

/// One entry's bytes by name, borrowed from `bytes`, against a directory the
/// caller already listed — an import reads several entries and an adapter is
/// tens of megabytes, so neither the directory nor the data is re-made per read.
pub fn get<'a>(entries: &[Entry], bytes: &'a [u8], name: &str) -> Result<Option<&'a [u8]>, String> {
    let Some(e) = entries.iter().find(|e| e.name == name) else { return Ok(None) };
    if e.compression_method != 0 {
        return Err(format!("{name} is compressed — this reader only trusts store-mode ZIPs"));
    }
    let pos = e.local_header_offset as usize;
    if u32_at(bytes, pos) != Some(LOCAL_SIG) {
        return Err(format!("{name}: malformed local file header"));
    }
    let name_len = u16_at(bytes, pos + 26).ok_or("truncated local file header")? as usize;
    let extra_len = u16_at(bytes, pos + 28).ok_or("truncated local file header")? as usize;
    let data_start = pos + 30 + name_len + extra_len;
    let data_end = data_start + e.compressed_size as usize;
    bytes.get(data_start..data_end).map(Some).ok_or(format!("{name}: entry data runs past the end of the file"))
}

#[cfg(any(test, feature = "test-support"))]
pub mod test_support {
    //! A minimal store-mode ZIP *writer*, used only to build fixtures for this
    //! module's own tests and `pigeon.rs`'s. Never compiled into the app.
    fn crc32(data: &[u8]) -> u32 {
        let mut table = [0u32; 256];
        for (i, t) in table.iter_mut().enumerate() {
            let mut c = i as u32;
            for _ in 0..8 {
                c = if c & 1 != 0 { 0xEDB8_8320 ^ (c >> 1) } else { c >> 1 };
            }
            *t = c;
        }
        let mut crc = 0xFFFF_FFFFu32;
        for &b in data {
            crc = table[((crc ^ b as u32) & 0xFF) as usize] ^ (crc >> 8);
        }
        crc ^ 0xFFFF_FFFF
    }

    /// One entry for `build_raw_zip`, with every knob a malformed fixture
    /// needs. The defaults write exactly what a packer writes.
    #[derive(Clone, Default)]
    pub struct RawEntry<'a> {
        pub name: &'a [u8],
        pub data: &'a [u8],
        pub flags: u16,
        pub method: u16,
        /// A different name in the local header only.
        pub local_name: Option<&'a [u8]>,
        /// A different compressed AND uncompressed size in the local header only.
        pub local_size: Option<u32>,
        /// A different uncompressed size in both headers.
        pub uncompressed_size: Option<u32>,
        /// Bytes written before this entry's local header.
        pub gap_before: &'a [u8],
    }

    pub fn entry<'a>(name: &'a str, data: &'a [u8]) -> RawEntry<'a> {
        RawEntry { name: name.as_bytes(), data, ..Default::default() }
    }

    /// Write `entries`, after `prepend` and with `gap_before_cd` between the
    /// last entry and the central directory. Every offset the headers record
    /// is the TRUE one, so a lenient reader would accept the stray bytes —
    /// the only thing wrong is the one thing a test asks for.
    pub fn build_raw_zip(entries: &[RawEntry], prepend: &[u8], gap_before_cd: &[u8]) -> Vec<u8> {
        let mut out = prepend.to_vec();
        let mut central = Vec::new();
        for e in entries {
            out.extend_from_slice(e.gap_before);
            let offset = out.len() as u32;
            let crc = crc32(e.data);
            let size = e.data.len() as u32;
            let usize_ = e.uncompressed_size.unwrap_or(size);
            let local_name = e.local_name.unwrap_or(e.name);
            out.extend_from_slice(&0x0403_4b50u32.to_le_bytes());
            out.extend_from_slice(&20u16.to_le_bytes()); // version needed
            out.extend_from_slice(&e.flags.to_le_bytes());
            out.extend_from_slice(&e.method.to_le_bytes());
            out.extend_from_slice(&0u16.to_le_bytes()); // time
            out.extend_from_slice(&0u16.to_le_bytes()); // date
            out.extend_from_slice(&crc.to_le_bytes());
            out.extend_from_slice(&e.local_size.unwrap_or(size).to_le_bytes()); // compressed size
            out.extend_from_slice(&e.local_size.unwrap_or(usize_).to_le_bytes()); // uncompressed size
            out.extend_from_slice(&(local_name.len() as u16).to_le_bytes());
            out.extend_from_slice(&0u16.to_le_bytes()); // extra len
            out.extend_from_slice(local_name);
            out.extend_from_slice(e.data);

            central.extend_from_slice(&0x0201_4b50u32.to_le_bytes());
            central.extend_from_slice(&20u16.to_le_bytes()); // version made by
            central.extend_from_slice(&20u16.to_le_bytes()); // version needed
            central.extend_from_slice(&e.flags.to_le_bytes());
            central.extend_from_slice(&e.method.to_le_bytes());
            central.extend_from_slice(&0u16.to_le_bytes()); // time
            central.extend_from_slice(&0u16.to_le_bytes()); // date
            central.extend_from_slice(&crc.to_le_bytes());
            central.extend_from_slice(&size.to_le_bytes());
            central.extend_from_slice(&usize_.to_le_bytes());
            central.extend_from_slice(&(e.name.len() as u16).to_le_bytes());
            central.extend_from_slice(&0u16.to_le_bytes()); // extra len
            central.extend_from_slice(&0u16.to_le_bytes()); // comment len
            central.extend_from_slice(&0u16.to_le_bytes()); // disk start
            central.extend_from_slice(&0u16.to_le_bytes()); // internal attrs
            central.extend_from_slice(&0u32.to_le_bytes()); // external attrs
            central.extend_from_slice(&offset.to_le_bytes());
            central.extend_from_slice(e.name);
        }
        out.extend_from_slice(gap_before_cd);
        let cd_start = out.len() as u32;
        out.extend_from_slice(&central);
        out.extend_from_slice(&0x0605_4b50u32.to_le_bytes());
        out.extend_from_slice(&0u16.to_le_bytes()); // disk number
        out.extend_from_slice(&0u16.to_le_bytes()); // disk with CD start
        out.extend_from_slice(&(entries.len() as u16).to_le_bytes());
        out.extend_from_slice(&(entries.len() as u16).to_le_bytes());
        out.extend_from_slice(&(central.len() as u32).to_le_bytes());
        out.extend_from_slice(&cd_start.to_le_bytes());
        out.extend_from_slice(&0u16.to_le_bytes()); // comment len
        out
    }

    /// Build a store-mode ZIP holding `files` (name, content) in order —
    /// contiguous from offset 0, flags 0, exactly what the packer writes.
    pub fn build_store_zip(files: &[(&str, &[u8])]) -> Vec<u8> {
        let entries: Vec<RawEntry> = files.iter().map(|(n, d)| entry(n, d)).collect();
        build_raw_zip(&entries, &[], &[])
    }

    /// A single entry written with a bogus (non-zero) compression method, to
    /// exercise the "refuses a compressed entry" path without a real deflate
    /// stream.
    pub fn build_fake_deflated_zip(name: &str, data: &[u8]) -> Vec<u8> {
        build_raw_zip(&[RawEntry { method: 8, ..entry(name, data) }], &[], &[])
    }

    /// Give the end record a comment: its length field set, its bytes appended.
    pub fn add_eocd_comment(zip: &mut Vec<u8>, comment: &[u8]) {
        let at = zip.len() - 2;
        zip[at..].copy_from_slice(&(comment.len() as u16).to_le_bytes());
        zip.extend_from_slice(comment);
    }
}

#[cfg(test)]
mod tests {
    use super::test_support::{build_fake_deflated_zip, build_store_zip};
    use super::*;

    #[test]
    fn round_trips_a_store_mode_fixture() {
        let zip = build_store_zip(&[("pigeon.json", b"{\"a\":1}"), ("adapter.lora.gguf", b"GGUF-ish bytes")]);
        let entries = list_entries(&zip).expect("list");
        let names: Vec<&str> = entries.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, ["pigeon.json", "adapter.lora.gguf"]);
        assert_eq!(read(&zip, "pigeon.json").unwrap().unwrap(), b"{\"a\":1}");
        assert_eq!(read(&zip, "adapter.lora.gguf").unwrap().unwrap(), b"GGUF-ish bytes");
        assert!(read(&zip, "nope.txt").unwrap().is_none());
    }

    #[test]
    fn refuses_a_compressed_entry() {
        let zip = build_fake_deflated_zip("pigeon.json", b"whatever");
        assert!(read(&zip, "pigeon.json").is_err());
    }

    #[test]
    fn refuses_something_that_is_not_a_zip_at_all() {
        assert!(list_entries(b"not a zip file").is_err());
    }

    /* ── the seal spec's strict rules ─────────────────────────────────────── */

    use super::test_support::{add_eocd_comment, build_raw_zip, entry, RawEntry};

    fn refused(zip: &[u8], why: &str) {
        match list_entries(zip) {
            Ok(_) => panic!("accepted a zip that should be refused: {why}"),
            Err(e) => assert!(!e.is_empty(), "{why}"),
        }
    }

    fn one_named(name: &[u8]) -> Vec<u8> {
        build_raw_zip(&[RawEntry { name, data: b"x", ..Default::default() }], &[], &[])
    }

    #[test]
    fn names_outside_the_pattern_are_refused() {
        let long = vec![b'a'; 256];
        let bad: [&[u8]; 16] = [
            b"a\nb", b"..", b"../x", b"./x", b"a\\b", b"a\0b", b"/abs", b"dir/", b"caf\xc3\xa9", &long, b"",
            b".hidden", b"a//b", b"a b", b"x/../y", b"a:b",
        ];
        for name in bad {
            refused(&one_named(name), &format!("name {:?}", String::from_utf8_lossy(name)));
        }
        let long_ok = vec![b'a'; 255];
        for good in [&long_ok[..], b"pigeon.json", b"material/chunks.json", b"code/a-b_c.1.js", b"_x", b"-x/y..z"] {
            assert!(list_entries(&one_named(good)).is_ok(), "{:?}", String::from_utf8_lossy(good));
        }
    }

    #[test]
    fn duplicate_names_and_case_collisions_are_refused() {
        refused(&build_store_zip(&[("a.txt", b"1"), ("a.txt", b"2")]), "duplicate");
        refused(&build_store_zip(&[("A.txt", b"1"), ("a.txt", b"2")]), "case collision");
    }

    #[test]
    fn stray_bytes_anywhere_are_refused() {
        let gap = build_raw_zip(&[entry("a", b"1"), RawEntry { gap_before: b"zz", ..entry("b", b"2") }], &[], &[]);
        refused(&gap, "gap between entries");
        refused(&build_raw_zip(&[entry("a", b"1")], &[], b"zz"), "gap before the central directory");
        refused(&build_raw_zip(&[entry("a", b"1")], b"PK", &[]), "prepended bytes");
        let mut trailing = build_store_zip(&[("a", b"1")]);
        trailing.extend_from_slice(b"zz");
        refused(&trailing, "trailing bytes");
        let mut comment = build_store_zip(&[("a", b"1")]);
        add_eocd_comment(&mut comment, b"hi");
        refused(&comment, "EOCD comment");
        let mut length_only = build_store_zip(&[("a", b"1")]);
        let at = length_only.len() - 2;
        length_only[at] = 2;
        refused(&length_only, "EOCD comment length without the bytes");
    }

    #[test]
    fn flags_other_than_utf8_are_refused() {
        refused(&build_raw_zip(&[RawEntry { flags: 0x0008, ..entry("a", b"1") }], &[], &[]), "flag bit 3");
        refused(&build_raw_zip(&[RawEntry { flags: 0x0001, ..entry("a", b"1") }], &[], &[]), "flag bit 0");
        assert!(list_entries(&build_raw_zip(&[RawEntry { flags: 0x0800, ..entry("a", b"1") }], &[], &[])).is_ok());
    }

    #[test]
    fn compressed_entries_and_size_disagreements_are_refused() {
        refused(&build_raw_zip(&[RawEntry { method: 8, ..entry("a", b"1") }], &[], &[]), "deflate");
        refused(&build_raw_zip(&[RawEntry { uncompressed_size: Some(99), ..entry("a", b"1") }], &[], &[]), "csize != usize");
        refused(&build_raw_zip(&[RawEntry { local_name: Some(b"b"), ..entry("a", b"1") }], &[], &[]), "local name");
        refused(&build_raw_zip(&[RawEntry { local_size: Some(0), ..entry("a", b"1") }], &[], &[]), "local size");
    }

    #[test]
    fn too_many_entries_or_zip64_are_refused() {
        let names: Vec<String> = (0..4097).map(|i| format!("e{i}")).collect();
        let entries: Vec<RawEntry> = names.iter().map(|n| entry(n, b"")).collect();
        refused(&build_raw_zip(&entries, &[], &[]), "4097 entries");
        assert!(list_entries(&build_raw_zip(&entries[..4096], &[], &[])).is_ok());
        let mut zip64 = build_store_zip(&[("a", b"1")]);
        let at = zip64.len() - 12;
        zip64[at..at + 2].copy_from_slice(&[0xFF, 0xFF]);
        refused(&zip64, "zip64 count sentinel");
    }

    #[test]
    fn entry_data_is_read_back_from_the_listing() {
        let zip = build_store_zip(&[("a", b"one"), ("b/c", b"two")]);
        let entries = list_entries(&zip).unwrap();
        assert_eq!(entries[1].data(&zip), b"two");
        assert_eq!(entries[0].data(b"short"), b"", "a different buffer gives nothing, not a panic");
    }
}
