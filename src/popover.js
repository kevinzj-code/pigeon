/* popover.js — the menu bar's window, and the second of the three files in
 * this app that touch a DOM (src/bar.js, the summon bar's, is the last).
 *
 * It shares the pipeline with the main window and none of its chrome. What it
 * is for is the question you have while doing something else, so it asks one
 * question at a time, shows one answer, and offers the three things you might
 * want next: the full window, a screenshot, or the models awake.
 *
 * Two rules from the spec shape everything here:
 *
 *   **It opens on Patch, and that is not a setting** (§5.7).
 *   Something a person reaches for in two seconds opens on the one whose
 *   answers can be checked. Every other Pigeon on this Mac is one click away
 *   in the To: field — the same cast the window offers, from the same
 *   descriptors — and a pick lasts for the question being asked, no longer.
 *
 *   **Provenance survives into the popover** (§2.3). A value answered here
 *   carries the same computed / bundled / web mark it would in the window,
 *   drawn by the same renderer (src/segments.js), because a smaller surface is
 *   not a reason for a weaker guarantee.
 *
 * The status line is permanent and says what Pigeon is holding right now:
 * resident and empty, waking, or awake. With the models asleep this window is
 * the lexical router and 307 pure functions, which answers about one question
 * in six outright, in under 20 ms, holding no weights at all.
 */

import { loadPatch, patchSource } from './patch-pack.js';
import { LexicalRouter } from './router.js';
import { jsExtractor } from './extractor.js';
import { deviceCtx } from './ctx.js';
import { runTurn, MODES } from './turn.js';
import { segmentsHtml } from './segments.js';
import { buildPlanner, buildCategoryRouter } from './stack.js';
import { engineBridge, wakeCategory } from './engine.js';
import { detectOcr, capAttached, composeMessage, wordCount } from './ocr.js';
/* Who can answer, from the same descriptors the window draws: the menu bar
   offers the same cast and says the same thing about each of them. */
import { pigeonOf, toListHtml, avatarHtml, canMessage, jobFields, PATCH_ICON, pickerKey, setPeekModel } from './ui/pigeons.js';
import { pictureOf } from './ui/picture.js';
import { copyText, markLabel, receiptLine, badgeFor, humanise, MARKS } from './ui/marks.js';
import { logTurn } from './log.js';
/* The chat lane, reached from a window and only from a window — see
   src/lint-imports.js, which fails the build if anything else imports it. */
import { runChat, runPlain } from './lane-b/chat.js';
import { chatBridge } from './lane-b/bridge.js';
import { HANDOFF_OFFER } from './lane-b/handoff.js';
import { esc, ICONS } from './ui/html.js';
import { canPlay, quickPlay, isPlaying } from './ui/play.js';
import { wakeEta } from './ui/status.js';

const $ = (id) => document.getElementById(id);

/* Null until Patch's skills have loaded in their locked worker (loadPatchHere,
   below). `patchState` is loading, ready, or unavailable with the reason — the
   same states, and the same words, the window draws. */
let registry = null;
let extractor = null;
let router = null;
let patchState = { state: 'loading' };
/* The last finished exchange, for the fold (foldLast). At module level, with
   the rest of this window's state: tellWindow, which sets it, lives out here
   too, and the handlers inside start() cannot lend it their scope. */
let last = null;
let packOptions = {};
let planner = null, focus = null, secondLook = null;
let engine = null, engineStatus = null;
let chat = null;
/* Patch until someone says otherwise, every time this window opens (§5.7).
   The pick is not remembered: a surface you reach for in two seconds opens on
   the one whose answers can be checked, and that is not a setting. WHICH
   Pigeon answers is still yours to change for the question you are asking —
   the same cast the window offers, in the same order, from the same
   descriptors. */
let pick = 'patch';
let personas = [];
let busy = false;
let wokeAt = null;
/* What a screenshot, a pasted image or a dropped one was read as, waiting to
   go with the next question. The TEXT only: the picture is never kept (§5.8). */
let shot = null;

/* ── the honesty rail, as one line ──────────────────────────────────────── */

/* The 15–30 s cold start is shown, never hidden (§2.3), counted down from how
   long the last wake on this Mac took. The window records that; this reads it
   and never writes it back — the window is the file's only writer. */
let lastWakeMs = null;

export function stateLine (status, wakeMs = lastWakeMs, now = Date.now()) {
  if (!status) return { text: 'quick answers only', tone: '' };
  if (status.disabled) return { text: 'models off · quick answers', tone: '' };
  const roles = [status.category].filter(Boolean);
  const broken = roles.find(r => r.phase === 'error');
  const waking = roles.filter(r => r.phase === 'waking');
  const ready = roles.filter(r => r.phase === 'ready');
  if (waking.length) {
    const ms = Math.max(...waking.map(r => r.waking_ms || 0));
    return { text: `waking the model · ${wakeEta(wakeMs, now - ms, now)}`, tone: 'waking' };
  }
  if (ready.length) {
    const mb = ready.reduce((n, r) => n + (r.resident_mb || 0), 0);
    return { text: `awake · ${(mb / 1024).toFixed(1)} GB in memory`, tone: 'awake' };
  }
  if (broken) return { text: `models asleep · ${broken.detail}`, tone: 'busted' };
  /* The default, and the one that matters: Pigeon is here and its memory is EMPTY. */
  return { text: 'models asleep · quick answers', tone: '' };
}

/* The two refusals capture.rs can give, as the steps a person follows. Anything
   else is shown whole. */
