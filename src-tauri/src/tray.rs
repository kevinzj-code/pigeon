//! Patch in the menu bar.
//!
//! The window is where real work happens; this is for the question you have
//! while doing something else, which is most of them. Clicking the icon opens
//! a popover — a second, smaller webview that runs the same pipeline — and the
//! menu behind it holds the five things a resident app has to offer: ask Patch
//! from the summon bar (`bar.rs` — the item is also where its key chord is
//! written down), open the window, wake the models, put them back to sleep,
//! quit.
//!
//! **The icon is a template image.** Patch's head only, one flat colour,
//! geometry lifted from the drawing the app already ships. macOS recolours a
//! template image for the menu bar it finds itself in, light or dark, and that
//! is also Patch's own rule: the illustrated, full-colour character stays
//! inside the app. The bytes are compiled in rather than read from a path, so
//! there is no file for a broken install to be missing.
//!
//! Waking and sleeping from here are the same two commands the page calls.
//! Nothing in this file knows what a model is; it asks the engine, like
//! everything else does.

use tauri::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, Runtime, WebviewUrl, WebviewWindowBuilder};

use crate::engine::Engine;

/// The popover's window label. It is named in `capabilities/default.json`, and
/// that file's commit is the place the grant is argued.
pub const POPOVER: &str = "popover";
/// Big enough for a question, an answer with its provenance, and three
/// actions. Small enough to be a popover rather than a second window.
const POPOVER_W: f64 = 380.0;
const POPOVER_H: f64 = 430.0;

/// Patch's head, 44px so the menu bar has a retina copy to scale from. The
/// tray crate normalises any icon to 18 points tall, keeping its aspect.
const ICON: &[u8] = include_bytes!("../icons/tray.png");

pub const ID: &str = "pigeon";

pub fn build<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let icon = tauri::image::Image::from_bytes(ICON).map_err(|e| format!("tray icon: {e}"))?;

    /* The chord is in the title, not an accelerator: a tray menu's accelerator
       only works while the menu is open, and this one works from anywhere. */
    let menu = menu(app, None)?;

    TrayIconBuilder::with_id(ID)
        .icon(icon)
        .icon_as_template(true)
        .tooltip("Pigeon")
        .menu(&menu)
        /* Left click belongs to the popover; the menu is the right-click. */
        .show_menu_on_left_click(false)
        .on_menu_event(on_menu)
        .on_tray_icon_event(on_icon)
        .build(app)
        .map_err(err)?;
    Ok(())
}

/// The right-click menu. While a Pigeon plays (`playing` is its name) it
/// leads with what is happening and the two things to do about it.
fn menu<R: Runtime>(app: &AppHandle<R>, playing: Option<&str>) -> Result<Menu<R>, String> {
    let ask = MenuItem::with_id(app, "ask", format!("Ask Patch…   {}", crate::bar::CHORD_LABEL), true, None::<&str>).map_err(err)?;
    let open = MenuItem::with_id(app, "open", "Open Pigeon", true, None::<&str>).map_err(err)?;
    let wake = MenuItem::with_id(app, "wake", "Wake the models", true, None::<&str>).map_err(err)?;
    let sleep = MenuItem::with_id(app, "sleep", "Put the models to sleep", true, None::<&str>).map_err(err)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Pigeon", true, None::<&str>).map_err(err)?;
    let sep1 = PredefinedMenuItem::separator(app).map_err(err)?;
    let sep2 = PredefinedMenuItem::separator(app).map_err(err)?;
    let Some(name) = playing else {
        return Menu::with_items(app, &[&ask, &open, &sep1, &wake, &sleep, &sep2, &quit]).map_err(err);
    };
    let what = MenuItem::with_id(app, "playing", format!("{name} is playing"), false, None::<&str>).map_err(err)?;
    let stop = MenuItem::with_id(app, "play-stop", format!("Stop playing   {}", crate::play::STOP_CHORD), true, None::<&str>).map_err(err)?;
    let hud = MenuItem::with_id(app, "play-hud", "Show what it sees", true, None::<&str>).map_err(err)?;
    let sep0 = PredefinedMenuItem::separator(app).map_err(err)?;
    Menu::with_items(app, &[&what, &stop, &hud, &sep0, &ask, &open, &sep1, &wake, &sleep, &sep2, &quit]).map_err(err)
}

/// The menu bar while a Pigeon plays: its move count beside the icon, and the
/// menu leading with Stop. Back to the plain icon and menu when it stops.
pub fn playing<R: Runtime>(app: &AppHandle<R>, s: &crate::play::PlayStatus) {
    let Some(tray) = app.tray_by_id(ID) else { return };
    let live = matches!(s.state.as_str(), "starting" | "playing" | "waiting");
    let title = match s.state.as_str() {
        "starting" => Some("▶".to_string()),
        "waiting" => Some("❙❙".to_string()),
        "playing" => Some(format!("▶ {}", s.turns)),
        _ => None,
    };
    let _ = tray.set_title(title.as_deref());
    /* The menu is rebuilt only when a play starts or stops, not every move. */
    use std::sync::atomic::{AtomicBool, Ordering};
    static SHOWN_PLAYING: AtomicBool = AtomicBool::new(false);
    if SHOWN_PLAYING.swap(live, Ordering::SeqCst) != live {
        let name = s.name.clone().unwrap_or_else(|| "A Pigeon".into());
        if let Ok(m) = menu(app, live.then_some(name.as_str())) {
            let _ = tray.set_menu(Some(m));
        }
        let _ = tray.set_tooltip(Some(if live { format!("Pigeon · {name} is playing") } else { "Pigeon".into() }));
    }
}

