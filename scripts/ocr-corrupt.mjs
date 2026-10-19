/* ocr-corrupt.mjs — clean text in, OCR damage out.
 *
 * The OCR clean-up (`ocr-tidy`, src/ocr.js) may repair exactly four things:
 * lines broken mid-sentence, spacing round punctuation, words run together or
 * split, and an obviously misread letter inside a word. It must never change a
 * number. This script makes those four kinds of damage and no other, so the
 * clean text is the exact answer and a repair can be scored by comparison.
 *
 *   - a long line (prose) is wrapped mid-sentence, as an image line ends
 *   - a space appears before a comma or full stop
 *   - two words run together; one word splits in two
 *   - inside a WORD of letters only: l → |, I → |, m → rn, d → cl, w → vv
 *     (letter-for-letter-shapes only: never a letter to a digit or back,
 *     which rule 4 forbids the model to undo)
 *
 * Tokens with a digit in them are never touched, so the numbers in the damaged
 * copy are the numbers in the clean one. Seeded, as transcript-corrupt.mjs is.
 */
import { mulberry } from './transcript-corrupt.mjs';
import { numbersIn } from '../src/fabrication.js';

export { mulberry };

export const LEVELS = {
  light: { wrap: 0.5, punctSpace: 0.10, runTogether: 0.02, splitWord: 0.01, letter: 0.02 },
  medium: { wrap: 0.8, punctSpace: 0.25, runTogether: 0.05, splitWord: 0.03, letter: 0.05 },
  heavy: { wrap: 1.0, punctSpace: 0.45, runTogether: 0.09, splitWord: 0.06, letter: 0.10 }
};

const LETTER_SWAPS = [[/l/, '|'], [/I/, '|'], [/m/, 'rn'], [/d/, 'cl'], [/w/, 'vv']];
/* A word the app's audit reads as a number ("half", "one", "dozen") is a
   number: auditCleanup (src/ocr.js) compares numbersIn() of the reading and
   the repair, so damage that hid one would make the exact repair look like it
   introduced a number, and be refused. Such words are never touched. */
const isNumberWord = (t) => numbersIn(t).size > 0;
const isWord = (t) => /^[A-Za-z]+$/.test(t) && !isNumberWord(t);

function damageLetters (word, rng, rate) {
  if (!isWord(word) || word.length < 4 || rng() >= rate) return word;
  const options = LETTER_SWAPS.filter(([re]) => re.test(word.slice(1, -1)) || re.test(word));
  if (!options.length) return word;
  const [re, to] = options[Math.floor(rng() * options.length)];
  /* Inside the word, not at its edges, where a reader cannot tell. */
  const inner = word.slice(1).search(re);
  if (inner < 0) return word;
  const at = inner + 1;
  return word.slice(0, at) + word.slice(at).replace(re, to);
}

/**
 * @param {string} clean  correct text, one line per printed line; prose
 *   paragraphs on single long lines
 * @returns {{ text: string, truth: string }}
 */
export function corrupt (clean, { rng = mulberry(7), level = 'medium' } = {}) {
  const rates = typeof level === 'string' ? LEVELS[level] : level;
  if (!rates) throw new Error(`unknown damage level: ${level}`);
  const truth = String(clean ?? '').replace(/\r\n?/g, '\n').replace(/[^\S\n]+/g, ' ').replace(/ *\n */g, '\n').trim();

  const out = truth.split('\n').map(line => {
    let words = line.split(' ');
    /* Word-level damage first, on letters-only words. */
    words = words.map(w => {
      const m = w.match(/^([A-Za-z]+)([,.;:!?]*)$/);
      if (!m || isNumberWord(m[1])) return w;
      let core = damageLetters(m[1], rng, rates.letter);
      if (m[1].length >= 7 && rng() < rates.splitWord) {
        const at = 2 + Math.floor(rng() * (m[1].length - 4));
        core = core.slice(0, at) + ' ' + core.slice(at);
      }
      const punct = m[2] && /^[,.]/.test(m[2]) && rng() < rates.punctSpace ? ' ' + m[2] : m[2];
      return core + punct;
    });
    /* Two neighbouring letters-only words run together. */
    for (let i = 0; i < words.length - 1; i++) {
      if (isWord(words[i]) && isWord(words[i + 1]) && rng() < rates.runTogether) {
        words.splice(i, 2, words[i] + words[i + 1]);
      }
    }
    /* A long line wraps where the image line ended: every 6 to 10 words. */
    if (words.length >= 9 && rng() < rates.wrap) {
      const lines = [];
      let cur = [];
      let next = 6 + Math.floor(rng() * 5);
      for (const w of words) {
        cur.push(w);
        if (cur.length >= next) { lines.push(cur.join(' ')); cur = []; next = 6 + Math.floor(rng() * 5); }
      }
      if (cur.length) lines.push(cur.join(' '));
      return lines.join('\n');
    }
    return words.join(' ');
  });
  return { text: out.join('\n'), truth };
}

/** Every number-bearing token in a text, in order: the invariant the damage keeps. */
export const numberTokens = (s) => (String(s).match(/\S*\d\S*/g) || []).map(t => t.replace(/^[^\d£$€]*|[^\d%]*$/g, ''));
