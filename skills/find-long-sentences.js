import { ok, computed } from '../src/contracts.js';
import { sentences, words } from '../src/lib/text.js';
import { round } from '../src/lib/num.js';

export default {
  name: 'findLongSentences',
  description: "Spot the sentences that run on past a word limit.",
  category: 'writing', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{count}} of {{totalSentences}} {{totalSentences|plural:sentence:sentences}} run past {{threshold}} words. Average length {{averageWords}}.\n{{lines|lines}}',
  inputSchema: {
    type: 'object', required: ['text'],
    properties: {
      text: { type: 'string', label: 'text', minLength: 1, maxLength: 100000, prompt: 'Which text should I check?' },
      threshold: { type: 'integer', label: 'max words per sentence', minimum: 5, maximum: 200, default: 25 }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      long: { type: 'array' }, lines: { type: 'array', items: { type: 'string' } },
      count: { type: 'integer' }, totalSentences: { type: 'integer' },
      threshold: { type: 'integer' }, averageWords: { type: 'number' }, longestWords: { type: 'integer' }
    }
  },
  examples: [
    { text: 'find the long sentences in this', input: { text: 'This is short. This sentence, on the other hand, goes on for a considerable length and contains a great many words indeed.', threshold: 15 }, output: { long: [{ index: 2, words: 19, text: 'This sentence, on the other hand, goes on for a considerable length and contains a great many words indeed.' }], lines: ['Sentence 2, 19 words: This sentence, on the other hand, goes on for a considerable length and contains a great many words indeed.'], count: 1, totalSentences: 2, threshold: 15, averageWords: 11, longestWords: 19 } },
    { text: 'are any of my sentences too long', input: { text: 'A brief note. Another brief note. And one more.', threshold: 10 }, output: { long: [], lines: [], count: 0, totalSentences: 3, threshold: 10, averageWords: 3, longestWords: 3 } },
    { text: 'check this paragraph for long sentences', input: { text: 'The quick brown fox jumps over the lazy dog and then keeps running through the field for a very long time without stopping at all.', threshold: 20 }, output: { long: [{ index: 1, words: 25, text: 'The quick brown fox jumps over the lazy dog and then keeps running through the field for a very long time without stopping at all.' }], lines: ['Sentence 1, 25 words: The quick brown fox jumps over the lazy dog and then keeps running through the field for a very long time without stopping at all.'], count: 1, totalSentences: 1, threshold: 20, averageWords: 25, longestWords: 25 } },
    { text: 'which sentences should I split up', input: { text: 'One sentence only, but it happens to be quite a long one with many words in it indeed.', threshold: 15 }, output: { long: [{ index: 1, words: 18, text: 'One sentence only, but it happens to be quite a long one with many words in it indeed.' }], lines: ['Sentence 1, 18 words: One sentence only, but it happens to be quite a long one with many words in it indeed.'], count: 1, totalSentences: 1, threshold: 15, averageWords: 18, longestWords: 18 } },
    { text: 'sentence length check on this draft', input: { text: 'Short. Also short. This third one is deliberately padded out with extra words so that it comfortably exceeds the limit we are testing against here.', threshold: 20 }, output: { long: [{ index: 3, words: 22, text: 'This third one is deliberately padded out with extra words so that it comfortably exceeds the limit we are testing against here.' }], lines: ['Sentence 3, 22 words: This third one is deliberately padded out with extra words so that it comfortably exceeds the limit we are testing against here.'], count: 1, totalSentences: 3, threshold: 20, averageWords: 8.33, longestWords: 22 } }
  ],
  errorCases: [
    { input: {}, code: 'MISSING_FIELD' },
    { input: { text: 'x', threshold: 2 }, code: 'INVALID_INPUT' },
    { input: { text: '' }, code: 'MISSING_FIELD' }
  ],
  run (input) {
    const all = sentences(input.text).map((text, i) => ({ index: i + 1, words: words(text).length, text }));
    const long = all.filter((s) => s.words > input.threshold);
    const total = all.reduce((a, s) => a + s.words, 0);

    /* Reported as "longer than the threshold", strictly — a 25-word sentence
       does not run past a 25-word limit, and an off-by-one here would flag
       every sentence written to exactly the limit. */
    return ok({
      long, lines: long.map((s) => `Sentence ${s.index}, ${s.words} words: ${s.text}`),
      count: long.length, totalSentences: all.length, threshold: input.threshold,
      averageWords: all.length ? round(total / all.length, 2) : 0,
      longestWords: all.length ? Math.max(...all.map((s) => s.words)) : 0
    }, computed());
  }
};
