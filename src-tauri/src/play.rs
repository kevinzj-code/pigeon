//! Play: a picture Pigeon looks at a window and presses the keys it answers
//! (docs/PLAY-LOOP.md). P2–P4 of that plan.
//!
//! One turn: the eye (`eye/Eye.swift`, the `pigeon-eye` sidecar) writes the
//! window's latest frame in the shape the Pigeon learned from; `pigeon_run`
//! asks the Pigeon on the picture server; an answer from its own list that is
//! a key in its `actions.json` is pressed — held as long as its maker usually
//! held it — and every turn goes in a play log.
//!
//! What it will not do, whatever it is told:
//! - press a key that is not in the Pigeon's own `actions.json` (never with ⌘,
//!   Ctrl or Option — Flight School leaves those out when it packs);
//! - press anything while another app is in front: it waits instead;
//! - keep pressing when nothing happens: ten presses of one key with the
//!   screen unchanged, or a minute of NOTHING but NONE, stops it with the reason;
//! - keep going after ⌘⇧. — from anywhere — or Stop.
//!
//! Both permissions are asked for and checked here, in Pigeon's own process,
//! where macOS keeps them: Screen Recording for the eye, Accessibility to
//! press keys. (Flight School learned that a helper asking on its own behalf
//! can be told no after the person said yes.)

use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::weights;

/* ── macOS, declared ─────────────────────────────────────────────────────── */

#[cfg(target_os = "macos")]
mod mac {
    use std::ffi::c_void;
    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        pub fn CGPreflightScreenCaptureAccess() -> bool;
        pub fn CGRequestScreenCaptureAccess() -> bool;
        pub fn CGEventSourceCreate(state: i32) -> *mut c_void;
        pub fn CGEventCreateKeyboardEvent(source: *mut c_void, key: u16, down: bool) -> *mut c_void;
        pub fn CGEventSetFlags(event: *mut c_void, flags: u64);
        pub fn CGEventPost(tap: u32, event: *mut c_void);
        pub fn CGEventPostToPid(pid: i32, event: *mut c_void);
    }
    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        pub fn AXIsProcessTrusted() -> bool;
        pub fn AXIsProcessTrustedWithOptions(options: *const c_void) -> bool;
        pub static kAXTrustedCheckOptionPrompt: *const c_void;
    }
    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        pub static kCFBooleanTrue: *const c_void;
        pub static kCFTypeDictionaryKeyCallBacks: u8;
        pub static kCFTypeDictionaryValueCallBacks: u8;
        pub fn CFDictionaryCreate(a: *const c_void, keys: *const *const c_void, values: *const *const c_void, n: isize,
                                  kcb: *const u8, vcb: *const u8) -> *const c_void;
        pub fn CFRelease(cf: *const c_void);
    }
    pub const HID_SYSTEM_STATE: i32 = 1;
    pub const HID_TAP: u32 = 0;
    pub const SESSION_TAP: u32 = 1;
}

/// Where a key is sent. The plan's gate tries all three, because emulators
/// differ in where they read the keyboard.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum How {
    /// Into the system's own key stream, as a keyboard would.
    Hid,
    /// Into the login session's stream, above the hardware.
    Session,
    /// Straight to the game's process — works even when it is not in front.
    Pid,
}

/// Holds `code` down for `hold_ms`, then lets it go. No modifier is ever
/// set: the flags are cleared, so a ⌘ the person happens to be holding cannot
/// turn a game key into ⌘Q.
async fn press(code: u16, hold_ms: u64, how: How, pid: i32) {
    #[cfg(target_os = "macos")]
    unsafe fn post(code: u16, down: bool, how: How, pid: i32) {
        let src = mac::CGEventSourceCreate(mac::HID_SYSTEM_STATE);
        let ev = mac::CGEventCreateKeyboardEvent(src, code, down);
        if !ev.is_null() {
            mac::CGEventSetFlags(ev, 0);
            match how {
                How::Hid => mac::CGEventPost(mac::HID_TAP, ev),
                How::Session => mac::CGEventPost(mac::SESSION_TAP, ev),
                How::Pid => mac::CGEventPostToPid(pid, ev),
            }
            mac::CFRelease(ev);
        }
        if !src.is_null() {
            mac::CFRelease(src);
        }
    }
    // SAFETY: CoreGraphics event calls with objects created and released here.
    unsafe { post(code, true, how, pid) };
    tokio::time::sleep(Duration::from_millis(hold_ms.clamp(20, MAX_HOLD_MS))).await;
    unsafe { post(code, false, how, pid) };
}

/* ── permissions ─────────────────────────────────────────────────────────── */

fn permission_now() -> Value {
    // SAFETY: parameterless queries that never prompt.
    let (screen, keys) = unsafe { (mac::CGPreflightScreenCaptureAccess(), mac::AXIsProcessTrusted()) };
    json!({ "screen": screen, "keys": keys })
}

#[tauri::command]
pub fn play_permission() -> Value {
    permission_now()
}

/// Asks macOS for what play needs — only when the person pressed the button,
/// never at launch. `which` is "screen" or "keys"; macOS shows its own prompt
/// once, and after that only System Settings can change the answer.
#[tauri::command]
pub fn play_ask(which: String) -> Result<Value, String> {
    // SAFETY: CoreFoundation objects created and released here; the prompt
    // key and boolean are Apple's own constants.
    unsafe {
        match which.as_str() {
            "screen" => {
                if !mac::CGPreflightScreenCaptureAccess() {
                    mac::CGRequestScreenCaptureAccess();
                }
            }
            "keys" => {
                let keys = [mac::kAXTrustedCheckOptionPrompt];
                let values = [mac::kCFBooleanTrue];
                let dict = mac::CFDictionaryCreate(std::ptr::null(), keys.as_ptr(), values.as_ptr(), 1,
                                                   &mac::kCFTypeDictionaryKeyCallBacks, &mac::kCFTypeDictionaryValueCallBacks);
                mac::AXIsProcessTrustedWithOptions(dict);
                if !dict.is_null() {
                    mac::CFRelease(dict);
                }
            }
            _ => return Err("no such permission".into()),
        }
    }
    Ok(permission_now())
}

/// Opens the one System Settings pane play needs; `which` is a word, never a URL.
#[tauri::command]
pub fn play_open_settings(which: String) -> Result<(), String> {
    let pane = match which.as_str() {
        "screen" => "Privacy_ScreenCapture",
        "keys" => "Privacy_Accessibility",
        _ => return Err("no such setting".into()),
    };
    Command::new("open").arg(format!("x-apple.systempreferences:com.apple.preference.security?{pane}")).status().map_err(|e| e.to_string())?;
    Ok(())
}

