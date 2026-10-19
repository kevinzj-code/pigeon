/* store.js — the chat log, and the only thing in Pigeon that persists.
 *
 * One file, `app_data_dir/state.json`, reached through two named Rust commands.
 * The page hands over a JSON string and never a path; `store.rs` builds the path
 * from the app's own data directory, so this module cannot be talked into
 * writing anywhere else. Same shape as the model and web seams: the webview
 * says WHAT, Rust decides WHERE.
 *
 * No localStorage mirror. The desktop app keeps one because it began life as a
 * web page, and its save path carries thirty lines of apology about quota errors
 * silently evicting the oldest chats. A second copy would be a second thing to
 * make honest claims about, and a data-loss path Pigeon can simply not have.
 *
 * Opened in a browser with no Tauri bridge — `npm run serve` — every function
 * here is a no-op and the app runs exactly as it did before any of this existed:
 * in memory, for the session. The rail says which of the two is true.
 *
 * Nothing here touches the DOM, so the test suite can import it.
 */

export const STATE_VERSION = 4;

export const THEMES = ['light', 'dark', 'system'];
/* When Patch may go to the web: only when the person presses Look it up, also
   when nothing else fits, or never. */
export const WEB_POLICIES = ['press', 'fallback', 'never'];
/* How long the models may sit idle before they sleep, in seconds; 0 is never. */
export const SLEEP_AFTER = [600, 3600, 0];
/* Where a message's text came from. `person-confirmed` is text read from a
   picture or a transcript that the person kept, tidied or edited — theirs,
   but not typed. Anything a model wrote is neither, and is never a turn's input. */
export const TURN_SOURCES = ['typed', 'person-confirmed'];
/* The record of what left this Mac is text only and never grows without end. */
export const WEB_LOG_CAP = 500;
/* Where a conversation came from, when it did not start in the window. */
export const CHAT_SOURCES = ['menubar', 'welcome'];
/* The tapbacks a message can carry. Anything else in a file is dropped. */
export const REACTIONS = ['👍', '👎', '❤️', '😂', '‼️', '❓'];

/** What a fresh file carries besides chats. `firstRun` records whether the
 *  person has answered the model-download sheet, so it is asked once and not
 *  on every launch; `choice` is null (never asked), 'declined' or 'accepted'. */
export function defaultSettings () {
  /* `lastPick` is what New chat starts with: 'patch', 'chat', or
     'pigeon:<id>'. Prefixed so a Pigeon somebody slugged "patch" or "chat"
     cannot be mistaken for either. Null is Patch.
     `theme` starts light because that is how Pigeon has always looked;
     `bannersOff` starts off; `lastWakeMs` is how long the models last took to
     wake, measured, so a countdown can say "about".
     `webPolicy` starts at 'press': Patch looks nothing up by himself.
     `webLog` is every look-up and download, as text. `tips` records which
     one-time notes a person has already seen. */
  return {
    firstRun: { seenAt: null, choice: null },
    lastPick: null,
    theme: 'system',
    bannersOff: false,
    webPolicy: 'press',
    webLog: [],
    lastWakeMs: null,
    lastRestartMs: null,
    /* Pigeon id → { revision, results }: which of its maker's examples came
       out the same when run on this Mac. */
    reproduced: {},
    sleepAfter: 600,
    saveMenuBar: true,
    /* Pigeons pinned to the top of the Pigeons tab: pick → when it was
       pinned, so they sit in the order they were pinned, like chats. */
    pinnedPigeons: {},
    devMenu: false,
    tips: {},
    /* Play: app name → the way that app takes keys, found by the key test;
       and the app last played, picked first next time. */
    playHow: {},
    playLastApp: null,
    /* Pigeons replaced while the models slept: checked against their own
       examples the next time the models are up. */
    uncheckedRides: []
  };
}

/* Bumping STATE_VERSION means adding a function here, keyed by the version it
   upgrades FROM. */
