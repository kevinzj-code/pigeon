import { ok, fail, computed } from '../src/contracts.js';
import { quartilesOf } from '../src/lib/stats.js';
import { round } from '../src/lib/num.js';

export default {
  name: 'quartiles',
  description: 'Split a set of numbers into quartiles and give the interquartile range.',
  category: 'statistics', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: 'Median {{q2}}, with {{q1}} and {{q3}} at the edges of the middle range — an interquartile range of {{iqr}}.',
  inputSchema: {
    type: 'object', required: ['values'],
    properties: { values: { type: 'array', label: 'numbers', items: { type: 'number' }, minItems: 2, prompt: 'Which numbers?' } }
  },
  outputSchema: { type: 'object', properties: { q1: { type: 'number' }, q2: { type: 'number' }, q3: { type: 'number' }, iqr: { type: 'number' }, min: { type: 'number' }, max: { type: 'number' }, lowerFence: { type: 'number' }, upperFence: { type: 'number' }, count: { type: 'integer' } } },
  examples: [
    { text: 'quartiles of 1 through 8', input: { values: [1, 2, 3, 4, 5, 6, 7, 8] }, output: { q1: 2.75, q2: 4.5, q3: 6.25, iqr: 3.5, min: 1, max: 8, lowerFence: -2.5, upperFence: 11.5, count: 8 } },
    { text: 'interquartile range of these scores', input: { values: [10, 20, 30, 40, 50] }, output: { q1: 20, q2: 30, q3: 40, iqr: 20, min: 10, max: 50, lowerFence: -10, upperFence: 70, count: 5 } },
    { text: 'quartiles for a skewed set', input: { values: [1, 1, 2, 3, 100] }, output: { q1: 1, q2: 2, q3: 3, iqr: 2, min: 1, max: 100, lowerFence: -2, upperFence: 6, count: 5 } },
    { text: 'q1 and q3 of these times', input: { values: [12, 15, 18, 22, 30, 45] }, output: { q1: 15.75, q2: 20, q3: 28, iqr: 12.25, min: 12, max: 45, lowerFence: -2.625, upperFence: 46.375, count: 6 } },
    { text: 'quartiles of two values', input: { values: [4, 8] }, output: { q1: 5, q2: 6, q3: 7, iqr: 2, min: 4, max: 8, lowerFence: 2, upperFence: 10, count: 2 } }
  ],
  errorCases: [
    { input: { values: [5] }, code: 'INVALID_INPUT' },
    { input: { values: [] }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' }
  ],
  run (input) {
    if (input.values.length < 2) return fail('INVALID_INPUT', 'I need at least two numbers to split into quartiles.', 'values');
    const q = quartilesOf(input.values);
    const r = (n) => round(n, 6);
    /* The 1.5×IQR fences come along because "are there outliers" is what people
       ask immediately after "what are the quartiles". findOutliers uses the
       same helper, so the two skills cannot disagree. */
    return ok({
      q1: r(q.q1), q2: r(q.q2), q3: r(q.q3), iqr: r(q.iqr),
      min: q.sorted[0], max: q.sorted[q.sorted.length - 1],
      lowerFence: r(q.lowerFence), upperFence: r(q.upperFence),
      count: input.values.length
    }, computed());
  }
};
