//! What the page knows about Pigeon's models: which are on this Mac, whether
//! they are awake, and when they go back to sleep.
//!
//! The models run in this process, through pigeon-engine (`inprocess.rs`).
//! Nothing here starts a server, holds a port or reaps a process: waking marks
//! a role ready when its weights are here (and, for the category role, when
//! Patch's nest carries his router), and the engine loads each base the first
//! time it is asked. Sleeping frees the engine and everything it loaded.
//!
//! Rules, in the order they matter:
//!   1. The page says WAKE or SLEEP. It never names a model file or a path;
//!      those are decided here from the manifest and the machine.
//!   2. Every phase change is emitted as `engine-status`, so the rail, the
//!      first-run sheet and the menu-bar popover draw the same truth.
//!   3. The person's sleep period (Settings › Models: ten minutes, an hour,
//!      or never) reaches the engine as `idle_unload_s` (E17): a base nobody
//!      has asked for that long is unloaded, and loads again on the next ask.
//!      `PIGEON_IDLE_UNLOAD_S` overrides it at launch.

use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::weights::{self, Source};
use crate::{manifest, Role};

/// The event the page listens to. Payload: `EngineStatus`.
pub const EVENT: &str = "engine-status";
/// How long a wake waits for Patch to be chosen at launch.
const PATCH_WAIT: Duration = Duration::from_secs(60);
const IDLE_ENV: &str = "PIGEON_IDLE_UNLOAD_S";
/// How long a model may sit unused before it is unloaded.
///
/// **This number is chosen, not measured, and the spec says so explicitly.**
/// The trade it settles: holding a few gigabytes against a reload next time.
/// Ten minutes is long enough that a person still working is not interrupted
/// and short enough that one who has moved on is not charged for it.
/// `PIGEON_IDLE_UNLOAD_S` overrides it; 0 means never.
const IDLE_DEFAULT_S: u64 = 600;
const DISABLED_ENV: &str = "PIGEON_NO_MODELS";

#[derive(Serialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "kebab-case")]
pub enum Phase {
    Asleep,
    Ready,
    Error,
    /// No weights on this machine yet.
    Missing,
}

/// Where the models run. One answer now: in this app.
#[derive(Serialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "kebab-case")]
pub enum BinarySource {
    InProcess,
}

/// Everything the page may know about one role. A file NAME and a source
/// word; never a path. The shape is the one the page has always read; the
/// fields that described a server process are kept, and empty.
#[derive(Serialize, Clone, Debug)]
pub struct RoleStatus {
    pub phase: Phase,
    pub owned: bool,
    pub port: u16,
    pub model: Option<String>,
    pub source: Option<Source>,
    pub adapter: Option<String>,
    pub personas: Vec<weights::PersonaInfo>,
    pub pid: Option<u32>,
    pub resident_mb: Option<u64>,
    pub waking_ms: Option<u64>,
    pub detail: String,
}

#[derive(Serialize, Clone, Debug)]
pub struct BinaryStatus {
    pub source: Option<BinarySource>,
    pub version: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
pub struct EngineStatus {
    pub disabled: bool,
    /// A debug build: the developer views and menu exist. A release has none.
    pub dev_build: bool,
    pub binary: BinaryStatus,
    /// 0 = never.
    pub idle_unload_s: u64,
    /// The one base every text Pigeon runs on (Qwen3-VL 2B).
    pub category: RoleStatus,
    pub vision: RoleStatus,
    /// Peek's model, when his Pigeon is in Patch's nest and its base and
    /// projector are on this Mac; None and Peek says what it is missing.
    pub peek: Option<String>,
}

struct Slot {
    phase: Phase,
    model: Option<String>,
    source: Option<Source>,
    detail: String,
}

impl Slot {
    fn new() -> Self {
        Slot { phase: Phase::Asleep, model: None, source: None, detail: "asleep".into() }
    }

    fn status(&self, resident_mb: Option<u64>) -> RoleStatus {
        RoleStatus {
            phase: self.phase,
            owned: true,
            port: 0,
            model: self.model.clone(),
            source: self.source,
            adapter: None,
            personas: Vec::new(),
            pid: None,
            resident_mb: if self.phase == Phase::Ready { resident_mb } else { None },
            waking_ms: None,
            detail: self.detail.clone(),
        }
    }

