import { ok, fail, bundled } from '../src/contracts.js';
import { spellableFrom, anagramKey, WORDS_AS_OF } from '../src/lib/words.js';

export default {
  name: 'wordsFromLetters',
  description: 'Build every shorter word you can from a pool of letters, using some of them.',
  category: 'games', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: WORDS_AS_OF, labels: [],
  replyTemplate: '{{count}} {{count|plural:word:words}} from those letters, longest first: {{words|list}}',
  inputSchema: {
    type: 'object', required: ['letters'],
    properties: {
      letters: { type: 'string', label: 'letters', minLength: 2, maxLength: 12, prompt: 'Which letters do you have?' },
      minLength: { type: 'integer', label: 'min word length', minimum: 2, maximum: 9, default: 3 },
      limit: { type: 'integer', label: 'max words shown', minimum: 1, maximum: 200, default: 40 }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      words: { type: 'array', items: { type: 'string' } }, count: { type: 'integer' },
      totalFound: { type: 'integer' }, longest: { type: 'string' }, dataAsOf: { type: 'string' }
    }
  },
  examples: [
    { text: 'what words can I make from pigeon', input: { letters: 'pigeon', minLength: 4 }, output: { words: ['pigeon', 'opine', 'gone', 'nope', 'open', 'peon', 'pine', 'ping', 'pone'], count: 9, totalFound: 9, longest: 'pigeon', dataAsOf: '2026-09-01' } },
    { text: 'words from the letters stop', input: { letters: 'stop' }, output: { words: ['opts', 'post', 'pots', 'spot', 'stop', 'tops', 'ops', 'opt', 'pot', 'sop', 'sot', 'top', 'tsp'], count: 13, totalFound: 13, longest: 'opts', dataAsOf: '2026-09-01' } },
    { text: 'make words from cat', input: { letters: 'cat' }, output: { words: ['act', 'cat'], count: 2, totalFound: 2, longest: 'act', dataAsOf: '2026-09-01' } },
    { text: 'five letter words from crane', input: { letters: 'crane', minLength: 5 }, output: { words: ['crane', 'nacre'], count: 2, totalFound: 2, longest: 'crane', dataAsOf: '2026-09-01' } },
    { text: 'longest words I can spell with tables', input: { letters: 'tables', minLength: 6 }, output: { words: ['ablest', 'bleats', 'stable', 'tables'], count: 4, totalFound: 4, longest: 'ablest', dataAsOf: '2026-09-01' } },
    { text: 'which words of at least four letters fit from these letters: plate', input: { letters: 'plate', minLength: 4 },
      output: { words: ['leapt', 'petal', 'plate', 'pleat', 'late', 'leap', 'lept', 'pale', 'pate', 'peal', 'peat', 'pelt', 'plea', 'tale', 'tape', 'teal'], count: 16, totalFound: 16, longest: 'leapt', dataAsOf: '2026-09-01' } },
    { text: 'what four-letter-or-longer words can I spell with the tiles stone', input: { letters: 'stone', minLength: 4 },
      output: { words: ['notes', 'onset', 'stone', 'tones', 'eons', 'nest', 'nets', 'noes', 'nose', 'note', 'ones', 'sent', 'snot', 'tens', 'toes', 'tone', 'tons'], count: 17, totalFound: 17, longest: 'notes', dataAsOf: '2026-09-01' } }
  ],
  errorCases: [
    { input: { letters: 'zz' }, code: 'INVALID_INPUT' },
    { input: { letters: '99' }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' }
  ],
  run (input) {
    const key = anagramKey(input.letters);
    if (key.length < 2) return fail('INVALID_INPUT', 'I need at least two letters to work with.', 'letters');

    const found = spellableFrom(key, input.minLength);
    if (!found.length) {
      return fail('INVALID_INPUT', `No word of ${input.minLength} letters or more can be spelled from those.`, 'letters');
    }
    /* Longest first, then alphabetical — the long ones are what anyone asking
       this question is actually after, and a flat alphabetical list buries them. */
    const sorted = [...found].sort((a, b) => b.length - a.length || a.localeCompare(b));
    const words = sorted.slice(0, input.limit);
    return ok({
      words, count: words.length, totalFound: found.length,
      longest: sorted[0], dataAsOf: WORDS_AS_OF
    }, bundled(WORDS_AS_OF));
  }
};