/* ── the eye ─────────────────────────────────────────────────────────────── */

pub(crate) fn eye_path<R: tauri::Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    // Shared with the text reader (`ocr_image` in lib.rs): the same binary reads text.
    if let Some(p) = std::env::var_os("PIGEON_EYE_BIN").map(PathBuf::from).filter(|p| p.is_file()) {
        return Ok(p);
    }
    let mut candidates = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join("pigeon-eye"));
            candidates.push(dir.join("pigeon-eye-aarch64-apple-darwin"));
        }
    }
    if let Ok(res) = app.path().resource_dir() {
        candidates.push(res.join("pigeon-eye"));
    }
    /* `cargo run` from a checkout: the binary build.rs made. A debug-only
       fallback, so a release carries no path from the machine it was built on. */
    #[cfg(debug_assertions)]
    candidates.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries/pigeon-eye-aarch64-apple-darwin"));
    candidates.into_iter().find(|p| p.is_file()).ok_or_else(|| "the window watcher is missing from this build of Pigeon".into())
}

fn eye_once<R: tauri::Runtime>(app: &AppHandle<R>, args: &[&str]) -> Result<Value, String> {
    let out = Command::new(eye_path(app)?).args(args).output().map_err(|e| format!("the window watcher would not start: {e}"))?;
    let text = String::from_utf8_lossy(&out.stdout);
    serde_json::from_str(text.lines().last().ok_or("the window watcher said nothing")?).map_err(|e| e.to_string())
}

fn eye_words(code: &str) -> &'static str {
    match code {
        "no-screen-permission" => "macOS is not letting Pigeon see the screen. Turn Pigeon on in System Settings › Privacy & Security › Screen & System Audio Recording, then quit and reopen Pigeon.",
        "window-gone" => "That window closed or moved off screen. Pick it again.",
        "no-windows" => "No windows could be listed. Open the game, then check again.",
        "crop-under-a-pixel" => "That window is too small for the part of it this Pigeon learned to look at. Make the window bigger, then press Play again.",
        _ => "The window watcher stopped unexpectedly.",
    }
}

/// A running eye: ask it for a frame, it writes one.
struct Eye {
    child: Child,
    stdin: ChildStdin,
    /// The eye's lines, read on a thread of their own, so a watcher that
    /// stops answering is a timeout here rather than a loop Stop cannot reach.
    lines: std::sync::mpsc::Receiver<String>,
    ready: Value,
}

/// actions.json `frames.crop` — the part of the window the Pigeon learned
/// from, as fractions [x, y, w, h] from the top left — as the eye's --crop,
/// written as the file wrote it and at full precision, so the eye trims and
/// cuts exactly where the recorder did (format §13.2 step 0, D70). No crop is
/// the whole window. One that is not four numbers is an error, never the
/// whole window: the import check keeps such a file from playing, so reaching
/// this is a file changed since.
fn crop_arg(frames: &Value) -> Result<Option<String>, String> {
    let Some(c) = frames.get("crop").filter(|c| !c.is_null()) else { return Ok(None) };
    let v: Vec<f64> = c.as_array().map(|a| a.iter().filter_map(Value::as_f64).collect()).unwrap_or_default();
    match v.len() == 4 && c.as_array().is_some_and(|a| a.len() == 4) {
        true => Ok(Some(v.iter().map(|x| x.to_string()).collect::<Vec<_>>().join(","))),
        false => Err("its frames.crop is not four numbers — import it again".into()),
    }
}

/// The eye's own size for the kept part, held to the format's arithmetic
/// (`pigeon_core::actions::capture_plan`, §13.2 steps 0–3) for the window it
/// reported: the two must agree to the pixel, or nothing is played.
fn agrees_with_the_format(ready: &Value, frames: &Value) -> Result<(), String> {
    let px = |i: usize| ready["pixels"].get(i).and_then(Value::as_f64);
    let (Some(w0), Some(h0)) = (px(0), px(1)) else { return Err("the window watcher did not say how big the window is".into()) };
    let plan = pigeon_core::actions::capture_plan(w0, h0, frames).ok_or_else(|| eye_words("crop-under-a-pixel").to_string())?;
    let eye = (ready["w"].as_u64(), ready["h"].as_u64());
    if eye != (Some(plan.kept.width.into()), Some(plan.kept.height.into())) {
        return Err(format!("the window watcher would make a {}×{} picture where this Pigeon learned from {}×{} — not played",
            eye.0.unwrap_or(0), eye.1.unwrap_or(0), plan.kept.width, plan.kept.height));
    }
    Ok(())
}

/// How long the eye may take to hand over one frame.
const FRAME_WAIT: Duration = Duration::from_secs(5);

