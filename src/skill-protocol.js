/* skill-protocol.js — the messages between the app and a skill worker.
 *
 * Patch's skills will run inside a locked Web Worker loaded from a sealed pack.
 * The app side keeps a registry it can route and plan with, but whose `run`
 * posts a message instead of doing the sums. Everything here is the pure part
 * of that: what may cross the boundary, the envelopes, the code-base check, and
 * a tracker for calls that are waiting on a reply.
 *
 * Pure: no DOM, no Worker is created here, no node: imports. The wiring is a
 * later phase.
 */

/** Deep copy with every function-valued property removed (structuredClone-safe). */
function withoutFunctions (value) {
  if (typeof value === 'function') return undefined;
  if (Array.isArray(value)) return value.map(v => (typeof v === 'function' ? undefined : withoutFunctions(v)));
  if (value === null || typeof value !== 'object') return value;
  /* Only plain objects are walked; a Date, RegExp, Map or typed array is data
     structuredClone already knows how to copy. */
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return value;
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (typeof v === 'function') continue;
    out[k] = withoutFunctions(v);
  }
  return out;
}

/**
 * A skill entry as data: `run`, `verify`, and any function nested anywhere
 * (e.g. `examples[].ctx.search`) removed; everything else identical.
 */
export function stripForWorker (entry) {
  return withoutFunctions(entry);
}

/** A ctx that can be posted: no `search`, and no other function-valued field. */
export function ctxForWorker (ctx) {
  if (!ctx || typeof ctx !== 'object') return ctx;
  const out = {};
  for (const [k, v] of Object.entries(ctx)) {
    if (k === 'search' || typeof v === 'function') continue;
    out[k] = v;
  }
  return out;
}

/**
 * Entry data (from stripForWorker) made runnable again through `call`, which
 * sends `{ name, input, ctx }` to wherever the real skill lives and resolves to
 * its envelope.
 *
 * A `nondeterministic` entry also gets a `verify`, because the registry lint
 * requires one. It is a placeholder that always accepts: the real verify runs
 * only in the test suite, against the real entry, never through a proxy.
 */
export function proxyEntry (data, call) {
  const entry = { ...data };
  if (data.unbuilt) return entry;
  const name = data.name;
  entry.run = async (input, ctx) => call({ name, input, ctx: ctxForWorker(ctx) });
  if (data.nondeterministic) entry.verify = () => true;
  return entry;
}

/* ── envelopes ─────────────────────────────────────────────────────────── */

export const runRequest = (id, name, input, ctx) => ({ type: 'run', id, name, input, ctx });
export const runReply = (id, result) => ({ type: 'result', id, result });
export const errorReply = (id, message) => ({ type: 'error', id, message: String(message) });

const CODE_BASE = /^pigeon-pack:\/\/localhost\/v\d+-[0-9a-f]{8}\/code\/$/;
/* The dev checkout as the worker is told it: the page's own root, absolute,
   because a Blob worker has no URL of its own to resolve '/' against.
   skill-worker.js carries a copy of both patterns. */
const DEV_ROOT = /^(?:https?|tauri):\/\/(?:localhost|127\.0\.0\.1)(?::\d{1,5})?\/$/;

/** The only code bases a skill worker may be told to load from. */
/** A sealed pack's code base only — what the app accepts under Tauri. */
export function isPackCodeBase (s) {
  return typeof s === 'string' && CODE_BASE.test(s);
}

export function isValidCodeBase (s) {
  return typeof s === 'string' && (s === '/' || CODE_BASE.test(s) || DEV_ROOT.test(s));
}

/** '/' (the app's shorthand for the dev checkout) as the absolute root the worker is sent. */
export function absoluteCodeBase (codeBase, pageHref) {
  if (codeBase !== '/' || typeof pageHref !== 'string') return codeBase;
  try { return new URL('/', pageHref).href; } catch { return codeBase; }
}

/* ── pending calls ─────────────────────────────────────────────────────── */

/**
 * Tracks calls waiting on a reply. `post(msg)` sends a request (msg gains an
 * `id`); `receive(reply)` settles the matching call — a `result` resolves with
 * `reply.result`, an `error` rejects; a reply for an unknown or already-settled
 * id is ignored. A call with no reply after `timeoutMs` rejects and
 * `onTimeout(id, msg)` is told. Timers are injectable for tests.
 */
export function createCaller ({ post, timeoutMs = 5000, onTimeout = () => {},
                                setTimer = (fn, ms) => setTimeout(fn, ms),
                                clearTimer = (t) => clearTimeout(t) } = {}) {
  const pending = new Map();
  let next = 1;

  const settle = (id) => {
    const p = pending.get(id);
    if (!p) return null;
    pending.delete(id);
    clearTimer(p.timer);
    return p;
  };

  return {
    call (msg) {
      const id = next++;
      const sent = { ...msg, id };
      return new Promise((resolve, reject) => {
        const timer = setTimer(() => {
          if (!pending.has(id)) return;
          pending.delete(id);
          reject(new Error(`skill call ${id} timed out after ${timeoutMs} ms`));
          onTimeout(id, sent);
        }, timeoutMs);
        pending.set(id, { resolve, reject, timer });
        try { post(sent); } catch (e) { settle(id); reject(e); }
      });
    },
    receive (reply) {
      if (!reply || typeof reply !== 'object') return false;
      const p = settle(reply.id);
      if (!p) return false;
      if (reply.type === 'error') p.reject(new Error(reply.message));
      else p.resolve(reply.result);
      return true;
    },
    rejectAll (reason) {
      const err = reason instanceof Error ? reason : new Error(String(reason));
      for (const id of [...pending.keys()]) settle(id).reject(err);
    },
    get size () { return pending.size; }
  };
}