const MIGRATIONS = {
  /* 1 → 2: a settings block. Chats are untouched. */
  1: (blob) => ({ ...blob, version: 2, settings: defaultSettings() }),
  /* 2 → 3: conversations gain pins, alerts, unread counts, where they came
     from, when something last happened in them, a question in flight and a
     saved draft. Every one of those has a safe default, and `normaliseChat`
     supplies it for every chat on every load — so the migration itself only
     has to say the file is now version 3. */
  2: (blob) => ({ ...blob, version: 3 }),
  /* 3 → 4: the messaging flow. Chats gain a send queue, a count of notes
     waved past and questions skipped; turns gain a quote and where their text
     came from; settings gain the web policy, its log, sleep, menu-bar saving and
     tips. `webDefault` was stored but never read, so it maps to nothing. Every
     field has a safe default supplied on load. */
  3: (blob) => ({ ...blob, version: 4 })
};

/* Only the keys the app knows, each with a sane value, whatever the file says. */
/* A contact's handle: 'patch', 'chat', 'peek' or 'pigeon:<id>'. */
const isPick = (v) => v === 'patch' || v === 'chat' || v === 'peek' || (typeof v === 'string' && /^pigeon:.+/.test(v));

export function normaliseSettings (s) {
  const out = defaultSettings();
  const ok = s && typeof s === 'object';
  const fr = ok ? s.firstRun : null;
  if (fr && typeof fr === 'object') {
    out.firstRun.seenAt = Number.isFinite(fr.seenAt) ? fr.seenAt : null;
    out.firstRun.choice = ['declined', 'accepted'].includes(fr.choice) ? fr.choice : null;
  }
  const lp = ok ? s.lastPick : null;
  if (isPick(lp)) out.lastPick = lp;
  if (ok && THEMES.includes(s.theme)) out.theme = s.theme;
  if (ok) out.bannersOff = s.bannersOff === true;
  if (ok && WEB_POLICIES.includes(s.webPolicy)) out.webPolicy = s.webPolicy;
  if (ok && Array.isArray(s.webLog)) {
    out.webLog = s.webLog
      .filter(e => obj(e) && Number.isFinite(e.at) && typeof e.text === 'string' && e.text)
      .map(e => ({ at: e.at, text: e.text, hosts: Array.isArray(e.hosts) ? e.hosts.filter(h => typeof h === 'string') : [] }))
      .slice(-WEB_LOG_CAP);
  }
  if (ok && SLEEP_AFTER.includes(s.sleepAfter)) out.sleepAfter = s.sleepAfter;
  if (ok && typeof s.saveMenuBar === 'boolean') out.saveMenuBar = s.saveMenuBar;
  if (ok && obj(s.pinnedPigeons)) {
    out.pinnedPigeons = Object.fromEntries(Object.entries(s.pinnedPigeons)
      .filter(([pick, at]) => isPick(pick) && Number.isFinite(at) && at > 0));
  }
  if (ok) out.devMenu = s.devMenu === true;
  if (ok && obj(s.tips)) out.tips = Object.fromEntries(Object.entries(s.tips).filter(([, v]) => v === true));
  /* A wake time is only worth remembering if it is a plausible one: between a
     second and the three-minute cap the engine itself gives up at. */
  if (ok && Number.isFinite(s.lastWakeMs) && s.lastWakeMs >= 1000 && s.lastWakeMs <= 180000) out.lastWakeMs = Math.round(s.lastWakeMs);
  if (ok && obj(s.reproduced)) {
    out.reproduced = Object.fromEntries(Object.entries(s.reproduced)
      .filter(([id, r]) => typeof id === 'string' && obj(r) && Number.isInteger(r.revision) && r.revision > 0 && Array.isArray(r.results))
      .map(([id, r]) => {
        const keep = { revision: r.revision, results: r.results.slice(0, 5).map(x => (x === true || x === false ? x : null)) };
        if (Number.isInteger(r.check) && r.check > 0) keep.check = r.check;
        /* A grounded Pigeon's check records the sentence each answer came from. */
        const line = (x) => (typeof x === 'string' ? x.slice(0, 600) : null);
        if (Array.isArray(r.sources)) keep.sources = r.sources.slice(0, 5).map(x => (obj(x) ? { expected: line(x.expected), got: line(x.got) } : null));
        return [id, keep];
      }));
  }
  if (ok && obj(s.playHow)) {
    out.playHow = Object.fromEntries(Object.entries(s.playHow)
      .filter(([app, how]) => typeof app === 'string' && app.length <= 200 && ['hid', 'session', 'pid'].includes(how)).slice(0, 50));
  }
  if (ok && typeof s.playLastApp === 'string' && s.playLastApp.length <= 200) out.playLastApp = s.playLastApp;
  if (ok && Array.isArray(s.uncheckedRides)) {
    out.uncheckedRides = s.uncheckedRides
      .filter(r => obj(r) && typeof r.id === 'string' && r.id && typeof r.name === 'string')
      .map(r => ({ id: r.id, name: r.name, vision: r.vision === true })).slice(0, 20);
  }
  /* A restart is a sleep and a wake, so it may take a little longer. */
  if (ok && Number.isFinite(s.lastRestartMs) && s.lastRestartMs >= 1000 && s.lastRestartMs <= 300000) out.lastRestartMs = Math.round(s.lastRestartMs);
  return out;
}

