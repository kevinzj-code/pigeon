//! The header is written by hand and kept honest three ways, with no
//! generator:
//!
//! 1. Its declarations are INTERFACE.md §2's, token for token. The section is
//!    read from Kevin's folder when it is beside this repo, and is otherwise
//!    the copy pinned at tests/interface-section-2.h; when both are there
//!    they must agree, so the pin cannot go stale quietly.
//! 2. Every function and type in `src/boundary.rs`, its Rust types mapped to
//!    C through one fixed table, is the header's.
//! 3. The built library exports exactly the header's functions.
//!
//! (The C compiler is the fourth check: tests/c_host.rs builds host.c with
//! -Werror against the header and links it against the library.)

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

fn here() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

fn read(p: &Path) -> String {
    std::fs::read_to_string(p).unwrap_or_else(|e| panic!("{}: {e}", p.display()))
}

/// C text as tokens: comments gone, punctuation split off, whitespace ignored.
fn tokens(c: &str) -> Vec<String> {
    let mut no_comments = String::new();
    let mut rest = c;
    while let Some(at) = rest.find("/*") {
        no_comments.push_str(&rest[..at]);
        rest = rest[at..].find("*/").map_or("", |end| &rest[at + end + 2..]);
    }
    no_comments.push_str(rest);
    let mut out = Vec::new();
    let mut word = String::new();
    for ch in no_comments.chars() {
        if ch.is_alphanumeric() || ch == '_' {
            word.push(ch);
            continue;
        }
        if !word.is_empty() {
            out.push(std::mem::take(&mut word));
        }
        if !ch.is_whitespace() {
            out.push(ch.to_string());
        }
    }
    if !word.is_empty() {
        out.push(word);
    }
    out
}

/// The header's §2 part: from the first typedef to `pigeon_string_free`'s line.
fn header_block() -> String {
    let h = read(&here().join("include/pigeon.h"));
    let start = h.find("typedef struct pigeon_engine pigeon_engine;").expect("the engine typedef");
    let end = h.find("void     pigeon_string_free(char *);").expect("pigeon_string_free") + "void     pigeon_string_free(char *);".len();
    // Outside the block: only the guard, the includes and extern "C".
    let outside = tokens(&format!("{}{}", &h[..start], &h[end..]));
    let allowed = tokens("#ifndef PIGEON_H #define PIGEON_H #include <stddef.h> #include <stdint.h> #ifdef __cplusplus extern \"C\" { #endif #ifdef __cplusplus } #endif #endif");
    assert_eq!(outside, allowed, "the header carries something outside §2");
    h[start..end].to_string()
}

#[test]
fn the_header_is_interface_md_section_2_token_for_token() {
    let pinned = read(&here().join("tests/interface-section-2.h"));
    let live = std::env::var_os("PIGEON_INTERFACE_MD").map(std::path::PathBuf::from);
    if let Some(md) = live.and_then(|p| std::fs::read_to_string(p).ok()) {
        let at = md.find("## 2. The functions").expect("§2 in INTERFACE.md");
        let from = md[at..].find("```c").expect("§2's code block") + at + 4;
        let to = md[from..].find("```").unwrap() + from;
        assert_eq!(tokens(&md[from..to]), tokens(&pinned), "INTERFACE.md §2 changed: pin it again (tests/interface-section-2.h) and change the header with it");
    } else {
        eprintln!("(PIGEON_INTERFACE_MD is not set; comparing with the pinned copy)");
    }
    assert_eq!(tokens(&header_block()), tokens(&pinned));
}

/// One C declaration: return type and parameter types, names dropped.
#[derive(Debug, PartialEq)]
struct Sig {
    ret: String,
    params: Vec<String>,
}

fn c_type(tokens: &[String]) -> String {
    let mut t: Vec<&str> = tokens.iter().map(String::as_str).collect();
    // A trailing parameter name goes: `const char *request_json` → `const char *`.
    if t.len() > 1 && t.last().is_some_and(|w| w.chars().next().is_some_and(|c| c.is_alphabetic() || c == '_')) {
        t.pop();
    }
    t.join(" ")
}

