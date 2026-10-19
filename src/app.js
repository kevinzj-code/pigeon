/* app.js — the only file that touches the DOM.
 *
 * Everything above it (registry, router, plan, executor, reply, fabrication)
 * runs unchanged in Node, which is how the test suite exercises the whole
 * pipeline without a browser. This file's job is §3.6 and nothing else:
 *
 *   · computed values render in a distinct style, with the skill and input in
 *     a tooltip
 *   · generated prose renders as normal text
 *   · failed steps render inline, as failures
 *   · bundled values show their date; web values would show their source
 *   · "Show plan" draws what happened as a sequence, with the raw plan and
 *     results one click further in
 *   · clicking a marked value opens the record behind it
 *   · chats are written to one file on disk, or kept for the session only when
 *     there is nowhere to write — the rail says which
 *   · editing or re-asking branches rather than overwrites; the old version and
 *     everything under it stay, one ‹ › away
 */

import { loadPatch, patchSource, patchNestLine } from './patch-pack.js';
import { LexicalRouter } from './router.js';
import { CATEGORY_CONFIDENCE } from './category-router.js';
import { buildPlanner, buildCategoryRouter } from './stack.js';
import { detectLlm, CATEGORY_BASE } from './llm.js';
import { jsExtractor } from './extractor.js';
import { deviceCtx } from './ctx.js';
import { runTurn, MODES, stackReport } from './turn.js';
import { REPLY_SOURCES } from './reply.js';
import { validatePlan } from './plan.js';
import { PLAN_LIMITS, CTX_OWNED_FIELDS, isRef } from './contracts.js';
import { segmentsHtml } from './segments.js';
import { life } from './patch-life.js';
import { FIXTURES_AS_OF } from './lib/web-fixtures.js';
import { detectSearch } from './search.js';
import { answerOf } from './transcript.js';
import { chatNodes, pathOf, siblingsOf, siblingIndex, switchTo, migrateChat, pendingAsk } from './thread.js';
import { loadState, saveState, flush, canPersist, isReadOnly, holdReason, saveFailing, onSaveTrouble, forDisk, STATE_VERSION, defaultSettings } from './store.js';
import { chatById, byActivity, lastActivity, touchActivity, nameChat, isEmpty, hasDraft, lastCompletedIn, startInflight, fileReply, settleInterrupted, togglePin, toggleMute, markUnread, markRead, setReaction, forwardTarget, forwardedFrom } from './chats.js';
/* The messaging layout's drawing. Pure strings, in modules the test suite can
   import; this file only decides when to draw them and wires what they draw. */
import { ICONS, esc } from './ui/html.js';
import { playSheetHtml, playCardHtml, canPlay } from './ui/play.js';
import { pictureOf, previewOf } from './ui/picture.js';
import { pigeonOf, pigeonList, pickForChat, chatFieldsFor, avatarHtml, factLine, canMessage, toListHtml, jobFields, declaresImage, pickerKey, isPeek, setPeekModel, pictureLine, builtInPigeons } from './ui/pigeons.js';
import { chatListHtml, searchHtml, pigeonsTabHtml, replyText } from './ui/sidebar.js';
import { chatDetailsHtml, profileHtml, removedHtml } from './ui/details.js';
import { deriveCard } from './ui/card.js';
import { settingsHtml } from './ui/settings.js';
import { chatMenuItems, messageMenuItems, forwardMenuItems, pigeonMenuItems, openMenu } from './ui/menu.js';
import { turnHtml, inflightHtml, queuedHtml, emptyChatHtml, stageLine, laneBFlow } from './ui/bubbles.js';
import { bannerHtml } from './ui/banner.js';
import { meetHtml, addable } from './ui/meet.js';
import { fetchProjector } from './projector-download.js';
import { statusLine, wakeEta, restartEta } from './ui/status.js';
import { enqueue, take as takeQueued, drop as dropQueued, skipAsk, askOpen } from './queue.js';
import { quoteBarHtml, memoryEdgeIndex, memoryEdgeHtml } from './ui/replybar.js';
import { patchFollowUpNote, oneShotNote, lengthNote, noteHtml, testedLengthNote } from './ui/notes.js';
import { messageInfoHtml } from './ui/info.js';
import { markFor, MARKS, humanise, webSource, copyText as answerText, copyWithSource, receiptLine } from './ui/marks.js';
import { logTurn, logShown } from './log.js';
import { diagnosticsText } from './diagnostics.js';
import { noteWords } from './ui/check-notes.js';
import { citationFor, citationHtml } from './ui/cite.js';
import { engineBridge, needsFirstRun, firstRunHtml, progressHtml, progressLine, fmtBytes, CANCELLED, wakeCategory } from './engine.js';
/* Lane B. app.js is the ONLY module allowed to import from src/lane-b/ — a
   lint fails the build otherwise (src/lint-imports.js), because the lane that
   may write prose must not be reachable from the pipeline that computes. */
import { runChat, runPlain, HISTORY_TURNS } from './lane-b/chat.js';
import { chatBridge } from './lane-b/bridge.js';
import { HANDOFF_OFFER } from './lane-b/handoff.js';
import { detectOcr, cleanupOcr, composeMessage, capAttached, describeAttachment, wordCount } from './ocr.js';
import { worthTidying } from './captions.js';
import { tidyTranscript, tidyBridge } from './captions-tidy.js';

/* ── the stack ─────────────────────────────────────────────────────────────
   `assembler` is null and that is not a placeholder. A chat model DOES ship
   now, but it writes in the other lane; nothing in the verified lane's reply
   path is allowed to generate, so replies here come from templates. `planner` starts null and is
   filled in by detectModel() below IF a llama-server is reachable. A LoRA now
   exists for ROUTING — the category adapter — but none for the planner or the
   extractor, which are separate claims the Ledger keeps separate. The rail
   reports whichever of these states is actually true.

   `registry`, `router` and `extractor` are null until Patch's skills have
   loaded in their worker (startPatch, below); `patchState` says whether they
   are loading, ready, or unavailable and why. Nothing that asks Patch anything
   may run while it is not 'ready'. */
let registry = null;
/* Reassigned by detectModel() if the category adapter is reachable. Word
   matching is the floor, not the plan: it cannot rank a skill that shares no
   vocabulary with the question, which is most of what Pigeon got wrong. */
let router = null;
let extractor = null;
let patchState = { state: 'loading' };
/* The pack's prompts and tunables as factory options; {} is the constants. */
let packOptions = {};
/* Patch's own word-matching router, with the numbers his pack carries. */
const lexicalFor = (reg) => new LexicalRouter(reg, packOptions.routerOptions?.lexicalOptions || {});
const assembler = null;
/* §8's seam, filled by a SELECTION pass rather than a writing one: a long web
   answer is trimmed to the sentence that answers the question, with the model
   choosing the sentence NUMBER under a grammar and JS rendering that sentence
   verbatim. Null until a model is reachable, and null is simply the untrimmed
   passage — which is what shipped before this existed. See focus.js. */
let focus = null;
/* The decline second look: when the planner returns an empty plan but the
   category adapter named a category, the router's top three are put to a
   selection question with "none" allowed. Measured on the holdout: fired 12
   times, right 11, wrong 1, no leaks — 239 → 248 correct. See verify.js. */
let secondLook = null;
let asks = null;
/* Filled in by detectModel() below if a llama-server is reachable. Until then —
   and permanently, if there is none — Pigeon runs in §11's router-only
   single-skill mode. The rail says which, always. */
let planner = null;
let modelName = null;
let categoryModel = null;
/* The web tier. `search` is the provider once one is found. Nothing leaves
   the machine unless a person says yes on a look-up's own card (CONSENT_WEB):
   off by default is the product — this app is called Airoplane Mode, and the
   web being available is not the same as the web being wanted. */
let search = null;
/* What the card last sent, so the turn can say where and when. */
let lastWebSend = null;

/* ── reading an image (experimental) ───────────────────────────────────────
   `ocr` is the engine, found once at boot: a Rust command in the app, the dev
   server's route in a browser, null when there is neither — in which case the
   image button is not drawn and a paste says why. `plannerComplete` is the
   planner's raw `complete`, kept because `planner` below is the plan-writing
   wrapper and the tidy pass needs a free-text call. `attachment` is the open
   chat's composer chip: the image being read or ready to send. It is saved
   with that chat's draft, but only as what was READ — what reaches the turn,
   the draft and the disk is the text, never the pixels (store.js forDisk). */
let ocr = null;
let ocrDetail = null;
let plannerComplete = null;
let attachment = null;
/* A pasted transcript, offered for tidying. One at a time, like an
   attachment, and for the same reason: two half-finished offers on screen
   would be two ways to lose what you typed. */
let transcript = null;
let transcriptSeq = 0;
let attachSeq = 0;

/* ── the engine (Pigeon's own model servers) ───────────────────────────────
   `engine` is the bridge to six Rust commands, null in a browser. `engineStatus`
   and `modelsInfo` are the last things Rust said — pushed by event, never
   polled — and the rail's engine and models rows are drawn from them. The
   planner and category seams above are bound and UNBOUND from engine status:
   a model that has gone to sleep is a model the rail no longer claims. */
/* Lane B's transport and the personas it can wear. `chat` is null until the
   category server is up, and null is a state the lane renders rather than an
   error: the chat lane with no model has nothing to say and says so. */
let chat = null;
let personas = [];

let engine = null;
let engineStatus = null;
/* The first keystroke of a message is the earliest moment a question is
   certain. The engine unloads Patch's base after a period idle, and loading
   it again (base, adapters, a lane's cache) is paid by the first turn after;
   asked now, it is paid while the person is still typing. At most once in
   WARM_EVERY_MS, since a warm engine answers at once anyway. */
const WARM_EVERY_MS = 20_000;
let lastWarm = 0;
/* Called wherever a question is about to be asked by some route other than
   typing too: the window coming to the front with a chat open, a starter chip,
   a queued message going, the reply bar opening, the composer taking focus. */
function warmSoon () { warmWhileTyping(); }
function warmWhileTyping () {
  if (!engine || !engine.warm) return;
  const now = Date.now();
  if (now - lastWarm < WARM_EVERY_MS) return;
  lastWarm = now;
  engine.warm().catch(() => { /* a refusal is the turn's to report, not the keystroke's */ });
}
let modelsInfo = null;
/* The download, while one runs: the last progress event and the sheet it is
   drawn in, if that sheet is open. Closing the sheet does not stop the
   download; the rail's models row reopens it. */
let downloading = false;
let downloadProgress = null;
/* Which download the sheet and the strip are about: the first-run pair, or
   the picture model Peek asks for. One runs at a time (download.rs). */
let downloadKind = 'models';
let sheetHost = null;

const ctx = deviceCtx();

/* The conversations.
 *
 * `turns` is a getter onto whichever chat is active, so everything that reads or
 * writes state.turns — and that is most of this file — carries on unchanged
 * while there is now more than one conversation behind it.
 *
 * Written to `app_data_dir/state.json` through two named Rust commands; see
 * store.js. In a browser, where there is no bridge, none of that happens and the
 * app is session-only exactly as it was. The rail says which. */
const state = {
  view: 'chat',
  /* The messaging layout. `compose` is set while a new chat is being
     addressed: the blank chat it will become, and whether To: has a Pigeon on
     it yet. `profile` is a Pigeon's page, opened from the Pigeons tab. */
  compose: null,
  tab: 'chats',
  search: '',
  profile: null,
  details: false,
  /* Which message's tapback bar is open, as 'turnId|q' or 'turnId|a'. */
  tapback: null,
  /* The reaction just added, for one paint, so it pops in once. */
  freshReaction: null,
  /* On a narrow window the list and the conversation take turns; this says
     which is showing. A wide window shows both and ignores it. */
  paneOpen: false,
  chats: [],
  activeChatId: null,
  /* Persisted beside the chats: today, only whether the first-run sheet has
     been answered. See store.js. */
  settings: defaultSettings(),
  /* Which plan panels are open, keyed by turn id. Deliberately NOT persisted:
     it is a scroll position, not history. */
  open: new Set(),
  /* Which of those panels has the raw JSON showing underneath. */
  raw: new Set(),
  editing: null,
  /* The question being answered in the chat on screen, if any, drawn as a turn
     so the thread never goes blank mid-question. It lives ON that chat
     (`chat.inflight`, see chats.js), so a reply that lands after you have left
     is filed into the chat it was asked in — and other chats stay free to ask. */
  get busy () { return activeChat().inflight || null; },
  /* The path currently on show. Read-only: turns are filed through fileReply so
     the tree stays linked, and there is nowhere left that assigns to this. */
  get turns () { return pathOf(activeChat()); }
};

/* Which lane a conversation is in. A chat carries its lane for life: the
   switch moves you between conversations rather than changing the one you are
   reading, so a thread is never half computed and half written (§5.3), and
   the ‹ 1/2 › version arrows keep meaning "you edited this question" rather
   than quietly also meaning "the other lane answered it". */
const laneOf = (c) => (c && c.lane === 'B' ? 'B' : 'A');
const activeLane = () => laneOf(activeChat());
/* The Pigeon this conversation is using, if it is still on the machine. */
const chatPersona = (c) => personas.find(p => p.id === (c && c.personaId)) || null;
/* A voice is worn in a conversation; every other kind is a JOB — one input,
   one output, its own prompt and its own budget (`pigeon_run`). An adapter
   with no contract at all is a voice, because that is what every hand-dropped
   `.lora.gguf` was before `.pigeon` files existed. */
const isVoice = (p) => !p || !p.kind || p.kind === 'persona';
/* Can this app put a PICTURE in front of a model? Yes, since the picture
   server (Milestone 3): a picture Pigeon — one trained on a vision base, which
   carries its projector — is handed the pixels themselves, through
   `pigeon_run`. What `ocr.js` does is a different thing and still the path for
   everyone else: a classical engine reads the text in an image and the TEXT is
   handed over, shown and correctable before it goes.

   A file declaring `inputs:["image"]` (format §2.2) is not enough on its own:
   the dog-breed sorter that started all this declared it on a text base. A
   picture is an input only when the file asks for one AND Rust says its base
   can see (`vision`); a text-base file that asks is told no, as before. This
   constant switches the window's picture Pigeons; Peek and the menu bar's
   pictures go by `sees` on the Pigeon itself. */
const SEES_PICTURES = true;
/* What this Pigeon can actually be handed, as opposed to what it says. */
/* A voice is never handed one: its reply path (runChat) sends words only. */
const canBeSentAPicture = (p) => SEES_PICTURES && declaresImage(p) && Boolean(p && p.vision) && !isVoice(p);
/* The picture Pigeon this chat is with, if it is with one. */
const pictureTarget = () => {
  const c = activeChat();
  if (isPeek(c)) return pigeonOf('peek');
  const p = c && laneOf(c) === 'B' ? chatPersona(c) : null;
  return p && canBeSentAPicture(p) ? p : null;
};
/* Pictures waiting for their send to reach `pigeon_run`, by chat. Never
   written anywhere: the turn keeps a thumbnail and the facts, not the pixels. */
const pendingPictures = new Map();
/* A sent picture's pixels, by the record its turn keeps, for as long as
   Pigeon is open — so Try again and Edit can send it again. In memory only:
   after a relaunch the record finds nothing here, and the turn asks for the
   picture to be attached again. */
const sentPictures = new WeakMap();
const pictureGone = (image) => Boolean(image && image.picture && !sentPictures.has(image));
/* Which messages' times are open to the minute: 'turnId|q' or 'turnId|a'. */
const fullWhen = new Set();

/* A sent picture, opened over the conversation: the picture itself while it
   is still in memory, else the preview kept with the turn. Escape, the ×, or
   a click outside it closes it. */
function openPicture (turn) {
  const box = $('lightbox');
  const pic = $('lightboxPic');
  if (!box || !pic || !turn.image) return;
  const src = (turn.image.picture && sentPictures.get(turn.image)) || turn.image.thumb;
  if (typeof src !== 'string' || !src.startsWith('data:image/')) return;
  pic.src = src;
  pic.alt = turn.image.name || 'picture';
  box.hidden = false;
  const close = () => {
    box.hidden = true;
    pic.removeAttribute('src');
    box.onclick = null;
    document.removeEventListener('keydown', onKey, true);
  };
  function onKey (e) { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } }
  box.onclick = (e) => { if (e.target !== pic) close(); };
  document.addEventListener('keydown', onKey, true);
  const x = $('lightboxClose');
  if (x) x.focus();
}
/* The question this conversation is waiting on, read off the thread rather
   than remembered beside it — see thread.js for why. */
/* Patch's open question in this chat — unless it was skipped. */
const asking = () => askOpen(activeChat());

/* ── what you have typed and not yet sent ─────────────────────────────────
 *
 * The composer used to keep its text nowhere but the DOM, and every repaint
 * rebuilds that DOM. It survived only while the box had FOCUS — so clicking
 * the web switch, the lane switch or the image button threw away what you had
 * written, and so did a model finishing detection in the background, with no
 * action from you at all.
 *
 * So a draft lives on its conversation (`chat.draft`): switching chat or lane
 * leaves each one's half-written message where you left it, rather than
 * carrying it somewhere it does not belong. It is saved with the chat — written
 * when you switch chats or leave the window, not on every keystroke — so
 * quitting no longer throws it away. The image chip and the transcript offer
 * travel with it.
 *
 * The height rides along because a multi-line draft restored into a one-row
 * box reads as text having been lost even when it has not.
 */
const draftOf = (id) => {
  const c = chatById(state.chats, id);
  return (c && c.draft) || { text: '', height: '' };
};
function setDraft (id, text, height) {
  const c = chatById(state.chats, id);
  if (!c) return;
  const d = { attachment: null, transcript: null, ...(c.draft || {}), text: String(text ?? ''), height: height || '' };
  c.draft = d.text || d.attachment || d.transcript ? d : null;
}

/* The open chat's image chip and transcript offer, moved onto its record
   whenever the open chat changes or the file is written, and back off when a
   chat is opened. The async reads that fill a chip hold the chip itself, not
   this variable, so a reading finished after you have left still lands in the
   chat it was started in. */
function stashComposer () {
  const c = chatById(state.chats, state.activeChatId);
  if (!c) return;
  const d = { text: '', height: '', ...(c.draft || {}), attachment: attachment || null, transcript: transcript || null };
  c.draft = d.text || d.attachment || d.transcript ? d : null;
}
function loadComposer () {
  const d = activeChat().draft;
  attachment = (d && d.attachment) || null;
  transcript = (d && d.transcript) || null;
}

/* Milliseconds between characters when a starter types itself into the box —
   fast enough that a long suggestion still lands well under half a second,
   slow enough to read as arriving rather than flickering. */
const TYPE_MS_PER_CHAR = 14;
const TYPE_MS_MAX = 420;
/* The one starter still typing itself in, if any: the box it is drawing into,
   the whole text, the chat it belongs to and the pending tick. */
let typing = null;

function showInBox (box, value) {
  box.value = value;
  box.style.height = 'auto';
  box.style.height = `${Math.min(160, box.scrollHeight)}px`;
  box.setSelectionRange(value.length, value.length);
}

/* End a starter's typing now, with the whole text in place. Called before
   anything that reads or replaces the box — a key, a paste, Send, a repaint —
   so none of them can see a half-typed suggestion or be outrun by a tick. */
function finishTyping () {
  if (!typing) return;
  const { box, text, chatId, timer } = typing;
  typing = null;
  clearTimeout(timer);
  showInBox(box, text);
  setDraft(chatId, text, box.style.height);
}

/* A starter's text, typed into the composer rather than dropped in — it reads
   as a suggestion being offered, not as the box changing under you. Only the
   drawing is animated: the full text is the chat's draft from the first tick,
   filed against the chat it was clicked in, so a repaint or a chat switch
   mid-way loses nothing and plants nothing elsewhere. Skipped under reduced
   motion, where it is simply set. */
function typeIntoComposer (box, text) {
  if (!box) return;
  finishTyping();
  warmSoon();
  const chatId = state.activeChatId;
  box.focus();
  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced || text.length < 2) {
    showInBox(box, text);
    setDraft(chatId, text, box.style.height);
    return;
  }
  setDraft(chatId, text, box.style.height);
  const perChar = Math.max(6, Math.min(TYPE_MS_PER_CHAR, TYPE_MS_MAX / text.length));
  typing = { box, text, chatId, timer: null };
  /* The box takes its final height before the first letter: measured once,
     not re-measured per character, so it does not flicker taller and shorter
     as the text types in. */
  showInBox(box, text);
  const height = box.style.height;
  let i = 0;
  const step = () => {
    i += 1;
    if (i >= text.length) { finishTyping(); return; }
    box.value = text.slice(0, i);
    box.style.height = height;
    box.setSelectionRange(i, i);
    typing.timer = setTimeout(step, perChar);
  };
  step();
}
/* Dropping an offer or a chip marks it, so a tidy or a reading still running
   for it lands nowhere. */
function dropTranscript () {
  if (transcript) transcript.dropped = true;
  transcript = null;
}
function dropAttachment () {
  if (attachment) attachment.dropped = true;
  attachment = null;
}

/* A new conversation starts with what was ASKED for and nothing else. It used
   to adopt the first loaded adapter on its own, which is how a note-titler
   became the default voice and answered a design brief with 400 tokens of one
   repeated word. Nothing is worn unless it was picked. */
function blankChat (lane = 'A', pigeonId = null) {
  return {
    id: uid(), title: 'New chat', createdAt: Date.now(), updatedAt: Date.now(),
    lane,
    personaId: lane === 'B' ? (pigeonId ?? null) : null,
    /* A conversation is a TREE, not a list.
     *
     * Editing a question or asking again adds a SIBLING rather than replacing
     * what was there, so nothing you said is ever destroyed by changing your
     * mind — the old branch stays, reachable with the ‹ 1/2 › arrows. What you
     * see is one path through the tree: start at activeRootId and follow
     * activeChildId down.
     *
     * Flat arrays are what most chat apps store, and they are why editing a
     * message in most chat apps quietly deletes the rest of the conversation. */
    nodes: {},
    activeRootId: null
  };
}

/* ── starting a chat: New chat, addressed to Patch ────────────────────────
 *
 * New chat opens on PATCH. He comes with the app and works things out, so he
 * is the default rather than one name among the rest: the caret lands in the
 * message box, Enter sends, and To: carries "Someone else…" for the times it
 * is not him. That is the difference between the helper the app ships with
 * and the Pigeons you added, said by where the caret goes rather than by a
 * label. With his skills not ready, nobody is filled in and To: opens as it
 * always did — an empty To: is still a real state, not an error.
 *
 * The blank chat exists from the start, so anything typed into it is kept like
 * any other draft; setting who it is for only sets who that chat is with,
 * which is safe because nothing has been asked in it yet. It joins the list
 * when the first message is sent.
 */
function startCompose (pick = null) {
  stashComposer();
  const from = state.compose ? state.compose.from : state.activeChatId;
  state.view = 'chat';
  state.profile = null;
  state.editing = null;
  state.open.clear();
  state.raw.clear();
  state.paneOpen = true;
  /* An untouched blank is reused rather than stacking up empties. One holding
     a draft is somebody's half-written message, and is left where it is. */
  let c = state.chats.find(x => isEmpty(x) && !hasDraft(x));
  if (!c) {
    c = blankChat();
    state.chats.unshift(c);
  }
  state.activeChatId = c.id;
  loadComposer();
  state.compose = { chatId: c.id, picked: false, byDefault: false, q: '', hi: 0, from, suggest: '' };
  /* "New chat with <name>" arrives with To: filled in. A Pigeon the running
     server has not loaded yet is filled in too — sending to it loads it. With
     nobody named it is Patch, marked `byDefault` so the field can offer
     someone else rather than only a way to take him off. A default is not a
     choice, so it never becomes `lastPick`. */
  const chosen = pick || 'patch';
  const d = pigeonOf(chosen, personas, patchState);
  if (canMessage(d)) {
    Object.assign(c, chatFieldsFor(chosen));
    state.compose.picked = true;
    state.compose.byDefault = !pick;
    if (pick) state.settings.lastPick = pick;
  }
  persist();
  paint();
  focusComposer();
}

/* Who a new chat is for. Only while it is still empty: a chat that has been
   asked something stays with whoever answered it, for life. */
function composeTo (pick) {
  const c = state.compose && chatById(state.chats, state.compose.chatId);
  if (!c || !isEmpty(c)) return;
  const d = pigeonOf(pick, personas, patchState);
  if (!canMessage(d)) {
    toast(d.kind === 'verified' ? patchNotReady() : d.line, 4200);
    return;
  }
  Object.assign(c, chatFieldsFor(pick));
  state.compose.picked = true;
  state.compose.byDefault = false;
  state.compose.q = '';
  state.compose.hi = 0;
  state.settings.lastPick = pick;
  persist();
  paint();
  focusComposer();
}

/* Take the Pigeon off To:. What was typed stays exactly where it is — and it
   is carried into the list as the words to suggest from, so someone who typed
   a sum and then went looking for another name is still told Patch can work
   it out. The suggestion's own guards (a transcript, over 60 words) still
   decide whether it is shown. */
function clearTo () {
  if (!state.compose) return;
  const box = $('msg');
  state.compose.picked = false;
  state.compose.byDefault = false;
  state.compose.suggest = box ? String(box.value || '').trim() : '';
  paint();
  focusComposer();
}

/* Stop composing without sending, and go back to the chat you came from. A
   blank chat with something typed in it stays in the list, so nothing typed
   goes missing. */
function leaveCompose () {
  const from = state.compose && state.compose.from;
  state.compose = null;
  if (from && from !== state.activeChatId && chatById(state.chats, from)) switchChat(from);
  else { persist(); paint(); }
}

function focusComposer () {
  if (typeof document === 'undefined') return;
  const el = state.compose && !state.compose.picked ? $('toInput') : $('msg');
  if (el && !el.disabled) el.focus();
}

/* Open a conversation from the list, a search hit or a profile. A search hit
   names the message as well, and the thread opens on it. */
function openChat (id, { turnId = null } = {}) {
  if (!chatById(state.chats, id)) return;
  state.view = 'chat';
  state.profile = null;
  state.paneOpen = true;
  if (turnId) scrollToTurn = turnId;
  if (state.compose || id !== state.activeChatId) { switchChat(id); return; }
  paint();
}

/* A Pigeon's page, from the Pigeons tab. */
function openProfile (pick) {
  stashComposer();
  state.compose = null;
  state.view = 'chat';
  state.profile = pick;
  state.details = false;
  state.paneOpen = true;
  paint();
}

/* Sending from the composer. Writing first and choosing after is how a new
   message works in any messaging app, so a new chat with nobody on To: is not
   refused: Enter opens To: with what was written kept exactly where it is, and
   when the words match one of Patch's skills he is suggested first. Nothing is
   sent until someone is chosen. One with somebody on To: becomes an ordinary
   chat the moment something is actually sent. */
function sendFromComposer (text) {
  if (state.compose && !state.compose.picked) {
    const typed = String(text || '').trim();
    if (typed) Object.assign(state.compose, { suggest: typed, q: '', hi: 0 });
    paintToList();
    const to = $('toInput');
    if (to) to.focus();
    return;
  }
  /* Sending past a soft note is waving it away; after two in a chat, the
     notes stop for that chat. */
  const waved = noteFor(activeChat(), text);
  if (waved && waved.kind !== 'length') {
    const here = activeChat();
    here.noteSkips = Math.min(99, (here.noteSkips || 0) + 1);
  }
  if (state.compose && (String(text || '').trim() || (attachment && attachment.status === 'ready'))) state.compose = null;
  say(text);
}

/* Always returns a chat. An app with no conversations still has to render a
   composer, and "no active chat" is a state nothing downstream wants to handle. */
function activeChat () {
  let c = state.chats.find(x => x.id === state.activeChatId);
  if (!c) {
    c = state.chats[0] || blankChat();
    if (!state.chats.includes(c)) state.chats.unshift(c);
    state.activeChatId = c.id;
  }
  return c;
}

/* Move to the previous or next version, and show it. */
function switchVersion (turnId, delta) {
  const landed = switchTo(activeChat(), turnId, delta);
  if (!landed) return;
  state.editing = null;
  scrollToTurn = landed;
  persist();
  paint();
}

/* Nothing is written until the saved chats have been read. Before that, the
   only chats in memory are the blank one the first paint needed — and writing
   those would replace everything on disk with nothing, which a window losing
   focus at launch was enough to do. */
let restoreDone = false;

function persist () {
  if (!restoreDone) return;
  stashComposer();
  nameChat(activeChat());
  saveState({ version: STATE_VERSION, activeChatId: state.activeChatId, chats: forDisk(state.chats), settings: state.settings });
}

const $ = (id) => document.getElementById(id);
/* A turn's identity, stable for as long as the turn exists. Everything that
   used to key off the array index — which panel is open, which turn to scroll
   to, which turn a button belongs to — keys off this instead, so inserting,
   truncating or reordering turns cannot silently point at the wrong one. */
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

/* ── small shared UI ─────────────────────────────────────────────────────── */

