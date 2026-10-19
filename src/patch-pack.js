/* patch-pack.js — Patch, loaded into his locked room, as the app sees him.
 *
 * The main-thread half of skill-worker.js. It starts the worker, hands it one
 * code base, and turns the skill list that comes back into a registry the
 * router, planner and executor use exactly as they used the built-in one —
 * except that every `run` is a message to the worker.
 *
 * It owns three rules the worker cannot enforce on itself:
 *   - a call that is not answered in time kills the worker. Every call still
 *     waiting is rejected, and the next call starts a fresh worker. A hung
 *     skill costs one answer, never the rest of the session.
 *   - a skill's search request is answered only for a skill that declares
 *     needsNetwork, during a run whose ctx had the web on. Anything else gets
 *     an error back and no request is made.
 *   - the pack's prompts are checked against its own skills before a single
 *     option is handed to a factory (patch-options.js).
 *
 * The worker is started from a Blob, never from its URL: a Blob worker
 * inherits the page's CSP and a same-origin URL worker does not (see the
 * header of skill-worker.js). The app's CSP will allow workers only from
 * blob:, so every worker the app starts must be made this way.
 *
 * This file loads no code itself, and the import lint keeps it that way.
 * No DOM; `makeWorker` is injectable (and may be async) so Node can supply a
 * worker_threads adapter (scripts/lib/node-skill-worker.mjs).
 */

import { proxyEntry, isValidCodeBase, isPackCodeBase, absoluteCodeBase, createCaller } from './skill-protocol.js';
import { buildRegistry } from './registry.js';
import { optionsFrom, checkTrainedSystem } from './patch-options.js';
import { PLAN_LIMITS, ERROR_CODES } from './contracts.js';

/* planner.js's TRAINED_PLANNER, named here so the pack loader imports no
   planner code (scripts/test.mjs checks the two agree). */
const TRAINED_PLANNER = 'patch-planner-trained';

/* Loading ~300 modules from disk is well under a second; this is only the
   point at which a worker that never answers is called broken. */
export const INIT_TIMEOUT_MS = 30000;

/** The app's worker: this checkout's skill-worker.js, started from a Blob. */
export async function blobWorker () {
  const res = await fetch(new URL('./skill-worker.js', import.meta.url));
  if (!res.ok) throw new Error(`the skill worker could not be read (HTTP ${res.status})`);
  const src = await res.text();
  return new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })), { type: 'module' });
}

const why = (e) => String((e && e.message) || e || 'unknown error');

/**
 * Where Patch's skills come from, for both windows.
 *
 * Under Tauri, Rust decides: `patch_status` names the sealed pack it chose at
 * launch, with the prompts and tunables that pack carries. There is NO dev
 * checkout fallback in the app — a pack that could not be used makes Patch
 * unavailable, with Rust's reason. While Rust is still unpacking the adapter
 * the status is "loading"; that is waited out, briefly.
 *
 * Without Tauri (the browser build) the developer's checkout is loaded.
 *
 * Resolves `{ codeBase, pack, devAllowed }`, or rejects with the reason Patch
 * cannot be loaded.
 */
export async function patchSource ({
  invoke = globalThis.__TAURI__?.core?.invoke, pollMs = 2000, waitMs = 60000,
  sleep = (ms) => new Promise(r => setTimeout(r, ms)),
  listen = globalThis.__TAURI__?.event?.listen
} = {}) {
  if (typeof invoke !== 'function') return { codeBase: '/', pack: null, devAllowed: true };
  /* Rust says when the choice has settled; the poll is the fallback for a
     page that came up after the event went by. */
  let nudge = null;
  const settled = typeof listen === 'function'
    ? new Promise(r => { nudge = r; listen('patch-settled', () => r()).catch(() => {}); })
    : null;
  const wait = (ms) => (settled ? Promise.race([sleep(ms), settled]) : sleep(ms));
  for (let waited = 0; ; waited += pollMs) {
    const s = await invoke('patch_status');
    if (s && s.state === 'ready') {
      if (!isPackCodeBase(s.code_base)) throw new Error('the app named no sealed pack to load his skills from.');
      return {
        codeBase: s.code_base,
        pack: { prompts: s.prompts, tunables: s.tunables, version: s.version ?? null, source: s.source || 'sealed pack', pigeons: s.pigeons || [] },
        devAllowed: false
      };
    }
    if (!s || s.state !== 'loading') throw new Error((s && s.reason) || 'no sealed pack could be used.');
    if (waited >= waitMs) throw new Error('his skills are still being unpacked — try again in a moment.');
    await wait(pollMs);
    if (nudge) { nudge = null; }
  }
}

