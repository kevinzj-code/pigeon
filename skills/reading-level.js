import { ok, fail, computed } from '../src/contracts.js';
import { words, sentences, syllablesIn } from '../src/lib/text.js';
import { round } from '../src/lib/num.js';

/* Flesch–Kincaid. The coefficients are the published ones; the syllable count
   underneath them is a heuristic (vowel groups, minus a silent trailing "e"),
   and it is wrong on a meaningful minority of English words. So the grade is
   labelled an estimate and the reply says "roughly". The alternative — a
   bundled pronunciation dictionary — is megabytes to make a readability score
   slightly less approximate, which §10's bundled-data budget would not thank
   us for. */
const BANDS = [
  [90, 'very easy — around 5th grade'], [80, 'easy — 6th grade'],
  [70, 'fairly easy — 7th grade'], [60, 'plain English — 8th to 9th grade'],
  [50, 'fairly difficult — 10th to 12th grade'], [30, 'difficult — university level'],
  [0, 'very difficult — graduate level']
];

export default {
  name: 'readingLevel',
  description: "Estimate the reading age of a passage \u2014 reading ease and school grade level.",
  category: 'text',
  tier: 'core',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: ['estimate', 'formula-only'],
  replyTemplate: 'Reading ease {{ease}} — {{band|prose}}. Roughly grade {{grade}}, from {{words}} words across {{sentences}} sentences.',
  inputSchema: {
    type: 'object',
    required: ['text'],
    properties: { text: { type: 'string', label: 'text', minLength: 1, prompt: 'Which text should I assess?' } }
  },
  outputSchema: {
    type: 'object',
    properties: {
      ease: { type: 'number' }, grade: { type: 'number' }, band: { type: 'string' },
      words: { type: 'integer' }, sentences: { type: 'integer' }, syllables: { type: 'integer' },
      wordsPerSentence: { type: 'number' }, syllablesPerWord: { type: 'number' }
    }
  },
  examples: [
    { text: 'how hard is this to read', input: { text: 'The cat sat on the mat. It was a warm day.' },
      output: { ease: 100, grade: 0, band: 'very easy — around 5th grade', words: 11, sentences: 2, syllables: 11, wordsPerSentence: 5.5, syllablesPerWord: 1 } },
    { text: 'reading level of this sentence', input: { text: 'Notwithstanding the aforementioned considerations, the committee determined that implementation should proceed.' },
      output: { ease: 0, grade: 22, band: 'very difficult — graduate level', words: 11, sentences: 1, syllables: 31, wordsPerSentence: 11, syllablesPerWord: 2.82 } },
    { text: 'flesch score for a plain paragraph', input: { text: 'We ship on Friday. The tests all pass. Two small things are left to fix.' },
      output: { ease: 100, grade: 0, band: 'very easy — around 5th grade', words: 15, sentences: 3, syllables: 16, wordsPerSentence: 5, syllablesPerWord: 1.07 } },
    { text: 'is this readable', input: { text: 'Please complete the attached form and return it to the office before the deadline.' },
      output: { ease: 71.8, grade: 6.7, band: 'fairly easy — 7th grade', words: 14, sentences: 1, syllables: 20, wordsPerSentence: 14, syllablesPerWord: 1.43 } },
    { text: 'grade level of a short instruction', input: { text: 'Turn left at the lights.' },
      output: { ease: 100, grade: 0, band: 'very easy — around 5th grade', words: 5, sentences: 1, syllables: 5, wordsPerSentence: 5, syllablesPerWord: 1 } }
  ],
  errorCases: [
    { input: {}, code: 'MISSING_FIELD' },
    { input: { text: '...' }, code: 'INVALID_INPUT' },
    { input: { text: ['a'] }, code: 'INVALID_INPUT' }
  ],
  run (input) {
    const w = words(input.text);
    const s = sentences(input.text);
    if (!w.length || !s.length) {
      return fail('INVALID_INPUT', 'There are no words in that to score.', 'text');
    }
    const syllables = w.reduce((n, word) => n + syllablesIn(word), 0);
    const wps = w.length / s.length;
    const spw = syllables / w.length;

    /* Clamped to 0–100: the formula is unbounded and happily returns 120 for a
       three-word sentence, which reads as a score out of 100 and is not one. */
    const ease = Math.max(0, Math.min(100, 206.835 - 1.015 * wps - 84.6 * spw));
    const grade = 0.39 * wps + 11.8 * spw - 15.59;

    return ok({
      ease: round(ease, 1),
      grade: round(Math.max(0, grade), 1),
      band: BANDS.find(([min]) => ease >= min)[1],
      words: w.length, sentences: s.length, syllables,
      wordsPerSentence: round(wps, 2), syllablesPerWord: round(spw, 2)
    }, computed());
  }
};
