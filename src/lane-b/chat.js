/* chat.js — Lane B's whole reply path.
 *
 * One function, and what it does not touch is the point of it. It does not
 * import the registry, the router, the planner, the executor, a skill, the
 * plan validator, the reply builder or the fabrication audit — a lint fails
 * the build if it ever does (see src/lint-imports.js). It cannot run a skill,
 * so it cannot produce a value with provenance, so nothing it returns can
 * render as a marked number. That is not a rule the renderer applies; it is
 * the shape of what comes back from here.
 *
 * What comes back is a turn with `lane: 'B'` and a reply that is TEXT rather
 * than segments. Lane A's replies are a list of typed segments, each value
 * carrying where it came from. Lane B has no segments at all, and the bubble
 * that draws it is a different bubble in a different colour with a permanent
 * badge, so a person can tell which lane answered without reading a word.
 *
 * The model is reached through `complete`, injected rather than imported, so
 * every test in the suite runs this path against a stub with no server and no
 * window.
 */

import { needsHandoff, wantsANumber, HANDOFF_TEXT } from './handoff.js';

/** The one instruction that makes this lane safe to have. */
export const CHAT_SYSTEM =
  'You are the chat lane of Pigeon, a small offline assistant. You are talking with one person.\n\n' +
  'You may talk, explain, suggest, ask questions and keep someone company.\n\n' +
  'You may NOT work anything out. Arithmetic, dates, conversions, counts, measurements, ' +
  'unit changes and lookups belong to the verified lane of this app, where a tested function ' +
  'produces the value and the app shows where it came from. Nothing you write carries that ' +
  'guarantee, so a number from you would be a guess wearing the clothes of an answer.\n\n' +
  'Never state a figure you were not given. If what is being asked needs one — a total, a date, ' +
  'a duration, a conversion, a count — say plainly that working it out is not yours to do and ' +
  'that the verified lane can, then stop. Do not guess at it first and do not show your working.\n\n' +
  'Do not claim to have run anything, looked anything up, searched, or checked anything: ' +
  'you have no tools and nothing you say has been verified. Write plainly and briefly.';

/** How much of the conversation the model is shown. Long enough to hold a
 *  thread, short enough that an 8k context is not the thing that ends it. */
export const HISTORY_TURNS = 12;

/**
 * Build the message list from a conversation. Only Lane B turns contribute —
 * a Lane A answer in the same chat is a different kind of thing and its values
 * must not arrive here as text the model can copy — and a turn whose prose was
 * dropped by the handoff guard contributes the question only.
 */
/* Pen only, and only when asked for: the reply that was dropped for a figure
   nobody gave is asked for again, without figures. */
export const NO_AMOUNTS = 'Answer without giving any numbers, amounts, prices or figures. If the answer needs one, say that Patch can work it out.';

export function messagesFor (message, history = [], persona = null, { noAmounts = false } = {}) {
  let system = persona && persona.name
    ? `${CHAT_SYSTEM}\n\nYou are speaking as ${persona.name}. Stay in that voice; it does not change any rule above.`
    : CHAT_SYSTEM;
  if (noAmounts && !persona) system += `\n\n${NO_AMOUNTS}`;
  const out = [{ role: 'system', content: system }];
  /* The last back-and-forths of THIS lane. Filtered before counting, so a
     turn from another lane never takes one of the slots. A voice measured to
     hold up only with the newest message alone (shape B) is sent none of them;
     Rust enforces the same (chat.rs shaped). */
  const kept = persona && persona.shape === 'B' ? [] : history;
  /* `asked` is what a picture sent with nothing typed was asked as (Peek). */
  for (const turn of kept.filter(t => t && t.lane === 'B' && (t.message || t.asked)).slice(-HISTORY_TURNS)) {
    out.push({ role: 'user', content: String(turn.message || turn.asked) });
    const said = turn.handoff ? null : (turn.reply && turn.reply.text);
    if (said) out.push({ role: 'assistant', content: String(said) });
  }
  out.push({ role: 'user', content: String(message) });
  return out;
}