const invoke = () => globalThis.__TAURI__?.core?.invoke ?? null;

/** Is there anywhere to save to? False in a browser, and that is a supported
 *  state rather than a failure. */
export const canPersist = () => Boolean(invoke());

/**
 * Parse what came off disk. Pure, so the version and corruption rules are
 * testable without a filesystem.
 *
 * Returns null for anything it will not vouch for. Refusing beats guessing: a
 * half-understood blob rendered as history is worse than starting empty, and a
 * newer file from a newer build must not be silently downgraded — the user would
 * lose chats and be told nothing.
 */
export function parseBlob (raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;

  let blob;
  try { blob = JSON.parse(raw); }
  catch { return null; }
  if (!blob || typeof blob !== 'object' || Array.isArray(blob)) return null;

  let v = blob.version;
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  if (v > STATE_VERSION) return null;

  while (v < STATE_VERSION) {
    const up = MIGRATIONS[v];
    if (!up) return null;
    blob = up(blob);
    v = blob.version;
  }

  const chats = Array.isArray(blob.chats) ? blob.chats.filter(isChat).map(normaliseChat) : [];
  return {
    version: STATE_VERSION,
    chats,
    activeChatId: chats.some(c => c.id === blob.activeChatId) ? blob.activeChatId : (chats[0]?.id ?? null),
    settings: normaliseSettings(blob.settings)
  };
}

/* A conversation's LANE, normalised on the way in. Anything that is not
   exactly 'B' is the verified lane — including a chat saved before lanes
   existed, which is the right answer for every one of them: they were all
   answered by functions. A persona id is kept as written and checked against
   what is actually on the machine when it is used, because an adapter can be
   deleted between one launch and the next. */
function normaliseChat (c) {
  const lane = c.lane === 'B' ? 'B' : 'A';
  return {
    ...c,
    lane,
    personaId: lane === 'B' && typeof c.personaId === 'string' ? c.personaId : null,
    renamed: c.renamed === true,
    pinnedAt: Number.isFinite(c.pinnedAt) ? c.pinnedAt : null,
    muted: c.muted === true,
    unread: Number.isInteger(c.unread) && c.unread > 0 ? Math.min(c.unread, 999) : 0,
    source: CHAT_SOURCES.includes(c.source) ? c.source : null,
    lastActivityAt: Number.isFinite(c.lastActivityAt) ? c.lastActivityAt : newestAt(c),
    nodes: normaliseNodes(c.nodes),
    inflight: normaliseInflight(c.inflight),
    draft: normaliseDraft(c.draft),
    queue: normaliseQueue(c.queue),
    noteSkips: Number.isInteger(c.noteSkips) && c.noteSkips > 0 ? Math.min(c.noteSkips, 99) : 0,
    askSkipped: obj(c.askSkipped) ? Object.fromEntries(Object.entries(c.askSkipped).filter(([, v]) => v === true)) : {}
  };
}

/* Messages sent while another was still being answered, in order. Only what a
   person sent is kept — text, where it came from, what it quoted, when. */
function normaliseQueue (q) {
  if (!Array.isArray(q)) return [];
  return q
    .filter(m => obj(m) && typeof m.id === 'string' && typeof m.text === 'string' && m.text.trim())
    .map(m => ({
      id: m.id,
      text: m.text,
      source: TURN_SOURCES.includes(m.source) ? m.source : 'typed',
      quoteId: str(m.quoteId),
      sentAt: num(m.sentAt) ?? 0
    }));
}

