//! D74 and D79 (spec §13.1): two files that differ only in whether they carry
//! a stock projector are the same Pigeon. A host holding one and given the
//! other keeps the copy it can run, and the smaller when it can run both —
//! which copy that is depends on what the host has installed, so it is the
//! host's to decide. This module says only whether two files are the same
//! Pigeon in that sense, and which of them carries the projector.

use std::collections::BTreeMap;

use crate::manifest::PROJECTOR_FILE;
use crate::registry::Registry;
use crate::seal::{self, Sealed, SEAL_FILE};
use crate::zip_store;

/// How two files that are the same Pigeon differ.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Same {
    /// Byte for byte the same entries, seal aside.
    Identical,
    /// The first carries the stock projector and the second does not.
    FirstCarries,
    /// The second carries it and the first does not.
    SecondCarries,
}

/// Whether `a` and `b` are the same Pigeon by D74: every entry but
/// `projector.gguf` and `seal.json` byte-identical, under the same names; a
/// projector carried by only one of them must be a stock one, listed by one of
/// `registries`; and (D79) both unsealed, or both sealed by the same key with
/// seals that verify against `trusted`. `None` when they are not.
pub fn same_pigeon(a: &[u8], b: &[u8], trusted: &[String], registries: &[Registry]) -> Option<Same> {
    let (ea, eb) = (zip_store::list_entries(a).ok()?, zip_store::list_entries(b).ok()?);
    let sealed = |entries: &[zip_store::Entry], bytes: &[u8]| seal::check(entries, bytes, trusted).ok();
    match (sealed(&ea, a)?, sealed(&eb, b)?) {
        (Sealed::No, Sealed::No) => {}
        (Sealed::By(ka), Sealed::By(kb)) if ka == kb => {}
        _ => return None,
    }
    if rest(&ea, a)? != rest(&eb, b)? {
        return None;
    }
    let stock = |p: &[u8]| {
        let sha = crate::check::sha256_hex(p);
        registries.iter().any(|r| r.stock_projector(&sha).is_some())
    };
    match (projector(&ea, a), projector(&eb, b)) {
        (None, None) => Some(Same::Identical),
        (Some(pa), Some(pb)) => (pa == pb).then_some(Same::Identical),
        (Some(p), None) => stock(p).then_some(Same::FirstCarries),
        (None, Some(p)) => stock(p).then_some(Same::SecondCarries),
    }
}

/// Every entry but the projector and the seal, by name — `None` when a name
/// repeats, since that is not a file two readers agree on.
fn rest<'a>(entries: &'a [zip_store::Entry], bytes: &'a [u8]) -> Option<BTreeMap<&'a str, &'a [u8]>> {
    let mut out = BTreeMap::new();
    for e in entries.iter().filter(|e| e.name != PROJECTOR_FILE && e.name != SEAL_FILE) {
        if out.insert(e.name.as_str(), e.data(bytes)).is_some() {
            return None;
        }
    }
    Some(out)
}

fn projector<'a>(entries: &[zip_store::Entry], bytes: &'a [u8]) -> Option<&'a [u8]> {
    zip_store::get(entries, bytes, PROJECTOR_FILE).ok().flatten()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::check::Trust;
    use crate::registry::{self, REGISTRY_FILE};
    use crate::zip_store::test_support::build_store_zip;
    use ring::signature::{Ed25519KeyPair, KeyPair};

    fn sealed(files: &[(&str, &[u8])], seed: &[u8; 32]) -> (Vec<u8>, String) {
        let pair = Ed25519KeyPair::from_seed_unchecked(seed).unwrap();
        let key = seal::to_hex(pair.public_key().as_ref());
        let unsealed = build_store_zip(files);
        let message = seal::seal_message(&zip_store::list_entries(&unsealed).unwrap(), &unsealed);
        let json = format!(r#"{{"scheme":"{}","key":"{}","signature":"{}"}}"#, seal::SCHEME, seal::key_id_of(&key).unwrap(), seal::to_hex(pair.sign(&message).as_ref()));
        let mut all = files.to_vec();
        all.push((SEAL_FILE, json.as_bytes()));
        (build_store_zip(&all), key)
    }

    fn registry_listing(projector: &[u8]) -> Vec<Registry> {
        let sha = crate::check::sha256_hex(projector);
        let json = format!(r#"{{"registry_version":1,"bases":[{{"id":"vl","identity":{{"arch":"qwen3vl","name":"qwen3vl","size":"2B"}},"files":[],"projectors":[{{"file":"mmproj.gguf","sha256":"{sha}","bytes":3,"url":"https://x"}}]}}]}}"#);
        let (zip, key) = sealed(&[(REGISTRY_FILE, json.as_bytes())], &[7; 32]);
        vec![registry::open(&zip, &Trust { pigeons: &[], registries: &[key] }).unwrap()]
    }

    #[test]
    fn a_copy_with_or_without_its_stock_projector_is_the_same_pigeon() {
        let (manifest, adapter, projector) = (&br#"{"id":"seed-run"}"#[..], &b"weights"[..], &b"GGUFproj"[..]);
        let registries = registry_listing(projector);
        let slim = build_store_zip(&[("pigeon.json", manifest), ("adapter.lora.gguf", adapter)]);
        let large = build_store_zip(&[("pigeon.json", manifest), ("adapter.lora.gguf", adapter), (PROJECTOR_FILE, projector)]);
        assert_eq!(same_pigeon(&large, &slim, &[], &registries), Some(Same::FirstCarries));
        assert_eq!(same_pigeon(&slim, &large, &[], &registries), Some(Same::SecondCarries));
        assert_eq!(same_pigeon(&slim, &slim, &[], &registries), Some(Same::Identical));
        assert_eq!(same_pigeon(&large, &slim, &[], &[]), None, "a projector no registry lists is not stock");

        let other = build_store_zip(&[("pigeon.json", manifest), ("adapter.lora.gguf", b"retrained")]);
        assert_eq!(same_pigeon(&large, &other, &[], &registries), None, "nothing else may differ");
        let renamed = build_store_zip(&[("pigeon.json", manifest), ("adapter2.lora.gguf", adapter)]);
        assert_eq!(same_pigeon(&slim, &renamed, &[], &registries), None);
    }

    #[test]
    fn sealed_copies_are_the_same_only_under_one_key_that_verifies() {
        let (manifest, adapter, projector) = (&br#"{"id":"seed-run"}"#[..], &b"weights"[..], &b"GGUFproj"[..]);
        let registries = registry_listing(projector);
        let slim = [("pigeon.json", manifest), ("adapter.lora.gguf", adapter)];
        let large = [("pigeon.json", manifest), ("adapter.lora.gguf", adapter), (PROJECTOR_FILE, projector)];
        let (slim_a, key_a) = sealed(&slim, &[1; 32]);
        let (large_a, _) = sealed(&large, &[1; 32]);
        let (large_b, key_b) = sealed(&large, &[2; 32]);
        let both = [key_a.clone(), key_b];
        // D79: seal.json differs between the two, and is left out.
        assert_eq!(same_pigeon(&large_a, &slim_a, &both, &registries), Some(Same::FirstCarries));
        assert_eq!(same_pigeon(&large_b, &slim_a, &both, &registries), None, "sealed by different keys");
        assert_eq!(same_pigeon(&large_a, &slim_a, &[], &registries), None, "a seal that cannot be verified");
        let unsealed = build_store_zip(&slim);
        assert_eq!(same_pigeon(&large_a, &unsealed, &[key_a], &registries), None, "one sealed, one not");
    }
}
