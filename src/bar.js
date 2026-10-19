/* bar.js — the summon bar's page, and the third (and last) file that touches
 * a DOM. app.js draws the window, popover.js the menu bar's, this the bar that
 * ⌘⇧P brings up from anywhere (src-tauri/src/bar.rs).
 *
 * It opens on Patch, every time, and that is not a setting (§5.7): a surface
 * reached for in one second opens on the one whose answers can be checked.
 * WHO answers is still yours to change for the question you are asking — the
 * first bubble is whoever that is, and pressing it lists the same cast the
 * window and the menu bar offer, from the same descriptors. Anything that is
 * not Patch WRITES rather than computes, and its reply says so before a word
 * of it is read, exactly as the other two windows do. That makes this the
 * third file allowed to reach the chat lane (src/lint-imports.js).
 *
 * What it keeps from the other two windows is everything that makes an answer
 * worth having:
 *
 *   · the same pipeline (runTurn over the same registry, router, extractor and
 *     planner), so a figure here is the figure the window would give;
 *   · the same mark under the reply — Worked out, Looked up, Couldn't — read
 *     off the turn by the same code (src/ui/marks.js);
 *   · the same honesty about what is awake: the models' state is on the bar at
 *     all times, and a wake is counted down, never hidden (§2.3);
 *   · no second writer of the chats file: a finished exchange is handed to the
 *     window to file, exactly as the popover hands its own over.
 *
 * It looks like Spotlight because it is used like Spotlight: one pill that
 * says Ask Patch, and — when the pointer comes near — three bubbles that part
 * from its end: Patch's icon (open the window), add an image, read the screen.
 * The last two attach a READING: tesseract's text, in a chip, waiting for the
 * question typed next. The picture is never kept (§5.8). This page only says
 * "open" or "shut"; the glass itself is moved by bar.rs.
 *
 * No web from here. The switch and its per-request consent live in the window.
 */

import { loadPatch, patchSource } from './patch-pack.js';
import { LexicalRouter } from './router.js';
import { jsExtractor } from './extractor.js';
import { deviceCtx } from './ctx.js';
import { runTurn, MODES } from './turn.js';
import { segmentsHtml } from './segments.js';
import { buildPlanner, buildCategoryRouter } from './stack.js';
import { engineBridge, wakeCategory } from './engine.js';
import { pigeonOf, toListHtml, avatarHtml, canMessage, jobFields, pickerKey, setPeekModel } from './ui/pigeons.js';
import { pictureOf } from './ui/picture.js';
import { runChat, runPlain } from './lane-b/chat.js';
import { chatBridge } from './lane-b/bridge.js';
import { HANDOFF_OFFER } from './lane-b/handoff.js';
import { markFor, markLabel, humanise, copyText, receiptLine, badgeFor, MARKS } from './ui/marks.js';
import { logTurn } from './log.js';
import { esc } from './ui/html.js';
import { canPlay, quickPlay, isPlaying } from './ui/play.js';
import { wakeEta } from './ui/status.js';
import { detectOcr, capAttached, composeMessage, wordCount } from './ocr.js';

const $ = (id) => document.getElementById(id);
const invoker = () => globalThis.__TAURI__?.core?.invoke ?? null;

/* ── what Pigeon is holding, in as few words as will be true ────────────── */

/** The bar's state line. The popover's says more; this has a third the room. */
export function barState (status, wakeMs = null, now = Date.now()) {
  if (!status) return { text: 'quick answers', tone: '' };
  if (status.disabled) return { text: 'models off · quick answers', tone: '' };
  const roles = [status.category].filter(Boolean);
  const waking = roles.filter(r => r.phase === 'waking');
  if (waking.length) {
    const ms = Math.max(...waking.map(r => r.waking_ms || 0));
    return { text: `waking · ${wakeEta(wakeMs, now - ms, now)}`, tone: 'waking' };
  }
  if (roles.some(r => r.phase === 'ready')) return { text: 'models awake', tone: 'awake' };
  if (roles.some(r => r.phase === 'error')) return { text: 'models would not wake · quick answers', tone: 'busted' };
  return { text: 'models asleep · quick answers', tone: '' };
}

/** The line under an answer: the window's mark, and which skill earned it. */
export { receiptLine };

/* ── state ──────────────────────────────────────────────────────────────── */

let registry = null;
let extractor = null;
let router = null;
let patchState = { state: 'loading' };
let packOptions = {};
let planner = null, focus = null, secondLook = null;
let engine = null, engineStatus = null;
let lastWakeMs = null;
let busy = false;
/* A question of Patch's that is waiting on its answer: the next thing typed
   answers it rather than starting again. Escape lets go of it. */
let pending = null;
/* Asked again by itself once the models are up, when the person chose to wake
   them for a question the router alone could not place. */
