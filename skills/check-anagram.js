import { ok, fail, computed } from '../src/contracts.js';
import { anagramKey } from '../src/lib/words.js';

export default {
  name: 'checkAnagram',
  description: 'Check whether two words or phrases use exactly the same letters.',
  category: 'games', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{summary|prose}}',
  inputSchema: {
    type: 'object', required: ['first', 'second'],
    properties: {
      first: { type: 'string', label: 'first word or phrase', minLength: 1, maxLength: 200, prompt: 'What is the first word or phrase?' },
      second: { type: 'string', label: 'second word or phrase', minLength: 1, maxLength: 200, prompt: 'And the second?' }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      isAnagram: { type: 'boolean' }, letters: { type: 'string' },
      summary: { type: 'string' }, difference: { type: 'string' }
    }
  },
  examples: [
    { text: 'are listen and silent anagrams', input: { first: 'listen', second: 'silent' }, output: { isAnagram: true, letters: 'eilnst', summary: '"listen" and "silent" are anagrams — both use e, i, l, n, s, t.', difference: null } },
    { text: 'is dormitory an anagram of dirty room', input: { first: 'dormitory', second: 'dirty room' }, output: { isAnagram: true, letters: 'dimoorrty', summary: '"dormitory" and "dirty room" are anagrams — both use d, i, m, o, o, r, r, t, y.', difference: null } },
    { text: 'are hello and world anagrams', input: { first: 'hello', second: 'world' }, output: { isAnagram: false, letters: 'ehllo', summary: '"hello" and "world" are not anagrams — "hello" has an extra e, h, l, and "world" has an extra d, r, w.', difference: 'both' } },
    { text: 'check astronomer and moon starer', input: { first: 'Astronomer', second: 'Moon starer' }, output: { isAnagram: true, letters: 'aemnoorrst', summary: '"Astronomer" and "Moon starer" are anagrams — both use a, e, m, n, o, o, r, r, s, t.', difference: null } },
    { text: 'is abc an anagram of abcd', input: { first: 'abc', second: 'abcd' }, output: { isAnagram: false, letters: 'abc', summary: '"abc" and "abcd" are not anagrams — "abcd" has an extra d.', difference: 'second' } }
  ],
  errorCases: [
    { input: { first: '123', second: 'abc' }, code: 'INVALID_INPUT' },
    { input: { first: 'abc' }, code: 'MISSING_FIELD' },
    { input: { first: '  ', second: 'abc' }, code: 'INVALID_INPUT' }
  ],
  run (input) {
    const a = anagramKey(input.first);
    const b = anagramKey(input.second);
    if (!a) return fail('INVALID_INPUT', 'The first one has no letters in it.', 'first');
    if (!b) return fail('INVALID_INPUT', 'The second one has no letters in it.', 'second');

    if (a === b) {
      return ok({
        isAnagram: true, letters: a,
        summary: `"${input.first}" and "${input.second}" are anagrams — both use ${[...a].join(', ')}.`,
        difference: null
      }, computed());
    }

    /* Saying WHICH letters are left over turns "no" into something the reader
       can check, and is the difference between a verdict and an answer. */
    const count = (s) => [...s].reduce((m, c) => m.set(c, (m.get(c) ?? 0) + 1), new Map());
    const ca = count(a); const cb = count(b);
    const extra = (x, y) => [...x].filter(([c, n]) => n > (y.get(c) ?? 0)).flatMap(([c, n]) => Array(n - (y.get(c) ?? 0)).fill(c));
    const onlyFirst = extra(ca, cb);
    const onlySecond = extra(cb, ca);

    const parts = [];
    if (onlyFirst.length) parts.push(`"${input.first}" has an extra ${onlyFirst.join(', ')}`);
    if (onlySecond.length) parts.push(`"${input.second}" has an extra ${onlySecond.join(', ')}`);

    return ok({
      isAnagram: false, letters: a,
      summary: `"${input.first}" and "${input.second}" are not anagrams — ${parts.join(', and ')}.`,
      difference: onlyFirst.length && onlySecond.length ? 'both' : onlyFirst.length ? 'first' : 'second'
    }, computed());
  }
};
