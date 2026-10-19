/* engine.js — the page's view of Pigeon's own engine.
 *
 * Seven Rust commands and two events, and none of them takes a path, a URL or a
 * port: the page says WAKE, SLEEP, DOWNLOAD or CANCEL, and asks what the
 * status is. Which binary runs, which files it loads, where they download
 * from and where they land are all decided in Rust from the manifest compiled
 * into the app (`src-tauri/models.json`). Same shape as llm.js, store.js and
 * ocr.js: the webview names what, never where.
 *
 * Everything below `engineBridge` is pure — the rail's two rows, the sheet's
 * wording, the progress arithmetic — so the test suite can check every string
 * a person reads without a Tauri window. In a browser (`npm run serve`) there
 * is no bridge, `engineBridge()` is null, and the rail says so. */

const invoke = () => globalThis.__TAURI__?.core?.invoke ?? null;
const listenFn = () => globalThis.__TAURI__?.event?.listen ?? null;

/** The exact string Rust returns from a cancelled download. */
export const CANCELLED = 'cancelled';

export function engineBridge () {
  const call = invoke();
  if (!call) return null;
  const subscribe = async (name, cb) => {
    const listen = listenFn();
    if (!listen) return () => {};
    return listen(name, (e) => cb(e.payload));
  };
  return {
    transport: 'rust command',
    status: () => call('engine_status'),
    wake: () => call('engine_wake'),
    /* Typing promises a question: Patch's base, his three Pigeons and a lane
       are made ready now, so the turn does not pay for them. Nothing asked. */
    warm: () => call('engine_warm'),
    sleep: () => call('engine_sleep'),
    setIdleUnload: (secs) => call('engine_set_idle_unload', { secs }),
    models: () => call('models_status'),
    download: () => call('models_download'),
    downloadPicture: () => call('models_download_picture'),
    downloadEmbedding: () => call('models_download_embedding'),
    downloadProjector: (sha) => call('models_download_projector', { sha }),
    cancel: () => call('models_cancel'),
    onStatus: (cb) => subscribe('engine-status', cb),
    onProgress: (cb) => subscribe('model-download-progress', cb)
  };
}

/* How long a wake is waited on before giving up. Matched to the engine's own
   health cap (src-tauri/src/engine.rs, HEALTH_CAP) plus a margin, so the page
   never gives up on a load the server itself is still willing to wait out. */
export const WAKE_TIMEOUT_MS = 190_000;

/* Phases a wake leaves the category role in that no amount of waiting turns
   into ready: Rust has already decided, and says why in `detail`. */
const LANE_DOWN = new Set(['error', 'missing', 'unfit']);

/** Why the category role cannot answer, in words a person can act on. */
export function laneDownText (cat) {
  if (cat && cat.owned === false) {
    return `something already on port ${cat.port} is holding the chat model, and Pigeon does not restart what it did not start — quit it (lsof -i :${cat.port}) and send again`;
  }
  /* An adopted server wearing the wrong adapters is a thing a person can fix,
     so it is said as one; the port and the engine's own words stay in Info. */
  if (cat && /restart needed/i.test(String(cat.detail || ''))) {
    return 'another copy of the model server is running outside Pigeon, so this Pigeon could not be loaded — quit that server and send again';
  }
  const why = cat && cat.detail ? ` — ${cat.detail}` : '';
  return `the chat model could not wake${why}`;
}

/**
 * Wake the category role — the server every writing Pigeon rides on — and
 * wait until the page's own bridge to it is up. Resolves to null once it is,
 * or to a sentence saying why it will not be; never throws.
 *
 * `engine.wake()` only asks the roles to start and returns a snapshot; the
 * page learns of readiness from status events, which `apply` turns into a
 * bridge. So this waits on `isUp()`, but reads each snapshot as it goes and
 * stops the moment Rust reports a phase that cannot become ready — the
 * adopted-foreign-server case in particular, which would otherwise sit on
 * "waking the models" for the whole timeout.
 */
export async function wakeCategory (engine, { isUp, apply, current, timeoutMs = WAKE_TIMEOUT_MS, every = 300, sleep = (ms) => new Promise(r => setTimeout(r, ms)), now = Date.now } = {}) {
  if (isUp()) return null;
  if (!engine) return 'no model is awake to write with, and this build has no engine to start one — ask Patch';
  try {
    await apply(await engine.wake());
  } catch (e) {
    return `the models could not be woken — ${(e && e.message) || e}`;
  }
  const deadline = now() + timeoutMs;
  while (!isUp()) {
    const status = current();
    if (status && status.disabled) return 'the models are switched off in this build';
    const cat = status && status.category;
    if (cat && LANE_DOWN.has(cat.phase)) return laneDownText(cat);
    if (now() >= deadline) return 'the models did not finish waking — try again in a moment';
    await sleep(every);
  }
  return null;
}

