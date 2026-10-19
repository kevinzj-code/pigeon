import { ok, fail, computed } from '../src/contracts.js';
import { round } from '../src/lib/num.js';

export default {
  name: 'describeNumbers',
  description: 'Summarise a list of numbers — its mean, median, mode, minimum, maximum, range and spread.',
  category: 'statistics',
  tier: 'core',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{count}} {{count|plural:value:values}}: mean {{mean}}, median {{median}}, range {{min}} to {{max}}, standard deviation {{stdDev}}.',
  inputSchema: {
    type: 'object',
    required: ['values'],
    properties: {
      values: { type: 'array', label: 'numbers', items: { type: 'number' }, minItems: 1, prompt: 'Which numbers should I summarise?' },
      sample: { type: 'boolean', label: 'treat as sample', default: false, description: 'treat the values as a sample rather than the whole population' }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      count: { type: 'integer' }, sum: { type: 'number' }, mean: { type: 'number' },
      median: { type: 'number' }, mode: { type: 'array', items: { type: 'number' } },
      min: { type: 'number' }, max: { type: 'number' }, range: { type: 'number' },
      stdDev: { type: 'number' }, variance: { type: 'number' }, basis: { type: 'string' }
    }
  },
  examples: [
    { text: 'summarise 4, 8, 15, 16, 23, 42', input: { values: [4, 8, 15, 16, 23, 42] },
      output: { count: 6, sum: 108, mean: 18, median: 15.5, mode: [], min: 4, max: 42, range: 38, stdDev: 12.3153, variance: 151.6667, basis: 'population' } },
    { text: 'mean and median of 10 20 30 40', input: { values: [10, 20, 30, 40] },
      output: { count: 4, sum: 100, mean: 25, median: 25, mode: [], min: 10, max: 40, range: 30, stdDev: 11.1803, variance: 125, basis: 'population' } },
    { text: 'stats for my test scores 88 92 79 92 85', input: { values: [88, 92, 79, 92, 85] },
      output: { count: 5, sum: 436, mean: 87.2, median: 88, mode: [92], min: 79, max: 92, range: 13, stdDev: 4.8744, variance: 23.76, basis: 'population' } },
    { text: 'sample standard deviation of 2 4 4 4 5 5 7 9', input: { values: [2, 4, 4, 4, 5, 5, 7, 9], sample: true },
      output: { count: 8, sum: 40, mean: 5, median: 4.5, mode: [4], min: 2, max: 9, range: 7, stdDev: 2.1381, variance: 4.5714, basis: 'sample' } },
    { text: 'describe a single value 7', input: { values: [7] },
      output: { count: 1, sum: 7, mean: 7, median: 7, mode: [], min: 7, max: 7, range: 0, stdDev: 0, variance: 0, basis: 'population' } },
    { text: 'mean and spread of these values: 5 9 12 4 20', input: { values: [5, 9, 12, 4, 20] },
      output: { count: 5, sum: 50, mean: 10, median: 9, mode: [], min: 4, max: 20, range: 16, stdDev: 5.7619, variance: 33.2, basis: 'population' } },
    { text: 'give me the average, median and range for 3 7 7 10 18', input: { values: [3, 7, 7, 10, 18] },
      output: { count: 5, sum: 45, mean: 9, median: 7, mode: [7], min: 3, max: 18, range: 15, stdDev: 5.02, variance: 25.2, basis: 'population' } }
  ],
  errorCases: [
    { input: { values: [] }, code: 'INVALID_INPUT' },
    { input: { values: [1, 'two', 3] }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' }
  ],
  run (input) {
    const v = input.values;
    if (!v.length) return fail('INVALID_INPUT', 'There are no numbers to summarise.', 'values');
    if (input.sample && v.length < 2) return fail('INVALID_INPUT', 'A sample standard deviation needs at least two values.', 'values');

    const sorted = [...v].sort((a, b) => a - b);
    const n = v.length;
    const sum = v.reduce((a, b) => a + b, 0);
    const mean = sum / n;
    const median = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;

    const freq = new Map();
    for (const x of v) freq.set(x, (freq.get(x) ?? 0) + 1);
    const top = Math.max(...freq.values());
    /* No mode at all when nothing repeats — reporting every value as "the mode"
       is technically defensible and practically useless. */
    const mode = top === 1 ? [] : [...freq].filter(([, c]) => c === top).map(([x]) => x).sort((a, b) => a - b);

    const divisor = input.sample ? n - 1 : n;
    const variance = v.reduce((acc, x) => acc + (x - mean) ** 2, 0) / divisor;

    return ok({
      count: n, sum: round(sum, 6), mean: round(mean, 6), median: round(median, 6), mode,
      min: sorted[0], max: sorted[n - 1], range: round(sorted[n - 1] - sorted[0], 6),
      stdDev: round(Math.sqrt(variance), 4), variance: round(variance, 4),
      basis: input.sample ? 'sample' : 'population'
    }, computed());
  }
};