export function captureRefusal (message) {
  const m = String(message || '');
  const where = 'Open System Settings → Privacy & Security → Screen & System Audio Recording.';
  if (/cannot read the screen yet/.test(m)) {
    return { title: 'Pigeon needs permission to read the screen',
      steps: [where, 'Switch Pigeon on.', 'Quit Pigeon and open it again — macOS only applies the switch after a restart.'],
      retry: false };
  }
  if (/gave Pigeon no picture/.test(m)) {
    return { title: 'macOS is holding the permission for an older copy of Pigeon',
      steps: [where, 'Select Pigeon and remove it with the – button.', 'Come back, take the screenshot again, and say yes when macOS asks.'],
      retry: true };
  }
  return null;
}

function paintState () {
  const { text, tone } = stateLine(engineStatus);
  $('state').className = `state ${tone}`;
  $('stateText').textContent = text;
  const anyReady = engineStatus && [engineStatus.category].some(r => r && r.phase === 'ready');
  const anyWaking = engineStatus && [engineStatus.category].some(r => r && r.phase === 'waking');
  $('wake').disabled = Boolean(anyWaking) || Boolean(engineStatus && engineStatus.disabled);
  $('wake').textContent = anyReady ? 'Sleep models' : anyWaking ? 'Waking…' : 'Wake models';
}

/* ── who answers ──────────────────────────────────────────────────────────
   The same cast the window offers, from the same descriptors: Patch, the
   Pigeons on this Mac grouped by what they are, and the base model. Patch is
   the one that computes; everything else writes, and the button says which
   before a word of an answer is read. */
function applyTheme (t) {
  document.documentElement.dataset.theme = t === 'dark' || t === 'light' ? t : 'system';
}

function paintWho () {
  const btn = $('who');
  if (!btn) return;
  const d = pigeonOf(pick, personas, patchState);
  btn.innerHTML = `${avatarHtml(d, 22)}<span class="who-name">${esc(d.name)}</span><span class="who-chev">▾</span>`;
  btn.title = d.line;
  $('ask').placeholder = d.kind === 'verified'
    ? 'Ask anything quick…'
    : d.kind === 'peek' ? 'Ask Peek, or add a picture — it sees it'
      : d.kind === 'job' ? `Give ${d.name} one input…` : `Say something — ${d.name} writes the reply…`;
  $('footText').textContent = d.kind === 'verified'
    ? 'Nothing left this Mac'
    : `Nothing left this Mac · ${d.name} writes, nothing is checked`;
  paintPlay();
}

/* ── Play, for a Pigeon that plays ─────────────────────────────────────────
   Beside Screenshot and Picture… whenever the Pigeon picked can play. One
   click starts it in the game played last (ui/play.js quickPlay); anything
   missing — a permission, a first game — opens the Play sheet in the window.
   While any Pigeon plays, the button stops it. */
let playStatus = null;
const pickedPersona = () => personas.find(p => `pigeon:${p.id}` === pick) || null;
function paintPlay () {
  const btn = $('play');
  if (!btn) return;
  const p = pickedPersona();
  const live = isPlaying(playStatus);
  btn.hidden = !(canPlay(p) || live);
  if (btn.hidden) return;
  btn.innerHTML = live ? `${ICONS.stop}Stop playing` : `${ICONS.play}Play`;
  btn.title = live ? `Stop ${playStatus.name || 'the play'} (⌘⇧.)` : `Play a game with ${p.name} — the game you played last, or choose one`;
}


/* Picking is per question, not a setting: this window still opens on Patch
   every time (§5.7). The list is the window's To: list, row for row. A Pigeon
   the running server has not loaded yet can be picked here as it can there —
   but only the window can restart the models, so asking it hands over (ask). */
function setPick (next) {
  const d = pigeonOf(next, personas, patchState);
  if (!canMessage(d)) return;
  pick = d.pick;
  /* A picture waiting for Peek means nothing to anyone else: they would be
     handed nothing of it. */
  if (shot && shot.picture && !d.sees) { shot = null; paintChip(); }
  closeWho();
  paintWho();
}

let whoRows = [];
let whoHi = 0;
const whoOpen = () => Boolean($('whoList')) && !$('whoList').hidden;

/* The list's rows, drawn with one highlighted; the arrows redraw it. */
function drawWho (hi) {
  const list = $('whoList');
  const drawn = toListHtml({ personas, patchState, hi });
  list.innerHTML = drawn.html;
  whoRows = drawn.flat;
  whoHi = drawn.hi ?? hi;
  list.querySelectorAll('[data-to]').forEach(b => {
    b.onclick = () => {
      if (b.getAttribute('aria-disabled') === 'true') return;
      setPick(b.dataset.to);
      $('ask').focus({ preventScroll: true });
    };
  });
  /* Adding a Pigeon opens a file dialog, and that belongs to the window. */
  const add = list.querySelector('[data-do="import-pigeon"]');
  if (add) add.onclick = () => { closeWho(); openWindow(); tellWindowTo({ action: 'add-pigeon' }); };
}

function openWho () {
  const list = $('whoList');
  const first = toListHtml({ personas, patchState });
  drawWho(Math.max(0, first.flat.findIndex(d => d.pick === pick)));
  list.hidden = false;
  /* One scroll bar: the list stops above the footer and scrolls itself, and
     the window behind it holds still until it closes. */
  document.body.classList.add('picking');
  const foot = document.querySelector('.foot');
  const room = (foot ? foot.getBoundingClientRect().top : window.innerHeight) - list.getBoundingClientRect().top - 8;
  list.style.maxHeight = `${Math.max(120, Math.floor(room))}px`;
  $('who').setAttribute('aria-expanded', 'true');
}

