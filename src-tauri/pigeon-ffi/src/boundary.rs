//! The twelve C functions of INTERFACE.md §2: the only unsafe code in this
//! crate. Each turns its pointers into Rust values, hands them to `glue.rs`
//! inside a panic guard (E23), and turns the result back into C.
//!
//! Every declaration here must match `include/pigeon.h` token for token
//! (tests/header.rs reads both).

#![allow(non_camel_case_types)]

use std::ffi::{c_char, c_void, CStr, CString};
use std::sync::{Arc, OnceLock};

use ::pigeon_engine as eng;
use eng::{Engine, Sink};
use serde_json::Value;

use crate::glue::{self, Start};

/// The handle a host holds: the engine, boxed. Opaque in the header.
pub struct pigeon_engine {
    engine: Engine,
}

pub type pigeon_event_fn = Option<unsafe extern "C" fn(user: *mut c_void, event_json: *const c_char)>;

#[repr(C)]
pub struct pigeon_bytes {
    pub data: *const u8,
    pub len: usize,
}

/// A host's callback and its `user` pointer. The host promises (§2: "all
/// functions may be called from any thread") that it may be called on an
/// engine thread.
#[derive(Clone, Copy)]
struct HostCallback {
    f: unsafe extern "C" fn(*mut c_void, *const c_char),
    user: *mut c_void,
}
unsafe impl Send for HostCallback {}
unsafe impl Sync for HostCallback {}

impl HostCallback {
    /// One event, as a string valid only during the call (§2).
    fn call(&self, event: &Value) {
        let Ok(text) = CString::new(event.to_string()) else { return }; // JSON escapes NUL, so never
        let me = *self;
        glue::as_callback(|| unsafe { (me.f)(me.user, text.as_ptr()) });
    }
}

/// Where a request's events go: the host's callback, or the poll queue (E1).
fn sink(on_event: pigeon_event_fn, user: *mut c_void) -> Sink {
    match on_event {
        Some(f) => {
            let cb = HostCallback { f, user };
            Sink::Callback(Arc::new(move |e: &Value| cb.call(e)))
        }
        None => Sink::Poll,
    }
}

/// A C string as UTF-8, or why not.
unsafe fn text<'a>(s: *const c_char) -> Result<&'a str, &'static str> {
    if s.is_null() {
        return Err("the request is NULL");
    }
    CStr::from_ptr(s).to_str().map_err(|_| "the request is not UTF-8")
}

/// A string for the host to free with `pigeon_string_free`.
fn give(s: String) -> *mut c_char {
    CString::new(s).unwrap_or_else(|_| CString::new("{\"code\":\"internal\",\"message\":\"a string held a NUL\"}").unwrap()).into_raw()
}

unsafe fn engine_ref<'a>(e: *mut pigeon_engine) -> Option<&'a Engine> {
    e.as_ref().map(|h| &h.engine)
}

/// A call that failed before it had a request number (E23): 0, and its one
/// event to the callback or, when there is an engine, the poll queue.
unsafe fn request_zero(e: *mut pigeon_engine, on_event: pigeon_event_fn, user: *mut c_void, code: &str, message: &str) -> u64 {
    let event = glue::request_zero_error(code, message);
    let _ = glue::guarded(|| match on_event {
        Some(f) => HostCallback { f, user }.call(&event),
        None => {
            if let Some(engine) = engine_ref(e) {
                engine.post(event);
            }
        }
    });
    0
}

#[no_mangle]
pub extern "C" fn pigeon_version() -> *const c_char {
    static V: OnceLock<CString> = OnceLock::new();
    V.get_or_init(|| CString::new(eng::version()).unwrap()).as_ptr()
}

#[no_mangle]
pub unsafe extern "C" fn pigeon_engine_new(config_json: *const c_char, error_json: *mut *mut c_char) -> *mut pigeon_engine {
    if !error_json.is_null() {
        *error_json = std::ptr::null_mut();
    }
    let tell = |s: String| {
        if !error_json.is_null() {
            *error_json = give(s);
        }
    };
    let config = match text(config_json) {
        Ok(c) => c,
        Err(m) => {
            tell(glue::error_json("bad_request", &m.replace("request", "config")));
            return std::ptr::null_mut();
        }
    };
    match glue::guarded(|| Engine::new(config)) {
        Ok(Ok(engine)) => Box::into_raw(Box::new(pigeon_engine { engine })),
        Ok(Err(e)) => {
            tell(e.to_string());
            std::ptr::null_mut()
        }
        Err(m) => {
            tell(glue::error_json("internal", &m));
            std::ptr::null_mut()
        }
    }
}