/**
 * Load Patch. Resolves (never rejects) to
 *   { state: 'ready', registry, entries, options, info, close }
 * or
 *   { state: 'unavailable', reason }.
 *
 * `codeBase` is a pack's `pigeon-pack://…/code/` or '/', the dev checkout,
 * which is sent to the worker as the page's absolute root (`pageHref`).
 * `pack` is `{ prompts, tunables, version?, source? }` when the pack carries its
 * prompts (a sealed pack, from Rust in the app); without it the options are {},
 * which is every factory's own constants — the dev checkout.
 */
export async function loadPatch ({
  codeBase = '/', makeWorker = blobWorker, search = null, pack = null, devAllowed = true,
  pageHref = globalThis.location ? globalThis.location.href : undefined,
  timeoutMs = PLAN_LIMITS.SKILL_TIMEOUT_MS, initTimeoutMs = INIT_TIMEOUT_MS,
  setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (t) => clearTimeout(t)
} = {}) {
  const unavailable = (reason) => ({ state: 'unavailable', reason: `Patch is unavailable: ${reason}` });
  if (!isValidCodeBase(codeBase) || (!devAllowed && !isPackCodeBase(codeBase))) {
    return unavailable('his skills cannot be loaded from there.');
  }
  const sentBase = absoluteCodeBase(codeBase, pageHref);

  let slot = null;              // the running worker: { w, gen, settleInit }
  let starting = null;          // Promise of a worker being started
  let gen = 0;
  let lastId = null;
  let closed = false;
  let networkSkills = new Set();
  const runs = new Map();       // call id → { name, web, gen }
  const timedOut = new Set();

  const caller = createCaller({
    timeoutMs, setTimer, clearTimer,
    post: (sent) => {
      if (!slot) throw new Error('Patch\'s skills are not running.');
      lastId = sent.id;
      runs.set(sent.id, { name: sent.name, web: Boolean(sent.ctx && sent.ctx.webEnabled === true), gen: slot.gen });
      slot.w.postMessage({ t: 'run', id: sent.id, name: sent.name, input: sent.input, ctx: sent.ctx });
    },
    onTimeout: (id) => {
      const r = runs.get(id);
      runs.delete(id);
      timedOut.add(id);
      if (r && slot && r.gen === slot.gen) kill(`${r.name} hung, so Patch's skills were restarted.`);
    }
  });

  function kill (reason) {
    const dead = slot;
    slot = null;
    if (dead) {
      dead.settleInit.reject(new Error(reason));
      try { dead.w.terminate(); } catch { /* already gone */ }
    }
    runs.clear();
    caller.rejectAll(new Error(reason));
  }

  async function start () {
    const mine = { gen: ++gen };
    const ready = new Promise((resolve, reject) => {
      const t = setTimer(() => reject(new Error('his skills took too long to load.')), initTimeoutMs);
      mine.settleInit = {
        resolve: (v) => { clearTimer(t); resolve(v); },
        reject: (e) => { clearTimer(t); reject(e); }
      };
    });
    ready.catch(() => {});
    mine.w = await makeWorker();
    mine.w.onmessage = (event) => { if (slot === mine) receive(mine, event && event.data); };
    mine.w.onerror = (event) => {
      if (event && typeof event.preventDefault === 'function') event.preventDefault();
      if (slot === mine) kill(`the skill worker stopped — ${why((event && (event.error || event.message)) || event)}`);
    };
    if (closed) { try { mine.w.terminate(); } catch { /* gone */ } throw new Error('Patch\'s skills have been closed.'); }
    slot = mine;
    mine.w.postMessage({ t: 'init', codeBase: sentBase });
    try {
      return await ready;
    } catch (e) {
      if (slot === mine) kill(why(e));
      throw e;
    }
  }

  /* One worker starting at a time, however many calls arrive while it does. */
  function ensure () {
    if (slot && !starting) return Promise.resolve();
    if (!starting) starting = start().finally(() => { starting = null; });
    return starting;
  }

  function receive (from, m) {
    if (!m || typeof m !== 'object') return;
    if (m.t === 'ready') { from.settleInit.resolve(Array.isArray(m.entries) ? m.entries : []); return; }
    if (m.t === 'failed') { from.settleInit.reject(new Error(String(m.reason || 'the skills did not load.'))); return; }
    if (m.t === 'search') { answerSearch(from, m); return; }
    caller.receive(m);
  }

  function answerSearch (from, m) {
    const reply = (fields) => { if (slot === from) from.w.postMessage({ t: 'searchReply', id: m.id, sid: m.sid, ...fields }); };
    const r = runs.get(m.id);
    if (!r || r.gen !== from.gen || !networkSkills.has(r.name) || !r.web || typeof search !== 'function') {
      reply({ error: 'This run may not use the web.' });
      return;
    }
    Promise.resolve()
      .then(() => search(String(m.query)))
      .then((result) => reply({ result }), (e) => reply({ error: why(e) }));
  }

  async function call ({ name, input, ctx }) {
    if (closed) throw new Error('Patch\'s skills have been closed.');
    await ensure();
    const promise = caller.call({ name, input, ctx });
    const id = lastId;
    try {
      return await promise;
    } catch (e) {
      if (timedOut.has(id)) {
        timedOut.delete(id);
        const t = new Error(`${name} took longer than ${timeoutMs}ms.`);
        t.code = ERROR_CODES.TIMEOUT;
        throw t;
      }
      throw e;
    } finally {
      runs.delete(id);
    }
  }

  let entries;
  try {
    starting = start().finally(() => { starting = null; });
    entries = await starting;
  } catch (e) {
    return unavailable(why(e));
  }

  let registry;
  let options = {};
  try {
    networkSkills = new Set(entries.filter(d => d && d.needsNetwork).map(d => d.name));
    registry = buildRegistry(entries.map(d => proxyEntry(d, call)));
    if (pack) {
      checkTrainedSystem(registry, pack.prompts);
      options = optionsFrom({ prompts: pack.prompts, tunables: pack.tunables });
      /* v7: the trained planner, when his nest carries it. */
      if ((pack.pigeons || []).includes(TRAINED_PLANNER)) options.plannerOptions = { ...options.plannerOptions, pigeonId: TRAINED_PLANNER };
    }
  } catch (e) {
    kill(why(e));
    return unavailable(why(e));
  }

  const info = {
    source: pack ? (pack.source || 'sealed pack') : 'dev checkout',
    version: pack && pack.version != null ? pack.version : null,
    skills: registry.routable().length,
    /* D84: the Pigeons in his nest, which do his routing and planning and the
       app's other asks. Shown in his details so nothing that runs is unseen. */
    pigeons: (pack && pack.pigeons) || []
  };

  return {
    state: 'ready', registry, entries, options, info,
    /** Stop the worker for good (tests and scripts; the app never needs to). */
    close () { closed = true; kill('Patch\'s skills have been closed.'); }
  };
}

/* Patch's nest, said in words: which Pigeons he and the app ask (D84). */
export function patchNestLine (ids) {
  const words = { 'patch-router': 'his router', 'patch-asks': 'the asks check', 'patch-second-look': 'the second look',
    'patch-focus': 'the focus pass', tidier: 'the transcript tidier', 'ocr-tidy': 'the OCR clean-up',
    pen: 'Pen', 'pen-no-figures': 'Pen without figures', peek: 'Peek', 'peek-words': 'Peek without a picture' };
  const planners = ids.filter(id => id.startsWith('patch-planner')).length;
  const named = ids.filter(id => !id.startsWith('patch-planner')).map(id => words[id] || id);
  return `${ids.length} · ${[...(planners ? [`his planner${planners > 1 ? ` (${planners} prompts)` : ''}`] : []), ...named].join(', ')}`;
}