let toastTimer;
function toast (msg, ms) {
  logShown('notice', { sentence: msg, where: 'toast' });
  const t = $('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('on'), ms || 2600);
}

/* A drawing to a file the person picks. The page hands Rust the Pigeon and the
   recipe it answered with, never the picture and never a path: Rust draws the
   recipe again from that Pigeon's own parts and writes what it drew
   (pigeon.rs pigeon_save_drawing). A cancelled dialog says nothing. */
async function saveDrawing (pigeonId, recipe) {
  const call = pigeonInvoke();
  if (!call) { toast('Saving a drawing needs the Pigeon app — Copy image works here.', 4200); return; }
  try {
    const name = await call('pigeon_save_drawing', { req: { pigeon: pigeonId, text: recipe } });
    if (name) toast(`Saved “${name}”`);
  } catch (e) {
    toast(`Couldn’t save the drawing — ${(e && e.message) || e}`, 4600);
  }
}

/* A drawing onto the clipboard as a picture, rasterised here in the page from
   the SVG Rust drew — nothing is written to disk on the way. */
async function copyDrawing (svg) {
  try {
    const img = new Image();
    await new Promise((ok, no) => { img.onload = ok; img.onerror = no; img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`; });
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    canvas.getContext('2d').drawImage(img, 0, 0, 512, 512);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    toast('Copied the drawing as an image');
  } catch (e) {
    toast(`Couldn’t copy the drawing — ${(e && e.message) || e}`, 4200);
  }
}

async function copyText (text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Copied.');
  } catch {
    /* The clipboard API is refused on some origins. Fall back rather than
       telling the user their copy button is broken. */
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    /* execCommand says false, rather than throwing, when the copy was
       refused; "Copied." then would be untrue. */
    let copied = false;
    try { copied = document.execCommand('copy'); } catch { copied = false; }
    toast(copied ? 'Copied.' : `Couldn’t copy. Select the text and press ${/^Mac/.test(navigator.platform) ? '⌘C' : 'Ctrl+C'} instead.`);
    ta.remove();
  }
}

/**
 * Make a group of role="tab" or role="radio" buttons behave the way its role
 * promises.
 *
 * Both roles tell a screen reader "this is a group, use the arrow keys", and
 * both were drawn as plain buttons: the arrows did nothing, and every option in
 * the group was its own Tab stop — five presses to get past Settings' tabs, four
 * to get past a three-way switch. The roles were making a claim the markup did
 * not keep, which is worse than not making it.
 *
 * So: one Tab stop for the whole group (the selected item holds it, the rest are
 * taken out of the order — "roving tabindex"), and the arrows move through it.
 * Moving SELECTS as it goes, because that is required of a radiogroup and is
 * what a tablist showing its own panel should do.
 *
 * Safe to call on every repaint: it assigns one handler rather than adding one,
 * and it reads which item is current off the markup instead of remembering.
 */
function rovingGroup (group) {
  if (!group) return;
  const items = [...group.querySelectorAll('[role="tab"],[role="radio"]')];
  if (!items.length) return;
  const on = (b) => b.getAttribute('aria-selected') === 'true' || b.getAttribute('aria-checked') === 'true';
  const at = Math.max(0, items.findIndex(on));
  items.forEach((b, i) => { b.tabIndex = i === at ? 0 : -1; });
  group.onkeydown = (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    const step = keys[e.key];
    const ends = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : null;
    if (step === undefined && ends === null) return;
    e.preventDefault();
    const from = items.indexOf(document.activeElement);
    const next = ends !== null
      ? items[ends]
      : items[((from < 0 ? at : from) + (step === 1 ? 1 : items.length - 1)) % items.length];
    if (!next || next.disabled) return;
    next.focus();
    /* The click is what actually changes the setting or the tab. Whatever it
       repaints, the focus restore in the redraw puts the keyboard back on the
       item by name — see openSettings. */
    next.click();
  };
}

/* What the keyboard can reach, in the order it reaches it. */
const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
/* The dialogs that are open, oldest first. Only the last one answers the
   keyboard: before this existed every open sheet had its own Escape handler on
   the document, so one press closed the lot. */
const sheetStack = [];

/* Every dialog in the app goes through here. Appended to <body>, which is
   outside everything paint() rebuilds — a repaint mid-dialog would otherwise
   delete the dialog. Backdrop click and Escape both dismiss, and dismissing is
   always the safe answer, never the destructive one.
 *
 * What was missing was everything the keyboard and a screen reader need to know
 * a dialog is there at all. A plain <div> over a dimmed page reads as more page:
 * "Delete this chat?" was announced as ordinary content, Tab walked straight out
 * of the card and into the conversation behind it — where every click lands on
 * the backdrop and does nothing — and closing the dialog dropped the keyboard at
 * the top of the document rather than back where it came from. So, here, once,
 * for all of them: the card says it is a dialog and says its own name, Tab
 * cycles inside it, the page behind is hidden from assistive tech while it is
 * up, and the keyboard goes back to whatever opened it. */
function openSheet (html, onWire) {
  const host = document.createElement('div');
  host.className = 'sheet';
  host.innerHTML = html;
  document.body.appendChild(host);

  /* Where the keyboard was standing, to give it back on the way out. */
  const cameFrom = document.activeElement;
  /* The card is the dialog; the host is the dimmed backdrop around it. Settings
     names its own card, so nothing here overwrites a label that already says
     something better than the title would. */
  const card = host.querySelector('.sheet-card') || host;
  if (!card.hasAttribute('role')) card.setAttribute('role', 'dialog');
  if (!card.hasAttribute('aria-label')) {
    const title = card.querySelector('.sheet-title');
    if (title) card.setAttribute('aria-label', title.textContent.trim());
  }
  card.setAttribute('aria-modal', 'true');

  const app = $('app');
  const close = () => {
    const i = sheetStack.indexOf(host);
    if (i < 0) return;
    sheetStack.splice(i, 1);
    host.remove();
    document.removeEventListener('keydown', onKey);
    /* The page comes back only when the LAST dialog has gone. */
    if (!sheetStack.length && app) app.removeAttribute('aria-hidden');
    if (cameFrom && cameFrom.focus && document.contains(cameFrom)) cameFrom.focus();
  };
  function onKey (e) {
    /* Only the dialog on top answers. */
    if (sheetStack[sheetStack.length - 1] !== host) return;
    if (e.key === 'Escape') { close(); return; }
    if (e.key !== 'Tab') return;
    const items = [...host.querySelectorAll(FOCUSABLE)];
    if (!items.length) { e.preventDefault(); return; }
    const edge = e.shiftKey ? items[0] : items[items.length - 1];
    if (!host.contains(document.activeElement) || document.activeElement === edge) {
      e.preventDefault();
      (e.shiftKey ? items[items.length - 1] : items[0]).focus();
    }
  }
  host.onclick = (e) => { if (e.target === host) close(); };
  host.querySelectorAll('[data-close]').forEach(b => { b.onclick = close; });
  /* The pop-in is for opening only: once it has played, a card this sheet
     redraws in place appears without it (app.css, .sheet.settled). */
  setTimeout(() => host.classList.add('settled'), 250);
  sheetStack.push(host);
  if (onWire) onWire(host, close);
  /* A wiring that dismissed the sheet on the spot has already put everything
     back; carrying on would hide the page behind a dialog that is not there. */
  if (!sheetStack.includes(host)) return close;
  /* Callers that want a particular button focused — the safe one on a delete,
     Don't send on a look-up — have done it in onWire. Everything else gets the
     first thing in the card, so the keyboard is never left outside the dialog
     it is supposed to be answering. */
  if (!host.contains(document.activeElement)) {
    const first = host.querySelector(FOCUSABLE);
    if (first) first.focus();
    else { card.setAttribute('tabindex', '-1'); card.focus(); }
  }
  /* Set last, once the keyboard is already inside: hiding a subtree that still
     holds the focus is the one way to make this worse than it was. */
  if (app) app.setAttribute('aria-hidden', 'true');
  document.addEventListener('keydown', onKey);
  return close;
}

/* ── the conversation list ──────────────────────────────────────────────── */
function paintList () {
  /* Every paint draws the list, so the chosen theme is on the root from the
     first frame after the settings are restored. */
  applyTheme();
  const rows = $('rows');
  if (!rows) return;
  document.querySelectorAll('[data-tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === state.tab)));
  /* Re-applied after the selection changes, because which item holds the Tab
     stop follows which one is selected. */
  rovingGroup(document.querySelector('.tabs[role="tablist"]'));
  const box = $('listSearch');
  if (box) box.placeholder = state.tab === 'pigeons' ? 'Search Pigeons' : 'Search';
  /* One button at the top of the list: New chat on Chats, Add a Pigeon on Pigeons. */
  const pigeons = state.tab === 'pigeons';
  if ($('composeBtn')) $('composeBtn').hidden = pigeons;
  if ($('addPigeonBtn')) $('addPigeonBtn').hidden = !pigeons;
  const q = state.search.trim();
  const keep = rows.scrollTop;
  rows.innerHTML = downloadStrip() + (state.tab === 'pigeons'
    ? pigeonsTabHtml({ personas, q, profile: state.profile, patchState, pinned: state.settings.pinnedPigeons || {} })
    : q
      ? searchHtml(q, { chats: state.chats, personas, patchState })
      : chatListHtml({
        chats: state.chats,
        activeId: state.view === 'chat' && !state.profile ? state.activeChatId : null,
        compose: state.compose ? { chatId: state.compose.chatId, to: state.compose.picked ? pickForChat(activeChat()) : null } : null,
        personas
      }));
  rows.scrollTop = keep;
  paintListFoot();
}

/* Why the chats are not being saved, in the rail's clipped voice and in
   Settings' fuller one. Both read the same three reasons, so they cannot drift
   apart, and the writes-are-failing case is checked first: it is the only one
   that can start MID-session, and the only one a person can act on. */
const HOLD_LINES = {
  newer: ['a newer Pigeon wrote the file', 'Not saved — a newer Pigeon wrote the file'],
  unread: ['the file could not be read', 'Not saved — the chats file is there but could not be read'],
  corrupt: ['the file could not be read', 'Not saved — the chats file could not be read or moved aside']
};
const holdLine = (long) => (HOLD_LINES[holdReason()] || HOLD_LINES.unread)[long ? 1 : 0];
const savedLine = () => (saveFailing() ? 'not saved · this Mac refused the write'
  : isReadOnly() ? `not saved · ${holdLine(false)}`
    : canPersist() ? 'saved to disk' : 'this session only');

/* The honest status strip: every model seam, and what is actually running
   behind it. It used to sit under the list at all times; it is now one click
   in, and its short version — the list's last line — is always showing. */
function stackRowsHtml () {
  const stack = stackReport({
    router, planner, extractor, assembler, focus, model: modelName,
    ocr: ocr ? { engine: ocrDetail?.engine } : null,
    laneB: chatBridge() ? { ready: Boolean(chat), personas: personas.filter(p => p.loaded).length } : null,
    engine: engine ? { status: engineStatus, models: modelsInfo ? { ...modelsInfo, downloading: downloading || modelsInfo.downloading } : null } : null
  });
  return `${stack.map(s => `<div class="stackrow ${s.pass === 'models' && engine ? 'clickable' : ''}" data-pass="${s.pass}" title="${esc(s.detail)}">
      <span class="dot ${s.state === 'on' ? 'on' : s.state === 'sub' ? 'sub' : 'off'}"></span>
      <b>${s.pass}</b><span>${esc(s.detail)}</span></div>`).join('')}
    <div class="stackrow" title="${saveFailing()
      ? 'The last two saves were refused by this Mac — a full disk, or a data directory Pigeon can no longer write to. It keeps trying'
      : isReadOnly()
        ? `${holdLine(true)}. Pigeon leaves that file exactly as it is and saves nothing this session`
        : canPersist()
          ? 'Chats are written to one file in this app\'s own data directory'
          : 'Opened in a browser, where there is no way to write to disk'}">
      <span class="dot ${canPersist() && !isReadOnly() && !saveFailing() ? 'on' : 'off'}"></span>
      <b>chats</b><span>${savedLine()}</span></div>`;
}

/* Whether the models are up, in the words the list's last line uses. */
function modelsState () {
  if (engine) {
    if (!engineStatus) return ['off', 'models unknown'];
    if (engineStatus.disabled) return ['off', 'models off'];
    const roles = [engineStatus.category];
    if (roles.some(r => r?.phase === 'error')) return ['sub', 'a model failed'];
    if (roles.some(r => r?.phase === 'waking')) return ['sub', 'models waking'];
    if (roles.some(r => r?.phase === 'ready')) return ['on', 'models awake'];
    return ['off', 'models asleep'];
  }
  return planner || categoryModel ? ['on', 'models running'] : ['off', 'no models running'];
}

/* The list's last line is Settings now; This build lives inside it, under
   Models. */
function paintListFoot () {
  const foot = $('listFoot');
  if (foot) {
    foot.innerHTML = `${ICONS.gear}<span>Settings</span>`;
    foot.title = 'Settings (⌘,)';
  }
  /* The sheet, if it is open, follows the engine as it wakes and sleeps. */
  const open = $('buildStack');
  if (open) open.innerHTML = stackRowsHtml();
}

/* Settings: a sheet in this window, five tabs, each change saved as it is made. */
function openSettings (tab = 'general') {
  /* Save logs…'s range while the sheet is open; not a setting. */
  const logs = { range: '7', from: '', to: '' };
  const card = (t) => settingsHtml({
    logs,
    dev: devBuild(),
    native: Boolean(pigeonInvoke()),
    tab: t,
    settings: state.settings,
    models: {
      words: (() => { const w = modelsState()[1]; return w.charAt(0).toUpperCase() + w.slice(1); })(),
      canWake: Boolean(engine),
      awake: modelsState()[0] === 'on',
      buildRows: stackRowsHtml(),
      store: storeRows
    },
    pigeons: [...builtInPigeons(personas, patchState), ...personas.map(p => pigeonOf(`pigeon:${p.id}`, personas))]
      .map(d => ({ pick: d.pick, name: d.name, does: d.does, removable: d.kind === 'voice' || d.kind === 'job' })),
    saved: !canPersist() ? 'This session only — a browser writes nothing to disk'
      : saveFailing() ? 'Not saved — this Mac refused the last two writes. Pigeon is still trying'
        : isReadOnly() ? holdLine(true)
          : 'Saved on this Mac, and nowhere else'
  });
  let current = tab;
  /* The models on this Mac, fetched once per opening — a scan of a folder
     holding tens of gigabytes is not something to repeat on every redraw. */
  let storeRows = null;
  const loadStore = async (then) => {
    const call = pigeonInvoke();
    if (!call) return;
    try {
      const list = await call('models_on_this_mac');
      storeRows = list.map(m => ({ path: m.path, name: m.name, kind: m.kind, size: fmtSize(m.bytes), usedBy: m.used_by }));
    } catch (e) { storeRows = []; toast(friendly(e), 4200); }
    then();
  };
  /* The tab strip and every segmented control in the body: one Tab stop each,
     arrows inside them. Re-run after every rebuild, since the card is markup. */
  const wireGroups = (root) => {
    rovingGroup(root.querySelector('.st-tabs'));
    root.querySelectorAll('.st-seg').forEach(rovingGroup);
  };
  openSheet(card(current), (host, close) => {
    /* Which control this is, by what it DOES rather than where it sits, so the
       same button can be found again in markup that has just been rebuilt. */
    const keyOf = (el) => {
      if (!el || !el.dataset) return null;
      if (el.dataset.stTab) return `tab:${el.dataset.stTab}`;
      if (el.dataset.set) return `set:${el.dataset.set}:${el.dataset.value}`;
      if (el.dataset.s) return `do:${el.dataset.s}:${el.dataset.pick || ''}`;
      return el.hasAttribute('data-close') ? 'close' : null;
    };
    /* Settings is drawn from strings, so every click here rebuilds the whole
       card. That used to drop keyboard focus to the top of the document each
       time — choosing a theme and then a sleep period meant Tabbing in from the
       beginning twice — and took the scroll position and the open "This build"
       drawer with it, so reading down the Privacy log and changing anything
       sent you back to the top.
       The window's own paint() has always been careful about exactly this (see
       the keepBox/keepScroll dance in paint); sheets simply never went through
       it. So: note where the person is, redraw, put them back. Moving TO
       another tab is the one case where none of it should be restored — it is
       different content, and landing halfway down it would be the bug — but the
       tab button itself is still refocused, because that is where the keyboard
       genuinely is. */
    const redraw = ({ sameTab = true } = {}) => {
      const old = host.querySelector('.settings-card');
      if (!old) return;
      const focusKey = old.contains(document.activeElement) ? keyOf(document.activeElement) : null;
      const scroll = sameTab ? (old.querySelector('.st-body')?.scrollTop || 0) : 0;
      const drawers = sameTab ? [...old.querySelectorAll('details')].map(d => d.open) : [];
      old.outerHTML = card(current);
      const fresh = host.querySelector('.settings-card');
      if (!fresh) return;
      [...fresh.querySelectorAll('details')].forEach((d, i) => { if (drawers[i] !== undefined) d.open = drawers[i]; });
      const body = fresh.querySelector('.st-body');
      if (body && scroll) body.scrollTop = scroll;
      wireGroups(fresh);
      if (focusKey) {
        /* The same control if it is still there; otherwise the tab it lives on,
           which always is. Anything rather than the top of the document — a
           control that vanishes (Wake the models, once they are awake) must not
           take the keyboard out of the sheet with it. */
        const back = [...fresh.querySelectorAll('button')].find(b => keyOf(b) === focusKey)
          || fresh.querySelector(`[data-st-tab="${current}"]`);
        if (back) back.focus();
      }
      host.querySelectorAll('[data-close]').forEach(b => { b.onclick = close; });
    };
    wireGroups(host);
    loadStore(() => redraw());
    host.addEventListener('change', (e) => {
      const f = e.target.closest('[data-logs]');
      if (f) logs[f.dataset.logs] = f.value;
    });
    host.addEventListener('click', async (e) => {
      const tabBtn = e.target.closest('[data-st-tab]');
      if (tabBtn) { current = tabBtn.dataset.stTab; redraw({ sameTab: false }); return; }
      const set = e.target.closest('[data-set]');
      if (set && set.dataset.set === 'logsRange') { logs.range = set.dataset.value; redraw(); return; }
      if (set) {
        const v = set.dataset.value;
        if (set.dataset.set === 'theme') state.settings.theme = v;
        if (set.dataset.set === 'banners') state.settings.bannersOff = v === 'off';
        if (set.dataset.set === 'webPolicy') state.settings.webPolicy = v;
        if (set.dataset.set === 'saveMenuBar') state.settings.saveMenuBar = v !== 'off';
        if (set.dataset.set === 'devMenu') {
          state.settings.devMenu = v === 'on';
          const call = pigeonInvoke();
          if (call) call('set_dev_menu', { on: state.settings.devMenu }).catch((err) => toast(friendly(err), 4200));
        }
        if (set.dataset.set === 'sleepAfter') {
          state.settings.sleepAfter = Number(v);
          if (engine && engine.setIdleUnload) engine.setIdleUnload(Number(v)).catch((err) => toast(friendly(err), 4200));
        }
        persist();
        paint();
        redraw();
        return;
      }
      const s = e.target.closest('[data-s]');
      if (!s) return;
      const what = s.dataset.s;
      if (what === 'skills' || what === 'plan' || what === 'ledger') { close(); openView(what); return; }
      if (what === 'models') { close(); openModelsSheet(); return; }
      if (what === 'import') { close(); importPigeon(); return; }
      if (what === 'remove') { close(); askRemovePigeon(s.dataset.pick); return; }
      if (what === 'rm-model') { close(); await removeModel(s.dataset.pick, false); return; }
      if (what === 'logs-save') { await saveLogs(logs); return; }
      if (what === 'logs-reveal') {
        const call = pigeonInvoke();
        if (call) call('logs_reveal').catch((err) => toast(friendly(err), 4200));
        return;
      }
      if (what === 'wake') { toast('Waking the models…'); await wakeEngine(); redraw(); return; }
      if (what === 'sleep') {
        try { await engine.sleep(); } catch (err) { toast(friendly(err), 4600); }
        await refreshEngine();
        redraw();
      }
    });
  });
}

/* Save logs…: Rust joins the days and asks where to put the file. */
async function saveLogs ({ range, from, to }) {
  const call = pigeonInvoke();
  if (!call) return;
  try {
    const name = await call('logs_save', { range, from: from || null, to: to || null });
    if (name) toast(`Saved ${name}`, 3600);
  } catch (err) { toast(friendly(err), 4600); }
}

/* The theme the person chose, on the root element: tokens.css does the rest,
   including Match Mac. Light is the default Pigeon has always had. */
function applyTheme () {
  if (typeof document === 'undefined') return;
  const t = state.settings && state.settings.theme;
  const theme = t === 'dark' || t === 'light' ? t : 'system';
  document.documentElement.dataset.theme = theme;
  /* The window's title bar is AppKit's and follows the window, not the page:
     told once per change, so a dark choice on a light Mac is not black on
     near-black up there (appearance.rs). Every paint calls this, hence the check. */
  if (theme !== windowTheme) {
    windowTheme = theme;
    const core = globalThis.__TAURI__?.core;
    if (core && typeof core.invoke === 'function') Promise.resolve(core.invoke('window_theme', { theme })).catch(() => {});
  }
  /* The menu-bar popover draws with the same choice. */
  const ev = globalThis.__TAURI__?.event;
  if (ev && typeof ev.emitTo === 'function') Promise.resolve(ev.emitTo('popover', 'theme', theme)).catch(() => {});
}
let windowTheme = null;

/* Skills, Run a plan and the Ledger, shown in the conversation pane until they
   move to windows of their own. */
/* A release build has no developer views and no Developer menu: the engine
   says which build this is. A browser tab, with no engine, is a developer's. */
function devBuild () {
  return !engineStatus || engineStatus.dev_build !== false;
}

function openView (view) {
  stashComposer();
  state.compose = null;
  state.profile = null;
  state.details = false;
  state.view = view;
  state.paneOpen = true;
  paint();
}

/* Rename, pin, unread, alerts, another chat with the same Pigeon, delete.
   Rename and delete go through a dialog rather than an inline input: the list
   is rebuilt wholesale, so an input living in a row would be destroyed by any
   incidental repaint — a model finishing detection, say — halfway through
   typing a name. */
function openChatMenu (at, id) {
  const c = chatById(state.chats, id);
  if (!c) return;
  openMenu(at, chatMenuItems(c, pigeonOf(pickForChat(c), personas, patchState)), (what) => chatAction(what, c.id));
}

/* A Pigeon's menu, from its ⋯ on the Pigeons tab or a right-click there. */
function openPigeonMenu (at, pick) {
  const d = pigeonOf(pick, personas, patchState);
  if (!d) return;
  openMenu(at, pigeonMenuItems(d, { pinned: Boolean((state.settings.pinnedPigeons || {})[pick]) }), (what) => {
    if (what === 'pin-pigeon') togglePigeonPin(pick);
    else if (what === 'new-with') startCompose(pick);
    else if (what === 'page') openProfile(pick);
    else if (what === 'remove-pigeon') askRemovePigeon(pick);
  });
}

/* Pinned Pigeons sit in a grid at the top of the Pigeons tab, in the order
   they were pinned, the way pinned chats do. Kept in settings, beside the
   chats, so the pin survives a relaunch. */
function togglePigeonPin (pick) {
  const pins = { ...(state.settings.pinnedPigeons || {}) };
  if (pins[pick]) delete pins[pick]; else pins[pick] = Date.now();
  state.settings.pinnedPigeons = pins;
  persist();
  paint();
}

function chatAction (what, id) {
  const c = chatById(state.chats, id);
  if (!c) return;
  if (what === 'rename') return askRename(c);
  if (what === 'delete') return askDelete(c);
  if (what === 'new-with') return startCompose(pickForChat(c));
  if (what === 'pin') togglePin(c);
  else if (what === 'unread') markUnread(c, !c.unread);
  else if (what === 'mute') toggleMute(c);
  else return;
  persist();
  paint();
}

/* What a Pigeon runs on and what it can do, read off the stack as it is right
   now rather than what it was built to be. */
function pigeonFacts (d) {
  if (d.kind === 'verified') {
    return [
      ['Answers with', registry ? `${registry.routable().length} tested skills` : patchNotReady()],
      ['Understands with', modelName || 'no model running · one skill per question'],
      ['Picks skills with', categoryModel ? `a trained model · ${categoryModel}` : 'word matching'],
      ...(patchState.info?.pigeons?.length ? [['Pigeons in his nest', patchNestLine(patchState.info.pigeons)]] : []),
      ['Leaves this Mac', state.settings.webPolicy === 'never' ? 'nothing · the web is off (Settings › Privacy)' : state.settings.webPolicy === 'fallback' ? 'only a look-up you say yes to' : 'only a look-up you ask for and say yes to']
    ];
  }
  const runsOn = ['Model', categoryModel || (chat ? 'the chat model' : 'the chat model, which is asleep')];
  const computes = ['Works out', 'nothing · it writes every word'];
  /* The picture server, said the same way for Peek and every picture Pigeon:
     it is started by the first picture, not by a wake. */
  const vision = engineStatus && engineStatus.vision;
  const pictureLoaded = (holds) => (vision && vision.phase === 'ready' && holds
    ? 'yes'
    : vision && vision.phase === 'waking' ? 'starting now' : 'not yet · your first message starts the picture model');
  if (d.kind === 'base') return [['Reads', readsLine(d)], runsOn, computes];
  if (d.kind === 'peek') {
    return [
      ['Kind', 'the picture model as it comes · it talks in a conversation'],
      ['Reads', readsLine(d)],
      ['Model', d.model ? `${d.model} · the picture model, with nothing trained on it` : 'not on this Mac'],
      ['Loaded', d.model ? pictureLoaded(true) : 'no'],
      computes
    ];
  }
  const p = personas.find(x => x.id === d.id);
  if (!p) return [['On this Mac', 'no · it has been removed']];
  /* A picture Pigeon runs on its own base on the picture server, never on the
     chat model — this row used to name the chat model for every Pigeon. */
  const sees = canBeSentAPicture(p);
  const held = sees && vision && (vision.personas || []).some(x => x.id === p.id);
  return [
    ['Kind', isVoice(p) ? 'a voice · it talks in a conversation' : `${p.kind} · one input, one output`],
    ...(p.bytes ? [['Size', fmtSize(p.bytes)]] : []),
    ...(p.max_tokens ? [['Reply length', `up to ${p.max_tokens} tokens`]] : []),
    ['Reads', readsLine(p)],
    ...pressesRows(p),
    sees ? ['Model', p.base ? `${p.base} · the picture model` : 'the picture model'] : runsOn,
    ['Loaded', sees ? pictureLoaded(held) : p.loaded ? 'yes' : 'not yet · your first message loads it'],
    computes,
    /* From its report.json (D95, D97): where its maker's test rows came from,
       and where it was trained. */
    ...(p.report ? [['Test rows from', p.report.rows_source || 'not recorded'], ['Trained on', p.report.trained_where || 'not recorded']] : [])
  ];
}

/* What can be put in, said as two facts joined rather than one: what the file
   DECLARES, and what this app can actually hand it. They come apart — a file
   from a newer authoring tool can ask for a picture this build cannot give it —
   and a row that reported only the first would be a promise the app then
   breaks. "Runs on Qwen2.5-1.5B-Instruct-Q4_K_M.gguf" is a filename; somebody
   holding a photograph of a dog needs the fact under it. */
function readsLine (p) {
  if (p && p.kind === 'peek') return 'text and pictures · it sees the picture itself';
  if (!declaresImage(p)) return 'text only · a picture reaches it as the words read off it, never as the picture';
  return canBeSentAPicture(p)
    ? 'text and pictures · it sees the picture itself'
    : 'text · its file asks for pictures too, but it was trained on a model that reads text only, so it is handed the words read off a picture';
}

/* A picture Pigeon made by recording presses keys when it plays
   (docs/PLAY-LOOP.md). Its facts say which, and how long it holds each — or
   that it was packed before Flight School wrote that down. */
function pressesRows (p) {
  if (!canBeSentAPicture(p) || !(p.labels || []).some(l => /^KEY\(/.test(l))) return [];
  if (!p.presses) return [['Presses', 'not known · it was packed before Flight School recorded which key each answer is — send it from Flight School again to play it']];
  const keys = p.presses.keys.map(k => `${k.answer.slice(4, -1)} = ${k.key}${k.hold_ms ? ` (${(k.hold_ms / 1000).toFixed(2)} s)` : ' (a tap)'}`);
  const skipped = (p.presses.not_pressed || []).map(k => `${k.key} never pressed — ${k.why}`);
  return [['Presses', [...keys, ...skipped].join(' · ') || 'nothing']];
}

/* Copy diagnostics (Details for developers): the build and this Mac and the
   log's last hour from Rust, this chat's turns and the open warnings from
   here, onto the clipboard. Nothing is sent anywhere. */
async function copyDiagnostics (c) {
  if (!c) return;
  const call = pigeonInvoke();
  let fromRust = { header: '', lines: [] };
  if (call) { try { fromRust = await call('diagnostics_log'); } catch (e) { fromRust.header = `(the log could not be read: ${(e && e.message) || e})`; } }
  const d = pigeonOf(pickForChat(c), personas, patchState);
  const persona = d.id ? personas.find(p => p.id === d.id) || null : null;
  const warnings = (persona ? persona.notes || [] : []).map(n => ({ pigeon: d.name, code: n.code, text: noteWords(n).text }));
  if (!persona && patchState) {
    const said = (patchState.info && patchState.info.note) || (patchState.state === 'unavailable' ? patchState.reason : null);
    if (said) warnings.push({ pigeon: 'Patch', code: patchState.state === 'unavailable' ? 'unavailable' : 'note', text: said });
  }
  const text = diagnosticsText({
    header: fromRust.header, lines: fromRust.lines || [], chat: c.title, pigeon: d.name, warnings,
    turns: pathOf(c).map(turn => ({ turn, receipt: receiptLine(turn) }))
  });
  /* Rust puts it on the pasteboard: WebKit refuses a page's clipboard write
     once the click has waited on anything, and this one waited on the log. */
  if (!call) { await copyText(text); return; }
  try {
    const n = await call('diagnostics_copy', { text });
    toast(`Copied diagnostics (${n.toLocaleString()} characters). Nothing was sent.`, 3600);
  } catch (e) { toast(`Couldn’t copy the diagnostics — ${(e && e.message) || e}`, 4600); }
}

function chatFacts (c) {
  const n = pathOf(c).length;
  return [
    ['Started', new Date(c.createdAt || Date.now()).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })],
    ['Questions', n ? String(n) : 'none yet']
  ];
}

/* Everything in the header, the To: list, the details panel and a Pigeon's
   page says what it wants with data-do, and ends up here. */
function paneAction (what, el) {
  const c = activeChat();
  switch (what) {
    case 'back':
      state.paneOpen = false;
      if (state.compose) leaveCompose(); else paint();
      return;
    case 'details': state.details = !state.details; state.info = null; paint(); return;
    /* The name in a chat's header opens that Pigeon's page. */
    case 'page': openProfile(el.dataset.pick); return;
    case 'close-details': state.details = false; paint(); return;
    case 'copy-diagnostics': copyDiagnostics(c); return;
    case 'info': state.info = el.dataset.turn; state.details = false; paint(); return;
    case 'close-info': state.info = null; paint(); return;
    /* × on the reply bar: the question goes unanswered, and whatever was
       queued behind it is free to go as a new question. */
    case 'skip-ask':
      if (skipAsk(c)) { persist(); paint(); drainQueue(c.id); }
      return;
    case 'send-queued': warmSoon(); drainQueue(c.id); return;
    case 'drop-queued':
      if (dropQueued(c, el.dataset.id)) { persist(); paint(); }
      return;
    case 'change-value': changeValueFrom(el.dataset.turn, el.dataset.field, el.dataset.shown); return;
    /* Look it up…: the same question again, as a new version, allowed the web
       for that one turn — and the sheet still asks before anything is sent. */
    case 'look-it-up': {
      const t = chatNodes(c)[el.dataset.turn];
      if (!t) return;
      if (state.settings.webPolicy === 'never') { toast('Pigeon is set never to use the web (Settings › Privacy).', 4200); return; }
      if (!search) { toast('No web search is connected in this build.', 4200); return; }
      /* Asked again, the look-up now stops on its own card and asks there. */
      say(t.message, { chatId: c.id, parentId: t.parentId ?? null, attach: null, fromComposer: false });
      return;
    }
    /* The same question to Pen again, as a new version, asking for no figures. */
    case 'pen-no-amounts': {
      const t = chatNodes(c)[el.dataset.turn];
      if (!t || !t.message) return;
      chatOptions.set(c.id, { noAmounts: true });
      sayInLaneB(t.message, t.parentId ?? null, c.id);
      return;
    }
    /* The picture went with Pigeon when it closed: pick it again, then send. */
    case 'attach-again': {
      const f = $('imgFile');
      if (f) f.click(); else toast('Attach the picture again with the image button.');
      return;
    }
    /* A reply cut off at its budget, carried on as an ordinary "Continue". */
    case 'keep-going': {
      const t = chatNodes(c)[el.dataset.turn];
      if (!t || !t.reply) return;
      chatOptions.set(c.id, { continuing: t });
      sayInLaneB('Continue', t.id, c.id);
      return;
    }
    case 'copy-drawing': {
      const t = chatNodes(c)[el.dataset.turn];
      if (t && t.rendered) copyDrawing(t.rendered);
      return;
    }
    case 'save-drawing': {
      const t = chatNodes(c)[el.dataset.turn];
      if (t && t.rendered && t.reply) saveDrawing(c.personaId, t.reply.text);
      return;
    }
    case 'wake-ask': {
      const t = chatNodes(c)[el.dataset.turn];
      if (!t || !modelsCanWake()) return;
      (async () => {
        toast(`Waking the models · ${wakeEta(state.settings.lastWakeMs, Date.now(), Date.now())}`, 4200);
        const down = await wakeCategory(engine, { isUp: () => Boolean(planner), apply: applyEngineStatus, current: () => engineStatus });
        if (down) { toast(down, 4600); return; }
        say(t.message, { chatId: c.id, parentId: t.parentId ?? null, attach: null, fromComposer: false });
      })();
      return;
    }
    case 'consent-send':
    case 'consent-no': {
      const t = chatNodes(c)[el.dataset.turn];
      if (!t || !t.consent) return;
      const box = document.querySelector(`[data-consent-q="${CSS.escape(t.id)}"]`);
      const query = box ? box.value.trim() : String(t.consent.query || '');
      if (what === 'consent-send' && !query) { toast('An empty search has nothing to send.'); return; }
      answerConsent(c, t, what === 'consent-send' ? { send: true, query } : { send: false });
      return;
    }
    case 'download': beginDownload(); return;
    case 'download-picture': beginPictureDownload(); return;
    case 'download-embedding': beginEmbeddingDownload(); return;
    case 'download-show': openModelsSheet(); return;
    case 'download-later':
      state.settings.firstRun = { seenAt: Date.now(), choice: 'declined' };
      persist();
      paint();
      return;
    /* The same words again, as a new message, now the models are here. */
    case 'ask-again': {
      const t = chatNodes(c)[el.dataset.turn];
      if (t) say(t.message, { chatId: c.id, attach: null, fromComposer: false });
      return;
    }
    case 'quote':
      state.quote = { chatId: c.id, turnId: el.dataset.turn };
      paint();
      focusComposer();
      return;
    case 'copy-q': {
      const t = chatNodes(c)[el.dataset.turn];
      if (t) copyText(t.message || '');
      return;
    }
    case 'edit-q': startEdit(el.dataset.turn); return;
    /* The time under a message: how long ago, or — clicked — the date and
       minute. Remembered across repaints, so a reply landing mid-hover does
       not flip it back. */
    case 'when': {
      const key = `${el.dataset.turn}|${el.dataset.which}`;
      if (fullWhen.has(key)) fullWhen.delete(key); else fullWhen.add(key);
      paint();
      return;
    }
    case 'see-picture': {
      const t = chatNodes(c)[el.dataset.turn];
      if (t && t.image) openPicture(t);
      return;
    }
    case 'pin-pigeon': togglePigeonPin(el.dataset.pick); return;
    case 'cancel-quote': state.quote = null; paint(); return;
    case 'edit-quoted': state.quote = null; startEdit(el.dataset.turn); return;
    case 'note-edit-last': {
      const p = pathOf(c);
      if (p.length) startEdit(p[p.length - 1].id);
      return;
    }
    case 'note-ask-pen': askPenWith(el.dataset.frame || ''); return;
    case 'note-send-anyway': sendFromComposer(($('msg') || {}).value || ''); return;
    case 'note-show-page': openProfile(pickForChat(c)); return;
    /* The first part goes, visibly; the rest stays in the box. */
    case 'note-send-first-part': {
      const box = $('msg');
      const words = String(box ? box.value : '').trim().split(/\s+/);
      const rest = words.slice(4000).join(' ');
      say(words.slice(0, 4000).join(' '));
      setDraft(c.id, rest);
      paint();
      return;
    }
    /* A chip types exactly what it shows into the box, and never sends. */
    case 'type-chip': typeIntoComposer($('msg'), el.dataset.text || ''); return;
    case 'retwin': retwinTurn(el.dataset.turn, el.dataset.skill); return;
    case 'copy-a': {
      const t = chatNodes(c)[el.dataset.turn];
      if (t) copyText(answerText(t) || answerOf(t));
      return;
    }
    case 'tip-done':
      state.settings.tips = { ...(state.settings.tips || {}), [el.dataset.tip]: true };
      persist();
      paint();
      return;
    case 'chat-menu': openChatMenu(el, c.id); return;
    case 'clear-to': clearTo(); return;
    case 'leave-compose': leaveCompose(); return;
    case 'close-view': state.view = 'chat'; paint(); return;
    case 'new-with': startCompose(el.dataset.pick); return;
    case 'remove-pigeon': askRemovePigeon(el.dataset.pick); return;
    case 'play-open': openPlaySheet(String(el.dataset.pick || '').replace(/^pigeon:/, '')); return;
    case 'play-stop': { const call = pigeonInvoke(); if (call) call('play_stop').catch(() => {}); return; }
    case 'play-hud': { const call = pigeonInvoke(); if (call) call('play_hud', { show: true }).catch(() => {}); return; }
    case 'open-chat': openChat(el.dataset.chatId); return;
    case 'skills': openView('skills'); return;
    case 'import-pigeon': importPigeon(); return;
    case 'restart': {
      const cat = engineStatus && engineStatus.category;
      if (!engine) toast('Restart the model servers to load it.', 4200);
      else if (cat && cat.owned === false && cat.phase !== 'asleep') {
        toast('Another copy of the model server is already running, so Pigeon is using it as it found it. Quit that one, then try again.', 6000);
      }
      else restartModels();
      return;
    }
    case 'rename': case 'pin': case 'mute': case 'delete': chatAction(what, c.id);
  }
}

/* The parts of the window paint() never rebuilds — the search box, the tabs,
   New chat, and the containers the list, header and panels are drawn into —
   are wired once, by delegation, so a repaint can neither drop a handler nor
   take the caret out of the search box. */
function wireStatic () {
  const fill = (id, html) => { const el = $(id); if (el) el.innerHTML = html; };
  fill('searchIcon', ICONS.search);
  fill('composeBtn', ICONS.compose);
  fill('addPigeonBtn', ICONS.plus);

  const box = $('listSearch');
  if (box) {
    box.addEventListener('input', () => { state.search = box.value; paintList(); });
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && box.value) { e.preventDefault(); box.value = ''; state.search = ''; paintList(); }
    });
  }
  document.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => { state.tab = b.dataset.tab; paintList(); }));
  const compose = $('composeBtn');
  if (compose) compose.addEventListener('click', () => startCompose());
  const add = $('addPigeonBtn');
  if (add) add.addEventListener('click', () => importPigeon());
  const foot = $('listFoot');
  if (foot) foot.addEventListener('click', () => openSettings());

  const rows = $('rows');
  if (rows) {
    rows.addEventListener('click', (e) => {
      const t = e.target.closest('[data-chat-menu],[data-pigeon-menu],[data-goto],[data-chat],[data-start],[data-profile],[data-do],[data-compose-row]');
      if (!t) return;
      if (t.dataset.chatMenu) { e.stopPropagation(); openChatMenu(t, t.dataset.chatMenu); return; }
      if (t.dataset.pigeonMenu) { e.stopPropagation(); openPigeonMenu(t, t.dataset.pigeonMenu); return; }
      if (t.dataset.goto) { const [id, turnId] = t.dataset.goto.split('|'); openChat(id, { turnId }); return; }
      if (t.dataset.chat) { openChat(t.dataset.chat); return; }
      if (t.dataset.start) { startCompose(t.dataset.start); return; }
      if (t.dataset.profile) { openProfile(t.dataset.profile); return; }
      if (t.dataset.do) { paneAction(t.dataset.do, t); return; }
      focusComposer();
    });
    rows.addEventListener('contextmenu', (e) => {
      const p = e.target.closest('[data-profile]');
      if (p) { e.preventDefault(); openPigeonMenu({ x: e.clientX, y: e.clientY }, p.dataset.profile); return; }
      const t = e.target.closest('[data-chat]');
      if (!t || !chatById(state.chats, t.dataset.chat)) return;
      e.preventDefault();
      openChatMenu({ x: e.clientX, y: e.clientY }, t.dataset.chat);
    });
  }
  /* A picture in a bubble is an image acting as a button: Enter and Space
     open it, as they would a button. */
  const view = $('view');
  if (view) {
    view.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const t = e.target.closest('img[role="button"][data-do]');
      if (!t) return;
      e.preventDefault();
      paneAction(t.dataset.do, t);
    });
  }
  for (const id of ['paneHead', 'toList', 'info', 'view']) {
    const el = $(id);
    if (!el) continue;
    el.addEventListener('click', (e) => {
      const t = e.target.closest('[data-do],[data-to]');
      if (!t || !el.contains(t)) return;
      if (t.dataset.to) {
        /* Only Patch is ever greyed here, and only while his skills are not ready. */
        if (t.getAttribute('aria-disabled') === 'true') toast(patchNotReady(), 4200);
        else composeTo(t.dataset.to);
        return;
      }
      paneAction(t.dataset.do, t);
    });
  }
  /* An image dropped anywhere on a conversation with Patch is read, the same
     as one chosen with the button. This is an HTML5 drop, which only reaches
     the page because the window's own drag-drop handling is OFF in
     tauri.conf.json (`dragDropEnabled: false`): with it on, the shell
     intercepts the drop and would hand Rust a PATH, and a path is the one thing
     the page must never hold. Off, the page gets the file's bytes and nothing
     else. The document-level handlers at the bottom of this file keep a drop
     anywhere else from navigating the window. */
  const pane = $('pane');
  const dropZone = $('dropZone');
  const canRead = () => Boolean(ocr || pictureTarget()) && state.view === 'chat' && !state.profile
    && !(state.compose && !state.compose.picked);
  if (pane && dropZone) {
    let depth = 0;
    const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
    pane.addEventListener('dragenter', (e) => {
      if (!hasFiles(e) || !canRead()) return;
      e.preventDefault();
      depth++;
      dropZone.hidden = false;
    });
    pane.addEventListener('dragover', (e) => { if (hasFiles(e) && canRead()) e.preventDefault(); });
    pane.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) dropZone.hidden = true; });
    pane.addEventListener('drop', (e) => {
      depth = 0;
      dropZone.hidden = true;
      if (!hasFiles(e) || !canRead()) return;
      e.preventDefault();
      const file = [...(e.dataTransfer?.files || [])].find(f => /^image\//.test(f.type));
      if (file) attachImage(file);
      else toast('That is not an image.');
    });
  }
  /* A screenshot pasted while the focus is not in a text box is read too. */
  document.addEventListener('paste', (e) => {
    if (e.target && e.target.closest && e.target.closest('input,textarea,[contenteditable]')) return;
    const item = [...(e.clipboardData?.items || [])].find(i => i.kind === 'file' && /^image\//.test(i.type));
    if (!item || !canRead()) return;
    e.preventDefault();
    attachImage(item.getAsFile());
  });
  const jump = $('jumpNew');
  if (jump) {
    jump.innerHTML = `${ICONS.down}New reply`;
    jump.addEventListener('click', () => {
      const th = $('thread');
      if (th) th.scrollTo({ top: th.scrollHeight, behavior: 'smooth' });
      jump.hidden = true;
    });
  }
  /* A click on a row under To: must not take the caret out of To: first. */
  const toList = $('toList');
  if (toList) toList.addEventListener('mousedown', (e) => { if (e.target.closest('button')) e.preventDefault(); });

  document.addEventListener('keydown', (e) => {
    const cmd = (e.metaKey || e.ctrlKey) && !e.altKey;
    if (!cmd) return;
    /* A dialog on top takes the keyboard; the shortcuts wait for it. */
    if (sheetStack.length) return;
    const k = e.key.toLowerCase();
    if (!e.shiftKey && k === 'n') { e.preventDefault(); startCompose(); return; }
    if (e.shiftKey && k === 'n') { e.preventDefault(); startCompose(); clearTo(); return; }
    if (!e.shiftKey && e.key === ',') { e.preventDefault(); openSettings(); return; }
    if (!e.shiftKey && e.key === '/') { e.preventDefault(); openShortcuts(); return; }
    if (!e.shiftKey && k === 'f') {
      const q = $('listSearch');
      if (q) { e.preventDefault(); q.focus(); q.select(); }
      return;
    }
    if (!e.shiftKey && k === 'i') {
      const c = activeChat();
      const last = c && lastCompletedIn(c);
      if (last) { e.preventDefault(); state.info = state.info === last.id ? null : last.id; state.details = false; paint(); }
      return;
    }
    if (e.shiftKey && (e.key === ']' || e.key === '[' || e.key === '}' || e.key === '{')) {
      const rows = byActivity(state.chats).filter(c => !isEmpty(c) || hasDraft(c));
      if (rows.length < 2) return;
      e.preventDefault();
      const at = Math.max(0, rows.findIndex(c => c.id === state.activeChatId));
      const next = rows[(at + (e.key === ']' || e.key === '}' ? 1 : rows.length - 1)) % rows.length];
      openChat(next.id);
    }
  });
}

function askRename (chat) {
  openSheet(`
    <div class="sheet-card">
      <div class="sheet-title">Rename this chat</div>
      <div class="sheet-body"><input id="renameBox" class="renamebox" maxlength="60" value="${esc(chat.title)}"></div>
      <div class="sheet-row">
        <button class="sheet-btn" data-close>Cancel</button>
        <button class="sheet-btn primary" id="renameSave">Rename</button>
      </div>
    </div>`, (host, close) => {
    const box = host.querySelector('#renameBox');
    box.focus(); box.select();
    const save = () => { renameChat(chat.id, box.value); close(); };
    host.querySelector('#renameSave').onclick = save;
    box.onkeydown = (e) => { if (e.key === 'Enter') save(); };
  });
}

function askDelete (chat) {
  openSheet(`
    <div class="sheet-card">
      <div class="sheet-title">Delete this chat?</div>
      <div class="sheet-body"><strong>${esc(chat.title)}</strong> and everything in it goes for good.
        There is no undo.${chat.inflight ? ' A reply is still being worked out, and it will be discarded.' : ''}</div>
      <div class="sheet-row">
        <button class="sheet-btn" data-close>Keep it</button>
        <button class="sheet-btn danger" id="delYes">Delete</button>
      </div>
    </div>`, (host, close) => {
    host.querySelector('#delYes').onclick = async () => { close(); await deleteChat(chat.id); toast('Chat deleted.'); };
    /* The keyboard lands on Keep it: a reflex Enter must never delete. */
    host.querySelector('[data-close]').focus();
  });
}

/* ── §3.6 provenance rendering ─────────────────────────────────────────────
   The one function that decides how a value looks. A segment carrying
   provenance is a computed value and gets the mono/underline treatment plus a
   tooltip naming the skill and the input it was given; a text segment is
   prose. There is no third case, which is the point. */
/* The renderer moved to segments.js so the menu-bar popover draws a value the
   same way this window does. A smaller surface is not a weaker guarantee. */
const paintSegments = (segments, turnId) => segmentsHtml(segments, { esc, turnId });

const short = (s, n) => (s && s.length > n ? `${s.slice(0, n)}…` : s);

/* ── chat ───────────────────────────────────────────────────────────────── */
const STARTERS = [
  'how many days till 14 nov',
  'how many km is 26.2 miles',
  'split an 84.50 bill 4 ways with 15% tip',
  'what is the capital of Switzerland',
  'double this: 2 cups flour, 1 egg, 3/4 tsp salt',
  'summarise 4, 8, 15, 16, 23, 42'
];

/* The chat lane's own openers. None of them asks for a figure: these are the
   things the verified lane cannot do, which is the whole reason this lane
   exists — and putting a conversion here would be inviting the one answer
   this lane must refuse to give. */
const CHAT_STARTERS = [
  'help me decline a wedding invite nicely',
  'make this email sound less annoyed',
  'explain compound interest like I’m 12',
  'give me three names for a bakery',
  'I’m stuck on how to word a difficult message'
];

/* What an empty chat says, for whoever it is with. */
function emptyFor (d) {
  const here = 'Nothing you send here leaves this Mac.';
  if (d.kind === 'verified') {
    /* The first thing anyone sees: what there is. Said once, on a Mac with no
       chats yet; after that the card is Patch's alone. */
    const firstEver = !state.chats.some(c => !isEmpty(c));
    const native = Boolean(globalThis.__TAURI__?.core?.invoke);
    const welcome = firstEver
      ? ` Patch works things out; Pen writes; add more Pigeons from the Pigeons tab.${native ? ' Patch is also in your menu bar, and ⌘⇧P asks him from any app.' : ''}`
      : '';
    return {
      intro: `Ask something with a number, a date, a unit or a lookup in it. Every figure in the answer comes from code you can check — click it to see how.${welcome}`,
      starters: STARTERS,
      foot: 'Nothing you send here leaves this Mac unless you say yes to a look-up.'
    };
  }
  if (d.kind === 'missing') return { intro: d.line };
  if (d.kind === 'job') {
    /* The maker's line and short examples, when its card has them. An example
       too long to be a chip (a whole article) is left for the Pigeon's page. */
    const maker = deriveCard(d, personas.find(p => p.id === d.id) || null).maker;
    const intro = maker
      ? `${maker.does}${maker.inputHint ? ` Send it ${maker.inputHint}.` : ''} ${d.name} writes the answer, so check any figure in it.`
      : `Give ${d.name} one input and it gives back one output. ${d.name} writes it, so check any figure in it.`;
    const starters = maker ? maker.examples.map(e => e.input).filter(t => t.length <= 140).slice(0, 3) : [];
    return { intro, ...(starters.length ? { starters } : {}), foot: here };
  }
  if (d.kind === 'peek') {
    return {
      intro: `Send ${d.name} a picture — paste one, drop one here, or take a screenshot — and ask about it. ${d.name} writes the reply, so check any count or figure in it.${d.loaded ? '' : ` ${d.line}`}`,
      foot: here
    };
  }
  if (d.kind === 'voice') {
    return {
      intro: `Say anything. ${d.name} writes the reply in its own voice — nothing in it is checked, so treat a figure with care.${chat ? '' : ` ${d.name} is asleep right now, so nothing can answer yet.`}`,
      foot: here
    };
  }
  return {
    intro: `Say anything. Pen writes the reply — nothing in it is checked, so treat a figure with care. Ask for one and Pen offers to hand the question to Patch rather than guess.${chat ? '' : ' Pen is asleep right now, so nothing can answer yet.'}`,
    starters: CHAT_STARTERS,
    foot: here
  };
}

/* ── reading an image: the bubble, the chip, and the reading itself ─────── */

const fmtSize = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);

/* The chip on the composer: the image being read, or read and ready to send.
   Its sub line reports the real step the reading is at, in the same words the
   in-flight turn would use; the actions let the person see both versions,
   pick one, correct it, or drop the image. */
/* Enough of the reading to recognise it, on one or two lines. Long enough that
   "Boxer — Wikipedia · Working group" is obviously not a description of the dog
   in the photograph; short enough not to push the buttons off the composer.
   The whole reading is still one click away under Check text. */
function quoteOf (text) {
  const one = String(text || '').replace(/\s+/g, ' ').trim();
  if (!one) return '(nothing)';
  return one.length > 180 ? `${one.slice(0, 180).trimEnd()}…` : one;
}

function paintChip () {
  const a = attachment;
  if (!a) return '';
  /* A picture for a Pigeon that sees: nothing was read off it, so there is
     no text to check — the chip says where it is going and nothing else. */
  if (a.picture !== undefined) {
    const dims = a.width && a.height ? `${a.width}×${a.height}` : '';
    return `<div class="attach ${a.status}">
      <div class="attach-row">
        ${a.thumb ? `<img class="attach-thumb" src="${a.thumb}" alt="">` : `<span class="attach-thumb blank">${ICONS.image}</span>`}
        <div class="attach-body">
          <div class="attach-head"><b title="${esc(a.name)}">${esc(a.name)}</b>${dims ? `<span class="attach-meta">${esc(dims)}</span>` : ''}</div>
          <div class="attach-sub">${esc(a.status === 'failed' ? a.error : `${a.forName} will see this picture — nothing is read off it first`)}</div>
        </div>
        <button class="attach-x" data-attach-remove title="Remove the picture" aria-label="Remove the picture">${ICONS.x}</button>
      </div>
    </div>`;
  }
  const dims = a.width && a.height ? `${a.width}×${a.height}` : '';
  const words = a.status === 'ready' ? `${wordCount(a.text)} words` : '';
  const meta = [dims, words].filter(Boolean).join(' · ');
  const sub = a.status === 'reading' ? stageText('reading', { name: a.name, engine: a.engine })
    : a.status === 'tidying' ? stageText('tidying', { model: a.model })
    : a.status === 'failed' ? a.error
    : a.used === 'cleaned' ? `tidied · every number checked${a.edited ? ' · edited' : ''}`
    : `as read${a.reason ? ` — ${a.reason}` : ''}${a.edited ? ' · edited' : ''}`;
  /* The open question, when there is one. `blind` is the one that had to be
     added: this Pigeon cannot see a picture, and a one-shot Pigeon's box
     IS its input, so the words that would go in are quoted here and nothing
     moves until somebody has looked at them. */
  const blind = a.choose === 'blind' || a.choose === 'blind-typed';
  const ask = a.status === 'ready' && a.choose ? `
    <div class="attach-actions${blind ? ' attach-blind' : ''}">
      <span class="attach-ask">${blind
        ? `<b>${esc(a.forName || 'This Pigeon')} cannot see a picture.</b> It will read only these words:`
        : 'Put the text from the picture in place of what you typed?'}</span>
      ${blind ? `<blockquote class="attach-quote">${esc(quoteOf(a.text))}</blockquote>` : ''}
      ${a.choose === 'blind' ? `
        <button data-attach-replace title="Put these words in the box, where you can correct them before sending">Use this text</button>
        <button data-attach-keep title="Let the picture go">Discard</button>`
      : a.choose === 'blind-typed' ? `
        <button data-attach-replace title="The box gets the picture's text in place of what you typed">Use this text</button>
        <button data-attach-keep title="Keep what you typed and let the picture go">Keep mine</button>`
      : `
        <button data-attach-replace title="The box gets the picture's text">Replace</button>
        <button data-attach-keep title="Keep what you typed and let the picture go">Keep mine</button>`}
    </div>` : '';
  const actions = ask ? ask
    : a.status === 'ready' ? `
    <div class="attach-actions">
      <button data-attach-toggle title="${a.editing ? 'Hide the text' : 'See and correct the text before sending'}">${a.editing ? 'Hide text' : 'Check text'}</button>
      <button data-attach-copy title="Copy the text that was read">Copy text</button>
      ${a.cleaned ? `<button data-attach-use="raw" class="${a.used === 'raw' ? 'on' : ''}" title="Send exactly what was read from the picture">Original</button>
        <button data-attach-use="cleaned" class="${a.used === 'cleaned' ? 'on' : ''}" title="Send the tidied version — broken lines joined, spacing fixed, every number checked against the original">Tidied</button>` : ''}
    </div>` : '';
  const editor = a.status === 'ready' && a.editing
    ? `<textarea class="attach-ta" id="attachText" rows="6" spellcheck="false">${esc(a.text)}</textarea>` : '';
  return `<div class="attach ${a.status}">
    <div class="attach-row">
      ${a.thumb ? `<img class="attach-thumb" src="${a.thumb}" alt="">` : `<span class="attach-thumb blank">${ICONS.image}</span>`}
      <div class="attach-body">
        <div class="attach-head"><b title="${esc(a.name)}">${a.status === 'ready' ? `Text from ${esc(a.name)}` : esc(a.name)}</b>${meta ? `<span class="attach-meta">${esc(meta)}</span>` : ''}</div>
        <div class="attach-sub">${a.status === 'reading' || a.status === 'tidying' ? '<span class="dots"><i></i><i></i><i></i></span>' : ''}${esc(sub)}</div>
        ${a.status === 'ready' && !a.choose ? `<div class="attach-sub">${esc(textOnlyNote(a))}</div>` : ''}
        ${actions}
      </div>
      <button class="attach-x" data-attach-remove title="Remove the picture" aria-label="Remove the picture">${ICONS.x}</button>
    </div>
    ${editor}
  </div>`;
}

/* Who gets this reading, and that it is ALL they get: the other half of
   pictureLine, said where the words are. */
function textOnlyNote (a) {
  const c = chatById(state.chats, a.chatId);
  const who = c ? pigeonOf(pickForChat(c), personas, patchState).name : 'This Pigeon';
  return `Only these words go to ${who}, which reads text only — never the picture itself.`;
}

/* Read an image. The whole thing runs on attach, before anything is sent, so
   the person sees the reading and can correct it. Each await checks that the
   chip is still the one it started with — a removed or replaced image must not
   receive a stale result. */
function paintTranscriptChip () {
  const t = transcript;
  if (!t) return '';

  const s = t.stats;
  /* What the deterministic pass did, in the units a person can check against
     the thing they pasted. Not "cleaned": a count they could go and count. */
  const did = s ? [
    s.cues > 1 ? `${s.cues} cues joined` : '',
    s.midSentenceJoins ? `${s.midSentenceJoins} split sentences` : '',
    s.fillersRemoved ? `${s.fillersRemoved} fillers` : '',
    s.stuttersRemoved ? `${s.stuttersRemoved} stutters` : ''
  ].filter(Boolean).join(' · ') : '';

  /* The words the model changed, named. An accepted repair that moved a word
     must show which — that is the difference between repairing a name the
     transcriber split and quietly rewriting the transcript, and they look
     identical if nobody says. */
  const moved = t.changed && t.changed.added.length
    ? `<div class="tr-changed" title="Words the repair changed. A name the transcriber split cannot be fixed without changing one, so it says which.">changed: ${t.changed.added.slice(0, 8).map(w => `<code>${esc(w)}</code>`).join(' ')}${t.changed.added.length > 8 ? ` +${t.changed.added.length - 8}` : ''}</div>`
    : '';

  const sub = t.status === 'offered' ? 'looks like a machine-made transcript'
    : t.status === 'tidying' ? `repairing the punctuation…${t.progress && t.progress[1] > 1 ? ` ${t.progress[0]} of ${t.progress[1]} passages` : ''}`
    : t.status === 'failed' ? esc(t.error || 'the repair failed')
    : t.rejected ? `${did}${did ? ' · ' : ''}${esc(t.rejected)}`
    : did || 'tidied';

  const actions = t.status === 'offered' ? `
      <button data-tr-tidy title="Strip the timestamps and labels, rejoin the split sentences, and let the model put the punctuation back">tidy it</button>`
    : t.status === 'ready' ? `
      <button data-tr-use="raw" class="${t.used === 'raw' ? 'on' : ''}" title="Put back exactly what you pasted">use raw</button>
      <button data-tr-use="${t.repaired ? 'repaired' : 'mechanical'}" class="${t.used !== 'raw' ? 'on' : ''}" title="${t.repaired ? 'The tidied version. Every word it changed is listed.' : 'The timestamps and labels stripped. The model\'s repair was thrown out.'}">use tidied</button>`
    : '';
  /* Notes are writing, so they are Pen's to write — in a new chat, with the
     transcript in its box and nothing sent. */
  const pen = t.status === 'offered' || t.status === 'ready'
    ? '<button data-tr-pen title="Open a chat with Pen with this transcript in the box">Ask Pen for notes</button>' : '';

  return `<div class="attach transcript ${t.status}">
    <div class="attach-row">
      <span class="attach-thumb blank">${ICONS.transcript}</span>
      <div class="attach-meta">
        <div class="attach-name">transcript${s && s.format && s.format !== 'plain' ? ` · ${esc(s.format)}` : ''}</div>
        <div class="attach-sub">${sub}</div>
        ${t.status === 'tidying' && t.live ? `<pre class="tr-live" id="trLive" aria-live="off">${esc(liveTail(t.live))}</pre>` : ''}
        ${moved}
      </div>
      <div class="attach-actions">
        ${actions}${pen}
        <button data-tr-drop title="Leave the text alone">✕</button>
      </div>
    </div>
  </div>`;
}

/* The last few lines of a repair in progress: enough to see it moving, not
   the whole transcript redrawn on every token. */
function liveTail (text) {
  const t = String(text || '');
  return t.length > 280 ? `…${t.slice(-280)}` : t;
}

/* ── a pasted transcript ─────────────────────────────────────────────────── */

/* Pasting a transcript is the moment to offer, and the only one: it is when a
   person has just done the thing, and it costs them nothing to ignore. The
   paste itself is NEVER intercepted — the text lands in the box exactly as the
   browser would put it there, and this only adds a chip beside it. Their rule
   about typed text is not suspended because we think we recognised something.

   `worthTidying` is deliberately stricter than `isTranscript`: a two-cue
   snippet is a transcript and is also not worth a chip. */
function offerTranscript (text) {
  const t = String(text ?? '');
  if (!worthTidying(t)) return;
  dropTranscript();
  transcript = {
    seq: ++transcriptSeq,
    chatId: state.activeChatId,
    status: 'offered',
    raw: t,
    mechanical: null,
    repaired: null,
    used: 'raw',
    rejected: null,
    changed: { added: [], removed: [] },
    stats: null,
    error: null
  };
  paint();
}

/* What the person chose, put back in the box. The raw text is kept whole, so
   every one of these is reversible — which is the whole reason the chip has a
   "use raw" at all. */
function useTranscript (which, t = transcript) {
  if (!t) return;
  const text = which === 'raw' ? t.raw
    : which === 'repaired' && t.repaired ? t.repaired
    : t.mechanical;
  if (text == null) return;
  t.used = which;
  /* Into the draft of the chat the transcript was pasted in, which is not
     necessarily the one on screen by the time a tidy finishes. */
  const chatId = t.chatId || state.activeChatId;
  const box = chatId === state.activeChatId ? $('msg') : null;
  setDraft(chatId, text, box ? box.style.height : draftOf(chatId).height);
  if (chatId === state.activeChatId) paint();
}

async function tidyPastedTranscript () {
  const t = transcript;
  if (!t || t.status === 'tidying') return;
  const live = () => !t.dropped;
  const shown = () => transcript === t;
  t.status = 'tidying';
  t.error = null;
  paint();

  try {
    const complete = tidyBridge();
    /* The repair is shown growing on the chip. Only the live element is
       touched between frames; the chip is repainted whole the first time it
       has something to show, and when the count of passages moves. */
    let frame = false;
    const onStage = (stage, done, of, text) => {
      if (!live() || !shown()) return;
      const countMoved = !t.progress || t.progress[0] !== done;
      t.progress = [done, of];
      t.live = text || '';
      if (frame) return;
      frame = true;
      requestAnimationFrame(() => {
        frame = false;
        if (!live() || !shown()) return;
        const el = $('trLive');
        if (el && !countMoved) el.textContent = liveTail(t.live);
        else paint();
      });
    };
    const out = await tidyTranscript({ raw: t.raw, complete, onStage });
    t.live = '';
    t.progress = null;
    if (!live()) return;
    Object.assign(t, {
      status: 'ready',
      mechanical: out.mechanical,
      repaired: out.repaired,
      rejected: out.rejected,
      changed: out.changed || { added: [], removed: [] },
      stats: out.stats
    });
    useTranscript(out.repaired ? 'repaired' : 'mechanical', t);
  } catch (e) {
    if (!live()) return;
    t.status = 'failed';
    t.error = String((e && e.message) || e);
    if (shown()) paint();
  }
}


async function attachPicture (file, persona) {
  dropAttachment();
  const a = attachment = {
    name: file.name || 'pasted picture', mime: 'image/jpeg', width: null, height: null, thumb: null,
    status: 'reading', error: null, picture: null, text: '', forName: persona.name || 'This Pigeon',
    chatId: state.activeChatId
  };
  paint();
  try {
    if (file.size > 40 * 1024 * 1024) throw new Error(`picture is ${Math.round(file.size / 1048576)} MB; the limit is 40 MB`);
    const p = await pictureOf(file);
    if (a.dropped) return;
    Object.assign(a, { picture: p.url, thumb: p.thumb, width: p.width, height: p.height, status: 'ready' });
  } catch (e) {
    if (a.dropped) return;
    a.status = 'failed';
    a.error = String(e && e.message || e);
  }
  if (attachment === a) paint(); else persist();
}

async function attachImage (file) {
  if (!file) return;
  if (!/^image\//.test(file.type || '')) { toast('That is not an image.'); return; }
  /* A Pigeon that sees gets the picture; everyone else gets its text. */
  const seer = pictureTarget();
  if (seer) return attachPicture(file, seer);
  if (!ocr) { toast('Pigeon can’t read text in pictures here.'); return; }
  const seq = ++attachSeq;
  dropAttachment();
  /* The chip is held here, not read back through `attachment`: if you switch
     chats while it is being read, the reading still finishes into this chip —
     which is now on the chat you attached it in. */
  const a = attachment = {
    name: file.name || 'pasted image', mime: file.type, width: null, height: null, thumb: null,
    status: 'reading', error: null, raw: null, cleaned: null, used: null, text: '', edited: false,
    reason: null, engine: ocrDetail?.engine || 'the text reader', model: modelName || null,
    ocrMs: 0, cleanupMs: 0, editing: false, seq, chatId: state.activeChatId
  };
  const live = () => !a.dropped;
  const shown = () => attachment === a;
  paint();

  /* The preview (ui/picture.js, 512 px) and the size read off it. The preview
     goes with the turn, so the chat still shows the picture that was read. */
  previewOf(file).then(({ thumb, width, height }) => {
    if (!live()) return;
    Object.assign(a, { thumb, width, height });
    if (!shown()) return;
    const img = document.querySelector('.attach-thumb');
    if (img && img.tagName === 'IMG') img.src = thumb; else paint();
  }).catch(() => {});

  try {
    if (file.size > 20 * 1024 * 1024) throw new Error(`image is ${Math.round(file.size / 1048576)} MB; the limit is 20 MB`);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const read = await ocr(bytes);
    if (!live()) return;
    a.engine = read.engine || a.engine;
    a.ocrMs = read.ms;
    a.raw = read.text;
    if (!read.text.trim()) throw new Error('No text was found in this picture.');

    if (plannerComplete) {
      a.status = 'tidying';
      if (shown()) paint();
      const tidy = await cleanupOcr({ raw: read.text, complete: plannerComplete, model: modelName });
      if (!live()) return;
      Object.assign(a, { cleaned: tidy.cleaned, used: tidy.used, reason: tidy.reason, cleanupMs: tidy.ms, model: tidy.model });
    } else {
      Object.assign(a, { cleaned: null, used: 'raw', reason: 'no model', cleanupMs: 0 });
    }
    a.text = a.used === 'cleaned' ? a.cleaned : a.raw;
    a.status = 'ready';
    settleOneShot(a);
  } catch (e) {
    if (!live()) return;
    a.status = 'failed';
    a.error = String(e && e.message || e);
  }
  if (shown() || a.chatId === state.activeChatId) paint(); else persist();
}

/* A one-shot Pigeon takes one input, so what the picture says IS the input: it
   goes into the box, where it can be read and changed, rather than riding
   beside it. Something already typed there is never replaced without asking.
 *
 * And the reading is never put there WITHOUT asking either, which is the whole
 * of this function's care. A one-shot Pigeon's box is its entire input: drop
 * OCR text into it silently and the next Send runs the Pigeon on words it was
 * never shown a picture of. A breed sorter handed a screenshot of a breed page
 * answers off the page's own chrome, in two tokens, looking exactly like an
 * answer — the failure this app is built not to have. So the chip stays, says
 * that nothing here can see a picture, shows the words it would send, and waits
 * to be told. The person can still send it: often the words ARE the input, and
 * refusing a receipt because it arrived as a photograph would be its own kind
 * of wrong. They just have to have seen them first.
 *
 * `choose` says which question is open, and any value of it stops a send
 * (`say`) until it is answered. */
function settleOneShot (a) {
  const c = chatById(state.chats, a.chatId);
  const persona = c && laneOf(c) === 'B' ? chatPersona(c) : null;
  if (!persona || isVoice(persona)) return;
  a.forName = persona.name || 'This Pigeon';
  const box = a.chatId === state.activeChatId ? $('msg') : null;
  const typed = box ? box.value : draftOf(a.chatId).text;
  const hadTyped = Boolean(String(typed || '').trim());
  /* Told apart because they are different questions. "Replace what you typed?"
     is about two inputs competing; "this cannot see the picture" is about what
     the one input actually is, and a person who has typed nothing still needs
     to be asked it. */
  if (!canBeSentAPicture(persona)) { a.choose = hadTyped ? 'blind-typed' : 'blind'; return; }
  if (hadTyped) { a.choose = 'typed'; return; }
  putReadingInBox(a);
}

function putReadingInBox (a) {
  if (!a) return;
  a.dropped = true;
  if (attachment === a) attachment = null;
  const c = chatById(state.chats, a.chatId);
  if (c && c.draft && c.draft.attachment === a) c.draft.attachment = null;
  setDraft(a.chatId, a.text);
}

function paintChat () {
  /* A question being answered is drawn as a turn, not as an absence: without it
     the thread would go blank while the model works, and after an edit the
     conversation you were reading would vanish behind a welcome screen. */
  const c = activeChat();
  const d = pigeonOf(pickForChat(c), personas, patchState);
  const path = state.turns;
  const inFlight = state.busy ? inflightHtml(state.busy, d, { prevAt: path.length ? path[path.length - 1].at : null, status: state.busy.status || '' }) : '';
  /* Sent while a reply was on its way: waiting, or held while a question of
     Patch's is open, or — after a relaunch — offered to send. */
  const open = askOpen(c);
  const queued = queuedHtml(c.queue || [], { held: Boolean(open) && !c.inflight, askName: d.name, idle: !c.inflight && !open });

  /* The empty chat belongs to whoever it is with. Patch's asks for something
     checkable; offering those words to a model would invite exactly the thing
     it refuses, and offering chat openers to Patch would invite the thing HE
     refuses. */
  const choosing = Boolean(state.compose && !state.compose.picked);
  const empty = choosing
    ? `<div class="choose-hint">Write something, then choose who it’s for — or choose first. Every Pigeon
        says what it does: Patch works things out, and everyone else writes.</div>`
    : emptyChatHtml(d, emptyFor(d));

  const thread = (path.length || inFlight || queued)
    ? (() => {
        /* Every turn's versions from one pass over the nodes, not a scan each. */
        const sibIndex = siblingIndex(activeChat());
        /* Where a writer's memory ends: the line sits above the oldest turn it
           can still see. A one-shot Pigeon and Patch remember nothing, so for
           them there is no line to draw. */
        const edge = activeLane() === 'B' && d.kind !== 'job' && d.memory !== 'fresh' ? memoryEdgeIndex(path, HISTORY_TURNS) : -1;
        return path.map((t, i) => (i === edge ? memoryEdgeHtml(d.name) : '') + paintTurn(t, i, path, sibIndex)).join('');
      })() + inFlight + queued
    : empty;

  const awaiting = asking();
  const draft = draftOf(state.activeChatId);
  const ready = attachment && attachment.status === 'ready';
  const laneB = activeLane() === 'B';
  const persona = chatPersona(activeChat());
  const inflightHere = Boolean(c && c.inflight);
  /* Reply: the bar says what this Pigeon will actually see of the quote. */
  const qt = !awaiting && !choosing && state.quote && state.quote.chatId === c.id ? chatNodes(c)[state.quote.turnId] : null;
  const qAt = qt ? path.indexOf(qt) : -1;
  const quoteBar = qt
    ? quoteBarHtml({ id: qt.id, who: replyText(qt) ? d.name : 'You', text: replyText(qt) || qt.message, question: qt.message },
      /* A voice that starts fresh sees a quote the way a one-shot Pigeon does: not at all. */
      { name: d.name, kind: d.kind === 'voice' && d.memory === 'fresh' ? 'job' : d.kind, turns: HISTORY_TURNS, aboveEdge: laneB && d.kind !== 'job' && qAt > -1 && qAt < memoryEdgeIndex(path, HISTORY_TURNS) })
    : '';
  /* Words someone else's chat, or Pigeon, put in this box — said so, once. */
  const handoff = state.handoffNote && state.handoffNote.chatId === c.id ? `<div class="note-strip">${esc(state.handoffNote.text)}</div>` : '';
  /* aria-busy says the region is mid-change, so a screen reader knows the wait
     is a wait rather than the answer being nothing. The stage line beside it is
     for eyes; this is the same fact for everyone else. */
  return `
    <div class="thread" id="thread"${state.busy ? ' aria-busy="true"' : ''}>${thread}</div>
    ${pigeonGone(c) ? removedHtml(d) : ''}
    <div class="composer" id="composer"${pigeonGone(c) ? ' hidden' : ''}>
      ${choosing ? '' : paintChip() + paintTranscriptChip()}
      ${awaiting && !choosing && !laneB ? `<div class="rbar"><span class="rbar-q"><b>↩ Answering ${esc(d.name)}:</b> ${esc(awaiting.ask.question)}
          <small>Only what you send while this is here answers it. × skips the question.</small></span>
          <button class="rbar-x" data-do="skip-ask" aria-label="Skip the question" title="Skip the question">${ICONS.x}</button></div>` : ''}
      ${quoteBar}${handoff}
      <div id="noteSlot">${noteHtml(noteFor(c, draft.text))}</div>
      <div class="inputrow-field">
        <textarea id="msg" rows="1" placeholder="${choosing ? 'Write something, then choose who it’s for'
          : laneB ? esc(isPeek(c) ? 'Message Peek, or give it a picture' : persona ? (isVoice(persona) ? `Message ${persona.name}` : `Give ${persona.name} one input…`) : 'Message Pen')
          : awaiting ? esc(awaiting.ask.question)
          : ready ? 'Ask something about the text in the picture, or just send it…'
          : 'Message Patch'}" style="${draft.height ? `height:${esc(draft.height)}` : ''}">${esc(draft.text)}</textarea>
      </div>
      <div class="inputrow">
        ${!choosing && (ocr || pictureTarget()) ? `<button class="icon-btn ghost-toggle" id="imgPick"
          title="${esc(`${pictureLine(d)} Paste one, drop one here, or choose a file.`)}" aria-label="Add a picture"
          >${ICONS.image}</button><input type="file" id="imgFile" accept="image/*" hidden>` : ''}
        <span class="hint">${choosing ? '' : awaiting ? 'answering: ' + esc(humanise(awaiting.ask.field).toLowerCase()) : ready ? '↩ to send · with the picture’s text' : '↩ to send'}</span>
        <div class="spacer"></div>
        ${inflightHere ? `<button class="icon-btn solid stop" id="send" title="Stop waiting for this reply" aria-label="Stop">${ICONS.stop}</button>`
          : `<button class="icon-btn solid breathe" id="send" title="Send" aria-label="Send">${ICONS.send}</button>`}
      </div>
    </div>`;
}

/* What a message quoted, as its bubble shows it: the reply if the quoted turn
   had one, otherwise the question. */
function quoteFor (c, id) {
  const t = id ? chatNodes(c)[id] : null;
  if (!t) return null;
  const said = replyText(t);
  return said
    ? { who: pigeonOf(pickForChat(c), personas, patchState).name, text: said }
    : { who: 'You', text: t.message || '' };
}

/* The note before sending, when this message would not do what it looks like
   it will — a follow-up to someone who starts fresh — or is longer than a
   writer can read. Decided from the words alone: no model, never blocking,
   and never touching what was typed. */
function noteFor (c, text) {
  if (!c || !String(text || '').trim() || (state.compose && !state.compose.picked)) return null;
  const d = pigeonOf(pickForChat(c), personas, patchState);
  const path = pathOf(c);
  const last = path[path.length - 1] || null;
  if (d.kind === 'verified') {
    return patchFollowUpNote({ lastWasWorked: Boolean(last) && markFor(last) === MARKS.WORKED, text, noteSkips: c.noteSkips || 0 });
  }
  if (d.kind === 'job') {
    const maker = deriveCard(d, personas.find(p => p.id === d.id) || null).maker;
    /* Longer than anything its maker tested it on: said before it is sent. */
    const tested = testedLengthNote({ name: d.name, text, p95: maker ? maker.wordsP95 : null, noteSkips: c.noteSkips || 0 });
    if (tested) return tested;
    const noun = maker && maker.outputNoun ? maker.outputNoun : /drawing/.test(d.does) ? 'drawing' : /label/.test(d.does) ? 'label' : 'answer';
    return oneShotNote({ pigeon: { name: d.name, noun, drawing: noun === 'drawing' }, text, prevText: last ? last.message : '', noteSkips: c.noteSkips || 0, penAvailable: Boolean(chat || engine) });
  }
  if (d.kind === 'base' || d.kind === 'voice') return lengthNote({ name: d.name, text });
  return null;
}

/* The one-time notes: under the newest written reply until someone has read it,
   and on the newest worked-out answer until a figure has been opened. */
function tipFor (turn, path) {
  const tips = state.settings.tips || {};
  const mark = markFor(turn);
  const newest = (kind) => { for (let i = path.length - 1; i >= 0; i--) if (markFor(path[i]) === kind) return path[i]; return null; };
  if (mark === MARKS.WRITTEN && !tips.written && newest(MARKS.WRITTEN) === turn) return 'written';
  const cited = (m) => m === MARKS.WORKED || m === MARKS.LOOKED || m === MARKS.FOUND;
  if (cited(mark) && !tips.figure) {
    for (let i = path.length - 1; i >= 0; i--) if (cited(markFor(path[i]))) return path[i] === turn ? 'figure' : null;
  }
  return null;
}

/* A skill's own first example, offered as a chip that types when a decline
   names it as a near miss. */
function exampleFor (name) {
  try { return (registry && registry.skill(name)?.examples?.[0]?.text) || null; } catch { return null; }
}

/* One turn, drawn by ui/bubbles.js from what only this window knows: who the
   chat is with, the versions beside this question, whether it is the last one,
   which tapback bar is open, and which one-time note it carries. */
function paintTurn (turn, i, path, sibIndex = null) {
  const c = activeChat();
  const sibs = siblingsOf(c, turn, sibIndex);
  const last = i === path.length - 1;
  return turnHtml(turn, {
    pigeon: pigeonOf(pickForChat(c), personas, patchState),
    prevAt: i > 0 ? path[i - 1].at : null,
    editing: state.editing === turn.id,
    versions: sibs.length > 1 ? { index: sibs.findIndex(t => t.id === turn.id), count: sibs.length } : null,
    last: last && !c.inflight,
    pending: last && Boolean(turn.ask) && !(c.askSkipped || {})[turn.id],
    skipped: Boolean((c.askSkipped || {})[turn.id]),
    quote: quoteFor(c, turn.quoteId),
    webNever: state.settings.webPolicy === 'never',
    wakeOffer: turn.routerOnly && turn.mode === MODES.NO_SKILL && last && modelsCanWake() ? wakeEta(state.settings.lastWakeMs, Date.now(), Date.now()) : null,
    download: turn.needsDownload
      ? (modelsInfo && modelsInfo.download_bytes > 0 && !downloading ? { size: fmtBytes(modelsInfo.download_bytes) } : downloading ? null : 'done')
      : null,
    tapback: state.tapback,
    freshReaction: state.freshReaction,
    longMark: Boolean(turn.longMark),
    tip: tipFor(turn, path),
    exampleFor,
    canChat: Boolean(chat),
    canWake: Boolean(engine),
    model: turn.lane === 'B' ? categoryModel : null,
    handoffOffer: HANDOFF_OFFER,
    pictureGone: pictureGone(turn.image),
    busy: Boolean(c.inflight),
    whenFull: (which) => fullWhen.has(`${turn.id}|${which}`)
  });
}

/* Marked values open their record. Pulled out of wire() because the reveal
   animation rewrites a bubble's contents after wire() has run, and the new spans
   need handlers too. */
function wireRuns (root) {
  root.querySelectorAll('[data-run]').forEach(el => {
    el.onclick = () => {
      const [turnId, stepId] = el.dataset.run.split('|');
      const turn = turnId === SCRATCH_TURN ? scratchTurn : state.turns.find(t => t.id === turnId);
      const seg = (turn?.reply?.segments || []).find(sg =>
        sg.type === 'value' && String(sg.step ?? '') === stepId && sg.text === el.textContent);
      openValueDetail(turnId, stepId || null, seg);
    };
  });
  /* A grounded answer's underline: the section it came from. */
  root.querySelectorAll('[data-cite]').forEach(el => {
    const open = () => {
      const turn = state.turns.find(t => t.id === el.dataset.cite);
      if (!turn) return;
      const d = turn.persona ? pigeonOf(`pigeon:${turn.persona}`, personas) : null;
      const c = citationFor({ kind: 'doc', turn, name: (d && d.name) || 'This Pigeon' });
      if (c) openCitation(c);
    };
    el.onclick = open;
    el.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } };
  });
}

/* What the turn is actually doing, said plainly, while it does it.
 *
 * Written straight into the node rather than through paint(): a repaint on
 * every stage would rebuild the thread three times a question and restart the
 * dots' animation each time. These are real events from the pipeline, not a
 * timer — when it says it is running a skill, it is running that skill. */
const STAGE_WORDS = {
  routing: () => 'finding the right skill',
  planning: (d) => d && d.category ? `planning · ${d.category}` : 'planning',
  /* The plan names its skill a few tokens in, before its arguments: the
     name is read off the stream (planner.js `onSkill`) and said here while
     the rest of the plan is written. A second step reads "then". */
  reaching: (d) => d && d.skill ? (d.n > 1 ? `then ${d.skill}` : `reaching for ${d.skill}`) : 'planning',
  'second-look': () => 'checking whether this is something to look up',
  running: (d) => d && d.skills && d.skills.length
    ? `running ${d.skills.join(', ')}`
    : 'running',
  /* The two stages of reading an image. Not turn stages — they run while the
     chip is on the composer, before anything is sent — but the same words in
     the same place, and for the same reason: they are real steps. */
  /* Lane B's one stage. There is nothing to route, plan or run: a model is
     writing, and that is the whole of what is happening. */
  writing: (d) => (d && d.persona ? `${d.persona} is writing` : 'writing'),
  /* Before writing can start: the server this lane rides on was asleep, and
     a wake was asked for. Not a Lane A stage — nothing here is planned or
     routed either, it is just waited for. */
  waking: () => 'waking the models',
  reading: (d) => `reading ${d && d.name ? d.name : 'the picture'}`,
  tidying: () => 'tidying the text',
  /* Peek, before his first word: the vision encoder is reading the picture,
     which is most of the wait on a big one. Said by the page, which knows it
     sent a picture; the first word turns it into "writing". */
  looking: (d) => `${d && d.persona ? d.persona : 'Peek'} is looking at the picture`
};

function stageText (name, detail) {
  const say = STAGE_WORDS[name];
  return say ? say(detail) : name;
}

/* A stage belongs to the chat whose question it is. Only the chat on screen
   has a stage line to write into; another chat's stages are kept on its record
   for when you go back to it. */
function showStage (name, detail, chatId = state.activeChatId) {
  const text = stageText(name, detail);
  const c = chatById(state.chats, chatId);
  if (c && c.inflight) c.inflight.stage = text;
  /* The first real stage is the moment Pigeon started on it, kept for Message
     info. Nothing on screen says "Read" any more. */
  markRead(c);
  if (chatId !== state.activeChatId || !c) return;
  const line = stageLine(pigeonOf(pickForChat(c), personas, patchState).name, text);
  const el = $('stageLine');
  if (el && el.textContent !== line) {
    el.textContent = line;
    /* A new stage slides in; the class is taken off and put back so the
       animation plays again on the next one. */
    el.classList.remove('swap');
    void el.offsetWidth;
    el.classList.add('swap');
  }
  const head = $('headStage');
  if (head) head.textContent = line;
}

/* The chat lane's reply as it is written: `text` is every whole sentence that
   may be on screen so far (chat.js `showable`), and only ever grows. What is
   new lands in the typing bubble with a small fade, the dots staying after
   it; the finished turn replaces the bubble whole when it comes. Kept on the
   in-flight record too, so a repaint between sentences does not lose it. */
function showText (chatId, text) {
  const c = chatById(state.chats, chatId);
  if (!c || !c.inflight) return;
  const before = c.inflight.live || '';
  c.inflight.live = text;
  if (chatId !== state.activeChatId) return;
  const bub = $('liveBub');
  if (!bub) return;
  let live = $('liveText');
  if (!live) {
    live = document.createElement('span');
    live.className = 'live';
    live.id = 'liveText';
    bub.insertBefore(live, bub.firstChild);
    bub.classList.add('has-text');
  }
  const grew = text.startsWith(before) ? text.slice(before.length) : null;
  if (grew === null) {
    live.textContent = '';
    const all = document.createElement('span');
    all.className = 'land';
    all.textContent = text;
    live.appendChild(all);
    return;
  }
  if (!grew) return;
  /* `grew` begins with the space or line break that preceded the new words,
     so appending it as it is keeps the reply's own spacing and paragraphs. */
  const part = document.createElement('span');
  part.className = 'land';
  part.textContent = grew;
  live.appendChild(part);
  /* Keep the newest sentence in view when the person is already at the
     foot of the thread; someone reading further up is left alone. */
  const thread = $('thread');
  if (thread && thread.scrollHeight - thread.scrollTop - thread.clientHeight < 120) thread.scrollTop = thread.scrollHeight;
}

/* The reply, as many characters as have been "typed" so far. Slicing the
   SEGMENTS rather than the rendered HTML is what keeps a half-revealed value
   underlined and clickable — cutting the HTML string would sever a tag. */
function sliceSegments (segments, n) {
  const out = [];
  let left = n;
  for (const seg of segments) {
    if (left <= 0) break;
    const text = seg.text ?? '';
    if (text.length <= left) { out.push(seg); left -= text.length; }
    else { out.push({ ...seg, text: text.slice(0, left) }); left = 0; }
  }
  return out;
}

/* Type the answer out rather than snapping it into place.
 *
 * Nothing is being streamed — the reply was finished before this runs, and
 * pretending otherwise would be a lie told in the interface. What it buys is
 * legibility: the eye follows text that arrives, and lands at the start of the
 * sentence instead of hunting for where the block changed.
 *
 * Skipped for anyone who asked for less motion, and for long replies, where a
 * crawl stops being pleasant and starts being a wait. */
const REVEAL_CPS = 900;
const REVEAL_MAX = 1400;

function revealReply (turnId) {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  const turn = state.turns.find(t => t.id === turnId);
  if (!turn || !turn.reply || turn.ask) return;

  const segs = turn.reply.segments || [];
  const total = segs.reduce((n, sg) => n + (sg.text || '').length, 0);
  if (!total || total > REVEAL_MAX) return;

  const wrap = document.getElementById(`turn-${turnId}`);
  /* Only the answer's own text is typed out: the skill line above it stays put.
     A Couldn't bubble is a sentence and a button, not the reply's segments —
     typing the segments into it replaced "Look it up…" with the raw failure. */
  if (wrap && wrap.querySelector('.bub.ai.couldnt')) return;
  const el = wrap && (wrap.querySelector('.bub.ai .segs') || wrap.querySelector('.bub.ai'));
  if (!el) return;

  /* Drawn once, in full, then revealed by trimming the text nodes: the
     bubble's markup is never re-parsed while it types, and a second reveal
     of the same turn cancels the first rather than racing it. */
  const token = Symbol('reveal');
  revealing.set(turnId, token);
  el.innerHTML = paintSegments(segs, turnId);
  wireRuns(el);
  const nodes = [];
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push({ node: n, text: n.data });
  const show = (count) => {
    let left = count;
    for (const { node, text } of nodes) {
      const take = Math.max(0, Math.min(text.length, left));
      const want = take === text.length ? text : text.slice(0, take);
      if (node.data !== want) node.data = want;
      left -= text.length;
    }
  };
  const started = performance.now();
  show(0);
  const step = () => {
    /* A repaint — the user pressed something — replaces this node. Stop rather
       than animating an element nobody can see. A newer reveal owns it now. */
    if (!el.isConnected || revealing.get(turnId) !== token) return;
    const shown = Math.floor(((performance.now() - started) / 1000) * REVEAL_CPS);
    if (shown >= total) { show(Infinity); revealing.delete(turnId); return; }
    show(shown);
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
/* The reveal each turn is currently typing, so a newer one replaces it. */
const revealing = new Map();

/* §3.6 "A 'Show plan' affordance reveals the executed plan and raw results.
   Honesty made inspectable." Opened from the line under a reply. */
function planPanel (turn) {
  const raw = state.raw.has(turn.id);
  /* Lane B has no plan and no skill results, so there is nothing raw to show:
     an empty {"steps": []} there only reads as something having failed. */
  const hasPlan = turn.lane !== 'B';
  return `<div class="plan">
    ${chatFlow(turn)}
    ${hasPlan ? `<button class="planbtn rawbtn" data-raw="${esc(turn.id)}">${raw ? 'hide the raw plan' : 'raw plan and results'}</button>` : ''}
    ${hasPlan && raw ? rawPlan(turn) : ''}
  </div>`;
}

/* The plan, as the exchange behind the answer.
 *
 * Patch is the model: he reads the sentence and decides. The Robot is the
 * JavaScript: it runs the skill exactly and reports what it did and where the
 * data came from. "The model plans, JS executes" is the whole design, and the
 * old stacked cards hid the hand-off under "1 of 7 over 0.375". Same data,
 * told in order, by whoever did it.
 *
 * EVERY WORD OF PATCH'S IS EARNED. His first line quotes the runway — the
 * short "about" phrase the planner writes before it commits, which is the one
 * moment the model thinks out loud — and how sure he sounds comes from the
 * router's own confidence, with the number on hover. His second line is the
 * plan. After that the model is silent: the Robot runs, JavaScript fills the
 * template above, and the panel ends on the Robot because nothing happens
 * after him. An earlier draft had Patch "read it back to you"; he does no such
 * thing, and the line was cut for being fiction.
 *
 * Plain English on the surface, the system's words one hover away: a skill is
 * named by its camelCase split into words ("the country lookup") with the
 * real name and description in the tooltip; "bundled" is "my built-in table";
 * "no network" is "nothing left this machine". The raw plan and results are a
 * click further in for anyone who wants the code. */
const PATCH_FACE = 'assets/patch-face.png';
const ROBOT_SVG = '<svg viewBox="0 0 28 28" aria-hidden="true"><rect x="5" y="8" width="18" height="15" rx="4" fill="currentColor"/><rect x="9.5" y="13" width="3.5" height="3.5" rx="1" fill="var(--panel)"/><rect x="15" y="13" width="3.5" height="3.5" rx="1" fill="var(--panel)"/><rect x="10" y="19" width="8" height="1.6" rx=".8" fill="var(--panel)"/><rect x="13" y="3" width="2" height="5" rx="1" fill="currentColor"/><circle cx="14" cy="3" r="1.8" fill="currentColor"/></svg>';
const hostOf = (u) => { try { return new URL(u).host; } catch { return u || 'the web'; } };
/* A skill's name as something a person can read aloud. Splitting the camel
   case gets 289 of the 307 there ("countryLookup" → "the country lookup"), and
   the rest need help: "the is weekend" and "the to csv" are not English, and
   "the countdown to" trails off looking for an object it will never get.
   and no article: most names are verb-led ("countWords", "formatJson"), so
   "the count words" is as wrong as "the countdown to". Without it every name
   reads as what it is — a tool's name — and "Use count words." is a sentence.
   Two names still need a noun to finish them, checked against the registry:
     is*  → "weekend check"
     to*  → "CSV converter"
   Acronyms come back up in capitals on the way through. */
const ACRONYMS = /\b(csv|tsv|json|jsonl|html|xml|yaml|url|uri|uuid|ascii|utf|http|https|ip|iban|api|utc|iso|css|rgb|hsl|hsv|cmyk|bmi|vat|gcd|lcm|pii|sql|md|id|ttl|dns|svg|png|jpg|pdf|qr|sha|crc|bcd)\b/g;
const words = (n) => String(n).replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase()
  .replace(ACRONYMS, (m) => m.toUpperCase());
const plainName = (n) => {
  const w = words(n);
  if (/^is /.test(w)) return `${w.slice(3)} check`;
  if (/^to /.test(w)) return `${w.slice(3)} converter`;
  return w;
};
const niceDate = (iso) => { try { return new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }); } catch { return iso; } };
/* A word with the system's number behind it. */
const term = (text, tip) => `<span class="cf-term" data-tip="${esc(tip)}" tabindex="0">${text}</span>`;

function chatFlow (turn) {
  /* Lane B's plan panel is one line from Patch and — this is the point of it —
     no Robot lines at all. The Robot is the JavaScript reporting what ran, how
     long it took and where the data came from; in this lane nothing ran, so
     the panel is visibly empty of execution. An absence is the honest record. */
  /* Lane B: written by whoever wrote it, and the Robot says only what ran —
     which for a job Pigeon can be a drawing, a search or a label check. The
     rows are built in bubbles.js, where the test suite can read them. */
  if (turn.lane === 'B') {
    const persona = personas.find(p => p.id === turn.persona) || null;
    const d = turn.persona ? pigeonOf(`pigeon:${turn.persona}`, personas, patchState) : null;
    return chatHtml(laneBFlow(turn, { d, persona }));
  }

  const rt = turn.routing;
  const st = turn.stages || {};
  const rows = [];
  const say = (who, html, sub = '', cls = '', subTitle = '') => rows.push({ who, html, sub, cls, subTitle });
  const secs = (ms) => (typeof ms === 'number' ? `${(ms / 1000).toFixed(1)} s` : '');
  const skillWord = (n) => {
    const sk = registry && registry.skill(n);
    return term(esc(plainName(n)), `${n}${sk ? ` — ${sk.description}` : ''}`);
  };
  const steps = (turn.plan && turn.plan.steps) || [];

  /* ── how sure Patch is, from what the router measured ─────────────────── */
  const certainty = () => {
    if (!rt) return null;
    const top = rt.candidates[0];
    const named = rt.category && !['none', 'unavailable'].includes(rt.category);
    const conf = typeof rt.confidence === 'number' ? rt.confidence : null;
    const actionable = rt.actionable && rt.actionable.length > 0;
    if (named && conf !== null) {
      const pct = Math.round(conf * 100);
      return term(conf >= 0.95 ? "I'm fairly certain that's it." : "I'm pretty sure, not certain.",
        `Patch is ${pct}% confident in this response — the category adapter's own confidence.`);
    }
    const why = routingWhy();
    if (actionable) return term("I'm pretty sure, not certain.", why);
    return term("I'm not 100% sure this is what they mean.", why);
  };
  /* The same explanation without the hedge in front of it, for the decline —
     where "not sure this is what they mean" would point at a "this" that was
     never chosen. */
  function routingWhy () {
    const top = rt && rt.candidates && rt.candidates[0];
    const named = rt && rt.category && !['none', 'unavailable'].includes(rt.category);
    const conf = rt && typeof rt.confidence === 'number' ? rt.confidence : null;
    if (named && conf !== null) return `The category adapter named ${rt.category} with ${Math.round(conf * 100)}% confidence.`;
    return top
      ? `No category was named. The best word match, ${top.name}, scored ${top.score.toFixed(2)} against a bar of ${rt.threshold}.`
      : 'No category was named and no skill matched a word.';
  }

  /* ── an image, read before anything was asked ─────────────────────────
     Two rows that happened BEFORE the turn: the Robot read the image with a
     classical engine, and Patch either tidied the reading or explains why his
     version was thrown out. Every number the tidy kept is one the engine read;
     that is the audit, and the row says so rather than implying it. */
  if (turn.image && !turn.image.picture) {
    const im = turn.image;
    say('robot', `Read ${wordCount(im.text)} words from ${esc(im.name || 'the picture')} with ${esc(im.engine || 'the text reader')}. ${term('Nothing left this Mac', 'The picture was read by a text recogniser on this Mac, handed the bytes directly. Only the text reader looked at it — no picture model, no network — and the picture was never written to disk.')}.`,
      secs(im.ocrMs), '', 'How long the engine took to read the image.');
    const tidy = im.used === 'cleaned'
      ? `I tidied what the Robot read — joined the broken lines, fixed the spacing — and ${term('every number in it is one the reader saw', 'The tidied text was checked with the same number extractor the reply auditor uses. A number the reader never saw would have had my version thrown out.')}.`
      : im.reason === 'no model'
        ? `No model was running, so the text went in exactly as ${esc(im.engine || 'the text reader')} read it.`
        : `I tried to tidy it but it ${esc(im.reason || 'did not pass the check')}, so I threw my version out and kept what ${esc(im.engine || 'the text reader')} read.`;
    say('patch', `${tidy}${im.edited ? ' The user corrected it before sending.' : ''}${im.truncated ? ' It was long, so only the first part went to the router.' : ''}`,
      im.used === 'cleaned' || im.reason !== 'no model' ? secs(im.cleanupMs) : '',
      im.used === 'cleaned' || im.reason === 'no model' ? '' : 'bad',
      'How long the tidy pass took.');
  }

  /* ── Patch, thinking out loud ─────────────────────────────────────────── */
  if (!rt) {
    say('patch', 'The user wrote this plan themselves, so I am sitting this one out.');
  } else if (turn.mode === MODES.NO_SKILL) {
    /* Two different declines, and telling them apart is the point. A null plan
       means the router never handed anything to the planner: nothing came near.
       An empty plan means the planner WAS shown the cards and turned them all
       down — and because the runway is part of that grammar, a refused plan can
       still carry the model's own reading of the question, which is the best
       line available anywhere in a decline.
       Saying what the nearest skill WOULD have done is what turns "no" into
       something a person can act on — quoted rather than conjugated. Most
       descriptions are verb-led ("Count the words in a text") and would drop
       into "it would count the words…", but not all are: currentTime reads
       "Today's date and the current time", which that sentence would mangle.
       Setting the description between dashes reads correctly for all 307. */
    const askedPlanner = Boolean(turn.plan);
    const about = turn.plan && typeof turn.plan.about === 'string'
      ? turn.plan.about.replace(/^[\s:;,.\u2013\u2014-]+/, '').replace(/[\s.]+$/, '') : '';
    const cands = rt.candidates || [];
    const tie = (rt.aboveThreshold || []).length > 1;
    const near = cands[0];
    const nearWord = (c) => {
      const sk = registry && registry.skill(c.name);
      return term(esc(plainName(c.name)),
        `${c.name}${sk ? ` — ${sk.description}` : ''} It scored ${c.score.toFixed(2)}, and the bar to act on is ${rt.threshold}.`);
    };
    const describes = (n) => esc((((registry && registry.skill(n)) || {}).description || '').replace(/\.$/, ''));

    say('patch', about
      ? `Robot, I think the user's asking for help with ${esc(short(about, 60))}.`
      : `Robot, ${term("I can't place this one", routingWhy())}.`,
      secs(st.router), '', 'How long Patch took to read the question.');

    const looked = askedPlanner
      ? `I looked through ${(rt.forPlanner || cands).length} of my skills and none of them does that.`
      : 'Nothing I have comes near it.';
    const refusal = tie && cands.length > 1
      ? `Two are close and I can't split them: ${nearWord(cands[0])} and ${nearWord(cands[1])}. I won't guess between them.`
      : near
        ? `${looked} The nearest is ${nearWord(near)} — ${describes(near.name)} — which isn't what they asked. I'd rather say no than run it.`
        : `${looked} I'd rather say no than run something that isn't it.`;
    say('patch', refusal, askedPlanner ? secs(st.planner) : '', 'bad',
      askedPlanner ? 'How long Patch took to look through them.' : '');
    return chatHtml(rows);
  } else {
    const about = turn.plan && typeof turn.plan.about === 'string' && turn.plan.about.trim();
    const first = about
      ? `Robot, I think the user's asking for help with ${esc(about.replace(/\.$/, ''))}. ${certainty()}`
      : steps.length
        ? `Robot, I think this wants ${skillWord(steps[0].skill)}. ${certainty()}`
        : `Robot, I'm reading this now. ${certainty()}`;
    say('patch', first, secs(st.router), '', 'How long Patch took to read the question.');
  }

  /* ── Patch commits: the plan ──────────────────────────────────────────── */
  const rescued = turn.verified && turn.verified.secondLook ? turn.verified : null;
  if (rt && steps.length) {
    const argsOf = (step) => {
      const props = (registry?.skill(step.skill)?.inputSchema?.properties) || {};
      return Object.entries(step.input || {})
        .filter(([f, v]) => !CTX_OWNED_FIELDS.includes(f) && v !== undefined && v !== null && v !== '' && !isRef(v))
        .filter(([f, v]) => !(props[f] && props[f].default !== undefined && JSON.stringify(props[f].default) === JSON.stringify(v)))
        .map(([, v]) => esc(short(typeof v === 'string' ? v : JSON.stringify(v), 40)));
    };
    const args = argsOf(steps[0]);
    const tail = args.length ? ` ${args.join(', ')}, please.` : ' Please.';
    const line = turn.forced ? `The user picked ${skillWord(turn.forced)} themselves.${tail}`
      : rescued ? `I nearly passed on this. A second look says ${skillWord(rescued.chosen)} fits.${tail}`
      : steps.length === 1 ? `Use ${skillWord(steps[0].skill)}.${tail}`
      : `Use ${steps.map(x => skillWord(x.skill)).join(', then ')}. Please.`;
    say('patch', line, secs((st.planner || 0) + (st.secondLook || 0) || undefined), '', 'How long Patch took to choose and copy out the arguments.');
  }

  if (turn.invalid) {
    say('patch', `I wrote a plan the checker threw out: ${esc(turn.invalid.map(e => e.message).join(' '))}`, '', 'bad');
    return chatHtml(rows);
  }

  /* ── The Robot does ───────────────────────────────────────────────────── */
  for (const r of turn.results || []) {
    const p = r.provenance || {};
    if (!r.ok) { say('robot', `Couldn’t. ${esc(r.error.message)}`, '', 'bad'); continue; }
    const from = p.kind === 'bundled'
      ? term(`From my built-in table${p.dataAsOf ? `, updated ${esc(niceDate(p.dataAsOf))}` : ''}`, `This skill answers from data shipped inside the app${p.dataAsOf ? `, dated ${p.dataAsOf}` : ''}. Nothing was fetched.`)
      : p.kind === 'web'
        ? term(`Asked ${esc(hostOf(p.source))}`, `One request left this machine, to ${p.source || 'the web'}. The answer is the page's own words.`)
        : term('Worked it out', 'Pure calculation. No data was looked up and nothing was fetched.');
    say('robot', `Done. ${r.ms} ms. ${from}.${p.kind === 'web' ? '' : ` ${term('Nothing left this machine', 'No network request was made for this step.')}.`}`);
  }

  /* ── Patch, once more, and this time it really is him ─────────────────
     A web answer is the only turn with a model pass AFTER the Robot: the
     provider hands back a whole paragraph and the model picks which sentence
     answers the question. It picks a NUMBER under a grammar — JS renders the
     sentence — so this line reports a real call without the model having
     written a word of the answer. */
  if (turn.reply && turn.reply.focus) {
    const f = turn.reply.focus;
    const n = Array.isArray(f.kept) && f.kept.length ? f.kept[0] : null;
    const ord = (i) => { const e = i % 10, t = i % 100; return `${i}${e === 1 && t !== 11 ? 'st' : e === 2 && t !== 12 ? 'nd' : e === 3 && t !== 13 ? 'rd' : 'th'}`; };
    const which = n
      ? term(`the ${ord(n)}`, `Sentence ${n} of ${f.of}. Patch chose the number; the words above are the page's own, rendered by code.`)
      : 'one';
    /* The model writes this phrase freehand and sometimes opens it with the
       punctuation it would have followed a label with (": the name of the
       current governor"). Tidied for reading only — the words are its own. */
    const phrase = String(f.lookingFor || '').replace(/^[\s:;,.\u2013\u2014-]+/, '').replace(/[\s.]+$/, '');
    const after = phrase
      ? `I was after ${esc(short(phrase, 60))}, so I kept ${which}`
      : `I kept ${which}`;
    say('patch', `That came back as ${f.of} sentences. ${after} and left the rest.`,
      secs(f.ms), '', 'How long Patch took to pick the sentence.');
  }

  if (turn.ask) {
    const a = turn.ask;
    const have = (a.have || []).map(h => esc(h.field));
    const invented = a.untraceable && /not in your message/.test(a.why || '');
    say('robot', invented
      ? `Patch gave me a ${esc(a.field)} the user never typed. I threw it out and I'm asking.`
      : `${have.length ? `I have ${have.join(' and ')}. I still need the ${esc(a.field)}` : `I need the ${esc(a.field)}`}, so I'm asking.`, '', 'ask');
  }
  return chatHtml(rows);
}

