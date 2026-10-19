import { ok, fail, computed } from '../src/contracts.js';
import { words } from '../src/lib/text.js';
import { round } from '../src/lib/num.js';

export default {
  name: 'similarityJaccard',
  description: 'Measure how much two texts overlap by the words they share.',
  category: 'text', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  title: 'Word overlap',
  replyTemplate: '{{percent}}% overlap — {{shared}} shared {{shared|plural:word:words}} out of {{union}} distinct.',
  inputSchema: {
    type: 'object', required: ['a', 'b'],
    properties: {
      a: { type: 'string', label: 'first text', minLength: 1, prompt: 'What is the first text?' },
      b: { type: 'string', label: 'second text', minLength: 1, prompt: 'What is the second text?' },
      caseSensitive: { type: 'boolean', label: 'match case', default: false }
    }
  },
  outputSchema: { type: 'object', properties: { similarity: { type: 'number' }, percent: { type: 'number' }, shared: { type: 'integer' }, union: { type: 'integer' }, sharedWords: { type: 'array', items: { type: 'string' } }, onlyInA: { type: 'integer' }, onlyInB: { type: 'integer' } } },
  examples: [
    { text: 'how similar are these two sentences', input: { a: 'the quick brown fox', b: 'the quick red fox' }, output: { similarity: 0.6, percent: 60, shared: 3, union: 5, sharedWords: ['the', 'quick', 'fox'], onlyInA: 1, onlyInB: 1 } },
    { text: 'compare two identical texts', input: { a: 'hello world', b: 'hello world' }, output: { similarity: 1, percent: 100, shared: 2, union: 2, sharedWords: ['hello', 'world'], onlyInA: 0, onlyInB: 0 } },
    { text: 'overlap between two unrelated lines', input: { a: 'cats and dogs', b: 'trains and planes' }, output: { similarity: 0.2, percent: 20, shared: 1, union: 5, sharedWords: ['and'], onlyInA: 2, onlyInB: 2 } },
    { text: 'do these product descriptions overlap', input: { a: 'blue cotton shirt', b: 'blue cotton trousers' }, output: { similarity: 0.5, percent: 50, shared: 2, union: 4, sharedWords: ['blue', 'cotton'], onlyInA: 1, onlyInB: 1 } },
    { text: 'similarity of texts sharing nothing', input: { a: 'alpha beta', b: 'gamma delta' }, output: { similarity: 0, percent: 0, shared: 0, union: 4, sharedWords: [], onlyInA: 2, onlyInB: 2 } }
  ],
  errorCases: [
    { input: { a: 'x' }, code: 'MISSING_FIELD' },
    { input: { a: '!!!', b: '???' }, code: 'INVALID_INPUT' },
    { input: { a: '', b: 'y' }, code: 'MISSING_FIELD' }
  ],
  run (input) {
    const norm = (t) => new Set(words(t).map(w => (input.caseSensitive ? w : w.toLowerCase())));
    const A = norm(input.a), B = norm(input.b);
    if (!A.size || !B.size) return fail('INVALID_INPUT', 'One of those texts has no words in it.', A.size ? 'b' : 'a');
    /* Jaccard: shared / total distinct. Set-based, so repetition does not
       inflate the score — two texts that both say "very" ten times are not
       more similar for it. */
    const shared = [...A].filter(w => B.has(w));
    const union = new Set([...A, ...B]).size;
    const similarity = shared.length / union;
    return ok({
      similarity: round(similarity, 4), percent: round(similarity * 100, 2),
      shared: shared.length, union, sharedWords: shared,
      onlyInA: A.size - shared.length, onlyInB: B.size - shared.length
    }, computed());
  }
};