let retryOnceAwake = null;
/* What an image or the screen was read as, waiting to go with the next
   question. The TEXT only. */
let shot = null;
let ocr = null;
/* Patch until someone says otherwise, every time the bar comes up (§5.7). */
let pick = 'patch';
let personas = [];
let chat = null;
let picking = false;
/* The picker's rows and highlight while it is open, for the arrow keys. */
let pickRows = [];
let pickHi = 0;
const who = () => pigeonOf(pick, personas, patchState);

function paintWho () {
  const d = who();
  $('bubPatch').innerHTML = avatarHtml(d, 40);
  $('bubPatch').title = `To: ${d.name} — choose who answers`;
  $('bubPatch').setAttribute('aria-label', `To: ${d.name}. Choose who answers`);
  if (!pending) $('ask').placeholder = d.kind === 'peek' ? 'Ask Peek, or add a picture — it sees it' : `Ask ${d.name}`;
  const img = d.sees ? `Add a picture — ${d.name} sees the picture itself` : 'Add an image — only its text is kept';
  $('bubImage').title = img;
  $('bubImage').setAttribute('aria-label', img);
  /* The screenshot goes the same way: as a picture to one that sees. */
  const shotWords = d.sees ? `Show ${d.name} part of your screen` : 'Read the text on your screen';
  $('bubShot').title = shotWords;
  $('bubShot').setAttribute('aria-label', d.sees ? `Show ${d.name} part of the screen` : 'Read the screen');
  paintPlay();
}

/* ── Play, the fourth bubble ─────────────────────────────────────────────
   Beside the picture and the screenshot whenever the Pigeon picked can play,
   and while any Pigeon plays (as Stop). The bar gives up one more bubble's
   width for it: bar.html reads --n, and bar.rs is told the count. */
let playStatus = null;
let bubbleCount = 3;
const pickedPersona = () => personas.find(p => `pigeon:${p.id}` === pick) || null;
const PLAY_SVG = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8.5 5.8v12.4a.8.8 0 0 0 1.2.7l9.6-6.2a.8.8 0 0 0 0-1.4L9.7 5.1a.8.8 0 0 0-1.2.7z"/></svg>';
const STOP_SVG = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6.5" y="6.5" width="11" height="11" rx="2.5"/></svg>';
function paintPlay () {
  const btn = $('bubPlay');
  if (!btn) return;
  const p = pickedPersona();
  const live = isPlaying(playStatus);
  const shown = canPlay(p) || live;
  btn.hidden = !shown;
  btn.classList.toggle('playing', live);
  btn.innerHTML = live ? STOP_SVG : PLAY_SVG;
  const label = live ? `Stop ${playStatus.name || 'the play'} (⌘⇧.)` : shown ? `Play a game with ${p.name}` : 'Play';
  btn.title = label;
  btn.setAttribute('aria-label', label);
  const count = shown ? 4 : 3;
  if (count === bubbleCount) return;
  bubbleCount = count;
  document.body.style.setProperty('--n', String(count));
  const invoke = invoker();
  if (invoke) invoke('bar_bubbles', { open: document.body.classList.contains('open'), count }).catch(() => {});
}

/* ── the bar's own size ─────────────────────────────────────────────────
   The page says how tall the glass is; bar.rs clamps it and owns the rest. */
function fit () {
  const glass = $('glass');
  const out = $('out');
  const acts = $('acts');
  const row = glass.querySelector('.row');
  /* What the content wants, not what the window currently gives it. */
  out.style.maxHeight = '';
  const chip = $('chip');
  const want = row.offsetHeight + (chip.hidden ? 0 : chip.offsetHeight + 10) + (out.hidden ? 0 : out.scrollHeight + 1) + (acts.hidden ? 0 : acts.offsetHeight);
  const invoke = invoker();
  if (invoke) invoke('bar_fit', { height: want }).catch(() => {});
  else {
    /* A browser tab has no window to size, so the glass sizes itself. */
    glass.style.bottom = 'auto';
    glass.style.height = `${Math.min(520, Math.max(64, want))}px`;
  }
}

function show (html, actions = '') {
  const out = $('out');
  const acts = $('acts');
  out.hidden = !html;
  out.innerHTML = html || '';
  acts.hidden = !html;
  acts.innerHTML = html ? `${actions}<span class="keys">⌘↩ open Pigeon · esc ${pending ? 'let go' : 'clear'}</span>` : '';
  /* Replaying the unfold on every answer, not only the first. */
  if (html) { out.style.animation = 'none'; void out.offsetHeight; out.style.animation = ''; }
  fit();
}

const clear = () => show('');

function paintState () {
  const { text, tone } = barState(engineStatus, lastWakeMs);
  $('state').className = `state ${tone}`;
  $('stateText').textContent = engine ? text : 'opened in a browser · quick answers';
}

