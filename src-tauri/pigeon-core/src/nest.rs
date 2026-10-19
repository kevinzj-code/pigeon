//! The `.nest`: several Pigeons in one file (spec §14). A strict store-mode
//! ZIP holding `.pigeon` files at the root plus `nest.json`.
//!
//! Each member is checked on its own: one bad member is refused by name and
//! does not stop the good ones. `nest.json` must be there and readable, and a
//! nest must hold at least one Pigeon — a hand-zipped folder does not pass
//! for a nest, and neither does an empty one.

use serde_json::Value;

use crate::check::{self, Host, Refused, Report};
use crate::zip_store;

pub const NEST_FILE: &str = "nest.json";

/// Every `.pigeon` member at the root, in the archive's own order, as (name,
/// bytes).
pub fn members(bytes: &[u8]) -> Result<Vec<(String, &[u8])>, Refused> {
    let entries = check::list(bytes)?;
    /* nest.json must be there and readable (D50). Its listing is not otherwise
       used — a member says what it is — but its version is: a nest from a
       newer format is refused rather than misread. */
    let listing = zip_store::get(&entries, bytes, NEST_FILE).map_err(Refused::BadZip)?.ok_or(Refused::NotANest)?;
    let listing: Value = serde_json::from_slice(listing).map_err(|_| Refused::NotANest)?;
    let version = listing.get("format_version").filter(|v| v.is_i64() || v.is_u64()).ok_or(Refused::NotANest)?;
    let found = version.as_u64().unwrap_or(0);
    if found > check::SUPPORTED_FORMAT_VERSION {
        return Err(Refused::NewerFormat { found, supported: check::SUPPORTED_FORMAT_VERSION });
    }
    let members: Vec<(String, &[u8])> =
        entries.iter().filter(|e| !e.name.contains('/') && e.name.ends_with(".pigeon")).map(|e| (e.name.clone(), e.data(bytes))).collect();
    if members.is_empty() {
        return Err(Refused::NotANest);
    }
    Ok(members)
}

/// One member, checked on its own.
#[derive(Debug, Clone, PartialEq)]
pub struct Member {
    pub file: String,
    pub outcome: Result<Report, Refused>,
}

/// Every member checked as `check::check` would check it alone, with the same
/// host. A refused member does not stop the others; the nest itself is
/// refused only when it breaks the strict ZIP rules or has no `nest.json`.
pub fn check(bytes: &[u8], host: &Host) -> Result<Vec<Member>, Refused> {
    Ok(members(bytes)?.into_iter().map(|(file, inner)| Member { file, outcome: check::check(inner, host) }).collect())
}

/// A checked nest as JSON: `{ "result": "nest", "members": [ { "file", … } ] }`,
/// each member carrying its own report or refusal.
pub fn json(members: &[Member]) -> Value {
    let each: Vec<Value> = members
        .iter()
        .map(|m| {
            let mut one = match &m.outcome {
                Ok(report) => report.json(),
                Err(refused) => refused.json(),
            };
            one["file"] = m.file.clone().into();
            one
        })
        .collect();
    serde_json::json!({ "result": "nest", "members": each })
}

/// `members`, for a caller that only needs to know the file is a nest.
pub fn is_nest(bytes: &[u8]) -> bool {
    zip_store::list_entries(bytes).is_ok_and(|entries| entries.iter().any(|e| e.name == NEST_FILE))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::zip_store::test_support::build_store_zip;

    #[test]
    fn a_nest_gives_its_pigeons_and_a_zip_of_pigeons_without_nest_json_is_not_one() {
        const LISTING: &[u8] = br#"{"format_version":1,"pigeons":[]}"#;
        let nest = build_store_zip(&[("a.pigeon", b"A"), ("notes.txt", b"n"), ("b.pigeon", b"B"), ("deep/c.pigeon", b"C"), (NEST_FILE, LISTING)]);
        let got = members(&nest).unwrap();
        assert_eq!(got, vec![("a.pigeon".to_string(), &b"A"[..]), ("b.pigeon".to_string(), &b"B"[..])]);
        assert!(is_nest(&nest));
        let code = |files: &[(&str, &[u8])]| members(&build_store_zip(files)).unwrap_err().code();
        assert_eq!(code(&[("a.pigeon", b"A")]), "not_a_nest");
        assert_eq!(code(&[("a.pigeon", b"A"), (NEST_FILE, b"not json")]), "not_a_nest");
        assert_eq!(code(&[("a.pigeon", b"A"), (NEST_FILE, b"{}")]), "not_a_nest");
        assert_eq!(code(&[("README.md", b"hi"), (NEST_FILE, LISTING)]), "not_a_nest");
        assert_eq!(code(&[("a.pigeon", b"A"), (NEST_FILE, br#"{"format_version":2}"#)]), "newer_format");
        assert_eq!(members(b"plain bytes").unwrap_err().code(), "not_a_zip");
        // Each member is judged alone, and reported under its own name.
        let checked = check(&nest, &Host::default()).unwrap();
        assert_eq!(json(&checked)["members"][1]["file"], "b.pigeon");
        assert_eq!(json(&checked)["members"][0]["code"], "not_a_zip");
    }
}
