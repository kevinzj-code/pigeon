import { ok, computed } from '../src/contracts.js';
import { levenshtein } from '../src/lib/text.js';
import { round } from '../src/lib/num.js';

export default {
  name: 'similarityLevenshtein',
  description: 'Measure how many single-character edits turn one string into another, and how similar that makes them.',
  category: 'text', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  title: 'Edit distance',
  replyTemplate: '{{distance}} {{distance|plural:edit:edits}} apart — {{percent}}% similar.',
  inputSchema: {
    type: 'object', required: ['a', 'b'],
    properties: {
      a: { type: 'string', label: 'first text', prompt: 'What is the first string?' },
      b: { type: 'string', label: 'second text', prompt: 'What is the second string?' },
      caseSensitive: { type: 'boolean', label: 'match case', default: false }
    }
  },
  outputSchema: { type: 'object', properties: { distance: { type: 'integer' }, percent: { type: 'number' }, similarity: { type: 'number' }, a: { type: 'string' }, b: { type: 'string' }, identical: { type: 'boolean' } } },
  examples: [
    { text: 'how different are kitten and sitting', input: { a: 'kitten', b: 'sitting' }, output: { distance: 3, percent: 57.14, similarity: 0.5714, a: 'kitten', b: 'sitting', identical: false } },
    { text: 'edit distance between colour and color', input: { a: 'colour', b: 'color' }, output: { distance: 1, percent: 83.33, similarity: 0.8333, a: 'colour', b: 'color', identical: false } },
    { text: 'how similar are these two names', input: { a: 'Jonathan', b: 'Johnathan' }, output: { distance: 1, percent: 88.89, similarity: 0.8889, a: 'Jonathan', b: 'Johnathan', identical: false } },
    { text: 'compare two identical strings', input: { a: 'exact', b: 'exact' }, output: { distance: 0, percent: 100, similarity: 1, a: 'exact', b: 'exact', identical: true } },
    { text: 'distance between totally different words', input: { a: 'abc', b: 'xyz' }, output: { distance: 3, percent: 0, similarity: 0, a: 'abc', b: 'xyz', identical: false } }
  ],
  errorCases: [
    { input: { a: 'x' }, code: 'MISSING_FIELD' },
    { input: { b: 'y' }, code: 'MISSING_FIELD' },
    { input: { a: ['x'], b: 'y' }, code: 'INVALID_INPUT' }
  ],
  run (input) {
    const a = input.caseSensitive ? input.a : input.a.toLowerCase();
    const b = input.caseSensitive ? input.b : input.b.toLowerCase();
    const distance = levenshtein(a, b);
    /* Normalised by the LONGER string, so the ratio is bounded 0–1 and
       "abc" vs "abcdefghij" reads as very different rather than 3 edits from
       something short. */
    const longest = Math.max(a.length, b.length) || 1;
    const similarity = 1 - distance / longest;
    return ok({
      distance, percent: round(similarity * 100, 2), similarity: round(similarity, 4),
      a: input.a, b: input.b, identical: distance === 0
    }, computed());
  }
};
