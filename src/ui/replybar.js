/* replybar.js — Reply, and where a writer's memory ends.
 *
 * Reply quotes a message into the next one, the way every messaging app does,
 * and the bar above the composer says what the Pigeon will actually see — which
 * is not the same for everyone. Patch plans each message on its own, so a quote
 * does not carry his figures over yet. A one-shot Pigeon only ever sees what is
 * typed. Pen sees the recent back-and-forths, and says so when the quoted
 * message is older than that. The quote is shown to you; it is never added to
 * what a Pigeon is sent.
 *
 * Strings only, no DOM, so the test suite can draw them.
 */

import { esc, ICONS } from './html.js';

const clip = (s, n = 90) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

/** The index of the oldest turn a writer can still see, or -1 when it sees them all. */
export const memoryEdgeIndex = (path = [], turns = 12) => (path.length > turns ? path.length - turns : -1);

/** The line drawn above that turn. Nothing above it is dimmed or removed. */
export const memoryEdgeHtml = (name) => `<div class="mem-edge"><span>${esc(name)} can’t see above this line · everything is still saved</span></div>`;

/** The quote on a message that was sent as a reply. */
export const quoteStripHtml = (q) => `<span class="q-strip">↩ ${esc(q.who)}: ${esc(clip(q.text, 70))}</span>`;

/**
 * The bar above the composer while replying.
 *   q: { id, who, text, question } — the quoted turn, as shown
 *   kind: 'verified' | 'base' | 'voice' | 'job'
 *   aboveEdge: the quoted turn is older than what a writer can see
 */
export function quoteBarHtml (q, { name = 'Pigeon', kind = '', aboveEdge = false, turns = 12 } = {}) {
  let say;
  let extra = '';
  if (kind === 'verified') {
    say = '<strong>Patch won’t carry these figures over yet.</strong> Type the ones you need.';
  } else if (kind === 'job') {
    say = `<strong>${esc(name)} only sees what you type below, not this quote.</strong>`;
    extra = `<button class="btn-verb soft" data-do="edit-quoted" data-turn="${esc(q.id)}">Edit “${esc(clip(q.question, 30))}”</button>`;
  } else {
    say = aboveEdge
      ? `<strong>${esc(name)} can’t see this one any more.</strong> Paste what you need.`
      : `${esc(name)} sees the last ${turns} back-and-forths.`;
  }
  return `<div class="rbar quote"><span class="rbar-q"><b>↩ ${esc(q.who)}:</b> ${esc(clip(q.text))}<small>${say}</small>${extra}</span>` +
    `<button class="rbar-x" data-do="cancel-quote" aria-label="Don’t quote this" title="Don’t quote this">${ICONS.x}</button></div>`;
}
