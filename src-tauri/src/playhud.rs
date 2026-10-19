//! The play overlay: a small panel in the top-right corner that shows what a
//! playing Pigeon sees, the key it last pressed and how many moves it has
//! made, with Stop and Hide.
//!
//! It exists because of where a play happens. Keys are only pressed while the
//! game is in front (play.rs), so Pigeon's own window is behind the game for
//! the whole of a play — anything drawn there is drawn where nobody can see
//! it. The overlay is the summon bar's kind of window: a non-activating panel
//! (bar.rs `mac::become_panel`), on every Space, above a full-screen game. It
//! is ordered front without ever being made key, so the game keeps the
//! keyboard; clicking it does not make Pigeon the active app, so the game
//! stays in front and the play goes on.
//!
//! It follows the play: `play::set` calls `follow` on every change. It comes
//! up when a play starts, unless the person hid it, and the page itself
//! closes it a little while after the play stops. `play_hud` is the page's
//! one say in it — show or hide — and names no window.

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{AppHandle, LogicalPosition, Manager, Runtime, WebviewUrl, WebviewWindowBuilder};

use crate::play::PlayStatus;

pub const HUD: &str = "playhud";
const W: f64 = 280.0;
const H: f64 = 292.0;
/// From the top-right corner of the screen, below the menu bar.
const INSET: f64 = 16.0;
const BELOW_MENU_BAR: f64 = 38.0;

/// The person pressed Hide during this play: it stays hidden until the next.
static HIDDEN: AtomicBool = AtomicBool::new(false);

/// Called on every play-event. Shows the overlay when a play starts (and
/// keeps it up while it runs, unless hidden); leaves a stopped one to the page.
pub fn follow<R: Runtime>(app: &AppHandle<R>, s: &PlayStatus) {
    if s.state == "starting" {
        HIDDEN.store(false, Ordering::SeqCst);
    }
    let wanted = matches!(s.state.as_str(), "starting" | "playing" | "waiting") && !HIDDEN.load(Ordering::SeqCst);
    if !wanted {
        return;
    }
    let up = app.get_webview_window(HUD).is_some_and(|w| w.is_visible().unwrap_or(false));
    if !up {
        show(app);
    }
}

fn show<R: Runtime>(app: &AppHandle<R>) {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        let w = match handle.get_webview_window(HUD) {
            Some(w) => w,
            None => match build(&handle) {
                Ok(w) => w,
                Err(e) => {
                    plog!("pigeon", "{e}");
                    return;
                }
            },
        };
        place(&handle, &w);
        #[cfg(target_os = "macos")]
        if w.ns_window().map(crate::bar::mac::show_quiet).unwrap_or(false) {
            return;
        }
        let _ = w.show();
    });
}

fn hide<R: Runtime>(app: &AppHandle<R>) {
    if let Some(w) = app.get_webview_window(HUD) {
        let _ = w.hide();
    }
}

fn build<R: Runtime>(app: &AppHandle<R>) -> Result<tauri::WebviewWindow<R>, String> {
    let w = WebviewWindowBuilder::new(app, HUD, WebviewUrl::App("hud.html".into()))
        .title("Playing")
        .inner_size(W, H)
        .resizable(false)
        .decorations(false)
        .transparent(true)
        .shadow(true)
        .always_on_top(true)
        .visible_on_all_workspaces(true)
        .skip_taskbar(true)
        .focused(false)
        .visible(false)
        .disable_drag_drop_handler()
        .build()
        .map_err(|e| format!("the play overlay could not be built: {e}"))?;
    #[cfg(target_os = "macos")]
    if let Ok(p) = w.ns_window() {
        crate::bar::mac::become_panel(p);
    }
    Ok(w)
}

/// Top right of the screen the main window is on (or the main screen).
fn place<R: Runtime>(app: &AppHandle<R>, w: &tauri::WebviewWindow<R>) {
    let mon = app
        .get_webview_window("main")
        .and_then(|m| m.current_monitor().ok().flatten())
        .or_else(|| app.primary_monitor().ok().flatten());
    let Some(mon) = mon else { return };
    let size = mon.size().to_logical::<f64>(mon.scale_factor());
    let at = mon.position().to_logical::<f64>(mon.scale_factor());
    let _ = w.set_position(LogicalPosition::new(at.x + size.width - W - INSET, at.y + BELOW_MENU_BAR));
}

/// The page's say: `show` false hides the overlay for the rest of this play
/// (Hide, or the page closing a stopped play's summary); true brings it back
/// (Show the play overlay, from the menu bar or the Pigeon's page).
#[tauri::command]
pub fn play_hud<R: Runtime>(app: AppHandle<R>, show: bool) {
    if show {
        HIDDEN.store(false, Ordering::SeqCst);
        self::show(&app);
    } else {
        HIDDEN.store(true, Ordering::SeqCst);
        hide(&app);
    }
}

/// For the menu bar's Show the play overlay.
pub fn bring_back<R: Runtime>(app: &AppHandle<R>) {
    play_hud(app.clone(), true);
}
