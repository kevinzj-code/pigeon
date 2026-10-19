import { ok, computed } from '../src/contracts.js';
import { round } from '../src/lib/num.js';

/* Grouped thousands, decimals, leading signs, and a trailing % or currency
   symbol. Percentages are returned as the number written, not divided by 100 —
   "15%" extracts as 15, because the user asked what numbers are in the text,
   not what they mean. */
const NUM_RE = /[-−]?\d{1,3}(?:,\d{3})+(?:\.\d+)?|[-−]?\d*\.?\d+(?:[eE][+-]?\d+)?/g;

export default {
  name: 'extractNumbers',
  description: "Take the plain figures out of a text, thousands separators and decimals handled.",
  category: 'text',
  tier: 'core',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{count}} {{count|plural:number:numbers}}: {{numbers|list}} — they add up to {{sum|comma}}.',
  inputSchema: {
    type: 'object',
    required: ['text'],
    properties: { text: { type: 'string', label: 'text', minLength: 1, prompt: 'Which text should I search?' } }
  },
  outputSchema: {
    type: 'object',
    properties: {
      numbers: { type: 'array', items: { type: 'number' } }, count: { type: 'integer' },
      sum: { type: 'number' }, min: { type: 'number' }, max: { type: 'number' }
    }
  },
  examples: [
    { text: 'get the numbers from: we sold 1,250 units at £3.99 each', input: { text: 'we sold 1,250 units at £3.99 each' },
      output: { numbers: [1250, 3.99], count: 2, sum: 1253.99, min: 3.99, max: 1250 } },
    { text: 'pull the figures out of this line', input: { text: 'Q1 42, Q2 58, Q3 61, Q4 39' },
      output: { numbers: [1, 42, 2, 58, 3, 61, 4, 39], count: 8, sum: 210, min: 1, max: 61 } },
    { text: 'extract numbers including negatives', input: { text: 'temperatures ranged from -12.5 to 31.8 degrees' },
      output: { numbers: [-12.5, 31.8], count: 2, sum: 19.3, min: -12.5, max: 31.8 } },
    { text: 'find the numbers in this sentence', input: { text: 'There are no digits written here.' },
      output: { numbers: [], count: 0, sum: 0, min: 0, max: 0 } },
    { text: 'numbers from a shopping list', input: { text: '2 apples, 12 eggs, 1.5 kg flour' },
      output: { numbers: [2, 12, 1.5], count: 3, sum: 15.5, min: 1.5, max: 12 } }
  ],
  errorCases: [
    { input: {}, code: 'MISSING_FIELD' },
    { input: { text: [1, 2, 3] }, code: 'INVALID_INPUT' },
    { input: { text: null }, code: 'MISSING_FIELD' }
  ],
  run (input) {
    const numbers = (input.text.match(NUM_RE) ?? [])
      .map(s => Number(s.replace(/,/g, '').replace('−', '-')))
      .filter(Number.isFinite);
    return ok({
      numbers,
      count: numbers.length,
      sum: round(numbers.reduce((a, b) => a + b, 0), 6),
      /* Zero rather than Infinity on an empty list: Math.min() of nothing is
         Infinity, which would render as a value and read as an answer. */
      min: numbers.length ? Math.min(...numbers) : 0,
      max: numbers.length ? Math.max(...numbers) : 0
    }, computed());
  }
};