function closeWho () {
  const list = $('whoList');
  if (!list || list.hidden) return;
  list.hidden = true;
  document.body.classList.remove('picking');
  whoRows = [];
  $('who').setAttribute('aria-expanded', 'false');
}

/* ── a reading, waiting for its question ──────────────────────────────────
   A screenshot, a pasted image or a dropped one is read by tesseract and the
   TEXT waits here in a chip — no model has touched it, the chip says so, and
   the picture itself is never kept. Whatever is typed next is a question about
   this text, so the two go together, exactly as they do in the window. */
function paintChip () {
  const chip = $('chip');
  if (!chip) return;
  chip.hidden = !shot;
  if (!shot) return;
  /* A picture for Peek: nothing was read off it, so there is no text to show. */
  if (shot.picture) {
    chip.innerHTML = `<span class="reading-hd">${shot.thumb ? `<img class="reading-thumb" src="${shot.thumb}" alt="">` : ''}<b>${esc(shot.name)}</b> · Peek sees this picture — nothing is read off it</span>
      <button class="reading-x" id="chipDrop" aria-label="Remove this picture" title="Remove this picture">×</button>`;
    $('chipDrop').onclick = () => { shot = null; paintChip(); $('ask').focus({ preventScroll: true }); };
    return;
  }
  const { text, truncated } = capAttached(shot.text);
  chip.innerHTML = `<span class="reading-hd"><b>${esc(shot.name)}</b> · ${wordCount(shot.text)} words · read by ${esc(shot.engine)}${
    truncated ? ' · capped' : ''}<span class="raw">raw — no model</span></span>
    <button class="reading-x" id="chipDrop" aria-label="Remove this reading" title="Remove this reading">×</button>
    <details><summary>the text as it will be sent</summary><pre>${esc(text)}</pre></details>`;
  $('chipDrop').onclick = () => { shot = null; paintChip(); $('ask').focus({ preventScroll: true }); };
}

function setShot (name, text, out) {
  shot = { name, text, engine: (out && out.engine) || 'the text reader', ms: (out && out.ms) || 0 };
  paintChip();
  $('out').innerHTML = '';
  const box = $('ask');
  box.focus();
  box.setSelectionRange(box.value.length, box.value.length);
}

/* ── one question ───────────────────────────────────────────────────────── */

function paintAnswer (turn) {
  const out = $('out');
  if (!turn) { out.innerHTML = ''; return; }

  if (turn.ask) {
    out.innerHTML = `<div class="answer">${esc(turn.ask.question)}
      <span class="prov">${esc(humanise(turn.ask.skill))} · ${esc(markLabel(MARKS.WAITING).toLowerCase())}</span></div>`;
    return;
  }
  if (turn.mode === MODES.NO_SKILL || !turn.reply) {
    /* The popover says the same thing the window would, in fewer words: Patch
       has nothing for it, and with the models asleep that is often because
       nothing is awake to look harder. */
    const asleep = !planner;
    out.innerHTML = `<div class="answer">Patch has no skill for that${asleep ? ', and no model is awake to look harder' : ''}.
      <span class="prov">${esc(markLabel(MARKS.COULDNT))}${asleep ? ' · models asleep' : ''}</span></div>`;
    return;
  }
  out.innerHTML = `<div class="answer">${segmentsHtml(turn.reply.segments, { esc, turnId: turn.id || '' })}
    <span class="prov">${esc(receiptLine(turn))}</span>
    <button class="last-b ans-copy" id="ansCopy">Copy</button></div>`;
  const cp = $('ansCopy');
  if (cp) {
    cp.onclick = async () => {
      try { await navigator.clipboard.writeText(copyText(turn)); cp.textContent = 'Copied'; } catch { /* nothing to copy to */ }
    };
  }
}

/* Waking never changes an answer already given (§2.3): it widens what Pigeon
   can reach. Said out loud the first time someone wakes after being answered. */
let answered = false;
function paintWakeNote (show) {
  const note = $('wakeNote');
  if (note) note.remove();
  if (!show) return;
  const el = document.createElement('div');
  el.className = 'pnote';
  el.id = 'wakeNote';
  el.textContent = 'Patch already answered that one from what he knows. Waking the models widens what he can reach — it never changes an answer you already have.';
  $('out').after(el);
}