/// The header's twelve functions.
fn header_functions() -> BTreeMap<String, Sig> {
    let toks = tokens(&header_block());
    let mut out = BTreeMap::new();
    let mut stmt: Vec<String> = Vec::new();
    for t in toks {
        if t != ";" {
            stmt.push(t);
            continue;
        }
        let s = std::mem::take(&mut stmt);
        // Typedefs, and the fields inside pigeon_bytes, are checked apart.
        let Some(open) = s.iter().position(|t| t == "(") else { continue };
        if s.iter().any(|t| t == "typedef" || t == "}") {
            continue;
        }
        let name = s[open - 1].clone();
        let ret = c_type(&s[..open - 1]).trim_end().to_string();
        let inner = &s[open + 1..s.len() - 1];
        let mut params = Vec::new();
        for p in inner.split(|t| t == ",") {
            let ty = c_type(p);
            if ty != "void" && !ty.is_empty() {
                params.push(ty);
            }
        }
        out.insert(name, Sig { ret, params });
    }
    out
}

/// Rust FFI types as C, the one table.
fn rust_to_c(t: &str) -> String {
    let t = t.split_whitespace().collect::<Vec<_>>().join(" ");
    match t.as_str() {
        "*mut pigeon_engine" => "pigeon_engine *",
        "*const c_char" => "const char *",
        "*mut c_char" => "char *",
        "*mut *mut c_char" => "char * *",
        "u64" => "uint64_t",
        "usize" => "size_t",
        "*const pigeon_bytes" => "const pigeon_bytes *",
        "pigeon_event_fn" => "pigeon_event_fn",
        "*mut c_void" => "void *",
        "*const u8" => "const uint8_t *",
        "" => "void",
        other => panic!("no C type for the Rust type `{other}`: add it to the table, or use a type that has one"),
    }
    .to_string()
}

fn rust_functions() -> BTreeMap<String, Sig> {
    let src = read(&here().join("src/boundary.rs"));
    let mut out = BTreeMap::new();
    for (at, _) in src.match_indices("extern \"C\" fn pigeon_") {
        let rest = &src[at + "extern \"C\" fn ".len()..];
        let open = rest.find('(').unwrap();
        let name = rest[..open].to_string();
        let close = rest.find(')').unwrap();
        let params = rest[open + 1..close]
            .split(',')
            .map(str::trim)
            .filter(|p| !p.is_empty())
            .map(|p| rust_to_c(p.split_once(':').unwrap().1.trim()))
            .collect();
        let after = &rest[close + 1..rest.find('{').unwrap()];
        let ret = rust_to_c(after.trim().strip_prefix("->").unwrap_or("").trim());
        out.insert(name, Sig { ret, params });
    }
    out
}

#[test]
fn the_rust_functions_are_the_headers_through_one_type_table() {
    let (h, r) = (header_functions(), rust_functions());
    assert_eq!(h.len(), 12, "§2 has twelve functions: {:?}", h.keys());
    assert_eq!(h, r);
    // The two types the functions use.
    let src = read(&here().join("src/boundary.rs"));
    assert!(src.contains("pub type pigeon_event_fn = Option<unsafe extern \"C\" fn(user: *mut c_void, event_json: *const c_char)>;"));
    let hdr = tokens(&header_block());
    let want = tokens(&format!("typedef void (*pigeon_event_fn)({}user, {}event_json);", rust_to_c("*mut c_void"), rust_to_c("*const c_char")));
    assert!(hdr.windows(want.len()).any(|w| w == want.as_slice()), "pigeon_event_fn");
    assert!(src.contains("#[repr(C)]\npub struct pigeon_bytes {\n    pub data: *const u8,\n    pub len: usize,\n}"));
    let want = tokens(&format!("typedef struct {{ {}data; {} len; }} pigeon_bytes;", rust_to_c("*const u8"), rust_to_c("usize")));
    assert!(hdr.windows(want.len()).any(|w| w == want.as_slice()), "pigeon_bytes");
}

#[test]
fn the_library_exports_exactly_the_headers_functions() {
    // The library of this build, beside the test in target/<profile>/deps.
    let dir = std::env::current_exe().unwrap().parent().unwrap().to_path_buf();
    let lib = dir.join("libpigeon.dylib");
    assert!(lib.is_file(), "{} not built", lib.display());
    let nm = std::process::Command::new("nm").args(["-gU", "-j"]).arg(&lib).output().expect("nm");
    let exported: std::collections::BTreeSet<String> =
        String::from_utf8_lossy(&nm.stdout).lines().filter_map(|l| l.strip_prefix("_pigeon_")).map(|s| format!("pigeon_{s}")).collect();
    let declared: std::collections::BTreeSet<String> = header_functions().into_keys().collect();
    assert_eq!(exported, declared);
}
