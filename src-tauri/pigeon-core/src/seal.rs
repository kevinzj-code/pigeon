//! Checking a sealed `.pigeon` — `pigeon-seal-ed25519-v1`.
//!
//! A seal is `seal.json`, the LAST entry of the archive:
//! `{"scheme":"pigeon-seal-ed25519-v1","key":"<16 hex>","signature":"<128 hex>"}`.
//! `key` is the first 16 hex characters of sha256 of the raw 32-byte Ed25519
//! public key; `signature` is Ed25519 (RFC 8032, pure) over `seal_message`.
//! The strict ZIP rules the message depends on — one name per entry, no
//! stray bytes, nothing two readers could disagree about — are enforced by
//! `zip_store::list_entries` before this module ever sees an archive.
//!
//! Which keys are trusted is the host's decision (spec §15.2): `check` takes
//! the list, as plain public keys, and works each key's id out itself. A seal
//! by a key that is not on the list is `Sealed::Untrusted` — the caller
//! refuses it where trust is required and reports it otherwise. Revoking a
//! key is taking it off the list; there is nothing else to revoke it with.
//! A seal is never "probably fine".

use ring::signature::{UnparsedPublicKey, ED25519};
use serde::Deserialize;
use sha2::{Digest, Sha256};

use crate::zip_store::Entry;

pub const SEAL_FILE: &str = "seal.json";
pub const SCHEME: &str = "pigeon-seal-ed25519-v1";
const MESSAGE_HEADER: &[u8] = b"PIGEON-SEAL-V1\n";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Sealed {
    No,
    /// Verified, by the key with this id.
    By(String),
    /// Names a key the host does not trust. Nothing was verified: a seal
    /// carries only the key's id, so a Reader cannot check a signature by a
    /// key it does not hold.
    Untrusted { key: String, why: String },
}

pub fn to_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn is_lower_hex(s: &str, len: usize) -> bool {
    s.len() == len && s.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

/// Lowercase hex only — the caller has checked the format.
fn from_hex(s: &str) -> Vec<u8> {
    let nibble = |b: u8| if b.is_ascii_digit() { b - b'0' } else { b - b'a' + 10 };
    s.as_bytes().chunks(2).map(|p| nibble(p[0]) << 4 | nibble(p[1])).collect()
}

/// Hex to bytes, or `None` when it is not an even run of lowercase hex.
pub fn bytes_from_hex(s: &str) -> Option<Vec<u8>> {
    (s.len() % 2 == 0 && is_lower_hex(s, s.len())).then(|| from_hex(s))
}

/// The first 16 hex characters of sha256 of the raw public key.
pub fn key_id(public_key: &[u8]) -> String {
    to_hex(&Sha256::digest(public_key))[..16].to_string()
}

/// `PIGEON-SEAL-V1\n`, then for every entry except `seal.json`, sorted by
/// name bytes: the sha256 of its data (64 lowercase hex), two spaces, the
/// name, a newline. `entries` must come from `zip_store::list_entries(bytes)`.
pub fn seal_message(entries: &[Entry], bytes: &[u8]) -> Vec<u8> {
    let mut sealed: Vec<&Entry> = entries.iter().filter(|e| e.name != SEAL_FILE).collect();
    sealed.sort_by(|a, b| a.name.as_bytes().cmp(b.name.as_bytes()));
    let mut out = MESSAGE_HEADER.to_vec();
    for e in sealed {
        out.extend_from_slice(to_hex(&Sha256::digest(e.data(bytes))).as_bytes());
        out.extend_from_slice(b"  ");
        out.extend_from_slice(e.name.as_bytes());
        out.push(b'\n');
    }
    out
}

/// RFC 8032 §7.1 TEST 1 — published, so trusted under `cfg(test)` only.
#[cfg(any(test, feature = "test-support"))]
pub const TEST1_SEED_HEX: &str = "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60";

/// The TEST 1 public key, as a host lists a key it trusts: 64 hex characters.
#[cfg(any(test, feature = "test-support"))]
pub fn test_key() -> String {
    use ring::signature::KeyPair;
    let pair = ring::signature::Ed25519KeyPair::from_seed_unchecked(&from_hex(TEST1_SEED_HEX)).expect("TEST 1 seed");
    to_hex(pair.public_key().as_ref())
}

/// The id of a key a host lists: the first 16 hex characters of sha256 of its
/// 32 raw bytes. `None` when the text is not 64 hex characters.
pub fn key_id_of(public_key_hex: &str) -> Option<String> {
    let hex = public_key_hex.trim().to_ascii_lowercase();
    is_lower_hex(&hex, 64).then(|| key_id(&from_hex(&hex)))
}

/// Whether 32 bytes are a canonically written Ed25519 point: the y coordinate
/// (little-endian, the top bit aside) is below p = 2^255 − 19. One point must
/// have one spelling, or two readers could disagree about whose key this is
/// (spec §15.1). The verifier itself holds R to the same rule.
fn canonical_point(bytes: &[u8]) -> bool {
    let [low, middle @ .., high] = bytes else { return false };
    bytes.len() == 32 && !(*high & 0x7f == 0x7f && middle.iter().all(|b| *b == 0xff) && *low >= 0xed)
}

/// A JSON object as the pairs it was written with, so a key given twice is
/// seen rather than silently resolved — two readers must not be able to read
/// two different seals out of one file.
struct Pairs(Vec<(String, serde_json::Value)>);

impl<'de> Deserialize<'de> for Pairs {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Pairs, D::Error> {
        struct V;
        impl<'de> serde::de::Visitor<'de> for V {
            type Value = Pairs;
            fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
                f.write_str("a JSON object")
            }
            fn visit_map<A: serde::de::MapAccess<'de>>(self, mut map: A) -> Result<Pairs, A::Error> {
                let mut out = Vec::new();
                while let Some(pair) = map.next_entry()? {
                    out.push(pair);
                }
                Ok(Pairs(out))
            }
        }
        d.deserialize_map(V)
    }
}

