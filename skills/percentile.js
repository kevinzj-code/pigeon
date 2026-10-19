import { ok, fail, computed } from '../src/contracts.js';
import { percentileOf } from '../src/lib/stats.js';
import { round } from '../src/lib/num.js';

export default {
  name: 'percentile',
  description: 'Find the value at a given percentile in a set of numbers.',
  category: 'statistics', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: 'The {{percentileLabel|prose}} of {{count}} values is {{result}}.',
  inputSchema: {
    type: 'object', required: ['values', 'percentile'],
    properties: {
      values: { type: 'array', label: 'numbers', items: { type: 'number' }, minItems: 1, prompt: 'Which numbers?' },
      percentile: { type: 'number', label: 'percentile', minimum: 0, maximum: 100, prompt: 'Which percentile? (0–100)' }
    }
  },
  outputSchema: { type: 'object', properties: { result: { type: 'number' }, percentile: { type: 'number' }, count: { type: 'integer' }, below: { type: 'integer' }, percentileLabel: { type: 'string' }, method: { type: 'string' } } },
  examples: [
    { text: 'what is the 90th percentile of these response times', input: { values: [12, 15, 18, 22, 30, 45, 60, 90, 120, 300], percentile: 90 }, output: { result: 138, percentile: 90, count: 10, below: 9, percentileLabel: '90th percentile', method: 'linear interpolation (R-7)' } },
    { text: 'median of 1 2 3 4 5', input: { values: [1, 2, 3, 4, 5], percentile: 50 }, output: { result: 3, percentile: 50, count: 5, below: 2, percentileLabel: '50th percentile', method: 'linear interpolation (R-7)' } },
    { text: '25th percentile of these scores', input: { values: [10, 20, 30, 40], percentile: 25 }, output: { result: 17.5, percentile: 25, count: 4, below: 1, percentileLabel: '25th percentile', method: 'linear interpolation (R-7)' } },
    { text: 'p99 of this latency sample', input: { values: [5, 7, 8, 9, 11, 14, 19, 25, 40, 200], percentile: 99 }, output: { result: 185.6, percentile: 99, count: 10, below: 9, percentileLabel: '99th percentile', method: 'linear interpolation (R-7)' } },
    { text: 'the maximum as a percentile', input: { values: [3, 9, 4], percentile: 100 }, output: { result: 9, percentile: 100, count: 3, below: 2, percentileLabel: '100th percentile', method: 'linear interpolation (R-7)' } }
  ],
  errorCases: [
    { input: { values: [], percentile: 50 }, code: 'INVALID_INPUT' },
    { input: { values: [1, 2], percentile: 150 }, code: 'INVALID_INPUT' },
    { input: { values: [1, 2] }, code: 'MISSING_FIELD' }
  ],
  run (input) {
    if (!input.values.length) return fail('INVALID_INPUT', 'There are no numbers to take a percentile of.', 'values');
    const sorted = [...input.values].sort((a, b) => a - b);
    const result = round(percentileOf(sorted, input.percentile), 6);
    const suffix = (n) => {
      const t = n % 100;
      if (t >= 11 && t <= 13) return 'th';
      return ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
    };
    return ok({
      result, percentile: input.percentile, count: sorted.length,
      below: sorted.filter(v => v < result).length,
      percentileLabel: `${input.percentile}${suffix(Math.floor(input.percentile))} percentile`,
      /* Named, because percentile conventions genuinely differ — R alone ships
         nine — and a number without its method is not reproducible. */
      method: 'linear interpolation (R-7)'
    }, computed());
  }
};
