/* transcript-corrupt.mjs — clean prose in, transcript damage out.
 *
 * This is the reason a transcript cleaner can be scored and a persona cannot.
 * Every persona corpus is trained on a teacher's opinion, so "did it work" is
 * a judgement. Here the ground truth is the text we started from, exactly, so
 * the answer is a number.
 *
 * It reproduces the damage that SURVIVES the deterministic pass in
 * src/transcript.js, because that pass runs first in production and the model
 * must be trained on the input it will actually be handed. Timestamps, cue
 * numbers, repeated labels and comma-delimited fillers are all gone by then.
 * What is left, measured off two real files:
 *
 *   - the paragraph structure, gone entirely
 *   - sentence boundaries deleted, so two sentences run together
 *   - sentence boundaries invented mid-clause, with a capital after them
 *   - capitals in the middle of a sentence  ("Kind of A quick summary")
 *   - fillers with no commas round them, which the function pass must not
 *     touch and so leaves  ("and I'll just kind of diagram this")
 *   - a name broken by an invented full stop  (Palewave.com -> pail. Wave com)
 *
 * Every transform is independent and seeded. The point of holding them apart
 * is that the held-out set can be corrupted at different rates from the
 * training set: a model that has only ever seen one damage profile has learnt
 * the generator, not the task.
 */

import { FILLERS, stripStutters, stripFillers } from '../src/captions.js';

/* Seeded, because a corpus that changes between two runs of the same command
   cannot be compared with itself. */
