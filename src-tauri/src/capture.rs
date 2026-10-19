//! Reading the screen, without the screen ever reaching the disk.
//!
//! Shaped like `ocr_image`, deliberately: it takes **no path**, hands back
//! **bytes**, and the picture never touches a file. That is §5.8 and it is a
//! non-negotiable — "if an image ever needs to be written somewhere, that is a
//! new decision with a new argument, not an implementation detail". The
//! obvious shortcut, shelling out to `screencapture`, writes a file or takes
//! over the clipboard; both are that new decision, so neither is taken here.
//! The pixels come from CoreGraphics, are encoded to PNG in memory, and go
//! straight to the page as a data URL the CSP already admits.
//!
//! **The permission is asked at the moment someone uses this, never at
//! launch.** `CGRequestScreenCaptureAccess` is called from inside the command
//! and from nowhere else; `setup()` does not touch it. A permission prompt on
//! first run, for a feature the person has not reached for yet, is how an app
//! teaches people to click through prompts without reading them.
//!
//! What comes back is the whole main display. The page shows it, the person
//! drags a rectangle over the part they meant, and the crop — made on a canvas
//! in the webview — is what goes to `ocr_image`. Selecting the region here
//! would mean drawing an overlay window and a crosshair in Rust; doing it in
//! the page is the same result with a surface the app already has.

use serde::Serialize;

/* ── CoreGraphics, declared rather than wrapped ──────────────────────────
 *
 * Eight functions and a handful of getters is less than a crate would cost to
 * carry, and being explicit about which calls this app makes into the window
 * server is worth something in a file about reading someone's screen.
 *
 * Ownership follows Core Foundation's own rule: anything from a Create or a
 * Copy is ours to release, everything else is borrowed. */
#[cfg(target_os = "macos")]
mod cg {
    use std::ffi::c_void;

    pub type CFTypeRef = *const c_void;
    pub type CGImageRef = *const c_void;
    pub type CGDataProviderRef = *const c_void;
    pub type CFDataRef = *const c_void;

    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        pub fn CGMainDisplayID() -> u32;
        /// +1. Null when the app has no screen-recording permission.
        pub fn CGDisplayCreateImage(display: u32) -> CGImageRef;
        pub fn CGImageGetWidth(image: CGImageRef) -> usize;
        pub fn CGImageGetHeight(image: CGImageRef) -> usize;
        pub fn CGImageGetBytesPerRow(image: CGImageRef) -> usize;
        pub fn CGImageGetBitsPerPixel(image: CGImageRef) -> usize;
        /// Borrowed.
        pub fn CGImageGetDataProvider(image: CGImageRef) -> CGDataProviderRef;
        /// +1.
        pub fn CGDataProviderCopyData(provider: CGDataProviderRef) -> CFDataRef;
        /// Does this app already have the permission? Never prompts.
        pub fn CGPreflightScreenCaptureAccess() -> bool;
        /// Prompts, once, the first time. Only ever called from the command.
        pub fn CGRequestScreenCaptureAccess() -> bool;
    }

    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        pub fn CFDataGetBytePtr(data: CFDataRef) -> *const u8;
        pub fn CFDataGetLength(data: CFDataRef) -> isize;
        pub fn CFRelease(cf: CFTypeRef);
    }
}

/// What the page is given: a picture and its size. No path, no display id, no
/// window list — nothing it could use to ask for a different screen.
#[derive(Serialize)]
pub struct Capture {
    /// The PNG itself.
    pub png: Vec<u8>,
    pub width: u32,
    pub height: u32,
    pub ms: u64,
    /// What macOS SAYS about this app's screen-recording permission at the
    /// moment of the capture. False with a picture in hand is a real state:
    /// see `grab`. The page shows it as a caveat, never as a refusal.
    pub granted: bool,
}

/// The refusal a person can act on. Named once so the message cannot drift.
const NO_PERMISSION: &str = "Pigeon cannot read the screen yet. macOS asks for this once: \
open System Settings → Privacy & Security → Screen & System Audio Recording, switch Pigeon on, then \
quit and reopen Pigeon. Nothing was captured.";

/// Switched on, and macOS still handed back nothing. That is what a stale
/// permission looks like: it is remembered against the copy of the app that
/// asked for it, so a rebuilt or moved Pigeon is a different app to macOS
/// however the list reads.
const REFUSED: &str = "macOS gave Pigeon no picture, even though the switch is on. That usually means \
the permission belongs to an older copy of Pigeon: open System Settings → Privacy & Security → Screen \
& System Audio Recording, remove Pigeon with the – button, then try again and say yes when macOS asks. \
Nothing was captured.";