/* Decimal units, the ones a download dialog is expected to use: the manifest's
   2,266,884,608 bytes read as "2.3 GB", not "2.1 GiB". Anything that rounds
   to a gigabyte is shown as one — the 986 MB category model is "1.0 GB", the
   way the sheet was drawn, rather than a row that looks smaller than it is. */
export function fmtBytes (n) {
  n = Number(n) || 0;
  if (n >= 0.95e9) return `${(n / 1e9).toFixed(1)} GB`;
  if (n >= 1e6) return `${Math.round(n / 1e6)} MB`;
  if (n >= 1e3) return `${Math.round(n / 1e3)} KB`;
  return `${n} B`;
}

/* RAM is binary: 16384 MB is "16 GB". */
export function fmtRam (mb) {
  return `${Math.round((Number(mb) || 0) / 1024)} GB`;
}

/** The sheet's one line about this Mac. `hw` is `models_status().hardware`. */
export function fitLine (hw) {
  if (!hw) return { text: 'This Mac’s memory could not be read — Pigeon will try anyway', tone: 'warn' };
  const ram = fmtRam(hw.total_mb);
  switch (hw.fit) {
    case 'fits':
      return { text: `This Mac has ${ram} — ${hw.spare ? 'plenty' : 'enough'}`, tone: 'good' };
    default:
      return { text: `This Mac has ${ram} — the model does not fit; Patch would keep to quick answers`, tone: 'warn' };
  }
}

const SOURCE_WORDS = {
  'in-process': 'own · in this app',
  bundled: 'own · bundled',
  env: 'from LLAMA_SERVER',
  path: 'from PATH'
};

/**
 * The rail's two rows. `status` is `engine_status()`, `models` is
 * `models_status()`; either may be null. "on" is reserved for Pigeon's own
 * bundled engine running Pigeon's own verified weights — anything else is
 * a stand-in and says so, exactly as the planner row does.
 */
export function engineRows (status, models) {
  if (!status) {
    return [
      { pass: 'engine', state: 'off', detail: 'none · opened in a browser' },
      { pass: 'models', state: 'off', detail: 'none · opened in a browser' }
    ];
  }
  const engine = (() => {
    if (status.disabled) return { state: 'off', detail: 'off · PIGEON_NO_MODELS' };
    const src = status.binary?.source;
    if (!src) return { state: 'off', detail: 'no engine found' };
    const words = SOURCE_WORDS[src] || src;
    const roles = [status.category];
    const awake = roles.filter(r => r?.phase === 'ready').length;
    const err = roles.find(r => r?.phase === 'error');
    const life = err ? `error — ${err.detail}`
      : roles.some(r => r?.phase === 'waking') ? 'waking'
        : awake ? `${awake} awake` : 'asleep';
    return { state: src === 'bundled' || src === 'in-process' ? 'on' : 'sub', detail: `${words} · ${life}` };
  })();
  const weights = (() => {
    if (!models) return { state: 'off', detail: 'unknown' };
    const list = models.models || [];
    const total = list.reduce((n, x) => n + (x.bytes || 0), 0);
    const present = list.filter(x => x.state === 'present').length;
    const partial = list.find(x => x.state === 'partial');
    if (models.downloading) {
      const pct = partial && partial.bytes ? Math.round(100 * partial.have_bytes / partial.bytes) : 0;
      return { state: 'sub', detail: `downloading ${pct}%` };
    }
    if (list.length && present === list.length) return { state: 'on', detail: `${list.length} · ${fmtBytes(total)}` };
    if (present > 0 || partial) {
      return { state: 'sub', detail: `${present} of ${list.length} · ${fmtBytes(models.remaining_bytes)} to fetch` };
    }
    return { state: 'off', detail: `not downloaded · ${fmtBytes(models.download_bytes)}` };
  })();
  return [{ pass: 'engine', ...engine }, { pass: 'models', ...weights }];
}

const ROLE_WORDS = { category: 'the model', picture: 'the picture model', 'picture-projector': 'the picture model’s projector', embedding: 'the search model', projector: 'the picture reader' };
/** What each model is for, in the download sheet. */
const ROLE_DOES = { category: 'understands what you ask and picks the right skill' };

/** One `model-download-progress` event, as the words the card shows. */
export function progressLine (ev) {
  const name = ROLE_WORDS[ev.id] || ev.id;
  const pct = ev.total ? Math.min(100, Math.round(100 * ev.received / ev.total)) : 0;
  const title = ev.stage === 'verify' ? 'Checking the download against its checksum'
    : ev.stage === 'failed' ? 'The download stopped'
      : ev.stage === 'done' ? `Got ${name}`
        : `Getting ${name}`;
  return {
    title,
    pct,
    line: `${pct}% · ${fmtBytes(ev.received)} of ${fmtBytes(ev.total)}`,
    overall: `${fmtBytes(ev.overall_received)} of ${fmtBytes(ev.overall_total)}`,
    resumed: Boolean(ev.resumed),
    error: ev.error || null
  };
}