/// E24: waits until every model is freed. From inside a callback it returns
/// at once and frees nothing, since the wait would be on its own thread.
#[no_mangle]
pub unsafe extern "C" fn pigeon_engine_free(e: *mut pigeon_engine) {
    if e.is_null() || glue::in_callback() {
        return;
    }
    let boxed = Box::from_raw(e);
    let _ = glue::guarded(move || drop(boxed));
}

#[no_mangle]
pub unsafe extern "C" fn pigeon_check(e: *mut pigeon_engine, request_json: *const c_char) -> *mut c_char {
    let Some(engine) = engine_ref(e) else { return give(glue::error_json("bad_request", "the engine is NULL")) };
    let req = text(request_json);
    give(glue::guarded(|| glue::check(engine, req)).unwrap_or_else(|m| serde_json::json!({ "result": "error", "code": "internal", "message": m }).to_string()))
}

unsafe fn start(e: *mut pigeon_engine, what: Start, request_json: *const c_char, attachments: Vec<Vec<u8>>, on_event: pigeon_event_fn, user: *mut c_void) -> u64 {
    let Some(engine) = engine_ref(e) else { return request_zero(e, on_event, user, "bad_request", "the engine is NULL") };
    let req = text(request_json);
    let s = sink(on_event, user);
    match glue::guarded(|| glue::start(engine, what, req, attachments, s)) {
        Ok(n) => n,
        Err(m) => request_zero(e, on_event, user, "internal", &m),
    }
}

#[no_mangle]
pub unsafe extern "C" fn pigeon_load(e: *mut pigeon_engine, request_json: *const c_char, on_event: pigeon_event_fn, user: *mut c_void) -> u64 {
    start(e, Start::Load, request_json, Vec::new(), on_event, user)
}

#[no_mangle]
pub unsafe extern "C" fn pigeon_unload(e: *mut pigeon_engine, pigeon: u64) {
    if let Some(engine) = engine_ref(e) {
        let _ = glue::guarded(|| engine.unload(pigeon));
    }
}

/// The attachments are copied before this returns (§2).
#[no_mangle]
pub unsafe extern "C" fn pigeon_ask(
    e: *mut pigeon_engine,
    request_json: *const c_char,
    attachments: *const pigeon_bytes,
    n_attachments: usize,
    on_event: pigeon_event_fn,
    user: *mut c_void,
) -> u64 {
    let mut copied = Vec::with_capacity(n_attachments);
    if n_attachments > 0 {
        if attachments.is_null() {
            return match engine_ref(e) {
                Some(engine) => engine.fail("bad_request", "n_attachments is not 0 but attachments is NULL", sink(on_event, user)),
                None => request_zero(e, on_event, user, "bad_request", "the engine is NULL"),
            };
        }
        for b in std::slice::from_raw_parts(attachments, n_attachments) {
            copied.push(if b.data.is_null() || b.len == 0 { Vec::new() } else { std::slice::from_raw_parts(b.data, b.len).to_vec() });
        }
    }
    start(e, Start::Ask, request_json, copied, on_event, user)
}

#[no_mangle]
pub unsafe extern "C" fn pigeon_cancel(e: *mut pigeon_engine, request: u64) {
    if let Some(engine) = engine_ref(e) {
        let _ = glue::guarded(|| engine.cancel(request));
    }
}

#[no_mangle]
pub unsafe extern "C" fn pigeon_fetch(e: *mut pigeon_engine, request_json: *const c_char, on_event: pigeon_event_fn, user: *mut c_void) -> u64 {
    start(e, Start::Fetch, request_json, Vec::new(), on_event, user)
}

#[no_mangle]
pub unsafe extern "C" fn pigeon_info(e: *mut pigeon_engine) -> *mut c_char {
    let Some(engine) = engine_ref(e) else { return give(glue::error_json("bad_request", "the engine is NULL")) };
    give(glue::guarded(|| engine.info().to_string()).unwrap_or_else(|m| glue::error_json("internal", &m)))
}

/// The next event of a request made without a callback, or NULL.
#[no_mangle]
pub unsafe extern "C" fn pigeon_poll(e: *mut pigeon_engine) -> *mut c_char {
    let Some(engine) = engine_ref(e) else { return std::ptr::null_mut() };
    match glue::guarded(|| engine.poll()) {
        Ok(Some(ev)) => give(ev.to_string()),
        _ => std::ptr::null_mut(),
    }
}

#[no_mangle]
pub unsafe extern "C" fn pigeon_string_free(s: *mut c_char) {
    if !s.is_null() {
        drop(CString::from_raw(s));
    }
}
