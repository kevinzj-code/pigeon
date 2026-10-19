//! The summon bar: ⌘⇧P from anywhere, and Patch is there to be asked.
//!
//! The popover (`tray.rs`) is for the question you have while doing something
//! else, and it still makes you go to the menu bar to ask it. This is the same
//! idea with the trip taken out: one key chord, a bar of glass in the middle of
//! the screen that says "Ask Patch", a question, an answer, Escape. It is
//! Patch's and only Patch's — no To: field, no screenshot, no wake button —
//! because a surface you reach for in one second opens on the one whose answers
//! can be checked (§5.7), and everything else is one ⌘↩ away in the window.
//!
//! Three things here are not what `tray.rs` does, and each is on purpose:
//!
//!   **The window is see-through and the glass is a native view.** A webview
//!   cannot blur what is behind its own window, so the material is AppKit's:
//!   `NSGlassEffectView` where the Mac has it (macOS 26), `NSVisualEffectView`
//!   where it does not. It is laid under the webview and sized to the BAR, not
//!   the window, with clear space round it for the shadow. It is FOUR pieces
//!   of glass, the way Spotlight's is: the bar, and three round bubbles that
//!   part from its right-hand end when the pointer comes near (Patch's icon,
//!   add an image, read the screen). On macOS 26 they sit in one
//!   `NSGlassEffectContainerView`, which is what makes them pull apart like
//!   liquid instead of sliding like tiles. `TOP`, `MARGIN`, `RADIUS`, `BUBBLE`
//!   and `GAP` below are the same numbers `bar.html` draws with, and
//!   `scripts/test.mjs` fails if the two drift apart.
//!
//!   **It takes keys without taking the Mac.** An ordinary window has to
//!   activate its app to be typed into, which drags Pigeon's main window
//!   forward over whatever you were doing and leaves you to find your way back
//!   afterwards. So on macOS the window is turned into a non-activating panel:
//!   it becomes key, the app you were in stays the active app, and putting the
//!   bar away hands the keyboard straight back to it.
//!
//!   **The page cannot move, size or hide it.** `core:default` grants a page no
//!   window verbs at all. It gets four commands, in the house style:
//!   `bar_hide` and `bar_show` take nothing (the second exists so the bar can
//!   step out of its own screenshot and come back), `bar_fit` takes a height
//!   in points that is clamped here, and `bar_bubbles` takes OPEN or SHUT. The
//!   page says how tall its answer is and whether the pointer is near; where
//!   the bar is, how wide, how tall it may ever get, and where every piece of
//!   glass goes are decided in this file.
//!
//! The chord is registered from `lib.rs`'s setup through
//! `tauri-plugin-global-shortcut`, none of whose permissions are granted to any
//! window — a page cannot register, change or listen for a shortcut.

use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};

use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Runtime, WebviewUrl, WebviewWindowBuilder};

/// The bar's window label. Named in `capabilities/default.json` and in
/// `patch::SCHEME_WINDOWS`, because it runs Patch's skills like the other two.
pub const BAR: &str = "bar";

/// What the chord is called wherever a person reads it.
pub const CHORD_LABEL: &str = "⌘⇧P";

/* Geometry, in points. bar.html carries the same numbers as CSS custom
   properties; the glass is native views and the page draws on top of them, so
   the two must agree to the point. */
/// Clear space above the glass.
const TOP: f64 = 24.0;
/// Clear space either side of the glass and under it, for its shadow.
const MARGIN: f64 = 40.0;
/// The glass's corner. Half of `GLASS_MIN`, so the empty bar is a pill.
const RADIUS: f64 = 32.0;
const GLASS_W: f64 = 680.0;
/// The bar with nothing under it: one row to type in.
const GLASS_MIN: f64 = 64.0;
/// As tall as an answer may make it. Past this the answer scrolls.
const GLASS_MAX: f64 = 520.0;
/// A bubble is a circle as tall as one row.
const BUBBLE: f64 = 64.0;
/// Between the bar and the first bubble, and between bubbles.
const GAP: f64 = 12.0;
/// Glass is laid for this many bubbles. Three always stand beside the bar;
/// the fourth, Play, only when the Pigeon picked can play (`bar_bubbles`).
const BUBBLES: usize = 4;
/// How many bubbles the page is drawing now: 3, or 4 with Play.
static SHOWN: AtomicUsize = AtomicUsize::new(3);
fn shown() -> usize {
    SHOWN.load(Ordering::Relaxed).clamp(3, BUBBLES)
}
/// How long the bubbles take to part or rejoin. bar.html moves its own
/// drawing over the same time.
const PART_S: f64 = 0.28;

