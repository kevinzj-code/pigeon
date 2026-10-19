/* notes.js — the soft notes above the composer before a message goes.
 *
 * Some Pigeons start fresh with every message: Patch plans each one on its own,
 * and a one-shot Pigeon was trained on a single input with no history. Someone
 * used to texting sends "shorter please" as a follow-up and gets a title for the
 * words "shorter please". These notes catch that moment, say what will actually
 * happen, and offer the moves that work.
 *
 * Three rules every note keeps, and the suite checks:
 *   · no model is involved — the page decides from the words alone;
 *   · a note never changes, deletes or blocks what was typed — it returns no
 *     text to send, only something to say and buttons to offer;
 *   · after two "Send anyway"s in a chat the soft notes stop for that chat.
 * The length note is not soft: it states a limit, and its one button sends a
 * visible first part and leaves the rest in the box.
 *
 * Plain strings and no DOM, so the test suite can import it.
 */

import { esc } from './html.js';

export const NOTE_SKIP_LIMIT = 2;

/** A note, drawn above the composer: what will happen, and buttons for the
 *  moves that work. A button acts; none carries text to send. */
export function noteHtml (note) {
  if (!note) return '';
  return `<div class="note"><span>${esc(note.text)}</span><div class="note-btns">${note.buttons.map(b =>
    `<button class="btn-verb${b.act === 'send-anyway' ? ' soft' : ''}" data-do="note-${esc(b.act)}"${b.frame ? ` data-frame="${esc(b.frame)}"` : ''}>${esc(b.label)}</button>`).join('')}</div></div>`;
}
export const PEN_WORD_LIMIT = 4000;

const words = (s) => String(s || '').trim().split(/\s+/).filter(Boolean);
const short = (s, n = 32) => { const t = String(s || '').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const anyway = { act: 'send-anyway', label: 'Send anyway' };

const PATCH_OPENERS = /^(what about|and\b|how about|same but|what if|in (euros|dollars|pounds|km|miles))/i;
const FOLLOW_UP = /\b(shorter|longer|snappier|another one|again|different|thanks|thank you|the second one|too long|too short)\b/i;
const GREETING = /^(hi|hello|hey|hiya|yo|thanks|thank you)\b/i;

/**
 * Before a follow-up to Patch. Only after a worked-out answer, for a short
 * message that opens like a follow-up or has no number in it.
 */
export function patchFollowUpNote ({ lastWasWorked = false, text = '', noteSkips = 0 } = {}) {
  const t = String(text).trim();
  if (!t || !lastWasWorked || noteSkips >= NOTE_SKIP_LIMIT) return null;
  if (words(t).length > 6) return null;
  if (!PATCH_OPENERS.test(t) && /\d/.test(t)) return null;
  return {
    kind: 'patch-follow-up',
    text: `Patch doesn’t carry figures from earlier messages, so “${short(t)}” will be read on its own.`,
    buttons: [{ act: 'edit-last', label: 'Change your last message' }, anyway]
  };
}

/**
 * Before a message to a Pigeon that starts fresh each time.
 *   pigeon: { name, noun ('title', 'label'…), drawing, inputMax }
 *   prevText: the last message sent in this chat, if any
 *   penAvailable: whether Pen is installed to take the idea
 */
export function oneShotNote ({ pigeon = {}, text = '', prevText = '', noteSkips = 0, penAvailable = false } = {}) {
  const t = String(text).trim();
  if (!t || noteSkips >= NOTE_SKIP_LIMIT) return null;
  const name = pigeon.name || 'This Pigeon';
  const noun = pigeon.drawing ? 'drawing' : (pigeon.noun || 'answer');
  const own = `“${short(t)}” would get a${/^[aeiou]/i.test(noun) ? 'n' : ''} ${noun} of its own.`;
  const w = words(t);

  if (GREETING.test(t) && w.length <= 3) {
    return { kind: 'greeting', text: own, buttons: [{ act: 'show-page', label: 'Show what it does' }, anyway] };
  }

  if (prevText) {
    const prev = new Set(words(prevText.toLowerCase()).map(x => x.replace(/\W/g, '')).filter(x => x.length > 2));
    const shares = w.some(x => prev.has(x.toLowerCase().replace(/\W/g, '')));
    if (FOLLOW_UP.test(t) || (w.length <= 2 && !shares)) {
      const phrase = /shorter/i.test(t) ? `a shorter ${noun}` : /snappier/i.test(t) ? `a snappier ${noun}` : /longer/i.test(t) ? `a longer ${noun}` : `another ${noun}`;
      const buttons = [{ act: 'edit-last', label: `Edit “${short(prevText, 28)}”` }];
      if (penAvailable && !pigeon.drawing) {
        buttons.push({ act: 'ask-pen', label: `Ask Pen for ${phrase}`, frame: `Give me ${phrase} for: ${prevText.trim()}` });
      }
      buttons.push(anyway);
      return { kind: 'follow-up', text: `${name} doesn’t see earlier messages. ${own}`, buttons };
    }
  }

  if (Number.isInteger(pigeon.inputMax) && w.length > pigeon.inputMax) {
    return {
      kind: 'long',
      text: `This is longer than anything ${name} was tested on (up to ${pigeon.inputMax} words), so it may answer oddly.`,
      buttons: [anyway]
    };
  }
  return null;
}

/** Before a message too long for Pen or a voice to read at once. */
/** An input well past the longest its maker tested it on (card
 *  `input_stats.words.p95`): said once, and never blocking. */
export function testedLengthNote ({ name = 'This Pigeon', text = '', p95 = null, noteSkips = 0 } = {}) {
  if (!Number.isFinite(p95) || p95 <= 0 || noteSkips >= NOTE_SKIP_LIMIT) return null;
  const n = words(text).length;
  if (n <= Math.max(p95 * 2, p95 + 50)) return null;
  return {
    kind: 'tested-length',
    text: `This is about ${n.toLocaleString('en-GB')} words. ${name} was tested on inputs up to about ${Math.round(p95).toLocaleString('en-GB')}, so its answer may be less reliable.`,
    buttons: [anyway]
  };
}

export function lengthNote ({ name = 'Pen', text = '', limitWords = PEN_WORD_LIMIT } = {}) {
  const n = words(text).length;
  if (n <= limitWords) return null;
  return {
    kind: 'length',
    text: `${name} can read about ${limitWords.toLocaleString('en-GB')} words at once, and this is about ${Math.round(n / 100) * 100 || n}.`,
    buttons: [{ act: 'send-first-part', label: 'Send the first part' }]
  };
}