async function ask (message) {
  const typed = String(message || '').trim();
  const d = pigeonOf(pick, personas, patchState);
  /* Peek is handed the picture itself; its words are only what was typed. */
  if (d.kind === 'peek') { if (!busy && (typed || (shot && shot.picture))) await askPeek(typed, d); return; }
  /* A reading goes WITH the question — typed, a blank line, then the text the
     engine read — composed and capped exactly as the window does it. */
  const text = composeMessage(typed, shot && !shot.picture ? capAttached(shot.text).text : '');
  if ((!text && !(shot && shot.picture && d.sees)) || busy) return;
  /* Patch answers only once his skills have loaded. Refused before anything is
     spent, so the question and any reading stay for when he is ready. */
  if (d.kind === 'verified' && patchState.state !== 'ready') {
    $('out').innerHTML = `<div class="answer"><span class="fail"><span class="code">NOT READY</span>${esc(d.line)}</span></div>`;
    return;
  }
  /* A Pigeon added since the models started is loaded by a restart, and only
     the window restarts them. Said before anything is spent, so the question
     stays in the box. */
  if (d.kind !== 'verified' && !d.loaded) {
    $('out').innerHTML = `<div class="answer">${esc(d.name)} is ready once Pigeon restarts its models, and that happens in the window.
      <button class="last-b" id="openFor">Open in Pigeon</button></div>`;
    $('openFor').onclick = () => { openWindow(); tellWindowTo({ action: 'open', pick: d.pick }); };
    return;
  }
  busy = true;
  /* Taken, so the box empties now and not before: a refused question stays
     where it was typed. */
  $('ask').value = '';
  /* A picture Pigeon is handed the picture itself, as in the window; anyone
     else gets the words read off it. */
  const picture = shot && shot.picture ? shot : null;
  const image = picture
    ? { name: picture.name, picture: true, thumb: picture.thumb, width: picture.width, height: picture.height, typed }
    : shot ? { name: shot.name, engine: shot.engine, used: 'raw', text: capAttached(shot.text).text, typed, truncated: capAttached(shot.text).truncated } : null;
  /* Spent: the reading belonged to the question just asked. */
  if (shot) { shot = null; paintChip(); }
  if (d.kind !== 'verified') {
    const turn = await askPigeon(text, d, picture ? picture.url : null);
    if (turn && turn.reply) tellWindow(text, turn, d.pick, image);
    busy = false;
    return;
  }
  $('out').innerHTML = '<div class="answer">…<span class="prov">finding the right skill</span></div>';
  try {
    const turn = await runTurn(text, {
      ...packOptions.turnOptions,
      registry, router, ctx: deviceCtx(), planner, extractor, focus, secondLook,
      /* No web from here. The switch and its per-request confirmation live in
         the window, and a surface this small is the wrong place to be asked
         whether something may leave the machine. */
      assembler: null
    });
    answered = true;
    paintAnswer(turn);
    /* A question waiting on its answer is not an exchange yet. */
    if (turn.ask) logTurn(turn, { receipt: receiptLine(turn) });
    if (!turn.ask) tellWindow(text, turn, 'patch', image);
  } catch (e) {
    $('out').innerHTML = `<div class="answer"><span class="fail"><span class="code">FAILED</span>${esc(String(e && e.message || e))}</span></div>`;
  }
  busy = false;
}

/* What was asked and what came back, handed to the main window to file. This
   window never writes the chats file itself: two writers of one file is how a
   save loses the other's work. Anything that will not survive the trip as
   JSON is not sent at all rather than sent in part. */
function tellWindow (message, turn, pickUsed, image) {
  logTurn({ ...turn, message: turn.message || message }, { pigeon: pickUsed, receipt: receiptLine(turn), reply: copyText(turn) });
  last = { turn, pick: pickUsed };
  const ev = globalThis.__TAURI__?.event;
  if (!ev) return;
  let payload;
  try { payload = JSON.parse(JSON.stringify({ message, turn, pick: pickUsed, image, at: Date.now() })); } catch { return; }
  const send = typeof ev.emitTo === 'function' ? ev.emitTo('main', 'menubar-exchange', payload) : ev.emit('menubar-exchange', payload);
  Promise.resolve(send).catch(() => {});
}

/* One question to a Pigeon. A voice or the base model writes it through
   runChat; a job does its one job through pigeon_run. Same guard, same badge
   and the same refusal to compute as the window — these are the same two
   paths, not smaller copies of them. */
async function askPigeon (text, d, picture = null) {
  /* Asleep is the usual state, not a failure — the window wakes the server
     before sending, and so does this, through the same helper. */
  if (!chat) {
    $('out').innerHTML = `<div class="answer gen">…<span class="prov">waking the models</span></div>`;
    const down = await wakeCategory(engine, { isUp: () => Boolean(chat), apply: applyStatus, current: () => engineStatus });
    if (down) {
      $('out').innerHTML = `<div class="answer gen">${esc(down)}</div>`;
      return null;
    }
  }
  $('out').innerHTML = `<div class="answer gen">…<span class="prov">${esc(d.name)} is writing</span></div>`;
  const persona = personas.find(p => p.id === d.id) || null;
  const turn = d.kind === 'job'
    ? await runJob(text, persona, picture)
    : await runChat(text, { complete: chat, persona });
  if (!turn.reply) {
    $('out').innerHTML = `<div class="answer gen">${esc(turn.error || 'nothing came back')}</div>`;
    return turn;
  }
  const filed = { ...turn, lane: 'B', mode: 'generated', persona: d.id || null };
  $('out').innerHTML = `<div class="answer gen">
      <span class="prov gen-badge">${esc(badgeFor(filed, d.name))}</span>
      ${esc(copyText(filed))}
      ${turn.unmatchedLabel ? `<span class="prov">not one of ${esc(d.name)}’s own labels — it was asked to classify and answered with something else</span>` : ''}
    </div>
    ${turn.offer ? `<div class="pacts"><button class="pact" id="hand">${esc(HANDOFF_OFFER)} →</button></div>` : ''}`;
  const hand = $('hand');
  /* The handoff moves the question to Patch and asks it there. The person
     clicks; the app never infers its way across (§5.5). */
  if (hand) hand.onclick = () => { setPick('patch'); ask(text); };
  return filed;
}

/* One question to Peek: the picture model as it comes, on the picture server
   (chat_complete with peek), the way the window's sayToPeek asks it — no
   instruction of ours and no guard on figures. The picture, if there is one,
   goes as pixels; the window files the exchange. */