/* ── one question ───────────────────────────────────────────────────────── */

function paintAnswer (turn, asked) {
  if (turn.ask) {
    $('ask').placeholder = 'Your answer…';
    show(`<div class="answer">${esc(turn.ask.question)}<span class="prov">${esc(markLabel(MARKS.WAITING))} · ${esc(humanise(turn.ask.skill))}</span></div>`);
    return;
  }
  $('ask').placeholder = `Ask ${who().name}`;
  if (turn.mode === MODES.NO_SKILL || !turn.reply || markFor(turn) === MARKS.COULDNT) {
    const failed = ((turn.reply && turn.reply.segments) || []).some(s => s && s.type === 'failure');
    const body = failed
      ? segmentsHtml(turn.reply.segments, { esc, turnId: '' })
      : `Patch has no skill for that${planner ? '' : ', and no model is awake to look harder'}.`;
    const canWake = !planner && engine && !(engineStatus && engineStatus.disabled);
    show(`<div class="answer quiet">${body}<span class="prov">${esc(markLabel(MARKS.COULDNT))}${planner ? '' : ' · models asleep'}</span></div>`,
      `${canWake ? '<button class="act" data-do="wake-ask">Wake the models and ask again</button>' : ''}
       <button class="act" data-do="open-draft">Ask in Pigeon <kbd>⌘↩</kbd></button>`);
    retryOnceAwake = null;
    lastAsked = asked;
    return;
  }
  show(`<div class="answer">${segmentsHtml(turn.reply.segments, { esc, turnId: '' })}<span class="prov">${esc(receiptLine(turn))}</span></div>`,
    '<button class="act" data-do="copy">Copy</button>');
  lastTurn = turn;
}

let lastTurn = null;
let lastAsked = '';

function paintChip () {
  const chip = $('chip');
  chip.hidden = !shot;
  if (shot && shot.picture) {
    chip.innerHTML = `${shot.thumb ? `<img class="chip-thumb" src="${shot.thumb}" alt="">` : ''}<b>${esc(shot.name)}</b><span>Peek sees this picture — nothing is read off it</span>
      <button id="chipDrop" aria-label="Remove this picture" title="Remove this picture">×</button>`;
    $('chipDrop').onclick = () => { shot = null; paintChip(); $('ask').focus({ preventScroll: true }); };
  } else if (shot) {
    const { truncated } = capAttached(shot.text);
    chip.innerHTML = `<b>${esc(shot.name)}</b><span>${wordCount(shot.text)} words · read by ${esc(shot.engine)}${truncated ? ' · capped' : ''}</span>
      <span class="raw">raw — no model</span><button id="chipDrop" aria-label="Remove this reading" title="Remove this reading">×</button>`;
    $('chipDrop').onclick = () => { shot = null; paintChip(); $('ask').focus({ preventScroll: true }); };
  }
  fit();
}

async function ask (message) {
  const typed = String(message || '').trim();
  const d = who();
  /* Peek is handed the picture itself; its words are only what was typed. */
  if (d.kind === 'peek') { if (!busy && (typed || (shot && shot.picture))) { picking = false; await askPeek(typed, d); } return; }
  /* A reading goes WITH the question, composed and capped as the window does it. */
  const text = composeMessage(typed, shot && !shot.picture ? capAttached(shot.text).text : '');
  if ((!text && !(shot && shot.picture && d.sees)) || busy) return;
  picking = false;
  if (d.kind !== 'verified') { await askPigeon(typed, text, d); return; }
  /* Patch answers only once his skills have loaded. Refused before anything is
     spent, so the question stays in the box for when he is ready. */
  if (patchState.state !== 'ready') {
    show(`<div class="answer quiet"><span class="fail"><span class="code">NOT READY</span>${
      esc(patchState.state === 'loading' ? 'Patch is still getting his skills out. A moment.' : (patchState.reason || 'Patch is unavailable.'))}</span></div>`);
    return;
  }
  busy = true;
  lastTurn = null;
  const answering = pending;
  pending = null;
  /* Taken, so the box empties now and not before. */
  $('ask').value = '';
  const image = shot ? { name: shot.name, engine: shot.engine, used: 'raw', text: capAttached(shot.text).text, typed, truncated: capAttached(shot.text).truncated } : null;
  if (shot) { shot = null; paintChip(); }
  show('<div class="answer quiet">…<span class="prov">finding the right skill</span></div>');
  let turn = null;
  try {
    turn = await runTurn(text, {
      ...packOptions.turnOptions,
      registry, router, ctx: deviceCtx(), planner, extractor, focus, secondLook,
      pending: answering,
      /* No web from here: being asked whether something may leave the Mac
         belongs to the window, not to a bar that is gone in a second. */
      assembler: null,
      /* The real steps, as they happen — there is no stream of words to show,
         because no model writes the reply (turn.js says why at length). */
      onStage: (name) => {
        const prov = $('out').querySelector('.prov');
        const said = { routing: 'finding the right skill', planning: 'working out a plan', deciding: 'choosing between two skills', running: 'working it out' }[name];
        if (prov && said) prov.textContent = said;
      }
    });
    if (turn.ask) pending = turn;
    paintAnswer(turn, text);
    /* A question waiting on its answer is not an exchange yet. */
    if (turn.ask) logTurn(turn, { receipt: receiptLine(turn) });
    if (!turn.ask) tellWindow(turn.message || text, turn, image);
  } catch (e) {
    show(`<div class="answer quiet"><span class="fail"><span class="code">FAILED</span>${esc(String((e && e.message) || e))}</span></div>`);
  }
  busy = false;
}

