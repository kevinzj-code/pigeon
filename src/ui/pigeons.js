/* pigeons.js — who answers a conversation, and how that is drawn.
 *
 * A chat carries its Pigeon for life, as `lane` and `personaId`; the rest of
 * the app speaks of it as a PICK — 'patch', 'chat' or 'pigeon:<id>' — the same
 * string `settings.lastPick` keeps. The pick 'chat' is the base model, which
 * people meet as Pen; only the name changed, so no saved chat changes meaning.
 *
 * A person picks a contact by what it DOES, so that is what this draws: a
 * does-line ("Turns a short note into a title") and a line of facts the app
 * states itself — whether it works things out or writes, and whether it starts
 * fresh each message or remembers the chat. Kind labels (Verified, Voice, Job,
 * Base weights) described how Pigeon is built, not what a contact is for, and
 * are gone from every surface.
 */

import { esc, ICONS, mark } from './html.js';
import { slotFor } from './time.js';

/* A voice is worn in a conversation; every other kind is a JOB — one input,
   one output. An adapter with no contract at all is a voice, because that is
   what every hand-dropped `.lora.gguf` was before `.pigeon` files existed. */
export const isVoice = (p) => !p || !p.kind || p.kind === 'persona';

export const PEEK_ID = '@peek';
export const isPeek = (c) => Boolean(c) && c.lane === 'B' && c.personaId === PEEK_ID;

export const pickForChat = (c) => (!c || c.lane !== 'B' ? 'patch' : c.personaId === PEEK_ID ? 'peek' : c.personaId ? `pigeon:${c.personaId}` : 'chat');

export function chatFieldsFor (pick) {
  if (!pick || pick === 'patch') return { lane: 'A', personaId: null };
  if (pick === 'chat') return { lane: 'B', personaId: null };
  if (pick === 'peek') return { lane: 'B', personaId: PEEK_ID };
  return { lane: 'B', personaId: String(pick).replace(/^pigeon:/, '') };
}

const PATCH = {
  pick: 'patch', id: null, name: 'Patch', kind: 'verified', works: true, memory: 'fresh', loaded: true,
  takes: ['text'],
  does: 'Works out sums, dates, units, money and look-ups',
  line: 'Every figure comes from a tested function, and says where it came from.'
};
const PEN = {
  pick: 'chat', id: null, name: 'Pen', kind: 'base', works: false, memory: 'remembers', loaded: true,
  takes: ['text'],
  does: 'Writes anything you ask',
  line: 'Pen writes every word itself, and nothing checks it. For figures, ask Patch.'
};
/* Peek is the picture model as it comes — the base every picture Pigeon is
   trained on, with none of them worn — so it writes about a picture the way
   that model would. Whether it can run is the engine's to say
   (`EngineStatus.peek`), set here by `setPeekModel`. */
const PEEK = {
  pick: 'peek', id: null, name: 'Peek', kind: 'peek', works: false, memory: 'remembers', loaded: true, sees: true,
  takes: ['image', 'text'],
  does: 'Looks at a picture and tells you about it',
  line: 'Peek sees the picture itself and answers the way the picture model does — a count or a price included — and nothing checks it. For figures you need exact, ask Patch.'
};
let peekModel;
/** What the engine said about Peek's model: its file name, null when it is
 *  not on this Mac, undefined while nobody has asked (the browser build). */
export function setPeekModel (model) { peekModel = model; }
function peekOf () {
  if (peekModel) return { ...PEEK, model: peekModel };
  return { ...PEEK, loaded: false, unavailable: true,
    line: peekModel === null
      ? 'Peek needs the picture model, which this Mac does not have yet. Download it from Peek’s page.'
      : 'Peek needs the app — this is the browser build.' };
}

/**
 * Patch as his skills stand. With no `patchState` he is exactly PATCH, which is
 * what everything drew before his skills were loaded in a worker. Loading and
 * unavailable keep his kind — his avatar is still his — but he cannot be
 * messaged, and his line says why rather than suggesting a restart.
 */
function patchOf (patchState) {
  if (!patchState || patchState.state === 'ready') {
    const info = (patchState && patchState.info) || {};
    return { ...PATCH, ...(info.version != null ? { version: info.version } : {}), ...(info.source ? { source: info.source } : {}) };
  }
  if (patchState.state === 'unavailable') {
    return { ...PATCH, loaded: false, unavailable: true, line: String(patchState.reason || 'Patch is unavailable.') };
  }
  return { ...PATCH, loaded: false, loading: true, line: 'Patch is getting his skills ready…' };
}