fn err(e: impl std::fmt::Display) -> String {
    format!("the menu bar item could not be built: {e}")
}

fn on_menu<R: Runtime>(app: &AppHandle<R>, event: MenuEvent) {
    match event.id.as_ref() {
        "ask" => crate::bar::toggle(app),
        "open" => show_main(app),
        "wake" => {
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                let _ = crate::engine::engine_wake(app).await;
            });
        }
        "sleep" => app.state::<Engine>().sleep_all(Some(app)),
        "play-stop" => crate::play::play_stop(app.clone()),
        "play-hud" => crate::playhud::bring_back(app),
        /* Quit is the only way out. Closing the window leaves Pigeon in the
           menu bar holding the router and nothing else — see lib.rs. */
        "quit" => app.exit(0),
        _ => {}
    }
}

fn on_icon<R: Runtime>(tray: &tauri::tray::TrayIcon<R>, event: TrayIconEvent) {
    /* A left click toggles the popover, which is what a menu-bar item is for.
       The menu is the right click, so the two never fight. */
    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, rect, .. } = event {
        toggle_popover(tray.app_handle(), Some(rect.position));
    }
}

/// Show the popover under the menu-bar icon, or hide it if it is already up.
pub fn toggle_popover<R: Runtime>(app: &AppHandle<R>, under: Option<tauri::Position>) {
    if let Some(w) = app.get_webview_window(POPOVER) {
        if w.is_visible().unwrap_or(false) {
            let _ = w.hide();
            return;
        }
        place(&w, under);
        raise(&w);
        return;
    }
    match build_popover(app) {
        Ok(w) => {
            place(&w, under);
            raise(&w);
        }
        Err(e) => plog!("pigeon", "{e}"),
    }
}

/// Up and taking the keyboard WITHOUT making Pigeon the active app — the way
/// the summon bar comes up — so Escape puts the keyboard straight back in
/// whatever you were doing. A window that never became a panel is shown the
/// ordinary way.
fn raise<R: Runtime>(w: &tauri::WebviewWindow<R>) {
    #[cfg(target_os = "macos")]
    if w.ns_window().map(crate::bar::mac::show).unwrap_or(false) {
        return;
    }
    let _ = w.show();
    let _ = w.set_focus();
}

/// Centre it under the icon, kept on screen. A popover that hangs off the
/// right edge of the display is how this normally goes wrong.
fn place<R: Runtime>(w: &tauri::WebviewWindow<R>, under: Option<tauri::Position>) {
    let Some(pos) = under else { return };
    let scale = w.scale_factor().unwrap_or(1.0);
    let icon = match pos {
        tauri::Position::Physical(p) => LogicalPosition::new(p.x as f64 / scale, p.y as f64 / scale),
        tauri::Position::Logical(p) => LogicalPosition::new(p.x, p.y),
    };
    let mut x = icon.x - POPOVER_W / 2.0;
    if let Ok(Some(mon)) = w.current_monitor() {
        let ms = mon.size().to_logical::<f64>(mon.scale_factor());
        let mp = mon.position().to_logical::<f64>(mon.scale_factor());
        let right = mp.x + ms.width - POPOVER_W - 8.0;
        x = x.min(right).max(mp.x + 8.0);
    }
    /* Just below the menu bar, not overlapping it. */
    let _ = w.set_position(LogicalPosition::new(x, icon.y + 26.0));
}

fn build_popover<R: Runtime>(app: &AppHandle<R>) -> Result<tauri::WebviewWindow<R>, String> {
    WebviewWindowBuilder::new(app, POPOVER, WebviewUrl::App("popover.html".into()))
        .title("Pigeon")
        .inner_size(POPOVER_W, POPOVER_H)
        .resizable(false)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(false)
        /* Same rule as the main window: a file dropped on the page arrives as
           bytes through HTML5, never as a path through the shell. */
        .disable_drag_drop_handler()
        .build()
        .map_err(|e| format!("the popover window could not be built: {e}"))
        .inspect(|w| {
            let _ = w.set_size(LogicalSize::new(POPOVER_W, POPOVER_H));
            #[cfg(target_os = "macos")]
            if let Ok(p) = w.ns_window() {
                crate::bar::mac::become_panel(p);
            }
        })
}

/// Escape in the popover, and the first half of stepping out of its own
/// screenshot. `core:default` gives a page no way to hide a window, so the page
/// asks; it takes nothing and can only ever mean this window.
#[tauri::command]
pub async fn popover_hide<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    if let Some(w) = app.get_webview_window(POPOVER) {
        let _ = w.hide();
    }
    Ok(())
}

/// The second half: back where it was, with the keyboard, once the picture is
/// taken. It is not re-placed — it only ever comes back from its own hide.
#[tauri::command]
pub async fn popover_show<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let up = app.clone();
    app.run_on_main_thread(move || {
        if let Some(w) = up.get_webview_window(POPOVER) {
            raise(&w);
        }
    })
    .map_err(|e| e.to_string())
}

/// Bring the main window back, and the Dock icon with it.
pub fn show_main<R: Runtime>(app: &AppHandle<R>) {
    #[cfg(target_os = "macos")]
    let _ = app.set_activation_policy(tauri::ActivationPolicy::Regular);
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

/// The window closed and Pigeon carried on in the menu bar. Drop the Dock icon
/// so what is left looks like what it is: a menu-bar app, not a window that
/// went missing. The tray item is how it comes back.
pub fn went_to_the_menu_bar<R: Runtime>(app: &AppHandle<R>) {
    #[cfg(target_os = "macos")]
    let _ = app.set_activation_policy(tauri::ActivationPolicy::Accessory);
    #[cfg(not(target_os = "macos"))]
    let _ = app;
}