/* Three speakers: Patch, the Robot, and a Pigeon speaking as itself (its own
   avatar and name, supplied on the row). */
const flowFace = (r) => (r.who === 'patch' ? `<img src="${PATCH_FACE}" alt="" draggable="false">` : r.who === 'pigeon' ? r.avatar : ROBOT_SVG);
const flowName = (r) => (r.who === 'patch' ? 'Patch' : r.who === 'pigeon' ? esc(r.name) : 'Robot');
const chatHtml = (rows) => `<div class="chat-flow">${rows.map(r => `
  <div class="cf-row ${r.who}${r.cls ? ` ${r.cls}` : ''}">
    <span class="cf-av ${r.who}">${flowFace(r)}</span>
    <div class="cf-col"><span class="cf-who">${flowName(r)}</span>
      <div class="cf-bub">${r.html}</div>${r.sub ? `<span class="cf-sub"${r.subTitle ? ` data-tip="${esc(r.subTitle)}" tabindex="0"` : ''}>${esc(r.sub)}</span>` : ''}</div>
  </div>`).join('')}</div>`;

/* One tooltip for the whole page. A native title only appears on hover, and
   the dotted words read as clickable — on a phone hover does not exist at all.
   So: hover shows it, a click pins it, a click anywhere else or Escape lets it
   go, and keyboard focus shows it too. Fixed-positioned under the word, hidden
   on scroll so it cannot drift away from what it explains. */
