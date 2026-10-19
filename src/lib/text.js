/* text.js — the tokenising the text skills share.
 *
 * Word counting looks trivial until you write it down: hyphenated words,
 * apostrophes, em-dashes, numbers, and the fact that "don't" is one word but
 * "up-to-date" is arguably three. These are the rules the skills agree on, in
 * one place, so countWords and wordFrequency can never disagree about what a
 * word is. */

/* Apostrophes (straight and curly) and internal hyphens stay inside a word;
   everything else splits. "don't" is one word, "up-to-date" is one word,
   "hello—world" is two. */
const WORD_RE = /[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu;

export function words (text) {
  return String(text ?? '').match(WORD_RE) ?? [];
}

/* Sentence splitting without a model: terminal punctuation followed by
   whitespace and something that looks like a new sentence. Known limits —
   "Dr. Smith" and "e.g." will over-split. That is why countSentences is
   Core-with-a-caveat rather than Core-with-a-claim; the skill says so. */
const ABBREV = /\b(?:mr|mrs|ms|dr|prof|sr|jr|st|vs|etc|e\.g|i\.e|approx|inc|ltd|co|no|fig|al)\.$/i;

export function sentences (text) {
  const src = String(text ?? '').trim();
  if (!src) return [];
  const out = [];
  let buf = '';
  const parts = src.split(/(?<=[.!?…]["'’”)\]]?)\s+/);
  for (const part of parts) {
    buf = buf ? `${buf} ${part}` : part;
    if (ABBREV.test(buf.trim())) continue;
    out.push(buf.trim());
    buf = '';
  }
  if (buf.trim()) out.push(buf.trim());
  return out.filter(Boolean);
}

export function lines (text, { keepBlank = true } = {}) {
  const all = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
  return keepBlank ? all : all.filter(l => l.trim() !== '');
}

/* Syllable estimate, used by readingLevel. It is a heuristic — vowel groups,
   minus silent trailing "e", floor of one — and it is wrong on a meaningful
   minority of English words. Every skill built on it carries the "estimate"
   label for exactly that reason. */
export function syllablesIn (word) {
  const w = String(word).toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return 0;
  if (w.length <= 3) return 1;
  const groups = w
    .replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '')
    .replace(/^y/, '')
    .match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups ? groups.length : 1);
}

/* A short, conventional English stop list, bundled with the app.
   Kept SMALL on purpose: an aggressive list quietly deletes content words
   ("will", "can", "may" are nouns and verbs too) and the user cannot see what
   was dropped. Definitional rather than dated — unlike a currency table this
   does not go stale — so skills using it report provenance "computed". */
export const STOP_WORDS = new Set(`a an the and or but if of to in on at for from by with as is are was were be been
being do does did have has had it its this that these those i you he she they we me him her them my
your his their our not no so than then there here what which who when where how all any both each few
more most other some such only own same too very s t just`.split(/\s+/));

/* Levenshtein edit distance — the DP table, one row at a time.
   Two full rows instead of the whole matrix: the distance only ever needs the
   previous row, and the full table is O(n·m) memory for a number. */
export function levenshtein (a, b) {
  const s = [...String(a)], t = [...String(b)];
  if (!s.length) return t.length;
  if (!t.length) return s.length;
  let prev = Array.from({ length: t.length + 1 }, (_, i) => i);
  for (let i = 1; i <= s.length; i++) {
    const row = [i];
    for (let j = 1; j <= t.length; j++) {
      row[j] = Math.min(
        prev[j] + 1,                                   // deletion
        row[j - 1] + 1,                                // insertion
        prev[j - 1] + (s[i - 1] === t[j - 1] ? 0 : 1)  // substitution
      );
    }
    prev = row;
  }
  return prev[t.length];
}

/* A very small Porter-style stemmer: the suffix strips that matter for
   grouping ("running"/"runs"/"ran" is beyond it, but "running"/"run" is not).
   Deliberately not the full algorithm — that is a dependency to solve a
   problem this registry does not have. */
export function stem (word) {
  let w = String(word).toLowerCase();
  if (w.length <= 3) return w;

  /* Plurals first, then derivational suffixes — Porter's own step order, and
     the order matters in both directions. An early `return` on a word ending
     "ss" (there to protect "grass") also caught "happiness", which ends in ss
     but whose suffix is "-ness"; and stripping "-tion" before the plural s
     would miss "connections" entirely. So: no early returns, plurals adjust the
     word, and the suffix loop then runs on the result. */
  if (w.endsWith('ies') && w.length > 4) w = `${w.slice(0, -3)}y`;
  else if (w.endsWith('sses')) w = w.slice(0, -2);
  else if (w.endsWith('ss')) { /* a real double-s ending: leave it alone */ }
  else if (w.endsWith('s') && !w.endsWith('us')) w = w.slice(0, -1);

  for (const suf of ['ational', 'ization', 'fulness', 'ousness', 'iveness', 'ement', 'ance', 'ence', 'able', 'ible', 'ment', 'ness', 'tion', 'ing', 'ed', 'ly']) {
    if (w.endsWith(suf) && w.length - suf.length >= 3) {
      w = w.slice(0, -suf.length);
      /* "hopping" → "hopp" → "hop"; "running" → "runn" → "run" */
      if (/([bdfglmnprt])\1$/.test(w)) w = w.slice(0, -1);
      break;
    }
  }
  return w;
}