    fn set(&mut self, phase: Phase, detail: &str) {
        self.phase = phase;
        self.detail = detail.into();
    }
}

pub struct Engine {
    slots: [Mutex<Slot>; 2],
    last_used: Mutex<Instant>,
    idle_unload: Mutex<Option<Duration>>,
    pub disabled: bool,
}

impl Default for Engine {
    fn default() -> Self {
        Self::new()
    }
}

fn idx(role: Role) -> usize {
    match role {
        Role::Category => 0,
        Role::Vision => 1,
    }
}

fn env_flag(name: &str) -> bool {
    matches!(std::env::var(name).unwrap_or_default().trim().to_ascii_lowercase().as_str(), "1" | "true" | "yes")
}

/// Takes a lock even if a previous holder panicked: the status must still be
/// told, and sleeping must still free the engine.
fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    match m.lock() {
        Ok(g) => g,
        Err(poisoned) => poisoned.into_inner(),
    }
}

impl Engine {
    pub fn new() -> Self {
        let idle = match std::env::var(IDLE_ENV).ok().and_then(|s| s.trim().parse::<u64>().ok()) {
            Some(0) => None,
            Some(s) => Some(Duration::from_secs(s)),
            None => Some(Duration::from_secs(IDLE_DEFAULT_S)),
        };
        Engine {
            slots: [Mutex::new(Slot::new()), Mutex::new(Slot::new())],
            last_used: Mutex::new(Instant::now()),
            idle_unload: Mutex::new(idle),
            disabled: env_flag(DISABLED_ENV),
        }
    }

    fn with_slot<T>(&self, role: Role, f: impl FnOnce(&mut Slot) -> T) -> T {
        f(&mut lock(&self.slots[idx(role)]))
    }

    /// How long an unused base is held; None is never.
    pub fn idle_period(&self) -> Option<Duration> {
        *lock(&self.idle_unload)
    }

    /// The period the person chose, in seconds; 0 is never.
    pub fn set_idle_period(&self, secs: u64) {
        *lock(&self.idle_unload) = if secs == 0 { None } else { Some(Duration::from_secs(secs)) };
    }

    /// A model was just used.
    pub fn touch(&self) {
        *lock(&self.last_used) = Instant::now();
    }

    pub fn snapshot<R: tauri::Runtime>(&self, app: &AppHandle<R>) -> EngineStatus {
        let m = manifest::manifest().ok();
        let resident = |role: Role| m.and_then(|m| m.for_role(role)).map(|s| s.resident_mb);
        let status = |role: Role| self.with_slot(role, |s| s.status(resident(role)));
        EngineStatus {
            disabled: self.disabled,
            dev_build: cfg!(debug_assertions),
            binary: BinaryStatus { source: Some(BinarySource::InProcess), version: Some(pigeon_engine::version().to_string()) },
            idle_unload_s: self.idle_period().map(|d| d.as_secs()).unwrap_or(0),
            category: status(Role::Category),
            vision: status(Role::Vision),
            peek: peek_model(app),
        }
    }

    fn emit<R: tauri::Runtime>(&self, app: &AppHandle<R>) {
        let _ = app.emit(EVENT, self.snapshot(app));
    }

    /// Every role asleep, and the engine freed with everything it loaded.
    pub fn sleep_all<R: tauri::Runtime>(&self, app: Option<&AppHandle<R>>) {
        for role in Role::EVERY {
            self.with_slot(role, |s| {
                if s.phase == Phase::Ready {
                    s.set(Phase::Asleep, "asleep");
                }
            });
        }
        if let Some(a) = app {
            if let Some(me) = a.try_state::<crate::inprocess::InProcess>() {
                me.sleep();
            }
            self.emit(a);
        }
    }
}

/// A role is ready when its weights are on this Mac, and the category role
/// also needs Patch's nest to carry his router. Nothing loads here: the
/// engine loads each base the first time it is asked.
async fn wake<R: tauri::Runtime>(app: &AppHandle<R>) -> EngineStatus {
    let engine: State<Engine> = app.state();
    if engine.disabled {
        return engine.snapshot(app);
    }
    crate::patch::wait_settled(app, PATCH_WAIT).await;
    let m = manifest::manifest().ok();
    for role in Role::ALL {
        let loc = weights::locate(app, role).ok().flatten();
        let patch_here = role != Role::Category || crate::patch::pigeon_source(app, "patch-router").is_some();
        engine.with_slot(role, |s| match &loc {
            None => {
                s.set(Phase::Missing, "no weights on this machine yet");
                s.model = m.and_then(|m| m.for_role(role)).map(|spec| spec.file.clone());
                s.source = None;
            }
            Some(_) if !patch_here => s.set(Phase::Error, "Patch's Pigeons are not here — his nest did not come with this build"),
            Some(l) => {
                s.set(Phase::Ready, "ready — in this app, loaded when first asked");
                s.model = l.path.file_name().map(|n| n.to_string_lossy().into_owned());
                s.source = Some(l.source);
            }
        });
    }
    engine.touch();
    engine.emit(app);
    engine.snapshot(app)
}