(() => {
  let el = null;
  let pinned = null;
  const box = () => {
    if (el) return el;
    el = document.createElement('div');
    el.className = 'cf-tip';
    el.setAttribute('role', 'tooltip');
    el.hidden = true;
    document.body.appendChild(el);
    return el;
  };
  const target = (e) => e.target && e.target.closest ? e.target.closest('[data-tip]') : null;
  const show = (t) => {
    const b = box();
    b.textContent = t.dataset.tip;
    b.hidden = false;
    const r = t.getBoundingClientRect();
    b.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - b.offsetWidth - 8))}px`;
    b.style.top = `${r.bottom + 6}px`;
  };
  const hide = () => { if (el) el.hidden = true; };
  document.addEventListener('mouseover', (e) => { const t = target(e); if (t && !pinned) show(t); });
  document.addEventListener('mouseout', (e) => { if (target(e) && !pinned) hide(); });
  document.addEventListener('focusin', (e) => { const t = target(e); if (t && !pinned) show(t); });
  document.addEventListener('focusout', (e) => { if (target(e) && !pinned) hide(); });
  document.addEventListener('click', (e) => {
    const t = target(e);
    if (t) { e.stopPropagation(); if (pinned === t) { pinned = null; hide(); } else { pinned = t; show(t); } }
    else if (pinned) { pinned = null; hide(); }
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && pinned) { pinned = null; hide(); } });
  document.addEventListener('scroll', () => { pinned = null; hide(); }, true);
})();

/* §3.6 promises "the executed plan and the raw results", so the JSON stays —
   one click further in, because the picture answers the question first. */
function rawPlan (turn) {
  /* The reading, untruncated (§3.6): what the engine said, what the model
     said, and which of the two was sent. */
  const image = turn.image && !turn.image.picture ? `
      <div class="step">
        <div class="hd">
          <span class="t-badge image">image</span>
          <b>${esc(turn.image.name || 'image')}</b>
          <span class="ms">${turn.image.ocrMs ?? 0}ms${turn.image.cleanupMs ? ` + ${turn.image.cleanupMs}ms` : ''}</span>
        </div>
        <div class="kv">raw &nbsp;<pre class="inline">${esc(turn.image.raw ?? '')}</pre></div>
        ${turn.image.cleaned ? `<div class="kv">tidied &nbsp;<pre class="inline">${esc(turn.image.cleaned)}</pre></div>` : ''}
        <div class="kv">sent &nbsp;${esc(turn.image.used)}${turn.image.reason ? ` — ${esc(turn.image.reason)}` : ''}${turn.image.edited ? ' — edited by the user' : ''}</div>
      </div>` : '';
  return `${image}<pre>${esc(JSON.stringify(turn.plan ?? { steps: [] }, null, 2))}</pre>
    ${(turn.results || []).map(r => `
      <div class="step">
        <div class="hd">
          <span class="t-badge ${r.ok ? 'ok' : 'bad'}">${r.ok ? 'ok' : r.error.code}</span>
          <b>${esc(r.skill)}</b>
          ${(r.labels || []).map(l => `<span class="t-badge label">${esc(l)}</span>`).join('')}
          <span class="ms">${r.ms}ms</span>
        </div>
        <div class="kv">in &nbsp;${esc(short(JSON.stringify(r.input), 260))}</div>
        ${(r.dropped || []).map(d => `<div class="kv">not used &nbsp;${esc(d.field)} — the plan supplied a value, but ${esc(d.why)}</div>`).join('')}
        <div class="kv">out ${esc(short(JSON.stringify(r.ok ? r.value : r.error), 260))}</div>
      </div>`).join('')}
    ${turn.routing ? `<div class="rt">
      <span>router ${esc(turn.routing.backend)} · t_skill ${turn.routing.threshold}</span>
      ${turn.routing.candidates.map(c => `<span style="color:${c.score >= turn.routing.threshold ? 'var(--aqua)' : 'inherit'}">${esc(c.name)} ${c.score.toFixed(3)}${c.biased ? '+bias' : ''}</span>`).join('')}
    </div>` : ''}`;
}

/* ── skills ─────────────────────────────────────────────────────────────── */
let skillFilter = '';

/* The part of the skills view the filter changes, drawn on its own so typing
   in the filter redraws the list and never the box being typed in. */
function skillListHtml () {
  if (!registry) return `<div class="empty">${esc(patchNotReady())}</div>`;
  const all = registry.all();
  const q = skillFilter.trim().toLowerCase();
  const dev = devBuild();
  const shown = (q
    ? all.filter(s => (`${s.name} ${s.description} ${s.category}`).toLowerCase().includes(q))
    : all).filter(s => dev || !s.unbuilt);

  const byCat = new Map();
  for (const s of shown) {
    if (!byCat.has(s.category)) byCat.set(s.category, []);
    byCat.get(s.category).push(s);
  }

  return `${[...byCat.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([cat, list]) => `
      <div class="cat">${esc(cat)}</div>
      ${list.map(s => `
        <div class="srow ${s.unbuilt ? 'stub' : ''}">
          <div class="sn">
            <b>${dev ? esc(s.name) : esc(humanise(s.name))}</b>
            <p>${esc(s.description)}</p>
            ${s.examples && s.examples[0] ? `<div class="ex">“${esc(s.examples[0].text)}”</div>` : ''}
            ${s.blockedBy ? `<div class="ex">Cannot be a skill: ${esc(s.blockedBy)}.</div>` : ''}
          </div>
          <div class="tags">
            ${dev ? `<span class="t-badge ${s.tier}">${esc(s.tier)}</span>` : ''}
            ${dev ? (s.labels || []).map(l => `<span class="t-badge label">${esc(l)}</span>`).join('') : ''}
            ${s.dataAsOf ? `<span class="t-badge standard">as of ${esc(s.dataAsOf)}</span>` : ''}
            ${s.unbuilt ? `<span class="t-badge extended">${s.blockedBy ? 'blocked' : 'not built'}</span>`
              : (s.examples && s.examples[0] ? `<button class="try" data-say="${esc(s.examples[0].text)}">try</button>` : '')}
          </div>
        </div>`).join('')}`).join('')}
    ${shown.length ? '' : '<div class="empty">Nothing matches that filter.</div>'}`;
}

function paintSkills () {
  if (!registry) return `<div class="pad"><p class="lede">${esc(patchNotReady())}</p></div>`;
  const all = registry.all();
  const built = all.filter(s => !s.unbuilt).length;
  const lede = devBuild()
    ? `${built} skills are built, tested and routable. ${all.length - built} more are
      registered but not selectable — some are a backlog, and some are marked <em>blocked</em>
      because they cannot be skills at all: they would need a canvas or the filesystem, which §3.3
      forbids. Either way they are excluded from the router index at load time, so nothing can
      select one. Every example below is executed by the test suite and must produce the output it
      claims.`
    : `Patch works these ${built} things out on this Mac, each with a tested function. Press <b>try</b> on any of them and the example is typed into a new chat for you to send.`;
  return `<div class="pad">
    <p class="lede">${lede}</p>
    <div class="searchrow"><input id="skillq" placeholder="Filter skills…" value="${esc(skillFilter)}"></div>
    <div id="skillList">${skillListHtml()}</div>
  </div>`;
}

/* ── run a plan (§9 Phase 0, kept usable) ───────────────────────────────── */
const SAMPLE_PLAN = JSON.stringify({
  steps: [
    { id: 's1', skill: 'countryLookup', input: { query: 'Japan' } },
    { id: 's2', skill: 'currencyLookup', input: { code: '$s1.currency' } }
  ]
}, null, 2);
let planText = SAMPLE_PLAN;

function paintPlanView () {
  return `<div class="pad">
    <p class="lede">Phase 0's gate, left in the app because it stays useful: write a plan by hand,
      execute it, read the result. No router, no planner, no model — this is the executor on its own.
      Refer to an earlier step's output with <code>$s1.field</code>, and to the previous turn's with
      <code>$prev.s1.field</code>. Plans are capped at ${PLAN_LIMITS.MAX_STEPS} steps.</p>
    <div class="card">
      <h3>Plan JSON</h3>
      <p>Validated before anything runs: unknown skills, unbuilt skills, forward references, cycles,
        duplicate ids and non-object inputs are all rejected here rather than discovered halfway through.</p>
      <textarea id="planbox" spellcheck="false">${esc(planText)}</textarea>
      <div class="btnrow">
        <button class="btn primary" id="runplan">Execute</button>
        <button class="btn ghost" id="resetplan">Reset to sample</button>
      </div>
    </div>
    <div id="planout"></div>
  </div>`;
}

/* ── ledger ─────────────────────────────────────────────────────────────── */
/* A function, because two rows count the skills and the skills load after the
   first paint. Until then those counts read "…". */
const ledger = () => [
  ['Registry & contracts', true, `Envelopes, plan grammar, <code>ctx</code>, <code>replyTemplate</code>, ASK_USER, the JSON-Schema subset and its linter. All running.`],
  /* Counts are derived, never typed. This row said "505 examples" for a long
     while after there were 1,500 of them, which is the exact failure §12 exists
     to catch — a ledger drifting out of date is a ledger that misinforms. */
  ['Core & Standard skills', true, `${registry ? registry.routable().filter(s => s.tier !== 'web').length : '…'} built — every Core and Standard row in the skill index, plus the four Extended rows that were stubbed here — each with schemas, ≥5 examples and ≥3 error cases. All ${registry ? registry.routable().reduce((n, s) => n + (s.examples || []).length, 0).toLocaleString('en-GB') : '…'} examples are executed by the test suite and compared to their stated output.`],
  ['Executor', true, 'Ref resolution, ctx merge, validation, ASK_USER, the network gate, per-skill budget, typed failures, provenance.'],
  ['Template-first replies', true, 'Single-step plans render from <code>replyTemplate</code> in JS. The chat model never runs, so most turns cost nothing and can fabricate nothing.'],
  ['Fabrication auditor', true, 'Numerals and spelled-out number words in a reply are traced back to the results context or the message. Runs over every example in the suite.'],
  ['Provenance UI', true, 'Computed / bundled / web marks, dated tables, inline failures. Clicking a marked value opens what the skill was given, what it returned and where that came from — all of it, untruncated, resolved by the step id the value carries rather than by guessing from the skill name. "Show plan" draws the turn as a sequence — what was asked, how it was narrowed, what was chosen, what ran, where the words came from — and a turn that stopped early says so instead of trailing off; §3.6\'s raw plan and results are one click further in. A <code>|prose</code> token opts a caveat or a tense out of the value mark, so the mark keeps meaning "this is a computed value".'],
  ['Router', 'sub', 'Deterministic TF-IDF cosine with per-example vectors, max-sim per skill, previous-turn bias, coverage damping and a confidence margin — the <em>structure</em> §3.1 asks for, with a lexical backend instead of the embedding model. Measured on 145 unseen phrasings the tuning never saw: 23% routed right, 8% routed wrong, the rest declined and offered as suggestions, and <strong>73% had the right skill in the top five</strong>. At 100 skills that last figure was 98%. It falls as the registry grows and no threshold moves it, because it is a question about ranking rather than about a bar. That is the case for an encoder, and it is now three times louder than it was. The category adapter below is the answer actually built for it: it reaches skills that share no vocabulary with the question, which no threshold on this backend can.'],
  ['Extractor', 'sub', 'Schema-driven JS instead of the adapter: cue-matched arguments, verified against the skill itself before being accepted.'],
  /* This row said "not built / router-only single-skill mode" long after a
     working planner had been wired in — while the rail three inches away was
     displaying the model's name. A ledger that contradicts the screen it sits
     on is worse than no ledger. There is still no adapter; that is a separate
     claim and it is still false, so both halves are stated. */
  ['Planner adapter', false, 'Still not built, but no longer for want of data: <code>npm run plannerdata</code> generates <strong>1,728 training rows</strong> from the skills\' own hand-written examples, and every row is EXECUTED before it is kept — a plan that does not validate, run and reproduce the example\'s stated output is dropped. 1,455 single-step, 39 chained (the ref syntax, which is the planner\'s weakest area), 234 declines at 13.5%, zero overlap with the bench. The prompt in each row comes from the same functions the app calls, so training and inference cannot drift. Round 1 was trained — two hours on MLX, through Flight School\'s environment — and graded on the held-out bench: <strong>162 of 302 at 4 leaks</strong>. It cured the 1.5B base\'s leaking (30 of 50 → 4) but lost accuracy to sibling-skill confusion (<code>parseMarkdownTable</code> for <code>toMarkdownTable</code>) and learnt to invent arguments where the message had none, so it is not shipped; the prompted 2B at 212 stays. <code>model/planner-data/README.md</code> records the numbers and what round 2 changes. The planner is a stock model behind a grammar; no LoRA is trained for <em>it</em>. A LoRA does now exist for routing — see the row below — and the two are different claims.'],
  ['Planner (external model)', 'sub', 'A local llama-server writes the plan whenever one answers on the loopback port, reached through a Rust command rather than the network the webview is forbidden. It sees the router\'s shortlist and picks. Measured over 308 unseen phrasings with the category adapter routing: <strong>95% right</strong> (292 of 308) at about 1.9 s a question — 188 answered from the data in the message, 101 answered with a QUESTION because the message carried no data, 2 correct web picks the bench refuses because it keeps the web off — while wrongly answering <strong>20 of 100</strong> messages no skill covers. That is up from 142 with the same model and the same list, and every point of the difference came from prompts, JavaScript and the words on the cards rather than from training. The largest single jump was 54 rewritten skill descriptions: with the runway on, the commonest failure was not routing but the planner picking a near-twin, and contrasting the pairs took wrong-skill picks from 32 to 13. A lint over all 46,971 pairs (<code>src/lint-cards.js</code>) then found 35 more that no bench question had ever tested — <code>pxToRem</code> and <code>remToPx</code> shared every content word — and took it to 10. Before that, an input audit turned 39 answers computed from invented data into honest questions, which is why a third of successful turns now end by asking you something; a short free-text field the model fills in before it must name a skill, granted only when the adapter has already named a category, is worth about seventy answers on its own. Measured and NOT shipped, each with its numbers in the commit that dropped it: three sibling-discrimination adapters, a second category adapter, a pairwise tie-break, a router-trust mode, and a sense check that suppressed groundless plans. When nothing is listening the app falls back to §11\'s router-only single-skill mode, which is why multi-step plans are hand-written on the Run a plan screen.'],
  ['Category adapter', true, `A LoRA fine-tune of Qwen3-VL-2B, 17.4M trained parameters on 7,942 rows, that names the <em>category</em> a request belongs to before any word matching happens. On 145 phrasings held out of both training and threshold tuning: <strong>90% of categories right and 22 of 25 nonsense messages refused</strong>, in 68ms. It refuses rather than guesses — below ${CATEGORY_CONFIDENCE} confidence the answer is discarded and the lexical router stands in — because a wrong category hands the planner twenty tools that matched nothing. On Pigeon's full bench it routes 292 of 308 questions right and lets 18 of 100 no-skill messages through, against 289 and 21 for the Qwen2.5 adapter it replaced. Absent it, everything below behaves exactly as it did.`],
  ['Branching', true, `A conversation is a tree, not a list. Editing a question or asking again adds a new version <em>beside</em> the old one — the branch you left keeps its answer and everything you asked after it, and <code>‹ 1/2 ›</code> walks between them. Nothing you said is destroyed by changing your mind, which is what the earlier build did and what most chat apps still do. Turns carried <code>id</code>, <code>parentId</code> and <code>at</code> from the first version of this feature, so conversations saved before it existed are walked into the tree on load rather than refused or dropped.`],
  ['Progress while you wait', 'sub', `A question in flight is drawn as a turn, saying which pass it is in — finding the skill, planning, running it — from real events emitted by the pipeline, not from a timer. There is nothing else to show: the reply is rendered from templates <em>after</em> the skill runs, so no words are being generated that could be streamed. That is the same property that makes the numbers checkable, and it is why this reports the work rather than animating a bar. The finished reply is then typed out at reading speed, which is presentation and is skipped for long answers and for anyone who asked for less motion.`],
  ['Chat history', true, `Conversations are saved to <strong>one file</strong>, <code>state.json</code>, in this app\'s own data directory. The page hands Rust a JSON string and never a path — the path is built in <code>store.rs</code> from the app data directory, so the webview cannot name where it writes, exactly as it cannot name a model port or a search host. Writes go to a temporary file and are renamed into place, so a crash mid-save leaves the previous transcript whole rather than half of a new one. Nothing is copied to <code>localStorage</code>: a second copy would be a second thing to keep honest, and the eviction rules that come with it are a data-loss path this build can simply not have. Deleting a chat removes it from the file before the dialog closes. Nothing leaves the machine. Opened in a browser, where there is no bridge to Rust, none of this happens and the session is discarded on close — the rail\'s bottom row says which of the two you are in.`],
  ['Assembler', 'sub', 'No model writes a reply in this build, and §8\'s seam is filled by a <em>selection</em> pass instead. A web answer arrives as the provider\'s whole opening section — three sentences about the office of governor, with the name in the last one — so the model is shown those sentences, numbered, and replies with a <strong>number</strong> under a grammar that admits nothing else; JS renders that sentence verbatim, with the same source link. The model\'s whole contribution is an integer, so it cannot rephrase, merge two facts or invent a name: the reply is still the source\'s own words, and the untrimmed passage stays behind the marked span and under Show plan. It writes a few words naming what the question wants <em>before</em> the number, which is what makes it work — on eight labelled passages the 2B scored 2 of 6 without that and 8 of 8 with it, the same finding the planner\'s runway records. A refusal, an unreachable model or a one-sentence answer all leave the passage whole. A multi-step turn is reduced the same way but with NO model at all: the plan already says which step is the answer, because a step whose output another step consumes is working. So &quot;20 * 200 = 4000 4000 / 10 = 400&quot; becomes &quot;4000 / 10 = 400&quot;. A model was tried for that choice first and managed 4 of 6, defaulting to &quot;show everything&quot; on the chained cases that most needed trimming; the derivation gets them all, with no call and no latency. Two terminal steps mean two things were asked for and both are shown, and a turn with any failed step always concatenates — a pass that could hide an error would be trading honesty for brevity.'],
  ['Web skills', true, `${registry ? registry.routable().filter(s => s.needsNetwork).length : '…'} built — <code>webAnswer</code> for a question with one factual answer, <code>webSearch</code> for the pages themselves. Both go out through a Rust command that owns the two endpoints it may contact; the page hands over a query and can never name a host. Three gates stand in front of a request and all three must pass: the web switch in the header (off by default), the executor's <code>webEnabled</code> check, and a per-request confirmation showing exactly what would be sent. A refusal is reported as NETWORK_OFF, and the transcript says the request was never made. Answers carry the page they came from — the contract refuses to build a web value without a source — and neither skill summarises or rephrases, so there is no step where a model could add a detail the source does not have.`],
  ['Web skills — the second look', 'sub', `A factual question that nothing offline can answer is missed twice over: word matching cannot rank a skill it shares no words with (<em>"who is the govenor of virginia"</em> — misspelt, and no skill says "virginia"), and the category adapter is no help either, because it was trained to answer "none" to general knowledge and genuinely splits about 54/45 between that and <code>reference</code>, so it never clears its confidence bar. Rather than widen either gate, which would cost refusals everywhere, a turn that would otherwise decline asks the planner once more with ONLY the web skills on the table. Same planner, same rules; the web option is simply no longer buried under twenty offline near-misses. Measured on the 50 no-skill messages with a provider rigged to always answer, this costs <strong>one</strong> — <em>"tell me about the fall of constantinople"</em>, which is a lookup, and was only ever unanswerable because nothing could look things up. It runs only when the web is on, so the offline benchmark is unchanged at 122 of 302 with 0 of 50.`],
  ['Web skills — what the tests prove', 'sub', `The examples run against provider replies recorded on ${FIXTURES_AS_OF} (<code>web-fixtures.js</code>), so <code>npm test</code> stays offline and deterministic and proves the SKILLS: that they parse the reply, carry the source, and refuse when there is nothing. It does not prove the providers still work. <code>npm run webcheck</code> is the live one and is deliberately not part of <code>npm test</code> — a suite that fails when a public API has a bad afternoon is a suite people learn to ignore. It has already earned this: it caught a fixture that was kinder than the real provider, which is how the encyclopedia fallback came to exist.`],
  ['Reading an image', 'sub', `<strong>Two ways, decided by the Pigeon.</strong> A <b>picture Pigeon</b> — one trained on a picture base (Qwen3-VL-2B), which carries its projector in its file — is handed the picture itself: the picture server starts the first time one is asked, and the reply is marked as the model’s own words, because there is nothing in between to show. <b>Every other Pigeon</b>, and Patch, gets the text in the picture instead. Paste, drop or choose an image and a classical OCR engine — the Mac\'s own Vision recogniser, through the bundled <code>pigeon-eye</code>, run by a Rust command with the image\'s bytes on stdin and nothing else — reads the text in it. If a planner is up, the same model is asked to repair what OCR breaks (a line broken inside a sentence, <code>Tota|</code> for <code>Total</code>) and its answer is checked with the reply auditor\'s own number extractor: a number the engine never read means the tidy is thrown out and the raw reading is used. <code>1O apples</code> tidied to <code>10 apples</code> is discarded, because 10 is not a number the engine read — which is the safe direction for that check to be wrong in. What the model writes is <em>input</em>: it is shown beside the raw reading, can be corrected, and goes through the same router and planner as anything typed. No model writes a reply, and nothing here is in the reply path. Only the text reaches the conversation and the file on disk; the pixels never leave the window, and a picture waiting on the composer is not saved with the draft. Nothing is measured yet — no accuracy figure for the engine or the tidy, and the rail marks it as a stand-in.`],
  ['The chat lane (Lane B)', 'sub', `A second reply path where a model is allowed to write the words you read, which the verified lane's design permanently forbids. It runs on the same llama-server as the category adapter and cannot reach it: the router speaks to <code>/completion</code>, which on this build IGNORES a per-request adapter selection, while the chat lane speaks to <code>/v1/chat/completions</code>, which honours one and names every adapter with its scale — the category adapter at 0, a persona at 1. Measured before it was built, because the sibling app's notes assume a mechanism this build does not have. A runtime test asserts the router's answers and confidences are identical before and after the chat lane has been talking. The code cannot cross either: <code>src/lane-b/</code> imports nothing from the rest of <code>src/</code> — not the registry, the executor, the auditor or a skill — and <code>npm test</code> fails the build if that changes. So a generated reply has no segments, no values and no provenance, and is drawn in a different colour with a permanent badge saying so. <strong>A persona cannot compute.</strong> Ask a question whose answer is a figure and any number the model states that you did not supply is dropped before you see it, with the offer to hand the question to the verified lane instead. That rule fires on the QUESTION, not on every number: the first real question asked here came back as a numbered list and an always-on version ate it over the "1.". Marked as a stand-in because the part that had to be trained is not here: <em>personas</em> are LoRA adapters from Flight School, and the technique is proven (a Socratic tutor at 25/25, a robot and a poet at 18/20 each, in a since-retired pilot) but no adapter for this base model exists yet. Without one the lane is the base model, which is a real thing to talk to and has no voice of its own.`],
  ['The menu bar', 'sub', `Patch sits in the tray all day and clicking him opens a popover — a second window running the same pipeline, drawing values with the same renderer, so a figure answered there carries the same computed / bundled / web mark it would here. It opens in the <b>verified</b> lane and that is not a setting: something you reach for in two seconds opens on the lane whose answers can be checked. Its status line is permanent and says what Pigeon is holding at that moment, because the honesty rail belongs where the app lives. <strong>Resident and empty is the default.</strong> Closing this window no longer quits — it hides, puts both models to sleep and drops the Dock icon, leaving the lexical router and 307 pure functions, which answer about one question in six outright in under 20 ms. Measured with the models asleep: <strong>209 MB across three processes</strong>, against about 2.9 GB when they are awake. Marked as a stand-in for one reason: the idle-unload period that stops a woken model sitting there forever is <em>ten minutes because ten minutes seemed right</em>, not because anything was measured, and <code>PIGEON_IDLE_UNLOAD_S</code> is how that gets tested.`],
  ['Reading the screen', 'sub', `An extra Rust command shaped exactly like the OCR one: it takes no path, hands back bytes, and the picture never touches disk — CoreGraphics to a PNG made in memory, handed to the page as a data URL. macOS asks for screen-recording permission the first time someone <em>uses</em> the action and never at launch, because a prompt on first run for a feature you have not reached for is how an app teaches people to click through prompts without reading them. The popover shows the capture, you drag over the part you meant, and the crop is taken at full resolution and read by the same OCR path an attached image uses; the text is INPUT, marked <code>as read</code>, and lands where it can be corrected before it is asked. A stand-in like the OCR row above it, and for the same reason — no accuracy figure exists — plus one of its own: it has not yet run against a real screen on the machine it was written on, which grants no screen-recording permission. What the tests cover is the refusal, and the contract that matters either way: no file appears while a capture is taken.`],
  ['Training set & eval', 'sub', 'The category adapter has both: 6,142 rows, of which 12.6% are refusals, and a check ride on a holdout half that neither training nor threshold fitting ever saw. Every question in that holdout was checked against every training row for near-copies — matching on words with numbers wildcarded, not string equality — and 0 exact and 1 borderline collision were found. Nothing else in §7 has training data. There <em>is</em> also a holdout for the router: one phrasing per built skill that appears in no skill\'s examples, split so the half the router constants are fitted to is not the half it is graded on. The same router scores 83% on the tuning half and 73% on the grading half, which is the difference that split exists to expose. Fifteen phrasings also had to be rewritten because they were token-identical to one of their own skill&rsquo;s examples once numerals are dropped — they were being graded as unseen while being the training text. The §8 numbers this build can honestly report are router recall and no-skill precision, both measured by <code>npm test</code>.']
];

