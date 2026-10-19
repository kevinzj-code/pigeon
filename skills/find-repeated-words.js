import { ok, computed } from '../src/contracts.js';
import { words, STOP_WORDS } from '../src/lib/text.js';

export default {
  name: 'findRepeatedWords',
  description: "Spot a word used again too soon after itself.",
  category: 'writing', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{count}} {{count|plural:word:words}} repeated within {{window}} words of themselves: {{lines|list}}.',
  inputSchema: {
    type: 'object', required: ['text'],
    properties: {
      text: { type: 'string', label: 'text', minLength: 1, maxLength: 100000, prompt: 'Which text should I check?' },
      window: { type: 'integer', label: 'max words apart', minimum: 2, maximum: 500, default: 50, description: 'how close two uses have to be to count as a repeat' },
      minLength: { type: 'integer', label: 'min word length', minimum: 1, maximum: 20, default: 4 }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      repeats: { type: 'array' }, lines: { type: 'array', items: { type: 'string' } },
      count: { type: 'integer' }, window: { type: 'integer' }, wordCount: { type: 'integer' }
    }
  },
  examples: [
    { text: 'find repeated words in this text', input: { text: 'The report says the report is late because the report was delayed.' }, output: { repeats: [{ word: 'report', count: 3, closest: 3, positions: [2, 5, 10] }], lines: ['report, 3 times, closest 3 words apart'], count: 1, window: 50, wordCount: 12 } },
    { text: 'am I repeating myself', input: { text: 'No repeats here at all my friend.' }, output: { repeats: [], lines: [], count: 0, window: 50, wordCount: 7 } },
    { text: 'check for word repetition', input: { text: 'The design is a good design, and the design works.' }, output: { repeats: [{ word: 'design', count: 3, closest: 3, positions: [2, 6, 9] }], lines: ['design, 3 times, closest 3 words apart'], count: 1, window: 50, wordCount: 10 } },
    { text: 'spot repeated words only when they are very close together', input: { text: 'Quality matters. We build quality into everything we make because quality is what people notice.', window: 3 }, output: { repeats: [], lines: [], count: 0, window: 3, wordCount: 15 } },
    { text: 'find words I have used twice', input: { text: 'Careful writing rewards careful reading.' }, output: { repeats: [{ word: 'careful', count: 2, closest: 3, positions: [1, 4] }], lines: ['careful, 2 times, closest 3 words apart'], count: 1, window: 50, wordCount: 5 } }
  ],
  errorCases: [
    { input: {}, code: 'MISSING_FIELD' },
    { input: { text: '' }, code: 'MISSING_FIELD' },
    { input: { text: 'x', window: 1 }, code: 'INVALID_INPUT' }
  ],
  run (input) {
    const list = words(input.text).map((w) => w.toLowerCase());
    const seen = new Map();
    list.forEach((w, i) => {
      /* Stop words are skipped: "the" appearing four times in a paragraph is
         English working normally, not a tic worth flagging. */
      if (w.length < input.minLength || STOP_WORDS.has(w)) return;
      if (!seen.has(w)) seen.set(w, []);
      seen.get(w).push(i + 1);
    });

    const repeats = [];
    for (const [word, positions] of seen) {
      if (positions.length < 2) continue;
      const gaps = positions.slice(1).map((p, i) => p - positions[i]);
      const closest = Math.min(...gaps);
      /* Only near repeats count. The same word twice in a long document is
         normal; twice in one breath is the thing a writer wants to see. */
      if (closest > input.window) continue;
      repeats.push({ word, count: positions.length, closest, positions });
    }
    repeats.sort((a, b) => b.count - a.count || a.closest - b.closest || a.word.localeCompare(b.word));

    return ok({
      repeats, lines: repeats.map((r) => `${r.word}, ${r.count} times, closest ${r.closest} words apart`),
      count: repeats.length, window: input.window, wordCount: list.length
    }, computed());
  }
};
