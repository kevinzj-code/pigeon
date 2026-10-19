/* skill-worker.js — Patch's skills, in a locked room.
 *
 * A module Web Worker that loads a skill pack's code and runs its skills when
 * the app asks. It is handed one code base, once; it can reach nothing else.
 * The app keeps a proxy registry (skill-protocol.js proxyEntry) whose `run`
 * posts here, and patch-pack.js is the main-thread half of the conversation.
 *
 * HOW IT IS STARTED MATTERS. patch-pack.js fetches this file's text and starts
 * it from a Blob URL. Measured in the embedded WKWebView: a same-origin URL
 * worker gets NO CSP of its own, so code inside it could still import from
 * http:, eval and fetch whatever the lock below misses; a Blob worker inherits
 * the page's CSP, which forbids all three while `import('pigeon-pack://…')` and
 * the pack's relative imports still load. The CSP is the wall. The JS lock
 * below is defence in depth.
 *
 * In the browser build (`npm run serve`) the dev server sends no CSP, so there
 * the dev checkout is NOT locked in by anything but this file. That is
 * expected: it is a developer's own checkout, not a pack.
 *
 * Because it runs from a Blob, this file resolves nothing against its own URL
 * (which is `blob:…`): it has no static imports, no `import.meta.url`, and does
 * not read `self.location`. What it needs from skill-protocol.js is copied
 * below, and the dev checkout's root arrives from the page as an absolute URL.
 * It never evaluates a string: the only import() is the validated code base's
 * own skills/index.js — the one computed import the lint (src/lint-imports.js)
 * allows anywhere under src/.
 */

/* ── 1. the lock, before anything else runs ──────────────────────────────
   Every way out of the worker we know of is replaced with a stub that throws
   (or with undefined, for the two that are objects rather than functions) and
   pinned non-writable and non-configurable on the global. Where a prototype of
   the global also carries it — Safari's WorkerGlobalScope.prototype.fetch, for
   one — it is deleted there, or pinned if it cannot be deleted. Then the global
   is frozen, so nothing a skill does can put any of it back or add a global.

   What this does NOT cover, recorded so nobody assumes it does:
   - Prototypes of `self` are not frozen (freezing EventTarget.prototype and
     friends is not needed for the lock and has broken host internals). Only
     the named properties on them are removed or pinned.
   - `self.location` and `self.navigator` are read-only accessors on the
     prototype and are left alone; they carry no way out.
   - The Function constructor is still reachable as `(() => {}).constructor`.
     Replacing the global would break `instanceof Function` in skill code; the
     inherited CSP (no 'unsafe-eval') is what stops a string becoming code.
   - A property the host made non-configurable and non-writable cannot be
     changed at all. Any name that could not be removed or pinned is listed in
     `unlocked` and reported to the app with ready. */
const G = globalThis;
const unlocked = [];
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const notHere = (name) => function () { throw new Error(`${name} is not available to a skill`); };

function pin (obj, name, value) {
  try {
    Object.defineProperty(obj, name, { value, writable: false, configurable: false, enumerable: false });
  } catch {
    try { obj[name] = value; } catch { /* reported by the caller */ }
  }
  return obj[name] === value;
}

function lockName (host, name, value) {
  let ok = true;
  for (let o = Object.getPrototypeOf(host); o && o !== Object.prototype; o = Object.getPrototypeOf(o)) {
    if (!hasOwn(o, name)) continue;
    try { delete o[name]; } catch { /* pinned below instead */ }
    if (hasOwn(o, name) && !pin(o, name, value)) ok = false;
  }
  /* Pinned on the host even where it never had it, so it cannot be added later. */
  if (!pin(host, name, value)) ok = false;
  if (!ok) unlocked.push(name);
}

/* Captured before the lock: the worker's own channel to the app. Skills get
   neither — a skill that could post could forge another run's reply. */
const post = G.postMessage.bind(G);
const listen = G.addEventListener.bind(G);

/* Node's test adapter only (scripts/lib/node-skill-worker.mjs) runs this file
   in a worker_threads thread, where there is no page for the dev checkout's
   root to be the root of. It names that directory before this file is
   evaluated, and the app then sends '/'. A browser worker has no `process`,
   so this is null there and '/' is refused. */
const NODE_CODE_ROOT = (typeof process === 'object' && process !== null && process.versions && process.versions.node
  && typeof G.__pigeonNodeCodeRoot === 'string') ? G.__pigeonNodeCodeRoot : null;

for (const name of ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'importScripts', 'BroadcastChannel', 'Worker', 'SharedWorker']) {
  lockName(G, name, notHere(name));
}
for (const name of ['indexedDB', 'caches']) lockName(G, name, undefined);
try {
  if (G.navigator && 'sendBeacon' in G.navigator) lockName(G.navigator, 'sendBeacon', notHere('sendBeacon'));
} catch { unlocked.push('sendBeacon'); }
/* eval is not a network route, but a room with no eval is what was promised. */
lockName(G, 'eval', notHere('eval'));
/* The channel, taken away from skill code now that the worker holds its own. */
for (const name of ['postMessage', 'addEventListener', 'removeEventListener']) lockName(G, name, notHere(name));
lockName(G, 'onmessage', null);