/// Peek: his Pigeon is in Patch's nest and sees through Qwen3-VL 2B's
/// projector, which must be in the store. Returns the base file's name.
pub(crate) fn peek_model<R: tauri::Runtime>(app: &AppHandle<R>) -> Option<String> {
    crate::patch::pigeon_source(app, "peek")?;
    let base = manifest::manifest().ok()?.for_role(Role::Category)?.file.clone();
    weights::own_dir(app).ok().map(|d| d.join(&base)).filter(|p| p.is_file())?;
    let projectors = weights::own_dir(app).ok()?.join("projectors");
    let named = |e: &std::fs::DirEntry| e.file_name().to_string_lossy().starts_with("mmproj-Qwen3VL-2B");
    std::fs::read_dir(projectors).ok()?.filter_map(|e| e.ok()).any(|e| named(&e)).then_some(base)
}

#[tauri::command]
pub async fn engine_status<R: tauri::Runtime>(app: AppHandle<R>) -> Result<EngineStatus, String> {
    let engine: State<Engine> = app.state();
    Ok(engine.snapshot(&app))
}

#[tauri::command]
pub async fn engine_wake<R: tauri::Runtime>(app: AppHandle<R>) -> Result<EngineStatus, String> {
    Ok(wake(&app).await)
}

/// The page saw typing: Patch's base, his three Pigeons and a lane are made
/// ready now, so the turn that follows does not pay for them. Takes nothing,
/// asks nothing, returns nothing; cheap when everything is loaded already.
#[tauri::command]
pub async fn engine_warm<R: tauri::Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let engine: State<Engine> = app.state();
    if engine.disabled {
        return Ok(());
    }
    engine.touch();
    tauri::async_runtime::spawn_blocking(move || crate::inprocess::warm_patch(&app)).await.map_err(|e| e.to_string())?
}

/// Settings › Models: unload a base after this many seconds unused. Only the
/// four periods the page offers are accepted, so a page cannot ask for a
/// model to be held for a day. Five minutes joined the list once warming on
/// the first keystroke hid the reload; the default stays ten.
#[tauri::command]
pub async fn engine_set_idle_unload<R: tauri::Runtime>(app: AppHandle<R>, secs: u64) -> Result<EngineStatus, String> {
    if ![0, 300, 600, 3600].contains(&secs) {
        return Err(format!("{secs} s is not one of the sleep periods Pigeon offers"));
    }
    let engine: State<Engine> = app.state();
    engine.set_idle_period(secs);
    /* The engine takes its period when it is made: the next one made, on
       the next ask, takes the new one. */
    app.state::<crate::inprocess::InProcess>().sleep();
    Ok(engine.snapshot(&app))
}

#[tauri::command]
pub async fn engine_sleep<R: tauri::Runtime>(app: AppHandle<R>) -> Result<EngineStatus, String> {
    let engine: State<Engine> = app.state();
    engine.sleep_all(Some(&app));
    Ok(engine.snapshot(&app))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_person_can_set_the_idle_period_and_zero_means_never() {
        let e = Engine::new();
        e.set_idle_period(0);
        assert_eq!(e.idle_period(), None);
        e.set_idle_period(3600);
        assert_eq!(e.idle_period(), Some(Duration::from_secs(3600)));
    }

    #[test]
    fn the_idle_period_is_ten_minutes_unless_the_environment_says_otherwise() {
        std::env::remove_var(IDLE_ENV);
        assert_eq!(Engine::new().idle_period(), Some(Duration::from_secs(600)));
    }

    #[test]
    fn a_role_starts_asleep_and_says_nothing_about_a_process() {
        let s = Slot::new().status(Some(100));
        assert_eq!((s.phase, s.pid, s.port, s.resident_mb), (Phase::Asleep, None, 0, None));
    }
}
