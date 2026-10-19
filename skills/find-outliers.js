import { ok, fail, computed } from '../src/contracts.js';
import { quartilesOf, mean, stdDev } from '../src/lib/stats.js';
import { round } from '../src/lib/num.js';

export default {
  name: 'findOutliers',
  description: 'Spot the values sitting way off from the rest of a set.',
  category: 'statistics', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{count}} {{count|plural:outlier:outliers}} by the {{method|prose}} rule: {{outliers|list}}.',
  inputSchema: {
    type: 'object', required: ['values'],
    properties: {
      values: { type: 'array', label: 'numbers', items: { type: 'number' }, minItems: 4, prompt: 'Which numbers?' },
      method: { type: 'string', label: 'method', enum: ['iqr', 'zscore'], default: 'iqr' },
      threshold: { type: 'number', label: 'z-score cutoff', exclusiveMinimum: 0, default: 3, description: 'z-score cutoff, when using zscore' }
    }
  },
  outputSchema: { type: 'object', properties: { outliers: { type: 'array', items: { type: 'number' } }, count: { type: 'integer' }, method: { type: 'string' }, lowerBound: { type: 'number' }, upperBound: { type: 'number' }, clean: { type: 'array', items: { type: 'number' } } } },
  examples: [
    { text: 'find the outliers in these numbers', input: { values: [10, 12, 11, 13, 12, 90] }, output: { outliers: [90], count: 1, method: 'iqr', lowerBound: 9, upperBound: 15, clean: [10, 12, 11, 13, 12] } },
    { text: 'any outliers in this data', input: { values: [5, 6, 7, 8, 9, 10] }, output: { outliers: [], count: 0, method: 'iqr', lowerBound: 2.5, upperBound: 12.5, clean: [5, 6, 7, 8, 9, 10] } },
    { text: 'spot unusual values by z-score', input: { values: [10, 11, 12, 11, 10, 60], method: 'zscore', threshold: 1.5 }, output: { outliers: [60], count: 1, method: 'zscore', lowerBound: -8.5227, upperBound: 46.5227, clean: [10, 11, 12, 11, 10] } },
    { text: 'find outliers at both ends', input: { values: [-50, 10, 11, 12, 13, 70] }, output: { outliers: [-50, 70], count: 2, method: 'iqr', lowerBound: 6.5, upperBound: 16.5, clean: [10, 11, 12, 13] } },
    { text: 'outliers in response times', input: { values: [100, 105, 98, 102, 99, 101, 5000] }, output: { outliers: [5000], count: 1, method: 'iqr', lowerBound: 93.5, upperBound: 109.5, clean: [100, 105, 98, 102, 99, 101] } },
    { text: 'is anything way out of line in 8 9 10 11 50', input: { values: [8, 9, 10, 11, 50] },
      output: { outliers: [50], count: 1, method: 'iqr', lowerBound: 6, upperBound: 14, clean: [8, 9, 10, 11] } },
    { text: 'which of these readings is off from the rest', input: { values: [21, 22, 20, 23, 21, 95] },
      output: { outliers: [95], count: 1, method: 'iqr', lowerBound: 18.375, upperBound: 25.375, clean: [21, 22, 20, 23, 21] } }
  ],
  errorCases: [
    { input: { values: [1, 2] }, code: 'INVALID_INPUT' },
    { input: { values: [1, 1, 1, 1], method: 'zscore' }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' }
  ],
  run (input) {
    if (input.values.length < 4) return fail('INVALID_INPUT', 'I need at least four numbers before "unusual" means anything.', 'values');

    let lowerBound, upperBound;
    if (input.method === 'zscore') {
      const sd = stdDev(input.values);
      /* No spread means no z-score: every value is the mean, and dividing by
         zero would report every point as infinitely unusual. */
      if (sd === 0) return fail('INVALID_INPUT', 'Every value is the same, so none of them is unusual.', 'values');
      const m = mean(input.values);
      lowerBound = m - input.threshold * sd;
      upperBound = m + input.threshold * sd;
    } else {
      const q = quartilesOf(input.values);
      lowerBound = q.lowerFence;
      upperBound = q.upperFence;
    }
    const outliers = input.values.filter(v => v < lowerBound || v > upperBound);
    return ok({
      outliers, count: outliers.length, method: input.method,
      lowerBound: round(lowerBound, 4), upperBound: round(upperBound, 4),
      clean: input.values.filter(v => v >= lowerBound && v <= upperBound)
    }, computed());
  }
};