/** Why a greyed row is greyed, in two words. */
export const offLabel = (d) => (d.unavailable ? 'unavailable' : d.loading ? 'loading' : 'not loaded');

/* What an imported Pigeon does: in its maker's words when its card says
   (Flight School writes `card.does`), else said from what the file already
   holds, and never more than that. */
function doesFor (p, kindsKnown) {
  const maker = p.card && typeof p.card.does === 'string' ? p.card.does.trim() : '';
  if (maker) return maker;
  if (typeof p.does === 'string' && p.does.trim()) return p.does.trim();
  if (!kindsKnown) return 'A Pigeon on this Mac';
  if (isVoice(p)) return 'Talks in its own voice';
  if (p.skill) return 'Answers with a drawing';
  if (p.retrieval) return 'Answers from the material it carries';
  if (p.output_type === 'label' && Array.isArray(p.labels) && p.labels.length) return `Answers with one of its ${p.labels.length} labels`;
  return 'Turns one message into one answer';
}

/* What can be PUT IN, as the file declares it (format §2.2). Rust has already
   dropped anything this build cannot honour, so the only work left here is the
   absent case: a Pigeon that was installed before the field existed, and every
   Pigeon in the browser build, takes text. Never empty — a surface that asks
   what a Pigeon takes always gets an answer. */
const takesOf = (p) => (Array.isArray(p?.inputs) && p.inputs.length ? p.inputs.slice() : ['text']);

/** Does the FILE say it can be handed a picture? A separate question from
 *  whether anything in this app can hand it one — its base must see
 *  (`vision`), and `SEES_PICTURES` in app.js must be on. Both have to be true
 *  before a picture is an input rather than a misunderstanding. */
export const declaresImage = (d) => takesOf(d && (Array.isArray(d.takes) ? { inputs: d.takes } : d)).includes('image');

/**
 * What a pick is. `kindsKnown` is false in the browser build, where adapters
 * are read off the server with no contract: there, whether a Pigeon remembers
 * would be a guess, so it is not claimed. `patchState` is app.js's
 * `{ state, reason?, info? }`.
 */
export function pigeonOf (pick, personas = [], patchState) {
  if (!pick || pick === 'patch') return patchOf(patchState);
  if (pick === 'chat') return { ...PEN };
  if (pick === 'peek') return peekOf();
  const id = String(pick).replace(/^pigeon:/, '');
  const p = (personas || []).find(x => x.id === id);
  if (!p) {
    return { pick: `pigeon:${id}`, id, name: id, kind: 'missing', works: false, memory: null, loaded: false, missing: true,
      does: 'Not on this Mac any more', takes: ['text'],
      line: 'This Pigeon is not on this Mac any more, so nothing can answer here.' };
  }
  const kindsKnown = (personas || []).some(x => x.kind);
  const voice = isVoice(p);
  return {
    pick: `pigeon:${p.id}`, id: p.id, name: p.name,
    kind: !kindsKnown || voice ? 'voice' : 'job',
    works: false,
    /* It is handed the picture itself: its file asks for one AND Rust says its
       base can see. Anything else is handed the words read off a picture. */
    sees: takesOf(p).includes('image') && Boolean(p.vision) && !isVoice(p),
    /* A voice remembers what its measured shape says (lanebbench --shape): A
       keeps the chat, B starts fresh, and one nobody measured is said to be
       unmeasured rather than assumed either way. */
    memory: !kindsKnown ? null : !voice ? 'fresh' : p.shape === 'B' ? 'fresh' : p.shape === 'A' ? 'remembers' : 'unmeasured',
    does: doesFor(p, kindsKnown),
    takes: takesOf(p),
    loaded: p.loaded !== false,
    bytes: Number.isFinite(p.bytes) ? p.bytes : null,
    icon: isIcon(p.icon) ? p.icon : null,
    /* D83: no training of its own — the page says so where a person looks. */
    baseOnly: Boolean(p.base_only),
    line: p.base_only
      ? 'Its maker’s instructions for a model on this Mac, with no training of its own. It writes the words; nothing here is computed.'
      : !kindsKnown || voice
      ? 'A trained Pigeon. It writes the words; nothing here is computed.'
      : p.skill
        ? `It answers with a recipe, and the ${p.skill} skill draws it. Nothing here is computed.`
        : p.retrieval
          ? 'It answers from the material it carries, and shows the sections it was given. Nothing here is computed.'
          : `A ${p.kind}: one input in, one output back. Nothing here is computed.`
  };
}