impl Eye {
    /// `whole`: hand over uncut frames for pigeon-engine to cut (E12), with
    /// the capture size held to the engine's afterwards instead of here.
    fn start(bin: &Path, source: &Source, frames: &Value, whole: bool) -> Result<Eye, String> {
        /* Exactly as the file says, or not at all: no default stack, size or
           gap stands in for one it does not give (format §13.2, D66, D69). */
        pigeon_core::actions::followable(frames).map_err(|s| format!("{} — import it again", s.why))?;
        let missing = |what: &str| format!("its frames do not give {what} — import it again");
        let stack = frames["stack"].as_u64().filter(|n| (1..=4).contains(n)).ok_or_else(|| missing("a stack from 1 to 4"))?;
        let side = frames["max_side"].as_u64().filter(|n| *n >= 64).ok_or_else(|| missing("a max_side of at least 64"))?;
        let gap = match frames["gap_ms"].as_f64().filter(|g| *g >= 0.0) {
            Some(g) => g.to_string(),
            None if stack == 1 => "0".to_string(),
            None => return Err(missing("the time between stacked frames")),
        };
        let (stack, side) = (stack.to_string(), side.to_string());
        let mut cmd = Command::new(bin);
        match source {
            Source::Window(id) => {
                cmd.args(["watch", "--window", &id.to_string()]);
                // Only the part of the window it learned from. A replay's
                // frames were recorded already cut, so they are not cut again.
                if let Some(c) = crop_arg(frames)? {
                    cmd.args(["--crop", &c]);
                }
                if whole {
                    cmd.args(["--whole", "1"]);
                }
            }
            Source::Replay(dir) => { cmd.args(["replay", "--dir", &dir.to_string_lossy()]); }
        };
        let mut child = cmd.args(["--stack", &stack, "--gap-ms", &gap, "--max-side", &side])
            .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null())
            .spawn().map_err(|e| format!("the window watcher would not start: {e}"))?;
        let stdin = child.stdin.take().ok_or("no stdin")?;
        let stdout: ChildStdout = child.stdout.take().ok_or("no stdout")?;
        let (tx, lines) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                if tx.send(line).is_err() {
                    break;
                }
            }
        });
        let first: Value = serde_json::from_str(&lines.recv_timeout(Duration::from_secs(15)).map_err(|_| "the window watcher did not start")?)
            .map_err(|e| e.to_string())?;
        if first["type"] == "error" {
            let _ = child.kill();
            return Err(eye_words(first["code"].as_str().unwrap_or("")).into());
        }
        if matches!(source, Source::Window(_)) && !whole {
            if let Err(e) = agrees_with_the_format(&first["window"], frames) {
                let _ = child.kill();
                return Err(e);
            }
        }
        Ok(Eye { child, stdin, lines, ready: first["window"].clone() })
    }

    fn frame(&mut self, out: &Path) -> Result<Value, String> {
        // One write, whole: a request that arrives in pieces is one the eye
        // cannot read, and both sides would wait on each other.
        let line = format!("{}\n", json!({ "cmd": "frame", "out": out.to_string_lossy() }));
        self.stdin.write_all(line.as_bytes()).map_err(|e| e.to_string())?;
        loop {
            let line = self.lines.recv_timeout(FRAME_WAIT).map_err(|e| match e {
                std::sync::mpsc::RecvTimeoutError::Timeout => "the window watcher stopped answering".to_string(),
                std::sync::mpsc::RecvTimeoutError::Disconnected => "the window watcher stopped".to_string(),
            })?;
            let v: Value = serde_json::from_str(&line).map_err(|e| e.to_string())?;
            match v["type"].as_str() {
                Some("frame") => return Ok(v),
                Some("error") if v["code"] == "no-frame-yet" => return Ok(v),
                Some("error") => return Err(eye_words(v["code"].as_str().unwrap_or("")).into()),
                _ => continue,
            }
        }
    }
}

impl Eye {
    /// The frames a picture is made of, oldest first, written whole as PNG.
    fn frames(&mut self, out: &[PathBuf]) -> Result<Value, String> {
        let paths: Vec<String> = out.iter().map(|p| p.to_string_lossy().into_owned()).collect();
        let line = format!("{}\n", json!({ "cmd": "frames", "out": paths }));
        self.stdin.write_all(line.as_bytes()).map_err(|e| e.to_string())?;
        loop {
            let line = self.lines.recv_timeout(FRAME_WAIT).map_err(|e| match e {
                std::sync::mpsc::RecvTimeoutError::Timeout => "the window watcher stopped answering".to_string(),
                std::sync::mpsc::RecvTimeoutError::Disconnected => "the window watcher stopped".to_string(),
            })?;
            let v: Value = serde_json::from_str(&line).map_err(|e| e.to_string())?;
            match v["type"].as_str() {
                Some("frames") => return Ok(v),
                Some("error") if v["code"] == "no-frame-yet" => return Ok(v),
                Some("error") => return Err(eye_words(v["code"].as_str().unwrap_or("")).into()),
                _ => continue,
            }
        }
    }
}

impl Drop for Eye {
    fn drop(&mut self) {
        let _ = self.stdin.write_all(b"{\"cmd\":\"stop\"}\n");
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

pub(crate) enum Source {
    Window(u32),
    /// A folder of frames, played round as a window (tests; nothing is pressed).
    #[cfg_attr(not(test), allow(dead_code))]
    Replay(PathBuf),
}

#[tauri::command]
pub fn play_windows<R: tauri::Runtime>(app: AppHandle<R>, play: State<'_, Play>) -> Result<Value, String> {
    let v = eye_once(&app, &["windows"])?;
    if let Some(code) = v["code"].as_str() {
        return Err(eye_words(code).into());
    }
    let ids: Vec<u32> = v["windows"]
        .as_array()
        .map(|ws| ws.iter().filter_map(|w| w["id"].as_u64()).filter_map(|id| u32::try_from(id).ok()).collect())
        .unwrap_or_default();
    *play.listed.lock().unwrap_or_else(|p| p.into_inner()) = ids;
    Ok(v["windows"].clone())
}

/// One frame of a window, as the Pigeon would see it, for the page to show.
#[tauri::command]
pub async fn play_preview<R: tauri::Runtime>(app: AppHandle<R>, play: State<'_, Play>, pigeon: String, window: u32) -> Result<String, String> {
    listed_window(&play, window)?;
    let (_, actions) = player(&app, &pigeon)?;
    let bin = eye_path(&app)?;
    let tmp = std::env::temp_dir().join(format!("pigeon-preview-{}.jpg", std::process::id()));
    let tmp2 = tmp.clone();
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let mut eye = Eye::start(&bin, &Source::Window(window), &actions["frames"], false)?;
        std::thread::sleep(Duration::from_millis(400));
        eye.frame(&tmp2).map(|_| ())
    }).await.map_err(|e| e.to_string())??;
    let bytes = std::fs::read(&tmp).map_err(|e| e.to_string())?;
    let _ = std::fs::remove_file(&tmp);
    Ok(format!("data:image/jpeg;base64,{}", crate::capture::base64(&bytes)))
}

/* ── the key test (the plan's P3 gate) ───────────────────────────────────── */