/* When something last happened in a chat saved before that was recorded: its
   newest turn, else when it was last saved, else when it was made. */
function newestAt (c) {
  const turns = c.nodes && typeof c.nodes === 'object' ? Object.values(c.nodes) : Array.isArray(c.turns) ? c.turns : [];
  const newest = turns.reduce((m, t) => (t && Number.isFinite(t.at) && t.at > m ? t.at : m), 0);
  return newest || (Number.isFinite(c.updatedAt) ? c.updatedAt : Number.isFinite(c.createdAt) ? c.createdAt : 0);
}

const str = (v) => (typeof v === 'string' ? v : null);
const num = (v) => (Number.isFinite(v) ? v : null);
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);

/* A question that was being answered when the file was written. Kept only if
   it has something to keep — the text that was asked. */
function normaliseInflight (f) {
  if (!obj(f) || typeof f.message !== 'string' || !f.message) return null;
  return {
    message: f.message,
    image: obj(f.image),
    handedFrom: obj(f.handedFrom),
    lane: f.lane === 'B' ? 'B' : 'A',
    parentId: str(f.parentId),
    pendingAskId: str(f.pendingAskId),
    stage: '',
    sentAt: num(f.sentAt) ?? 0,
    readAt: num(f.readAt)
  };
}

/* The preview kept with a sent picture: a data: image no bigger than the
   preview pictureOf makes (512 px on its longer side, as a JPEG). Anything
   larger is not a preview, and is dropped rather than carried for ever. */
export const PREVIEW_CAP = 400 * 1024;
const isPreview = (v) => typeof v === 'string' && /^data:image\/(jpeg|png|webp);base64,/.test(v) && v.length <= PREVIEW_CAP;

/* The turns themselves are kept as written, except for the two things this
   version added to them: reactions, which must be tapbacks the app offers, and
   the read and replied times, which must be times. A chat saved before
   branching has no nodes yet and is left for migrateChat. */
function normaliseNodes (nodes) {
  if (!obj(nodes)) return nodes;
  const out = {};
  for (const [id, t] of Object.entries(nodes)) {
    if (!obj(t)) continue;
    const n = { ...t };
    const r = obj(t.reactions);
    const kept = r ? Object.fromEntries(['q', 'a'].filter(k => REACTIONS.includes(r[k])).map(k => [k, r[k]])) : {};
    if (Object.keys(kept).length) n.reactions = kept;
    else delete n.reactions;
    if ('readAt' in t) n.readAt = num(t.readAt);
    if ('repliedAt' in t) n.repliedAt = num(t.repliedAt);
    if ('quoteId' in t) n.quoteId = str(t.quoteId);
    if ('source' in t) n.source = TURN_SOURCES.includes(t.source) ? t.source : 'typed';
    /* A turn's picture is its preview and nothing more: a data: image, small. */
    if (obj(t.image) && 'thumb' in t.image) n.image = { ...t.image, thumb: isPreview(t.image.thumb) ? t.image.thumb : null };
    out[id] = n;
  }
  return out;
}

export const READ_INTERRUPTED = 'Reading was interrupted when Pigeon closed — add the image again.';

/* What you had typed and not sent, with its image chip and transcript offer.
 * The image chip keeps what the engine READ — never the picture: the pixels
 * have never touched disk and a saved draft is no reason to start. So after a
 * relaunch the chip shows an image icon where the thumbnail was, and sends
 * exactly as it would have. A reading that was still running cannot be
 * finished without the picture, so it says so; a tidy that was running falls
 * back to the raw reading it already had. */
function normaliseDraft (d) {
  if (!obj(d)) return null;
  const text = typeof d.text === 'string' ? d.text : '';
  const height = typeof d.height === 'string' ? d.height : '';
  const attachment = normaliseAttachment(d.attachment);
  const transcript = normaliseTranscript(d.transcript);
  if (!text && !attachment && !transcript) return null;
  return { text, height, attachment, transcript };
}

/* A chip holding a picture to be seen (not text read off one). Files written
   before pictures were kept off disk may still carry one; it is dropped. */
const isPictureChip = (a) => obj(a) && ('picture' in a || typeof a.forName === 'string');