/** The facts the app states about a contact: "Works it out · starts fresh",
 *  "Writes · remembers the chat". Never the maker's words. */
export const factLine = (d) => (!d || d.kind === 'missing'
  ? ''
  : [d.works ? 'Works it out' : 'Writes', d.sees ? 'sees pictures' : null, d.memory === 'fresh' ? 'starts fresh' : d.memory === 'remembers' ? 'remembers the chat' : null]
    .filter(Boolean).join(' · '));

/**
 * What a picture IS to this contact, in one sentence — the same words on the
 * composer's picture button, the chip, the details panel and the contact's
 * page, so there is one answer wherever somebody wonders. Two cases and no
 * third: a contact that sees is handed the pixels; everyone else is handed the
 * words this Mac reads off them, and never the picture.
 */
export function pictureLine (d) {
  if (d && d.sees) return `${d.name} sees the picture itself — what is in it, not only the words on it.`;
  const who = d && d.name ? d.name : 'This Pigeon';
  return `${who} reads text only. A picture is turned into the words written on it, read on this Mac, and you check them before they go. What the picture shows is never sent.`;
}
export const factPill = (d) => { const f = factLine(d); return f ? `<span class="fact-line">${esc(f)}</span>` : ''; };
/* The name an older surface still calls. It draws the fact line — never a kind. */
export const kindPill = factPill;

/** The Pigeons that come with the app, in the order they are pinned: Patch,
 *  Pen, then Peek once an engine has said whether its model is here (greyed,
 *  with what it needs, when it is not; absent in the browser build, where
 *  nothing could ever run it). */
export function builtInPigeons (personas = [], patchState) {
  return [pigeonOf('patch', personas, patchState), pigeonOf('chat'), ...(peekModel === undefined ? [] : [pigeonOf('peek')])];
}

/** Can this contact be messaged? Patch only once his skills are ready. A Pigeon
 *  that is installed but not loaded yet can: sending to it loads it. One that
 *  has been removed cannot. */
export const canMessage = (d) => Boolean(d) && (d.kind === 'verified' || d.kind === 'peek' ? d.loaded : d.kind !== 'missing');

/**
 * What a turn of `pigeon_run` adds to the turn a chat stores. A grounded run
 * keeps the sections it was shown by title, and the one the answer came from
 * (`main`) whole — its text, the sentence marked in it, and the file it was
 * cut from — which is what the underline opens. Only that one: a manual is
 * not copied into every turn.
 */
export function jobFields (out = {}) {
  const f = {};
  if (out.no_material) f.noMaterial = true;
  const sections = Array.isArray(out.sections) ? out.sections : [];
  if (sections.length) {
    const main = Number.isInteger(out.main) && sections.some(s => Number(s.ordinal) === out.main) ? out.main : null;
    /* `support` is where in the text the answer came from, as [start, end)
       in UTF-16 units — the sentence sharing the most words with it. `also`
       is a second one, when the answer joins two clauses. */
    const pair = (p) => Array.isArray(p) && p.length === 2 && Number.isInteger(p[0]) && Number.isInteger(p[1]) && p[0] < p[1];
    const span = (s) => pair(s.support)
      ? { support: [s.support[0], s.support[1]], ...(pair(s.also) ? { also: [s.also[0], s.also[1]] } : {}) } : {};
    f.sections = sections.map(s => ({
      ordinal: Number(s.ordinal),
      title: String(s.title || ''),
      ...(Number(s.ordinal) === main ? { text: String(s.text || ''), file: String(s.file || ''), ...span(s) } : {})
    }));
    if (main !== null) f.main = main;
  }
  if (Array.isArray(out.unsupported_citations) && out.unsupported_citations.length) {
    f.unsupportedCitations = out.unsupported_citations.map(Number);
  }
  if (typeof out.rendered === 'string' && out.rendered) f.rendered = out.rendered;
  if (out.render_error) f.renderError = String(out.render_error);
  if (out.matched_label === false) f.unmatchedLabel = true;
  return f;
}

const byName = (list) => [...list].sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));

