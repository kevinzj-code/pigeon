/* fabrication.js — §8, the one metric with a zero target.
 *
 * "Every numeral AND spelled-out number word in the reply must trace to a
 * {{result}} token or the user's own message."
 *
 * Two entry points, because there are two reply paths:
 *   auditSegments() — the template path. Value segments came from results by
 *     construction, so only the prose between them is audited. This is the
 *     strong form and it is the one that runs on most turns.
 *   auditText()     — the Assembler path, per §8. Given a flat string, every
 *     number in it has to be found in the results context or the message.
 *
 * The failure mode is deliberately safe: on a violation the caller re-runs the
 * Assembler once, and if it violates again falls back to the concatenated
 * replyTemplates. The user always gets a correct reply; the model just doesn't
 * get to write it. So a FALSE positive here costs prose quality, never
 * correctness — which is the right direction for this check to be wrong in. */

const UNITS = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60,
  seventy: 70, eighty: 80, ninety: 90
};
const SCALES = { hundred: 100, thousand: 1000, million: 1e6, billion: 1e9, trillion: 1e12 };
const ORDINALS = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7,
  eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12
};
const FRACTIONS = { half: 0.5, quarter: 0.25, third: 1 / 3 };

/* Not quantities. "one of the two options" contains a real quantity (two) and
   a pronoun (one); flagging the pronoun would make the check unusable without
   making it stricter about anything that matters. This list is short on
   purpose — every entry is a construction where the word cannot be a count. */
const IDIOMS = [
  /\bone\s+of\b/gi, /\bno\s+one\b/gi, /\bone\s+another\b/gi, /\bat\s+one\s+point\b/gi,
  /\bfor\s+one\b/gi, /\bone\s+way\b/gi, /\bin\s+one\s+go\b/gi,
  /\bsecond\b(?=\s+(?:opinion|thought|guess|language|nature))/gi,
  /\bfirst\b(?=\s+(?:of\s+all|off|and\s+foremost|name|class|time))/gi,
  /\bon\s+the\s+one\s+hand\b/gi
];

const WORD = new RegExp(
  `\\b(?:${[...Object.keys(UNITS), ...Object.keys(SCALES), ...Object.keys(ORDINALS), ...Object.keys(FRACTIONS)].join('|')})\\b`,
  'gi'
);
/* Numerals, including grouped thousands, decimals and a leading sign. The
   trailing (?!\S) keeps "2026-11-14" whole rather than reading it as 2026,
   11 and 14 — a date the user typed should match the date in the results.

   The lookbehind stops a hyphen from being read as a minus sign when it sits
   inside a name: "UTF-8", "Latin-1", "ISO-8859-1", "COVID-19". Those are
   identifiers, not negative quantities, and demanding that a reply justify
   "-8" before it may say "UTF-8" flags prose that never made a numeric claim.
   The digit itself is still extracted — the engine simply matches "8" one
   character later — so nothing that was checked before goes unchecked now. A
   real negative is always preceded by a space or the start of the string. */
const NUMERAL = /(?<![A-Za-z0-9])-?\d[\d,]*(?:\.\d+)?/g;

const strip = (s) => IDIOMS.reduce((acc, re) => acc.replace(re, ' '), s);

/** All numeric tokens in a string, as normalised numbers. */
export function numbersIn (text) {
  const found = new Set();
  const src = String(text ?? '');

  for (const m of src.matchAll(NUMERAL)) {
    const n = Number(m[0].replace(/,/g, ''));
    if (Number.isFinite(n)) found.add(norm(n));
  }
  /* Digit runs inside a compound token (dates, times, versions, IDs) are also
     legitimate references — "2026-11-14" should license "14". */
  for (const m of src.matchAll(/\d+/g)) {
    const n = Number(m[0]);
    if (Number.isFinite(n)) found.add(norm(n));
  }
  for (const [w, v] of wordNumbers(src)) found.add(norm(v)), void w;
  return found;
}

