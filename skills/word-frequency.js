import { ok, computed } from '../src/contracts.js';
import { words, STOP_WORDS } from '../src/lib/text.js';

export default {
  name: 'wordFrequency',
  description: 'Which words repeat most in a text — each distinct word ranked by how often it recurs.',
  category: 'text',
  tier: 'core',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: 'Top words: {{top|list}} — out of {{uniqueWords}} unique {{uniqueWords|plural:word:words}} in {{totalWords}}.',
  inputSchema: {
    type: 'object',
    required: ['text'],
    properties: {
      text: { type: 'string', label: 'text', minLength: 1, prompt: 'Which text should I count?' },
      limit: { type: 'integer', label: 'how many words', minimum: 1, maximum: 100, default: 5 },
      removeStopWords: { type: 'boolean', label: 'skip stop words', default: true }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      counts: { type: 'array' }, top: { type: 'array', items: { type: 'string' } },
      totalWords: { type: 'integer' }, uniqueWords: { type: 'integer' }, stopWordsRemoved: { type: 'boolean' }
    }
  },
  examples: [
    { text: 'what words come up most in this text', input: { text: 'the cat sat on the mat the cat purred', limit: 2 },
      output: { counts: [{ word: 'cat', count: 2 }, { word: 'mat', count: 1 }], top: ['cat (2)', 'mat (1)'], totalWords: 9, uniqueWords: 4, stopWordsRemoved: true } },
    { text: 'most common words including the small ones', input: { text: 'the cat sat on the mat', limit: 2, removeStopWords: false },
      output: { counts: [{ word: 'the', count: 2 }, { word: 'cat', count: 1 }], top: ['the (2)', 'cat (1)'], totalWords: 6, uniqueWords: 5, stopWordsRemoved: false } },
    { text: 'word counts for a repeated phrase', input: { text: 'go go go team', limit: 3 },
      output: { counts: [{ word: 'go', count: 3 }, { word: 'team', count: 1 }], top: ['go (3)', 'team (1)'], totalWords: 4, uniqueWords: 2, stopWordsRemoved: true } },
    { text: 'top word in a sentence about testing', input: { text: 'Testing testing one two testing', limit: 1 },
      output: { counts: [{ word: 'testing', count: 3 }], top: ['testing (3)'], totalWords: 5, uniqueWords: 3, stopWordsRemoved: true } },
    { text: 'frequency when every word is a stop word', input: { text: 'the and of to', limit: 3 },
      output: { counts: [], top: [], totalWords: 4, uniqueWords: 0, stopWordsRemoved: true } }
  ],
  errorCases: [
    { input: {}, code: 'MISSING_FIELD' },
    { input: { text: 'hi', limit: 0 }, code: 'INVALID_INPUT' },
    { input: { text: ['a', 'b'] }, code: 'INVALID_INPUT' }
  ],
  run (input) {
    const all = words(input.text).map(w => w.toLowerCase());
    const kept = input.removeStopWords ? all.filter(w => !STOP_WORDS.has(w)) : all;
    const freq = new Map();
    for (const w of kept) freq.set(w, (freq.get(w) ?? 0) + 1);
    /* Ties broken alphabetically so the same text always ranks the same way. */
    const counts = [...freq]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, input.limit)
      .map(([word, count]) => ({ word, count }));
    return ok({
      counts,
      top: counts.map(c => `${c.word} (${c.count})`),
      totalWords: all.length,
      uniqueWords: freq.size,
      stopWordsRemoved: input.removeStopWords
    }, computed());
  }
};