/**
 * Show the first-run sheet? Only when there is something to fetch, nothing is
 * fetching, and the person has not said "not now".
 * A download that was accepted but never finished asks again — as a resume.
 */
export function needsFirstRun ({ models, settings }) {
  if (!models || !(models.download_bytes > 0) || models.downloading) return false;
  return (settings?.firstRun?.choice ?? null) !== 'declined';
}

/* A short tag for a model row: "Qwen3.5 2B" → "qwen3.5-2b". */

/**
 * The sheet that asks. `esc` is the page's HTML escaper, passed in so this
 * file stays DOM-free and the markup can be asserted in tests. Buttons carry
 * `data-fr` so the page can wire them after a re-render.
 */
export function firstRunHtml (models, esc) {
  const list = models.models || [];
  const rows = list.map((m, i) => {
    const role = list.length === 1 ? 'Qwen3-VL 2B' : `Model ${i + 1} of ${list.length}`;
    const does = ROLE_DOES[m.role] || m.role;
    return `<div class="mdl-row"><span><span class="mn">${esc(role)}</span> <span class="mr">${esc(does)}</span></span><span class="sz">${esc(fmtBytes(m.bytes))}</span></div>`;
  }).join('');
  const fit = fitLine(models.hardware);
  const licences = [...new Set(list.map(m => m.licence?.spdx).filter(Boolean))];
  const attrib = licences.length === 1 && licences[0] === 'Apache-2.0'
    ? `<b>${list.length === 1 ? 'The model is' : 'Both models are'} Apache 2.0.</b>`
    : `<b>Licences: ${esc(licences.join(', ') || 'see the notices')}.</b>`;
  const resuming = models.remaining_bytes > 0 && models.remaining_bytes < models.download_bytes;
  const verb = resuming ? 'Resume' : 'Download';
  const size = fmtBytes(resuming ? models.remaining_bytes : models.download_bytes);
  return `<div class="sheet-card fr-card">
    <div class="sheet-title">Download Pigeon’s model?</div>
    <div class="sheet-body">One small model lets Patch understand plain English. They are downloaded once, they live on this Mac, and nothing you type is ever sent anywhere.</div>
    ${rows}
    <p class="fit-line ${fit.tone}"><i></i>${esc(fit.text)}</p>
    <div class="attrib">${attrib} Its licence and notices are written alongside the weights before a single byte downloads.</div>
    <div class="sheet-row">
      <p class="sheet-note">Skip it and Patch still gives quick answers to about one question in six.</p>
      <button class="sheet-btn" data-fr="notnow">Not now</button>
      <button class="sheet-btn primary" data-fr="go">${esc(verb)} ${esc(size)}</button>
    </div>
  </div>`;
}

/** The same card while a download runs, or after it stops. */
export function progressHtml (ev, esc) {
  const p = progressLine(ev);
  if (ev.stage === 'failed') {
    return `<div class="sheet-card fr-card">
      <div class="sheet-title">${esc(p.title)}</div>
      <div class="sheet-body">${esc(p.error || 'Something went wrong.')}</div>
      <div class="attrib">Nothing that arrived is lost: a part file is kept and the next try picks up where it left off, unless it failed its checksum — then it was discarded on purpose.</div>
      <div class="sheet-row">
        <button class="sheet-btn" data-fr="close">Close</button>
        <button class="sheet-btn primary" data-fr="retry">Try again</button>
      </div>
    </div>`;
  }
  /* The hooks are load-bearing. This card is redrawn about seven times a second
     while a download runs, and rebuilding its markup that often takes the Cancel
     button out from under the pointer mid-click and out of the keyboard's reach
     entirely — so the page updates these four pieces in place instead and leaves
     the buttons alone. See paintDownloadCard. */
  return `<div class="sheet-card fr-card">
    <div class="sheet-title">${esc(p.title)}</div>
    <div class="sheet-body"><span class="dl-overall">${esc(p.overall)}</span>. You can keep using Pigeon while this finishes; a paused download picks up where it left off.</div>
    <div class="bar" role="progressbar" aria-label="Download progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${p.pct}"><i style="width:${p.pct}%"></i></div>
    <div class="bar-meta"><span class="dl-line">${esc(p.line)}</span><span class="dl-resume">${p.resumed ? 'resumed' : 'resumable'}</span></div>
    <div class="attrib">Pigeon answers already while this finishes — quick answers, offline, in under 20 ms.</div>
    <div class="sheet-row">
      <button class="sheet-btn" data-fr="cancel">Pause</button>
      <button class="sheet-btn primary" data-fr="close">Keep using Pigeon</button>
    </div>
  </div>`;
}
