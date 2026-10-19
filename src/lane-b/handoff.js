/* handoff.js — the rule that a persona cannot compute.
 *
 * Lane B is the one place in Pigeon where a model writes the words a person
 * reads. It may talk; it may not work anything out. The spec's bar is zero
 * tolerance: a Lane B message that states a computed number is a shipped bug,
 * not a rough edge.
 *
 * Two things enforce that, and only the second one is a guarantee. The system
 * prompt asks the model to hand a numeric question over rather than answer it,
 * and models mostly comply. This file is what happens when it does not: the
 * reply is read for numbers the person did not supply, and if any are found
 * the PROSE IS DROPPED — not annotated, not warned about, dropped — and the
 * turn renders a fixed sentence written here plus the offer to hand the
 * question to the verified lane.
 *
 * Deliberately NOT imported from fabrication.js, though that file does
 * something similar for Lane A. §5.1 of the spec forbids a shared code path
 * between this lane and the audit, and a lint enforces it. The two are alike
 * because the problem is alike, not because they are the same mechanism: the
 * Lane A audit decides whether a TEMPLATE may render, and it has skill results
 * to trace numbers to. This one has only what the person typed.
 *
 * WHEN it applies, and why that is not "always". The first version of this
 * dropped any reply containing a number the person had not typed, and the
 * first real question in the chat lane — "my recursive flatten keeps blowing
 * the stack" — came back as a numbered list of steps, so the guard ate a
 * perfectly good answer over the "1." at the start of a line. A guard that
 * fires on ordinary prose gets switched off, and then it guards nothing.
 *
 * So it fires on the case the spec actually names: §5.4 says "if a Lane B
 * conversation NEEDS a number". The question is what makes a number an answer.
 * Ask something quantitative — how many, how long, convert this, what is 88 kg
 * in pounds — and any figure in the reply the person did not supply is a
 * computed value with no provenance, and the prose goes. Ask something a
 * person asks a person, and a "1." in a list is a list.
 *
 * That is a narrower promise than "no number ever appears in Lane B", and it
 * is the one worth keeping: the badge on every generated reply already says
 * nothing here is computed, and this stops the specific thing a reader would
 * otherwise mistake for an answer.
 *
 * What counts as a number, and what does not:
 *
 *   Digits count, in every shape they arrive in — 194, 1,240, 3.5, 40%, 14th,
 *   09:30, 2026-10-14. Separators and suffixes are stripped so "1,240" and
 *   "1240" are the same number, and a model cannot get a value past by
 *   punctuating it differently.
 *
 *   List markers do not. A digit that opens a line and is followed by a dot or
 *   a bracket is structure, not a quantity.
 *
 *   Code does not. Anything in backticks or a fenced block is something to
 *   read, not a figure being asserted — `arr[0]` and `n - 1` are not claims
 *   about the world.
 *
 *   Spelled numbers count, including the small ones. They did not at first:
 *   the worry was that "in one sentence" would fire the guard on every other
 *   reply. Then the adversarial bench measured it — 40 quantitative questions,
 *   and two answers reached the reader with the figure written as a word
 *   ("there is one edit between them") — so the hole was real rather than
 *   theoretical and is closed. What makes that safe is that this only runs on
 *   a question whose answer IS a figure: in that context "one" is an answer
 *   far more often than a turn of speech, and the handful of phrases where it
 *   is not — one of, no one, one another — are excluded by name.
 *
 * Only what the PERSON wrote can license a number. Not the model's own earlier
 * replies: a number that slipped through once must not become the licence for
 * repeating it.
 */

const SCALES = ['hundred', 'hundreds', 'thousand', 'thousands', 'million', 'millions', 'billion', 'billions'];
const WORDS = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen',
  'nineteen', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety',
  ...SCALES, 'and', 'a'
];
const WORDS_RE = new RegExp(`\\b(?:${WORDS.join('|')})(?:[\\s-]+(?:${WORDS.join('|')}))*\\b`, 'g');

/* A run of digits with the punctuation a number wears: thousands separators,
   a decimal point, a trailing ordinal suffix or percent sign. */
const DIGITS = /\d[\d,._:/-]*\d|\d/g;