export function mulberry (seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* Bare fillers only. A filler wrapped in commas is the function pass's job and
   is gone before the model sees anything, so putting one here would train the
   model to do work it will never be given.
 *
 * These go into the TRUTH as well as the damaged copy, and that was a bug once.
 * Inserting them on one side only trained the model to delete them, which
 * contradicts the instruction it is given ("do not add, remove, reorder or
 * summarise any word") and, worse, taught it to delete "like" and "right" —
 * the exact words captions.js refuses to touch because they are usually
 * ordinary English. Measured on a real Zoom transcript: the model dropped 5 to
 * 9% of the letters and every chunk was vetoed.
 *
 * A perfect transcript records a filler the speaker said. Removing one is
 * editing, and editing is deletion, and deletion is the function pass's job.
 * The model repunctuates and nothing else, which is also what makes the audit
 * exact: a faithful repair does not change one letter. */
const BARE_FILLERS = ['like', 'right', 'actually', 'basically', 'literally', 'well',
                      'you see', 'I guess', 'I think', 'I suppose', 'honestly', 'anyway'];

/* None of these may be a filler captions.js removes, and the assert is not
   decoration. "you know" and "sort of" were in this list once; the function
   pass strips them when they sit next to a comma, so the damaged copy came out
   a word SHORTER than the target and the model learnt to delete. Everything
   here is a word the function pass deliberately leaves alone, which is also
   exactly what the model will meet in a real transcript. */
{
  const removable = new Set([...FILLERS.always, ...FILLERS.usually].map(f => f.toLowerCase()));
  const clash = BARE_FILLERS.filter(f => removable.has(f.toLowerCase()));
  if (clash.length) {
    throw new Error(`these fillers are removed by captions.js and must not be inserted: ${clash.join(', ')}`);
  }
}

const TERMINAL = /[.!?]$/;
const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1);
const lower = (w) => w.charAt(0).toLowerCase() + w.slice(1);

/* Put the fillers in, keeping the punctuation correct. The result is what a
   perfect transcript of that speech looks like, which is what the model is
   asked to produce. */
function speak (written, rng, rate) {
  if (!rate) return written;
  const bare = (w) => String(w).toLowerCase().replace(/[^a-z0-9']+/g, '');
  return written.split(/\n\s*\n/).map(para => {
    const words = para.split(/\s+/).filter(Boolean);
    const out = [];
    for (let i = 0; i < words.length; i++) {
      out.push(words[i]);
      const endsSentence = TERMINAL.test(words[i]);
      /* Never straight after a full stop: a filler opening a sentence would
         need a capital, and the capital is the thing being tested. */
      if (i >= words.length - 1 || endsSentence || rng() >= rate) continue;

      const filler = BARE_FILLERS[Math.floor(rng() * BARE_FILLERS.length)];
      const parts = filler.split(' ');
      /* Never make a doubled word. "addressing" + "right" in front of an
         existing "right" reads as a stutter, and captions.js then removes one
         of them — so the damaged copy would be a word SHORTER than the target
         and the model would learn to delete. The rebuild's letter check caught
         this on 50 rows; this is what it was catching. */
      if (bare(parts[0]) === bare(words[i])) continue;
      if (bare(parts[parts.length - 1]) === bare(words[i + 1])) continue;
      out.push(filler);
    }
    return out.join(' ');
  }).join('\n\n');
}

const fillersIn = (spoken, written) =>
  spoken.split(/\s+/).length - written.split(/\s+/).length;

/** The damage rates. `light` is a good transcript, `heavy` is Zoom. */
export const LEVELS = {
  light: { dropBoundary: 0.20, addBoundary: 0.04, strayCap: 0.02, filler: 0.05, mangleName: 0.05 },
  medium: { dropBoundary: 0.35, addBoundary: 0.10, strayCap: 0.05, filler: 0.12, mangleName: 0.12 },
  heavy: { dropBoundary: 0.50, addBoundary: 0.18, strayCap: 0.09, filler: 0.22, mangleName: 0.20 }
};

/**
 * @param {string} clean  correctly punctuated, correctly paragraphed prose
 * @returns {{ text: string, truth: string, applied: object }}
 *   `truth` is the clean text with its whitespace normalised — what the model
 *   is asked to reproduce. `text` is what it is handed.
 */
export function corrupt (clean, { rng = mulberry(11), level = 'medium' } = {}) {
  const rates = typeof level === 'string' ? LEVELS[level] : level;
  if (!rates) throw new Error(`unknown damage level: ${level}`);

  const written = String(clean ?? '').replace(/\r\n?/g, '\n').replace(/[^\S\n]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n').trim();

  /* Step one: what the person SAID, fillers and all, still perfectly
     punctuated — then put through the SAME deletions captions.js will perform
     on the damaged copy before the model ever sees it.
   *
   * That second half is not tidiness, it is the invariant. The pipeline strips
   * stutters and comma-fillers from the input; if the target keeps them, the
   * two differ by a word and the model learns to delete one. It cannot be
   * avoided by choosing the inserted fillers carefully, because the passages
   * themselves already contain "sort of" and "well" — a teacher asked for
   * spoken language writes spoken language. Deriving the target from the same
   * stripped stream makes the letters match by construction rather than by
   * luck, and the rebuild asserts it on every row. */
  const spoken = speak(written, rng, rates.filler);
  const truth = spoken
    .split(/\n\s*\n/)
    .map(para => stripFillers(stripStutters(para).text).text)
    .filter(Boolean)
    .join('\n\n');

  /* Work on words with their punctuation attached. Splitting punctuation off
     and putting it back is where this kind of code usually goes wrong. */
  const words = truth.split(/\s+/).filter(Boolean);
  const out = [];
  const applied = { dropped: 0, added: 0, capped: 0, fillers: fillersIn(spoken, written), mangled: 0 };

  /* Decided from the ORIGINAL text, before anything is changed, and this
     matters twice over. A proper noun is a capital that is NOT starting a
     sentence — "Palewave.com" mid-clause, never "Today" at the front — so asking
     the question after a boundary has been dropped gets the wrong answer. And
     reading it off the live array let the generator mangle a word it had
     itself just capitalised, which turned "outperform" into "outpe. Rform".
     Damage should come from the transcript, not from the damage. */
  const properNoun = words.map((w, i) => {
    const prev = i > 0 ? words[i - 1] : null;
    const sentenceInitial = i === 0 || (prev && TERMINAL.test(prev));
    return !sentenceInitial && /^[A-Z][a-z]{3,}$/.test(w);
  });

  for (let i = 0; i < words.length; i++) {
    let w = words[i];
    const next = words[i + 1];
    const endsSentence = TERMINAL.test(w);

    /* A name broken by an invented full stop, the "Palewave.com" failure. Only on
       a capitalised word that is not already ending a sentence. */
    if (next && rates.mangleName > 0 && !endsSentence && properNoun[i]
        && rng() < rates.mangleName) {
      const half = Math.max(2, Math.floor(w.length / 2));
      out.push(`${lower(w.slice(0, half))}.`, cap(w.slice(half)));
      applied.mangled++;
      continue;
    }

    if (endsSentence && next) {
      /* Drop the boundary: the two sentences run together and the next word
         loses its capital, which is the single commonest defect. */
      /* "...with it. It smelled..." loses its boundary and becomes "with it it
         smelled", which captions.js reads as a stutter and halves — so the
         damaged copy would be a word short of the target and the model would
         learn to delete. Left alone here, and noted in captions.js as a corner
         the deterministic pass genuinely gets wrong. */
      const doubles = String(w).replace(TERMINAL, '').toLowerCase().replace(/[^a-z0-9']+/g, '')
        === String(next).toLowerCase().replace(/[^a-z0-9']+/g, '');
      if (!doubles && rng() < rates.dropBoundary) {
        out.push(w.replace(TERMINAL, ''));
        words[i + 1] = /^[A-Z][a-z]/.test(next) ? lower(next) : next;
        applied.dropped++;
        continue;
      }
    } else if (next && rng() < rates.addBoundary) {
      /* Invent a boundary mid-clause and capitalise after it. */
      out.push(`${w}.`);
      words[i + 1] = cap(next);
      applied.added++;
      continue;
    }

    /* A stray capital with no boundary in front of it. */
    if (!endsSentence && /^[a-z]{2,}$/.test(w) && rng() < rates.strayCap) {
      w = cap(w); applied.capped++;
    }

    out.push(w);
  }

  /* The paragraphs go last and go completely: a transcript has none. */
  return { text: out.join(' ').replace(/\s+/g, ' ').trim(), truth, applied };
}