function paintLedger () {
  return `<div class="pad">
    <p class="lede">§12 of the spec keeps a Reality vs. Aspiration ledger, on the grounds that
      over-claiming is the failure mode this project is most exposed to. This is that ledger for
      this build, and the rail's status strip is the short version of it.</p>
    <div class="warn"><b>The one number that matters.</b> §8 sets a target of zero fabrication and
      nothing else gets a zero. In this build the majority of replies are rendered from templates by
      JS, so the fabrication rate is zero by construction rather than by measurement — there is no
      model in the reply path to fabricate with. The focus pass does not change that and was
      designed so it could not: it selects one of the source's own sentences by number rather than
      writing prose, so there is still no step in which a model emits a word of the reply. Note
      that the auditor could not have protected this — it traces numerals and number words, so a
      model that renamed a governor would pass it — which is exactly why the pass constrains the
      output instead of checking it afterwards. That stops being free the moment a real Assembler
      is installed, which is why the auditor exists now.</div>
    <table class="ledger">
      <thead><tr><th>Component</th><th>State</th><th>What is actually there</th></tr></thead>
      <tbody>${ledger().map(([name, state, note]) => `<tr>
        <td>${esc(name)}</td>
        <td style="white-space:nowrap">${state === true ? '<b>running</b>' : state === 'sub' ? '<i>stand-in</i>' : '<i>not built</i>'}</td>
        <td>${note}</td></tr>`).join('')}</tbody>
    </table>
  </div>`;
}

/* ── paint ──────────────────────────────────────────────────────────────── */
const TITLES = { chat: 'Chat', skills: 'Skills', plan: 'Run a plan', ledger: 'Reality vs. Aspiration' };
/* The chat view's subtitle depends on which lane you are in, because the two
   make opposite claims and the header is where a claim belongs. */
function subFor (view) {
  if (view !== 'chat') return subs()[view];
  if (activeLane() === 'A') return subs().chat;
  const persona = chatPersona(activeChat());
  if (!persona) return 'a model writes these words · nothing here is computed';
  return isVoice(persona)
    ? `a model writes these words · ${persona.name}`
    : `${persona.name} · one job, nothing here is computed`;
}

/* Computed on use: the skills count is not known until Patch has loaded. */
const subs = () => ({
  chat: 'the model plans, JS executes, the model phrases',
  skills: registry ? `${registry.routable().length} routable · ${registry.all().length - registry.routable().length} unbuilt` : patchWord(),
  plan: 'the executor, on its own',
  ledger: 'what is real in this build'
});

/* What a repaint must NOT destroy.
 *
 * paint() rebuilds #view wholesale, and #view contains the composer. That was
 * harmless while the only things that repainted were "you sent a message" and
 * "you switched view" — both of which legitimately want a fresh, focused,
 * scrolled-to-bottom thread. The moment a button under an old message repaints,
 * the same code throws away a half-typed draft and jumps you to the bottom of a
 * long conversation.
 *
 * So: capture what the user was doing, and restore it unless the thread
 * actually grew. `lastPaintKey` is what tells those two apart. */
let lastPaintKey = null;
/* Set by a send in the open chat: the one redraw that may take focus and go
   to the bottom without the thread itself having grown. */
let followNext = false;
const followIf = (c) => { if (c && c.id === state.activeChatId) followNext = true; };
/* The edit box that was already on screen, so a redraw does not pull focus
   into it: only a newly opened one takes the caret. */
let editingShown = null;
/* What rises into place, decided by events rather than by guessing from the
   paint key (which also changes for a profile visit or an image being read).
   A question rises once when it is sent — the in-flight turn, keyed by its
   send time — and its reply rises once when it lands (`landedTurn`, set by
   landReply). `lastAnimatedChat` keeps opening a chat that is already
   mid-question from counting as the send. */
let lastAnimatedChat = null;
let animatedFlight = null;
let landedTurn = null;
/* Set by retry/edit: scroll THIS turn into view rather than the bottom. */
let scrollToTurn = null;
/* Set when a reply lands while you are reading further up the thread: the next
   paint keeps your place and shows New reply rather than jumping. */
let holdScroll = false;
const showJump = () => { const j = $('jumpNew'); if (j) j.hidden = false; };
const hideJump = () => { const j = $('jumpNew'); if (j) j.hidden = true; };

function paint () {
  /* The composer is about to be rebuilt; a starter still typing into the old
     one finishes first, so the new box reads back the whole text. */
  finishTyping();
  const prevThread = $('thread');
  const keepScroll = prevThread ? prevThread.scrollTop : null;
  /* Both text boxes get the same protection: the composer, and the edit box
     when one is open. An incidental repaint — a model finishing detection, say —
     must not swallow either. */
  const grab = (el) => el && document.activeElement === el
    ? { v: el.value, s: el.selectionStart, e: el.selectionEnd, h: el.style.height }
    : null;
  const keepBox = grab($('msg'));
  const keepEdit = grab($('editbox')) || ($('editbox') ? { v: $('editbox').value, s: null, e: null, h: '' } : null);

  const keepTo = grab($('toInput'));

  paintList();
  paintHead();
  const lane = activeLane();
  if (typeof document !== 'undefined' && document.body) document.body.dataset.lane = lane.toLowerCase();
  const app = $('app');
  if (app) app.classList.toggle('pane-open', state.paneOpen);
  const v = $('view');
  v.className = `view${state.view === 'chat' && !state.profile ? ' chat' : ''}`;
  v.innerHTML = state.profile ? paintProfile()
    : state.view === 'chat' ? paintChat()
      : state.view === 'skills' ? paintSkills()
        : state.view === 'plan' ? paintPlanView() : paintLedger();
  paintToList();
  paintDetails();  wire({ keepScroll, keepBox, keepEdit, keepTo });
}

/* ── the conversation's header ─────────────────────────────────────────────
   Who this chat is with and how it answers, said before a word of any reply is
   read — "with Patch · Works it out · starts fresh", "with Pen · Writes ·
   remembers the chat" — because the header is where a claim belongs. While something is being
   worked out, the same line says what, from the stage events the thread shows. */
function paintHead () {
  const head = $('paneHead');
  if (!head) return;
  const back = `<button class="head-btn back" data-do="back" aria-label="Back to the list">${ICONS.back}</button>`;
  head.classList.toggle('chat', state.view === 'chat' && !state.profile && !state.compose);
  if (state.view !== 'chat') {
    head.innerHTML = `${back}<div class="contact"><span class="contact-txt"><span class="c-name">${esc(TITLES[state.view])}</span>
      <span class="c-sub">${esc(subFor(state.view))}</span></span></div>
      <button class="head-btn" data-do="close-view" aria-label="Close" title="Back to the conversation">${ICONS.x}</button>`;
    return;
  }
  if (state.profile) {
    const d = pigeonOf(state.profile, personas, patchState);
    head.innerHTML = `${back}<div class="contact">${avatarHtml(d, 34)}<span class="contact-txt">
      <span class="c-name">${esc(d.name)}</span><span class="c-sub">${esc(d.does)}</span></span></div>`;
    return;
  }
  const c = activeChat();
  if (state.compose) {
    const d = state.compose.picked ? pigeonOf(pickForChat(c), personas, patchState) : null;
    /* Addressed to Patch because nobody said otherwise: the way out is a named
       button, not an × that only says what it removes. Chosen on purpose, it
       is the × as before — taking off a name you picked is a different act
       from changing your mind about a default. */
    const byDefault = Boolean(d && state.compose.byDefault);
    head.innerHTML = `${back}<div class="to-row"><label for="toInput">To:</label><div class="to-field">${d
      ? `<span class="token${d.kind === 'verified' ? '' : ' warm'}${byDefault ? ' plain' : ''}">${avatarHtml(d, 22)}${esc(d.name)}${byDefault
          ? ''
          : `<button class="x" data-do="clear-to" aria-label="Remove ${esc(d.name)}">${ICONS.x}</button>`}</span>${byDefault
        ? `<button class="to-else" data-do="clear-to" title="Send this to a different Pigeon">Someone else…</button>`
        : ''}`
      : `<input id="toInput" autocomplete="off" spellcheck="false" placeholder="Patch, Pen or a Pigeon’s name"
          role="combobox" aria-controls="toList" aria-expanded="true" value="${esc(state.compose.q)}">`}</div></div>
      <button class="head-btn" data-do="leave-compose" aria-label="Cancel" title="Cancel this new chat">${ICONS.x}</button>`;
    return;
  }
  const d = pigeonOf(pickForChat(c), personas, patchState);
  const busy = c.inflight;
  /* Patch wears the app icon here like everywhere else. */
  const avatar = avatarHtml(d, 34);
  head.innerHTML = `${back}<button class="contact" data-do="page" data-pick="${esc(d.pick)}" title="What ${esc(d.name)} does">${avatar}<span class="contact-txt">
      <span class="c-name"><span class="c-title">${esc(c.title)}</span>${c.muted ? ICONS.bellOff : ''}</span>
      ${busy
        ? `<span class="c-sub busy${d.kind === 'verified' ? '' : ' warm'}" id="headStage">${esc(d.name)} · ${esc(busy.stage || 'working on it')}…</span>`
        : `<span class="c-sub">with ${esc(d.name)}${factLine(d) ? ` · ${esc(factLine(d))}` : ''}</span>`}</span></button>
    ${playHeadBtn(chatPersona(c))}
    <button class="head-btn" data-do="details" aria-expanded="${state.details}" aria-label="Chat details" title="Chat details">${ICONS.info}</button>
    <button class="head-btn" data-do="chat-menu" aria-label="More" title="Rename, pin, delete…">${ICONS.ellipsis}</button>`;
}

/* A Pigeon that plays gets Play in its chat's header — and Stop while it is
   playing — so a play is one click from the conversation, not a page away. */
function playHeadBtn (p) {
  if (!canPlay(p)) return '';
  return playingNow(p.id)
    ? `<button class="head-btn play-on" data-do="play-stop" aria-label="Stop playing" title="Stop playing (⌘⇧.)">${ICONS.stop}</button>`
    : `<button class="head-btn" data-do="play-open" data-pick="${esc(p.id)}" aria-label="Play" title="Play a game with ${esc(p.name)}">${ICONS.play}</button>`;
}

/* The Pigeons under To:. Redrawn on its own as you type, so the field keeps
   its caret; the header around it is only rebuilt by a full paint. `toRows` is
   the list as drawn, so the arrow, Enter and number keys act on what is on
   screen. */
let toRows = [];

/* "Suggested: Patch can work this out", when what was written before choosing
   matches one of his skills by its words alone. A transcript is full of figures
   and is not a sum, and nor is a page of text, so neither is suggested. Word
   matching only: no model is woken to decide a suggestion. */
let suggestRouter = null;
let suggestRegistry = null;
function suggestsPatch (text) {
  const t = String(text || '').trim();
  if (!t || !registry || patchState.state !== 'ready') return false;
  if (t.split(/\s+/).length > 60 || /^\s*\[?\d{1,2}:\d{2}/m.test(t) || /-->/.test(t)) return false;
  if (!suggestRouter || suggestRegistry !== registry) { suggestRouter = lexicalFor(registry); suggestRegistry = registry; }
  try { return suggestRouter.route(t).actionable.length > 0; } catch { return false; }
}

function paintToList () {
  const list = $('toList');
  if (!list) return;
  const open = Boolean(state.view === 'chat' && state.compose && !state.compose.picked);
  list.hidden = !open;
  if (!open) { toRows = []; return; }
  const counts = {};
  const lastAt = {};
  for (const c of state.chats) {
    if (isEmpty(c)) continue;
    const k = pickForChat(c);
    counts[k] = (counts[k] || 0) + 1;
    lastAt[k] = Math.max(lastAt[k] || 0, lastActivity(c));
  }
  const recent = [...new Set(byActivity(state.chats.filter(c => !isEmpty(c))).map(pickForChat))].slice(0, 3);
  const suggest = Boolean(state.compose.suggest) && !state.compose.q && suggestsPatch(state.compose.suggest);
  const drawn = toListHtml({ personas, q: state.compose.q, hi: state.compose.hi, counts, lastAt, recent, suggest, patchState });
  state.compose.hi = drawn.hi;
  toRows = drawn.flat;
  list.innerHTML = drawn.html;
  const input = $('toInput');
  if (input) input.setAttribute('aria-activedescendant', toRows.length ? `sg-${drawn.hi}` : '');
  const on = list.querySelector('[aria-selected="true"]');
  if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest' });
}

/* The side panel: a chat's details, or Message info for one reply. Message info
   is found by id in the chat on screen, so switching chats closes it. */
function paintDetails () {
  const el = $('info');
  if (!el) return;
  const inChat = state.view === 'chat' && !state.profile && !state.compose;
  const c = activeChat();
  const turn = inChat && state.info ? chatNodes(c)[state.info] : null;
  const show = Boolean(inChat && (turn || state.details));
  el.hidden = !show;
  if (!show) return;
  const d = pigeonOf(pickForChat(c), personas, patchState);
  el.classList.toggle('mi-host', Boolean(turn));
  if (turn) {
    el.innerHTML = messageInfoHtml(turn, { name: d.name, kind: d.kind, planHtml: planPanel(turn) });
    return;
  }
  el.innerHTML = chatDetailsHtml(c, d, { facts: chatFacts(c), dev: pigeonFacts(d) });
}

function paintProfile () {
  const d = pigeonOf(state.profile, personas, patchState);
  const mine = byActivity(state.chats.filter(c => !isEmpty(c) && pickForChat(c) === d.pick));
  const persona = d.id ? personas.find(p => p.id === d.id) || null : null;
  const card = deriveCard(d, persona, { turns: HISTORY_TURNS });
  const rec = persona && (state.settings.reproduced || {})[persona.id];
  const current = card.maker && rec && rec.revision === card.maker.revision && rec.check === REPRODUCE_CHECK;
  const reproduced = current ? rec.results : null;
  if (card.maker && card.maker.examples.length && !reproduced && persona && persona.loaded && !persona.vision && !isVoice(persona)) checkReproduced(persona, card.maker);
  const drawings = persona && persona.skill && card.maker && card.maker.examples.length ? exampleDrawingsFor(persona, card.maker) : null;
  const plays = canPlay(persona);
  return profileHtml(d, {
    pinned: Boolean((state.settings.pinnedPigeons || {})[d.pick]),
    draft: pageDrafts.get(d.pick) || '',
    play: plays ? playCardHtml(persona, playUi.status) : '',
    playButton: plays ? (playingNow(persona.id) ? 'stop' : 'play') : null,
    chats: mine,
    facts: pigeonFacts(d),
    skills: registry ? registry.routable().length : null,
    card,
    reproduced,
    sources: current ? rec.sources || null : null,
    grounded: !!(persona && persona.retrieval),
    drawings,
    turns: HISTORY_TURNS,
    getModel: pictureOffer(d) || embeddingOffer(d),
    notes: persona ? persona.notes || [] : []
  });
}

/* Play (docs/PLAY-LOOP.md): the page's side is only what to show and which
   window. Rust decides what is pressed, from the Pigeon's own keys. */
/* What was typed on a Pigeon's page and not yet sent, by pick. */
const pageDrafts = new Map();

const playUi = { perm: null, windows: null, window: null, thumbs: {}, watchOnly: false, limitMin: 0, moreOpen: false, status: null, test: null, busy: false, error: null };
/* The Play sheet while it is open. */
let playSheet = null;

const playingNow = (id) => Boolean(playUi.status && playUi.status.pigeon === id && ['starting', 'playing', 'waiting'].includes(playUi.status.state));
const chosenWindow = () => (playUi.windows || []).find(w => w.id === playUi.window) || null;
const howFor = (app) => (app && state.settings.playHow && state.settings.playHow[app]) || 'hid';

/* Play, from the Pigeon's chat header or its page: one sheet. Already
   playing, it brings the overlay back instead. */
async function openPlaySheet (id) {
  const p = personas.find(x => x.id === id);
  const call = pigeonInvoke();
  if (!canPlay(p) || !call) return;
  if (playingNow(p.id)) { call('play_hud', { show: true }).catch(() => {}); return; }
  if (playUi.status && ['starting', 'playing', 'waiting'].includes(playUi.status.state)) {
    toast(`${playUi.status.name || 'Another Pigeon'} is already playing — stop it first (⌘⇧.).`, 4200);
    return;
  }
  Object.assign(playUi, { perm: null, windows: null, thumbs: {}, test: null, busy: false, error: null, moreOpen: false });
  const opened = openSheetHost(playSheetHtml(p, playUi, { how: 'hid' }), (host, close) => {
    host.addEventListener('click', (e) => {
      if (e.target.closest('[data-close]')) { close(); return; }
      const b = e.target.closest('[data-play]');
      if (b && !b.disabled) playSheetAct(b.dataset.play, b, p);
    });
    host.addEventListener('change', (e) => {
      if (e.target.matches('[data-play="watch"]')) { playUi.watchOnly = e.target.checked; redrawPlaySheet(); }
      if (e.target.matches('[data-play="limit"]')) { playUi.limitMin = Number(e.target.value) || 0; }
    });
    host.addEventListener('toggle', (e) => { if (e.target.matches('.ps-more')) playUi.moreOpen = e.target.open; }, true);
  });
  playSheet = { ...opened, pigeon: p.id };
  /* macOS applies a permission switched on in System Settings when Pigeon
     comes back to the front, so that is when to look again. */
  await refreshPlaySheet(p);
}

function redrawPlaySheet () {
  if (!playSheet || !document.body.contains(playSheet.host)) { playSheet = null; return; }
  const p = personas.find(x => x.id === playSheet.pigeon);
  const card = playSheet.host.querySelector('.play-sheet');
  if (!p || !card) return;
  const focused = document.activeElement && playSheet.host.contains(document.activeElement)
    ? (document.activeElement.dataset.win ? `[data-win="${document.activeElement.dataset.win}"]` : document.activeElement.dataset.play ? `[data-play="${document.activeElement.dataset.play}"]` : null)
    : null;
  card.outerHTML = playSheetHtml(p, playUi, { how: howFor(chosenWindow()?.app) });
  const back = focused && playSheet.host.querySelector(focused);
  if (back) back.focus();
}

async function refreshPlaySheet (p) {
  const call = pigeonInvoke();
  if (!call || !playSheet) return;
  try {
    playUi.perm = await call('play_permission');
    redrawPlaySheet();
    if (!playUi.perm.screen) return;
    const listed = await call('play_windows').catch((e) => { playUi.error = friendly(e); return []; });
    /* Pigeon's own windows are never the game. */
    playUi.windows = listed.filter(w => !/^pigeon$/i.test(String(w.app || '')));
    if (!playUi.windows.some(w => w.id === playUi.window)) {
      const last = playUi.windows.find(w => w.app === state.settings.playLastApp);
      playUi.window = (last || playUi.windows[0] || {}).id ?? null;
    }
    redrawPlaySheet();
    /* A picture of each window, as the Pigeon would see it, one at a time. */
    for (const w of playUi.windows.slice(0, 8)) {
      /* Cancelled or closed: no more pictures of windows nobody will see. */
      if (!playSheet || !document.body.contains(playSheet.host)) return;
      if (playUi.thumbs[w.id]) continue;
      let shot;
      try { shot = await call('play_preview', { pigeon: p.id, window: w.id }); } catch { shot = 'failed'; }
      playUi.thumbs[w.id] = shot;
      const slot = playSheet && playSheet.host.querySelector(`[data-win="${w.id}"] .ps-shot`);
      if (slot) slot.innerHTML = typeof shot === 'string' && shot.startsWith('data:image/') ? `<img alt="" src="${shot}">` : '<span>no picture</span>';
    }
  } catch (e) {
    playUi.error = friendly(e);
    redrawPlaySheet();
  }
}

async function playSheetAct (what, el, p) {
  const call = pigeonInvoke();
  if (!call) return;
  playUi.error = null;
  try {
    if (what === 'ask') {
      playUi.perm = await call('play_ask', { which: el.dataset.which });
      /* Asked once already, macOS says nothing the second time: its settings
         pane is the only place left to switch it on. */
      if (!playUi.perm[el.dataset.which]) await call('play_open_settings', { which: el.dataset.which });
      redrawPlaySheet();
    } else if (what === 'recheck' || what === 'refresh') {
      if (what === 'refresh') { playUi.windows = null; playUi.thumbs = {}; }
      await refreshPlaySheet(p);
    } else if (what === 'pick') {
      playUi.window = Number(el.dataset.win);
      playUi.test = null;
      redrawPlaySheet();
    } else if (what === 'test') {
      const w = chosenWindow();
      playUi.busy = 'test'; redrawPlaySheet();
      try {
        playUi.test = await call('play_key_test', { pigeon: p.id, window: playUi.window, answer: (p.presses.keys[0] || {}).answer || '' });
        if (playUi.test.works && w) { state.settings.playHow = { ...(state.settings.playHow || {}), [w.app]: playUi.test.works }; persist(); }
      } catch (e) { playUi.test = { error: friendly(e) }; }
      playUi.busy = false;
      redrawPlaySheet();
    } else if (what === 'start') {
      const w = chosenWindow();
      if (!w) return;
      playUi.busy = 'start'; redrawPlaySheet();
      await call('play_start', { pigeon: p.id, window: w.id, how: howFor(w.app), watchOnly: playUi.watchOnly, limitS: playUi.limitMin ? playUi.limitMin * 60 : null });
      state.settings.playLastApp = w.app;
      persist();
      playUi.busy = false;
      if (playSheet) playSheet.close();
      playSheet = null;
      paint();
    }
  } catch (e) {
    playUi.busy = false;
    playUi.error = friendly(e);
    redrawPlaySheet();
  }
}

globalThis.addEventListener?.('focus', () => { if (playSheet && playUi.perm && !(playUi.perm.screen && playUi.perm.keys)) refreshPlaySheet(personas.find(x => x.id === playSheet.pigeon)); });

/* Every move: the page's card and the header's Play/Stop follow it. Only a
   change of state redraws the whole pane; a move redraws the card alone. */
globalThis.__TAURI__?.event?.listen?.('play-event', (e) => {
  const was = playUi.status && playUi.status.state;
  playUi.status = e.payload;
  const card = document.querySelector('.play-card.live');
  const p = personas.find(x => x.id === e.payload.pigeon);
  if (was === e.payload.state && card && p) { card.outerHTML = playCardHtml(p, playUi.status); return; }
  if (was !== e.payload.state) paint();
});
const initialPlay = pigeonInvoke();
if (initialPlay) initialPlay('play_status').then((s) => { playUi.status = s && s.state ? s : null; }).catch(() => {});

/* A drawing Pigeon's examples, drawn by Rust once per revision and kept in
   memory for as long as the app runs — never written anywhere. Null until they
   arrive; the page shows the recipes meanwhile and repaints with pictures. */
const exampleDrawings = new Map();
function exampleDrawingsFor (persona, maker) {
  const key = `${persona.id}@${maker.revision}`;
  if (exampleDrawings.has(key)) return exampleDrawings.get(key);
  /* One revision per Pigeon: an update drops the drawings of the one before. */
  for (const k of [...exampleDrawings.keys()]) if (k.startsWith(`${persona.id}@`)) exampleDrawings.delete(k);
  const call = pigeonInvoke();
  if (!call) return null;
  exampleDrawings.set(key, null);
  call('pigeon_example_drawings', { pigeon: persona.id })
    .then((list) => {
      if (!Array.isArray(list) || !list.some(x => typeof x === 'string')) return;
      exampleDrawings.set(key, list);
      paint();
    })
    .catch(() => { /* the recipes stay, which is what the page showed before */ });
  return null;
}

/* For a grounded Pigeon while the models sleep: ask its material first. When
   nothing covers the question, returns the section titles it DOES cover (an
   empty list if even those cannot be read); otherwise null, and the usual
   wake-first path runs. */
async function noMaterialWithoutWaking (pigeon, message) {
  const call = pigeonInvoke();
  if (!pigeon.retrieval || !call || chat) return null;
  try {
    const out = await call('pigeon_run', { req: { pigeon: pigeon.id, text: message } });
    if (!out || !out.no_material) return null;
  } catch { return null; /* it has something to read and the models are asleep */ }
  try {
    const titles = await call('pigeon_contents', { pigeon: pigeon.id });
    return Array.isArray(titles) ? titles.slice(0, 8) : [];
  } catch { return []; }
}

/* That "not in here", filed once, stamped when it was asked. */
function landNoMaterial (c, { message, handedFrom, under, pendingAskId }, base, contents) {
  followIf(c); startInflight(c, { message, handedFrom, lane: 'B', parentId: under, pendingAskId });
  return landReply(c.id, { ...base, reply: { source: 'generated', text: '' }, noMaterial: true, contents, ms: 0 });
}

/* The maker's examples, run on this Mac once its models are awake: the same
   input through the same prompt at temperature 0, asked as an example so a
   grounded Pigeon is shown the section its example carries. A tag says which
   came out the same — for a grounded Pigeon, which came from the same
   sentence, since a right answer in other words is still right. Kept per
   revision and per way of checking, so a re-packed Pigeon, or one checked
   the old way, is checked again. */
const REPRODUCE_CHECK = 2;
const reproducing = new Set();
async function checkReproduced (persona, maker) {
  const call = pigeonInvoke();
  if (!call || !chat || reproducing.has(persona.id)) return;
  reproducing.add(persona.id);
  const results = [];
  const sources = [];
  try {
    for (const e of maker.examples) {
      try {
        const out = await call('pigeon_run', { req: { pigeon: persona.id, text: e.input, example: true, expect: e.output } });
        const same = out && out.same_source;
        results.push(same ? same.same === true : String((out && out.text) || '').trim() === String(e.output).trim());
        sources.push(same ? { expected: same.expected ?? null, got: same.got ?? null } : null);
      } catch { results.push(null); sources.push(null); }
    }
    if (results.some(r => r !== null)) {
      const rec = { revision: maker.revision, check: REPRODUCE_CHECK, results };
      if (sources.some(Boolean)) rec.sources = sources;
      state.settings.reproduced = { ...(state.settings.reproduced || {}), [persona.id]: rec };
      persist();
      paint();
    }
  } finally { reproducing.delete(persona.id); }
}

/* Patch on the empty chat has a life of his own. paint() redraws the element
   freely, so the Life outlives it and is re-attached in wire(). He is still a
   drawing under prefers-reduced-motion. The header wears the app icon and
   does not animate. */
const patchPerch = life('patchEmpty', 84, { idle: true, track: true, sleep: true });

function wire ({ keepScroll = null, keepBox = null, keepEdit = null, keepTo = null } = {}) {

  /* To:, while a new chat has nobody on it. Typing narrows the list below;
     the arrows move through it, Enter takes the highlighted one and 1–9 take
     the one with that number; Escape clears what was typed, then cancels. */
  const to = $('toInput');
  if (to) {
    to.oninput = () => { state.compose.q = to.value; state.compose.hi = 0; paintToList(); };
    to.onkeydown = (e) => {
      const k = pickerKey(e, toRows, state.compose.hi);
      if (!k) return;
      if (k.escape) {
        e.preventDefault();
        if (to.value) { to.value = ''; state.compose.q = ''; paintToList(); } else leaveCompose();
        return;
      }
      if (e.key === 'Enter' && !toRows[state.compose.hi]) return;
      e.preventDefault();
      if ('move' in k) { state.compose.hi = k.move; paintToList(); } else composeTo(k.pick);
    };
    if (keepTo) { to.focus(); to.setSelectionRange(keepTo.s, keepTo.e); }
  }

  /* Forward to Patch, Forward to Chat: the question goes to a chat of its own
     with the other side. The person clicks; nothing crosses on its own. */
  document.querySelectorAll('[data-fwd]').forEach(b => {
    b.onclick = () => { const [id, pick] = b.dataset.fwd.split('|'); askSomeoneElse(id, pick); };
  });
  /* The two tools beside a message: react, and ⋯. */
  document.querySelectorAll('[data-tool]').forEach(b => {
    b.onclick = (e) => {
      e.stopPropagation();
      const [id, which] = b.dataset.key.split('|');
      if (b.dataset.tool === 'more') { openMessageMenu(b, id, which); return; }
      state.tapback = state.tapback === b.dataset.key ? null : b.dataset.key;
      paint();
    };
  });
  document.querySelectorAll('[data-react]').forEach(b => {
    b.onclick = (e) => {
      e.stopPropagation();
      const [id, which, emoji] = b.dataset.react.split('|');
      setReaction(activeChat(), id, which, emoji);
      state.tapback = null;
      state.freshReaction = `${id}|${which}`;
      persist();
      paint();
      state.freshReaction = null;
    };
  });
  const threadEl = $('thread');
  if (threadEl) {
    /* Right-click a message for its menu — unless text is selected, when the
       system's own Copy is what is wanted. */
    threadEl.oncontextmenu = (e) => {
      const m = e.target.closest('.msg[data-turn]');
      if (!m || String(window.getSelection ? window.getSelection() : '')) return;
      e.preventDefault();
      openMessageMenu({ x: e.clientX, y: e.clientY }, m.dataset.turn, m.dataset.which);
    };
    threadEl.onclick = (e) => {
      if (state.tapback && !e.target.closest('.tapback,[data-tool]')) { state.tapback = null; paint(); }
    };
    threadEl.onscroll = () => {
      if (threadEl.scrollHeight - threadEl.scrollTop - threadEl.clientHeight < 60) hideJump();
    };
  }

  /* Did the conversation move on, or did the page merely redraw?
     Grew  → a new message to read: focus the composer, go to the bottom.
     Same  → the user was doing something else: put it back exactly. */
  /* The chat's id is in here because two conversations can have the same turn
     count — without it, switching between them looks like "nothing changed"
     and one thread's scroll position is restored into the other. */
  /* Only what a person would call the conversation moving on: a different
     view or chat, a new turn, a question from Patch — or a send they just made
     (followNext). A queued message going out, a reading finishing, a reply
     starting or ending are not, and used to be: each one focused the box and
     scrolled to the bottom under a reader. */
  const key = `${state.view}:${state.profile}:${state.compose ? (state.compose.picked ? 'to' : 'choosing') : ''}:${state.activeChatId}:${state.turns.length}:${asking() ? 1 : 0}`;
  const grew = key !== lastPaintKey || followNext;
  const sentByMe = followNext;
  lastPaintKey = key;
  followNext = false;

  const box = $('msg');
  if (box) {
    box.oninput = () => {
      warmWhileTyping();
      box.style.height = 'auto';
      box.style.height = `${Math.min(160, box.scrollHeight)}px`;
      /* Written through on every keystroke: the draft, not the DOM, is now
         what a repaint reads back. */
      setDraft(state.activeChatId, box.value, box.style.height);
      /* The note is redrawn in its own slot, so the box keeps its caret. */
      const slot = $('noteSlot');
      if (slot) slot.innerHTML = noteHtml(noteFor(activeChat(), box.value));
    };
    /* Focus is the earliest sign of a question after a pause. */
    box.onfocus = () => warmSoon();
    box.onkeydown = (e) => {
      /* A key while a starter is still typing takes the whole starter first,
         so Enter sends all of it and anything else edits all of it. */
      finishTyping();
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendFromComposer(box.value); }
    };
    /* An image on the clipboard — a screenshot, mostly — is read rather than
       pasted as nothing. Text pastes are left entirely to the browser. */
    box.onpaste = (e) => {
      finishTyping();
      const item = [...(e.clipboardData?.items || [])].find(i => i.kind === 'file' && /^image\//.test(i.type));
      if (item) {
        e.preventDefault();
        attachImage(item.getAsFile());
        return;
      }
      /* A pasted transcript is NOTICED, never intercepted. The text lands in
         the box exactly as the browser would put it there; all this adds is a
         chip beside it offering to tidy. Recognising something is not a reason
         to touch what somebody typed. */
      const text = e.clipboardData?.getData('text/plain') || '';
      if (text) offerTranscript(text);
    };
    const send = $('send');
    if (send) send.onclick = () => {
      if (send.classList.contains('stop')) { stopWaiting(state.activeChatId); return; }
      finishTyping();
      sendFromComposer(box.value);
    };

    const tidyBtn = document.querySelector('[data-tr-tidy]');
    if (tidyBtn) tidyBtn.onclick = () => tidyPastedTranscript();
    for (const b of document.querySelectorAll('[data-tr-use]')) {
      b.onclick = () => useTranscript(b.getAttribute('data-tr-use'));
    }
    const drop = document.querySelector('[data-tr-drop]');
    /* Dismissing the chip drops the OFFER, never the text. */
    if (drop) drop.onclick = () => { dropTranscript(); paint(); };
    const penNotes = document.querySelector('[data-tr-pen]');
    if (penNotes) penNotes.onclick = () => {
      const t = transcript;
      if (!t) return;
      const text = t.used === 'repaired' && t.repaired ? t.repaired : t.used === 'mechanical' && t.mechanical ? t.mechanical : t.raw;
      askPenWith(`Write short notes from this transcript:\n\n${text}`);
    };

    const pick = $('imgPick'), fileIn = $('imgFile');
    if (pick && fileIn) {
      pick.onclick = () => fileIn.click();
      fileIn.onchange = () => { attachImage(fileIn.files && fileIn.files[0]); fileIn.value = ''; };
    }

    /* The chip. Edits go straight to the record without a repaint, which
       would drop the caret. */
    const rm = document.querySelector('[data-attach-remove]');
    if (rm) rm.onclick = () => { dropAttachment(); paint(); };
    const tog = document.querySelector('[data-attach-toggle]');
    if (tog) tog.onclick = () => { attachment.editing = !attachment.editing; paint(); };
    document.querySelectorAll('[data-attach-use]').forEach(b => {
      b.onclick = () => {
        const which = b.dataset.attachUse;
        attachment.used = which;
        attachment.text = which === 'cleaned' ? attachment.cleaned : attachment.raw;
        attachment.edited = false;
        paint();
      };
    });
    const rep = document.querySelector('[data-attach-replace]');
    if (rep) rep.onclick = () => { putReadingInBox(attachment); paint(); };
    const keep = document.querySelector('[data-attach-keep]');
    if (keep) keep.onclick = () => { dropAttachment(); paint(); };
    const cp = document.querySelector('[data-attach-copy]');
    if (cp) cp.onclick = () => { if (attachment) copyText(attachment.text); };
    const ta = $('attachText');
    if (ta) ta.oninput = () => { attachment.text = ta.value; attachment.edited = true; };

    if (keepBox && !grew) {
      /* The text came back with the render; what the DOM cannot carry across a
         repaint is where the caret was and whether the box had focus. */
      box.focus();
      box.setSelectionRange(keepBox.s, keepBox.e);
    } else if (grew) {
      /* The box takes the keyboard when the conversation moved on and the
         keyboard was nowhere in particular — never out of the search box, a
         rename, or a setting somebody is in the middle of. A send of your own
         (sentByMe) always brings it back. */
      const on = document.activeElement;
      const thread = $('thread');
      const nowhere = !on || on === document.body || (thread && thread.contains(on));
      if (sentByMe || nowhere) box.focus();
    }
  }

  const ed = $('editbox');
  if (ed) {
    if (keepEdit) {
      ed.value = keepEdit.v;
      if (keepEdit.s !== null) { ed.focus({ preventScroll: true }); ed.setSelectionRange(keepEdit.s, keepEdit.e); }
    } else if (state.editing !== editingShown) {
      /* Just opened: the caret goes to the end. Already open and unfocused,
         a redraw leaves it alone. */
      ed.focus();
      ed.setSelectionRange(ed.value.length, ed.value.length);
    }
    ed.onkeydown = (e) => {
      if (e.key === 'Escape') { state.editing = null; paint(); }
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEdit(state.editing, ed.value); }
    };
    const save = $('editSave'), cancel = $('editCancel');
    if (save) save.onclick = () => saveEdit(save.dataset.editSave, ed.value);
    if (cancel) cancel.onclick = () => { state.editing = null; paint(); };
  }

  editingShown = ed ? state.editing : null;

  const th = $('thread');
  if (th) {
    const target = scrollToTurn && document.getElementById(`turn-${scrollToTurn}`);
    scrollToTurn = null;
    if (target) { target.scrollIntoView({ block: 'center' }); target.classList.add('flash'); }
    /* A reply that lands while you are reading further up does not pull you
       down to it: you stay where you were, and New reply says it is there. */
    else if (grew && holdScroll && keepScroll !== null) { th.scrollTop = keepScroll; showJump(); }
    else if (grew || keepScroll === null) { th.scrollTop = th.scrollHeight; hideJump(); }
    else th.scrollTop = keepScroll;
    holdScroll = false;

    const sameChat = state.activeChatId === lastAnimatedChat;
    const flight = state.busy ? `${state.activeChatId}:${state.busy.sentAt}` : null;
    const flightEl = flight && flight !== animatedFlight && sameChat && !target ? th.querySelector('.turn.inflight') : null;
    if (flightEl) flightEl.classList.add('turn-enter');
    animatedFlight = flight;
    /* Only the reply part: the question above it already rose when it was sent. */
    const landedEl = landedTurn && !target ? document.querySelector(`#turn-${CSS.escape(landedTurn)} .msg.them`) : null;
    if (landedEl) landedEl.classList.add('turn-enter');
    landedTurn = null;
    lastAnimatedChat = state.activeChatId;
  }

  document.querySelectorAll('.starter[data-say]').forEach(b => {
    /* A starter is a suggestion, not a commitment: it goes into the box to be
       read, edited or sent like anything typed by hand — never out on its own
       — so clicking one can never fire off a question, or a chat, the person
       did not actually choose to send. Typed in rather than dropped in, so it
       visibly arrives from the chip you touched rather than materialising. */
    b.onclick = () => typeIntoComposer(box, b.dataset.say);
  });
  document.querySelectorAll('[data-say]:not(.starter)').forEach(b => {
    /* The skill index's "try" types the example into a new chat with Patch,
       the way every other chip types: nothing is sent until you press ↩. */
    b.onclick = () => {
      startCompose('patch');
      setTimeout(() => typeIntoComposer($('msg'), b.dataset.say), 0);
    };
  });
  wireRuns(document);

  document.querySelectorAll('[data-retry]').forEach(b => {
    b.onclick = () => retryTurn(b.dataset.retry);
  });
  document.querySelectorAll('[data-wake]').forEach(b => {
    b.onclick = () => wakeAndRetry(b.dataset.wake);
  });
  document.querySelectorAll('[data-ver]').forEach(b => {
    b.onclick = () => {
      const [id, delta] = b.dataset.ver.split('|');
      switchVersion(id, Number(delta));
    };
  });

  /* A Pigeon's page has a box: Enter starts a new chat with it and sends. */
  const pageMsg = $('pageMsg');
  if (pageMsg) {
    /* A draft like any other: it survives a look at another tab. */
    pageMsg.oninput = () => { if (state.profile) pageDrafts.set(state.profile, pageMsg.value); };
    pageMsg.onkeydown = (e) => {
      if (e.key !== 'Enter' || e.shiftKey) return;
      e.preventDefault();
      const text = pageMsg.value.trim();
      if (!text || !state.profile) return;
      pageDrafts.delete(state.profile);
      startCompose(state.profile);
      sendFromComposer(text);
    };
  }

  /* The raw plan's toggle, inside Message info's details. */
  document.querySelectorAll('[data-raw]').forEach(b => {
    b.onclick = () => {
      const id = b.dataset.raw;
      state.raw.has(id) ? state.raw.delete(id) : state.raw.add(id);
      paint();
    };
  });

  patchPerch.attach($('patchEmpty'));

  const q = $('skillq');
  if (q) {
    q.oninput = () => {
      /* Only the list: the box keeps its focus, caret and selection because
         it is never rebuilt, the way the sidebar search redraws only rows. */
      skillFilter = q.value;
      const list = $('skillList');
      if (list) list.innerHTML = skillListHtml(); else paint();
    };
  }

  const pb = $('planbox');
  if (pb) pb.oninput = () => { planText = pb.value; };
  const rp = $('runplan');
  if (rp) rp.onclick = executeHandWrittenPlan;
  const reset = $('resetplan');
  if (reset) reset.onclick = () => { planText = SAMPLE_PLAN; paint(); };
}

