/* queue.js — messages sent while a chat is still busy.
 *
 * Pigeon used to refuse a second message with "Wait for this reply to finish".
 * Nobody texting a friend waits: they send twice. So a message sent while a
 * reply is on its way joins the chat's queue and goes when the chat is free.
 *
 * The one rule that needs care is a question Patch asked. While it is open, a
 * message that was already queued must never be taken as its answer — a new
 * topic swallowed as "the bill" is exactly the confident wrong answer Pigeon
 * exists to avoid. So the queue holds until the question is answered (through
 * the reply bar, which never goes through here) or skipped.
 *
 * Queued messages are saved with the chat. After a relaunch they wait to be
 * sent again rather than going by themselves: a message sent hours ago should
 * not suddenly be asked.
 *
 * No DOM, so the test suite can import it.
 */

import { pendingAsk } from './thread.js';

const rid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

/** The question this chat is waiting on, unless the person skipped it. */
export function askOpen (c) {
  const a = c ? pendingAsk(c) : null;
  return a && !(c.askSkipped || {})[a.id] ? a : null;
}

/** Add a message to the end of the queue. Blank text is not a message. */
export function enqueue (c, { text, source = 'typed', quoteId = null, sentAt = Date.now() } = {}, { uid = rid } = {}) {
  if (!c || typeof text !== 'string' || !text.trim()) return null;
  c.queue = Array.isArray(c.queue) ? c.queue : [];
  const item = { id: uid(), text, source: source === 'person-confirmed' ? source : 'typed', quoteId: quoteId ?? null, sentAt };
  c.queue.push(item);
  return item;
}

/** The message that may go next, or null: nothing queued, a reply still on its
 *  way, or a question of Patch's still open. */
export function next (c) {
  if (!c || !Array.isArray(c.queue) || !c.queue.length) return null;
  if (c.inflight) return null;
  if (askOpen(c)) return null;
  return c.queue[0];
}

/** Take the next message off the queue, if one may go. */
export function take (c) {
  const n = next(c);
  if (n) c.queue.shift();
  return n;
}

/** Remove one queued message — deleting it before it went. */
export function drop (c, id) {
  if (!c || !Array.isArray(c.queue)) return false;
  const before = c.queue.length;
  c.queue = c.queue.filter(m => m.id !== id);
  return c.queue.length < before;
}

/** Skip the open question. The queue is free to move, and the next message is
 *  a new question, not an answer. */
export function skipAsk (c) {
  const a = askOpen(c);
  if (!a) return false;
  c.askSkipped = { ...(c.askSkipped || {}), [a.id]: true };
  return true;
}