/** Word-number tokens with their positions, so a violation can be quoted. */
function wordNumbers (src) {
  const out = [];
  const tokens = [...src.matchAll(WORD)];
  let i = 0;
  while (i < tokens.length) {
    /* Greedily consume an adjacent run ("twenty five thousand") only when the
       words really are adjacent in the source; "five apples, three pears" must
       stay two numbers, not 53. */
    let j = i, total = 0, current = 0, matched = false;
    let lastEnd = tokens[i].index;
    while (j < tokens.length) {
      const t = tokens[j];
      const gap = src.slice(lastEnd + (j === i ? 0 : tokens[j - 1][0].length), t.index);
      if (j > i && !/^[\s-]*(and[\s-]*)?$/i.test(gap)) break;
      const w = t[0].toLowerCase();
      if (w in UNITS) { current += UNITS[w]; matched = true; }
      else if (w in SCALES) {
        const s = SCALES[w];
        if (s === 100) current = (current || 1) * 100;
        else { total += (current || 1) * s; current = 0; }
        matched = true;
      } else if (w in ORDINALS) { current += ORDINALS[w]; matched = true; }
      else if (w in FRACTIONS) { current += FRACTIONS[w]; matched = true; }
      lastEnd = t.index;
      j++;
    }
    if (matched) out.push([src.slice(tokens[i].index, lastEnd + tokens[j - 1][0].length), total + current]);
    i = Math.max(j, i + 1);
  }
  return out;
}

/* Rounding is a presentation choice a reply is allowed to make: results may
   hold 55.499999 and the reply may say 55.5. Matching on a normalised value
   plus a tolerance band keeps that legal without licensing a different number. */
const norm = (n) => Number(n.toFixed(6));

function collectFromValue (v, into) {
  if (v === null || v === undefined) return;
  if (typeof v === 'number') { into.add(norm(v)); return; }
  if (typeof v === 'string') { for (const n of numbersIn(v)) into.add(n); return; }
  if (Array.isArray(v)) { v.forEach(x => collectFromValue(x, into)); return; }
  if (typeof v === 'object') { Object.values(v).forEach(x => collectFromValue(x, into)); }
}

/** The set of numbers a reply is allowed to contain. */
export function allowedNumbers ({ results = [], message = '' } = {}) {
  const allowed = new Set();
  for (const n of numbersIn(message)) allowed.add(n);
  for (const r of results) {
    if (r && r.ok) collectFromValue(r.value, allowed);
    /* The step's own input is fair game too: it either came from the user's
       message or from an earlier result, both already licensed. */
    if (r && r.input) collectFromValue(r.input, allowed);
  }
  return allowed;
}

const CLOSE = (a, b) => Math.abs(a - b) <= Math.max(1e-6, Math.abs(b) * 1e-9)
  /* one decimal place of rounding slack, both directions */
  || Number(a.toFixed(2)) === Number(b.toFixed(2))
  || Number(a.toFixed(1)) === Number(b.toFixed(1))
  || Math.round(a) === Math.round(b) && Math.abs(a - b) < 0.5;

/** §8 general form — audit a flat reply string. */
export function auditText (text, { results = [], message = '' } = {}) {
  const allowed = allowedNumbers({ results, message });
  const violations = [];
  const src = strip(String(text ?? ''));

  for (const m of src.matchAll(NUMERAL)) {
    const n = norm(Number(m[0].replace(/,/g, '')));
    if (!Number.isFinite(n)) continue;
    if (![...allowed].some(a => CLOSE(n, a))) violations.push({ token: m[0], value: n, kind: 'numeral' });
  }
  for (const [word, v] of wordNumbers(src)) {
    const n = norm(v);
    if (![...allowed].some(a => CLOSE(n, a))) violations.push({ token: word, value: n, kind: 'word' });
  }
  return { ok: violations.length === 0, violations, allowed: [...allowed] };
}

/** Template/segment form — the strong one. Value segments are trusted because
 *  they were substituted from results; only the prose between them is audited. */
export function auditSegments (segs, { message = '', results = [] } = {}) {
  /* Two sources license a number in the prose: a span that was substituted
     from a result, and the results context itself. The second matters for
     `|prose` tokens — a sentence the skill composed from its own output, like
     "50 words over" — where the number is verified but is not a marked span. */
  const fromSegments = segs
    .filter(s => s.type === 'value')
    .map(s => ({ ok: true, value: s.raw, input: null }));
  const prose = segs.filter(s => s.type === 'text').map(s => s.text).join(' ');
  return auditText(prose, { results: [...fromSegments, ...results], message });
}
