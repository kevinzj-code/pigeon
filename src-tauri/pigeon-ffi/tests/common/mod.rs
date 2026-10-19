//! What the C and Python host tests share: where things are, and the
//! engine config both run with.
#![allow(dead_code)]

use std::path::{Path, PathBuf};

pub fn home() -> PathBuf {
    PathBuf::from(std::env::var_os("HOME").unwrap_or_default())
}

pub fn file(var: &str, default: PathBuf) -> PathBuf {
    std::env::var_os(var).map(PathBuf::from).unwrap_or(default)
}

pub fn crate_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

/// target/<profile>/deps: the library of this very build sits beside the
/// test (a test build does not copy it up to target/<profile>).
pub fn lib_dir() -> PathBuf {
    std::env::current_exe().unwrap().parent().unwrap().to_path_buf()
}

/// target/<profile>: where the runs' outputs are written.
pub fn out_dir() -> PathBuf {
    lib_dir().parent().unwrap().to_path_buf()
}

pub fn models() -> PathBuf {
    file("PIGEON_MODELS_DIR", home().join("Library/Application Support/mode.airoplane.pigeon/models"))
}

/// The engine config: only Qwen3-VL 2B and Qwen2.5 1.5B as bases (so a
/// Pigeon on any other base is refused with `needs`), the app's sealed
/// registry and the keys this app trusts. Returns its path.
pub fn config(scratch: &Path) -> Option<PathBuf> {
    let m = models();
    let bases = scratch.join("bases");
    let _ = std::fs::remove_dir_all(&bases);
    std::fs::create_dir_all(&bases).unwrap();
    for f in ["Qwen3VL-2B-Instruct-Q4_K_M.gguf", "Qwen2.5-1.5B-Instruct-Q4_K_M.gguf"] {
        if !m.join(f).is_file() {
            return None;
        }
        std::os::unix::fs::symlink(m.join(f), bases.join(f)).unwrap();
    }
    let keys = |f: &str| -> Vec<String> {
        let v: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(crate_dir().join("../keys").join(f)).unwrap()).unwrap();
        v.as_array().unwrap().iter().filter(|k| k["revoked"] != true).map(|k| k["ed25519_pub_hex"].as_str().unwrap().to_string()).collect()
    };
    let cfg = serde_json::json!({
        "base_dirs": [bases], "projector_dirs": [m.join("projectors")], "embedding_dirs": [m],
        "registries": [crate_dir().join("../registry/registry.zip")],
        "trusted_pigeon_keys": keys("seal-keys.json"), "trusted_registry_keys": keys("registry-keys.json"),
        "hash_cache": scratch.join("hashes.json"),
        "max_bases_loaded": 2, "parallel": 2, "context_tokens": 4096, "idle_unload_s": 0,
    });
    let p = scratch.join("engine.json");
    std::fs::write(&p, cfg.to_string()).unwrap();
    Some(p)
}

pub fn scratch() -> PathBuf {
    let d = out_dir().join("c-host-scratch");
    std::fs::create_dir_all(&d).unwrap();
    d
}


/// The files the no-model steps check: (good, refused).
pub fn check_files() -> Option<(PathBuf, PathBuf)> {
    let dl = home().join("Downloads");
    let good = file("PIGEON_FFI_GOOD", dl.join("plain-englishV2.pigeon"));
    let refused = file("PIGEON_FFI_REFUSED", dl.join("dog-breed-sorter.pigeon"));
    (good.is_file() && refused.is_file()).then_some((good, refused))
}

/// True on a "GPU free" run.
pub fn gpu() -> bool {
    std::env::var("PIGEON_FFI_GPU").as_deref() == Ok("1")
}

pub fn nest() -> PathBuf {
    file("PIGEON_FFI_NEST", crate_dir().join("../../pack/patch.nest"))
}

pub fn picture() -> PathBuf {
    file("PIGEON_FFI_PICTURE", home().join("Downloads/pigeon-clickthrough-9/ocr-2-fish-bar.png"))
}