/* What the glass currently looks like, kept here because both commands that
   change it need the other's half: a new height must not shut the bubbles, and
   parting the bubbles must not forget how tall the answer is. */
static OPEN: AtomicBool = AtomicBool::new(false);
static GLASS_H: AtomicU64 = AtomicU64::new(0);
fn glass_h() -> f64 {
    f64::from_bits(GLASS_H.load(Ordering::Relaxed)).clamp(GLASS_MIN, GLASS_MAX)
}

/// How far down the screen the top of the glass sits, as a share of its height.
const FROM_TOP: f64 = 0.28;

const fn window_w() -> f64 {
    GLASS_W + 2.0 * MARGIN
}
fn window_h(glass: f64) -> f64 {
    TOP + glass.clamp(GLASS_MIN, GLASS_MAX) + MARGIN
}

/// ⌘⇧P pressed: bring the bar up, or put it away if it is already up.
pub fn toggle<R: Runtime>(app: &AppHandle<R>) {
    if let Some(w) = app.get_webview_window(BAR) {
        if w.is_visible().unwrap_or(false) {
            let _ = w.hide();
        } else {
            summon(&w);
        }
        return;
    }
    match build(app) {
        Ok(w) => summon(&w),
        Err(e) => plog!("pigeon", "{e}"),
    }
}

fn summon<R: Runtime>(w: &tauri::WebviewWindow<R>) {
    place(w);
    /* The panel's own way up, which makes it key without activating Pigeon.
       Where that is not available — another platform, or a Mac that refused
       the panel — it is an ordinary window and comes up the ordinary way. */
    #[cfg(target_os = "macos")]
    let shown = w.ns_window().map(|p| mac::show(p)).unwrap_or(false);
    #[cfg(not(target_os = "macos"))]
    let shown = false;
    if !shown {
        let _ = w.show();
        let _ = w.set_focus();
    }
    /* The page hears that it is up: Patch lands, the box takes the caret. */
    let _ = w.emit_to(BAR, "bar-shown", ());
}

/// Centred on the screen the pointer is on — the one being looked at — with
/// the glass, not the window, at `FROM_TOP`.
fn place<R: Runtime>(w: &tauri::WebviewWindow<R>) {
    let app = w.app_handle();
    let mon = app
        .cursor_position()
        .ok()
        .and_then(|p| app.monitor_from_point(p.x, p.y).ok().flatten())
        .or_else(|| w.current_monitor().ok().flatten())
        .or_else(|| app.primary_monitor().ok().flatten());
    let Some(mon) = mon else { return };
    let size = mon.size().to_logical::<f64>(mon.scale_factor());
    let at = mon.position().to_logical::<f64>(mon.scale_factor());
    let x = at.x + (size.width - window_w()) / 2.0;
    let y = at.y + size.height * FROM_TOP - TOP;
    let _ = w.set_position(LogicalPosition::new(x, y.max(at.y)));
}

