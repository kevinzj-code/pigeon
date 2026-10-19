import { ok, fail, bundled } from '../src/contracts.js';
import { anagramsOf, anagramKey, WORDS_AS_OF } from '../src/lib/words.js';

export default {
  name: 'solveAnagram',
  description: 'Rearrange all the letters of a word into the other words they spell.',
  category: 'games', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: WORDS_AS_OF, labels: [],
  replyTemplate: '{{count}} {{count|plural:word:words}} from those letters: {{words|list}}',
  inputSchema: {
    type: 'object', required: ['letters'],
    properties: { letters: { type: 'string', label: 'letters', minLength: 2, maxLength: 9, prompt: 'Which letters should I unscramble?' } }
  },
  outputSchema: {
    type: 'object',
    properties: {
      words: { type: 'array', items: { type: 'string' } }, count: { type: 'integer' },
      letters: { type: 'string' }, dataAsOf: { type: 'string' }
    }
  },
  examples: [
    { text: 'unscramble listen', input: { letters: 'listen' }, output: { words: ['enlist', 'inlets', 'listen', 'silent', 'tinsel'], count: 5, letters: 'eilnst', dataAsOf: '2026-09-01' } },
    { text: 'what words can I make from stop', input: { letters: 'stop' }, output: { words: ['opts', 'post', 'pots', 'spot', 'stop', 'tops'], count: 6, letters: 'opst', dataAsOf: '2026-09-01' } },
    { text: 'solve the anagram tea', input: { letters: 'tea' }, output: { words: ['ate', 'eat', 'eta', 'tea'], count: 4, letters: 'aet', dataAsOf: '2026-09-01' } },
    { text: 'anagram of pigeon', input: { letters: 'pigeon' }, output: { words: ['pigeon'], count: 1, letters: 'eginop', dataAsOf: '2026-09-01' } },
    { text: 'unscramble the letters rat', input: { letters: 'rat' }, output: { words: ['art', 'rat', 'tar'], count: 3, letters: 'art', dataAsOf: '2026-09-01' } }
  ],
  errorCases: [
    { input: { letters: 'zzzz' }, code: 'INVALID_INPUT' },
    { input: { letters: '12' }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' }
  ],
  run (input) {
    const key = anagramKey(input.letters);
    if (key.length < 2) return fail('INVALID_INPUT', 'I need at least two letters to unscramble.', 'letters');
    const words = anagramsOf(input.letters);
    if (!words.length) {
      return fail('INVALID_INPUT', `No word in the bundled list uses exactly those letters. The list holds words of two to nine letters, so long or unusual words may be missing rather than impossible.`, 'letters');
    }
    return ok({ words, count: words.length, letters: key, dataAsOf: WORDS_AS_OF }, bundled(WORDS_AS_OF));
  }
};
