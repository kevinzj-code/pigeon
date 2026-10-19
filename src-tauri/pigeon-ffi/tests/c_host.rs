//! examples/host.c, built with clang against include/pigeon.h and the built
//! library only, and run.
//!
//! Always: it is compiled with -Werror and run with `--no-model` (steps 1-3:
//! the version, a bad config and E22's refused one, a check accepted and a
//! check refused with its `needs`, E22's fetch, a request that is not JSON).
//! No model is loaded; making the engine opens the Metal device and nothing
//! more. Skipped when the files it checks are not on this Mac.
//!
//! On a "GPU free" only, all ten steps, three ways:
//!
//!     PIGEON_FFI_GPU=1 cargo test -p pigeon-ffi --profile ffi --test c_host -- --nocapture
//!
//! plain, then under `leaks --atExit`; built with -fsanitize=address; built
//! with -fsanitize=thread. Each run's output is written to
//! target/<profile>/c-host-<how>.txt.
//!
//! Files (each can be moved with an environment variable):
//!   PIGEON_MODELS_DIR    bases, projectors in projectors/ (default: the Pigeon app's)
//!   PIGEON_FFI_GOOD      a file whose check is accepted (e.g. plain-englishV2.pigeon)
//!   PIGEON_FFI_REFUSED   a file on a base kept out of the config (e.g. dog-breed-sorter.pigeon)
//!   PIGEON_FFI_NEST      Patch's nest (pack/patch.nest)
//!   PIGEON_FFI_GROUNDED  a grounded Pigeon with a prompt_check (the Pigeon app's kept pat-v2.pigeon)
//!   PIGEON_FFI_BASE      a base Pigeon (e.g. plain-englishV2.pigeon)
//!   PIGEON_FFI_PICTURE   a PNG for Peek (e.g. pigeon-clickthrough-9/ocr-2-fish-bar.png)

use std::path::{Path, PathBuf};
use std::process::Command;

mod common;
use common::*;

/// Build host.c, with these extra flags; returns the program.
fn build(how: &str, flags: &[&str]) -> PathBuf {
    let lib = lib_dir();
    assert!(lib.join("libpigeon.dylib").is_file(), "no libpigeon.dylib in {}", lib.display());
    let out = out_dir().join(format!("c-host-{how}"));
    let st = Command::new("clang")
        .args(["-std=c11", "-Wall", "-Wextra", "-Werror", "-g"])
        .args(flags)
        .arg("-I")
        .arg(crate_dir().join("include"))
        .arg(crate_dir().join("examples/host.c"))
        .arg("-L")
        .arg(&lib)
        .args(["-lpigeon", "-lpthread"])
        .arg(format!("-Wl,-rpath,{}", lib.display()))
        .arg("-o")
        .arg(&out)
        .status()
        .expect("clang");
    assert!(st.success(), "host.c did not build ({how})");
    out
}

fn run(program: &Path, args: &[PathBuf], how: &str, prefix: &[&str], env: &[(&str, &str)]) -> (bool, String) {
    let mut cmd = if prefix.is_empty() { Command::new(program) } else { let mut c = Command::new(prefix[0]); c.args(&prefix[1..]).arg(program); c };
    cmd.args(args);
    for (k, v) in env {
        cmd.env(k, v);
    }
    let out = cmd.output().expect("run host");
    let text = format!("{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr));
    std::fs::write(out_dir().join(format!("c-host-{how}.txt")), &text).unwrap();
    println!("──── host.c, {how} ────\n{text}");
    (out.status.success(), text)
}

fn common_args(cfg: &Path) -> Option<Vec<PathBuf>> {
    let (good, refused) = check_files()?;
    Some(vec!["--config".into(), cfg.to_path_buf(), "--good".into(), good, "--refused".into(), refused])
}

#[test]
fn the_c_host_runs_steps_one_to_three_with_no_model() {
    let program = build("checks", &[]);
    let s = scratch().join("no-model");
    std::fs::create_dir_all(&s).unwrap();
    let Some(cfg) = config(&s) else {
        eprintln!("(skipped running: the bases are not in {})", models().display());
        return;
    };
    let Some(args) = common_args(&cfg) else {
        eprintln!("(skipped running: set PIGEON_FFI_GOOD and PIGEON_FFI_REFUSED)");
        return;
    };
    let mut all = vec![PathBuf::from("--no-model")];
    all.extend(args);
    let (ok, text) = run(&program, &all, "no-model", &[], &[]);
    assert!(ok && text.contains("PASSED (steps 1-3, no model)"), "{text}");
}

#[test]
fn the_c_host_runs_all_ten_steps_plain_with_leaks_and_under_both_sanitizers() {
    if !gpu() {
        eprintln!("(skipped: the whole host runs on a GPU free only — PIGEON_FFI_GPU=1)");
        return;
    }
    let s = scratch().join("full");
    std::fs::create_dir_all(&s).unwrap();
    let cfg = config(&s).expect("the bases");
    let mut args = common_args(&cfg).expect("the good and refused files");
    let dl = home().join("Downloads");
    for (flag, var, default) in [
        ("--nest", "PIGEON_FFI_NEST", nest()),
        // The library's pat-v2 carries a prompt_check; an older one has none.
        ("--grounded", "PIGEON_FFI_GROUNDED", home().join("Library/Application Support/mode.airoplane.pigeon/pigeons/pat-v2.pigeon")),
        ("--base", "PIGEON_FFI_BASE", dl.join("plain-englishV2.pigeon")),
        ("--picture", "PIGEON_FFI_PICTURE", picture()),
    ] {
        let p = file(var, default);
        assert!(p.is_file(), "{} is missing", p.display());
        args.push(flag.into());
        args.push(p);
    }
    let mut failed = Vec::new();

    let plain = build("plain", &[]);
    let (ok, text) = run(&plain, &args, "full", &[], &[]);
    if !(ok && text.contains("PASSED (steps 1-10)")) {
        failed.push("plain");
    }
    // macOS's AddressSanitizer has no leak checker; Apple's `leaks` is it.
    let (_, text) = run(&plain, &args, "leaks", &["leaks", "--atExit", "--"], &[("MallocStackLogging", "1")]);
    if !text.contains(" 0 leaks for 0 total leaked bytes") {
        failed.push("leaks");
    }
    let asan = build("asan", &["-fsanitize=address", "-fno-omit-frame-pointer"]);
    let (ok, text) = run(&asan, &args, "asan", &[], &[("ASAN_OPTIONS", "abort_on_error=0:halt_on_error=1")]);
    if !(ok && text.contains("PASSED (steps 1-10)")) || text.contains("ERROR: AddressSanitizer") {
        failed.push("address sanitizer");
    }
    let tsan = build("tsan", &["-fsanitize=thread"]);
    let (ok, text) = run(&tsan, &args, "tsan", &[], &[("TSAN_OPTIONS", "halt_on_error=0")]);
    if !(ok && text.contains("PASSED (steps 1-10)")) || text.contains("WARNING: ThreadSanitizer") {
        failed.push("thread sanitizer");
    }
    assert!(failed.is_empty(), "failed: {failed:?} (outputs in {})", out_dir().display());
}
