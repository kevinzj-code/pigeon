"""pigeon.py: libpigeon from Python, with ctypes and nothing else.

    from pigeon import Engine
    with Engine({"base_dirs": ["/…/models"], "projector_dirs": ["/…/models/projectors"]}) as e:
        print(e.check("pen.pigeon")["result"])
        pen = e.load("pen.pigeon")["pigeon"]
        print(e.ask(pen, "Say hello.")["answer"]["value"])
        for ev in e.ask_events(pen, "Say it again.", options={"stream": True}):
            print(ev["type"], ev.get("text", ""))
        print(e.ride("pen.pigeon", [{"question": "Say hello."}]))

The library is found at $PIGEON_LIB, or next to this checkout's build
(target/ffi, target/release, target/debug). Every call is INTERFACE.md's,
with its JSON as Python dicts. Errors and refusals raise PigeonError.
"""

import ctypes
import itertools
import json
import os
import threading
import time
from collections import deque

__all__ = ["Engine", "PigeonError", "version"]


class PigeonError(Exception):
    """A refusal or an error, as the engine sent it (`event`)."""

    def __init__(self, event):
        self.event = event
        self.code = event.get("code")
        super().__init__(f"{self.code}: {event.get('message', '')}")


class _Bytes(ctypes.Structure):
    _fields_ = [("data", ctypes.c_void_p), ("len", ctypes.c_size_t)]


_EVENT_FN = ctypes.CFUNCTYPE(None, ctypes.c_void_p, ctypes.c_char_p)
_FINAL = {"loaded", "refused", "answer", "fetched", "error"}


def _find_lib():
    if os.environ.get("PIGEON_LIB"):
        return os.environ["PIGEON_LIB"]
    target = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "target")
    for profile in ("ffi", "release", "debug"):
        p = os.path.join(target, profile, "libpigeon.dylib")
        if os.path.exists(p):
            return p
    raise OSError("libpigeon.dylib not found: build it (cargo build -p pigeon-ffi --profile ffi) or set PIGEON_LIB")


_lib = None


def _load_lib():
    global _lib
    if _lib is None:
        lib = ctypes.CDLL(_find_lib())
        vp, cp, u64 = ctypes.c_void_p, ctypes.c_char_p, ctypes.c_uint64
        lib.pigeon_version.restype = cp
        lib.pigeon_version.argtypes = []
        lib.pigeon_engine_new.restype = vp
        lib.pigeon_engine_new.argtypes = [cp, ctypes.POINTER(vp)]
        lib.pigeon_engine_free.argtypes = [vp]
        lib.pigeon_check.restype = vp
        lib.pigeon_check.argtypes = [vp, cp]
        lib.pigeon_load.restype = u64
        lib.pigeon_load.argtypes = [vp, cp, _EVENT_FN, vp]
        lib.pigeon_unload.argtypes = [vp, u64]
        lib.pigeon_ask.restype = u64
        lib.pigeon_ask.argtypes = [vp, cp, ctypes.POINTER(_Bytes), ctypes.c_size_t, _EVENT_FN, vp]
        lib.pigeon_cancel.argtypes = [vp, u64]
        lib.pigeon_fetch.restype = u64
        lib.pigeon_fetch.argtypes = [vp, cp, _EVENT_FN, vp]
        lib.pigeon_info.restype = vp
        lib.pigeon_info.argtypes = [vp]
        lib.pigeon_poll.restype = vp
        lib.pigeon_poll.argtypes = [vp]
        lib.pigeon_string_free.argtypes = [vp]
        _lib = lib
    return _lib


def _take(ptr):
    """A string the engine returned, as a dict; the engine's copy is freed."""
    if not ptr:
        return None
    try:
        return json.loads(ctypes.string_at(ptr).decode("utf-8"))
    finally:
        _lib.pigeon_string_free(ptr)


def version():
    return _load_lib().pigeon_version().decode("utf-8")