async function askPeek (typed, d) {
  if (!d.loaded) {
    $('out').innerHTML = `<div class="answer gen">${esc(d.line)}
      <button class="last-b" id="openFor">Open Peek in Pigeon</button></div>`;
    $('openFor').onclick = () => { openWindow(); tellWindowTo({ action: 'open', pick: 'peek' }); };
    return;
  }
  busy = true;
  $('ask').value = '';
  const picture = shot && shot.picture ? shot : null;
  /* An OCR reading made before Peek was picked goes as words, as elsewhere. */
  const said = shot && !shot.picture ? composeMessage(typed, capAttached(shot.text).text) : typed;
  if (shot) { shot = null; paintChip(); }
  const image = picture ? { name: picture.name, picture: true, thumb: picture.thumb, width: picture.width, height: picture.height, typed } : null;
  $('out').innerHTML = `<div class="answer gen">…<span class="prov">Peek is ${picture ? 'looking' : 'writing'}${picture ? ' — the first picture starts the picture model' : ''}</span></div>`;
  const bridge = chatBridge();
  const complete = bridge && bridge.transport === 'rust command' ? (a) => bridge({ ...a, peek: true, image: picture ? picture.url : null }) : null;
  const asked = said || 'What is in this picture?';
  const turn = await runPlain(asked, { complete });
  if (!turn.reply) {
    $('out').innerHTML = `<div class="answer gen">${esc(turn.error || 'nothing came back')}</div>`;
  } else {
    $('out').innerHTML = `<div class="answer gen"><span class="prov gen-badge">${esc(markLabel(MARKS.WRITTEN, { name: d.name }))}</span>${esc(turn.reply.text)}</div>`;
    tellWindow(said, { ...turn, message: said, ...(asked !== said ? { asked } : {}) }, 'peek', image);
  }
  busy = false;
}

/* A job is not a conversation: one input in, one output back, through the
   command that knows the prompt it was trained with and the budget its own
   test measured. The page supplies the text and nothing else. */
async function runJob (text, persona, image = null) {
  const invoke = globalThis.__TAURI__?.core?.invoke;
  if (!invoke || !persona) return { reply: null, error: 'running a trained Pigeon needs the app, not a browser tab' };
  try {
    const out = await invoke('pigeon_run', { req: { pigeon: persona.id, text, ...(image ? { image } : {}) } });
    const said = String((out && out.text) || '').trim();
    const f = jobFields(out || {});
    if (f.noMaterial) return { reply: { text: `Nothing in ${persona.name}’s material covers that, so it was not asked.` }, ms: 0, ...f };
    if (f.renderError) return { reply: null, error: f.renderError, ms: out.ms };
    /* Everything the window draws a job's answer with — the section it was
       found in, the drawing, the labels — goes with it when it is filed. */
    return said
      ? { reply: { text: said }, ms: out.ms, tokens: out.tokens, finishReason: out.finish_reason, ...f, unmatchedLabel: f.unmatchedLabel === true }
      : { reply: null, error: `${persona.name} returned nothing`, ms: out && out.ms };
  } catch (e) {
    return { reply: null, error: String((e && e.message) || e) };
  }
}

function openWindow () {
  const invoke = globalThis.__TAURI__?.core?.invoke;
  if (invoke) invoke('open_main_window').catch(() => {});
}

/* Something only the window can do — add a Pigeon, open a chat. It is asked,
   the same way an exchange is handed over; this window opens nothing itself. */
function tellWindowTo (payload) {
  const ev = globalThis.__TAURI__?.event;
  if (!ev) return;
  const send = typeof ev.emitTo === 'function' ? ev.emitTo('main', 'menubar-open', payload) : ev.emit('menubar-open', payload);
  Promise.resolve(send).catch(() => {});
}

/* ── wiring ───────────────────────────────────────────────────────────────
   All of it inside `start`, and `start` only runs where there is a document.
   The test suite imports this file for `stateLine`, and a module that wires
   itself to a DOM on import is a module the suite cannot read. */

function start () {
$('mark').innerHTML = PATCH_ICON;
$('who').onclick = () => (whoOpen() ? closeWho() : openWho());

/* While the list is open it takes the same keys as the window's To: field:
   the arrows, Enter, 1–9, Escape — what the hint under it promises. */
document.addEventListener('keydown', (e) => {
  if (!whoOpen()) return;
  const k = pickerKey(e, whoRows, whoHi);
  if (!k) return;
  e.preventDefault();
  if (k.escape) { closeWho(); $('ask').focus({ preventScroll: true }); return; }
  if ('move' in k) { drawWho(k.move); return; }
  setPick(k.pick);
  $('ask').focus({ preventScroll: true });
});
document.addEventListener('mousedown', (e) => {
  if (whoOpen() && !e.target.closest('#whoList, #who')) closeWho();
});

/* A screenshot on the clipboard is how most of these arrive — ⌘⇧⌃4 puts one
   there — so ⌘V anywhere in this window reads it. A file dragged onto the
   window is read the same way: the shell's own drag-drop is off (tray.rs), so
   the page is handed the bytes and never a path. */
document.addEventListener('paste', (e) => {
  const item = [...(e.clipboardData?.items || [])].find(i => i.kind === 'file' && /^image\//.test(i.type));
  if (!item) return;
  e.preventDefault();
  readImage('Pasted image', item.getAsFile());
});
$('pickImg').onclick = () => $('pickFile').click();
$('pickFile').addEventListener('change', async () => {
  const file = $('pickFile').files && $('pickFile').files[0];
  $('pickFile').value = '';
  if (file) await readImage(file.name || 'Image', file);
});
document.addEventListener('dragover', (e) => { e.preventDefault(); document.body.classList.add('dropping'); });
document.addEventListener('dragleave', (e) => { if (!e.relatedTarget) document.body.classList.remove('dropping'); });
document.addEventListener('drop', (e) => {
  e.preventDefault();
  document.body.classList.remove('dropping');
  const file = [...(e.dataTransfer?.files || [])].find(f => /^image\//.test(f.type));
  if (file) readImage(file.name || 'Dropped image', file);
  else if (e.dataTransfer?.files?.length) say('That is not an image.');
});

$('ask').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { openWindow(); return; }
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    /* The box is emptied by `ask`, and only once the question is taken. */
    paintWakeNote(false);
    ask($('ask').value);
  }
  if (e.key === 'Escape') { if (whoOpen()) return; hide(); }
});



