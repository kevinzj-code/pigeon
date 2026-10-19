//! python/pigeon.py, run by its test with the system's python3, isolated
//! (-I) and with no packages: the version, a bad config, a check accepted
//! and one refused, every time; Pen by callback, Peek with a picture by
//! poll, and Flight School's `ride` shape, on a "GPU free" only
//! (PIGEON_FFI_GPU=1, see tests/c_host.rs).

use std::path::PathBuf;
use std::process::Command;

mod common;
use common::*;

fn python(args: &[PathBuf], how: &str) -> (bool, String) {
    let out = Command::new("python3")
        .arg("-I")
        .arg(crate_dir().join("python/test_pigeon.py"))
        .args(args)
        .env("PIGEON_LIB", lib_dir().join("libpigeon.dylib"))
        .output()
        .expect("python3");
    let text = format!("{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr));
    std::fs::write(out_dir().join(format!("python-{how}.txt")), &text).unwrap();
    println!("──── pigeon.py, {how} ────\n{text}");
    (out.status.success(), text)
}

#[test]
fn the_python_binding_checks_with_no_model() {
    let s = scratch().join("python-no-model");
    std::fs::create_dir_all(&s).unwrap();
    let (Some(cfg), Some((good, refused))) = (config(&s), check_files()) else {
        eprintln!("(skipped: the bases or the checked files are not on this Mac)");
        return;
    };
    let (ok, text) = python(&["--no-model".into(), cfg, good, refused], "no-model");
    assert!(ok && text.trim_end().ends_with("PASSED"), "{text}");
}

#[test]
fn the_python_binding_asks_pen_and_peek() {
    if !gpu() {
        eprintln!("(skipped: on a GPU free only — PIGEON_FFI_GPU=1)");
        return;
    }
    let s = scratch().join("python-full");
    std::fs::create_dir_all(&s).unwrap();
    let cfg = config(&s).expect("the bases");
    let (ok, text) = python(&[cfg, nest(), picture()], "full");
    assert!(ok && text.trim_end().ends_with("PASSED"), "{text}");
}