/// Does the game take a key Pigeon presses? It is brought to the front, a
/// frame is taken, the key is pressed one way, and a frame is taken again —
/// for each of the three ways. A way whose frames differ worked. The person
/// picks a key that visibly does something (a step, a menu).
#[tauri::command]
pub async fn play_key_test<R: tauri::Runtime>(app: AppHandle<R>, play: State<'_, Play>, pigeon: String, window: u32, answer: String) -> Result<Value, String> {
    listed_window(&play, window)?;
    let (_, actions) = player(&app, &pigeon)?;
    let key = actions["keys"][answer.trim_start_matches("KEY(").trim_end_matches(')')].clone();
    let code = key["code"].as_u64().ok_or("that answer is not a key this Pigeon presses")?;
    if !key_allowed(code) {
        return Err("that key is not one a Pigeon may press — letters, digits, space, arrows, Return and Shift only".into());
    }
    let code = code as u16;
    let hold = key["hold_ms"].as_u64().unwrap_or(120).min(MAX_HOLD_MS);
    if !permission_now()["keys"].as_bool().unwrap_or(false) {
        return Err("macOS is not letting Pigeon press keys yet — allow Accessibility first".into());
    }
    let bin = eye_path(&app)?;
    let dir = std::env::temp_dir().join(format!("pigeon-keytest-{}", std::process::id()));
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let mut eye = tauri::async_runtime::spawn_blocking({
        let (bin, frames) = (bin.clone(), actions["frames"].clone());
        move || Eye::start(&bin, &Source::Window(window), &frames, false)
    }).await.map_err(|e| e.to_string())??;
    let pid = eye.ready["pid"].as_i64().unwrap_or(0) as i32;
    let mut results = Vec::new();
    for how in [How::Hid, How::Session, How::Pid] {
        let _ = eye_once(&app, &["activate", "--window", &pid.to_string()]);
        tokio::time::sleep(Duration::from_millis(600)).await;
        let a = dir.join(format!("{how:?}-a.jpg"));
        let b = dir.join(format!("{how:?}-b.jpg"));
        let fa = eye.frame(&a)?;
        press(code, hold, how, pid).await;
        tokio::time::sleep(Duration::from_millis(700)).await;
        let fb = eye.frame(&b)?;
        let changed = std::fs::read(&a).ok() != std::fs::read(&b).ok();
        results.push(json!({ "how": how, "changed": changed, "front": fa["front"].as_bool().unwrap_or(false) && fb["front"].as_bool().unwrap_or(false) }));
    }
    drop(eye);
    let _ = std::fs::remove_dir_all(&dir);
    let works = results.iter().find(|r| r["changed"] == true).map(|r| r["how"].clone());
    Ok(json!({ "results": results, "works": works }))
}

/* ── the loop ────────────────────────────────────────────────────────────── */

/// A picture Pigeon that can play: its persona and its actions.json.
fn player<R: tauri::Runtime>(app: &AppHandle<R>, pigeon: &str) -> Result<(weights::PersonaFile, Value), String> {
    let p = weights::persona_by_id(app, pigeon).ok_or_else(|| format!("no such Pigeon: \"{pigeon}\""))?;
    if p.contract.projector.is_none() {
        return Err(format!("\"{}\" does not see pictures, so it cannot play", p.name));
    }
    let dir = weights::personas_dir(app)?;
    let raw = std::fs::read(crate::pigeon::payload_path(&dir, &p.id, "actions")).map_err(|_| {
        format!("\"{}\" does not say which key each answer is — send it from Flight School again to play it", p.name)
    })?;
    let v: Value = serde_json::from_slice(&raw).map_err(|e| e.to_string())?;
    Ok((p, v))
}

#[derive(Serialize, Clone, Default, Debug)]
pub struct PlayStatus {
    /// "starting" | "playing" | "waiting" (another app in front) | "stopped"
    pub state: String,
    pub pigeon: String,
    pub turns: u64,
    pub pressed: u64,
    pub last_answer: Option<String>,
    pub last_pressed: Option<String>,
    pub last_ms: Option<u64>,
    /// Why it stopped: Stop, ⌘⇧., stuck, the time limit, or an error.
    pub reason: Option<String>,
    /// The play log's folder, named for the page, never used by it.
    pub log: Option<String>,
    pub watch_only: bool,
    /// The frame it answered last, as the `data:image/jpeg` URL it was sent —
    /// what the overlay shows as "what it sees". Never a path.
    pub frame: Option<String>,
    /// When the play started (ms since the epoch), for "for 2 min".
    pub since_ms: Option<u64>,
    /// The Pigeon's name, for the overlay and the menu bar.
    pub name: Option<String>,
}

#[derive(Default)]
pub struct Play {
    stop: Mutex<Option<Arc<AtomicBool>>>,
    status: Mutex<PlayStatus>,
    /// The window ids the last `play_windows` handed the page. A window a
    /// Pigeon may look at or press keys into is one of these and no other:
    /// the page picks from the list, it does not name a window of its own.
    listed: Mutex<Vec<u32>>,
}

fn listed_window(play: &Play, window: u32) -> Result<(), String> {
    let ok = play.listed.lock().unwrap_or_else(|p| p.into_inner()).contains(&window);
    if ok {
        Ok(())
    } else {
        Err("pick a window from the list first — that one was not listed".into())
    }
}

/// The keys a Pigeon may press, by macOS virtual key code: letters, digits,
/// space, the arrows, Return and Shift. What a game is played with. Not
/// Delete, Tab, Escape, the function keys or anything else that means
/// something to the app in front when a frame arrives late: a key is only
/// ever posted while the game is in front, and this list is the second
/// wall behind that one.
pub const ALLOWED_KEYS: &[u16] = &[
    // a b c d e f g h i j k l m n o p q r s t u v w x y z
    0x00, 0x0B, 0x08, 0x02, 0x0E, 0x03, 0x05, 0x04, 0x22, 0x26, 0x28, 0x25, 0x2E, 0x2D, 0x1F, 0x23, 0x0C, 0x0F, 0x01,
    0x11, 0x20, 0x09, 0x0D, 0x07, 0x10, 0x06,
    // 0 1 2 3 4 5 6 7 8 9
    0x1D, 0x12, 0x13, 0x14, 0x15, 0x17, 0x16, 0x1A, 0x1C, 0x19,
    // space, return, shift, left, right, down, up
    0x31, 0x24, 0x38, 0x7B, 0x7C, 0x7D, 0x7E,
];

pub fn key_allowed(code: u64) -> bool {
    u16::try_from(code).is_ok_and(|c| ALLOWED_KEYS.contains(&c))
}

/// The longest a key is held. Long enough for a held run, short enough that
/// a key posted as the game loses focus cannot type a line into what took
/// its place.
pub const MAX_HOLD_MS: u64 = 500;

fn set<R: tauri::Runtime>(app: &AppHandle<R>, f: impl FnOnce(&mut PlayStatus)) {
    let play = app.state::<Play>();
    let snap = {
        let mut s = play.status.lock().unwrap_or_else(|p| p.into_inner());
        f(&mut s);
        s.clone()
    };
    let _ = app.emit("play-event", snap.clone());
    crate::playhud::follow(app, &snap);
    crate::tray::playing(app, &snap);
}

