/* chats.js — the conversations as a list, and the rules for filing into them.
 *
 * A reply is filed into the conversation it was ASKED in, found by id. It used
 * to go into whichever conversation happened to be open when the answer landed,
 * which put a reply in the wrong chat whenever you switched while one was
 * coming — and, because that chat did not contain the question the reply hung
 * off, `linkTurn` fell through to making the reply the ROOT and hid everything
 * that chat had in it.
 *
 * So a question in flight is recorded on its own chat (`chat.inflight`): the
 * reply finds its way home by id, a second question in the same chat is refused
 * rather than racing the first, and a Pigeon that quits mid-reply comes back
 * with the question kept and marked unanswered instead of losing what you asked.
 *
 * No DOM, so the test suite can import it.
 */

import { chatNodes, pathOf, linkTurn, replaceTurn } from './thread.js';
import { titleFrom, REACTIONS } from './store.js';

export { REACTIONS };

const rid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export const INTERRUPTED = 'Pigeon closed before this was answered.';

export const chatById = (chats, id) => (Array.isArray(chats) ? chats.find(c => c && c.id === id) : null) || null;

/* When a conversation last had something happen in it: a question sent or a
   reply filed. Opening a chat is not activity, so reading an old conversation
   does not move it to the top of the list. */
export function lastActivity (c) {
  return Number(c && c.lastActivityAt) || Number(c && c.updatedAt) || Number(c && c.createdAt) || 0;
}
export function touchActivity (c, at = Date.now()) {
  if (c) c.lastActivityAt = at;
  return c;
}
export const byActivity = (chats) => [...(chats || [])].sort((a, b) => lastActivity(b) - lastActivity(a));

/* A conversation is named once, from what was first asked, and a name a person
   chose is never overwritten. A chat that opened with an image is named by what
   was asked about it, not by the first line the engine read. */
export function nameChat (c) {
  if (!c || c.renamed || c.title !== 'New chat') return c;
  const first = pathOf(c)[0];
  if (first) c.title = titleFrom(first.image ? (first.image.typed || first.message) : first.message);
  return c;
}

/* Nothing asked yet and nothing on its way. A chat whose first question is still
   being answered has no turns but is not empty, and must not be reused as a
   blank or converted to another Pigeon. */
export const isEmpty = (c) => !Object.keys(chatNodes(c)).length && !c.inflight;

/* Something typed, an image read or a transcript offered, and not yet sent. */
export const hasDraft = (c) => Boolean(c && c.draft && (c.draft.text || c.draft.attachment || c.draft.transcript));

/* Pinned chats sit above the list in the order they were pinned; alerts are
   per chat; unread is a count so a chat that got two replies while you were
   away can say so. */
export function togglePin (c, now = Date.now()) {
  c.pinnedAt = c.pinnedAt ? null : now;
  return c;
}
export function toggleMute (c) {
  c.muted = !c.muted;
  return c;
}
export function markUnread (c, unread = true) {
  c.unread = unread ? Math.max(1, c.unread || 0) : 0;
  return c;
}

/**
 * Search, the way a messaging app's does: Pigeons by name, chats by title, and
 * the words inside messages — both what you asked and what came back. Only the
 * versions on show are searched, so a hit always opens onto something visible.
 */
export function searchAll (chats, pigeons, q, { textOf = () => '', limit = 30, dayWordsOf = null, nameOf = null } = {}) {
  const needle = String(q || '').trim().toLowerCase();
  if (!needle) return { pigeons: [], chats: [], messages: [] };
  const sorted = byActivity(chats);
  /* A chat also matches when every word typed is in its title, the name of who
     it is with, or the day it happened on — how a person remembers it. */
  const tokens = needle.split(/\s+/).filter(Boolean);
  const about = (c) => [c.title || '', nameOf ? nameOf(c) : '', ...(dayWordsOf ? dayWordsOf(c) : [])].join(' ').toLowerCase();
  const chatHit = (c) => String(c.title || '').toLowerCase().includes(needle) || ((dayWordsOf || nameOf) && tokens.every(t => about(c).includes(t)));
  const messages = [];
  outer: for (const c of sorted) {
    for (const t of pathOf(c)) {
      for (const [who, text] of [['you', t.message || ''], ['pigeon', textOf(t) || '']]) {
        if (String(text).toLowerCase().includes(needle)) {
          messages.push({ chatId: c.id, turnId: t.id, who, text: String(text) });
          if (messages.length >= limit) break outer;
          break;
        }
      }
    }
  }
  return {
    pigeons: (pigeons || []).filter(p => String(p.name).toLowerCase().includes(needle)),
    chats: sorted.filter(chatHit),
    messages
  };
}

/** The newest turn on show that ran something, for the pipeline's `prev`. */
export function lastCompletedIn (c) {
  const path = c ? pathOf(c) : [];
  for (let i = path.length - 1; i >= 0; i--) if (path[i].results && path[i].results.length) return path[i];
  return null;
}

