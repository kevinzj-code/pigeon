//! `prompt_check` (spec §8.6) against real Pigeons and real base files, so it
//! can be run again after any change to a chat template or to this crate.
//!
//! Skipped unless both folders are given:
//!
//!     PIGEON_MODELS_DIR=<folder of base GGUFs> \
//!     PIGEON_PIGEONS_DIR=<folder of .pigeon files>[:<another>…] \
//!     cargo test -p pigeon-core --features test-support --test real_pigeons -- --nocapture
//!
//! Each Pigeon is asked with the chat template read from its base's own GGUF:
//! the file `base_model.file` names, or else an installed file of the same
//! base. A Pigeon with no `prompt_check` is reported and passes. Any mismatch
//! fails the test, with its position.
//!
//! Picture Pigeons are not checked here. Their `N` is the projector's to
//! count, and this crate has no projector: taking `N` from the file's own
//! canonical is how a wrong file once passed. `pigeon-engine`'s
//! `real_pigeons` test checks them with `N` counted by llama.cpp.

use std::path::PathBuf;

use pigeon_core::{ask, blob::Blob, check, gguf, manifest::Manifest, material, zip_store};

fn folders(var: &str) -> Option<Vec<PathBuf>> {
    let v = std::env::var_os(var)?;
    Some(std::env::split_paths(&v).collect())
}

#[test]
fn every_real_pigeon_is_asked_the_way_it_was_trained() {
    let (Some(models), Some(pigeon_dirs)) = (folders("PIGEON_MODELS_DIR"), folders("PIGEON_PIGEONS_DIR")) else {
        eprintln!("skipped: set PIGEON_MODELS_DIR and PIGEON_PIGEONS_DIR to run prompt_check over real files");
        return;
    };
    let bases: Vec<(PathBuf, gguf::Identity, Option<String>)> = pigeon_core::scan::ggufs(&models)
        .into_iter()
        .filter_map(|p| {
            let kv = gguf::read_header_file(&p).ok()?;
            let template = kv.get("tokenizer.chat_template").and_then(gguf::Value::as_str).map(String::from);
            Some((p, gguf::base_identity(&kv), template))
        })
        .collect();
    let mut files: Vec<PathBuf> = Vec::new();
    for dir in &pigeon_dirs {
        let mut here: Vec<PathBuf> = std::fs::read_dir(dir).into_iter().flatten().flatten().map(|e| e.path()).filter(|p| p.extension().is_some_and(|x| x == "pigeon")).collect();
        here.sort();
        files.extend(here);
    }
    assert!(!files.is_empty(), "no .pigeon files in PIGEON_PIGEONS_DIR");

    let mut failed = Vec::new();
    for path in &files {
        let label = path.display().to_string();
        let blob = Blob::open(path).unwrap_or_else(|e| panic!("{label}: {e}"));
        let bytes: &[u8] = &blob;
        let entries = match check::list(bytes) {
            Ok(e) => e,
            Err(r) => {
                failed.push(format!("{label}: not readable ({})", r.code()));
                continue;
            }
        };
        let get = |name: &str| zip_store::get(&entries, bytes, name).ok().flatten();
        let Some(m) = get(check::MANIFEST_FILE).and_then(|raw| serde_json::from_slice::<Manifest>(raw).ok()) else {
            failed.push(format!("{label}: no readable pigeon.json"));
            continue;
        };
        let want = m.base_model.identity();
        let named = |b: &&(PathBuf, gguf::Identity, Option<String>)| b.0.file_name().and_then(|n| n.to_str()) == Some(m.base_model.file.as_str());
        let Some((base_path, _, Some(template))) = bases.iter().find(named).or_else(|| bases.iter().find(|b| gguf::same_base(&want, &b.1))) else {
            eprintln!("{label}\tno base here for {}", m.base_model.file);
            continue;
        };
        let base = base_path.file_name().unwrap_or_default().to_string_lossy().into_owned();
        let system = get("system_prompt.txt").map(|b| String::from_utf8_lossy(b).into_owned());
        let index: Option<material::ChunkIndex> = get(check::MATERIAL_FILE).and_then(|raw| serde_json::from_slice(raw).ok());
        let shots = get(ask::SHOTS_FILE).and_then(|raw| ask::parse_shots(raw).ok()).unwrap_or_default();
        if m.takes_pictures() {
            eprintln!("{label}\tpicture: checked by pigeon-engine's real_pigeons test, with N counted\t{base}");
            continue;
        }
        let note = "";
        match ask::template::prompt_check(&m, system.as_deref(), &shots, index.as_ref(), template, None) {
            Ok(ask::PromptCheck::Unchecked) => eprintln!("{label}\tprompt_unchecked\t{base}"),
            Ok(ask::PromptCheck::Matches { .. }) => eprintln!("{label}\tpass{note}\t{base}"),
            Ok(ask::PromptCheck::Differs { at, .. }) => {
                eprintln!("{label}\tprompt_mismatch at byte {at}{note}\t{base}");
                failed.push(format!("{label}: prompt_mismatch at byte {at} on {base}"));
            }
            Err(e) => failed.push(format!("{label}: {e}")),
        }
    }
    assert!(failed.is_empty(), "{} of {} Pigeons failed:\n  {}", failed.len(), files.len(), failed.join("\n  "));
}
