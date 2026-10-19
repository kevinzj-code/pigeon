//! The window's own appearance, to match the theme the person chose.
//!
//! The page draws itself dark or light from `data-theme`, but the title bar,
//! the traffic lights and the native sheets are AppKit's. Two things have to
//! agree for the title to be readable, and on macOS 26 neither did:
//!
//!   · the title's ink follows the app's appearance — the Mac's, unless told
//!     otherwise — so the app is given the same choice the page has, and
//!     Match Mac hands it back;
//!   · the bar's ground was AppKit's own near-black (#1E1E1E) whatever either
//!     appearance said, so black ink landed on it in Light and Dark alike.
//!     The bar is transparent now (`titleBarStyle` in tauri.conf.json) and
//!     shows the window's own colour, which is set here to the page's
//!     surface: the bar reads as the top of the header under it.
//!
//! Measured on macOS 26.6 with a bare AppKit window before it was trusted:
//! transparent bar over light surface + Light → dark ink; over dark surface
//! + Dark → light ink.

use tauri::{Manager, Runtime, Theme, WebviewWindow};

/// Light and dark --surface, as tokens.css has them: the headers' colour, so
/// the transparent title bar reads as their top. Also what shows before the
/// page paints and under it while the window is resized.
const SURFACE_DARK: tauri::window::Color = tauri::window::Color(0x13, 0x22, 0x30, 0xFF);
const SURFACE_LIGHT: tauri::window::Color = tauri::window::Color(0xFF, 0xFF, 0xFF, 0xFF);

/// `theme` is the saved setting: "dark", "light", or anything else for Match Mac.
pub fn apply<R: Runtime>(w: &WebviewWindow<R>, theme: Option<&str>) {
    let forced = match theme {
        Some("dark") => Some(Theme::Dark),
        Some("light") => Some(Theme::Light),
        _ => None,
    };
    let _ = w.set_theme(forced);
    let dark = match forced {
        Some(t) => t == Theme::Dark,
        None => matches!(w.theme(), Ok(Theme::Dark)),
    };
    paint(w, dark);
}

/// The bar's ground for the appearance now in force. Also called when the Mac
/// changes appearance under Match Mac (lib.rs, ThemeChanged).
pub fn paint<R: Runtime>(w: &WebviewWindow<R>, dark: bool) {
    let _ = w.set_background_color(Some(if dark { SURFACE_DARK } else { SURFACE_LIGHT }));
}

/// Settings → Appearance changed. Takes only the three words Settings offers
/// and acts on the main window alone; the page gets nothing back.
#[tauri::command]
pub fn window_theme<R: Runtime>(app: tauri::AppHandle<R>, theme: String) -> Result<(), String> {
    if !matches!(theme.as_str(), "dark" | "light" | "system") {
        return Err("the theme is dark, light or system".into());
    }
    let w = app.get_webview_window("main").ok_or("the main window is not open")?;
    apply(&w, Some(&theme));
    Ok(())
}