/** Record a question as being answered in this chat. */
export function startInflight (c, { message, image = null, handedFrom = null, lane = 'A', parentId = null, pendingAskId = null, stage = '', sentAt = Date.now() } = {}) {
  c.inflight = {
    /* Which wait this is. A reply that comes back after Stop, or after a
       later send took the chat over, carries a stale token and is dropped. */
    token: (c.inflightSeq = (c.inflightSeq || 0) + 1),
    message: String(message ?? ''),
    image: image || null,
    handedFrom: handedFrom || null,
    lane: lane === 'B' ? 'B' : 'A',
    parentId: parentId ?? null,
    pendingAskId: pendingAskId ?? null,
    stage,
    sentAt,
    /* A question that starts with a stage — a model already writing — was
       started on the moment it was sent. Anything else waits for its first
       stage (markRead). */
    readAt: stage ? sentAt : null
  };
  touchActivity(c, sentAt);
  return c.inflight;
}

/* "Read" is when Pigeon started working on a question — its first real stage —
   not when it was sent. True the first time only, so Delivered turns into Read
   exactly once. */
export function markRead (c, at = Date.now()) {
  if (!c || !c.inflight || c.inflight.readAt) return false;
  c.inflight.readAt = at;
  return true;
}

/* Tapbacks, on your question ('q') or the reply ('a'); the same one again takes
   it off. A reaction goes nowhere: lane-b/chat.js builds a model's history from
   the question and the reply's text alone, so reacting 👎 to an answer cannot
   steer the next one. */
export function setReaction (c, turnId, which, emoji) {
  const t = chatNodes(c)[turnId];
  if (!t || (which !== 'q' && which !== 'a')) return null;
  const r = { ...(t.reactions || {}) };
  if (r[which] === emoji || !REACTIONS.includes(emoji)) delete r[which];
  else r[which] = emoji;
  if (Object.keys(r).length) t.reactions = r;
  else delete t.reactions;
  return t.reactions || null;
}

/**
 * Where a forwarded question goes: a chat of its own with the Pigeon it was
 * forwarded to — an untouched blank if there is one, otherwise a new chat from
 * `make`. Never the chat it came from, even an empty one, and never a blank
 * holding somebody's draft.
 */
export function forwardTarget (chats, sourceId, { lane = 'A', personaId = null } = {}, make) {
  const c = (chats || []).find(x => x.id !== sourceId && isEmpty(x) && !hasDraft(x)) || make();
  c.lane = lane === 'B' ? 'B' : 'A';
  c.personaId = c.lane === 'B' ? (personaId ?? null) : null;
  return c;
}

/* Where a forwarded question came from, as its bubble says it. */
export function forwardedFrom (source, turn, fromName, at = Date.now()) {
  return { chatId: source.id, title: source.title, from: fromName, turnId: turn.id, at };
}

/* Where a reply hangs. A parent that has vanished from the tree must not make
   the reply the root — that is what hid a conversation's history — so it goes
   under the last turn on show instead. Null is a real answer: the first question
   in a chat, or a new version of it. */
function parentFor (c, parentId) {
  if (parentId == null) return null;
  const nodes = chatNodes(c);
  if (nodes[parentId]) return parentId;
  const path = pathOf(c);
  return path.length ? path[path.length - 1].id : null;
}

/**
 * File a finished turn into the chat it was asked in.
 * Returns `{ chat, turn, filed }`; `filed` is false when that chat was deleted
 * while the answer was on its way, and nothing is changed.
 */
export function fileReply (chats, chatId, turn, { uid = rid, now = Date.now() } = {}) {
  const c = chatById(chats, chatId);
  if (!c) return { chat: null, turn, filed: false };
  const f = c.inflight || {};
  turn.id = turn.id || uid();
  /* Stamped with when it was ASKED, so ‹ 1/2 › orders versions by the order you
     asked them in rather than the order the answers happened to come back. */
  turn.at = turn.at || f.sentAt || now;
  /* Asked, read, replied: the three times a message's info can honestly give. */
  turn.readAt = turn.readAt || f.readAt || null;
  turn.repliedAt = turn.repliedAt || now;
  if (f.pendingAskId && chatNodes(c)[f.pendingAskId]) replaceTurn(c, f.pendingAskId, turn);
  else linkTurn(c, turn, parentFor(c, f.parentId ?? null));
  c.inflight = null;
  touchActivity(c, now);
  nameChat(c);
  return { chat: c, turn, filed: true };
}

/**
 * A question still marked in flight when the chats were loaded: Pigeon closed
 * before it was answered. It becomes a turn that keeps the question exactly as
 * it was asked and says what happened, so asking again is one click and nothing
 * typed is lost.
 */
export function settleInterrupted (c, { uid = rid } = {}) {
  if (!c || !c.inflight) return c;
  const f = c.inflight;
  c.inflight = null;
  if (!f.message) return c;
  const turn = {
    id: uid(),
    at: f.sentAt || Date.now(),
    lane: f.lane === 'B' ? 'B' : 'A',
    message: f.message,
    interrupted: true,
    error: INTERRUPTED,
    reply: null,
    results: []
  };
  if (f.image) turn.image = f.image;
  if (f.handedFrom) turn.handedFrom = f.handedFrom;
  linkTurn(c, turn, parentFor(c, f.parentId ?? null));
  nameChat(c);
  return c;
}
