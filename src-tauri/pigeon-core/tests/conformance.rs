//! The conformance kit, as part of `cargo test`.
//!
//! The kit lives beside the format spec, not in this repo, so it is found
//! through `PIGEON_CONFORMANCE_KIT` — the folder that holds `cases/` (the
//! same variable Flight School uses). Without it the test says so and passes:
//! a checkout with no kit is not a failing reader. With it, any case that
//! fails, fails `cargo test`.

use std::path::{Path, PathBuf};

fn case_dirs(kit: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let Ok(groups) = std::fs::read_dir(kit.join("cases")) else { return out };
    for group in groups.filter_map(|e| e.ok()).map(|e| e.path()).filter(|p| p.is_dir()) {
        let Ok(cases) = std::fs::read_dir(&group) else { continue };
        out.extend(cases.filter_map(|e| e.ok()).map(|e| e.path()).filter(|p| p.join("case.json").is_file()));
    }
    out.sort();
    out
}

#[test]
fn every_case_in_the_conformance_kit_passes() {
    let Some(kit) = std::env::var_os("PIGEON_CONFORMANCE_KIT").map(PathBuf::from) else {
        eprintln!("skipped: set PIGEON_CONFORMANCE_KIT to the kit's folder (the one holding cases/) to run it");
        return;
    };
    let cases = case_dirs(&kit);
    assert!(!cases.is_empty(), "PIGEON_CONFORMANCE_KIT is {}, and there are no cases under its cases/", kit.display());
    let mut failed = Vec::new();
    for dir in &cases {
        let want: serde_json::Value = serde_json::from_slice(&std::fs::read(dir.join("expected.json")).unwrap()).unwrap();
        let got = pigeon_core::kit::run(dir);
        if !pigeon_core::kit::same(&want, &got) {
            let label = format!("{}/{}", dir.parent().unwrap().file_name().unwrap().to_string_lossy(), dir.file_name().unwrap().to_string_lossy());
            failed.push(format!("{label}\n    expected {want}\n    got      {got}"));
        }
    }
    eprintln!("{}/{} cases pass", cases.len() - failed.len(), cases.len());
    assert!(failed.is_empty(), "{} of {} conformance cases fail:\n  {}", failed.len(), cases.len(), failed.join("\n  "));
}