fn build<R: Runtime>(app: &AppHandle<R>) -> Result<tauri::WebviewWindow<R>, String> {
    let w = WebviewWindowBuilder::new(app, BAR, WebviewUrl::App("bar.html".into()))
        .title("Ask Patch")
        .inner_size(window_w(), window_h(GLASS_MIN))
        .resizable(false)
        .decorations(false)
        .transparent(true)
        /* The shadow macOS would draw follows every opaque pixel — Patch, the
           text, all of it — and does not follow them when they move. The page
           draws the bar's shadow itself. */
        .shadow(false)
        .always_on_top(true)
        .visible_on_all_workspaces(true)
        .skip_taskbar(true)
        .visible(false)
        .disable_drag_drop_handler()
        .build()
        .map_err(|e| format!("the summon bar could not be built: {e}"))?;
    let _ = w.set_size(LogicalSize::new(window_w(), window_h(GLASS_MIN)));
    #[cfg(target_os = "macos")]
    {
        if let Ok(p) = w.ns_window() {
            mac::become_panel(p);
        }
        if let Ok(v) = w.ns_view() {
            mac::lay_glass(v);
        }
    }
    Ok(w)
}

/// The page is done with the bar: Escape on an empty box, a click beside it,
/// or ⌘↩ on the way to the window. Takes nothing and names no window.
#[tauri::command]
pub async fn bar_hide<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    if let Some(w) = app.get_webview_window(BAR) {
        let _ = w.hide();
    }
    Ok(())
}

/// The page says how tall the glass needs to be for what it is showing. The
/// figure is clamped here, the width is not the page's to give, and the window
/// grows downward from where it already is.
#[tauri::command]
pub async fn bar_fit<R: Runtime>(app: AppHandle<R>, height: f64) -> Result<(), String> {
    if !height.is_finite() {
        return Err("the bar's height has to be a number".into());
    }
    GLASS_H.store(height.clamp(GLASS_MIN, GLASS_MAX).to_bits(), Ordering::Relaxed);
    relay(&app, false);
    Ok(())
}

/// The pointer is near the bar, or has gone: the bubbles part from its end, or
/// rejoin it. OPEN or SHUT, and how many are drawn — three, or four when the
/// Pigeon picked can play — is all the page says; `count` is clamped here.
#[tauri::command]
pub async fn bar_bubbles<R: Runtime>(app: AppHandle<R>, open: bool, count: Option<u32>) -> Result<(), String> {
    let count = count.map_or(shown(), |n| (n as usize).clamp(3, BUBBLES));
    let moved = OPEN.swap(open, Ordering::Relaxed) != open;
    if SHOWN.swap(count, Ordering::Relaxed) != count || moved {
        relay(&app, true);
    }
    Ok(())
}

/// Back up after `bar_hide` — the bar steps out of its own screenshot, and
/// comes back once the picture is taken. Takes nothing.
#[tauri::command]
pub async fn bar_show<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let up = app.clone();
    app.run_on_main_thread(move || {
        if let Some(w) = up.get_webview_window(BAR) {
            if !w.is_visible().unwrap_or(false) {
                summon(&w);
            }
        }
    })
    .map_err(|e| e.to_string())
}

/// Size the window and put every piece of glass where it now belongs, on the
/// main thread, which is the only place AppKit may be touched.
fn relay<R: Runtime>(app: &AppHandle<R>, animate: bool) {
    let on_main = app.clone();
    let _ = app.run_on_main_thread(move || {
        let Some(w) = on_main.get_webview_window(BAR) else { return };
        let _ = w.set_size(LogicalSize::new(window_w(), window_h(glass_h())));
        #[cfg(target_os = "macos")]
        mac::layout(glass_h(), OPEN.load(Ordering::Relaxed), shown(), animate);
        #[cfg(not(target_os = "macos"))]
        let _ = animate;
    });
}