pub const STOP_CHORD: &str = "⌘⇧.";

/// What stops a run from anywhere: ⌘⇧., registered only while one plays.
fn hold_stop_chord<R: tauri::Runtime>(app: &AppHandle<R>, on: bool) {
    use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
    let chord = Shortcut::new(Some(Modifiers::SUPER | Modifiers::SHIFT), Code::Period);
    if on {
        let held = app.global_shortcut().on_shortcut(chord, |app, _, event| {
            if event.state == ShortcutState::Pressed {
                stop_with(app, &format!("stopped with {STOP_CHORD}"));
            }
        });
        if let Err(e) = held {
            plog!("play", "{STOP_CHORD} could not be registered: {e}");
        }
    } else {
        let _ = app.global_shortcut().unregister(chord);
    }
}

fn stop_with<R: tauri::Runtime>(app: &AppHandle<R>, why: &str) {
    let play = app.state::<Play>();
    if let Some(flag) = play.stop.lock().unwrap_or_else(|p| p.into_inner()).as_ref() {
        flag.store(true, Ordering::SeqCst);
    }
    set(app, |s| {
        if s.reason.is_none() {
            s.reason = Some(why.into());
        }
    });
}

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn fingerprint(path: &Path) -> u64 {
    let mut h = DefaultHasher::new();
    std::fs::read(path).unwrap_or_default().hash(&mut h);
    h.finish()
}

/// How many plays of one Pigeon are kept on disk, newest first. The newest
/// keeps every frame, so what it saw can be looked at right after; the ones
/// before it keep their log and their last frame only; older than this,
/// gone. A play's frames are pictures of the person's screen and are not
/// kept for good.
pub const KEEP_PLAYS: usize = 5;

/// Applied when a play starts and when it ends, to the Pigeon's own folder.
pub fn prune_plays(plays_dir: &Path) {
    let Ok(rd) = std::fs::read_dir(plays_dir) else { return };
    let mut dirs: Vec<PathBuf> = rd.filter_map(|e| e.ok()).map(|e| e.path()).filter(|p| p.is_dir()).collect();
    dirs.sort();
    dirs.reverse();
    for (i, dir) in dirs.iter().enumerate() {
        if i >= KEEP_PLAYS {
            let _ = std::fs::remove_dir_all(dir);
            continue;
        }
        if i == 0 {
            continue;
        }
        let Ok(rd) = std::fs::read_dir(dir) else { continue };
        let mut frames: Vec<PathBuf> = rd
            .filter_map(|e| e.ok())
            .map(|e| e.path())
            .filter(|p| p.extension().is_some_and(|x| x == "jpg"))
            .collect();
        frames.sort();
        frames.pop();
        for f in frames {
            let _ = std::fs::remove_file(f);
        }
    }
}

/// How many presses of one key, with the screen not changing, mean stuck.
pub const STUCK_PRESSES: u32 = 10;
/// How long nothing but NONE means it has stopped playing.
pub const NONE_FOR: Duration = Duration::from_secs(60);

/// What one turn's answer comes to. Pure, so the rules can be tested.
#[derive(Debug, PartialEq)]
pub enum Decision {
    Wait,
    Press { name: String, code: u16, hold_ms: u64, timed: bool },
    /// An answer it may not press: off its list, or a key it has no code for.
    Skip(String),
}

pub fn decide(answer: &str, matched: bool, actions: &Value) -> Decision {
    let a = answer.trim();
    if a.eq_ignore_ascii_case("NONE") {
        return Decision::Wait;
    }
    if !matched {
        return Decision::Skip(format!("\"{a}\" is not one of its answers"));
    }
    let Some(inner) = a.strip_prefix("KEY(").and_then(|x| x.strip_suffix(')')) else {
        return Decision::Skip(format!("{a} is not a key — this version presses keys only"));
    };
    let Some(k) = actions["keys"].get(inner) else {
        return Decision::Skip(format!("{a} is not a key it may press"));
    };
    match k["code"].as_u64() {
        Some(code) if key_allowed(code) => {
            let hold = k["hold_ms"].as_u64();
            Decision::Press {
                name: k["name"].as_str().unwrap_or(inner).into(),
                code: code as u16,
                hold_ms: hold.unwrap_or(90).min(MAX_HOLD_MS),
                timed: hold.is_some(),
            }
        }
        Some(_) => Decision::Skip(format!("{a} is a key a Pigeon may not press")),
        None => Decision::Skip(format!("{a} has no key code")),
    }
}