class Engine:
    """One engine (one handle). Safe to use from several threads."""

    def __init__(self, config):
        lib = _load_lib()
        err = ctypes.c_void_p()
        handle = lib.pigeon_engine_new(json.dumps(config).encode("utf-8"), ctypes.byref(err))
        if not handle:
            raise PigeonError(_take(err.value) or {"code": "internal", "message": "no engine and no error"})
        self._h = handle
        self._lock = threading.Lock()
        # Callback mode: one C callback for every request; `user` is a key
        # into this table, which keeps each Python handler alive until its
        # request's final event.
        self._handlers = {}
        self._keys = itertools.count(1)
        self._cb = _EVENT_FN(self._on_event)
        # Poll mode: pigeon_poll is one queue for the whole engine, so events
        # for other requests are set aside by request number.
        self._polled = {}

    # ── lifetime ──────────────────────────────────────────────────────────
    def close(self):
        """Frees every model; waits until they are gone (E24)."""
        if self._h:
            _lib.pigeon_engine_free(self._h)
            self._h = None

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()

    # ── events ────────────────────────────────────────────────────────────
    def _on_event(self, user, text):
        ev = json.loads(text.decode("utf-8"))
        with self._lock:
            handler = self._handlers.get(user)
            if handler and ev.get("type") in _FINAL:
                del self._handlers[user]
        if handler:
            handler(ev)

    def _start(self, fn, *args, on=None):
        """Start a request in callback mode; returns (request, box, done)."""
        done = threading.Event()
        box = {"final": None, "on": on}

        def handler(ev):
            if box["on"]:
                box["on"](ev)
            if ev.get("type") in _FINAL:
                box["final"] = ev
                done.set()

        key = next(self._keys)
        with self._lock:
            self._handlers[key] = handler
        request = fn(self._h, *args, self._cb, ctypes.c_void_p(key))
        return request, box, done

    def _poll_until(self, request):
        while True:
            q = self._polled.setdefault(request, deque())
            if q:
                ev = q.popleft()
                if ev.get("type") in _FINAL:
                    self._polled.pop(request, None)
                yield ev
                if ev.get("type") in _FINAL:
                    return
                continue
            ev = _take(_lib.pigeon_poll(self._h))
            if ev is None:
                time.sleep(0.005)
                continue
            self._polled.setdefault(ev.get("request"), deque()).append(ev)

    # ── the interface ─────────────────────────────────────────────────────
    def check(self, path, member=None):
        req = {"path": str(path)}
        if member:
            req["member"] = member
        return _take(_lib.pigeon_check(self._h, json.dumps(req).encode("utf-8")))

    def load(self, path, member=None):
        """Loads and proves the Pigeon's prompt_check; returns the `loaded` event."""
        req = {"path": str(path)}
        if member:
            req["member"] = member
        _, box, done = self._start(_lib.pigeon_load, json.dumps(req).encode("utf-8"))
        done.wait()
        ev = box["final"]
        if ev.get("type") != "loaded":
            raise PigeonError(ev)
        return ev

    def unload(self, pigeon):
        _lib.pigeon_unload(self._h, pigeon)

    def _ask_args(self, pigeon, input, picture, history, values, sections, options):
        req = {"pigeon": pigeon, "input": input}
        att, keep = None, None
        if picture is not None:
            keep = ctypes.create_string_buffer(bytes(picture), len(picture))
            att = (_Bytes * 1)(_Bytes(ctypes.cast(keep, ctypes.c_void_p), len(picture)))
            req["picture"] = {"attachment": 0}
        for k, v in (("history", history), ("values", values), ("sections", sections), ("options", options)):
            if v is not None:
                req[k] = v
        return json.dumps(req).encode("utf-8"), att, (1 if att is not None else 0), keep

    def ask(self, pigeon, input, picture=None, history=None, values=None, sections=None, options=None, on_event=None):
        """Asks and waits; returns the `answer` event. `on_event` sees every
        event (pieces too) on the engine's thread. Raises on an error."""
        text, att, n, keep = self._ask_args(pigeon, input, picture, history, values, sections, options)
        request, box, done = self._start(_lib.pigeon_ask, text, att, n, on=on_event)
        del keep  # the engine copied the picture before pigeon_ask returned (§2)
        done.wait()
        if box["final"].get("type") != "answer":
            raise PigeonError(box["final"])
        return box["final"]

    def ask_events(self, pigeon, input, picture=None, history=None, values=None, sections=None, options=None):
        """Asks with no callback and yields its events, drained with pigeon_poll."""
        text, att, n, keep = self._ask_args(pigeon, input, picture, history, values, sections, options)
        request = _lib.pigeon_ask(self._h, text, att, n, _EVENT_FN(), None)
        del keep
        yield from self._poll_until(request)

    def start_ask(self, pigeon, input, **kw):
        """Asks without waiting; returns the request number, for cancel()."""
        text, att, n, keep = self._ask_args(pigeon, input, kw.get("picture"), kw.get("history"), kw.get("values"), kw.get("sections"), kw.get("options"))
        request = _lib.pigeon_ask(self._h, text, att, n, _EVENT_FN(), None)
        del keep
        return request

    def events(self, request):
        """The events of a request started with start_ask."""
        yield from self._poll_until(request)

    def cancel(self, request):
        _lib.pigeon_cancel(self._h, request)

    def info(self):
        return _take(_lib.pigeon_info(self._h))

    # ── Flight School's shape: a Pigeon and rows in, answers with timings out ──
    def ride(self, path, rows, member=None):
        """Loads `path` and asks each row (`question`, and `image` bytes or a
        path, `history`, `values`, `sections`, `max_tokens`, `temperature`
        when given), one after another. Returns one dict per row: the row's
        question, the answer event (or the error), and the wall time in ms."""
        pigeon = self.load(path, member)["pigeon"]
        out = []
        try:
            for row in rows:
                picture = row.get("image")
                if isinstance(picture, str):
                    with open(picture, "rb") as f:
                        picture = f.read()
                options = {k: row[k] for k in ("max_tokens", "temperature") if row.get(k) is not None} or None
                t = time.monotonic()
                try:
                    ev = self.ask(pigeon, row.get("question", ""), picture=picture, history=row.get("history"),
                                  values=row.get("values"), sections=row.get("sections"), options=options)
                except PigeonError as e:
                    ev = e.event
                out.append({"question": row.get("question"), "event": ev, "ms": round((time.monotonic() - t) * 1000)})
        finally:
            self.unload(pigeon)
        return out
