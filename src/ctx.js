/* ctx.js — §2.5 "harness owns context".
 *
 * now, timezone, locale and units come from the device. The model never
 * supplies them and never overrides them; mergeInput() below is the single
 * place that guarantees the direction of that flow.
 *
 * `now` is an ISO string rather than a Date so a plan is reproducible: the
 * same plan JSON plus the same ctx replays to the same numbers, which is what
 * makes the test suite meaningful and what lets "Show plan" be an honest
 * record rather than a re-run. */

import { CTX_OWNED_FIELDS } from './contracts.js';

export function deviceCtx (overrides = {}) {
  const tz = (() => {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; }
    catch { return 'UTC'; }
  })();
  const locale = (() => {
    try { return (typeof navigator !== 'undefined' && navigator.language) || Intl.DateTimeFormat().resolvedOptions().locale || 'en-GB'; }
    catch { return 'en-GB'; }
  })();
  return {
    now: new Date().toISOString(),
    timezone: tz,
    locale,
    /* Imperial locales are a short list and this is a default, not a claim.
       The user can flip it; the model cannot. */
    units: /^en-(US|LR|MM)\b/i.test(locale) ? 'imperial' : 'metric',
    /* Web skills now ship, so this is a real switch rather than a placeholder —
       and it still starts OFF. The app is called Airoplane Mode: the web being
       reachable is not the same as the web being wanted, and the default should
       be the one that sends nothing. The user flips it in the chat header; the
       model cannot, because ctx is not the model's to write (see mergeInput). */
    webEnabled: false,
    confirmBeforeNetwork: true,
    ...overrides
  };
}

/** §4.2 — ctx wins. Always. This is the whole of principle 5 in one function. */
export function mergeInput (input, ctx) {
  const merged = { ...input };
  for (const f of CTX_OWNED_FIELDS) {
    if (ctx[f] !== undefined) merged[f] = ctx[f];
  }
  return merged;
}
