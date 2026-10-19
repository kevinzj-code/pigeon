//! The safe half of the boundary: what each C function does once its
//! arguments are Rust values. Nothing here touches a pointer; `boundary.rs`
//! turns pointers into these arguments and these results back into C.

use std::cell::Cell;
use std::panic::{catch_unwind, AssertUnwindSafe};

use ::pigeon_engine::{Engine, Sink};
use serde_json::{json, Value};

thread_local! {
    /// Set while a host's callback runs on this thread (E24).
    static IN_CALLBACK: Cell<bool> = const { Cell::new(false) };
}

/// Runs a host callback with the E24 mark set, so `pigeon_engine_free`
/// called from inside it can refuse instead of waiting on itself.
pub fn as_callback(f: impl FnOnce()) {
    IN_CALLBACK.with(|c| c.set(true));
    struct Unmark;
    impl Drop for Unmark {
        fn drop(&mut self) {
            IN_CALLBACK.with(|c| c.set(false));
        }
    }
    let _unmark = Unmark;
    f();
}

/// E24: true while this thread is inside a host callback.
pub fn in_callback() -> bool {
    IN_CALLBACK.with(Cell::get)
}

/// `{ code, message }`, the shape `pigeon_engine_new`'s error has.
pub fn error_json(code: &str, message: &str) -> String {
    json!({ "code": code, "message": message }).to_string()
}

/// A request read from the host, or why it could not be.
pub fn request(text: Result<&str, &'static str>) -> Result<Value, String> {
    let text = text.map_err(String::from)?;
    serde_json::from_str::<Value>(text).map_err(|e| format!("the request is not JSON — {e}"))
}

/// E23: runs `f`, turning a panic into `Err` with the panic's message.
pub fn guarded<T>(f: impl FnOnce() -> T) -> Result<T, String> {
    catch_unwind(AssertUnwindSafe(f)).map_err(|p| {
        let what = p.downcast_ref::<&str>().map(|s| s.to_string()).or_else(|| p.downcast_ref::<String>().cloned()).unwrap_or_else(|| "a panic".into());
        format!("the engine failed inside (a bug in the engine): {what}")
    })
}

/// `pigeon_check`: the report or refusal; a request that cannot be read is
/// answered in the engine's own error shape for a check.
pub fn check(engine: &Engine, req: Result<&str, &'static str>) -> String {
    match request(req) {
        Ok(r) => engine.check(&r).to_string(),
        Err(m) => json!({ "result": "error", "code": "bad_request", "message": m }).to_string(),
    }
}

/// The three calls that start a request, by name.
#[derive(Clone, Copy)]
pub enum Start {
    Load,
    Ask,
    Fetch,
}

/// `pigeon_load`, `pigeon_ask` and `pigeon_fetch`: a request that cannot be
/// read still gets a number, and ends at once with `bad_request`.
pub fn start(engine: &Engine, what: Start, req: Result<&str, &'static str>, attachments: Vec<Vec<u8>>, sink: Sink) -> u64 {
    match request(req) {
        Ok(r) => match what {
            Start::Load => engine.load(&r, sink),
            Start::Ask => engine.ask(&r, attachments, sink),
            Start::Fetch => engine.fetch(&r, sink),
        },
        Err(m) => engine.fail("bad_request", &m, sink),
    }
}

/// The one event of a call that failed before it had a number (E23): a null
/// engine (`bad_request`) or a panic at the boundary (`internal`).
pub fn request_zero_error(code: &str, message: &str) -> Value {
    json!({ "request": 0, "type": "error", "code": code, "message": message })
}