/**
 * The sentences of a reply that are whole so far. A sentence ends at . ! or ?
 * followed by a space or a line end, or at a blank line; the rest is still
 * being written and is not returned. Sentence-sized rather than word-sized on
 * purpose: the figure guard reads a sentence, not a syllable.
 */
export function wholeSentences (text) {
  const t = String(text ?? '');
  let end = 0;
  const re = /[.!?]["')\]]*(?=\s)|\n\s*\n/g;
  let m;
  while ((m = re.exec(t))) end = m.index + m[0].length;
  return t.slice(0, end).trimEnd();
}

/** The whole words of a reply so far: everything up to the last space or
 *  line end, so a word is never shown half-typed. */
export function wholeWords (text) {
  const t = String(text ?? '');
  const at = Math.max(t.lastIndexOf(' '), t.lastIndexOf('\n'));
  return at < 0 ? '' : t.slice(0, at).trimEnd();
}

/**
 * What of a reply may be shown while it is still being written. On a
 * question that wants no figure, every whole word, as it is typed. On one
 * that does, a whole sentence at a time: a sentence stating a number the
 * person did not supply is not shown, and nothing after it is either (the
 * whole reply is read again at the end, and is dropped then). So no sentence
 * with an untraced figure ever reaches the screen, early or late. Returns
 * the text to show, or null for nothing yet.
 */
export function showable (text, { asked = '', said = [], guarded = true } = {}) {
  if (!guarded || !wantsANumber(asked)) return wholeWords(text) || null;
  const whole = wholeSentences(text);
  if (!whole) return null;
  const parts = whole.split(/(?<=[.!?]["')\]]*)\s+|\n\s*\n/).filter(Boolean);
  const ok = [];
  for (const sentence of parts) {
    if (needsHandoff(sentence, { asked, said })) break;
    ok.push(sentence);
  }
  return ok.length ? ok.join(' ') : null;
}

/** Everything the person has typed in this conversation, which is the only
 *  thing that can license a number in the answer. */
function saidByThePerson (history) {
  return history.filter(t => t.lane === 'B' && t.message).map(t => String(t.message));
}

/**
 * One Lane B turn.
 *
 * `complete` is `({ messages, persona, maxTokens, temperature, seed }) => { text, ms, … }`.
 * Returns a turn; a failure is a turn too, because the thread has to render
 * something and "the chat model is asleep" is an answer a person can act on.
 */
export async function runChat (message, { history = [], persona = null, complete, onStage = null, onText = null, seed = null, noAmounts = false, continuing = null } = {}) {
  const msg = String(message ?? '').trim();
  const started = Date.now();
  const base = {
    lane: 'B', message: msg, mode: 'generated', persona: persona ? persona.id : null,
    ...(noAmounts && !persona ? { noAmounts: true } : {}),
    ...(continuing && continuing.id ? { continues: continuing.id } : {})
  };
  /* Keep going is an ordinary turn saying "Continue". What it must not do is
     slip a figure past the guard in two halves, so the guard reads the joined
     reply against the question that started it. */
  const asked = continuing ? String(continuing.message || msg) : msg;

  if (!msg) return { ...base, reply: null, error: 'nothing to say', ms: 0 };
  if (!complete) {
    return {
      ...base,
      reply: null,
      error: 'no model is awake to write with — wake the models, or ask Patch',
      ms: 0
    };
  }

  if (onStage) onStage('writing');
  /* The reply as it is written, a whole sentence at a time, each one past
     the guard before it is shown (`showable`). `onText` gets what may be on
     screen so far; the turn below is still built from the whole reply. */
  const said = saidByThePerson(history);
  let shown = null;
  const onPiece = onText ? (sofar) => {
    const next = showable(sofar, { asked, said });
    if (next && next !== shown) { shown = next; onText(next); }
  } : null;
  let out;
  try {
    out = await complete({
      messages: messagesFor(msg, history, persona, { noAmounts }),
      persona: persona ? persona.id : null,
      ...(onPiece ? { onPiece } : {}),
      /* With the engine on, Pen without figures is his own Pigeon. */
      ...(noAmounts && !persona ? { noAmounts: true } : {}),
      /* A fresh seed a turn: the same question asked twice should not come
         back word for word, and this lane has no cache to protect. A caller
         may pin it, and exactly one does: the paired persona check, where two
         replies that differ only because they were sampled differently would
         prove nothing about whether the adapter applied. */
      seed: seed === null ? Math.floor(Math.random() * 2 ** 31) : seed
    });
  } catch (e) {
    return { ...base, reply: null, error: String((e && e.message) || e), ms: Date.now() - started };
  }

  const text = String((out && out.text) || '').trim();
  if (!text) {
    return { ...base, reply: null, error: 'the chat model returned nothing', ms: Date.now() - started };
  }

  /* The guarantee. A number the person did not supply means the prose is not
     shown at all — §5.4 is zero tolerance, so this drops rather than warns. */
  /* `asked` is only ever what the person typed — never a quoted message, which
     is shown on the bubble and sent nowhere. */
  const joined = continuing && continuing.reply && continuing.reply.text ? `${continuing.reply.text}\n${text}` : text;
  const caught = needsHandoff(joined, { asked, said });
  return {
    ...base,
    reply: { source: 'generated', text: caught ? HANDOFF_TEXT : text },
    /* The question wanted a figure. Whether the model declined properly or the
       guard had to drop its answer, the way to get one is the same, so the
       offer is shown either way. */
    offer: wantsANumber(asked),
    /* What was dropped is kept, unshown, the way ocr.js keeps a tidy the audit
       rejected: the trace can say what the model tried to say. */
    handoff: caught ? { ...caught, dropped: text } : null,
    ms: Date.now() - started,
    tokens: (out && out.tokens) || 0,
    promptTokens: (out && out.promptTokens) || 0,
    finishReason: (out && out.finishReason) || null
  };
}

/**
 * One turn with a model as it comes — Peek. No instruction of the app's and
 * no guard on figures: it answers the way the picture model answers, a count
 * or a price off the picture included, and the reply is still drawn as
 * written by a model and checked by nothing. The chat's own back-and-forths
 * go with it, as Pen's do.
 *
 * `complete` is the same injected bridge `runChat` takes.
 */
export async function runPlain (message, { history = [], complete, onStage = null, onText = null, seed = null } = {}) {
  const msg = String(message ?? '').trim();
  const started = Date.now();
  const base = { lane: 'B', message: msg, mode: 'generated', persona: null, plain: true };
  if (!msg) return { ...base, reply: null, error: 'nothing to say', ms: 0 };
  if (!complete) return { ...base, reply: null, error: 'no model is awake to write with', ms: 0 };
  const messages = [];
  for (const turn of history.filter(t => t && t.lane === 'B' && (t.message || t.asked)).slice(-HISTORY_TURNS)) {
    messages.push({ role: 'user', content: String(turn.message || turn.asked) });
    const said = turn.reply && turn.reply.text;
    if (said) messages.push({ role: 'assistant', content: String(said) });
  }
  messages.push({ role: 'user', content: msg });
  if (onStage) onStage('writing');
  /* No guard here, so every whole sentence is shown as it ends. */
  let shown = null;
  const onPiece = onText ? (sofar) => {
    const next = showable(sofar, { guarded: false });
    if (next && next !== shown) { shown = next; onText(next); }
  } : null;
  let out;
  try {
    out = await complete({ messages, persona: null, seed: seed === null ? Math.floor(Math.random() * 2 ** 31) : seed, ...(onPiece ? { onPiece } : {}) });
  } catch (e) {
    return { ...base, reply: null, error: String((e && e.message) || e), ms: Date.now() - started };
  }
  const text = String((out && out.text) || '').trim();
  if (!text) return { ...base, reply: null, error: 'the model returned nothing', ms: Date.now() - started };
  return {
    ...base,
    reply: { source: 'generated', text },
    ms: Date.now() - started,
    tokens: (out && out.tokens) || 0,
    promptTokens: (out && out.promptTokens) || 0,
    finishReason: (out && out.finishReason) || null
  };
}