/* One question to a Pigeon that writes. A voice or Pen goes through runChat, a
   job through pigeon_run — the same two paths, guard and badge as the window
   and the popover, not smaller copies of them. */
async function askPigeon (typed, text, d) {
  if (!d.loaded) {
    show(`<div class="answer quiet">${esc(d.name)} is ready once Pigeon restarts its models, and that happens in the window.</div>`,
      '<button class="act" data-do="open-draft">Open in Pigeon <kbd>⌘↩</kbd></button>');
    lastAsked = typed;
    return;
  }
  busy = true;
  lastTurn = null;
  $('ask').value = '';
  /* A picture Pigeon is handed the picture itself, as in the window; anyone
     else gets the words read off it. */
  const picture = shot && shot.picture ? shot : null;
  const image = picture
    ? { name: picture.name, picture: true, thumb: picture.thumb, width: picture.width, height: picture.height, typed }
    : shot ? { name: shot.name, engine: shot.engine, used: 'raw', text: capAttached(shot.text).text, typed, truncated: capAttached(shot.text).truncated } : null;
  if (shot) { shot = null; paintChip(); }
  try {
    if (!chat) {
      show('<div class="answer quiet">…<span class="prov">waking the models</span></div>');
      const down = await wakeCategory(engine, { isUp: () => Boolean(chat), apply: applyStatusRef, current: () => engineStatus });
      if (down) { show(`<div class="answer quiet">${esc(down)}</div>`); busy = false; return; }
    }
    show(`<div class="answer quiet">…<span class="prov">${esc(d.name)} is writing</span></div>`);
    const persona = personas.find(p => p.id === d.id) || null;
    const turn = d.kind === 'job' ? await runJob(text, persona, picture ? picture.url : null) : await runChat(text, { complete: chat, persona });
    if (!turn.reply) show(`<div class="answer quiet">${esc(turn.error || 'nothing came back')}</div>`);
    else {
      const filed = { ...turn, lane: 'B', mode: 'generated', persona: d.id || null };
      show(`<div class="answer"><span class="prov gen-badge">${esc(badgeFor(filed, d.name))}</span>${esc(copyText(filed))}${
        turn.unmatchedLabel ? `<span class="prov">not one of ${esc(d.name)}’s own labels</span>` : ''}</div>`,
      `<button class="act" data-do="copy">Copy</button>${turn.offer ? `<button class="act" data-do="hand">${esc(HANDOFF_OFFER)} →</button>` : ''}`);
      lastTurn = filed;
      lastAsked = typed;
      tellWindow(text, filed, image, d.pick);
    }
  } catch (e) {
    show(`<div class="answer quiet"><span class="fail"><span class="code">FAILED</span>${esc(String((e && e.message) || e))}</span></div>`);
  }
  busy = false;
}
let applyStatusRef = async () => {};

/* One question to Peek: the picture model as it comes, the way the window's
   sayToPeek and the popover's askPeek ask it — no instruction of ours and no
   guard on figures, the picture as pixels. The window files the exchange. */
async function askPeek (typed, d) {
  if (!d.loaded) {
    show(`<div class="answer quiet">${esc(d.line)}</div>`, '<button class="act" data-do="open-draft">Open in Pigeon <kbd>⌘↩</kbd></button>');
    lastAsked = typed;
    return;
  }
  busy = true;
  lastTurn = null;
  $('ask').value = '';
  const picture = shot && shot.picture ? shot : null;
  const said = shot && !shot.picture ? composeMessage(typed, capAttached(shot.text).text) : typed;
  if (shot) { shot = null; paintChip(); }
  const image = picture ? { name: picture.name, picture: true, thumb: picture.thumb, width: picture.width, height: picture.height, typed } : null;
  show(`<div class="answer quiet">…<span class="prov">Peek is ${picture ? 'looking — the first picture starts the picture model' : 'writing'}</span></div>`);
  try {
    const bridge = chatBridge();
    const complete = bridge && bridge.transport === 'rust command' ? (a) => bridge({ ...a, peek: true, image: picture ? picture.url : null }) : null;
    const asked = said || 'What is in this picture?';
    const turn = await runPlain(asked, { complete });
    if (!turn.reply) show(`<div class="answer quiet">${esc(turn.error || 'nothing came back')}</div>`);
    else {
      const filed = { ...turn, message: said, ...(asked !== said ? { asked } : {}) };
      show(`<div class="answer"><span class="prov gen-badge">${esc(markLabel(MARKS.WRITTEN, { name: d.name }))}</span>${esc(turn.reply.text)}</div>`,
        '<button class="act" data-do="copy">Copy</button>');
      lastTurn = filed;
      lastAsked = typed;
      tellWindow(said, filed, image, 'peek');
    }
  } catch (e) {
    show(`<div class="answer quiet"><span class="fail"><span class="code">FAILED</span>${esc(String((e && e.message) || e))}</span></div>`);
  }
  busy = false;
}