/**
 * Everyone who can be messaged, the way To: lists them. With nothing typed:
 * Patch on his own above a rule, then Recent (the Pigeons of your latest
 * chats, at most three), then everyone else A–Z. Patch is pinned rather than
 * alphabetised because he is not one of the Pigeons you added — he came with
 * the app, and a new message is his unless you say otherwise. With a name
 * typed he is a match like any other, since by then you are looking for a
 * name and not for the default. The first nine rows on show that can be
 * messaged get a number key, but only while nothing is typed — once a letter
 * is in the field, a digit is just text.
 */
export function pigeonList (personas = [], { q = '', recent = [], patchState } = {}) {
  const patch = pigeonOf('patch', personas, patchState);
  const rest = [...(personas || []).map(p => pigeonOf(`pigeon:${p.id}`, personas)), ...builtInPigeons(personas).slice(1)];
  const needle = String(q || '').trim().toLowerCase();
  let sections;
  if (needle) {
    sections = [{ label: 'Matches', items: byName([patch, ...rest].filter(d => d.name.toLowerCase().includes(needle))) }];
  } else {
    /* Recent is drawn from `rest` alone, so a run of chats with Patch never
       pushes a second Patch row under the pinned one. */
    const byPick = new Map(rest.map(d => [d.pick, d]));
    sections = [
      { label: '', pinned: true, items: [patch] },
      { label: 'Recent', items: (recent || []).map(p => byPick.get(p)).filter(Boolean).slice(0, 3) },
      { label: 'Everyone else', items: byName(rest) }
    ];
  }
  sections = sections.filter(s => s.items.length).map(s => ({ ...s, items: s.items.map(d => ({ ...d })) }));
  let n = 0;
  for (const s of sections) for (const d of s.items) d.key = !needle && canMessage(d) && n < 9 ? ++n : null;
  return { sections, flat: sections.flatMap(s => s.items) };
}

/* A Pigeon's own icon, as Rust sends it: a base64 PNG and nothing else. The
   shape is checked here too, because the value goes into an attribute — an
   svg or javascript: URL, or anything with a quote in it, gets initials. */
const ICON_URL = /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/;
const isIcon = (v) => typeof v === 'string' && ICON_URL.test(v);

function initials (name) {
  const words = String(name || '?').trim().split(/[\s_-]+/).filter(Boolean);
  if (words.length > 1) return (words[0][0] + words[1][0]).toUpperCase();
  const w = words[0] || '?';
  return (w[0].toUpperCase() + (w[1] || '')).slice(0, 2);
}

/**
 * The avatar. Patch is the app's one illustrated character, so his is his own
 * drawing on the ink square; Pen writes, so Pen is a pen on the warm ground; an
 * imported Pigeon wears the icon it was packed with, or its initials.
 */
/* The app icon, served beside the page (assets/app-icon.png). */
export const PATCH_ICON = '<img class="appicon" alt="" src="assets/app-icon.png">';

export function avatarHtml (d, size = 40, { id = '' } = {}) {
  const s = `style="--s:${size}px"`;
  const idAttr = id ? ` id="${esc(id)}"` : '';
  if (!d) return `<span class="av av-new" ${s}${idAttr}>${ICONS.bubble}</span>`;
  /* Patch wears the app's own icon: he is the one Pigeon that comes with it. */
  if (d.kind === 'verified') return `<span class="av av-patch av-appicon" ${s}${idAttr} title="Patch">${PATCH_ICON}</span>`;
  if (d.kind === 'base') return `<span class="av av-base" ${s}${idAttr} title="Pen">${ICONS.pencil}</span>`;
  if (d.kind === 'peek') return `<span class="av av-peek" ${s}${idAttr} title="Peek">${ICONS.eye}</span>`;
  if ((d.kind === 'job' || d.kind === 'voice') && isIcon(d.icon)) {
    return `<span class="av av-img" ${s}${idAttr} title="${esc(d.name)}"><img alt="" src="${d.icon}"></span>`;
  }
  if (d.kind === 'job') return `<span class="av av-job" ${s}${idAttr}>${esc(initials(d.name).toLowerCase())}</span>`;
  if (d.kind === 'missing') return `<span class="av av-missing" ${s}${idAttr}>?</span>`;
  return `<span class="av av-voice" ${s}${idAttr}>${esc(initials(d.name))}</span>`;
}