/* Some hosts define globals as lazy getters that redefine themselves on first
   read; after a freeze that redefinition throws. Read everything once first. */
for (const key of Reflect.ownKeys(G)) {
  try { void G[key]; } catch { /* a getter that throws is not our concern */ }
}
try { Object.freeze(G); } catch { unlocked.push('(freeze)'); }

/* ── 2. copied from skill-protocol.js ─────────────────────────────────────
   This file cannot import it (see the header). The copies are exercised
   through a real worker by `npm test`, which compares what comes back with
   skill-protocol.js's own stripForWorker and envelopes. */
const PACK_BASE = /^pigeon-pack:\/\/localhost\/v\d+-[0-9a-f]{8}\/code\/$/;
const DEV_BASE = /^(?:https?|tauri):\/\/(?:localhost|127\.0\.0\.1)(?::\d{1,5})?\/$/;
const validBase = (s) => typeof s === 'string' && (PACK_BASE.test(s) || DEV_BASE.test(s) || (s === '/' && NODE_CODE_ROOT !== null));

function withoutFunctions (value) {
  if (typeof value === 'function') return undefined;
  if (Array.isArray(value)) return value.map(v => (typeof v === 'function' ? undefined : withoutFunctions(v)));
  if (value === null || typeof value !== 'object') return value;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return value;
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (typeof v === 'function') continue;
    out[k] = withoutFunctions(v);
  }
  return out;
}
const runReply = (id, result) => ({ type: 'result', id, result });
const errorReply = (id, message) => ({ type: 'error', id, message: String(message) });

/* ── 3. the conversation ─────────────────────────────────────────────── */
let loading = null;           // Promise<Map<name, entry> | null>, set by the one init
const searches = new Map();   // sid → { resolve, reject }
let nextSid = 1;

const entryUrl = (codeBase) => (codeBase === '/'
  ? new URL('skills/index.js', NODE_CODE_ROOT).href
  : `${codeBase}skills/index.js`);

async function init (codeBase) {
  if (!validBase(codeBase)) {
    post({ t: 'failed', reason: 'that is not a place skills may be loaded from' });
    return null;
  }
  let entries;
  try {
    const mod = await import(entryUrl(codeBase));
    entries = mod.default;
  } catch (e) {
    post({ t: 'failed', reason: `the skills did not load — ${(e && e.message) || e}` });
    return null;
  }
  if (!Array.isArray(entries)) {
    post({ t: 'failed', reason: 'skills/index.js does not export a list of skills' });
    return null;
  }
  /* A Map, so a name like "constructor" or "__proto__" is only ever a key. */
  const skills = new Map();
  for (const e of entries) if (e && typeof e.name === 'string' && typeof e.run === 'function') skills.set(e.name, e);
  try {
    post({ t: 'ready', entries: entries.map(withoutFunctions), unlocked: [...unlocked] });
  } catch (e) {
    post({ t: 'failed', reason: `the skill list cannot leave the worker — ${(e && e.message) || e}` });
    return null;
  }
  return skills;
}

function askSearch (id, query) {
  const sid = nextSid++;
  return new Promise((resolve, reject) => {
    searches.set(sid, { resolve, reject });
    post({ t: 'search', id, sid, query: String(query) });
  });
}

async function run ({ id, name, input, ctx }) {
  const skills = loading ? await loading : null;
  if (!skills) { post(errorReply(id, 'Patch\'s skills are not loaded.')); return; }
  const skill = typeof name === 'string' ? skills.get(name) : undefined;
  if (!skill) { post(errorReply(id, `no such skill: ${String(name)}`)); return; }
  /* The search a skill sees is a question to the app, which answers only for a
     skill that needs the network in a run the web was on for. Handed over only
     when the run's ctx says the web is on — exactly when the app's own ctx
     would have carried a search function. */
  const runCtx = ctx && typeof ctx === 'object' ? { ...ctx } : {};
  if (runCtx.webEnabled === true) runCtx.search = (query) => askSearch(id, query);
  let result;
  try {
    result = await skill.run(input, runCtx);
  } catch (e) {
    post(errorReply(id, (e && e.message) || 'The skill failed unexpectedly.'));
    return;
  }
  try { post(runReply(id, result)); }
  catch (e) { post(errorReply(id, `${name} returned something that cannot leave the worker — ${(e && e.message) || e}`)); }
}

listen('message', (event) => {
  const m = event && event.data;
  if (!m || typeof m !== 'object') return;
  if (m.t === 'init') {
    if (loading) return;          // exactly one init; a second is ignored
    loading = init(m.codeBase);
    return;
  }
  if (m.t === 'run') {
    run(m).catch(() => {});
    return;
  }
  if (m.t === 'searchReply') {
    const s = searches.get(m.sid);
    if (!s) return;
    searches.delete(m.sid);
    if (typeof m.error === 'string') s.reject(new Error(m.error));
    else s.resolve(m.result);
  }
});