function normaliseAttachment (a) {
  if (!obj(a) || typeof a.name !== 'string' || isPictureChip(a)) return null;
  const out = {
    name: a.name,
    mime: str(a.mime),
    width: num(a.width),
    height: num(a.height),
    thumb: null,
    status: ['ready', 'failed', 'reading', 'tidying'].includes(a.status) ? a.status : 'failed',
    error: str(a.error),
    raw: str(a.raw),
    cleaned: str(a.cleaned),
    used: a.used === 'cleaned' ? 'cleaned' : a.used === 'raw' ? 'raw' : null,
    text: str(a.text) ?? '',
    edited: a.edited === true,
    reason: str(a.reason),
    engine: str(a.engine) || 'the text reader',
    model: str(a.model),
    ocrMs: num(a.ocrMs) ?? 0,
    cleanupMs: num(a.cleanupMs) ?? 0,
    editing: false
  };
  const unreadable = () => Object.assign(out, { status: 'failed', error: READ_INTERRUPTED });
  if (out.status === 'reading') unreadable();
  else if (out.status === 'tidying') {
    if (out.raw) Object.assign(out, { status: 'ready', cleaned: null, used: 'raw', reason: 'the tidy was interrupted', text: out.raw });
    else unreadable();
  } else if (out.status === 'ready') {
    if (out.used === 'cleaned' && !out.cleaned) Object.assign(out, { used: 'raw', text: out.edited ? out.text : (out.raw ?? '') });
    if (!out.raw && !out.text) unreadable();
    if (!out.used) out.used = 'raw';
  }
  return out;
}

function normaliseTranscript (t) {
  if (!obj(t) || typeof t.raw !== 'string' || !t.raw) return null;
  const words = (v) => (Array.isArray(v) ? v.filter(w => typeof w === 'string') : []);
  const out = {
    /* A tidy that was running is offered again rather than left spinning. */
    status: ['offered', 'ready', 'failed'].includes(t.status) ? t.status : 'offered',
    raw: t.raw,
    mechanical: str(t.mechanical),
    repaired: str(t.repaired),
    used: ['raw', 'mechanical', 'repaired'].includes(t.used) ? t.used : 'raw',
    rejected: str(t.rejected),
    changed: obj(t.changed) ? { added: words(t.changed.added), removed: words(t.changed.removed) } : { added: [], removed: [] },
    stats: obj(t.stats),
    error: null
  };
  if (out.status === 'failed') out.error = str(t.error);
  if (out.status === 'ready' && !out.mechanical) Object.assign(out, { status: 'offered', used: 'raw', repaired: null });
  return out;
}

/**
 * The chats as they go to disk. What is held in memory and must not be
 * written is a picture's pixels — the chip on a draft, and the full picture a
 * Pigeon was handed — along with the bookkeeping a chip carries while it is
 * on screen. A SENT picture's small preview is history, and is kept, so the
 * chat still shows what was sent after a relaunch.
 */
/* Fewer candidates than the router weighed: Message info shows the top of
   the list, and the rest was only ever the planner's working. */
const CANDIDATES_KEPT = 5;

/* A turn on disk: its picture's small preview (the picture itself never — it
   lives in memory for the session, see app.js sentPictures), the top few
   routing candidates only, and none of the planner's private lists. */
function turnForDisk (t) {
  if (!t || typeof t !== 'object') return t;
  let out = t;
  if (out.image && typeof out.image === 'object' && out.image.thumb && !isPreview(out.image.thumb)) {
    const { thumb, ...image } = out.image;
    out = { ...out, image };
  }
  if (out.routing && typeof out.routing === 'object') {
    const { forPlanner, aboveThreshold, ...routing } = out.routing;
    if (Array.isArray(routing.candidates) && routing.candidates.length > CANDIDATES_KEPT) routing.candidates = routing.candidates.slice(0, CANDIDATES_KEPT);
    out = { ...out, routing };
  }
  return out;
}