async function runJob (text, persona, image = null) {
  const invoke = invoker();
  if (!invoke || !persona) return { reply: null, error: 'running a trained Pigeon needs the app, not a browser tab' };
  try {
    const out = await invoke('pigeon_run', { req: { pigeon: persona.id, text, ...(image ? { image } : {}) } });
    const said = String((out && out.text) || '').trim();
    const f = jobFields(out || {});
    if (f.noMaterial) return { reply: { text: `Nothing in ${persona.name}’s material covers that, so it was not asked.` }, ms: 0, ...f };
    if (f.renderError) return { reply: null, error: f.renderError, ms: out.ms };
    /* Everything the window draws a job's answer with — the section it was
       found in, the drawing, the labels — goes with it when it is filed. */
    return said ? { reply: { text: said }, ms: out.ms, tokens: out.tokens, finishReason: out.finish_reason, ...f, unmatchedLabel: f.unmatchedLabel === true } : { reply: null, error: `${persona.name} returned nothing`, ms: out && out.ms };
  } catch (e) { return { reply: null, error: String((e && e.message) || e) }; }
}

/* What was asked and what came back, handed to the main window to file under
   the same event the popover uses. This page never writes the chats file. */
function tellWindow (message, turn, image = null, pickUsed = 'patch') {
  logTurn({ ...turn, message: turn.message || message }, { pigeon: pickUsed, receipt: receiptLine(turn), reply: copyText(turn) });
  const ev = globalThis.__TAURI__?.event;
  if (!ev) return;
  let payload;
  try { payload = JSON.parse(JSON.stringify({ message, turn, pick: pickUsed, image, at: Date.now() })); } catch { return; }
  const send = typeof ev.emitTo === 'function' ? ev.emitTo('main', 'menubar-exchange', payload) : ev.emit('menubar-exchange', payload);
  Promise.resolve(send).catch(() => {});
}

/* ── wiring ───────────────────────────────────────────────────────────────
   All of it inside `start`, which only runs where there is a document: the
   suite imports this file for barState and receiptLine. */

