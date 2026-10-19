use std::process::Command;

/// llama.cpp's Metal code checks the macOS version at run time (`@available`).
/// When a build sets a minimum macOS older than the SDK's (Tauri's bundle sets
/// 12.3), clang compiles those checks into calls to `__isPlatformVersionAtLeast`,
/// which lives in clang's own runtime library. Rust links with
/// `-nodefaultlibs`, so that library is left out and the link fails. Link it
/// by name from wherever this toolchain keeps it.
fn main() {
    println!("cargo:rerun-if-changed=build.rs");
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("macos") {
        return;
    }
    let dir = Command::new("clang")
        .arg("--print-runtime-dir")
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string());
    match dir {
        Some(d) if std::path::Path::new(&d).join("libclang_rt.osx.a").exists() => {
            println!("cargo:rustc-link-search=native={d}");
            println!("cargo:rustc-link-lib=static=clang_rt.osx");
        }
        _ => println!("cargo:warning=clang's runtime library was not found; a build with an older minimum macOS may not link"),
    }
}