/// A debug build can be told to bring the bar up by itself, because a test
/// session on this Mac cannot press a global key chord. It reports what came
/// up on stderr and changes nothing in a release build.
pub fn summon_at_launch_if_asked<R: Runtime>(app: &AppHandle<R>) {
    if !cfg!(debug_assertions) || std::env::var("PIGEON_BAR_AT_LAUNCH").map(|v| v != "1").unwrap_or(true) {
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(3));
        let up = app.clone();
        let _ = app.run_on_main_thread(move || toggle(&up));
        std::thread::sleep(std::time::Duration::from_secs(2));
        let say = app.clone();
        let _ = app.run_on_main_thread(move || match say.get_webview_window(BAR) {
            Some(w) => {
                #[cfg(target_os = "macos")]
                let native = w.ns_window().map(|p| mac::describe(p)).unwrap_or_default();
                #[cfg(not(target_os = "macos"))]
                let native = String::new();
                plog!(
                    "bar",
                    "visible={:?} focused={:?} size={:?} {native}",
                    w.is_visible(),
                    w.is_focused(),
                    w.inner_size().map(|s| s.to_logical::<f64>(w.scale_factor().unwrap_or(1.0)))
                );
            }
            None => plog!("pigeon", "bar was not built"),
        });
    });
}

#[cfg(target_os = "macos")]
pub(crate) mod mac {
    //! AppKit, spoken to directly. Every function here is called on the main
    //! thread — from setup, a tray or shortcut handler, or `run_on_main_thread`
    //! — and says so by refusing to run anywhere else.

    use std::ffi::c_void;
    use std::sync::Mutex;

    use objc2::rc::Retained;
    use objc2::runtime::{AnyClass, AnyObject};
    use objc2::{define_class, msg_send, ClassType, MainThreadMarker, MainThreadOnly};
    use objc2_app_kit::{
        NSAnimationContext, NSAutoresizingMaskOptions, NSPanel, NSView, NSVisualEffectBlendingMode, NSVisualEffectMaterial,
        NSVisualEffectState, NSVisualEffectView, NSWindow, NSWindowCollectionBehavior, NSWindowOrderingMode,
        NSWindowStyleMask,
    };
    use objc2_foundation::{NSPoint, NSRect, NSSize};

    use super::{BUBBLE, BUBBLES, GAP, GLASS_MIN, GLASS_W, MARGIN, PART_S, RADIUS, TOP};

    define_class!(
        /* A borderless panel refuses to become key unless it is told it may.
           tao's own window class says yes for the same reason; this one has to
           say it again because the window stops being tao's class below. It
           is never the MAIN window: that stays the one with the chats in it. */
        #[unsafe(super(NSPanel))]
        #[thread_kind = MainThreadOnly]
        #[name = "PigeonBarPanel"]
        struct BarPanel;

        impl BarPanel {
            #[unsafe(method(canBecomeKeyWindow))]
            fn can_become_key_window(&self) -> bool {
                true
            }

            #[unsafe(method(canBecomeMainWindow))]
            fn can_become_main_window(&self) -> bool {
                false
            }
        }
    );

    /// Above the menu bar's own level, so a full-screen app does not cover it.
    const LEVEL: isize = 25;

    fn window<'a>(ns_window: *mut c_void) -> Option<&'a NSWindow> {
        MainThreadMarker::new()?;
        /* SAFETY: tauri hands out its live NSWindow, and the marker above
           proves this is the thread AppKit objects may be touched on. */
        unsafe { (ns_window as *const NSWindow).as_ref() }
    }

    /// Turn tao's window into a non-activating panel: same object, same
    /// delegate, same webview, a different class and one more style bit.
    pub fn become_panel(ns_window: *mut c_void) -> bool {
        let Some(w) = window(ns_window) else { return false };
        /* SAFETY: NSPanel adds no instance variables to NSWindow, and tao keeps
           its state in the delegate and the view, so the object is a valid
           instance of the new class. This is the same swap tauri-nspanel makes. */
        unsafe {
            objc2::ffi::object_setClass(ns_window.cast(), (BarPanel::class() as *const AnyClass).cast());
        }
        w.setStyleMask(w.styleMask() | NSWindowStyleMask::NonactivatingPanel);
        w.setLevel(LEVEL);
        /* On every Space and beside a full-screen app, the way Spotlight is. */
        w.setCollectionBehavior(
            NSWindowCollectionBehavior::CanJoinAllSpaces
                | NSWindowCollectionBehavior::Stationary
                | NSWindowCollectionBehavior::FullScreenAuxiliary,
        );
        /* A panel hides itself when its app is not the active one, and the
           whole point of this one is that its app is not the active one. */
        w.setHidesOnDeactivate(false);
        true
    }

