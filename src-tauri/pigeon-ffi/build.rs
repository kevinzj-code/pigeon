// A host finds libpigeon.dylib by its rpath, not by the folder it was built in.
fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        println!("cargo:rustc-cdylib-link-arg=-Wl,-install_name,@rpath/libpigeon.dylib");
    }
}
