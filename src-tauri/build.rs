use std::path::Path;
use std::process::Command;

/// The window watcher (`eye/Eye.swift`) is Swift, because on macOS 15 and
/// later only ScreenCaptureKit can capture a window. It is built into
/// `binaries/` — Tauri's sidecar folder, which
/// `externalBin` requires to exist before `tauri_build` runs — whenever the
/// source is newer than the binary, or there is no binary yet. The binary is
/// not committed: Xcode's command line tools, which Tauri already needs on a
/// Mac, carry the Swift compiler.
fn build_eye() {
    let src = Path::new("eye/Eye.swift");
    let out = Path::new("binaries/pigeon-eye-aarch64-apple-darwin");
    println!("cargo:rerun-if-changed=eye/Eye.swift");
    let newer = match (src.metadata().and_then(|m| m.modified()), out.metadata().and_then(|m| m.modified())) {
        (Ok(a), Ok(b)) => a > b,
        (Ok(_), Err(_)) => true,
        _ => false,
    };
    if !newer {
        return;
    }
    let _ = std::fs::create_dir_all("binaries");
    let ok = Command::new("xcrun")
        .args(["swiftc", "-O", "-target", "arm64-apple-macosx12.3", "-o"])
        .arg(out)
        .arg(src)
        .status()
        .map(|s| s.success())
        .unwrap_or(false);
    if !ok {
        panic!("pigeon-eye could not be built from eye/Eye.swift: install Xcode's command line tools (xcode-select --install)");
    }
}

/// The commit this build was made from, for About and the log's launch line:
/// the short hash, with "+changes" when the working tree differed from it.
/// "unknown" outside a git checkout.
fn build_commit() {
    for f in ["../.git/HEAD", "../.git/index"] {
        println!("cargo:rerun-if-changed={f}");
    }
    let git = |args: &[&str]| {
        Command::new("git")
            .args(args)
            .output()
            .ok()
            .filter(|o| o.status.success())
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
    };
    let commit = match git(&["rev-parse", "--short=7", "HEAD"]) {
        Some(h) => {
            let dirty = git(&["status", "--porcelain", "--untracked-files=no"]).is_some_and(|s| !s.is_empty());
            if dirty { format!("{h}+changes") } else { h }
        }
        None => "unknown".to_string(),
    };
    println!("cargo:rustc-env=PIGEON_COMMIT={commit}");
}

fn main() {
    build_eye();
    build_commit();
    tauri_build::build()
}