    /// Up, in front, and key — without activating the app. False when the
    /// window never became a panel, and the caller shows it the ordinary way.
    pub fn show(ns_window: *mut c_void) -> bool {
        let Some(w) = window(ns_window) else { return false };
        if !w.styleMask().contains(NSWindowStyleMask::NonactivatingPanel) {
            return false;
        }
        w.orderFrontRegardless();
        w.makeKeyWindow();
        true
    }

    /// Up and in front WITHOUT the keyboard: the play overlay sits over a game
    /// that must keep its keys. False when the window never became a panel.
    pub fn show_quiet(ns_window: *mut c_void) -> bool {
        let Some(w) = window(ns_window) else { return false };
        if !w.styleMask().contains(NSWindowStyleMask::NonactivatingPanel) {
            return false;
        }
        w.orderFrontRegardless();
        true
    }

    /// For the debug report only.
    pub fn describe(ns_window: *mut c_void) -> String {
        let Some(w) = window(ns_window) else { return String::new() };
        let glass = w
            .contentView()
            .map(|v| {
                v.subviews()
                    .iter()
                    .map(|s| s.class().name().to_string_lossy().into_owned())
                    .collect::<Vec<_>>()
                    .join(",")
            })
            .unwrap_or_default();
        format!("class={} key={} views=[{glass}]", w.class().name().to_string_lossy(), w.isKeyWindow())
    }

    /// The four pieces, as addresses. They are retained by their superview
    /// for as long as the window lives, and the window is hidden, never closed.
    static PIECES: Mutex<[usize; 1 + BUBBLES]> = Mutex::new([0; 1 + BUBBLES]);

    fn glass(mtm: MainThreadMarker, frame: NSRect) -> Retained<NSView> {
        match AnyClass::get(c"NSGlassEffectView") {
            /* macOS 26: the real material. Looked up by name so this builds
               against, and runs on, a Mac that has never heard of it. */
            Some(class) => unsafe {
                let view: Retained<NSView> = msg_send![msg_send![class, alloc], initWithFrame: frame];
                let _: () = msg_send![&*view, setCornerRadius: RADIUS];
                view
            },
            None => {
                let view = NSVisualEffectView::initWithFrame(NSVisualEffectView::alloc(mtm), frame);
                view.setMaterial(NSVisualEffectMaterial::HUDWindow);
                view.setBlendingMode(NSVisualEffectBlendingMode::BehindWindow);
                view.setState(NSVisualEffectState::Active);
                view.setWantsLayer(true);
                unsafe {
                    let layer: Option<Retained<AnyObject>> = msg_send![&*view, layer];
                    if let Some(layer) = layer {
                        let _: () = msg_send![&*layer, setCornerRadius: RADIUS];
                        let _: () = msg_send![&*layer, setMasksToBounds: true];
                    }
                }
                Retained::into_super(view)
            }
        }
    }

    /// The glass, under the webview: a holder the size of the window, the bar
    /// and its bubbles inside it, and — where the Mac has one — a glass
    /// container round the lot so neighbouring pieces flow into each other.
    pub fn lay_glass(ns_view: *mut c_void) {
        let Some(mtm) = MainThreadMarker::new() else { return };
        /* SAFETY: as `window` — tauri's live content view, on the main thread. */
        let Some(content) = (unsafe { (ns_view as *const NSView).as_ref() }) else { return };
        let bounds = content.bounds();
        let fill = NSAutoresizingMaskOptions::ViewWidthSizable | NSAutoresizingMaskOptions::ViewHeightSizable;

        let holder = NSView::initWithFrame(NSView::alloc(mtm), bounds);
        holder.setAutoresizingMask(fill);
        let mut pieces = [0usize; 1 + BUBBLES];
        for slot in pieces.iter_mut() {
            let piece = glass(mtm, NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(BUBBLE, BUBBLE)));
            holder.addSubview(&piece);
            *slot = Retained::as_ptr(&piece) as usize;
        }
        *PIECES.lock().unwrap() = pieces;