export function forDisk (chats) {
  return (chats || []).map(c => {
    if (c && c.nodes && typeof c.nodes === 'object') {
      const nodes = {};
      for (const [id, t] of Object.entries(c.nodes)) nodes[id] = turnForDisk(t);
      c = { ...c, nodes };
    }
    /* A question still being answered keeps its preview, as the turn will. */
    if (c && c.inflight && c.inflight.image && c.inflight.image.thumb && !isPreview(c.inflight.image.thumb)) {
      const { thumb, ...image } = c.inflight.image;
      c = { ...c, inflight: { ...c.inflight, image } };
    }
    const d = c && c.draft;
    if (!d || (!d.attachment && !d.transcript)) return c;
    let attachment = null;
    /* A picture chip is its pixels and nothing else: it never goes to disk,
       so a relaunch finds the draft without it rather than half of it. */
    if (d.attachment && !isPictureChip(d.attachment)) {
      const { thumb, editing, seq, dropped, ...kept } = d.attachment;
      /* The raw reading is kept only where it differs from what is shown. */
      if (kept.raw && kept.raw === kept.text) kept.raw = null;
      attachment = kept;
    }
    let transcript = null;
    if (d.transcript) {
      const { seq, chatId, dropped, ...kept } = d.transcript;
      transcript = kept;
    }
    return { ...c, draft: { ...d, attachment, transcript } };
  });
}

/** The version a file says it is, or null if it is not a file this could read. */
export function blobVersion (raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const blob = JSON.parse(raw);
    return blob && typeof blob === 'object' && Number.isFinite(blob.version) ? blob.version : null;
  } catch { return null; }
}

/* Both shapes are accepted: `nodes` is the tree conversations use now, `turns`
   is the flat list they used before branching existed. Refusing the old shape
   here would silently drop every chat saved by an earlier build — the loader
   upgrades them instead. */
const isChat = (c) => Boolean(c) && typeof c === 'object' && typeof c.id === 'string' &&
  (Boolean(c.nodes) && typeof c.nodes === 'object' || Array.isArray(c.turns));

/* ── when this session must not write ──────────────────────────────────────
 *
 * Set when there is something on disk that this build will not replace. Three
 * ways that happens, and all three used to end the same way — the app opened
 * with no chats in it, and the first save wrote that emptiness over a history
 * that was still there:
 *
 *   'newer'   a newer Pigeon wrote the file. This build cannot read it, and
 *             writing over it would delete every conversation the newer one
 *             saved — which is exactly what an older build did.
 *   'unread'  the file is there and could not be READ: a permissions problem,
 *             a lock, a half-synced folder. Rust is careful to report this
 *             differently from "nothing saved yet" (see read_opt in store.rs,
 *             and the test named for it); throwing that distinction away on
 *             the line after it was made is what made an unreadable launch
 *             into a deleted history.
 *   'corrupt' the file was read and is not something this build understands,
 *             AND it could not be moved aside. If it could, it is kept under
 *             its own name and this session saves normally — see loadState.
 *
 * "Not saved" is a state the app already knows how to show, so all three land
 * in the line the rail and Settings already draw.
 */
let held = null;
/** True when there is a file this session must leave exactly as it is. */
export const isReadOnly = () => held !== null;
/** Which of the three, for the sentence the app shows. Null when free to save. */
export const holdReason = () => held;

/**
 * The saved chats, or:
 *   null                            nothing saved, or nowhere to save
 *   { readOnly, why: 'newer' }      a newer Pigeon wrote it
 *   { readOnly, why: 'unread' }     it is there and could not be read
 *   { readOnly, why: 'corrupt' }    unreadable, and it could not be moved aside
 *   { why: 'corrupt', kept }        unreadable, moved aside; `kept` is its new
 *                                   name, and this session saves as normal
 */
export async function loadState () {
  const call = invoke();
  if (!call) return null;
  let raw;
  try { raw = await call('load_state'); }
  catch (e) {
    held = 'unread';
    return { readOnly: true, why: 'unread', detail: String((e && e.message) || e) };
  }
  /* Nothing saved yet — a first launch, or a file that is there and empty.
     Neither has anything to lose, so neither holds the writes. */
  if (typeof raw !== 'string' || !raw.trim()) return null;

  const parsed = parseBlob(raw);
  if (parsed) return parsed;

  const v = blobVersion(raw);
  if (v !== null && v > STATE_VERSION) {
    held = 'newer';
    return { readOnly: true, why: 'newer', version: v };
  }

  /* Read, and not something this build can use: truncated, not a blob, or a
     version with no migration up to this one. Refusing to RENDER it is right,
     and parseBlob says why — but refusing to read it must not also mean
     agreeing to overwrite it. So it is moved aside under a name that says what
     it is, and only then does this session save; a file somebody can still
     hand back is a history that is only mislaid. If it cannot be moved,
     nothing is written at all. */
  try {
    const kept = await call('keep_unreadable_state');
    return { why: 'corrupt', kept };
  } catch {
    held = 'corrupt';
    return { readOnly: true, why: 'corrupt', kept: null };
  }
}

