//! Pigeon's menus at the top of the screen — not the menu-bar icon (tray.rs).
//!
//! The page never names a menu item and the menu never names a page: an item
//! has an id from `ACTIONS`, and choosing it brings the main window forward and
//! emits `app-menu` with that id. What the id opens is the page's business.
//!
//! Replacing Tauri's default menu drops its Edit menu, and on macOS that menu is
//! what makes ⌘C, ⌘V and ⌘A work in a webview — so it is rebuilt here from the
//! platform's own predefined items, along with the Pigeon and Window menus.
//!
//! The Developer menu (Skills, Run a Plan, Reality vs. Aspiration) is shown only
//! when the person switches it on in Settings › Advanced; `set_dev_menu`
//! rebuilds the whole menu with or without it.

use tauri::menu::{IsMenuItem, Menu, MenuEvent, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Manager, Runtime};

/// The event the page listens to. Payload: one of `ACTIONS`.
pub const EVENT: &str = "app-menu";

/// Every id a menu item may carry into the page.
pub const ACTIONS: [&str; 7] = ["new-message", "add-pigeon", "settings", "skills", "plan", "ledger", "shortcuts"];

/// Not a page action: the File menu's way to the summon bar, which Rust
/// toggles itself (bar.rs). The chord is global, so the item carries no
/// accelerator — it is written in the title, as the tray's is.
pub const ASK_ANYWHERE: &str = "ask-anywhere";

/// The commit this build was made from ("6cc112b", or "6cc112b+changes").
pub const COMMIT: &str = env!("PIGEON_COMMIT");

/// About reads "Version 0.1.0 (6cc112b)": the app's version, then the commit,
/// so two builds of the same version can be told apart.
fn about_metadata<R: Runtime>(app: &AppHandle<R>) -> tauri::menu::AboutMetadata<'static> {
    tauri::menu::AboutMetadata {
        version: Some(app.package_info().version.to_string()),
        short_version: Some(COMMIT.to_string()),
        ..Default::default()
    }
}

pub fn build<R: Runtime>(app: &AppHandle<R>, developer: bool) -> tauri::Result<Menu<R>> {
    let app_menu = Submenu::with_items(
        app,
        "Pigeon",
        true,
        &[
            &PredefinedMenuItem::about(app, None, Some(about_metadata(app)))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "settings", "Settings…", true, Some("CmdOrCtrl+,"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::services(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::show_all(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::quit(app, None)?,
        ],
    )?;
    let file = Submenu::with_items(
        app,
        "File",
        true,
        &[
            &MenuItem::with_id(app, "new-message", "New Chat", true, Some("CmdOrCtrl+N"))?,
            &MenuItem::with_id(app, "add-pigeon", "Add a Pigeon…", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, ASK_ANYWHERE, format!("Ask Patch Anywhere   {}", crate::bar::CHORD_LABEL), true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::close_window(app, None)?,
        ],
    )?;
    let edit = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;
    let window = Submenu::with_items(
        app,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::maximize(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::fullscreen(app, None)?,
        ],
    )?;
    let help = Submenu::with_items(
        app,
        "Help",
        true,
        &[
            &MenuItem::with_id(app, "skills", "What Patch Can Do", true, None::<&str>)?,
            &MenuItem::with_id(app, "shortcuts", "Keyboard Shortcuts", true, Some("CmdOrCtrl+/"))?,
        ],
    )?;
    let dev = Submenu::with_items(
        app,
        "Developer",
        true,
        &[
            &MenuItem::with_id(app, "skills", "Skills", true, None::<&str>)?,
            &MenuItem::with_id(app, "plan", "Run a Plan", true, None::<&str>)?,
            &MenuItem::with_id(app, "ledger", "Reality vs. Aspiration", true, None::<&str>)?,
        ],
    )?;
    let mut items: Vec<&dyn IsMenuItem<R>> = vec![&app_menu, &file, &edit, &window];
    /* A release build has no Developer menu, whatever the setting says: the
       views behind it are the project's own lab bench, not the app. */
    if developer && cfg!(debug_assertions) {
        items.push(&dev);
    }
    items.push(&help);
    Menu::with_items(app, &items)
}

/// A menu item was chosen. Anything that is not one of `ACTIONS` — the tray's
/// own items arrive here too — is left to whoever built it.
pub fn on_event<R: Runtime>(app: &AppHandle<R>, event: MenuEvent) {
    let id = event.id().as_ref();
    if id == ASK_ANYWHERE {
        crate::bar::toggle(app);
        return;
    }
    if !is_action(id) {
        return;
    }
    crate::tray::show_main(app);
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.emit(EVENT, id);
    }
}

pub fn is_action(id: &str) -> bool {
    ACTIONS.contains(&id)
}

/// Settings › Advanced › Developer menu. Rebuilds the menu bar with or
/// without the Developer menu. Sync, so it runs on the main thread menus need.
#[tauri::command]
pub fn set_dev_menu<R: Runtime>(app: AppHandle<R>, on: bool) -> Result<(), String> {
    let menu = build(&app, on).map_err(|e| e.to_string())?;
    app.set_menu(menu).map(|_| ()).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_tray_items_are_not_page_actions_and_every_action_is_distinct() {
        for tray_id in ["open", "wake", "sleep", "quit", ASK_ANYWHERE] {
            assert!(!is_action(tray_id), "{tray_id} belongs to the tray");
        }
        let mut seen = std::collections::HashSet::new();
        assert!(ACTIONS.iter().all(|a| seen.insert(*a)));
    }
}