/**
 * The list under To:, as you type. `hi` is the highlighted row, moved by the
 * arrow keys and clamped here. `counts` and `lastAt` say how many chats you
 * already have with each and when the latest was, so starting another is a
 * visible choice. `suggest` puts "Patch can work this out" first, when what was
 * written before choosing matched one of his skills. Returns the rows it drew
 * so the keys act on the same list.
 */
export function toListHtml ({ personas = [], q = '', hi = 0, counts = {}, lastAt = {}, recent = [], suggest = false, patchState, now = Date.now() } = {}) {
  let { sections, flat } = pigeonList(personas, { q, recent, patchState });
  const needle = String(q || '').trim().toLowerCase();
  const patchRow = pigeonOf('patch', personas, patchState);
  const suggested = suggest && !needle && canMessage(patchRow) ? { ...patchRow, key: null, suggested: true } : null;
  /* The Suggested row IS Patch, under a better heading, so the pin below it
     would be the same contact twice in a row. The suggestion stands in for
     the pin while it is up; it keeps his number key, since the keys are how
     the list is worked without the mouse. */
  if (suggested) {
    const pinned = sections.find(s => s.pinned);
    if (pinned) {
      suggested.key = pinned.items[0].key;
      sections = sections.filter(s => s !== pinned);
      flat = flat.filter(d => d.pick !== 'patch');
    }
  }
  const rows = suggested ? [suggested, ...flat] : flat;
  const at = Math.max(0, Math.min(hi, rows.length - 1));
  let i = -1;
  const row = (d) => {
    i += 1;
    const off = !canMessage(d);
    const n = counts[d.pick] || 0;
    const meta = off ? offLabel(d) : n ? `${n} chat${n === 1 ? '' : 's'}${lastAt[d.pick] ? ` · ${slotFor(lastAt[d.pick], now)}` : ''}` : '';
    return `<button class="sg${off ? ' off' : ''}${d.suggested ? ' sugg' : ''}" role="option" id="sg-${i}" data-to="${esc(d.pick)}" aria-selected="${i === at}"${off ? ' aria-disabled="true"' : ''}>${avatarHtml(d, 32)}
      <span class="sg-txt"><b>${d.suggested ? 'Patch can work this out' : mark(d.name, needle)}</b><small>${esc(d.suggested ? 'from the words you wrote' : d.does)}</small>${d.suggested || !factLine(d) ? '' : `<small class="sg-fact">${esc(factLine(d))}</small>`}</span>
      <span class="sg-meta">${esc(meta)}</span><span class="sg-key">${d.key || ''}</span></button>`;
  };
  let html = suggested ? `<div class="sg-label">Suggested</div>${row(suggested)}` : '';
  /* The pinned section wears no label: a header over one row would read as a
     category, and Patch being above the rule is the whole statement. */
  html += sections.map(s => (s.pinned
    ? `${s.items.map(row).join('')}<div class="sg-rule"></div>`
    : `<div class="sg-label">${esc(s.label)}</div>${s.items.map(row).join('')}`)).join('');
  if (!flat.length) html += `<div class="sg-none">No Pigeon called “${esc(String(q).trim())}” on this Mac.</div>`;
  html += '<div class="sg-rule"></div><button class="sg sg-import" data-do="import-pigeon">Add a Pigeon…</button>';
  html += '<div class="sg-hint">↑↓ to choose · Enter · 1–9 when empty</div>';
  return { html, flat: rows, hi: at };
}



/**
 * What a key does to the To: list — the same in the window, the menu-bar
 * popover and the summon bar, so the hint under the list is true in all
 * three. `rows` is `flat` from toListHtml, `hi` the highlighted index.
 * Returns null for a key the list does not take.
 *   { move: n }     highlight row n
 *   { pick }        that row's pick
 *   { escape }      Escape
 */
export function pickerKey (e, rows, hi) {
  if (e.metaKey || e.ctrlKey || e.altKey) return null;
  const n = rows.length;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    return { move: n ? (hi + (e.key === 'ArrowDown' ? 1 : n - 1)) % n : 0 };
  }
  if (e.key === 'Enter') {
    const d = rows[hi];
    return d ? { pick: d.pick } : null;
  }
  if (/^[1-9]$/.test(e.key)) {
    const d = rows.find(x => x.key === Number(e.key));
    return d ? { pick: d.pick } : null;
  }
  if (e.key === 'Escape') return { escape: true };
  return null;
}