#[cfg(target_os = "macos")]
fn grab() -> Result<(Vec<u8>, u32, u32, bool), String> {
    use cg::*;
    unsafe {
        /* What macOS SAYS about this app and what it actually hands over are
           two different questions, and the first one lies: this Mac answers
           the preflight with NO for a process that then captures a 3024-pixel
           screen perfectly well, and Pigeon has been refusing to try on the
           strength of that answer — with the switch on, in System Settings,
           in front of the person reading the refusal.
           So the picture is asked for FIRST and judged on what comes back. The
           preflight decides only what to say when nothing does, and whether
           this is the moment macOS has never been asked. */
        let granted = CGPreflightScreenCaptureAccess();
        let image = CGDisplayCreateImage(CGMainDisplayID());
        if image.is_null() {
            if !granted {
                /* The one place this app raises the prompt, and only on a
                   machine that has never answered it. It does not grant within
                   this process's lifetime: macOS wants a relaunch. */
                CGRequestScreenCaptureAccess();
                return Err(NO_PERMISSION.into());
            }
            return Err(REFUSED.into());
        }
        let width = CGImageGetWidth(image);
        let height = CGImageGetHeight(image);
        let stride = CGImageGetBytesPerRow(image);
        let bpp = CGImageGetBitsPerPixel(image);
        if width == 0 || height == 0 || bpp != 32 {
            CFRelease(image);
            return Err(format!("the screen came back in a shape Pigeon cannot read ({width}×{height}, {bpp} bits)"));
        }
        let provider = CGImageGetDataProvider(image);
        let data = CGDataProviderCopyData(provider);
        if data.is_null() {
            CFRelease(image);
            return Err("the screen's pixels could not be read".into());
        }
        let ptr = CFDataGetBytePtr(data);
        let len = CFDataGetLength(data) as usize;
        let src = std::slice::from_raw_parts(ptr, len);

        /* BGRA to RGBA, row by row, because the stride is usually wider than
           the picture. */
        let mut rgba = vec![0u8; width * height * 4];
        for y in 0..height {
            let row = &src[y * stride..y * stride + width * 4];
            let out = &mut rgba[y * width * 4..(y + 1) * width * 4];
            for x in 0..width {
                out[x * 4] = row[x * 4 + 2];
                out[x * 4 + 1] = row[x * 4 + 1];
                out[x * 4 + 2] = row[x * 4];
                out[x * 4 + 3] = 255;
            }
        }
        CFRelease(data);
        CFRelease(image);
        Ok((rgba, width as u32, height as u32, granted))
    }
}

#[cfg(not(target_os = "macos"))]
fn grab() -> Result<(Vec<u8>, u32, u32, bool), String> {
    Err("reading the screen is only built for macOS".into())
}

/// RGBA to a PNG, in memory. Never a file.
fn encode(rgba: &[u8], width: u32, height: u32) -> Result<Vec<u8>, String> {
    let mut out: Vec<u8> = Vec::new();
    {
        let mut enc = png::Encoder::new(&mut out, width, height);
        enc.set_color(png::ColorType::Rgba);
        enc.set_depth(png::BitDepth::Eight);
        let mut w = enc.write_header().map_err(|e| format!("could not start the png: {e}"))?;
        w.write_image_data(rgba).map_err(|e| format!("could not write the png: {e}"))?;
    }
    Ok(out)
}