/// Plays until stopped. `watch_only` decides every turn and presses nothing
/// (the log says what it would have pressed) — how it is tried, and tested.
pub async fn run_loop<R: tauri::Runtime>(app: AppHandle<R>, pigeon: String, source: Source, how: How, watch_only: bool,
                                         limit: Option<Duration>, stop: Arc<AtomicBool>) -> Result<(), String> {
    let (p, actions) = player(&app, &pigeon)?;
    let question = actions["question"].as_str().unwrap_or("What do you do next?").to_string();
    let plays_dir = weights::app_subdir(&app, "plays")?.join(&p.id);
    prune_plays(&plays_dir);
    let log_dir = plays_dir.join(now_ms().to_string());
    std::fs::create_dir_all(&log_dir).map_err(|e| e.to_string())?;
    set(&app, |s| {
        *s = PlayStatus {
            state: "starting".into(), pigeon: p.id.clone(), name: Some(p.name.clone()), log: Some(log_dir.to_string_lossy().into()),
            watch_only, since_ms: Some(now_ms()), ..Default::default()
        };
    });

    let bin = eye_path(&app)?;
    let frames = actions["frames"].clone();
    /* A window and a kept file: the engine says what size to capture at, and
       cuts, stacks and asks (E12). A replay's frames were recorded already
       cut, so a replay is asked as one picture through `pigeon_run`. */
    let engine_file = if matches!(source, Source::Window(_)) { crate::inprocess::wanted(&app, &p.id) } else { None };
    let whole = engine_file.is_some();
    let mut eye = tauri::async_runtime::spawn_blocking(move || Eye::start(&bin, &source, &frames, whole)).await.map_err(|e| e.to_string())??;
    if let Some(kept) = &engine_file {
        let px = |i: usize| eye.ready["pixels"].get(i).and_then(Value::as_f64).unwrap_or(0.0);
        let plan = crate::inprocess::ask(&app, kept, json!({ "input": "", "capture_for": { "width": px(0), "height": px(1) } }), Vec::new()).await?;
        let (want, got) = (&plan["capture"], (eye.ready["w"].as_u64(), eye.ready["h"].as_u64()));
        if (want["width"].as_u64(), want["height"].as_u64()) != got {
            return Err(format!("the window watcher would capture {}×{} where the engine says {}×{} — not played",
                got.0.unwrap_or(0), got.1.unwrap_or(0), want["width"], want["height"]));
        }
    }
    let stack = actions["frames"]["stack"].as_u64().unwrap_or(1) as usize;
    let pid = eye.ready["pid"].as_i64().unwrap_or(0) as i32;
    /* The game to the front, so pressing Play is the last thing to do: keys
       are only pressed while it is there. Watching presses nothing and needs
       nothing in front. */
    if !watch_only && pid > 0 {
        let _ = eye_once(&app, &["activate", "--window", &pid.to_string()]);
    }
    std::fs::write(log_dir.join("play.json"), serde_json::to_string_pretty(&json!({
        "pigeon": p.id, "name": p.name, "started_ms": now_ms(), "window": eye.ready, "watch_only": watch_only,
        "how": how, "frames": actions["frames"], "question": question, "keys": actions["keys"],
    })).unwrap()).map_err(|e| e.to_string())?;
    let mut log = std::fs::OpenOptions::new().create(true).append(true).open(log_dir.join("log.jsonl")).map_err(|e| e.to_string())?;

    let started = Instant::now();
    let (mut turn, mut last_key, mut same_presses, mut last_print): (u64, Option<String>, u32, u64) = (0, None, 0, 0);
    let mut last_action = Instant::now();
    let finish = |why: &str| why.to_string();
    let reason = loop {
        if stop.load(Ordering::SeqCst) {
            break finish("stopped");
        }
        if limit.is_some_and(|l| started.elapsed() >= l) {
            break finish("the time limit");
        }
        turn += 1;
        let file = log_dir.join(format!("f{turn:06}.jpg"));
        let parts: Vec<PathBuf> = (0..stack).map(|k| log_dir.join(format!("f{turn:06}-{k}.png"))).collect();
        let f = if whole { eye.frames(&parts)? } else { eye.frame(&file)? };
        if f["type"] == "error" {
            tokio::time::sleep(Duration::from_millis(200)).await;
            turn -= 1;
            continue;
        }
        if !f["front"].as_bool().unwrap_or(false) && !watch_only {
            /* Another app is in front: a key meant for the game would land in
               it. Wait, without asking the Pigeon, until the game is back. */
            set(&app, |s| s.state = "waiting".into());
            let _ = std::fs::remove_file(&file);
            parts.iter().for_each(|p| { let _ = std::fs::remove_file(p); });
            turn -= 1;
            tokio::time::sleep(Duration::from_millis(500)).await;
            last_action = Instant::now();
            continue;
        }
        let asked = match &engine_file {
            Some(kept) => {
                // The whole frames go to the engine; the picture it makes from
                // them is made here too, for the log and the page to show.
                let pngs: Vec<Vec<u8>> = parts.iter().map(std::fs::read).collect::<Result<_, _>>().map_err(|e| e.to_string())?;
                parts.iter().for_each(|p| { let _ = std::fs::remove_file(p); });
                let shot = pigeon_engine::compose_frames(&actions["frames"], &pngs)?;
                std::fs::write(&file, &shot).map_err(|e| e.to_string())?;
                let frames_req: Vec<Value> = (0..pngs.len()).map(|i| json!({ "attachment": i })).collect();
                let reply = crate::inprocess::ask(&app, kept, json!({ "input": question, "frames": frames_req, "options": { "stream": false } }), pngs).await;
                (shot, reply.map(|ev| {
                    let label = ev["answer"]["kind"] == "label";
                    let said = if label { ev["answer"]["value"].as_str() } else { ev["raw"].as_str() };
                    (said.unwrap_or_default().to_string(), label, ev["stats"]["total_ms"].as_u64().unwrap_or(0))
                }))
            }
            None => {
                let shot = std::fs::read(&file).map_err(|e| e.to_string())?;
                let url = format!("data:image/jpeg;base64,{}", crate::capture::base64(&shot));
                let reply = crate::pigeon::pigeon_run(app.clone(), crate::pigeon::RunRequest { pigeon: p.id.clone(), text: question.clone(), image: Some(url), example: false, expect: None }).await;
                (shot, reply.map(|r| (r.text, r.matched_label.unwrap_or(false), r.ms)))
            }
        };
        let url = format!("data:image/jpeg;base64,{}", crate::capture::base64(&asked.0));
        let (answer, matched, ms) = match asked.1 {
            Ok(r) => r,
            Err(e) => break finish(&format!("the Pigeon could not be asked: {e}")),
        };
        let print = fingerprint(&file);
        let decision = decide(&answer, matched, &actions);
        let mut pressed = None;
        match &decision {
            Decision::Wait => {
                if last_action.elapsed() >= NONE_FOR {
                    break finish("a minute of NONE — it has stopped playing");
                }
            }
            Decision::Skip(_) => {}
            Decision::Press { name, code, hold_ms, .. } => {
                same_presses = if last_key.as_deref() == Some(name) && print == last_print { same_presses + 1 } else { 1 };
                if same_presses >= STUCK_PRESSES {
                    break finish(&format!("stuck — {name} pressed {STUCK_PRESSES} times and the screen did not change"));
                }
                if !watch_only {
                    press(*code, *hold_ms, how, pid).await;
                }
                last_key = Some(name.clone());
                last_action = Instant::now();
                pressed = Some(name.clone());
            }
        }
        last_print = print;
        let line = json!({
            "turn": turn, "t_ms": started.elapsed().as_millis() as u64, "frame": file.file_name().unwrap().to_string_lossy(),
            "answer": answer, "on_list": matched, "ms": ms,
            "pressed": if watch_only { Value::Null } else { json!(pressed) },
            "would_press": if watch_only { json!(pressed) } else { Value::Null },
            "skipped": match &decision { Decision::Skip(w) => json!(w), _ => Value::Null },
            "hold_ms": match &decision { Decision::Press { hold_ms, timed, .. } => json!({ "ms": hold_ms, "timed": timed }), _ => Value::Null },
        });
        let _ = writeln!(log, "{line}");
        crate::log::write(
            "play",
            &format!(
                "turn {turn} · {ms} ms · answer {answer}{} · {}",
                if matched { "" } else { " (not on its list)" },
                match (&decision, &pressed) {
                    (Decision::Skip(w), _) => format!("skipped: {w}"),
                    (_, Some(k)) if watch_only => format!("would press {k}"),
                    (_, Some(k)) => format!("pressed {k}"),
                    _ => "no key".to_string(),
                }
            ),
        );
        set(&app, |s| {
            s.state = "playing".into();
            s.turns = turn;
            if pressed.is_some() {
                s.pressed += 1;
            }
            s.last_answer = Some(answer.clone());
            s.last_pressed = pressed.clone();
            s.last_ms = Some(ms);
            s.frame = Some(url.clone());
        });
        // Let the game answer the key before looking again.
        tokio::time::sleep(Duration::from_millis(if pressed.is_some() { 250 } else { 300 })).await;
    };
    drop(eye);
    crate::log::write("play", &format!("stop after {turn} turns, {} s: {reason}", started.elapsed().as_secs()));
    set(&app, |s| {
        s.state = "stopped".into();
        if s.reason.is_none() {
            s.reason = Some(reason);
        }
    });
    Ok(())
}