/* Writes are debounced: typing a message changes the state several times in a
   second and the file only needs the last one. Coalescing, not dropping — the
   pending blob is always the newest. */
let timer = null;
let pending = null;
let inFlight = Promise.resolve();
const DELAY_MS = 400;

/** Queue a save. Returns immediately; the write lands within DELAY_MS. */
export function saveState (blob) {
  if (!canPersist() || isReadOnly()) return;
  pending = blob;
  if (timer) return;
  timer = setTimeout(() => { timer = null; write(); }, DELAY_MS);
}

/* ── when the writes themselves are failing ───────────────────────────────
 *
 * Different from `held` above, and deliberately kept apart from it: there is
 * nothing on disk to protect here, the Mac simply will not take the write — a
 * full disk, a data directory that is not ours any more. So this does NOT stop
 * the app trying, because the next write may well succeed and giving up would
 * turn a passing problem into a permanent one.
 *
 * What it does is stop the app LOOKING fine. The old code warned to a console
 * no one has open and reasoned that "the next write will try again", which is
 * true and no comfort when every write fails the same way: the app reads as
 * saved all afternoon and is empty at the next launch. One failure is a blip;
 * two in a row is a Mac that cannot be written to, and the rail says so.
 */
let writeFails = 0;
let onTrouble = null;
/** True once the saves have failed twice running. */
export const saveFailing = () => writeFails >= 2;
/** Called the moment that changes, either way, so the app can redraw and say so. */
export function onSaveTrouble (fn) { onTrouble = fn; }
const troubleChanged = (was) => { if (was !== saveFailing() && onTrouble) onTrouble(saveFailing()); };

/* What each chat's file holds right now, as the string it was written as.
   A save compares and writes only the chats whose text changed: a reaction
   touches one file and the small index, not every conversation ever had. */
const lastSaved = new Map();

function write () {
  const call = invoke();
  const blob = pending;
  pending = null;
  if (!call || !blob) return;
  const chats = Array.isArray(blob.chats) ? blob.chats.filter(c => c && typeof c.id === 'string') : [];
  const ids = chats.map(c => c.id);
  const files = [];
  for (const c of chats) {
    const json = JSON.stringify(c);
    if (lastSaved.get(c.id) === json) continue;
    files.push(call('save_chat', { id: c.id, json }).then(() => { lastSaved.set(c.id, json); }));
  }
  for (const id of [...lastSaved.keys()]) {
    if (ids.includes(id)) continue;
    lastSaved.delete(id);
    files.push(call('remove_chat', { id }).catch(() => {}));
  }
  const { chats: _dropped, ...index } = blob;
  /* The chats first, the index that names them last: an index is never
     written over files that are not there yet. */
  inFlight = Promise.all(files)
    .then(() => call('save_state', { json: JSON.stringify({ ...index, chatIds: ids }) }))
    .then(() => {
      const was = saveFailing();
      writeFails = 0;
      troubleChanged(was);
    })
    /* A failed save must not take the app down with it. The transcript is still
       on screen, and the next write tries again — but the second failure in a
       row stops being a blip and starts being something to say out loud. */
    .catch((e) => {
      console.warn('could not save chats:', e);
      const was = saveFailing();
      writeFails = Math.min(99, writeFails + 1);
      troubleChanged(was);
    });
}

/** Write anything queued, now, and wait for it. Used before a delete, so the
 *  removal cannot be lost to a debounce that never fired. */
export async function flush () {
  if (timer) { clearTimeout(timer); timer = null; write(); }
  await inFlight;
}

/**
 * A chat's name, from its first message. Deterministic on purpose: the desktop
 * app has a second model write a nicer title, and Pigeon has no spare model and
 * no appetite for a generated string it cannot check.
 */
export function titleFrom (text, max = 42) {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!clean) return 'New chat';
  return clean.length <= max ? clean : `${clean.slice(0, max).trimEnd()}…`;
}