/* ── actions ────────────────────────────────────────────────────────────── */

/* The Run-a-plan screen's last result. Not a conversation turn — it has no
   message and never enters the transcript — so it gets a reserved id rather
   than a place in state.turns. */
const SCRATCH_TURN = 'scratch';
let scratchTurn = null;

/* Ask again, and edit-then-ask-again.
 *
 * Both DISCARD the turns after the one acted on. That is the honest reading of
 * what the person did: they changed their mind about a question, so the answers
 * that followed from the old one are answers to a conversation that no longer
 * happened. Keeping them would leave replies to newer questions sitting above
 * replies to older ones.
 *
 * It is also lossy and there is no undo, which is the argument for the tree the
 * desktop app keeps. Every turn already carries `id`, `parentId` and `at`, so
 * that upgrade is an added field rather than a rewrite of saved history. */
/* Ask again, and edit-then-ask-again.
 *
 * Both add a new version BESIDE the turn they act on — same parent, so the old
 * question and everything that followed it stay in the tree, one arrow away.
 * Nothing you asked is deleted by changing your mind, which is the difference
 * between a conversation you can explore and one you can only overwrite. */
/* One tap to the twin: the same message asked again with the one skill the
   person chose, landing as a new version beside the answer they tapped on.
   ‹ 1/2 › walks back to the first. */
async function retwinTurn (id, skill) {
  const chatId = state.activeChatId;
  const c = activeChat();
  const turn = chatNodes(c)[id];
  if (!turn || !skill) return;
  warmSoon();
  if (c.inflight) {
    afterReply(chatId, () => say(turn.message, { chatId, parentId: turn.parentId ?? null, attach: null, image: turn.image ?? null, fromComposer: false, onlySkill: skill }));
    toast(`Asking with ${skill} as soon as this reply lands.`);
    return;
  }
  const now = await say(turn.message, { parentId: turn.parentId ?? null, attach: null, image: turn.image ?? null, fromComposer: false, onlySkill: skill });
  if (now && state.activeChatId === chatId) { scrollToTurn = now.id; paint(); }
}

async function retryTurn (id) {
  const chatId = state.activeChatId;
  const nodes = chatNodes(activeChat());
  const turn = nodes[id];
  if (!turn) return;
  /* A reply already on its way: this goes as a new version once it lands. */
  if (activeChat().inflight) {
    afterReply(chatId, () => say(turn.message, { chatId, parentId: turn.parentId ?? null, attach: null, image: turn.image ?? null, fromComposer: false }));
    toast('Trying again as soon as this reply lands.');
    return;
  }
  const before = answerOf(turn);
  /* The composed message already carries the image's text; the record rides
     along so the new version still says where that text came from, and the
     chip on the composer (if any) is left alone. */
  const now = await say(turn.message, { parentId: turn.parentId ?? null, attach: null, image: turn.image ?? null, fromComposer: false });
  if (!now) return;
  if (state.activeChatId === chatId) {
    scrollToTurn = now.id;
    paint();
  }
  /* Without a planner the pipeline is deterministic, so asking again returns
     the same answer and looks broken. Say so rather than hiding the button:
     hiding a control because a model happens to be down is the aspirational-UI
     failure the Ledger exists to catch, and it starts mattering the moment a
     model appears or the web switch flips. */
  toast(answerOf(now) === before
    ? 'Asked again — same plan, same answer. Use ‹ › to compare.'
    : 'Asked again. Use ‹ › to see the other version.');
}

function startEdit (id) {
  if (!state.turns.some(t => t.id === id)) return;
  state.editing = id;
  paint();
}

async function saveEdit (id, text) {
  const message = String(text || '').trim();
  if (!message) { toast('An empty question has nothing to ask.'); return; }
  const chatId = state.activeChatId;
  const turn = chatNodes(activeChat())[id];
  if (!turn) return;
  /* A reply already on its way: the edit goes as a new version once it lands,
     in the chat it was made in, whatever is on screen by then. */
  if (activeChat().inflight) {
    const image = turn.image ? { ...turn.image, edited: true } : null;
    if (image && sentPictures.has(turn.image)) sentPictures.set(image, sentPictures.get(turn.image));
    state.editing = null;
    afterReply(chatId, () => say(message, { chatId, parentId: turn.parentId ?? null, attach: null, image, fromComposer: false }));
    paint();
    toast('Your edit goes as soon as this reply lands.');
    return;
  }
  state.editing = null;
  /* An edit shows the composed message — question and the image's text in
     one box — and sends whatever it becomes. The record is kept so the trace
     still says the text was read from an image; if the user rewrote that text
     the record's `text` is what was originally read, and `edited` says so. */
  const image = turn.image ? { ...turn.image, edited: true } : null;
  if (image && sentPictures.has(turn.image)) sentPictures.set(image, sentPictures.get(turn.image));
  let now;
  try {
    now = await say(message, { parentId: turn.parentId ?? null, attach: null, image, fromComposer: false });
  } catch (e) {
    /* Nothing went: the box comes back with what was typed in it, so a
       failure costs a click rather than the edit. */
    if (state.activeChatId === chatId && chatNodes(activeChat())[id]) {
      state.editing = id;
      paint();
      const ed = $('editbox');
      if (ed) { ed.value = message; ed.setSelectionRange(message.length, message.length); }
    }
    toast(friendly(e), 5200);
    return;
  }
  if (!now) return;
  if (state.activeChatId === chatId) {
    scrollToTurn = now.id;
    paint();
  }
  toast('Asked again. The version you edited is still there — use ‹ ›.');
}



/* `parentId` is what makes a branch. Normally a message continues the path, so
   it hangs off the last turn on show. Retry and edit pass the parent of the turn
   being reworked instead, which puts the new turn BESIDE the old one rather than
   after it — and that is the whole of branching. */
/* Why a turn stopped, in words. The one that actually happens is the model
   server going away mid-question — Rust reports "llama-server unreachable: ..."
   — and what that means to a person is that the models went, not that a socket
   refused. Anything else is shown as it came, because a failure nobody can name
   is worse than a technical one somebody can quote. */
/* What a failure says in a toast. Rust's refusals are already sentences and
   are shown as they are; anything that looks like a stack, a serialiser or a
   bare code is said in plain words and kept in the console for whoever asks. */
function friendly (e) {
  const raw = String((e && e.message) || e || '').trim();
  if (raw) console.warn('pigeon:', raw);
  if (!raw) return 'Something went wrong.';
  const technical = raw.length > 240 || /\b(TypeError|ReferenceError|SyntaxError|undefined|NaN|null)\b|[{}]|\bat [\w.<>]+ \(|serde|deserializ|invoke|panicked|unwrap/i.test(raw);
  if (technical) return 'Something went wrong — the details are in the log.';
  const sentence = raw.replace(/[\s.]+$/, '');
  return `${sentence[0].toUpperCase()}${sentence.slice(1)}.`;
}

function askFailed (e) {
  const raw = String((e && e.message) || e || '').trim();
  /* Named as a possibility, not a diagnosis: sleeping on window close is much
     the most likely reason the server is not there, and it is not the only one,
     so the sentence says "may have" and leaves it at that. The Try again button
     is directly underneath, which is why none of these end by asking for one. */
  if (/unreachable|econnrefused|connection refused|failed to connect|os error 61/i.test(raw)) {
    return 'Couldn’t reach the models — they may have gone to sleep when the window closed.';
  }
  if (/timed out|timeout/i.test(raw)) return 'The models took too long to answer this one.';
  return `Patch couldn’t finish this one: ${raw.replace(/[.\s]+$/, '') || 'something went wrong'}.`;
}

async function say (text, { parentId, attach = attachment, image = null, handedFrom = null, fromComposer = true, chatId: forChat = null, quoteId: givenQuote = undefined, onlySkill = null } = {}) {
  const typed = String(text || '').trim();
  /* The chat this is asked in, captured now. The answer is filed back into it
     by id however long it takes and wherever you have gone meanwhile. Returns
     the filed turn, or null when nothing was sent. A queued message names its
     chat, because it goes when that chat is free, not when it is on screen. */
  const c = forChat ? chatById(state.chats, forChat) : activeChat();
  if (!c) return null;
  const chatId = c.id;
  /* What this message quoted, if anything. Shown on the bubble only: a quote
     is never added to what a Pigeon is sent. */
  const quoteId = givenQuote !== undefined
    ? givenQuote
    : (fromComposer && state.quote && state.quote.chatId === chatId ? state.quote.turnId : null);

  /* One question at a time per chat, but a second message is never refused:
     sent while a reply is on its way, it waits in the chat's queue and goes
     when the chat is free, the way a text sent twice does. Only what was typed
     queues; a picture on the composer stays there until it can go with one. */
  if (c.inflight) {
    if (!typed) return null;
    if (fromComposer && attach) { toast('The picture goes with your next message, once this reply lands.'); return null; }
    enqueue(c, { text: typed, quoteId });
    if (fromComposer) { setDraft(chatId, ''); state.quote = null; state.handoffNote = null; }
    persist();
    paint();
    return null;
  }

  /* The two lanes do not share a reply path, and this is where they part.
     Everything below is Lane A: the router, the planner, the executor, the
     audit. Lane B goes to runChat and touches none of it. */
  if (laneOf(c) === 'B') {
    /* A picture's text goes with the message here too, composed and capped the
       way Lane A does it. A one-shot Pigeon already took the text into its box
       (settleOneShot), so a chip still waiting on Replace / Keep mine is a
       choice not yet made, and nothing goes until it is. */
    const img = fromComposer ? attach : null;
    let message = typed;
    /* Asked again (Try again, Edit): the record of what was sent rides along,
       and a picture goes again from memory — or not at all, said so. */
    let record = !fromComposer && image ? image : null;
    if (record && record.picture) {
      if (pictureGone(record)) { toast('Attach the picture again — a picture is not kept once Pigeon closes.', 4200); return null; }
      pendingPictures.set(chatId, sentPictures.get(record));
    }
    if (img && (img.status === 'reading' || img.status === 'tidying')) {
      toast('Still reading the image — one moment.');
      return null;
    }
    let picture = null;
    if (img && img.picture !== undefined) {
      if (img.status !== 'ready') { toast(img.status === 'failed' ? img.error : 'Still getting the picture ready — one moment.', 4200); return null; }
      picture = img.picture;
      record = { name: img.name, mime: img.mime, width: img.width, height: img.height, picture: true, thumb: img.thumb, typed };
      sentPictures.set(record, picture);
    } else if (img && img.status === 'ready') {
      if (img.choose) {
        toast(img.choose === 'blind'
          ? `${img.forName || 'This Pigeon'} cannot see the picture — choose Use this text or Discard first.`
          : 'Choose what goes in the box on the image first.', 4200);
        return null;
      }
      const { text: sent, truncated } = capAttached(img.text);
      message = composeMessage(typed, sent);
      record = {
        name: img.name, mime: img.mime, width: img.width, height: img.height, thumb: img.thumb || null,
        engine: img.engine, model: img.model,
        raw: img.raw, cleaned: img.cleaned, used: img.used, reason: img.reason,
        text: sent, typed, edited: Boolean(img.edited), truncated,
        ocrMs: img.ocrMs, cleanupMs: img.cleanupMs
      };
    }
    if (!message && !picture && !pendingPictures.has(chatId)) return null;
    /* Refused before the draft is cleared, like every other refusal here. */
    if (pigeonGone(c)) {
      toast(pigeonOf(pickForChat(c), personas, patchState).line, 4200);
      return null;
    }
    const path = pathOf(c);
    const under = parentId !== undefined ? parentId : (path[path.length - 1]?.id ?? null);
    /* Cleared here and not before: the early returns above are refusals, and a
       refused send must leave what you wrote where it is. */
    if (fromComposer) { setDraft(chatId, ''); state.quote = null; state.handoffNote = null; }
    if (record) { if (fromComposer) dropAttachment(); pendingImages.set(chatId, record); }
    if (picture) pendingPictures.set(chatId, picture);
    if (quoteId) pendingQuotes.set(chatId, quoteId);
    return sayInLaneB(message, under, chatId, handedFrom);
  }

  /* Lane A needs Patch's skills. Until they have loaded — or when they could
     not be — the turn is refused before anything is cleared: the draft, the
     attachment and the transcript offer all stay where they are. */
  if (patchState.state !== 'ready') {
    toast(patchNotReady(), 4200);
    return null;
  }

  /* An image on the composer goes with the question. The message the router
     and planner see is the question, a blank line, then the text — capped, so
     a page of OCR does not crowd the planner's cards; the full reading stays on
     the record. Sending while the engine is still reading is refused rather
     than sent without: the person attached it for a reason. */
  let record = image;
  let message = typed;
  if (attach && (attach.status === 'reading' || attach.status === 'tidying')) {
    toast('Still reading the image — one moment.');
    return null;
  }
  if (attach && attach.status === 'ready') {
    const { text: sent, truncated } = capAttached(attach.text);
    message = composeMessage(typed, sent);
    record = {
      name: attach.name, mime: attach.mime, width: attach.width, height: attach.height,
      engine: attach.engine, model: attach.model,
      raw: attach.raw, cleaned: attach.cleaned, used: attach.used, reason: attach.reason,
      text: sent, typed, edited: Boolean(attach.edited), truncated,
      ocrMs: attach.ocrMs, cleanupMs: attach.cleanupMs
    };
    dropAttachment();
  }
  if (!message) return null;
  /* The offer belongs to the text in the box. Once that is sent it is spent —
     the chip must not survive to act on a conversation it is no longer about. */
  if (fromComposer) dropTranscript();

  /* Only what someone types into the box can be an ANSWER to the question on
     screen. A retry, an edit, a starter chip or a handoff is re-asking — and
     letting those take the resume path fed the question's own text back as its
     answer, which is how retrying "Add up the numbers" used to end in a
     decline. */
  const pending = fromComposer ? askOpen(c) : null;
  const shownPath = pathOf(c);
  const under = parentId !== undefined
    ? parentId
    : (shownPath[shownPath.length - 1]?.id ?? null);

  /* Show the question immediately, with something moving beneath it. A turn can
     take a second with the planner and longer with the web, and an interface
     that looks frozen for that long reads as broken. Repainting here also clears
     the composer, which is the acknowledgement people actually look for. */
  /* The send is committed: every refusal above this line returns without
     touching the draft. A starter chip passes fromComposer:false, so clicking
     one does not throw away a message you were part-way through writing. */
  if (fromComposer) { setDraft(chatId, ''); state.quote = null; state.handoffNote = null; }
  if (quoteId) pendingQuotes.set(chatId, quoteId);
  /* The resumed turn will REPLACE the one that asked, in place: to the reader
     it is still that exchange, interrupted and then finished. It keeps the id,
     so an open plan panel stays open — and it keeps its children, which a new
     id would orphan. The target is the turn that ASKED, recorded now. */
  followIf(c); startInflight(c, { message, image: record, handedFrom, lane: 'A', parentId: under, pendingAskId: pending ? pending.id : null });
  const token = c.inflight.token;
  persist();
  paint();

  /* While the models restart Patch still answers what the router can answer
     alone. Anything that needs the planner waits for the restart, and says so
     with a countdown rather than answering worse. */
  if (pigeonRestart && !(router && router.route(message).actionable.length)) {
    const stop = tickStatus(chatId, (now, at) => statusLine({ state: 'models-restarting', eta: restartEta(state.settings.lastRestartMs, at, now) }));
    try { await pigeonRestart; } finally { stop(); }
  }
  /* Read at call time, so a second ask after a wake uses the planner it bound. */
  const askPatch = () => runTurn(message, {
    ...packOptions.turnOptions, registry, router, ctx: webCtx(), planner, extractor, assembler, focus, secondLook,
    asksCheck: asks,
    ...(onlySkill ? { onlySkill } : {}),
    prev: lastCompletedIn(c), carry: pending ? null : carryFor(c, quoteId), pending,
    onStage: (name, detail) => showStage(name, detail, chatId)
  });
  /* THE PIPELINE CAN THROW, and if nothing catches it here the question stays
     in flight for ever: `startInflight` has run, `landReply` never does, the
     thread keeps saying "replying…", and every later message in this chat is
     queued behind a reply that is never coming. The model call is the one that
     fails in practice — `llm_complete` returns an Err when the server is
     unreachable, and closing the window KILLS that server on purpose (see
     lib.rs's CloseRequested) — but a throw anywhere in the turn ends the same
     way, so the whole pipeline is inside the try rather than just the call.

     Both other lanes already do this: Lane B catches in runChat, and the
     menu-bar window catches around its own runTurn. This is Lane A catching up.
     What lands is the shape settleInterrupted lands after a relaunch — the
     question kept whole, what went wrong underneath it, and Try again — so
     there is nothing new to render and no new state to reason about. */
  let turn;
  try {
    turn = await askPatch();
    /* A router-only decline that still had candidates is exactly what the planner
       is for, so when the models are downloaded and merely asleep they are woken
       and the question asked again. A decline with nothing to go on is not worth
       a 15-second wait; it offers the wake instead (wakeOffer, below). */
    if (turn.routerOnly && turn.mode === MODES.NO_SKILL && ((turn.routing && turn.routing.forPlanner) || []).length && modelsCanWake()) {
      const stop = tickStatus(chatId, (now, at) => statusLine({ state: 'waking', name: 'the models', eta: wakeEta(state.settings.lastWakeMs, at, now) }));
      const started = Date.now();
      /* In a finally, like the restart wait above it: the ticker owns a one-second
         interval and a line on screen, and a throw that skipped its stop would
         leave both running over a turn that has already given up. */
      let down;
      try { down = await wakeCategory(engine, { isUp: () => Boolean(planner), apply: applyEngineStatus, current: () => engineStatus }); }
      finally { stop(); }
      if (!down && planner) {
        const took = Date.now() - started;
        if (took >= 1000 && took <= 180000) state.settings.lastWakeMs = took;
        turn = await askPatch();
      }
    }
  } catch (e) {
    return landReply(chatId, {
      lane: 'A', message, interrupted: true, error: askFailed(e), reply: null, results: [],
      ...(record ? { image: record } : {}), ...(handedFrom ? { handedFrom } : {})
    }, { token });
  }
  /* Annotated after the fact, as `forced` is: the pipeline saw a message and
     needs to know nothing about where its text came from. */
  if (record) turn.image = record;
  turn.lane = 'A';
  /* A decline with no planner, on a Mac still without the download: the
     download is what would have let Patch follow it, so the reply says so. */
  if (!planner && modelsInfo && modelsInfo.download_bytes > 0 && markFor(turn) === MARKS.COULDNT && !(turn.results || []).length) {
    turn.needsDownload = true;
  }
  if (handedFrom) turn.handedFrom = handedFrom;
  return landReply(chatId, turn, { deliver: true, token });
}

/* What was asked while a chat was busy goes once it is free: first anything
   re-asked (an edit, a retry), then the queue, in order. Nothing queued goes
   while a question of Patch's is open — it waits until that is answered or
   skipped, so it can never be taken as the answer. Re-asks are held in memory
   only; queued messages are saved with the chat. */
const afterReplyTasks = new Map();
/* The quote a message in flight was sent with, laid on its turn when it lands. */
const pendingQuotes = new Map();
/* Chat id → options for the next Lane B send only (Keep going, no amounts). */
const chatOptions = new Map();
/* The same for a picture's reading sent to a Lane B Pigeon: that lane builds
   its own turn, so the record is put on it as it lands. */
const pendingImages = new Map();
function afterReply (chatId, task) {
  const list = afterReplyTasks.get(chatId) || [];
  list.push(task);
  afterReplyTasks.set(chatId, list);
}
function drainQueue (chatId) {
  const c = chatById(state.chats, chatId);
  if (!c || c.inflight) return;
  const tasks = afterReplyTasks.get(chatId);
  if (tasks && tasks.length) {
    const task = tasks.shift();
    if (!tasks.length) afterReplyTasks.delete(chatId);
    task();
    return;
  }
  const m = takeQueued(c);
  if (!m) return;
  persist();
  say(m.text, { chatId, attach: null, fromComposer: false, quoteId: m.quoteId || null });
}

/* A reply that lands in a chat you are not looking at leaves an unread dot and,
   unless that chat's alerts are hidden or banners are off, a banner inside the
   window that opens it. No notification permission is asked for. */
/* One sentence to a screen reader, for something that happened without anybody
   pressing anything. Cleared first: a live region whose text has not changed is
   not announced at all, and asking the same question twice produces exactly
   that — two identical sentences, of which the second would be silent. */
function sayAloud (text) {
  const el = $('said');
  if (!el || !text) return;
  el.textContent = '';
  setTimeout(() => { el.textContent = text; }, 60);
}

function announce (chatId, turn) {
  const c = chatById(state.chats, chatId);
  if (!c) return;
  const looking = chatId === state.activeChatId && state.view === 'chat' && !state.profile && !state.compose;
  const d = pigeonOf(pickForChat(c), personas, patchState);
  /* Looking straight at it. There is nothing to badge and no banner to show —
     but a reply appearing in silence is only "obvious" to somebody who can see
     it arrive. The whole loop here is ask, wait, read; without this the waiting
     has no end a screen reader can hear, and the only way to find out is to
     navigate back into the thread and check. */
  if (looking) {
    const said = replyText(turn);
    sayAloud(said ? `${d.name} replied: ${said}` : `${d.name} replied.`);
    return;
  }
  c.unread = Math.min(999, (c.unread || 0) + 1);
  if (c.muted || state.settings.bannersOff) return;
  showBanner(bannerHtml({ chatId, name: d.name, title: c.title, text: replyText(turn), avatar: avatarHtml(d, 34) }), () => openChat(chatId));
}

/* A banner inside the window: three at most, each gone after a few seconds. */
function showBanner (html, onClick) {
  if (typeof document === 'undefined' || state.settings.bannersOff) return;
  let host = $('banners');
  if (!host) {
    host = document.createElement('div');
    host.id = 'banners';
    host.className = 'banners';
    host.setAttribute('role', 'status');
    host.setAttribute('aria-live', 'polite');
    document.body.appendChild(host);
  }
  const wrap = document.createElement('div');
  wrap.innerHTML = html;
  const el = wrap.firstElementChild;
  el.addEventListener('click', () => { el.remove(); onClick(); });
  host.prepend(el);
  while (host.children.length > 3) host.lastElementChild.remove();
  setTimeout(() => el.remove(), 6000);
}

/* The status under the message being answered, counting down while the models
   wake or a new Pigeon loads. Written straight into the node, like a stage, and
   kept on the chat's record for when you come back to it. */
function tickStatus (chatId, lineAt) {
  const at = Date.now();
  const write = () => {
    const c = chatById(state.chats, chatId);
    const text = lineAt(Date.now(), at);
    if (c && c.inflight) c.inflight.status = text;
    if (chatId !== state.activeChatId) return;
    const el = $('statusLine');
    const wrap = $('statusWrap');
    if (el) el.textContent = text;
    /* The line keeps its height when empty, so it never nudges the thread. */
    if (wrap) wrap.classList.toggle('empty', !text);
  };
  write();
  const timer = setInterval(write, 1000);
  return () => {
    clearInterval(timer);
    const c = chatById(state.chats, chatId);
    if (c && c.inflight) c.inflight.status = '';
    const wrap = chatId === state.activeChatId ? $('statusWrap') : null;
    if (wrap) wrap.classList.add('empty');
  };
}

/* A reply lands in the chat it was asked in. If that chat was deleted while the
   answer was coming there is nowhere honest to put it, and the app says so
   rather than dropping it into whatever is open. Patch flies it back only when
   you are looking at the chat it belongs to. */
/* Stop: the wait ends now, as an interrupted turn with Try again under it. The
   reply that was on its way carries a token this chat no longer holds, and
   `landReply` drops it when it arrives — a Rust call cannot be cut short
   mid-flight, but nothing it brings back has to be shown. */
function stopWaiting (chatId) {
  const c = chatById(state.chats, chatId);
  if (!c || !c.inflight) return;
  const { message, image, handedFrom, lane } = c.inflight;
  landReply(chatId, {
    lane, message, interrupted: true, error: 'You stopped this one.', reply: null, results: [],
    ...(image ? { image } : {}), ...(handedFrom ? { handedFrom } : {})
  });
}

function landReply (chatId, turn, { deliver = false, token = null } = {}) {
  const owner = chatById(state.chats, chatId);
  if (token != null && owner && (!owner.inflight || owner.inflight.token !== token)) {
    /* Stopped, or overtaken: this wait is over and its answer is not shown. */
    return null;
  }
  /* Reading further up the chat this reply belongs to? Then it must not scroll
     you away from what you are reading. */
  const th = chatId === state.activeChatId ? $('thread') : null;
  holdScroll = Boolean(th && th.scrollHeight - th.scrollTop - th.clientHeight > 80);
  try {
    logTurn(turn, { pigeon: owner && laneOf(owner) === 'B' ? (owner.personaId || 'unknown') : 'patch', receipt: receiptLine(turn), reply: answerText(turn) });
  } catch { /* the log never stops a reply landing */ }
  const quoted = pendingQuotes.get(chatId);
  if (quoted) { turn.quoteId = quoted; pendingQuotes.delete(chatId); }
  const pictured = pendingImages.get(chatId);
  if (pictured) { if (!turn.image) turn.image = pictured; pendingImages.delete(chatId); }
  const { filed } = fileReply(state.chats, chatId, turn, { uid });
  /* The first three worked-out answers anyone sees point their mark back at
     "I took this as" — the line that can be wrong. Stamped on the turn, so an
     answer keeps the mark it landed with. */
  if (filed && markFor(turn) === MARKS.WORKED) {
    const tips = state.settings.tips || (state.settings.tips = {});
    const next = ['worked1', 'worked2', 'worked3'].find(k => !tips[k]);
    if (next) { turn.longMark = true; tips[next] = true; }
  }
  landedTurn = filed && chatId === state.activeChatId ? turn.id : null;
  if (filed) announce(chatId, turn);
  persist();
  /* A reply for the chat on screen redraws it; one for another chat only
     updates its row (preview, unread dot), and the reader here is not moved. */
  if (chatId === state.activeChatId || !filed) paint(); else paintList();
  if (!filed) {
    toast('That chat was deleted, so its reply was discarded.');
    return null;
  }
  if (deliver && chatId === state.activeChatId) revealReply(turn.id);
  setTimeout(() => drainQueue(chatId), 0);
  return turn;
}

/* One turn in the chat lane.
 *
 * Deliberately short, and deliberately not a branch inside `say` above: there
 * is no router to run, no plan to validate, no executor, no audit and nothing
 * to resume. A model is asked for words and the words are shown. The only
 * judgement made here is the handoff guard's, and that lives in src/lane-b/. */
/* A chat whose Pigeon has since been removed from this Mac. Its history stays
   readable, but nothing may answer in it — without this, the missing persona
   reads as "no persona" and the base model quietly replies under its name.
   Only asserted when the list is trustworthy: in the app it comes from disk,
   so a missing id really is gone; in a browser tab it is empty whenever the
   server sleeps, which says nothing. */
const pigeonGone = (c) => Boolean(c && c.personaId && !isPeek(c) && !chatPersona(c) && (pigeonInvoke() || chat));

/* The start of every Lane B turn: record it as in flight, show it, and — when
   the server it rides on is asleep, which is the common case, since nobody
   keeps a multi-gigabyte model loaded just in case — wake it first, in place.
   Resolves to null when the lane is up and the caller should go ahead, or to
   the sentence to land as the failure. The stage moves from "waking" to
   "writing" through showStage, not a second startInflight: the question keeps
   the time it was asked, not the time the model finished loading. */
async function beginLaneBTurn (c, { message, handedFrom, parentId, pendingAskId }, writing, wear = null) {
  followIf(c); startInflight(c, { message, image: pendingImages.get(c.id) || null, handedFrom, lane: 'B', parentId, pendingAskId, stage: stageText(chat ? 'writing' : 'waking', writing) });
  persist();
  paint();
  /* A Pigeon added since the models started is not loaded yet. It is messaged
     like any other: this send restarts the models to load it, once every other
     chat's reply has landed, instead of the Pigeon being greyed until someone
     finds a button. Asleep needs nothing — the wake below loads everything. */
  const who = (writing && writing.persona) || 'Pen';
  if (wear && wear.loaded === false && restartForPigeonChange(`Getting ${wear.name} ready — the models are restarting`, { except: c.id })) {
    showStage('waking', writing, c.id);
    const stop = tickStatus(c.id, (now, at) => statusLine({ state: 'restarting', name: wear.name, eta: restartEta(state.settings.lastRestartMs, at, now) }));
    await pigeonRestart;
    stop();
  }
  /* A picture Pigeon runs on the picture server, which `pigeon_run` starts
     itself — the other two need not be woken for it. */
  if (chat || (wear && wear.vision)) { if (!chat) showStage('writing', writing, c.id); return null; }
  const started = Date.now();
  const stop = tickStatus(c.id, (now, at) => statusLine({ state: 'waking', name: who, eta: wakeEta(state.settings.lastWakeMs, at, now) }));
  const down = await wakeCategory(engine, { isUp: () => Boolean(chat), apply: applyEngineStatus, current: () => engineStatus });
  stop();
  if (down) return down;
  /* How long this Mac took, so the next countdown can say "about". */
  const took = Date.now() - started;
  if (took >= 1000 && took <= 180000) { state.settings.lastWakeMs = took; persist(); }
  showStage('writing', writing, c.id);
  return null;
}

async function sayInLaneB (message, under, chatId = state.activeChatId, handedFrom = null, pendingAskId = null) {
  const c = chatById(state.chats, chatId);
  if (!c) return null;
  if (pigeonGone(c)) {
    toast(pigeonOf(pickForChat(c), personas, patchState).line, 4200);
    return null;
  }
  if (isPeek(c)) return sayToPeek(message, under, chatId, handedFrom, pendingAskId);
  const persona = chatPersona(c);
  /* A job is not a conversation: no history, no chat system prompt, its own
     prompt and its own budget. It goes through `pigeon_run`, which is where
     all of that is known. */
  if (persona && !isVoice(persona)) return runPigeonJob(message, under, persona, chatId, handedFrom, pendingAskId);

  const down = await beginLaneBTurn(c, { message, handedFrom, parentId: under, pendingAskId }, { persona: persona && persona.name }, persona);
  if (down) {
    return landReply(chatId, { lane: 'B', message, mode: 'generated', persona: persona ? persona.id : null, reply: null, error: down, ms: 0, ...(handedFrom ? { handedFrom } : {}) });
  }

  /* A one-off for this send, set by Keep going or Ask Pen without amounts. */
  const once = chatOptions.get(chatId) || {};
  chatOptions.delete(chatId);
  const turn = await runChat(message, {
    /* The history of THIS chat, read as it was when you asked. */
    history: pathOf(c),
    persona,
    complete: chat,
    onStage: (name) => showStage(name, { persona: persona && persona.name }, chatId),
    onText: (text) => showText(chatId, text),
    ...(once.noAmounts ? { noAmounts: true } : {}),
    ...(once.continuing ? { continuing: once.continuing } : {})
  });

  /* No delivery flourish: Patch is the model, and in this lane the model is
     the one thing that did NOT check anything. A forwarded question keeps
     saying where it came from. */
  if (handedFrom) turn.handedFrom = handedFrom;
  return landReply(chatId, turn);
}

/* One turn with Peek: the picture model as it comes — the chat's words, no
   instruction of ours and no guard on figures (runPlain) — with the picture
   from this message, if it had one, put in front of it. The picture server
   starts itself (`wake_peek`), so the other two are not woken for it. */
async function sayToPeek (message, under, chatId, handedFrom = null, pendingAskId = null) {
  const c = chatById(state.chats, chatId);
  if (!c) return null;
  const peek = pigeonOf('peek');
  const picture = pendingPictures.get(chatId) || null;
  pendingPictures.delete(chatId);
  const base = { lane: 'B', message, mode: 'generated', persona: null, ...(handedFrom ? { handedFrom } : {}) };
  if (!peek.loaded) return landReply(chatId, { ...base, reply: null, error: peek.line, ms: 0 });
  await beginLaneBTurn(c, { message, handedFrom, parentId: under, pendingAskId }, { persona: 'Peek' }, { name: 'Peek', vision: true, loaded: true });
  const bridge = chatBridge();
  const complete = bridge && bridge.transport === 'rust command'
    ? (args) => bridge({ ...args, peek: true, image: picture })
    : null;
  /* Nothing typed with the picture: the question the picture Pigeons are
     asked when they are handed one alone is theirs; Peek's is plain. */
  const asked = String(message || '').trim() || (picture ? 'What is in this picture?' : '');
  if (picture && complete) showStage('looking', { persona: 'Peek' }, chatId);
  let firstWord = true;
  const turn = await runPlain(asked, {
    history: pathOf(c),
    complete,
    /* runPlain says "writing" as it starts; with a picture that is still the
       encoder's time, so the looking stage stands until the first word. */
    onStage: (name) => { if (!(picture && name === 'writing')) showStage(name, { persona: 'Peek' }, chatId); },
    onText: (text) => {
      if (firstWord) { firstWord = false; showStage('writing', { persona: 'Peek' }, chatId); }
      showText(chatId, text);
    }
  });
  if (!complete && !turn.reply) turn.error = 'Peek needs the app — this is the browser build';
  if (asked !== message) { turn.message = message; turn.asked = asked; }
  if (handedFrom) turn.handedFrom = handedFrom;
  return landReply(chatId, turn);
}

/* "Wake models", pressed on a Lane B turn that already came back with
   nothing. Just asks the same question again — sayInLaneB's own wake-first
   check does the rest — but in the failed turn's own place, via the same
   pendingAskId swap `say()` uses to land a resumed answer, so what you see at
   the end is the reply, not the error it replaced. */
async function wakeAndRetry (id) {
  const chatId = state.activeChatId;
  const c = activeChat();
  const turn = chatNodes(c)[id];
  if (!turn) return;
  if (pictureGone(turn.image)) { toast('Attach the picture again — a picture is not kept once Pigeon closes.', 4200); return; }
  const again = () => {
    if (turn.image) {
      pendingImages.set(chatId, turn.image);
      if (turn.image.picture) pendingPictures.set(chatId, sentPictures.get(turn.image));
    }
    return sayInLaneB(turn.message, turn.parentId ?? null, chatId, turn.handedFrom ?? null, id);
  };
  if (c.inflight) {
    afterReply(chatId, again);
    toast('Trying again as soon as this reply lands.');
    return;
  }
  return again();
}

/* One run of a trained Pigeon: one input in, one output back.
 *
 * Everything that makes it come out in the shape it was trained for lives in
 * Rust — the prompt it was trained with and the budget its own test measured
 * are read from the file it was imported from, not chosen here. The page
 * supplies the text and nothing else, which is the same rule `task_complete`
 * keeps and the reason neither can become a way to ask for arbitrary prose.
 *
 * The reply still gets Lane B's badge. A job's output is generated, not
 * computed, and the fact that it is narrow does not make it checked. */
async function runPigeonJob (message, under, pigeon, chatId = state.activeChatId, handedFrom = null, pendingAskId = null) {
  const c = chatById(state.chats, chatId);
  if (!c) return null;

  /* A job rides the same category server a chat persona does, so it gets the
     same wake-first start rather than failing outright against a server that
     just hasn't been asked yet. */
  const base = { lane: 'B', message, mode: 'generated', persona: pigeon.id, ...(handedFrom ? { handedFrom } : {}) };
  const picture = pendingPictures.get(chatId) || null;
  pendingPictures.delete(chatId);
  /* A grounded Pigeon searches its material before any model is needed, so a
     question it has nothing on is answered — with what it does cover — while
     the models sleep, instead of waking them to say no. */
  const covers = await noMaterialWithoutWaking(pigeon, message);
  if (covers) return landNoMaterial(c, { message, handedFrom, under, pendingAskId }, base, covers);
  const down = await beginLaneBTurn(c, { message, handedFrom, parentId: under, pendingAskId }, { persona: pigeon.name }, pigeon);
  if (down) return landReply(chatId, { ...base, reply: null, error: down, ms: 0 });

  const started = Date.now();
  const call = pigeonInvoke();
  let turn;
  if (!call) {
    turn = { ...base, reply: null, error: 'running a trained Pigeon needs the app — this is the browser build', ms: 0 };
  } else {
    try {
      const out = await call('pigeon_run', { req: { pigeon: pigeon.id, text: message, ...(picture ? { image: picture } : {}) } });
      const text = String((out && out.text) || '').trim();
      const fields = jobFields(out || {});
      /* "Not in here" is an answer, not a failure: the search found no
         section, so the model was never asked (format §8.6). */
      turn = text || fields.noMaterial
        ? {
            ...base,
            reply: { source: 'generated', text },
            ms: out.ms,
            tokens: out.tokens,
            promptTokens: out.prompt_tokens,
            finishReason: out.finish_reason,
            /* A classifier outside its own labels, a citation of a section it
               was never shown, and a recipe that could not be drawn all say
               so. A label nobody can trust is worse than an obvious refusal. */
            ...fields
          }
        : { ...base, reply: null, error: `${pigeon.name} returned nothing`, ms: out.ms };
    } catch (e) {
      turn = { ...base, reply: null, error: String((e && e.message) || e), ms: Date.now() - started };
    }
  }

  return landReply(chatId, turn);
}

/* Sleep, then wake: the only way a persona added since launch gets loaded.
   Waking is not instant, so this says so and lets the engine's own status
   events land the list — a sheet that sat there claiming to wait would be
   guessing at a time only the engine knows. */
async function restartModels () {
  if (!engine) return;
  toast('Restarting the models — your Pigeons load as they come back up', 4200);
  try {
    await engine.sleep();
    await applyEngineStatus(await engine.wake());
    await refreshPersonas();
  } catch (e) {
    toast(friendly(e), 4600);
  }
}

/* After an import. The model server takes its adapters when it starts, so a
   new Pigeon is loaded by restarting the models — done here, never asked of
   the person. A reply being written would be cut off by a restart, so this
   waits until every chat's reply has landed — except the chat whose send asked
   for the restart, which is waiting on it. Models that are asleep need
   nothing: the next wake loads everything installed. One restart at a time;
   imports that arrive while one is pending ride on it. */
let pigeonRestart = null;
function restartForPigeonChange (message = 'Loading the new Pigeon — the models are restarting', { except = null } = {}) {
  if (!engine || engineStatus?.category?.phase !== 'ready') return false;
  if (pigeonRestart) return true;
  pigeonRestart = (async () => {
    while (state.chats.some(c => c.inflight && c.id !== except)) await new Promise(r => setTimeout(r, 1000));
    toast(message, 4200);
    try {
      /* Timed, so the next "Getting X ready · about N s" counts down from how
         long this Mac really takes. */
      const t0 = Date.now();
      await applyEngineStatus(await engine.sleep());
      const down = await wakeCategory(engine, { isUp: () => engineStatus?.category?.phase === 'ready', apply: applyEngineStatus, current: () => engineStatus });
      if (down) toast(down, 4600);
      else {
        const took = Date.now() - t0;
        if (took >= 1000 && took <= 300000) { state.settings.lastRestartMs = took; persist(); }
      }
      await refreshPersonas();
    } catch (e) {
      toast(friendly(e), 4600);
    }
  })().finally(() => { pigeonRestart = null; });
  return true;
}

/* ── importing a .pigeon (or .nest) file ─────────────────────────────────
 * The page says "import" and nothing else — `pigeon_inspect_pick` is Rust
 * opening a native picker and checking what was picked, exactly the shape
 * every other command in this app takes (see the invariant note in
 * src-tauri/src/lib.rs); `pigeon_add` installs what the person said yes to.
 * The same Meet sheet opens whether the files came from that button, a Finder
 * double-click queued before boot (`pigeon_take_opens`), or one opened while
 * the window was already up (`pigeon-meet`). */

function pigeonInvoke () {
  return globalThis.__TAURI__?.core?.invoke ?? null;
}

/* An installed Pigeon is not a usable one until the server that would wear it
   is restarted, so the word "Added" never appears on its own — saying only
   that is what makes a working import look like a broken one. */
function describePigeonOutcome (o, { loadingNow = false } = {}) {
  if (o.status === 'added') {
    const next = loadingNow ? 'loading it now' : 'it loads the next time the models start';
    const n = Array.isArray(o.notes) ? o.notes.length : 0;
    return `Added "${o.name}" — ${next}${n ? `. ${n === 1 ? '1 note' : `${n} notes`} — see its page` : ''}`;
  }
  if (o.status === 'already') return `Already have "${o.name}"`;
  /* The same Pigeon with or without its picture reader (format D74). */
  if (o.status === 'kept') {
    return o.keeps === 'this'
      ? `Kept the smaller copy of "${o.name}" — this Mac already has its picture reader`
      : `Added the picture reader "${o.name}" needs — your smaller copy stays`;
  }
  /* Rust chooses Patch's pack when the app starts, so an upgrade is used from
     the next launch — said plainly, because nothing restarts him sooner. */
  if (o.status === 'upgraded') {
    if (pigeonInvoke()) {
      setTimeout(() => showBanner(bannerHtml({ chatId: 'patch', name: `Patch v${o.to} is ready`, title: 'Restart Pigeon to use it', text: 'Restart now', avatar: avatarHtml(pigeonOf('patch', personas, patchState), 34) }), () => pigeonInvoke()('app_restart').catch(() => {})), 0);
    }
    return `Patch v${o.to} is ready${o.from != null ? ` (you have v${o.from})` : ''} — restart Pigeon to use it`;
  }
  return `${o.file}: ${o.reason}`;
}

/* One toast for the whole batch — a nest can fan out into several outcomes,
   and the toast element holds one message at a time. Returns whether anything
   was actually added, so a caller can re-render what it was showing. */
async function reportPigeonOutcomes (outcomes) {
  if (!outcomes || !outcomes.length) return false;
  const added = outcomes.some(o => o.status === 'added');
  const loadingNow = added && Boolean(engine) && engineStatus?.category?.phase === 'ready';
  const lines = outcomes.map(o => describePigeonOutcome(o, { loadingNow }));
  if (lines.length >= 4) {
    /* A whole nest: one toast would scroll past. A list, read at leisure. */
    openSheet(`<div class="sheet-card"><div class="sheet-title">${outcomes.filter(o => o.status === 'added').length} of ${outcomes.length} added</div>
      <ul class="sheet-list">${lines.map(l => `<li>${esc(l)}</li>`).join('')}</ul>
      <div class="sheet-row"><button class="sheet-btn primary" data-close>OK</button></div></div>`);
  } else {
    toast(lines.join(' · '), outcomes.some(o => o.status === 'refused') ? 5200 : 4200);
  }
  if (!added && outcomes.some(o => o.status === 'kept')) await refreshPersonas();
  if (added) {
    await refreshPersonas();
    if (loadingNow) restartForPigeonChange();
    for (const o of outcomes.filter(o => o.status === 'added' && o.replaced)) checkRide(o);
  }
  return added;
}

/* A Pigeon that replaced one already here is asked its own examples before
   the old one is let go. A miss puts the old one back (Rust does the swap) and
   asks — the old one stays the one you talk to unless you choose otherwise. */
async function checkRide (o) {
  const call = pigeonInvoke();
  if (!call) return;
  if (!o.vision) {
    if (pigeonRestart) await pigeonRestart;
    if (engineStatus?.category?.phase !== 'ready') {
      /* Remembered, and ridden the next time the models are up. */
      const waiting = (state.settings.uncheckedRides || []).filter(x => x.id !== o.id);
      state.settings.uncheckedRides = [...waiting, { id: o.id, name: o.name, vision: Boolean(o.vision) }];
      persist();
      toast(`The new ${o.name} is in but not checked yet — the models are asleep. It is checked when they next wake; the old one is kept aside.`, 5200);
      return;
    }
  }
  if (state.settings.uncheckedRides?.some(x => x.id === o.id)) {
    state.settings.uncheckedRides = state.settings.uncheckedRides.filter(x => x.id !== o.id);
    persist();
  }
  toast(`Checking the new ${o.name} against its own examples…`, 3000);
  let r;
  try { r = await call('pigeon_check_ride', { pigeon: o.id }); } catch (e) { toast(friendly(e), 4600); return; }
  if (!r.total) return;
  if (r.unchecked) {
    const why = (r.results.find(x => x.error) || {}).error || 'an example could not be asked';
    toast(`Couldn’t check the new ${o.name}: ${why}. It is in; the old one is kept aside.`, 5600);
    return;
  }
  if (!r.reverted) { toast(`The new ${o.name} got all ${r.total} of its examples right, so it replaces the old one (which is in the Trash).`, 5200); return; }
  await refreshPersonas();
  if (!o.vision) restartForPigeonChange(`Putting the old ${o.name} back — the models are restarting`);
  const misses = r.results.filter(x => !x.ok).slice(0, 5);
  openSheet(`
    <div class="sheet-card" role="dialog" aria-modal="true" aria-labelledby="rideTitle">
      <div class="sheet-title" id="rideTitle">The new ${esc(o.name)} got ${r.passed} of ${r.total} right</div>
      <div class="sheet-body">It was asked the examples its own file carries, on this Mac, and missed ${r.total - r.passed}. So the old ${esc(o.name)} is back and is still the one you talk to. The new one is kept aside in case you want it anyway.
        <ul class="ride-misses">${misses.map(x => `<li>${x.picture ? 'a picture' : 'an example'}: wanted <b>${esc(x.expected)}</b>, got <b>${esc(x.got ?? '')}</b></li>`).join('')}</ul></div>
      <div class="sheet-row">
        <button class="sheet-btn" data-close>Keep the old one</button>
        <button class="sheet-btn" id="rideNew">Use the new one</button>
      </div>
    </div>`, (host, close) => {
    host.querySelector('#rideNew').onclick = async () => {
      close();
      try { await call('pigeon_use_new_revision', { pigeon: o.id }); } catch (e) { toast(friendly(e), 4600); return; }
      await refreshPersonas();
      if (!o.vision) restartForPigeonChange(`Loading the new ${o.name} — the models are restarting`);
      toast(`The new ${o.name} is in. The old one is in the Trash.`, 4200);
    };
    host.querySelector('[data-close]').focus();
  });
}

/* Every installed Pigeon, whether or not the models are awake. In the app
   `personas_list` reads the adapters folder and marks which ones the running
   server has loaded, so an imported Pigeon is listed at once (greyed until it
   loads). Only SENDING needs the server. The browser build can only ask a
   running server. */
async function refreshPersonas () {
  const call = pigeonInvoke();
  try {
    if (call) personas = await call('personas_list');
    else if (chat) personas = await chat.personas();
    else return;
  } catch { return; /* leave what was there */ }
  paint();
}

async function importPigeon () {
  const call = pigeonInvoke();
  if (!call) {
    toast('Importing a Pigeon needs the app — this is the browser build');
    return false;
  }
  try {
    /* Picked files are described first; nothing is installed until Add. */
    return openMeet(await call('pigeon_inspect_pick'));
  } catch (e) {
    toast(friendly(e), 4600);
    return false;
  }
}

/* The Meet sheet: what a file is, before it is on this Mac. Add installs only
   the ids Rust handed out for the files checked; afterwards the new Pigeon
   joins with a banner and its page opens. */
/* Pigeons that were waiting on the models: added the moment the download lands. */
let pendingAdds = [];

function openMeet (records) {
  if (!Array.isArray(records) || !records.length) return false;
  const canDownload = Boolean(engine && modelsInfo && modelsInfo.download_bytes > 0 && !downloading);
  const canFetch = Boolean(engine && !downloading);
  openSheet(meetHtml(records, { canDownload, canFetch }), (host, close) => {
    host.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-meet]');
      if (!b) return;
      const what = b.dataset.meet;
      if (what === 'cancel') { close(); return; }
      if (what === 'copy') { copyText(b.dataset.text || ''); return; }
      if (what === 'download') {
        /* Held here until the download lands, then added — the ids Rust
           handed out for the files it checked, which it keeps for two hours
           (HOLD_THROUGH_DOWNLOAD). */
        pendingAdds = records.filter(r => r.status === 'needs-base' && r.id).map(r => r.id);
        close();
        beginDownload();
        toast(pendingAdds.length ? 'It will be added as soon as the download finishes.' : 'Add the Pigeon again once the download has finished.', 4200);
        return;
      }
      if (what === 'download-projector') {
        /* The licence and size were on the row, above this button. Held
           like a missing base: added the moment the download lands. */
        pendingAdds = records.filter(r => r.status === 'needs-projector' && r.projector && r.projector.sha256 === b.dataset.sha && r.id).map(r => r.id);
        close();
        beginProjectorDownload(b.dataset.sha, Number(b.dataset.bytes) || 0, b.dataset.host || '');
        toast('It will be added as soon as its picture reader has downloaded.', 4200);
        return;
      }
      if (what !== 'add') return;
      const ready = addable(records);
      const boxes = [...host.querySelectorAll('[data-meet-pick]')];
      const ids = boxes.length ? boxes.filter(x => x.checked).map(x => x.dataset.meetPick) : ready.map(r => r.id);
      if (!ids.length) { close(); return; }
      /* Copying an adapter is seconds of nothing for a large one, and a
         greyed button with its old label on it reads as a dialog that has
         broken rather than one that is working. */
      const label = b.textContent;
      b.disabled = true;
      b.textContent = 'Adding…';
      try {
        const outcomes = await pigeonInvoke()('pigeon_add', { ids });
        close();
        const added = await reportPigeonOutcomes(outcomes);
        const joined = ready.find(r => r.status === 'ready' && ids.includes(r.id) && outcomes.some(o => o.status === 'added' && o.name === r.name));
        if (added && joined) {
          showBanner(bannerHtml({ chatId: '', name: `${joined.name} joined`, text: joined.card && joined.card.does ? joined.card.does : 'Added to this Mac' }), () => openProfile(`pigeon:${joined.pigeon_id}`));
          openProfile(`pigeon:${joined.pigeon_id}`);
        }
      } catch (err) {
        b.disabled = false;
        b.textContent = label;
        toast(friendly(err), 4600);
      }
    });
  });
  return true;
}

