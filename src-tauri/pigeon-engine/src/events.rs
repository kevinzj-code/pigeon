//! Where a request's events go (E1): to a callback, on an engine thread and
//! in order, or into a queue the host drains with `poll`.
//!
//! Every request ends with exactly one final event (§3). The way out holds
//! that promise itself (E23): when its last copy goes without a final event
//! having been sent — a panic unwound the thread that held it, or the engine
//! stopped with the request still waiting — it sends one `error` as it goes.

use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use serde_json::{json, Value};

pub type Callback = Arc<dyn Fn(&Value) + Send + Sync>;

#[derive(Clone)]
pub enum Sink {
    Callback(Callback),
    Poll,
}

#[derive(Default)]
pub struct Queue {
    events: Mutex<VecDeque<Value>>,
}

impl Queue {
    pub fn pop(&self) -> Option<Value> {
        lock(&self.events).pop_front()
    }

    pub fn push(&self, event: Value) {
        lock(&self.events).push_back(event);
    }
}

/// A queue whose lock a panic poisoned still delivers: the event that says
/// so must get out.
fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|p| p.into_inner())
}

/// The types that end a request (§3).
const FINAL: [&str; 5] = ["loaded", "refused", "answer", "fetched", "error"];

struct Way {
    request: u64,
    sink: Sink,
    queue: Arc<Queue>,
    finished: AtomicBool,
}

impl Way {
    fn deliver(&self, mut event: Value) {
        event["request"] = self.request.into();
        if event["type"].as_str().is_some_and(|t| FINAL.contains(&t)) && self.finished.swap(true, Ordering::SeqCst) {
            return; // one final event, never two
        }
        match &self.sink {
            Sink::Callback(f) => f(&event),
            Sink::Poll => lock(&self.queue.events).push_back(event),
        }
    }
}

impl Drop for Way {
    fn drop(&mut self) {
        if self.finished.load(Ordering::SeqCst) {
            return;
        }
        let (code, message) = if std::thread::panicking() {
            ("internal", "the engine failed inside while answering this request (a bug in the engine; the request is over)")
        } else {
            ("model_failed", "the engine stopped before this request finished")
        };
        self.deliver(json!({ "type": "error", "code": code, "message": message }));
    }
}

/// One request's way out. Clones share it; the last to go sends the final
/// event if nobody did.
#[derive(Clone)]
pub struct Out {
    way: Arc<Way>,
}

impl Out {
    pub fn new(request: u64, sink: Sink, queue: Arc<Queue>) -> Out {
        Out { way: Arc::new(Way { request, sink, queue, finished: AtomicBool::new(false) }) }
    }

    pub fn send(&self, event: Value) {
        self.way.deliver(event);
    }

    /// An engine error (INTERFACE.md §4): the caller's fault or the engine's.
    pub fn error(&self, code: &str, message: impl Into<String>) {
        self.send(json!({ "type": "error", "code": code, "message": message.into() }));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn collect() -> (Sink, Arc<Mutex<Vec<Value>>>) {
        let got = Arc::new(Mutex::new(Vec::new()));
        let g = got.clone();
        (Sink::Callback(Arc::new(move |e: &Value| g.lock().unwrap().push(e.clone()))), got)
    }

    #[test]
    fn a_request_that_finishes_sends_exactly_its_own_final_event() {
        let (sink, got) = collect();
        let out = Out::new(4, sink, Arc::default());
        out.send(json!({ "type": "piece", "text": "a" }));
        out.clone().send(json!({ "type": "answer" }));
        out.error("model_failed", "a second final event is not sent");
        drop(out);
        let got = got.lock().unwrap();
        assert_eq!(got.iter().map(|e| e["type"].as_str().unwrap()).collect::<Vec<_>>(), ["piece", "answer"]);
        assert!(got.iter().all(|e| e["request"] == 4));
    }

    /// E23: a panic unwinding the thread that held the request still ends it.
    #[test]
    fn a_panic_ends_the_request_with_an_internal_error() {
        let (sink, got) = collect();
        let out = Out::new(9, sink, Arc::default());
        let held = out.clone();
        drop(out);
        let _ = std::thread::spawn(move || {
            held.send(json!({ "type": "piece", "text": "x" }));
            panic!("planted");
        })
        .join();
        let got = got.lock().unwrap();
        assert_eq!(got.len(), 2, "{got:?}");
        assert_eq!((got[1]["type"].as_str(), got[1]["code"].as_str(), got[1]["request"].as_u64()), (Some("error"), Some("internal"), Some(9)));
    }

    /// A request dropped without a panic (the engine stopping) ends too, and
    /// a polled one lands in the queue.
    #[test]
    fn a_request_the_engine_drops_ends_with_model_failed_in_the_queue() {
        let queue = Arc::new(Queue::default());
        drop(Out::new(2, Sink::Poll, queue.clone()));
        let e = queue.pop().expect("a final event");
        assert_eq!((e["type"].as_str(), e["code"].as_str(), e["request"].as_u64()), (Some("error"), Some("model_failed"), Some(2)));
        assert!(queue.pop().is_none());
    }
}