function start () {
  const box = $('ask');
  const native = Boolean(invoker());
  document.documentElement.classList.toggle('native', native);


  /* Up: the bar settles, the bubbles are shut until the pointer comes near,
     the caret is in the box and whatever was left in it is selected. */
  function arrive () {
    document.body.classList.remove('out');
    document.body.classList.remove('up');
    void document.body.offsetHeight;
    document.body.classList.add('up');
    box.focus({ preventScroll: true });
    box.select();
    /* Patch again, whoever answered last time (§5.7). */
    pick = 'patch';
    picking = false;
    paintWho();
    bubbles(false);
    fit();
  }

  /* Away. The page fades first because a window that vanishes mid-frame looks
     like a crash; bar.rs does the hiding, and a lost focus hides it without
     asking this page at all. */
  function leave () {
    const invoke = invoker();
    if (!invoke) return;
    document.body.classList.add('out');
    setTimeout(() => {
      invoke('bar_hide').catch(() => {});
      document.body.classList.remove('up', 'out');
    }, 120);
  }

  function openWindow (draft = '') {
    const invoke = invoker();
    if (!invoke) return;
    const ev = globalThis.__TAURI__?.event;
    const payload = { action: 'open', pick, ...(draft ? { draft } : {}) };
    if (ev) Promise.resolve(typeof ev.emitTo === 'function' ? ev.emitTo('main', 'menubar-open', payload) : ev.emit('menubar-open', payload)).catch(() => {});
    invoke('open_main_window').catch(() => {});
    leave();
  }

  /* The first keystroke promises a question: Patch's base, his Pigeons and
     a lane are made ready now rather than when Enter is pressed. At most
     once in 20 s; a warm engine answers at once anyway. */
  let lastWarm = 0;
  box.addEventListener('input', () => {
    if (!engine || !engine.warm || Date.now() - lastWarm < 20_000) return;
    lastWarm = Date.now();
    engine.warm().catch(() => {});
  });
  box.addEventListener('keydown', (e) => {
    /* The picker, open: the same keys as the window's To: list. */
    if (picking) {
      const k = pickerKey(e, pickRows, pickHi);
      if (k) {
        e.preventDefault();
        if (k.escape) { picking = false; clear(); } else if ('move' in k) drawPicker(k.move); else setPick(k.pick);
        return;
      }
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); openWindow(box.value.trim()); return; }
    /* Not while an input method is composing: that Return picks a candidate. */
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); ask(box.value); return; }
    if (e.key === 'Escape') {
      e.preventDefault();
      /* Spotlight's two steps: the first Escape clears, the second leaves. */
      if (box.value || !$('out').hidden || pending || shot) {
        box.value = '';
        pending = null;
        picking = false;
        retryOnceAwake = null;
        box.placeholder = `Ask ${who().name}`;
        shot = null;
        paintChip();
        clear();
      } else leave();
    }
  });

  /* ── the bubbles ────────────────────────────────────────────────────────
     Open while the pointer is over the window, shut when it leaves. The page
     moves its own drawing (body.open) and tells Rust, which moves the glass. */
  let open = false;
  function bubbles (next) {
    if (open === next) return;
    open = next;
    document.body.classList.toggle('open', open);
    const invoke = invoker();
    if (invoke) invoke('bar_bubbles', { open, count: bubbleCount }).catch(() => {});
  }
  document.addEventListener('pointermove', () => bubbles(true), { passive: true });
  document.documentElement.addEventListener('pointerleave', () => bubbles(false));

  const say = (text) => show(`<div class="answer quiet">${esc(text)}</div>`);

  /** Read an image — picked, pasted, or the screen. For Peek and a picture
   *  Pigeon it is the picture itself; for everyone else only the text. */
  async function readImage (name, file) {
    if (!file) return;
    /* Peek and a Pigeon that sees get the picture itself: nothing is read off it. */
    if (who().sees) {
      try {
        const p = await pictureOf(file);
        shot = { name, picture: true, url: p.url, thumb: p.thumb, width: p.width, height: p.height };
        clear();
        paintChip();
      } catch (e) { say(String((e && e.message) || e)); }
      box.focus({ preventScroll: true });
      return;
    }
    show(`<div class="answer quiet">…<span class="prov">reading ${esc(name.toLowerCase())}</span></div>`);
    try {
      if (!ocr) ocr = await detectOcr();
      if (!ocr) { say('Pigeon can’t read pictures here.'); return; }
      const out = await ocr(new Uint8Array(await file.arrayBuffer()));
      const text = String(out.text || '').trim();
      if (!text) { say(`No text was found in ${name.toLowerCase()}.`); return; }
      shot = { name, text, engine: out.engine || 'the text reader' };
      clear();
      paintChip();
    } catch (e) { say(String((e && e.message) || e)); }
    box.focus({ preventScroll: true });
  }

  /* Who answers: the window's To: list, row for row, under the bar. */
  function setPick (next) {
    const d = pigeonOf(next, personas, patchState);
    if (!canMessage(d)) return;
    pick = d.pick;
    if (shot && shot.picture && !d.sees) { shot = null; paintChip(); }
    picking = false;
    pending = null;
    paintWho();
    clear();
    box.focus({ preventScroll: true });
  }
  function drawPicker (hi) {
    const drawn = toListHtml({ personas, patchState, hi });
    pickRows = drawn.flat;
    pickHi = drawn.hi ?? hi;
    show(`<div class="picker" role="listbox" aria-label="Pigeons on this Mac">${drawn.html}</div>`);
  }
  $('bubPatch').onclick = () => {
    if (picking) { picking = false; clear(); box.focus({ preventScroll: true }); return; }
    picking = true;
    const first = toListHtml({ personas, patchState });
    drawPicker(Math.max(0, first.flat.findIndex(d => d.pick === pick)));
    box.focus({ preventScroll: true });
  };
  $('out').addEventListener('click', (e) => {
    const row = e.target.closest('[data-to]');
    if (row && row.getAttribute('aria-disabled') !== 'true') { setPick(row.dataset.to); return; }
    /* Adding a Pigeon opens a file dialog, and that belongs to the window. */
    if (e.target.closest('[data-do="import-pigeon"]')) {
      const ev = globalThis.__TAURI__?.event;
      if (ev && typeof ev.emitTo === 'function') Promise.resolve(ev.emitTo('main', 'menubar-open', { action: 'add-pigeon' })).catch(() => {});
      const invoke = invoker();
      if (invoke) { invoke('open_main_window').catch(() => {}); leave(); }
    }
  });
  /* The file dialog takes the keyboard, the bar goes away as it does whenever
     you look elsewhere, and bar_show brings it back with the reading in it. */
  $('bubImage').onclick = () => $('pick').click();

  /* Play: one click starts it in the game played last (ui/play.js), and the
     bar steps away for the game; anything missing opens the Play sheet in the
     window. While any Pigeon plays, this is Stop. */
  $('bubPlay').onclick = async () => {
    const invoke = invoker();
    if (!invoke) { say('Playing needs the app, not a browser tab.'); return; }
    if (isPlaying(playStatus)) { invoke('play_stop').catch(() => {}); return; }
    const p = pickedPersona();
    if (!canPlay(p)) return;
    $('bubPlay').disabled = true;
    try {
      const peek = await invoke('settings_peek').catch(() => ({}));
      const out = await quickPlay(invoke, p, peek);
      if (out.started) { leave(); return; }
      const ev = globalThis.__TAURI__?.event;
      const payload = { action: 'play', pick: `pigeon:${p.id}` };
      if (ev) Promise.resolve(typeof ev.emitTo === 'function' ? ev.emitTo('main', 'menubar-open', payload) : ev.emit('menubar-open', payload)).catch(() => {});
      invoke('open_main_window').catch(() => {});
      leave();
    } catch (e) {
      say(String((e && e.message) || e));
    } finally {
      $('bubPlay').disabled = false;
    }
  };
  {
    const listen = globalThis.__TAURI__?.event?.listen;
    const invoke = invoker();
    if (typeof listen === 'function') listen('play-event', (e) => { playStatus = e.payload; paintPlay(); }).catch(() => {});
    if (invoke) invoke('play_status').then((s) => { playStatus = s; paintPlay(); }).catch(() => {});
  }
  $('pick').addEventListener('change', async () => {
    const file = $('pick').files && $('pick').files[0];
    $('pick').value = '';
    if (!file) return;
    await readImage(file.name || 'Image', file);
    const invoke = invoker();
    if (invoke) invoke('bar_show').catch(() => {});
  });
  document.addEventListener('paste', (e) => {
    const item = [...(e.clipboardData?.items || [])].find(i => i.kind === 'file' && /^image\//.test(i.type));
    if (!item) return;
    e.preventDefault();
    readImage('Pasted image', item.getAsFile());
  });

  /* The screen: the bar steps out of the picture, the capture is made in
     memory, tesseract reads all of it, and the bar comes back with the text. A
     drag-to-crop needs more room than a bar has; that lives in the popover. */
  $('bubShot').onclick = async () => {
    const invoke = invoker();
    if (!invoke) { say('Reading the screen needs the app, not a browser tab.'); return; }
    $('bubShot').disabled = true;
    try {
      await invoke('bar_hide');
      await new Promise(r => setTimeout(r, 220));
      let cap;
      try { cap = await invoke('screen_capture'); } finally { await invoke('bar_show').catch(() => {}); }
      /* The PNG's bytes, as they came: no base64, no string to decode. */
      const blob = new Blob([new Uint8Array(cap)], { type: 'image/png' });
      const st = await invoke('screen_capture_status').catch(() => null);
      await readImage('Screenshot', blob);
      if (st && st.allowed === false) say('macOS says screen recording is off for Pigeon, so that may have been the desktop with no windows in it. System Settings → Privacy & Security → Screen & System Audio Recording.');
    } catch (e) {
      say(String((e && e.message) || e));
    }
    $('bubShot').disabled = false;
  };

  /* The sheen leans toward the pointer. One style write per frame at most. */
  let sheen = 0;
  document.addEventListener('pointermove', (e) => {
    if (sheen) return;
    sheen = requestAnimationFrame(() => {
      sheen = 0;
      const r = $('glass').getBoundingClientRect();
      $('glass').style.setProperty('--mx', `${Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100)).toFixed(1)}%`);
    });
  }, { passive: true });

  /* Everything that is not the glass or the bird is the desktop, as far as the
     person can tell, and a click on the desktop puts a Spotlight away. */
  document.addEventListener('mousedown', (e) => {
    if (!e.target.closest('#glass, .bub')) leave();
  });
  /* A click on the glass that is not on a control goes to the box. */
  $('glass').addEventListener('mousedown', (e) => {
    if (e.target.closest('button, input, .out')) return;
    e.preventDefault();
    box.focus({ preventScroll: true });
  });

  $('acts').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-do]');
    if (!b) return;
    if (b.dataset.do === 'copy' && lastTurn) {
      try { await navigator.clipboard.writeText(copyText(lastTurn)); b.textContent = 'Copied'; } catch { b.textContent = 'Could not copy'; }
      box.focus({ preventScroll: true });
    }
    if (b.dataset.do === 'open-draft') openWindow(lastAsked);
    /* The person clicks; the app never infers its way across (§5.5). */
    if (b.dataset.do === 'hand') { setPick('patch'); ask(lastAsked); }
    if (b.dataset.do === 'wake-ask' && engine) {
      retryOnceAwake = lastAsked;
      b.disabled = true;
      b.textContent = 'Waking the models…';
      try { applyStatus(await engine.wake()); } catch { /* the state line already says what is true */ }
      box.focus({ preventScroll: true });
    }
  });

  /* ── the engine ───────────────────────────────────────────────────────── */

  /* The seconds of a wake have to move, and nothing else does. */
  let wakeTick = null;
  function syncWakeTick () {
    const waking = Boolean(engineStatus) && [engineStatus.category].some(r => r && r.phase === 'waking');
    if (waking && !wakeTick) wakeTick = setInterval(() => { paintState(); syncWakeTick(); }, 1000);
    else if (!waking && wakeTick) { clearInterval(wakeTick); wakeTick = null; }
  }

  async function applyStatus (status) {
    engineStatus = status;
    applyStatusRef = applyStatus;
    /* Peek is offered once the engine has said whether its model is here. */
    if (status) setPeekModel(status.peek || null);
    syncWakeTick();
    paintState();
    const plannerUp = status && status.category && status.category.phase === 'ready';
    const categoryUp = status && status.category && status.category.phase === 'ready';
    if (plannerUp && !planner && registry) {
      const built = await buildPlanner(registry, packOptions);
      if (built) ({ planner, focus, secondLook } = built);
    } else if (!plannerUp && planner) {
      planner = focus = secondLook = null;
    }
    if (categoryUp && registry && router instanceof LexicalRouter) {
      const built = await buildCategoryRouter(registry, packOptions);
      if (built) router = built.router;
    } else if (!categoryUp && registry && !(router instanceof LexicalRouter)) {
      router = new LexicalRouter(registry, packOptions.routerOptions?.lexicalOptions || {});
    }
    /* Everything that writes rides on the category server. */
    chat = categoryUp ? chatBridge() : null;
    const list = invoker();
    if (list) { try { personas = await list('personas_list'); } catch { /* keep what was there */ } }
    else if (chat) { try { personas = await chat.personas(); } catch { personas = []; } }
    paintWho();
    /* Woken for a question: it is asked again now, once, by the person's own
       choice a moment ago — never on this page's own initiative (§5.5). */
    if (planner && retryOnceAwake && !busy) {
      const again = retryOnceAwake;
      retryOnceAwake = null;
      ask(again);
    }
    /* A wake that failed leaves the question where it was, and says so. */
    const failed = status && [status.category].some(r => r && r.phase === 'error');
    if (failed && retryOnceAwake) {
      retryOnceAwake = null;
      const b = $('acts').querySelector('[data-do="wake-ask"]');
      if (b) { b.disabled = false; b.textContent = 'Wake the models and ask again'; }
    }
  }

  async function loadPatchHere () {
    let loaded;
    try {
      const { codeBase, pack, devAllowed } = await patchSource();
      loaded = await loadPatch({ codeBase, pack, devAllowed });
    } catch (e) { loaded = { state: 'unavailable', reason: `Patch is unavailable: ${(e && e.message) || e}` }; }
    if (loaded.state === 'ready') {
      registry = loaded.registry;
      packOptions = loaded.options || {};
      extractor = jsExtractor(registry);
      router = new LexicalRouter(registry, packOptions.routerOptions?.lexicalOptions || {});
      patchState = { state: 'ready', info: loaded.info };
      /* Models that woke while the skills loaded are bound now. */
      if (engineStatus) await applyStatus(engineStatus);
    } else {
      patchState = { state: 'unavailable', reason: loaded.reason };
    }
    paintWho();
  }

  async function boot () {
    paintState();
    /* A browser tab is never told it came up, so it is simply up. */
    arrive();
    loadPatchHere().catch(() => {});
    engine = engineBridge();
    paintState();
    const listen = globalThis.__TAURI__?.event?.listen;
    if (typeof listen === 'function') listen('bar-shown', arrive).catch(() => {});
    const invoke = invoker();
    if (invoke) {
      /* Greyed where it cannot work; the glass bubble is there either way. */
      invoke('screen_capture_status').then(st => { $('bubShot').disabled = !st.available; }).catch(() => { $('bubShot').disabled = true; });
      /* Read-only: how long the last wake took, for the countdown. */
      invoke('settings_peek')
        .then(s => { if (s && Number.isFinite(s.lastWakeMs)) lastWakeMs = s.lastWakeMs; })
        .catch(() => {});
    }
    if (!engine) return;
    engine.onStatus(applyStatus).catch(() => {});
    try { await applyStatus(await engine.status()); } catch { /* drawn as asleep */ }
  }

  boot();
}

if (typeof document !== 'undefined' && document.getElementById) start();