/// Play `pigeon` in `window`. Returns at once; turns arrive as `play-event`.
#[tauri::command]
pub async fn play_start<R: tauri::Runtime>(app: AppHandle<R>, play: State<'_, Play>, pigeon: String, window: u32, how: How,
                                           watch_only: bool, limit_s: Option<u64>) -> Result<(), String> {
    listed_window(&play, window)?;
    player(&app, &pigeon)?;
    if !permission_now()["screen"].as_bool().unwrap_or(false) {
        return Err("macOS is not letting Pigeon see the screen yet — allow Screen Recording first".into());
    }
    if !watch_only && !permission_now()["keys"].as_bool().unwrap_or(false) {
        return Err("macOS is not letting Pigeon press keys yet — allow Accessibility first".into());
    }
    let flag = Arc::new(AtomicBool::new(false));
    {
        let mut slot = play.stop.lock().unwrap_or_else(|p| p.into_inner());
        if slot.as_ref().is_some_and(|f| !f.load(Ordering::SeqCst)) {
            return Err("it is already playing".into());
        }
        *slot = Some(flag.clone());
    }
    hold_stop_chord(&app, true);
    crate::log::write("play", &format!("start {pigeon} · {} · {:?}{}", if watch_only { "watching only" } else { "pressing keys" }, how, limit_s.map_or(String::new(), |l| format!(" · limit {l} s"))));
    let app2 = app.clone();
    tauri::async_runtime::spawn(async move {
        let res = run_loop(app2.clone(), pigeon, Source::Window(window), how, watch_only, limit_s.map(Duration::from_secs), flag.clone()).await;
        /* The chord goes before the flag says "free": the other way round, a
           play started in between would register it and then lose it here. */
        hold_stop_chord(&app2, false);
        flag.store(true, Ordering::SeqCst);
        if let Err(e) = res {
            crate::log::write("play", &format!("stopped with an error: {e}"));
            set(&app2, |s| { s.state = "stopped".into(); s.reason = Some(e); });
        }
    });
    Ok(())
}

#[tauri::command]
pub fn play_stop<R: tauri::Runtime>(app: AppHandle<R>) {
    stop_with(&app, "stopped");
}