/* Uninstalling a Pigeon: the reverse of importing one. Chats you had with it
   are left alone — pigeonOf already shows a persona no longer on this Mac as
   "missing" rather than erroring, so old history stays readable and its own
   profile page says plainly that it is gone. Nothing here has to navigate you
   away from wherever you asked this from. Patch and the base model are never
   offered this — see the caller, which only wires the button up for an
   imported voice or job. */
/* Removing a model from the store. Pigeon asks when another app relies on
   it — Flight School trains and drafts from these — and says which. What goes,
   goes to the Trash. */
async function removeModel (path, confirmed) {
  const call = pigeonInvoke();
  if (!call) return;
  const name = path.split('/').pop().replace(/^models--/, '').replace('--', '/');
  let out;
  try { out = await call('models_remove', { path, confirmed }); } catch (e) { toast(friendly(e), 4600); return; }
  if (out.status === 'removed') { toast(`${name} is in the Trash (${fmtSize(out.bytes)}).`, 4200); openSettings('models'); return; }
  const who = out.borrowers.join(' and ');
  openSheet(`
    <div class="sheet-card" role="dialog" aria-modal="true" aria-labelledby="rmModelTitle">
      <div class="sheet-title" id="rmModelTitle">${esc(who)} uses ${esc(name)}</div>
      <div class="sheet-body">${esc(who)} trains, drafts or checks with this model, and would have to download it again. Pigeon keeps every model on this Mac, so removing it here removes it for ${esc(who)} too. It goes to the Trash.</div>
      <div class="sheet-row">
        <button class="sheet-btn" data-close>Keep it</button>
        <button class="sheet-btn danger" id="rmModelYes">Remove anyway</button>
      </div>
    </div>`, (host, close) => {
    host.querySelector('#rmModelYes').onclick = async () => { close(); await removeModel(path, true); };
    host.querySelector('[data-close]').focus();
  });
}

function askRemovePigeon (pick) {
  const d = pigeonOf(pick, personas, patchState);
  const withIt = state.chats.filter(c => !isEmpty(c) && pickForChat(c) === pick).length;
  openSheet(`
    <div class="sheet-card">
      <div class="sheet-title">Remove ${esc(d.name)}?</div>
      <div class="sheet-body">This takes ${esc(d.name)} off this Mac, along with everything it came with. There is no undo.
        ${withIt ? ` ${withIt === 1 ? 'The chat' : `The ${withIt} chats`} you have with ${esc(d.name)} ${withIt === 1 ? 'stays' : 'stay'}, but won't get any more answers.` : ''}</div>
      <div class="sheet-row">
        <button class="sheet-btn" data-close>Keep it</button>
        <button class="sheet-btn danger" id="rmYes">Remove</button>
      </div>
    </div>`, (host, close) => {
    host.querySelector('#rmYes').onclick = async () => { close(); await removePigeon(pick); };
    host.querySelector('[data-close]').focus();
  });
}

async function removePigeon (pick) {
  const id = String(pick).replace(/^pigeon:/, '');
  const name = pigeonOf(pick, personas, patchState).name;
  const call = pigeonInvoke();
  if (!call) {
    toast('Removing a Pigeon needs the app — this is the browser build');
    return;
  }
  const wasLoaded = Boolean(personas.find(p => p.id === id)?.loaded);
  try {
    await call('pigeon_remove', { id });
  } catch (e) {
    toast(friendly(e), 4600);
    return;
  }
  toast(`Removed "${name}".`, 4200);
  await refreshPersonas();
  if (wasLoaded) restartForPigeonChange('Removing the Pigeon — the models are restarting');
}

/* Files opened before this window existed (a cold-launch double-click) are
   queued in Rust; drain it once at boot. A warm-launch open arrives as an
   event instead — see the listener registered alongside `detectModel()`. */
async function takeQueuedPigeonOpens () {
  const call = pigeonInvoke();
  if (!call) return;
  try { openMeet(await call('pigeon_take_opens')); } catch { /* nothing queued, or not in the app */ }
}

/* The first ⌘W: Rust keeps the window up and asks the page to say where
   Pigeon goes. Every close after that just goes. */
function listenForCloseTip () {
  const listen = globalThis.__TAURI__?.event?.listen;
  const invoke = globalThis.__TAURI__?.core?.invoke;
  if (typeof listen !== 'function' || typeof invoke !== 'function') return;
  listen('close-tip', () => {
    let hid = false;
    const hide = () => { if (hid) return; hid = true; invoke('main_hide').catch(() => {}); };
    openSheet(`
      <div class="sheet-card">
        <div class="sheet-title">Pigeon stays in the menu bar</div>
        <div class="sheet-body">Closing the window doesn’t quit. Pigeon keeps going up in the menu bar — click the bird there to come back, or open Pigeon again from the Dock or Launchpad. To quit for real, press <kbd>⌘Q</kbd>.</div>
        <div class="sheet-row">
          <button class="sheet-btn" data-close>Stay open</button>
          <button class="sheet-btn primary" id="closeTipOk">Got it</button>
        </div>
      </div>`, (host, close) => {
      host.querySelector('#closeTipOk').onclick = () => { close(); hide(); };
      host.querySelector('#closeTipOk').focus();
    });
  }).catch(() => {});
}

function listenForPigeonOpens () {
  const listen = globalThis.__TAURI__?.event?.listen;
  if (typeof listen !== 'function') return;
  /* A file double-clicked while the window is up: described, not installed. */
  listen('pigeon-meet', (e) => { openMeet(e.payload); });
  /* A Pigeon's details changed without anything done here: at launch, a base
     it names was hashed and its notes were rebuilt. */
  listen('pigeons-changed', () => { refreshPersonas().then(() => paint()).catch(() => {}); });
  /* The menus at the top of the screen (src-tauri/src/appmenu.rs). */
  listen('app-menu', (e) => { menuAction(e.payload); });
  /* The menu bar hands each finished exchange here to be filed. Once, at boot:
     inside anything that runs twice it would file every exchange twice. */
  listen('menubar-exchange', (e) => { fileMenuBarExchange(e.payload); });
  /* The engine getting ready the first time on this Mac: llama.cpp compiles its shaders, about 20 seconds, with
     no progress to show. Said only when it is slow, so never on later starts. */
  listen('engine-preparing', (e) => {
    if (e.payload?.on) toast('Getting the model ready for this Mac. This happens once.', 120000);
    else if ($('toast')?.textContent?.startsWith('Getting the model ready')) toast('Ready.', 1200);
  });
  /* The menu bar's "Add a Pigeon…" and "Open" are this window's to carry out. */
  listen('menubar-open', (e) => { openFromMenuBar(e.payload); });
  const call = pigeonInvoke();
  if (call) call('set_dev_menu', { on: state.settings.devMenu === true }).catch(() => {});
}

/* One menu item. The menu names an action, never a screen or a window. */
function menuAction (id) {
  if (id === 'new-message') startCompose();
  else if (id === 'add-pigeon') importPigeon();
  else if (id === 'settings') openSettings();
  else if (id === 'shortcuts') openShortcuts();
  else if (id === 'skills' || id === 'plan' || id === 'ledger') openView(id);
  else return;
  if (id === 'new-message') { paint(); focusComposer(); }
}

/* Help › Keyboard Shortcuts (⌘/): every key the window and the summon bar take. */
function openShortcuts () {
  const rows = [
    ['⌘N', 'New chat with Patch'], ['⌘⇧N', 'New chat — choose who it’s for'], ['↩', 'Send · ⇧↩ for a new line'],
    ['⌘F', 'Search chats and Pigeons'], ['⌘I', 'How the last reply was made'], ['⌘⇧] · ⌘⇧[', 'Next · previous chat'],
    ['⌘,', 'Settings'], ['⌘W', 'Close the window — Pigeon stays in the menu bar'], ['⌘⇧P', 'Ask Patch from any app (the summon bar)'],
    ['⌘↩', 'In the summon bar or menu bar: open the question in this window'], ['Esc', 'Close what is open']
  ];
  openSheet(`<div class="sheet-card"><div class="st-head"><div class="sheet-title">Keyboard shortcuts</div><button class="icon-btn" data-close aria-label="Close">${ICONS.x}</button></div>
    <dl class="facts keys-list">${rows.map(([k, w]) => `<div class="fact"><dt><kbd>${esc(k)}</kbd></dt><dd>${esc(w)}</dd></div>`).join('')}</dl></div>`);
}

/* The menu bar never writes the file — this window is its only writer. The
   popover says what was asked and what came back, and it is filed here, into
   that Pigeon's Menu bar chat, even while this window is hidden. With "Save
   menu bar exchanges" off in Settings, nothing from it is kept. */
function fileMenuBarExchange (x) {
  /* A picture sent to Peek with nothing typed is an exchange too. */
  const pictureOnly = Boolean(x && x.image && x.image.picture === true);
  if (!x || typeof x.message !== 'string' || (!x.message.trim() && !pictureOnly) || !x.turn || typeof x.turn !== 'object') return;
  if (!state.settings.saveMenuBar) return;
  const pick = typeof x.pick === 'string' ? x.pick : 'patch';
  const { lane, personaId } = chatFieldsFor(pick);
  let c = state.chats.find(k => k.source === 'menubar' && pickForChat(k) === pickForChat({ lane, personaId }));
  if (!c) {
    c = blankChat(lane, personaId);
    Object.assign(c, { source: 'menubar', title: 'Menu bar', renamed: true });
    state.chats.unshift(c);
  }
  const path = pathOf(c);
  c.inflight = { message: x.message, lane, parentId: path.length ? path[path.length - 1].id : null, sentAt: Number(x.at) || Date.now() };
  const turn = { ...x.turn, id: null, message: x.message, lane, ...(x.image ? { image: x.image } : {}) };
  fileReply(state.chats, c.id, turn, { uid });
  announce(c.id, turn);
  persist();
  paint();
}

/* What the menu bar asks this window to do: add a Pigeon (the import dialog is
   this window's), or open the Menu bar chat an exchange was filed into. Rust
   has already brought the window forward. With saving off there is no chat,
   so Open lands on a new message to that Pigeon instead. */
function openFromMenuBar (x) {
  if (!x || typeof x !== 'object') return;
  if (x.action === 'add-pigeon') { importPigeon(); return; }
  /* Play from the menu bar or the summon bar, when it could not start by
     itself (a permission, or no game played yet): the Play sheet, here. */
  if (x.action === 'play' && typeof x.pick === 'string') { openPlaySheet(x.pick.replace(/^pigeon:/, '')); return; }
  if (x.action !== 'open') return;
  const pick = typeof x.pick === 'string' ? x.pick : 'patch';
  /* The summon bar's ⌘↩ with words still in its box: they arrive as a draft,
     unsent, the way every hand-over does — the person presses Send (§5.5). */
  if (typeof x.draft === 'string' && x.draft.trim()) {
    openWithDraft(pick, x.draft.trim().slice(0, 4000), 'From the summon bar · not sent yet');
    return;
  }
  const { lane, personaId } = chatFieldsFor(pick);
  const c = state.chats.find(k => k.source === 'menubar' && pickForChat(k) === pickForChat({ lane, personaId }));
  if (c) { openChat(c.id); return; }
  startCompose(pick);
  paint();
  focusComposer();
}

/* Ask someone else: a new chat with them, YOUR words already in its box, and
   nothing sent. What travels is always the person's own message — never a
   reply — so nothing a model wrote can reach Patch looking like something you
   typed, and the person still reads it, rewords it if they like, and presses
   Send. The app never asks on its own (§5.5). */
function askSomeoneElse (turnId, pick) {
  const source = activeChat();
  const turn = chatNodes(source)[turnId];
  if (!turn) return;
  const d = pigeonOf(pick, personas, patchState);
  if (!canMessage(d)) { toast(d.kind === 'verified' ? patchNotReady() : d.line, 4200); return; }
  const from = pigeonOf(pickForChat(source), personas, patchState).name;
  openWithDraft(pick, turn.message || '', `From your chat with ${from} · your words, not the reply`);
}

/* Pen, with a few words Pigeon wrote around the person's own — "Give me a
   shorter title for: buying milk for Sam" — visibly editable, and nothing sent. */
function askPenWith (frame) {
  openWithDraft('chat', frame, 'Pigeon wrote the first few words; the rest is yours.');
}

function openWithDraft (pick, text, note) {
  startCompose(pick);
  const id = state.activeChatId;
  setDraft(id, text);
  state.handoffNote = { chatId: id, text: note };
  paint();
  focusComposer();
}

/* A message's menu, from its ⋯ or a right-click. */
function openMessageMenu (at, turnId, which) {
  const c = activeChat();
  const turn = chatNodes(c)[turnId];
  if (!turn) return;
  const d = pigeonOf(pickForChat(c), personas, patchState);
  const items = messageMenuItems(turn, which, { canChat: Boolean(chat), busy: Boolean(c.inflight), job: d.kind === 'job' });
  openMenu(at, items, (what) => {
    if (what === 'copy-q') copyText(turn.message || '');
    else if (what === 'copy-a') copyText(answerText(turn) || (turn.lane === 'B' ? turn.error || '' : answerOf(turn)));
    else if (what === 'copy-where') copyText(copyWithSource(turn, d.name) || answerOf(turn));
    else if (what === 'edit') startEdit(turnId);
    else if (what === 'react') { state.tapback = `${turnId}|${which}`; paint(); }
    else if (what === 'retry') retryTurn(turnId);
    else if (what === 'reply') {
      state.quote = { chatId: c.id, turnId };
      paint();
      focusComposer();
    } else if (what === 'info') {
      state.info = turnId;
      state.details = false;
      paint();
    } else if (what === 'forward') {
      const choices = forwardMenuItems(pigeonList(personas, { patchState }).flat, pickForChat(c));
      if (!choices.length) { toast('There is nobody else here to forward it to.'); return; }
      openMenu(at, choices, (id) => askSomeoneElse(turnId, id.replace(/^fwd:/, '')));
    } else if (what.startsWith('fwd:')) askSomeoneElse(turnId, what.slice(4));
  });
}

/* The models are downloaded, asleep, and allowed to wake: the only state in
   which "try with the models" is an offer that can be kept. */
function modelsCanWake () {
  return Boolean(engine && modelsInfo && !(modelsInfo.download_bytes > 0) && !planner && !pigeonRestart && !(engineStatus && engineStatus.disabled));
}

/* The answer to a look-up's card. Send once writes the query down in What left
   this Mac and re-runs the plan with that one look-up allowed; Don't send closes
   the turn. Either way the card's turn is replaced in place. */
async function answerConsent (c, t, answer) {
  const chatId = c.id;
  if (c.inflight) { afterReply(chatId, () => answerConsent(chatById(state.chats, chatId), t, answer)); return; }
  if (answer.send && !search) { toast('No web search is connected in this build.', 4200); return; }
  if (answer.send) {
    lastWebSend = { at: Date.now(), text: answer.query };
    const log = Array.isArray(state.settings.webLog) ? state.settings.webLog : [];
    state.settings.webLog = [...log, { at: lastWebSend.at, text: `“${answer.query}” → DuckDuckGo and Wikipedia`, hosts: [...((t.consent && t.consent.hosts) || ['api.duckduckgo.com', 'en.wikipedia.org'])] }].slice(-500);
  }
  followIf(c); startInflight(c, { message: t.message, lane: 'A', parentId: t.parentId ?? null, pendingAskId: t.id });
  persist();
  paint();
  const runCtx = answer.send ? { ...webCtx(), webEnabled: true, search, confirmBeforeNetwork: false } : webCtx();
  const turn = await runTurn(t.message, {
    ...packOptions.turnOptions, registry, router, ctx: runCtx, planner, extractor, assembler, focus,
    prev: lastCompletedIn(c), pending: t, consent: answer,
    onStage: (name, detail) => showStage(name, detail, chatId)
  });
  turn.lane = 'A';
  if (answer.send && lastWebSend) { turn.webSentAt = lastWebSend.at; lastWebSend = null; }
  landReply(chatId, turn, { deliver: true });
}

/* A Reply to a worked-out Patch answer carries that answer to the planner, so
   "split that 3 ways" can read its total. Nothing else carries anything: a
   message that is not a Reply is planned on its own words, as it always was. */
/* Off until scripts/followups.mjs clears the bar the user set (≥90% of carries
   right, no control reaching back). Measured 2026-09-14 on Qwen3.5-2B: 2 of 60.
   A Reply that hands the planner an answer it mostly misuses is worse than one
   that hands it nothing, so the window carries nothing yet. */
const REPLY_CARRIES = false;

function carryFor (c, quoteId) {
  if (!REPLY_CARRIES) return null;
  const t = c && quoteId ? chatNodes(c)[quoteId] : null;
  return t && t.lane !== 'B' && markFor(t) === MARKS.WORKED ? t : null;
}

/* One value on the skill line, changed. Only a one-step answer that never used
   the web can be re-worked this way: its plan is that one skill with what you
   gave. Anything else — two steps, a failure, a look-up — opens Edit on your
   message instead, because changing one input there is a different question. */
function changeValueFrom (turnId, field, shown = '') {
  const c = activeChat();
  const t = c && chatNodes(c)[turnId];
  if (!t) return;
  const results = t.results || [];
  const r = results.length === 1 && results[0].ok && !t.webSentAt ? results[0] : null;
  const web = r && r.provenance && /web/i.test(String(r.provenance.kind || ''));
  if (!r || web || !r.sources || !Object.prototype.hasOwnProperty.call(r.input || {}, field)) { startEdit(turnId); return; }
  const was = r.input[field];
  const spec = (((registry && registry.skill(r.skill)) || {}).inputSchema || {}).properties || {};
  const label = (spec[field] && spec[field].label) || field.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
  const close = openSheet(`
    <div class="sheet-card">
      <div class="sheet-title">Change <code class="cv-label">${esc(label)}</code> value</div>
      <div class="sheet-body">
        <input class="net-q" id="cvIn" type="text" value="${esc(shown || String(was))}" aria-label="New ${esc(label)}" spellcheck="false">
        Patch works it out again with this, as a new version of your message. Everything else you gave stays the same.
      </div>
      <div class="sheet-row">
        <button class="sheet-btn" id="cvNo">Cancel</button>
        <button class="sheet-btn primary" id="cvYes">Work it out</button>
      </div>
    </div>`, (host) => {
    const box = host.querySelector('#cvIn');
    const go = () => {
      const text = box.value.trim();
      let value = text;
      if (typeof was === 'number') {
        value = Number(text.replace(/[£$€₹¥,\s]/g, ''));
        if (!text || !Number.isFinite(value)) { toast('That isn’t a number.'); return; }
      } else if (!text) { toast('An empty value has nothing to work out.'); return; }
      close();
      changeValue(turnId, field, value);
    };
    host.querySelector('#cvNo').onclick = () => close();
    host.querySelector('#cvYes').onclick = go;
    box.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } };
    box.focus();
    box.select();
  });
}

async function changeValue (turnId, field, value) {
  const c = activeChat();
  const chatId = c.id;
  const t = chatNodes(c)[turnId];
  if (!t) return;
  if (c.inflight) { afterReply(chatId, () => changeValue(turnId, field, value)); return; }
  if (patchState.state !== 'ready') { toast(patchNotReady(), 4200); return; }
  const r = (t.results || []).find(x => x && x.ok);
  if (!r || !r.sources) return;
  /* What you gave or answered, and the new value. Defaults are left out so they
     are defaults again, and the app's own context is filled in by the executor. */
  const kept = Object.fromEntries(Object.entries(r.input || {}).filter(([k]) => r.sources[k] === 'given' || r.sources[k] === 'asked'));
  followIf(c); startInflight(c, { message: t.message, lane: 'A', parentId: t.parentId ?? null });
  persist();
  paint();
  const turn = await runTurn(t.message, {
    ...packOptions.turnOptions, registry, router, ctx: webCtx(), extractor: null, assembler, focus, prev: lastCompletedIn(c),
    plan: { steps: [{ id: 's1', skill: r.skill, input: { ...kept, [field]: value } }] }
  });
  turn.message = t.message;
  turn.lane = 'A';
  turn.changed = { field, from: r.input[field], to: value };
  landReply(chatId, turn, { deliver: true });
}

/* ctx for a turn. The base ctx is built once from the device; the web policy
   is the only part that changes while the app is open, and it is the user's to
   set. A turn never carries `search` from here: only a yes on the card hands
   it over, for that one turn (answerConsent). */
function webCtx () {
  /* `webAvailable` lets a look-up stop and ask on the card (CONSENT_WEB) rather
     than fail: there is a provider, and the person has not said never. */
  return { ...ctx, webAvailable: Boolean(search) && state.settings.webPolicy !== 'never', webPolicy: state.settings.webPolicy, webEnabled: false };
}

/* Where an underlined value came from: the page's text with the answer
   marked, the table row, or your own message with the words the figure was
   worked out from marked — one window, the same mark, for every underline
   (ui/cite.js). A figure keeps its exact input and output folded underneath.
   Opening one retires the one-time "click anything underlined" note. */
function openValueDetail (turnId, stepId, seg) {
  const turn = turnId === SCRATCH_TURN ? scratchTurn : state.turns.find(t => t.id === turnId);
  const results = (turn && turn.results) || [];
  let r = stepId ? results.find(x => x.id === stepId) : null;
  if (!r) {
    /* No step id (a turn from an older build), so fall back to the skill name —
       but only when it is unambiguous. Showing the wrong step confidently is
       worse than showing what the reply itself carried. */
    const matches = results.filter(x => x.skill === (seg && seg.skill));
    if (matches.length === 1) r = matches[0];
  }
  const p = (r && r.provenance) || (seg && seg.provenance) || {};
  const kind = p.kind === 'web' ? 'web' : p.kind === 'bundled' ? 'bundled' : 'computed';
  const c = citationFor({
    kind,
    turn: turn || { message: '' },
    r,
    seg,
    source: webSource(turn),
    host: p.source ? hostOf(p.source) : '',
    date: p.dataAsOf ? niceDate(p.dataAsOf) : '',
    titleOf: (name) => { try { return registry && registry.skill(name)?.title; } catch { return null; } }
  });
  let dev = '';
  if (kind !== 'web') {
    const inputJson = JSON.stringify(r ? r.input : (seg && seg.input) ?? null, null, 2);
    const outJson = JSON.stringify(r ? (r.ok ? r.value : r.error) : (seg && seg.raw), null, 2);
    dev = `<details class="mi-dev"><summary>Exact input and output</summary>
          <div class="field"><label>What went in</label><pre class="code">${esc(inputJson)}</pre></div>
          <div class="field"><label>What came out</label><pre class="code">${esc(outJson)}</pre></div>
        </details>`;
  }
  openCitation(c, dev);
  if (!(state.settings.tips || {}).figure) {
    state.settings.tips = { ...(state.settings.tips || {}), figure: true };
    persist();
    paint();
  }
}

function openCitation (c, dev = '') {
  openSheet(citationHtml(c, { dev }), (host) => {
    const copy = host.querySelector('#cite-copy');
    if (copy) copy.onclick = () => copyText(c.copy);
    const link = host.querySelector('#cite-link');
    if (link) link.onclick = () => copyText(c.link);
  });
}

function switchChat (id) {
  if (!state.chats.some(c => c.id === id)) return;
  /* What you had typed, and its image chip or transcript offer, stay with the
     chat you left; the one you open brings back its own. */
  stashComposer();
  state.compose = null;
  state.profile = null;
  state.activeChatId = id;
  loadComposer();
  /* Opening a chat is reading it. */
  markUnread(activeChat(), false);
  /* Panels are keyed by turn id, so a stale entry could not open the wrong one —
     but ids from a conversation you have left are litter, and clearing them
     means a chat always opens the way you would expect. */
  state.open.clear();
  state.raw.clear();
  state.editing = null;
  persist();
  paint();
}

async function deleteChat (id) {
  const c = state.chats.find(x => x.id === id);
  if (!c) return;
  const wasOpen = state.activeChatId === id;
  if (state.compose && state.compose.chatId === id) state.compose = null;
  if (wasOpen) { dropAttachment(); dropTranscript(); }
  state.chats = state.chats.filter(x => x.id !== id);
  /* Nothing waiting for this chat is kept. */
  for (const m of [afterReplyTasks, pendingQuotes, chatOptions, pendingImages, pendingPictures]) m.delete(id);
  if (wasOpen) {
    state.activeChatId = byActivity(state.chats)[0]?.id ?? null;
    loadComposer();
  }
  state.open.clear();
  state.editing = null;
  persist();
  /* Wait for the write. A delete lost to a debounce that never fired would
     bring the chat back on the next launch, which reads as the app ignoring
     you. */
  await flush();
  paint();
}

function renameChat (id, title) {
  const c = state.chats.find(x => x.id === id);
  const name = String(title || '').trim();
  if (!c || !name) return;
  c.title = name.slice(0, 60);
  /* A name a person chose is never overwritten by the derived one. */
  c.renamed = true;
  persist();
  paint();
}

async function executeHandWrittenPlan () {
  const out = $('planout');
  if (patchState.state !== 'ready') { toast(patchNotReady(), 4200); return; }
  let parsed;
  try {
    parsed = JSON.parse(planText);
  } catch (e) {
    out.innerHTML = `<div class="card"><h3>That isn't JSON</h3><p>${esc(e.message)}</p></div>`;
    return;
  }
  const check = validatePlan(parsed, registry);
  if (!check.ok) {
    out.innerHTML = `<div class="card"><h3>Plan rejected</h3>${check.errors.map(e =>
      `<span class="fail"><span class="code">${esc(e.step || 'plan')}</span>${esc(e.message)}</span>`).join('')}</div>`;
    return;
  }
  const turn = await runTurn('', { ...packOptions.turnOptions, registry, router, ctx: webCtx(), extractor, assembler, focus, plan: parsed });
  /* Held so the value-detail view can resolve a marked span on this screen too.
     It is the screen where looking at raw output matters most, and it is not
     part of the conversation, so it does not belong in state.turns. */
  scratchTurn = turn;
  out.innerHTML = `<div class="card">
    <h3>${turn.ask ? 'The plan stopped to ask' : 'Result'}</h3>
    <div class="bub ai" style="max-width:none;align-self:stretch">${turn.ask
      ? esc(turn.ask.question)
      : paintSegments(turn.reply.segments, SCRATCH_TURN)}</div>
    <div class="plan" style="margin-top:12px">
      ${turn.results.map(r => `<div class="step">
        <div class="hd"><span class="t-badge ${r.ok ? 'ok' : 'bad'}">${r.ok ? 'ok' : r.error.code}</span>
        <b>${esc(r.skill)}</b><span class="ms">${r.ms}ms · ${esc(r.provenance ? r.provenance.kind : 'failed')}</span></div>
        <div class="kv">in &nbsp;${esc(short(JSON.stringify(r.input), 300))}</div>
        ${(r.dropped || []).map(d => `<div class="kv">not used &nbsp;${esc(d.field)} — the plan supplied a value, but ${esc(d.why)}</div>`).join('')}
        <div class="kv">out ${esc(short(JSON.stringify(r.ok ? r.value : r.error), 300))}</div>
      </div>`).join('')}
      <div class="rt"><span>reply from ${esc(turn.reply ? turn.reply.source : 'nothing — the plan ended in a question')}</span></div>
    </div></div>`;
}