/// Whether the archive is sealed, and by whom — or why its seal is broken.
/// No `seal.json` is `Sealed::No`; one present must be the last entry, hold
/// exactly the three keys in their exact formats, and — when it names a
/// trusted key — verify. `trusted` is the host's list for this purpose, as
/// public keys in hex; an entry that is not 64 hex characters is no key.
pub fn check(entries: &[Entry], bytes: &[u8], trusted: &[String]) -> Result<Sealed, String> {
    let at: Vec<usize> = entries.iter().enumerate().filter(|(_, e)| e.name == SEAL_FILE).map(|(i, _)| i).collect();
    let seal = match at.as_slice() {
        [] => return Ok(Sealed::No),
        [i] if *i + 1 == entries.len() => &entries[*i],
        [_] => return Err("seal.json must be the last entry in the file".into()),
        _ => return Err("seal.json appears more than once".into()),
    };
    let Pairs(pairs) = serde_json::from_slice(seal.data(bytes)).map_err(|e| format!("seal.json could not be read — {e}"))?;
    if pairs.iter().enumerate().any(|(i, (k, _))| pairs[..i].iter().any(|(earlier, _)| earlier == k)) {
        return Err("seal.json gives a key twice".into());
    }
    let obj: serde_json::Map<String, serde_json::Value> = pairs.into_iter().collect();
    let field = |k: &str| obj.get(k).and_then(|v| v.as_str());
    let (Some(scheme), Some(key), Some(signature), 3) = (field("scheme"), field("key"), field("signature"), obj.len())
    else {
        return Err("seal.json must hold exactly scheme, key and signature, each a string".into());
    };
    if scheme != SCHEME {
        return Err(format!("seal scheme \"{scheme}\" is not one this app knows"));
    }
    if !is_lower_hex(key, 16) {
        return Err("the seal's key is not 16 lowercase hex characters".into());
    }
    if !is_lower_hex(signature, 128) {
        return Err("the seal's signature is not 128 lowercase hex characters".into());
    }
    let Some(trusted_key) = trusted.iter().map(|k| k.trim().to_ascii_lowercase()).find(|k| key_id_of(k).as_deref() == Some(key)) else {
        return Ok(Sealed::Untrusted { key: key.to_string(), why: format!("sealed by key {key}, which this app does not trust") });
    };
    let public = from_hex(&trusted_key);
    if !canonical_point(&public) {
        return Err(format!("key {key} does not decode canonically, so nothing verifies against it"));
    }
    UnparsedPublicKey::new(&ED25519, &public)
        .verify(&seal_message(entries, bytes), &from_hex(signature))
        .map_err(|_| format!("the seal by key {key} does not match this file's contents"))?;
    Ok(Sealed::By(key.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::zip_store::{list_entries, test_support::build_store_zip};

    #[test]
    fn the_test_key_has_the_id_every_implementation_computes() {
        assert_eq!(test_key(), "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a");
        assert_eq!(key_id_of(&test_key()).as_deref(), Some("21fe31dfa154a261"));
        assert_eq!(key_id_of(&test_key().to_ascii_uppercase()).as_deref(), Some("21fe31dfa154a261"));
        assert_eq!(key_id_of("d75a"), None);
    }

    #[test]
    fn the_message_is_sorted_hashed_and_leaves_out_the_seal() {
        let zip = build_store_zip(&[("b.txt", b"B"), ("a/x.json", b"{}"), ("seal.json", b"{}")]);
        let msg = seal_message(&list_entries(&zip).unwrap(), &zip);
        let expected = "PIGEON-SEAL-V1\n\
            44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a  a/x.json\n\
            df7e70e5021544f4834bbee64a9e3789febc4be81470df629cad6ddb03320a5c  b.txt\n";
        assert_eq!(String::from_utf8(msg).unwrap(), expected);
    }

    #[test]
    fn a_seal_that_gives_a_key_twice_is_broken() {
        let twice = format!(r#"{{"scheme":"{SCHEME}","key":"{0}","key":"{0}","signature":"{1}"}}"#, "0".repeat(16), "0".repeat(128));
        let zip = build_store_zip(&[("pigeon.json", b"{}"), (SEAL_FILE, twice.as_bytes())]);
        assert!(check(&list_entries(&zip).unwrap(), &zip, &[test_key()]).unwrap_err().contains("twice"));
    }

    #[test]
    fn a_key_written_above_p_is_not_a_key() {
        assert!(canonical_point(&from_hex(&test_key())));
        let mut p_plus_one = [0xffu8; 32];
        (p_plus_one[0], p_plus_one[31]) = (0xee, 0x7f);
        assert!(!canonical_point(&p_plus_one));
        p_plus_one[0] = 0xec; // p − 1: the largest y there is
        assert!(canonical_point(&p_plus_one));
        assert!(!canonical_point(&[0u8; 31]));
    }

    #[test]
    fn no_seal_is_not_sealed() {
        let zip = build_store_zip(&[("pigeon.json", b"{}")]);
        assert_eq!(check(&list_entries(&zip).unwrap(), &zip, &[test_key()]), Ok(Sealed::No));
    }
}
