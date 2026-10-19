import { ok, computed } from '../src/contracts.js';
import { words } from '../src/lib/text.js';

export default {
  name: 'detectRepetition',
  description: 'Find phrases a piece of text repeats.',
  category: 'text', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{count}} repeated {{count|plural:phrase:phrases}} of {{minWords}} words or more: {{lines|list}}.',
  inputSchema: {
    type: 'object', required: ['text'],
    properties: {
      text: { type: 'string', label: 'text', minLength: 1, maxLength: 50000, prompt: 'Which text should I check for repetition?' },
      minWords: { type: 'integer', label: 'min words in phrase', minimum: 2, maximum: 12, default: 3 },
      minTimes: { type: 'integer', label: 'min times it appears', minimum: 2, maximum: 50, default: 2 }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      repeated: { type: 'array' }, lines: { type: 'array', items: { type: 'string' } },
      count: { type: 'integer' }, minWords: { type: 'integer' }, wordCount: { type: 'integer' }
    }
  },
  examples: [
    { text: 'find repeated phrases', input: { text: 'I think that I think that this is fine' } , output: { repeated: [{ phrase: 'i think that', times: 2, words: 3 }], lines: ['"i think that" 2 times'], count: 1, minWords: 3, wordCount: 9 } },
    { text: 'is this text repetitive', input: { text: 'the cat sat on the mat' }, output: { repeated: [], lines: [], count: 0, minWords: 3, wordCount: 6 } },
    { text: 'check for repeated phrases of two words', input: { text: 'very good very good indeed', minWords: 2 }, output: { repeated: [{ phrase: 'very good', times: 2, words: 2 }], lines: ['"very good" 2 times'], count: 1, minWords: 2, wordCount: 5 } },
    { text: 'find phrases used three times', input: { text: 'do it now do it now do it now', minWords: 3, minTimes: 3 }, output: { repeated: [{ phrase: 'do it now', times: 3, words: 3 }], lines: ['"do it now" 3 times'], count: 1, minWords: 3, wordCount: 9 } },
    { text: 'spot repetition in this paragraph', input: { text: 'at the end of the day at the end of the day we tried', minWords: 4 }, output: { repeated: [{ phrase: 'at the end of the day', times: 2, words: 6 }], lines: ['"at the end of the day" 2 times'], count: 1, minWords: 4, wordCount: 14 } }
  ],
  errorCases: [
    { input: {}, code: 'MISSING_FIELD' },
    { input: { text: '' }, code: 'MISSING_FIELD' },
    { input: { text: 'a b', minWords: 1 }, code: 'INVALID_INPUT' }
  ],
  run (input) {
    const list = words(input.text).map((w) => w.toLowerCase());
    const seen = new Map();
    /* Every window length from the minimum upwards, so the LONGEST repeated
       phrase is found rather than only its first few words. */
    for (let n = input.minWords; n <= Math.min(list.length, 25); n++) {
      for (let i = 0; i + n <= list.length; i++) {
        const phrase = list.slice(i, i + n).join(' ');
        seen.set(phrase, (seen.get(phrase) ?? 0) + 1);
      }
    }

    const hits = [...seen.entries()]
      .filter(([, times]) => times >= input.minTimes)
      .map(([phrase, times]) => ({ phrase, times, words: phrase.split(' ').length }));

    /* A repeated six-word phrase also repeats every shorter phrase inside it.
       Reporting all of them buries the finding, so a phrase contained in a
       longer one that repeats at least as often is dropped. */
    const kept = hits.filter((h) => !hits.some((other) =>
      other !== h && other.words > h.words && other.times >= h.times && other.phrase.includes(h.phrase)));
    kept.sort((a, b) => b.words - a.words || b.times - a.times || a.phrase.localeCompare(b.phrase));

    return ok({
      repeated: kept, lines: kept.map((k) => `"${k.phrase}" ${k.times} times`),
      count: kept.length, minWords: input.minWords, wordCount: list.length
    }, computed());
  }
};