#[tauri::command]
pub fn play_status(play: State<'_, Play>) -> PlayStatus {
    play.status.lock().unwrap_or_else(|p| p.into_inner()).clone()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// P4's check, without a screen and without a key ever pressed: a real
    /// picture Pigeon plays a replay of real recorded frames on the real
    /// picture server, watch-only, and every turn is decided and logged.
    ///   PIGEON_TEST_PLAYER=<.pigeon with actions.json> PIGEON_TEST_FRAMES=<dir of frames> \
    ///   cargo test --lib -- --ignored --test-threads=1 --nocapture a_picture_pigeon_plays
    #[tokio::test]
    #[ignore]
    async fn a_picture_pigeon_plays_a_replay_watch_only() {
        let (Some(file), Some(frames)) = (std::env::var_os("PIGEON_TEST_PLAYER"), std::env::var_os("PIGEON_TEST_FRAMES")) else { return };
        let mut ctx = tauri::test::mock_context(tauri::test::noop_assets());
        ctx.config_mut().identifier = "mode.airoplane.pigeon.test-play".into();
        let app = tauri::test::mock_builder().manage(crate::engine::Engine::new()).manage(Play::default()).build(ctx).expect("mock app");
        let handle = app.handle().clone();
        let root = handle.path().app_data_dir().unwrap();
        assert!(root.ends_with("mode.airoplane.pigeon.test-play"));
        let _ = std::fs::remove_dir_all(&root);
        let home = PathBuf::from(std::env::var_os("HOME").unwrap());
        let base = home.join("Library/Application Support/mode.airoplane.pigeon/models/Qwen3VL-2B-Instruct-Q4_K_M.gguf");
        std::os::unix::fs::symlink(&base, weights::own_dir(&handle).unwrap().join(base.file_name().unwrap())).unwrap();
        let port = std::net::TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
        std::env::set_var("PIGEON_VISION_PORT", port.to_string());
        let out = crate::pigeon::add_path(&handle, &crate::pigeon::installed_bases(&handle), Path::new(&file));
        let id = match &out[0] { crate::pigeon::ImportOutcome::Added { id, .. } => id.clone(), o => panic!("{o:?}") };
        let stop = Arc::new(AtomicBool::new(false));
        run_loop(handle.clone(), id.clone(), Source::Replay(PathBuf::from(frames)), How::Pid, true, Some(Duration::from_secs(45)), stop).await.unwrap();
        let status = handle.state::<Play>().status.lock().unwrap().clone();
        eprintln!("{status:?}");
        let log = std::fs::read_to_string(Path::new(status.log.as_ref().unwrap()).join("log.jsonl")).unwrap();
        let lines: Vec<Value> = log.lines().map(|l| serde_json::from_str(l).unwrap()).collect();
        for l in lines.iter().take(12) {
            eprintln!("turn {:>2} {:>5} ms  {:<14} would press {:?}", l["turn"], l["ms"], l["answer"].as_str().unwrap_or(""), l["would_press"]);
        }
        let (_, actions) = player(&handle, &id).unwrap();
        let keys: Vec<String> = actions["keys"].as_object().unwrap().values().map(|k| k["name"].as_str().unwrap().to_string()).collect();
        assert!(lines.len() >= 5, "only {} turns in 45 s", lines.len());
        assert!(lines.iter().all(|l| l["pressed"].is_null()), "watch-only pressed nothing");
        assert!(lines.iter().filter_map(|l| l["would_press"].as_str()).all(|k| keys.iter().any(|x| x == k)), "only its own keys");
        assert!(lines.iter().all(|l| Path::new(status.log.as_ref().unwrap()).join(l["frame"].as_str().unwrap()).is_file()), "every turn's frame is kept");
        handle.state::<crate::engine::Engine>().sleep_all(Some(&handle));
        std::env::remove_var("PIGEON_VISION_PORT");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn only_game_keys_are_pressed_and_never_for_long() {
        assert!(key_allowed(0x00) && key_allowed(0x31) && key_allowed(0x7E) && key_allowed(0x24));
        for forbidden in [0x33u64, 0x30, 0x35, 0x75, 0x7A, 0x60, 0x37, 0x3A, 0x3B, 128, 1000] {
            assert!(!key_allowed(forbidden), "{forbidden:#x}");
        }
        let a = serde_json::json!({ "keys": { "del": { "name": "del", "code": 0x33 }, "a": { "name": "a", "code": 0x00, "hold_ms": 4000 } } });
        assert!(matches!(decide("KEY(del)", true, &a), Decision::Skip(_)));
        match decide("KEY(a)", true, &a) {
            Decision::Press { hold_ms, .. } => assert_eq!(hold_ms, MAX_HOLD_MS),
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn old_plays_lose_their_frames_then_their_folder() {
        let root = std::env::temp_dir().join(format!("pigeon-test-plays-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        for t in 1..=7u64 {
            let d = root.join(format!("{:013}", t * 1000));
            std::fs::create_dir_all(&d).unwrap();
            std::fs::write(d.join("log.jsonl"), "").unwrap();
            for f in 1..=3 {
                std::fs::write(d.join(format!("f{f:06}.jpg")), "x").unwrap();
            }
        }
        prune_plays(&root);
        let left: Vec<String> = {
            let mut v: Vec<String> = std::fs::read_dir(&root).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().to_string()).collect();
            v.sort();
            v
        };
        assert_eq!(left.len(), KEEP_PLAYS, "{left:?}");
        assert!(!root.join("0000000001000").exists() && !root.join("0000000002000").exists());
        let newest = root.join("0000000007000");
        assert_eq!(std::fs::read_dir(&newest).unwrap().count(), 4, "the newest keeps every frame");
        let older = root.join("0000000006000");
        assert!(older.join("log.jsonl").is_file() && older.join("f000003.jpg").is_file());
        assert!(!older.join("f000001.jpg").exists(), "an older play keeps its log and last frame only");
        let _ = std::fs::remove_dir_all(&root);
    }

    fn actions() -> Value {
        json!({ "keys": { "Confirm": { "code": 7, "name": "X", "hold_ms": 95 }, "Up": { "code": 126, "name": "Up", "hold_ms": null } } })
    }

    #[test]
    fn the_eye_is_told_the_part_of_the_window_a_pigeon_learned_from() {
        assert_eq!(crop_arg(&json!({ "crop": [0.25, 0.1, 0.5, 0.8] })).unwrap().as_deref(), Some("0.25,0.1,0.5,0.8"));
        assert_eq!(crop_arg(&json!({ "crop": [0.123456789, 0, 0.5, 0.5] })).unwrap().as_deref(), Some("0.123456789,0,0.5,0.5"), "full precision, so the eye cuts where training cut");
        assert_eq!(crop_arg(&json!({ "stack": 1 })), Ok(None), "no crop: the whole window");
        assert_eq!(crop_arg(&json!({ "crop": [0.75, -0.1, 0.5, 1] })).unwrap().as_deref(), Some("0.75,-0.1,0.5,1"), "past the edge: as written, for the eye to trim (D70)");
        assert!(crop_arg(&json!({ "crop": [0, 0, 0.5] })).is_err());
        assert!(crop_arg(&json!({ "crop": [0, 0, 0.5, "1"] })).is_err());
    }

    #[test]
    fn the_eyes_picture_must_be_the_formats_to_the_pixel() {
        let frames = json!({ "stack": 1, "gap_ms": 250, "max_side": 768, "crop": [0.0, 0.0, 0.5, 0.5] });
        let ready = |w: u64, h: u64| json!({ "w": w, "h": h, "pixels": [3200.0, 2000.0] });
        assert_eq!(agrees_with_the_format(&ready(768, 480), &frames), Ok(()));
        assert!(agrees_with_the_format(&ready(768, 481), &frames).is_err(), "off by one is not played");
        assert!(agrees_with_the_format(&json!({ "w": 768, "h": 480 }), &frames).is_err(), "no window size, nothing to hold it to");
        let thin = json!({ "stack": 1, "max_side": 768, "crop": [0.0, 0.0, 1.0, 0.012] });
        assert_eq!(agrees_with_the_format(&json!({ "w": 768, "h": 0, "pixels": [6000.0, 300.0] }), &thin), Err(eye_words("crop-under-a-pixel").to_string()));
    }

    #[test]
    fn only_its_own_keys_are_ever_pressed() {
        assert_eq!(decide("KEY(Confirm)", true, &actions()), Decision::Press { name: "X".into(), code: 7, hold_ms: 95, timed: true });
        assert_eq!(decide("KEY(Up)", true, &actions()), Decision::Press { name: "Up".into(), code: 126, hold_ms: 90, timed: false }, "untimed → a short press");
        assert_eq!(decide("NONE", true, &actions()), Decision::Wait);
        assert!(matches!(decide("KEY(Confirm)", false, &actions()), Decision::Skip(_)), "an answer off its list is never pressed");
        assert!(matches!(decide("KEY(Quit)", true, &actions()), Decision::Skip(_)), "a key not in its actions is never pressed");
        assert!(matches!(decide("CLICK(Send)", true, &actions()), Decision::Skip(_)), "clicks are not pressed in this version");
        let odd = json!({ "keys": { "Odd": { "code": 900, "name": "?" } } });
        assert!(matches!(decide("KEY(Odd)", true, &odd), Decision::Skip(_)), "a code no keyboard has is not pressed");
    }
}