/// Base64 by hand: the alternative is a crate for sixteen lines. Fed only PNGs:
/// the one this file just produced, and a Pigeon's checked icon
/// (`weights::icon_data_url`).
pub(crate) fn base64(bytes: &[u8]) -> String {
    const A: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b = [chunk[0], *chunk.get(1).unwrap_or(&0), *chunk.get(2).unwrap_or(&0)];
        let n = ((b[0] as u32) << 16) | ((b[1] as u32) << 8) | b[2] as u32;
        out.push(A[(n >> 18) as usize & 63] as char);
        out.push(A[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 { A[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if chunk.len() > 2 { A[n as usize & 63] as char } else { '=' });
    }
    out
}

/// The whole main display, as a picture the page can show. Takes nothing.
/// Answers the PNG's BYTES as the raw IPC body — on a 5K display a picture
/// is 10–25 MB, and as base64 inside JSON it was a third larger again and a
/// string the page then decoded by hand. The size is in the PNG's own
/// header; whether macOS says the permission is granted is
/// `screen_capture_status`.
#[tauri::command]
pub async fn screen_capture() -> Result<tauri::ipc::Response, String> {
    let Capture { png, .. } = capture().await?;
    Ok(tauri::ipc::Response::new(png))
}

/// The capture, for this module's tests and for any caller that wants the
/// size beside the bytes.
pub(crate) async fn capture() -> Result<Capture, String> {
    let started = std::time::Instant::now();
    let (rgba, width, height, granted) = tauri::async_runtime::spawn_blocking(grab)
        .await
        .map_err(|e| e.to_string())??;
    let png = tauri::async_runtime::spawn_blocking(move || encode(&rgba, width, height))
        .await
        .map_err(|e| e.to_string())??;
    Ok(Capture { png, width, height, ms: started.elapsed().as_millis() as u64, granted })
}

/// Whether the screenshot action is worth drawing, and whether using it will
/// raise a prompt. Never prompts itself, so the page may call it at any time.
#[tauri::command]
pub async fn screen_capture_status() -> Result<serde_json::Value, String> {
    #[cfg(target_os = "macos")]
    let allowed = unsafe { cg::CGPreflightScreenCaptureAccess() };
    #[cfg(not(target_os = "macos"))]
    let allowed = false;
    Ok(serde_json::json!({ "available": cfg!(target_os = "macos"), "allowed": allowed }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64_matches_the_known_vectors() {
        assert_eq!(base64(b""), "");
        assert_eq!(base64(b"f"), "Zg==");
        assert_eq!(base64(b"fo"), "Zm8=");
        assert_eq!(base64(b"foo"), "Zm9v");
        assert_eq!(base64(b"foobar"), "Zm9vYmFy");
        assert_eq!(base64(&[0u8, 255, 128]), "AP+A");
    }

    #[test]
    fn a_png_is_a_png_and_carries_its_size() {
        let rgba = vec![7u8; 4 * 3 * 4];
        let png = encode(&rgba, 4, 3).expect("encode");
        assert_eq!(&png[..8], &[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]);
        // IHDR width and height, big-endian, right after the 8-byte signature
        // and the 4-byte length and 4-byte type.
        assert_eq!(&png[16..24], &[0, 0, 0, 4, 0, 0, 0, 3]);
    }

    /// The contract §5.8 states: the picture is bytes, and no file appears
    /// anywhere while it is made. Run on a machine WITH the permission this
    /// captures a real screen; without it, the refusal is the thing tested and
    /// the assertion about files still holds.
    #[tokio::test]
    async fn a_capture_writes_nothing_to_disk() {
        /* On a machine that has not yet answered the permission prompt this
           test raises it. PIGEON_SKIP_CAPTURE_TEST=1 keeps a build quiet. */
        if std::env::var_os("PIGEON_SKIP_CAPTURE_TEST").is_some() {
            return;
        }
        let tmp = std::env::temp_dir();
        let before: std::collections::HashSet<_> = std::fs::read_dir(&tmp)
            .map(|d| d.filter_map(|e| e.ok()).map(|e| e.path()).collect())
            .unwrap_or_default();

        match capture().await {
            Ok(c) => {
                assert_eq!(&c.png[..8], &[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]);
                assert!(c.width > 0 && c.height > 0);
            }
            Err(e) => {
                /* Both refusals name System Settings, because both are things
                   a person can act on there. */
                assert!(e.contains("System Settings") || e.contains("only built for macOS"), "{e}");
                eprintln!("(no screen-recording permission here; the refusal was tested instead)");
            }
        }

        let after: std::collections::HashSet<_> = std::fs::read_dir(&tmp)
            .map(|d| d.filter_map(|e| e.ok()).map(|e| e.path()).collect())
            .unwrap_or_default();
        /* Tests run in parallel, and the import and Patch tests build their
           fixtures in the same temp folder, every one of them named `pigeon-…`
           — those are not a capture's leftovers (a capture writes nothing). */
        let new: Vec<_> = after
            .difference(&before)
            .filter(|p| !p.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.starts_with("pigeon-")))
            .collect();
        assert!(new.is_empty(), "a capture left files behind: {new:?}");
    }

    /// Two refusals, because they are two different situations with two
    /// different fixes: macOS has never been asked, or macOS is holding the
    /// permission against an older copy of the app. Saying the first when the
    /// second is true is what sent somebody to a switch that was already on.
    #[test]
    fn the_two_refusals_say_different_things_and_both_can_be_acted_on() {
        assert_ne!(NO_PERMISSION, REFUSED);
        for m in [NO_PERMISSION, REFUSED] {
            assert!(m.contains("System Settings"), "{m}");
            assert!(m.contains("Nothing was captured"), "{m}");
        }
        assert!(REFUSED.contains("older copy"), "the stale-permission refusal must name the cause");
    }

    #[tokio::test]
    async fn asking_whether_it_is_allowed_never_prompts() {
        let s = screen_capture_status().await.expect("status");
        assert!(s.get("available").is_some() && s.get("allowed").is_some());
    }
}
