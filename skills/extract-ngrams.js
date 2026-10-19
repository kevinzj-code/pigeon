import { ok, fail, computed } from '../src/contracts.js';
import { words } from '../src/lib/text.js';

export default {
  name: 'extractNgrams',
  description: 'Break text into overlapping runs of n words or characters — two-word runs, bigrams, trigrams.',
  category: 'text', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  title: 'Extract n-grams',
  replyTemplate: '{{count}} {{n}}-grams: {{ngrams|list}}.',
  inputSchema: {
    type: 'object', required: ['text'],
    properties: {
      text: { type: 'string', label: 'text', minLength: 1, maxLength: 50000, prompt: 'Which text should I break up?' },
      n: { type: 'integer', label: 'n-gram size', minimum: 1, maximum: 10, default: 2 },
      unit: { type: 'string', label: 'words or characters', enum: ['words', 'characters'], default: 'words' }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      ngrams: { type: 'array', items: { type: 'string' } }, count: { type: 'integer' },
      n: { type: 'integer' }, unit: { type: 'string' }, unique: { type: 'integer' }
    }
  },
  examples: [
    { text: 'get the bigrams from this sentence', input: { text: 'the quick brown fox' }, output: { ngrams: ['the quick', 'quick brown', 'brown fox'], count: 3, n: 2, unit: 'words', unique: 3 } },
    { text: 'trigrams of this text', input: { text: 'one two three four five', n: 3 }, output: { ngrams: ['one two three', 'two three four', 'three four five'], count: 3, n: 3, unit: 'words', unique: 3 } },
    { text: 'single word ngrams', input: { text: 'alpha beta gamma', n: 1 }, output: { ngrams: ['alpha', 'beta', 'gamma'], count: 3, n: 1, unit: 'words', unique: 3 } },
    { text: 'character bigrams of a word', input: { text: 'pigeon', n: 2, unit: 'characters' }, output: { ngrams: ['pi', 'ig', 'ge', 'eo', 'on'], count: 5, n: 2, unit: 'characters', unique: 5 } },
    { text: 'bigrams where one repeats', input: { text: 'to be or not to be' }, output: { ngrams: ['to be', 'be or', 'or not', 'not to', 'to be'], count: 5, n: 2, unit: 'words', unique: 4 } },
    { text: 'split this into runs of two words', input: { text: 'one two three four', n: 2 },
      output: { ngrams: ['one two', 'two three', 'three four'], count: 3, n: 2, unit: 'words', unique: 3 } },
    { text: 'give me the three-word sequences in this', input: { text: 'a b c d', n: 3 },
      output: { ngrams: ['a b c', 'b c d'], count: 2, n: 3, unit: 'words', unique: 2 } }
  ],
  errorCases: [
    { input: { text: 'short', n: 4 }, code: 'INVALID_INPUT' },
    { input: { text: 'a b', n: 0 }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' }
  ],
  run (input) {
    const units = input.unit === 'characters' ? [...String(input.text).replace(/\s+/g, '')] : words(input.text);
    if (units.length < input.n) {
      return fail('INVALID_INPUT', `There ${units.length === 1 ? "is" : "are"} only ${units.length} ${units.length === 1 ? input.unit.slice(0, -1) : input.unit}, so there are no ${input.n}-grams to take.`, 'n');
    }
    const join = input.unit === 'characters' ? '' : ' ';
    const ngrams = [];
    for (let i = 0; i + input.n <= units.length; i++) ngrams.push(units.slice(i, i + input.n).join(join));
    /* Overlapping windows, so a repeated phrase appears once per position - the
       count and the unique count are different numbers and both are useful. */
    return ok({ ngrams, count: ngrams.length, n: input.n, unit: input.unit, unique: new Set(ngrams).size }, computed());
  }
};
