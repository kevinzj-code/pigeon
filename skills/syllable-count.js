import { ok, fail, computed } from '../src/contracts.js';
import { words, syllablesIn } from '../src/lib/text.js';
import { round } from '../src/lib/num.js';

export default {
  name: 'syllableCount',
  description: 'Count the syllables — the beats — in a word or a text.',
  category: 'text', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: ['estimate'],
  replyTemplate: '{{total}} {{total|plural:syllable:syllables}} across {{words}} {{words|plural:word:words}} — {{average}} per word, estimated.',
  inputSchema: {
    type: 'object', required: ['text'],
    properties: { text: { type: 'string', label: 'text', minLength: 1, prompt: 'Which word or text?' } }
  },
  outputSchema: { type: 'object', properties: { total: { type: 'integer' }, words: { type: 'integer' }, average: { type: 'number' }, perWord: { type: 'array' }, haiku: { type: 'boolean' } } },
  examples: [
    { text: 'how many syllables in beautiful', input: { text: 'beautiful' }, output: { total: 4, words: 1, average: 4, perWord: [{ word: 'beautiful', syllables: 4 }], haiku: false } },
    { text: 'syllable count for this line', input: { text: 'an old silent pond' }, output: { total: 5, words: 4, average: 1.25, perWord: [{ word: 'an', syllables: 1 }, { word: 'old', syllables: 1 }, { word: 'silent', syllables: 2 }, { word: 'pond', syllables: 1 }], haiku: true } },
    { text: 'how many syllables is extraordinary', input: { text: 'extraordinary' }, output: { total: 5, words: 1, average: 5, perWord: [{ word: 'extraordinary', syllables: 5 }], haiku: true } },
    { text: 'count the syllables in cat', input: { text: 'cat' }, output: { total: 1, words: 1, average: 1, perWord: [{ word: 'cat', syllables: 1 }], haiku: false } },
    { text: 'syllables in the quick brown fox', input: { text: 'the quick brown fox' }, output: { total: 4, words: 4, average: 1, perWord: [{ word: 'the', syllables: 1 }, { word: 'quick', syllables: 1 }, { word: 'brown', syllables: 1 }, { word: 'fox', syllables: 1 }], haiku: false } },
    { text: 'count the beats when you say banana out loud', input: { text: 'banana' },
      output: { total: 3, words: 1, average: 3, perWord: [{ word: 'banana', syllables: 3 }], haiku: false } },
    { text: 'syllables in incredible', input: { text: 'incredible' },
      output: { total: 4, words: 1, average: 4, perWord: [{ word: 'incredible', syllables: 4 }], haiku: false } }
  ],
  errorCases: [
    { input: { text: '123' }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' },
    { input: { text: '' }, code: 'MISSING_FIELD' }
  ],
  run (input) {
    const all = words(input.text).filter(w => /[a-z]/i.test(w));
    if (!all.length) return fail('INVALID_INPUT', 'There are no words in that to count syllables in.', 'text');
    /* A vowel-group heuristic, and wrong on a meaningful minority of English —
       "fire", "poem" and most loanwords trip it. That is why the skill carries
       the "estimate" label and the reply says "estimated" out loud. A correct
       count needs a pronunciation dictionary, which is a bundled-data decision
       (§10) rather than a bug in this function. */
    const perWord = all.map(w => ({ word: w, syllables: syllablesIn(w) }));
    const total = perWord.reduce((n, w) => n + w.syllables, 0);
    return ok({
      total, words: all.length, average: round(total / all.length, 2), perWord,
      /* The line lengths of a haiku — the one thing people actually count
         syllables by hand for. */
      haiku: total === 5 || total === 7
    }, computed());
  }
};