/* ── the last exchange, folded ─────────────────────────────────────────────
   Opened again with nothing unsent, the answer from last time shrinks to one
   line — "Last: £29.14 each · Copy · Open" — until the next send replaces it.
   Something unsent (typed text, a reading) leaves the window as it was. */
function foldLast () {
  if (!last || busy || shot || $('ask').value.trim()) return;
  const text = copyText(last.turn).replace(/\s+/g, ' ').trim();
  if (!text) return;
  const short = text.length > 60 ? `${text.slice(0, 59).trimEnd()}…` : text;
  $('out').innerHTML = `<div class="last"><span class="last-k">Last:</span><span class="last-t" title="${esc(text)}">${esc(short)}</span>
    <button class="last-b" id="lastCopy">Copy</button><span aria-hidden="true">·</span><button class="last-b" id="lastOpen">Open</button></div>`;
  $('lastCopy').onclick = async () => {
    try { await navigator.clipboard.writeText(text); $('lastCopy').textContent = 'Copied'; } catch { /* nothing to copy to */ }
  };
  $('lastOpen').onclick = () => { openWindow(); tellWindowTo({ action: 'open', pick: last.pick }); };
}
window.addEventListener('focus', foldLast);
$('openWindow').onclick = openWindow;
/* Inside start(), beside openWindow, tellWindowTo, hide and say, which it
   uses: outside, the hand-over threw, and so did saying so. */
async function playClick () {
  const invoke = globalThis.__TAURI__?.core?.invoke;
  if (!invoke) return;
  if (isPlaying(playStatus)) { invoke('play_stop').catch(() => {}); return; }
  const p = pickedPersona();
  if (!canPlay(p)) return;
  $('play').disabled = true;
  try {
    const peek = await invoke('settings_peek').catch(() => ({}));
    const out = await quickPlay(invoke, p, peek);
    if (out.started) { hide(); return; }
    tellWindowTo({ action: 'play', pick: `pigeon:${p.id}` });
    openWindow();
    hide();
  } catch (e) {
    say(String((e && e.message) || e));
  } finally {
    $('play').disabled = false;
  }
}
$('play').onclick = playClick;
{
  const listen = globalThis.__TAURI__?.event?.listen;
  const invoke = globalThis.__TAURI__?.core?.invoke;
  if (typeof listen === 'function') listen('play-event', (e) => { playStatus = e.payload; paintPlay(); }).catch(() => {});
  if (invoke) invoke('play_status').then((s) => { playStatus = s; paintPlay(); }).catch(() => {});
}

$('wake').onclick = async () => {
  if (!engine) return;
  const anyReady = engineStatus && [engineStatus.category].some(r => r && r.phase === 'ready');
  try {
    if (anyReady) { applyStatus(await engine.sleep()); return; }
    wokeAt = Date.now();
    paintWakeNote(answered);
    applyStatus(await engine.wake());
  } catch { /* the status line already says what is true */ }
};

/* ── reading the screen ─────────────────────────────────────────────────
   A screenshot arrives three ways, and all three end in the same place: the
   text, in a chip, waiting for the question you are about to type.

     · ⌘V — a picture on the clipboard, which is where ⌘⇧⌃4 leaves one;
     · a file dragged onto this window;
     · Screenshot, which captures the display, hides this window while it
       does, and lets you drag over the part you meant — or read all of it.

   Nothing here writes a file. The capture arrives as a data URL, the crop is
   made on a canvas, and the bytes go straight to the OCR command. What is
   kept afterwards is the TEXT — never the picture. */
let ocr = null;

/* Said once before the first screenshot, so the macOS prompt that follows is
   one the person was told about. Remembered in this window's own storage: it
   is a hint, not part of the chats file this window never writes. */
const SHOT_TOLD = 'pigeon.screenshotExplained';
const shotTold = () => { try { return localStorage.getItem(SHOT_TOLD) === '1'; } catch { return true; } };

$('shot').onclick = () => (shotTold() ? takeShot() : explainShot());

function explainShot () {
  const d = pigeonOf(pick, personas, patchState);
  $('out').innerHTML = `<div class="psheet"><b>${d.sees ? `Show ${esc(d.name)} part of your screen` : 'Read the text on your screen'}</b>
      <p>Pigeon steps out of the way, takes one picture of the screen, and you drag over the part you want.
      ${d.sees ? `${esc(d.name)} is handed that part as a picture` : 'Only the text is kept'} — the picture never touches the disk.</p>
      <p>The first time, macOS asks whether Pigeon may record the screen.</p></div>
    <div class="pacts"><button class="pact" id="shotGo">Take screenshot</button><button class="pact" id="shotNo">Cancel</button></div>`;
  $('shotGo').onclick = () => {
    try { localStorage.setItem(SHOT_TOLD, '1'); } catch { /* asked again next time, which is harmless */ }
    takeShot();
  };
  $('shotNo').onclick = () => { $('out').innerHTML = ''; $('ask').focus({ preventScroll: true }); };
}

/* The picture arrives as PNG bytes; its size is in its own header, and
   whether macOS says the permission is on is a separate, prompt-free call. */
