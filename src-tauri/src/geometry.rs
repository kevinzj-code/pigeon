//! Where the window was last time.
//!
//! Pigeon opens 1100×780 in whatever spot the system picks, every launch,
//! however the person had arranged it. The usual answer to that is
//! `tauri-plugin-window-state`, and the usual answer is not available here: the
//! house rule at the top of `Cargo.toml` is that the webview's reach does not
//! grow to solve a problem like this one.
//!
//! It does not have to. Nothing about remembering a window needs the page to be
//! involved at all — it never learns the geometry, never asks for it and gets
//! no new command — so this is Rust talking to itself, in a file of its own
//! beside the chats. `store.rs` stays what its header says it is: Pigeon's one
//! file of CHATS. This is a second file, of one line, holding no conversation.
//!
//! Three things a naive version of this gets wrong, and they are the reason it
//! is a module rather than four lines inlined:
//!
//!   · A minimised, zoomed or full-screen window reports the screen's shape,
//!     not the shape you would want back. Those are not written down.
//!   · A window saved on a monitor that is no longer plugged in comes back
//!     somewhere nobody can reach. A restored position has to still land on a
//!     screen that exists.
//!   · Geometry is stored in LOGICAL pixels, so moving between a Retina display
//!     and an external one does not double or halve the window. It is also what
//!     `minWidth`/`minHeight` in `tauri.conf.json` are written in, which is what
//!     makes clamping against them mean anything.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, LogicalPosition, LogicalSize, Runtime, WebviewWindow};

/// Keep these in step with `tauri.conf.json`'s window entry. A file that asks
/// for something smaller is honoured up to the same floor the person would hit
/// dragging the corner.
const MIN_W: f64 = 720.0;
const MIN_H: f64 = 520.0;

/// How much of the window has to be on a screen for it to be usable: enough
/// title bar to grab and drag the rest back.
const GRABBABLE_W: f64 = 120.0;
const GRABBABLE_H: f64 = 60.0;

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
pub struct Geometry {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

fn path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    Ok(crate::weights::app_subdir(app, "")?.join("window.json"))
}

/// The window as it stands, in logical pixels — or None when what it would
/// report is not worth keeping.
fn current<R: Runtime>(win: &WebviewWindow<R>) -> Option<Geometry> {
    if win.is_minimized().unwrap_or(false)
        || win.is_maximized().unwrap_or(false)
        || win.is_fullscreen().unwrap_or(false)
    {
        return None;
    }
    let scale = win.scale_factor().ok()?;
    let pos = win.outer_position().ok()?;
    let size = win.inner_size().ok()?;
    let g = Geometry {
        x: pos.x as f64 / scale,
        y: pos.y as f64 / scale,
        width: size.width as f64 / scale,
        height: size.height as f64 / scale,
    };
    (g.width >= 1.0 && g.height >= 1.0).then_some(g)
}

/// Would this window land somewhere a person could actually get at it? True
/// when a usable corner of it falls on some monitor that exists right now.
fn reachable<R: Runtime>(win: &WebviewWindow<R>, g: &Geometry) -> bool {
    let Ok(monitors) = win.available_monitors() else {
        return false;
    };
    monitors.iter().any(|m| {
        let s = m.scale_factor();
        let (mx, my) = (m.position().x as f64 / s, m.position().y as f64 / s);
        let (mw, mh) = (m.size().width as f64 / s, m.size().height as f64 / s);
        let across = (g.x + g.width).min(mx + mw) - g.x.max(mx);
        let down = (g.y + g.height).min(my + mh) - g.y.max(my);
        across >= GRABBABLE_W && down >= GRABBABLE_H
    })
}

/// Write down where the window is. Called on the way out — both ways out — and
/// never on a move or a resize: a drag emits hundreds of those, and a file
/// written hundreds of times to record a number nobody reads until the next
/// launch is a lot of work for nothing.
pub fn remember<R: Runtime>(app: &AppHandle<R>, win: &WebviewWindow<R>) {
    let Some(g) = current(win) else { return };
    let Ok(p) = path(app) else { return };
    if let Ok(json) = serde_json::to_vec(&g) {
        let _ = std::fs::write(p, json);
    }
}

/// Put the window back where it was, if where it was still exists. Silent about
/// every failure on purpose: a window that opens at its default size is the
/// behaviour this had before, and is no reason to tell anybody anything.
pub fn restore<R: Runtime>(app: &AppHandle<R>, win: &WebviewWindow<R>) {
    let Ok(p) = path(app) else { return };
    let Ok(raw) = std::fs::read(&p) else { return };
    let Ok(saved) = serde_json::from_slice::<Geometry>(&raw) else { return };
    let g = clamp(saved);
    if !reachable(win, &g) {
        return;
    }
    let _ = win.set_size(LogicalSize::new(g.width, g.height));
    let _ = win.set_position(LogicalPosition::new(g.x, g.y));
}

/// A size below the floor the window enforces anyway.
fn clamp(g: Geometry) -> Geometry {
    Geometry {
        width: g.width.max(MIN_W),
        height: g.height.max(MIN_H),
        ..g
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_too_small_saved_size_comes_back_at_the_floor() {
        let g = clamp(Geometry { x: 10.0, y: 20.0, width: 300.0, height: 100.0 });
        assert_eq!(g.width, MIN_W);
        assert_eq!(g.height, MIN_H);
        assert_eq!((g.x, g.y), (10.0, 20.0), "the position is not the size's business");
    }

    #[test]
    fn a_reasonable_size_is_left_exactly_as_it_was() {
        let want = Geometry { x: -40.0, y: 12.0, width: 1400.0, height: 900.0 };
        assert_eq!(clamp(want), want);
    }

    /// The overlap rule, without a monitor to ask: the same arithmetic
    /// `reachable` runs, against one screen at the origin.
    fn lands_on_a_1440_by_900_screen(g: &Geometry) -> bool {
        let across = (g.x + g.width).min(1440.0) - g.x.max(0.0);
        let down = (g.y + g.height).min(900.0) - g.y.max(0.0);
        across >= GRABBABLE_W && down >= GRABBABLE_H
    }

    #[test]
    fn a_window_from_a_monitor_that_is_gone_is_not_restored() {
        // The second screen was to the right; it is not there any more.
        let off = Geometry { x: 2200.0, y: 300.0, width: 1100.0, height: 780.0 };
        assert!(!lands_on_a_1440_by_900_screen(&off));
        // Hanging off the left edge, but with plenty still grabbable.
        let peeking = Geometry { x: -200.0, y: 40.0, width: 1100.0, height: 780.0 };
        assert!(lands_on_a_1440_by_900_screen(&peeking));
        // Only a sliver showing: not enough to get hold of.
        let sliver = Geometry { x: 1400.0, y: 40.0, width: 1100.0, height: 780.0 };
        assert!(!lands_on_a_1440_by_900_screen(&sliver));
    }

    #[test]
    fn what_goes_in_comes_back_as_json() {
        let g = Geometry { x: 1.5, y: -2.5, width: 1100.0, height: 780.0 };
        let round: Geometry = serde_json::from_slice(&serde_json::to_vec(&g).unwrap()).unwrap();
        assert_eq!(round, g);
    }
}
