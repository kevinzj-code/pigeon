/* status.js — the line under your newest message, where a messaging app says
 * "Delivered".
 *
 * Pigeon used to put "Delivered" there and then "Read", with "Read" redefined in
 * a tooltip to mean "started working on it" — which nobody reading a chat would
 * guess. The slot now says what is actually true: waiting behind another
 * message, waiting on your answer, the models waking, a new Pigeon loading, or
 * that your question went to the web, with when.
 *
 * A countdown is an estimate taken from the last time this Mac did the same
 * thing, so it never reaches zero: it stops at "about 2 s", and once the
 * estimate has clearly passed it says so rather than sitting on a number.
 *
 * Plain strings and no DOM, so the test suite can import it.
 */

import { hm } from './html.js';

export const WAKE_FALLBACK_S = 14;
export const RESTART_FALLBACK_S = 25;
export const TAKING_LONGER = 'Taking longer than usual…';
/* How long past its estimate "about 2 s" is still the honest thing to say. */
const GRACE_S = 10;

/**
 * "about 14 s", counting down from an expected duration; "about 2 s" at the
 * end; TAKING_LONGER once the estimate is well past.
 */
export function etaText (expectedMs, startedAt, now = Date.now()) {
  const expected = expectedMs / 1000;
  const elapsed = Math.max(0, (now - startedAt) / 1000);
  const left = Math.ceil(expected - elapsed);
  if (left > 2) return `about ${left} s`;
  if (elapsed <= expected + GRACE_S) return 'about 2 s';
  return TAKING_LONGER;
}

const plausible = (ms) => Number.isFinite(ms) && ms >= 1000 && ms <= 180000;

/** A wake countdown from the last measured wake, else the usual 14 s. */
export const wakeEta = (lastWakeMs, startedAt, now = Date.now()) =>
  etaText(plausible(lastWakeMs) ? lastWakeMs : WAKE_FALLBACK_S * 1000, startedAt, now);

/** A countdown for loading a newly added Pigeon, else the usual 25 s. */
export const restartEta = (lastRestartMs, startedAt, now = Date.now()) =>
  etaText(plausible(lastRestartMs) ? lastRestartMs : RESTART_FALLBACK_S * 1000, startedAt, now);

const withEta = (lead, eta) => (!eta ? lead : eta === TAKING_LONGER ? TAKING_LONGER : `${lead} · ${eta}`);

/**
 * The status line itself.
 *   state: 'queued' | 'held' | 'waking' | 'restarting' | 'behind' |
 *          'models-restarting' | 'sent-web' | anything else (nothing to say)
 *   name:    who is waking or loading
 *   askName: who is waiting on an answer
 *   eta:     from wakeEta / restartEta
 *   at:      when a look-up was sent
 */
export function statusLine ({ state, name = '', askName = 'Patch', eta = '', at = null } = {}) {
  switch (state) {
    case 'queued': return 'Waiting';
    case 'held': return `Waiting for your answer to ${askName}`;
    case 'waking': return withEta(`Waking ${name}`, eta);
    case 'restarting': return withEta(`Getting ${name} ready`, eta);
    case 'behind': return eta === TAKING_LONGER ? TAKING_LONGER : `Waiting for another reply to finish${eta ? `, then ${eta}` : ''}`;
    case 'models-restarting': return withEta('Waiting for Pigeon’s models to restart', eta);
    case 'sent-web': return at ? `Sent to DuckDuckGo and Wikipedia · ${hm(at)}` : 'Sent to DuckDuckGo and Wikipedia';
    default: return '';
  }
}