function pngSize (bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b.length < 24) return { width: 0, height: 0 };
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  return { width: v.getUint32(16), height: v.getUint32(20) };
}

async function captureFrom (invoke) {
  const started = Date.now();
  const buf = await invoke('screen_capture');
  const bytes = new Uint8Array(buf);
  const { width, height } = pngSize(bytes);
  const st = await invoke('screen_capture_status').catch(() => null);
  const png = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
  return { png, bytes, width, height, ms: Date.now() - started, granted: st ? st.allowed !== false : true };
}

async function takeShot () {
  const invoke = globalThis.__TAURI__?.core?.invoke;
  if (!invoke) { say('Reading the screen needs the app, not a browser tab.'); return; }
  $('shot').disabled = true;
  try {
    /* Out of the way first. This window sits on top of whatever is being read,
       and a picture of the popover is no use to anybody. */
    const cap = await withoutThisWindow(() => captureFrom(invoke));
    showCapture(cap);
  } catch (e) {
    const message = String((e && e.message) || e);
    const r = captureRefusal(message);
    if (!r) say(message);
    else {
      $('out').innerHTML = `<div class="psheet"><b>${esc(r.title)}</b>
          <ol>${r.steps.map(s => `<li>${esc(s)}</li>`).join('')}</ol><p>Nothing was captured.</p></div>
        <div class="pacts">${r.retry ? '<button class="pact" id="shotAgain">Try again</button>' : ''}<button class="pact" id="shotNo">Done</button></div>`;
      const again = $('shotAgain');
      if (again) again.onclick = () => takeShot();
      $('shotNo').onclick = () => { $('out').innerHTML = ''; $('ask').focus({ preventScroll: true }); };
    }
  }
  $('shot').disabled = false;
}

/* Hide, let the compositor catch up, take the picture, come back. Through
   Rust: core:default grants a page no way to hide or show a window, and the
   window API's own hide() is refused in silence. */
async function withoutThisWindow (take) {
  const invoke = globalThis.__TAURI__?.core?.invoke;
  if (!invoke) return take();
  try { await invoke('popover_hide'); } catch { /* the picture is still worth taking */ }
  await new Promise(r => setTimeout(r, 180));
  try {
    return await take();
  } finally {
    try { await invoke('popover_show'); } catch { /* the tray brings it back */ }
    const box = $('ask');
    if (box) box.focus();
  }
}

const say = (text) => { $('out').innerHTML = `<div class="answer">${esc(text)}</div>`; };

/** Read an image — pasted, dropped, or cropped out of a capture. */
async function readImage (name, file) {
  if (!file) return;
  $('out').innerHTML = `<div class="answer">…<span class="prov">reading ${esc(name.toLowerCase())}</span></div>`;
  /* Peek and a Pigeon that sees get the picture itself: nothing is read off it. */
  if (pigeonOf(pick, personas, patchState).sees) {
    try {
      const p = await pictureOf(file);
      shot = { name, picture: true, url: p.url, thumb: p.thumb, width: p.width, height: p.height };
      $('out').innerHTML = '';
      paintChip();
      $('ask').focus({ preventScroll: true });
    } catch (e) { say(String((e && e.message) || e)); }
    return;
  }
  try {
    if (!ocr) ocr = await detectOcr();
    if (!ocr) { say('Pigeon can’t read pictures here.'); return; }
    const out = await ocr(new Uint8Array(await file.arrayBuffer()));
    const text = String(out.text || '').trim();
    if (!text) { say(`No text was found in ${name.toLowerCase()}.`); return; }
    setShot(name, text, out);
  } catch (e) {
    say(String((e && e.message) || e));
  }
}

function showCapture (cap) {
  /* macOS hands back a picture of the desktop with no windows in it when the
     app is not switched on for screen recording — a real picture, and the
     wrong one. It is worth saying so above it, because the fix is two clicks
     away and nothing else about the picture will admit it. */
  const caveat = cap.granted === false
    ? `<div class="pnote">macOS says screen recording is off for Pigeon, so this may be the desktop with
        no windows in it. If what you wanted is missing: System Settings → Privacy &amp; Security → Screen
        &amp; System Audio Recording, remove Pigeon with –, then try again and say yes when macOS asks.</div>`
    : '';
  $('out').innerHTML = `${caveat}<div class="shot" id="shotBox"><img src="${cap.png}" alt="the screen"><div class="sel" id="sel" hidden></div></div>
    <div class="shot-hint">Drag over the part you meant · ${cap.width}×${cap.height} · ${cap.ms} ms</div>
    <div class="pacts">
      <button class="pact" id="shotAll">Read all of it</button>
      <button class="pact" id="shotNo">Cancel</button>
    </div>`;
  /* A drag is for pointing at one thing; the whole screen is one button, so a
     screenshot can be attached without aiming at anything. */
  $('shotAll').onclick = () => readCrop(cap, { x: 0, y: 0, w: cap.width, h: cap.height }, 'Screenshot');
  $('shotNo').onclick = () => { $('out').innerHTML = ''; $('ask').focus({ preventScroll: true }); };
  const box = $('shotBox');
  const sel = $('sel');
  let from = null;

  const at = (e) => {
    const r = box.getBoundingClientRect();
    return { x: Math.min(Math.max(e.clientX - r.left, 0), r.width), y: Math.min(Math.max(e.clientY - r.top, 0), r.height) };
  };
  const draw = (a, b) => {
    sel.hidden = false;
    sel.style.left = `${Math.min(a.x, b.x)}px`;
    sel.style.top = `${Math.min(a.y, b.y)}px`;
    sel.style.width = `${Math.abs(a.x - b.x)}px`;
    sel.style.height = `${Math.abs(a.y - b.y)}px`;
  };

  box.onpointerdown = (e) => { from = at(e); box.setPointerCapture(e.pointerId); draw(from, from); };
  box.onpointermove = (e) => { if (from) draw(from, at(e)); };
  box.onpointerup = async (e) => {
    if (!from) return;
    const to = at(e);
    const start = from;
    from = null;
    const r = box.getBoundingClientRect();
    /* The picture is drawn at the popover's width; the crop is taken in the
       capture's own pixels. */
    const scale = cap.width / r.width;
    const rect = {
      x: Math.round(Math.min(start.x, to.x) * scale),
      y: Math.round(Math.min(start.y, to.y) * scale),
      w: Math.round(Math.abs(start.x - to.x) * scale),
      h: Math.round(Math.abs(start.y - to.y) * scale)
    };
    if (rect.w < 8 || rect.h < 8) { say('That selection was too small to read. Drag a box over some text, or read all of it.'); return; }
    await readCrop(cap, rect, 'Screen selection');
  };
}