        let under: Retained<NSView> = match AnyClass::get(c"NSGlassEffectContainerView") {
            Some(class) => unsafe {
                let container: Retained<NSView> = msg_send![msg_send![class, alloc], initWithFrame: bounds];
                let _: () = msg_send![&*container, setContentView: &*holder];
                /* Pieces closer than this flow together, so the bubbles are
                   still joined to the bar as they leave it. */
                let _: () = msg_send![&*container, setSpacing: GAP * 2.0];
                container
            },
            None => holder.clone(),
        };
        under.setAutoresizingMask(fill);
        content.addSubview_positioned_relativeTo(&under, NSWindowOrderingMode::Below, None);
        layout(GLASS_MIN, false, 3, false);
    }

    /// Where each piece goes, in the holder's coordinates (AppKit counts up
    /// from the bottom). Shut, the bubbles are tucked inside the bar's end and
    /// see-through; open, the bar gives up their width and they stand beside it.
    pub fn layout(glass_h: f64, open: bool, shown: usize, animate: bool) {
        if MainThreadMarker::new().is_none() {
            return;
        }
        let pieces = *PIECES.lock().unwrap();
        let height = TOP + glass_h + MARGIN;
        let taken = if open { shown as f64 * (BUBBLE + GAP) } else { 0.0 };
        let bar_w = GLASS_W - taken;
        let row_y = height - TOP - BUBBLE;

        if animate {
            NSAnimationContext::beginGrouping();
            let ctx = NSAnimationContext::currentContext();
            ctx.setDuration(PART_S);
            ctx.setAllowsImplicitAnimation(true);
        }
        for (i, address) in pieces.iter().enumerate() {
            /* SAFETY: set in `lay_glass`, retained by the holder ever since. */
            let Some(view) = (unsafe { (*address as *const NSView).as_ref() }) else { continue };
            let (frame, alpha) = if i == 0 {
                (NSRect::new(NSPoint::new(MARGIN, MARGIN), NSSize::new(bar_w, glass_h)), 1.0)
            } else if open && i <= shown {
                let x = MARGIN + bar_w + GAP + (i - 1) as f64 * (BUBBLE + GAP);
                (NSRect::new(NSPoint::new(x, row_y), NSSize::new(BUBBLE, BUBBLE)), 1.0)
            } else {
                (NSRect::new(NSPoint::new(MARGIN + GLASS_W - BUBBLE, row_y), NSSize::new(BUBBLE, BUBBLE)), 0.0)
            };
            if animate {
                let moving: Retained<NSView> = unsafe { msg_send![view, animator] };
                moving.setFrame(frame);
                moving.setAlphaValue(alpha);
            } else {
                view.setFrame(frame);
                view.setAlphaValue(alpha);
            }
        }
        if animate {
            NSAnimationContext::endGrouping();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The page names a height and nothing else, and whatever it names the
    /// window stays between one row and the cap.
    #[test]
    fn the_page_cannot_make_the_bar_any_size_it_likes() {
        assert_eq!(window_h(0.0), TOP + GLASS_MIN + MARGIN);
        assert_eq!(window_h(-400.0), TOP + GLASS_MIN + MARGIN);
        assert_eq!(window_h(1e9), TOP + GLASS_MAX + MARGIN);
        assert_eq!(window_h(200.0), TOP + 200.0 + MARGIN);
        assert_eq!(window_w(), GLASS_W + 2.0 * MARGIN);
    }

    /// An empty bar is a pill and a bubble is a circle: the corner is exactly
    /// half of one row, and a bubble is one row across.
    #[test]
    fn the_empty_bar_is_a_pill() {
        assert_eq!(RADIUS * 2.0, GLASS_MIN);
        assert_eq!(BUBBLE, GLASS_MIN);
    }
}