/* Fenced blocks and inline spans: code, not claims. */
const CODE = /```[\s\S]*?```|`[^`\n]*`/g;
/* "1." or "2)" at the start of a line: structure, not a quantity. */
const LIST_MARKER = /^[\s>*-]*\d+[.)]\s/gm;

/** The parts of a reply that could be asserting a figure. */
function claimable (text) {
  return String(text ?? '').replace(CODE, ' ').replace(LIST_MARKER, ' ');
}

/* What makes a question one whose answer IS a number. Deliberately lexical and
   deliberately this app's own: Lane B cannot ask the router, and should not —
   the router's job is picking a skill, and this only has to recognise the
   shape of a question whose answer would be a figure. */
const QUANTITATIVE = [
  /\bhow (?:many|much|long|far|old|big|tall|heavy|deep|wide|fast)\b/,
  /\b(?:convert|calculate|compute|work out|add up|divide|multiply|subtract)\b/,
  /\b(?:total|subtotal|sum|average|mean|median|percentage|per cent|percent)\b/,
  /\b(?:days|weeks|months|years|hours|minutes)\s+(?:until|till|to|since|between|from)\b/,
  /\bwhat(?:'s| is| are)\s+[^?]*\b(?:in|to)\s+(?:kg|kilos?|lbs?|pounds?|miles?|km|kilometres?|kilometers?|metres?|meters?|feet|foot|inches|inch|celsius|fahrenheit|litres?|liters?|gallons?|ounces?|grams?|stone|euros?|dollars?|pounds sterling)\b/,
  /\bhow\s+(?:many|much)\b|\bwhat\s+(?:date|time|day)\b/,
  /* "when does the 14 day cooling off period end": a date, asked without the
     word "date". Measured leaking through Pen with the first turn in view
     (lanebbench --shape A, 2026-09-16: "ends on the 17th"). */
  /\bwhen\s+(?:does|do|did|will|would|is|was|should)\b[^?]*\b(?:end|ends|expire|expires|finish|finishes|start|starts|begin|begins|due|run out|runs out|renew|renews|close|closes|arrive|arrives)\b/,
  /\b(?:split|share|divide)\b[^?]*\b(?:ways?|between|among|each)\b/,
  /\b(?:tip|discount|interest|tax|vat)\b/,
  /[£$€¥]\s*\d|\d\s*%/,
  /\d+\.\d/,
  /\d\s*(?:kg|kilos?|lbs?|miles?|km|cm|mm|ml|litres?|liters?|°c|°f|celsius|fahrenheit|grams?|oz|ft|inches?)\b/i
];

/**
 * Does this question want a figure for an answer? The guard below only applies
 * when it does — see the header for why "always" was the wrong answer.
 */
export function wantsANumber (text) {
  const s = String(text ?? '').toLowerCase();
  return QUANTITATIVE.some(re => re.test(s));
}

/* Number words as a person writes an answer, and the phrases where "one" is
   not a quantity at all. Only consulted for a question that wants a figure. */
const SPELLED = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen',
  'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety', 'hundred', 'thousand',
  'million', 'billion', 'half', 'quarter', 'third'];
const SPELLED_RE = new RegExp(`\\b(?:${SPELLED.join('|')})\\b`, 'g');
const NOT_A_QUANTITY = /\b(?:one of|no one|one another|for one|one by one|in one go|one thing|the one|someone|anyone|everyone|no-one)\b/g;

/**
 * Numbers written as words. Separate from `numeralsIn` because it is only
 * consulted when the question wants a figure — see the header.
 */
export function spelledNumbersIn (text) {
  const s = claimable(text).toLowerCase().replace(NOT_A_QUANTITY, ' ');
  return new Set(s.match(SPELLED_RE) || []);
}

/** Normalise a digit token so 1,240 · 1240 · 1240.00 are one number. */
function canonical (token) {
  const bare = String(token).replace(/,/g, '').replace(/[._:/-]+$/, '');
  const n = Number(bare);
  if (Number.isFinite(n)) return String(n);
  /* Dates, times and version numbers are not quantities to compare, they are
     shapes to match — but leading zeros are stripped per group so 09:30 and
     9:30 are the same time. A model restating what it was told in a different
     format is not inventing anything. */
  return bare
    .split(/[^\d]+/)
    .filter(Boolean)
    .map(g => String(Number(g)))
    .join('-');
}

/**
 * Every number in a piece of text, as canonical strings.
 * Exported for the tests and for the bench; nothing else uses it.
 */
export function numeralsIn (text) {
  const out = new Set();
  const s = claimable(text);
  for (const m of s.matchAll(DIGITS)) out.add(canonical(m[0]));

  /* Spelled numbers, but only where a scale word makes the phrase a real
     quantity rather than a turn of speech. */
  const lower = s.toLowerCase();
  if (SCALES.some(w => lower.includes(w))) {
    for (const m of lower.matchAll(WORDS_RE)) {
      const phrase = m[0].trim();
      if (!SCALES.some(w => phrase.split(/[\s-]+/).includes(w))) continue;
      /* "a hundred" on its own is a turn of speech; "a hundred and ninety-four"
         is an answer. Two number words or more, one of them a scale. */
      const parts = phrase.split(/[\s-]+/).filter(p => p !== 'and' && p !== 'a');
      if (parts.length >= 2) out.add(parts.join(' '));
    }
  }
  return out;
}

/**
 * Does this reply state a number the person never supplied, in answer to a
 * question that wanted one?
 *
 * `asked` is what the user typed this turn; `said` is everything they typed
 * earlier in the conversation. Returns null when there is nothing to catch, or
 * `{ numbers }` naming what could not be traced — which is the signal to drop
 * the prose and offer the handoff instead.
 */
export function needsHandoff (text, { asked = '', said = [] } = {}) {
  if (!wantsANumber(asked)) return null;
  const mine = [asked, ...said].join('\n');
  const allowedDigits = numeralsIn(mine);
  const allowedWords = spelledNumbersIn(mine);
  const found = [
    ...[...numeralsIn(text)].filter(n => !allowedDigits.has(n)),
    ...[...spelledNumbersIn(text)].filter(w => !allowedWords.has(w))
  ];
  return found.length ? { numbers: found } : null;
}

/** What the app shows in place of a reply that was dropped. Written here, in
 *  JavaScript, so no model can phrase its own refusal. */
export const HANDOFF_TEXT =
  'That answer had a figure in it that I would only have been guessing at, so I have not shown it. ' +
  'Working it out is Patch\'s job, where the number comes from a function and you can see which.';

/** What the app shows when the model itself declined, which is the good case. */
export const HANDOFF_OFFER = 'Ask Patch';