/** Crop on a canvas and hand the bytes to the OCR command. No file, ever. */
async function readCrop (cap, rect, name) {
  $('out').innerHTML = `<div class="answer">…<span class="prov">reading the ${name === 'Screenshot' ? 'screen' : 'selection'}</span></div>`;
  try {
    const img = new Image();
    await new Promise((ok, no) => { img.onload = ok; img.onerror = no; img.src = cap.png; });
    const c = document.createElement('canvas');
    c.width = rect.w; c.height = rect.h;
    c.getContext('2d').drawImage(img, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);
    const blob = await new Promise(ok => c.toBlob(ok, 'image/png'));
    await readImage(name, blob);
  } catch (e) {
    say(String((e && e.message) || e));
  }
}

function hide () {
  const invoke = globalThis.__TAURI__?.core?.invoke;
  if (invoke) invoke('popover_hide').catch(() => {});
}

/* ── the engine ─────────────────────────────────────────────────────────── */

/* A ticking wake needs the seconds to move, and nothing else does: the clock
   runs only while a model is waking and stops as soon as none is. */
let wakeTick = null;
function syncWakeTick () {
  const waking = Boolean(engineStatus) && [engineStatus.category].some(r => r && r.phase === 'waking');
  if (waking && !wakeTick) wakeTick = setInterval(() => { if (engineStatus) paintState(); syncWakeTick(); }, 1000);
  else if (!waking && wakeTick) { clearInterval(wakeTick); wakeTick = null; }
}

async function applyStatus (status) {
  engineStatus = status;
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
  /* Everything that writes rides on the category server, so the Pigeons
     arrive and leave with it. */
  chat = categoryUp ? chatBridge() : null;
  /* The Pigeons this server actually loaded, asked for once it is up, so the
     menu bar offers the same cast the window does. */
  const listInstalled = globalThis.__TAURI__?.core?.invoke;
  if (typeof listInstalled === 'function') {
    /* Every installed Pigeon, awake or not — the same cast the window lists. */
    try { personas = await listInstalled('personas_list'); } catch { /* keep what was there */ }
  } else if (chat) {
    try { personas = await chat.personas(); } catch { personas = []; }
  } else {
    personas = [];
  }
  /* A pick stays what you chose while the models come and go. Asking wakes
     them (askPigeon), so a sleeping model is not a reason to swap who you
     were talking to for somebody else. */
  paintWho();
  paintState();
}

/* Patch's skills, in the same locked Blob worker the window uses. The source
   is the dev checkout until Phase 3 (see patchSource in app.js, the one place
   that changes); the popover will ask Rust the same question then. */
async function loadPatchHere () {
  let loaded;
  try {
    const { codeBase, pack, devAllowed } = await patchSource();
    loaded = await loadPatch({ codeBase, pack, devAllowed });
  }
  catch (e) { loaded = { state: 'unavailable', reason: `Patch is unavailable: ${(e && e.message) || e}` }; }
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
  /* Who answers, before anything else is known: Patch, every time (§5.7). */
  paintWho();
  $('ask').focus({ preventScroll: true });
  loadPatchHere().catch(() => {});
  engine = engineBridge();
  /* The screenshot action is drawn only where it can work, the way the image
     button is in the window: an action that fails when pressed is worse than
     one that was never offered. */
  const invoke = globalThis.__TAURI__?.core?.invoke;
  if (invoke) {
    /* Read-only, and only the two: how long the last wake took, for the
       countdown, and the window's Appearance choice, which this window draws
       with too. Never the chats. */
    invoke('settings_peek')
      .then(s => {
        if (s && Number.isFinite(s.lastWakeMs)) lastWakeMs = s.lastWakeMs;
        applyTheme(s && s.theme);
      })
      .catch(() => {});
    const listen = globalThis.__TAURI__?.event?.listen;
    if (typeof listen === 'function') listen('theme', (e) => applyTheme(e.payload)).catch(() => {});
    invoke('screen_capture_status')
      .then(s => { $('shot').hidden = !s.available; })
      .catch(() => { $('shot').hidden = true; });
  } else {
    $('shot').hidden = true;
  }
  if (!engine) { $('stateText').textContent = 'opened in a browser · quick answers'; return; }
  engine.onStatus(applyStatus).catch(() => {});
  try { await applyStatus(await engine.status()); } catch { /* drawn as asleep */ }
}

  boot();
}

if (typeof document !== 'undefined' && document.getElementById) start();