void REPLY_SOURCES;

/* Detection is async and deliberately NOT awaited before the first paint: the
   app is fully usable without a model, and blocking the UI on a health check
   would make the model feel required. If one turns up, the rail updates. */
async function detectModel () {
  engine = engineBridge();
  /* The sleep period the person chose, told to the engine once it exists. */
  if (engine && engine.setIdleUnload) engine.setIdleUnload(state.settings.sleepAfter).catch(() => {});
  await Promise.all([detectWeb(), detectOcrEngine()]);

  if (!engine) {
    /* A browser: no engine to ask, so the two model probes are the whole
       story. The servers are started by hand (`npm run models`) and usually
       AFTER the page is open, so keep asking, gently, until each one is
       found; the probe is a 2-second loopback GET and costs nothing when
       nobody is listening. */
    await Promise.all([detectPlanner(), detectCategoryAdapter()]);
    /* Chat rides on the category SERVER, not on Patch's router: the router
       needs Patch's skills, and an unavailable Patch must not take Chat and
       the Pigeons down with him. So the server is probed on its own. The
       Promise.all above waits for Patch to settle, so patchState is final by
       the time `stillMissing` first reads it. */
    if (!chat && await categoryServerUp()) await detectChat();
    const stillMissing = () => !chat || (patchState.state === 'ready' && (!planner || !categoryModel));
    /* Backing off: a page left open with no models asks every 5 s at first
       and settles at once a minute, rather than forever at 5 s. */
    let wait = MODEL_REPROBE_MS;
    while (stillMissing()) {
      await new Promise(r => setTimeout(r, wait));
      wait = Math.min(wait * 2, MODEL_REPROBE_MAX_MS);
      await Promise.all([planner ? null : detectPlanner(), categoryModel ? null : detectCategoryAdapter()]);
      if (!chat && await categoryServerUp()) await detectChat();
    }
    return;
  }

  /* The app: the engine is the source of truth and it pushes. Nothing here
     polls — a role's phase arrives as an event, and a role that turns ready
     is bound to the planner or category seam then, and unbound when it
     leaves ready. */
  engine.onStatus(applyEngineStatus).catch(() => {});
  engine.onProgress(applyProgress).catch(() => {});
  await restored;
  await refreshEngine();
  if (engineStatus?.disabled) return;
  /* No sheet at launch. Patch answers without the download, so the first
     thing a person sees is Pigeon working; the download is offered where it is
     needed — at the top of the list, and under a question that needed it. */
  if (needsFirstRun({ models: modelsInfo, settings: state.settings })) {
    paint();
    return;
  }
  await wakeEngine();
}
const MODEL_REPROBE_MS = 5000;
const MODEL_REPROBE_MAX_MS = 60000;

/* Is the category server answering at all? Chat needs only that. */
const categoryServerUp = async () => Boolean(await detectLlm({ base: CATEGORY_BASE, role: 'category' }).catch(() => null));

async function refreshEngine () {
  try {
    [engineStatus, modelsInfo] = await Promise.all([engine.status(), engine.models()]);
  } catch (e) { console.warn('engine status:', e); }
  paint();
}

async function wakeEngine () {
  try { await applyEngineStatus(await engine.wake()); } catch (e) { console.warn('engine wake:', e); }
}

/* One engine-status event, applied to the seams. Binding uses the same probes
   the browser path does, so a ready role is confirmed by its own /props before
   the rail names it. */
async function applyEngineStatus (status) {
  /* What the pane draws from the engine: which models answer, and whether
     the lane is up. A status tick that changes none of them (a wake counting
     down, a reply's stage) redraws the header and the list in place, not the
     thread — a full redraw under a reader was how every wake nudged them. */
  const wasDisabled = Boolean(engineStatus && engineStatus.disabled);
  const before = `${Boolean(planner)}:${Boolean(categoryModel)}:${Boolean(chat)}:${personas.length}:${wasDisabled}:${pigeonOf('peek').loaded}`;
  engineStatus = status;
  /* Peek can run when the engine found its picture model on this Mac. */
  if (status) setPeekModel(status.peek || null);
  /* One model from Patch v10: the planner's Pigeon runs on the same base
     as the router, so it is up when that model is. */
  const plannerUp = status?.category?.phase === 'ready';
  const categoryUp = status?.category?.phase === 'ready';
  if (plannerUp && !planner) await detectPlanner({ quiet: true });
  else if (!plannerUp && planner) {
    planner = null; focus = null; secondLook = null; asks = null; plannerComplete = null; modelName = null;
  }
  if (categoryUp && !categoryModel) await detectCategoryAdapter({ quiet: true });
  /* A Pigeon replaced while they slept is checked now, once each. */
  if (categoryUp && (state.settings.uncheckedRides || []).length) {
    const rides = state.settings.uncheckedRides.filter(r => personas.some(p => p.id === r.id));
    state.settings.uncheckedRides = [];
    persist();
    for (const r of rides) checkRide(r);
  }
  else if (!categoryUp && categoryModel) {
    router = registry ? lexicalFor(registry) : null; categoryModel = null;
  }
  /* Lane B rides on the category server: the same process, a different
     endpoint and a different adapter set (see src-tauri/src/chat.rs). So it
     arrives and leaves with that role, and the lane says which. */
  if (categoryUp && !chat) await detectChat({ quiet: true });
  else if (!categoryUp && chat) {
    chat = null;
    /* Asleep is not uninstalled: the app keeps listing them, marked not loaded. */
    if (pigeonInvoke()) await refreshPersonas(); else personas = [];
  }
  const after = `${Boolean(planner)}:${Boolean(categoryModel)}:${Boolean(chat)}:${personas.length}:${Boolean(status && status.disabled)}:${pigeonOf('peek').loaded}`;
  if (after !== before) paint();
  else { paintHead(); paintList(); }
}

/* ── the first-run sheet and the download ───────────────────────────────── */

/* Ask, or show the download that is running. */
function openModelsSheet () {
  if (!engine || !modelsInfo) return;
  if (downloading) {
    sheetHost = openSheetHost(progressHtml(downloadProgress || blankProgress(), esc), wireDownloadCard).host;
    return;
  }
  if (!(modelsInfo.download_bytes > 0)) { toast('The model is on this Mac'); return; }
  sheetHost = openSheetHost(firstRunHtml(modelsInfo, esc), (host, close) => {
    host.addEventListener('click', (e) => {
      const b = e.target.closest('[data-fr]');
      if (!b) return;
      if (b.dataset.fr === 'notnow') {
        state.settings.firstRun = { seenAt: Date.now(), choice: 'declined' };
        persist(); close();
        /* Declining the download is not declining the models: a server that
           is already up (the dev script, or borrowed weights) is still used. */
        wakeEngine();
      } else if (b.dataset.fr === 'go') {
        state.settings.firstRun = { seenAt: Date.now(), choice: 'accepted' };
        persist();
        startDownload(host, close);
      }
    });
  }).host;
}

/* openSheet returns its close(); the host ELEMENT is what the progress events
   repaint. Kept together so a closed sheet is never painted into.
 *
 * This is not a convenience. `sheetHost = openSheet(...)` puts the close
 * function in a variable every progress event then tests with
 * `document.body.contains(...)` — which is false for a function, so the card
 * simply stopped updating: a download started from the list strip, or reopened
 * with Details, showed 0% until it finished. Every caller goes through here
 * now, and the only assignment that matters is the one that yields an element. */
function openSheetHost (html, onWire) {
  let hostEl = null;
  const close = openSheet(html, (host, c) => { hostEl = host; onWire(host, c); });
  return { host: hostEl, close };
}

function blankProgress () {
  const picture = downloadKind === 'picture';
  if (downloadKind === 'projector') {
    return { id: 'projector', stage: 'download', received: 0, total: projectorWanted.bytes, overall_received: 0, overall_total: projectorWanted.bytes, resumed: false, error: null };
  }
  return { id: picture ? 'picture' : downloadKind === 'embedding' ? 'embedding' : 'category', stage: 'download', received: 0, total: 0, overall_received: 0,
    overall_total: (picture ? modelsInfo?.picture?.remaining_bytes : downloadKind === 'embedding' ? modelsInfo?.embedding?.remaining_bytes : modelsInfo?.remaining_bytes) || 0, resumed: false, error: null };
}

/* A picture Pigeon's stock picture reader (its projector), from the published
   list this app ships with. The Meet row already said its size, source and
   licence beside the button; this is the download, then the add. */
let projectorWanted = { sha: '', bytes: 0, host: '' };

function beginProjectorDownload (sha, bytes, host) {
  if (!engine || !sha) return;
  if (downloading) { openModelsSheet(); return; }
  downloadKind = 'projector';
  projectorWanted = { sha, bytes, host };
  sheetHost = openSheetHost(progressHtml(blankProgress(), esc), (host, close) => { startDownload(host, close); }).host;
}

async function startProjectorDownload (host, close) {
  downloading = true;
  downloadProgress = blankProgress();
  sheetHost = host;
  const card = host.querySelector('.sheet-card');
  if (card) card.outerHTML = progressHtml(downloadProgress, esc);
  wireDownloadCard(host, close);
  paint();
  const out = await fetchProjector(projectorWanted, host, close, {
    download: (sha) => engine.downloadProjector(sha),
    cancelled: CANCELLED,
    shown: (el) => document.body.contains(el),
    toast: (text) => toast(text, 4600),
    logWeb: (entry) => {
      const log = Array.isArray(state.settings.webLog) ? state.settings.webLog : [];
      state.settings.webLog = [...log, { at: Date.now(), ...entry }].slice(-500);
      persist();
    },
    addHeld: async () => {
      // The download is over: the add (and anything it opens) sees it so.
      downloading = false;
      downloadKind = 'models';
      if (!pendingAdds.length || !pigeonInvoke()) return;
      const ids = pendingAdds;
      pendingAdds = [];
      await reportPigeonOutcomes(await pigeonInvoke()('pigeon_add', { ids }));
    }
  });
  downloading = false;
  downloadKind = out.kind;
  if (out.stage === 'paused') toast('Download paused — open the Pigeon again to carry on; what arrived is kept');
  if (out.stage === 'failed') {
    downloadProgress = { ...(downloadProgress || blankProgress()), stage: 'failed', error: out.error };
    paintDownloadCard();
  }
  paint();
}

/* Peek's model, from Peek's page: straight to the progress card — the page
   already said the size and the licence beside the button. */
function beginPictureDownload () {
  if (!engine || !modelsInfo || !modelsInfo.picture) return;
  if (downloading) { openModelsSheet(); return; }
  downloadKind = 'picture';
  sheetHost = openSheetHost(progressHtml(blankProgress(), esc), (host, close) => { startDownload(host, close); }).host;
}

/* What Peek's page offers while its model is missing: the size, and once the
   download runs, how far it has got. */
function pictureOffer (d) {
  const pic = modelsInfo && modelsInfo.picture;
  if (d.kind !== 'peek' || d.loaded || !engine || !pic || !(pic.download_bytes > 0)) return null;
  const running = downloading && downloadKind === 'picture' && downloadProgress ? `${progressLine(downloadProgress).pct}%` : null;
  if (downloading && !running) return null;
  return { size: fmtBytes(pic.remaining_bytes || pic.download_bytes), name: pic.name, running };
}

/* What a Reader's page offers while the search model is missing: a grounded
   Pigeon whose material was embedded (hybrid-v1) needs the same model here
   to embed the question. 146 MB, once, for every such Pigeon. */
function embeddingOffer (d) {
  const emb = modelsInfo && modelsInfo.embedding;
  const p = d && d.id ? personas.find(x => x.id === d.id) : null;
  if (!p || p.retrieval !== 'hybrid-v1' || !engine || !emb || emb.present || !(emb.download_bytes > 0)) return null;
  const running = downloading && downloadKind === 'embedding' && downloadProgress ? `${progressLine(downloadProgress).pct}%` : null;
  if (downloading && !running) return null;
  return { size: fmtBytes(emb.remaining_bytes || emb.download_bytes), name: emb.name, running, what: 'search' };
}

function beginEmbeddingDownload () {
  if (!engine || !modelsInfo || !modelsInfo.embedding) return;
  if (downloading) { openModelsSheet(); return; }
  downloadKind = 'embedding';
  sheetHost = openSheetHost(progressHtml(blankProgress(), esc), (host, close) => { startDownload(host, close); }).host;
}

async function startEmbeddingDownload (host, close) {
  downloading = true;
  downloadProgress = blankProgress();
  sheetHost = host;
  const card = host.querySelector('.sheet-card');
  if (card) card.outerHTML = progressHtml(downloadProgress, esc);
  wireDownloadCard(host, close);
  paint();
  try {
    await engine.downloadEmbedding();
    downloading = false;
    downloadKind = 'models';
    await refreshEngine();
    if (document.body.contains(host)) close();
    toast('Search model ready · checked it arrived intact');
    const log = Array.isArray(state.settings.webLog) ? state.settings.webLog : [];
    state.settings.webLog = [...log, { at: Date.now(), text: 'The search model, for Pigeons that answer from their own material ← huggingface.co', hosts: ['huggingface.co'] }].slice(-500);
    persist();
    paint();
  } catch (e) {
    downloading = false;
    downloadKind = 'models';
    toast(friendly(e), 5200);
    if (document.body.contains(host)) close();
    paint();
  }
}

function wireDownloadCard (host, close) {
  /* Once per host: Retry comes back through here, and a second listener
     would start a second download on the next click. */
  if (host.dataset.frWired) return;
  host.dataset.frWired = '1';
  host.addEventListener('click', (e) => {
    const b = e.target.closest('[data-fr]');
    if (!b) return;
    if (b.dataset.fr === 'cancel') engine.cancel().catch(() => {});
    else if (b.dataset.fr === 'close') close();
    else if (b.dataset.fr === 'retry') startDownload(host, close);
  });
}

/* The progress card, without taking it apart under the person using it.
 *
 * `PROGRESS_EVERY` in download.rs is 150 ms, so this runs about seven times a
 * second for as long as a 2 GB download takes. It used to replace the card's
 * whole markup each time, which meant the Cancel button was destroyed and
 * rebuilt between a mousedown and a mouseup — so clicking it took two or three
 * goes — and could not be reached from the keyboard at all, because focus does
 * not survive an element that is replaced six times while you Tab towards it.
 * Escape was no help either: closing the sheet deliberately leaves the download
 * running, so there was no way at all to stop one without a mouse.
 *
 * So only the four things that actually change are written, exactly as the list
 * strip below already does it. The card is rebuilt only when it becomes a
 * DIFFERENT card — running to failed, or failed to running on a retry — which
 * is the only time its buttons differ, and is rare enough to cost nothing. That
 * is read off the DOM rather than remembered, so it cannot fall out of step
 * with what is actually on screen. */
function paintDownloadCard () {
  const host = sheetHost;
  if (!host || typeof document === 'undefined' || !document.body.contains(host)) return;
  const card = host.querySelector('.sheet-card');
  if (!card) return;
  const ev = downloadProgress || blankProgress();
  const failed = ev.stage === 'failed';
  if (failed !== Boolean(card.querySelector('[data-fr="retry"]'))) {
    card.outerHTML = progressHtml(ev, esc);
    return;
  }
  /* A failed card says one thing and then waits for a button. */
  if (failed) return;
  const p = progressLine(ev);
  const set = (sel, text) => {
    const el = card.querySelector(sel);
    if (el && el.textContent !== text) el.textContent = text;
  };
  set('.sheet-title', p.title);
  set('.dl-overall', p.overall);
  set('.dl-line', p.line);
  set('.dl-resume', p.resumed ? 'resumed' : 'resumable');
  const fill = card.querySelector('.bar > i');
  if (fill) fill.style.width = `${p.pct}%`;
  /* The number a screen reader reads is the number the bar draws. Safe to move
     every event now that the card is not rebuilt around it — a progressbar that
     is replaced seven times a second is announced from scratch seven times a
     second, which is why this waited for the fix above. */
  const bar = card.querySelector('.bar');
  if (bar) bar.setAttribute('aria-valuenow', String(p.pct));
}

function applyProgress (ev) {
  downloadProgress = ev;
  paintDownloadCard();
  /* The strip's line changes in place; the rows under it are not rebuilt for
     every few hundred kilobytes. */
  const strip = document.querySelector('#rows .dl-strip > span');
  const p = downloading && downloadProgress ? progressLine(downloadProgress) : null;
  if (strip && p) strip.textContent = `Downloading · ${p.line}`;
  else paintList();
  if (ev.stage === 'done' || ev.stage === 'failed') paint();
}

/* The offer at the top of the list, and the download's progress once it runs. */
function downloadStrip () {
  if (!engine || !modelsInfo || engineStatus?.disabled) return '';
  if (downloading) {
    const p = downloadProgress ? progressLine(downloadProgress) : null;
    return `<div class="dl-strip"><span>Downloading${p ? ` · ${esc(p.line)}` : ''}</span><button class="link" data-do="download-show">Details</button></div>`;
  }
  if (!needsFirstRun({ models: modelsInfo, settings: state.settings })) return '';
  return `<div class="dl-strip"><span>Pigeon works with no download. A ${esc(fmtBytes(modelsInfo.download_bytes))} download lets Patch follow whole sentences and adds Pen, a Pigeon that writes.</span>
    <span class="dl-btns"><button class="btn-verb" data-do="download">Download</button><button class="btn-verb soft" data-do="download-later">Later</button></span></div>`;
}

/* Start the download from the strip or from a reply, showing its progress. */
function beginDownload () {
  if (!engine || !modelsInfo) return;
  if (downloading) { openModelsSheet(); return; }
  state.settings.firstRun = { seenAt: Date.now(), choice: 'accepted' };
  persist();
  sheetHost = openSheetHost(progressHtml(blankProgress(), esc), (host, close) => { startDownload(host, close); }).host;
}

async function startDownload (host, close) {
  if (downloading) return;
  if (downloadKind === 'picture') return startPictureDownload(host, close);
  if (downloadKind === 'embedding') return startEmbeddingDownload(host, close);
  if (downloadKind === 'projector') return startProjectorDownload(host, close);
  downloading = true;
  downloadProgress = blankProgress();
  sheetHost = host;
  /* The asking card becomes the progress card in place; the same host keeps
     the same backdrop and Escape handling. */
  const card = host.querySelector('.sheet-card');
  if (card) card.outerHTML = progressHtml(downloadProgress, esc);
  wireDownloadCard(host, close);
  paint();
  try {
    await engine.download();
    downloading = false;
    await refreshEngine();
    if (document.body.contains(host)) close();
    toast('Download ready · checked it arrived intact');
    if (pendingAdds.length && pigeonInvoke()) {
      const ids = pendingAdds;
      pendingAdds = [];
      try { await reportPigeonOutcomes(await pigeonInvoke()('pigeon_add', { ids })); } catch (e) { toast(friendly(e), 4600); }
    }
    /* A download is traffic too, so it is written down where look-ups are. */
    const log = Array.isArray(state.settings.webLog) ? state.settings.webLog : [];
    state.settings.webLog = [...log, { at: Date.now(), text: 'Pigeon’s model ← huggingface.co', hosts: ['huggingface.co'] }].slice(-500);
    persist();
    /* Pen can now write: it joins the way a new contact does. */
    showBanner(bannerHtml({ chatId: 'pen', name: 'Pen joined', title: 'Writes anything you ask', text: 'Message Pen', avatar: avatarHtml(pigeonOf('chat'), 34) }), () => startCompose('chat'));
    paint();
    await wakeEngine();
  } catch (e) {
    downloading = false;
    const msg = String(e && e.message ? e.message : e);
    if (msg === CANCELLED) {
      if (document.body.contains(host)) close();
      toast('Download paused — what arrived is kept for next time');
    } else {
      downloadProgress = { ...(downloadProgress || blankProgress()), stage: 'failed', error: msg };
      paintDownloadCard();
    }
    await refreshEngine();
  }
}

/* The picture model, for Peek: the same card, the same pause and resume, and
   no wake afterwards — the picture server starts on Peek's first message. */
async function startPictureDownload (host, close) {
  downloading = true;
  downloadProgress = blankProgress();
  sheetHost = host;
  const card = host.querySelector('.sheet-card');
  if (card) card.outerHTML = progressHtml(downloadProgress, esc);
  wireDownloadCard(host, close);
  paint();
  try {
    await engine.downloadPicture();
    downloading = false;
    downloadKind = 'models';
    await refreshEngine();
    if (document.body.contains(host)) close();
    toast('Picture model ready · checked it arrived intact');
    const log = Array.isArray(state.settings.webLog) ? state.settings.webLog : [];
    state.settings.webLog = [...log, { at: Date.now(), text: 'The picture model, for Peek ← huggingface.co', hosts: ['huggingface.co'] }].slice(-500);
    persist();
    showBanner(bannerHtml({ chatId: 'peek', name: 'Peek can see', title: 'Looks at a picture and tells you about it', text: 'Message Peek', avatar: avatarHtml(pigeonOf('peek'), 34) }), () => startCompose('peek'));
    paint();
  } catch (e) {
    downloading = false;
    const msg = String(e && e.message ? e.message : e);
    if (msg === CANCELLED) {
      downloadKind = 'models';
      if (document.body.contains(host)) close();
      toast('Download paused — what arrived is kept for next time');
    } else {
      downloadProgress = { ...(downloadProgress || blankProgress()), stage: 'failed', error: msg };
      paintDownloadCard();
    }
    await refreshEngine();
  }
}

/* ── Patch's skills, in their locked room ────────────────────────────────
   Loaded after the first paint, in a Blob worker (patch-pack.js). Until they
   are, Patch is drawn as getting ready and nothing asks him anything; if they
   cannot be loaded he is drawn as unavailable with the reason, and there is no
   built-in copy to fall back on. `patchSettled` resolves true once he is ready
   and false if he never will be, so the model probes can wait on it. */
let settlePatch;
const patchSettled = new Promise((resolve) => { settlePatch = resolve; });

const patchNotReady = () => (patchState.state === 'unavailable'
  ? patchState.reason
  : patchState.state === 'loading' ? 'Patch is still loading' : '');
const patchWord = () => (patchState.state === 'unavailable' ? 'unavailable' : 'loading');

/* Where Patch's skills come from. THE ONE PLACE PHASE 3 CHANGES: under Tauri
   this will ask `invoke('patch_status')` for the sealed pack's code base and
   its prompts and tunables ({ codeBase, pack: { prompts, tunables, version,
   source } }). Until the app serves that scheme, the app loads this checkout's
   skills/ exactly as the browser build does: codeBase '/', no pack options,
   labelled "dev checkout". */
/* The shared answer lives in patch-pack.js (both windows ask it): Rust's
   sealed pack under Tauri, never a loose checkout; the checkout in a browser. */

async function startPatch () {
  let loaded;
  try {
    const { codeBase, pack, devAllowed } = await patchSource();
    loaded = await loadPatch({
      codeBase, pack, devAllowed,
      /* A skill's search goes through the same provider a routed turn uses, and
         only when that run's ctx had the web on — patch-pack.js checks. */
      search: (query) => {
        if (!search) throw new Error('No search provider is connected, so nothing can be looked up.');
        return search(query);
      }
    });
  } catch (e) {
    loaded = { state: 'unavailable', reason: `Patch is unavailable: ${(e && e.message) || e}` };
  }
  if (loaded.state === 'ready') {
    registry = loaded.registry;
    packOptions = loaded.options || {};
    extractor = jsExtractor(registry);
    /* The category adapter's router replaces this if it is already up. */
    if (!router) router = lexicalFor(registry);
    patchState = { state: 'ready', info: loaded.info };
    settlePatch(true);
  } else {
    patchState = { state: 'unavailable', reason: loaded.reason };
    settlePatch(false);
  }
  paint();
}

/* How the pipeline is put together now lives in stack.js, because the popover
   window builds the same one and two copies of that knowledge would drift. */
async function detectPlanner ({ quiet = false } = {}) {
  if (!(await patchSettled)) return;
  const built = await buildPlanner(registry, packOptions);
  if (!built) return;
  ({ model: modelName, complete: plannerComplete, planner, focus, secondLook, asksCheck: asks } = built);
  if (!quiet) paint();
}

/* The category adapter: a small fine-tuned model that names the neighbourhood a
   request belongs to, so the skills that share no words with it are still
   reachable. Measured on the grading holdout it lifts answered-correctly from
   108 to 117 of 302 while still refusing all 50 no-skill messages. It refuses
   when unsure — see CATEGORY_CONFIDENCE — and falls back to the lexical router
   whenever it does, which is why a wrong category costs nothing the old router
   would have got right. */
/* The web provider. Finding one does NOT turn the web on — it only makes the
   switch appear. */
async function detectWeb () {
  search = await detectSearch();
  if (search) paint();
}

/* The OCR engine. Finding one draws the image button and the rail's vision
   row; not finding one draws neither, and a pasted image says why. Probed
   once: an engine is installed or it is not, unlike a model server that may
   be started after the window opens. */
async function detectOcrEngine () {
  ocr = await detectOcr();
  if (!ocr) return;
  try { ocrDetail = await ocr.status(); } catch { ocrDetail = null; }
  paint();
}

/* The chat lane's transport, and the personas the running server has loaded.
   A failure here is not a failure of the app: the lane draws "asleep" and
   everything in the verified lane carries on. */
async function detectChat ({ quiet = false } = {}) {
  const bridge = chatBridge();
  if (!bridge) return;
  chat = bridge;
  try { personas = await bridge.personas(); }
  catch { personas = []; }
  if (!quiet) paint();
}

async function detectCategoryAdapter ({ quiet = false } = {}) {
  if (!(await patchSettled)) return;
  const built = await buildCategoryRouter(registry, packOptions);
  if (!built) return;
  router = built.router;
  categoryModel = built.model;
  if (!quiet) paint();
}

/* Nothing is awaited before the first paint. An empty composer must appear
   instantly; the saved chats and any reachable models land afterwards and
   repaint. Someone typing in that window keeps what they typed — that is what
   the paint guard is for.

   The catches are load-bearing: app.js is imported by the test suite, which has
   no DOM. A rejected promise from a top-level call there is an unhandled
   rejection, and an unhandled rejection kills the process rather than failing a
   check — so a boot error would take the whole suite down instead of one test. */
paint();
/* Saving has started failing, or has started working again. Worth saying the
   moment it changes rather than at whatever repaint happens next: the rail's
   line is the only place the app admits it, and somebody about to quit needs
   to have seen it before they do. */
onSaveTrouble((failing) => {
  if (failing) toast('Pigeon could not save your chats to this Mac. It is still trying — see the line under the list.', 7000);
  else toast('Saving your chats is working again.', 4000);
  paintList();
});
startPatch().catch(() => {});
/* Chats first — the first-run decision reads the saved settings — but not
   awaited by the paint; detectModel awaits it before deciding on the sheet. */
const restored = restoreChats().catch(() => {});
detectModel().catch(() => {});
listenForPigeonOpens();
listenForCloseTip();
takeQueuedPigeonOpens().catch(() => {});
refreshPersonas().catch(() => {});

/* With the window's own drag-drop handling off (see wire()), WebKit's default
   for a file dropped anywhere else on the page is to NAVIGATE to it — and the
   app would be replaced by an image viewer. Swallow the drop; the composer's
   own handler has already taken the ones that matter. Registered once, here,
   because wire() re-runs on every paint. Guarded: the test suite imports this
   file with no document. */
if (typeof document !== 'undefined' && document.addEventListener) {
  wireStatic();
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', (e) => e.preventDefault());
  /* A hidden window can have its timers throttled, so the 400 ms save might not
     have fired by the time Pigeon is quit. Write what you had typed, and any
     question in flight, as soon as the window stops being looked at. */
  const saveNow = () => { persist(); flush().catch(() => {}); };
  document.addEventListener('visibilitychange', () => { if (document.hidden) saveNow(); });
  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('blur', saveNow);
    window.addEventListener('pagehide', saveNow);
    /* The backstop. Every path a person waits on catches where it fails and
       says so in the thread; this is for the ones nobody thought of. Without
       it a rejection that gets this far is a console line in a window that has
       no console — which is to say silence, and a button that did nothing. */
    window.addEventListener('unhandledrejection', (e) => {
      console.error('unhandled:', e && e.reason);
      /* Not askFailed: that names Patch, and this catches every chat. */
      toast(friendly(e && e.reason), 5200);
    });
  }
}

async function restoreChats () {
  try {
    const saved = await loadState();
    if (!saved) return;
    /* There is a file, and this build will not replace it. Three reasons, one
       outcome: the session runs, nothing is written, and both the rail and
       Settings say which. The alternative — opening empty and saving over it —
       is how a history gets deleted by a launch. */
    if (saved.readOnly) {
      toast({
        newer: 'Your chats were saved by a newer Pigeon, so this one will not change them.',
        unread: 'Your chats are on this Mac but could not be read, so Pigeon will not change them this session.',
        corrupt: 'Your chats file could not be read, and could not be moved aside — so Pigeon will not change it.'
      }[saved.why] || 'Your chats could not be read, so Pigeon will not change them.', 7000);
      paint();
      return;
    }
    /* Unreadable, and safely kept: the old file is still there under its own
       name, so this session starts a new one rather than a blank pretending
       nothing was lost. Saying where it went is the whole point — a file
       somebody can hand back is a history that is only mislaid. */
    if (saved.why === 'corrupt') {
      toast(`Your chats file could not be read. It is kept as “${saved.kept}” beside the new one.`, 8000);
      paint();
      return;
    }
    if (saved.settings) state.settings = saved.settings;
    if (!saved.chats.length) return;
    /* Chats saved before conversations could branch are flat lists; bring them
       up to the tree before anything renders them. A question that was still
       being answered when Pigeon closed comes back kept, and marked unanswered. */
    const interrupted = saved.chats.filter(c => c.inflight).length;
    state.chats = saved.chats.map(migrateChat).map(c => settleInterrupted(c, { uid }));
    state.activeChatId = saved.activeChatId;
    loadComposer();
    restoreDone = true;
    if (interrupted) persist();
    paint();
  } finally {
    restoreDone = true;
  }
}
