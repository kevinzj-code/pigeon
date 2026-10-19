import { ok, fail, computed } from '../src/contracts.js';
import { mean, stdDev } from '../src/lib/stats.js';
import { round } from '../src/lib/num.js';

export default {
  name: 'zScores',
  description: 'Standardise a set of numbers — how many standard deviations each value sits from the mean.',
  category: 'statistics', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  title: 'Z-scores',
  replyTemplate: 'Mean {{mean}}, standard deviation {{stdDev}}. Z-scores: {{scores|list}}.',
  inputSchema: {
    type: 'object', required: ['values'],
    properties: {
      values: { type: 'array', label: 'numbers', items: { type: 'number' }, minItems: 2, prompt: 'Which numbers?' },
      sample: { type: 'boolean', label: 'treat as sample', default: false }
    }
  },
  outputSchema: { type: 'object', properties: { scores: { type: 'array', items: { type: 'number' } }, mean: { type: 'number' }, stdDev: { type: 'number' }, pairs: { type: 'array' }, mostUnusual: { type: 'number' }, basis: { type: 'string' } } },
  examples: [
    { text: 'z-scores for these test results', input: { values: [70, 80, 90] }, output: { scores: [-1.2247, 0, 1.2247], mean: 80, stdDev: 8.1650, pairs: [{ value: 70, z: -1.2247 }, { value: 80, z: 0 }, { value: 90, z: 1.2247 }], mostUnusual: 70, basis: 'population' } },
    { text: 'how unusual is each of these', input: { values: [2, 4, 4, 4, 5, 5, 7, 9] }, output: { scores: [-1.5, -0.5, -0.5, -0.5, 0, 0, 1, 2], mean: 5, stdDev: 2, pairs: [{ value: 2, z: -1.5 }, { value: 4, z: -0.5 }, { value: 4, z: -0.5 }, { value: 4, z: -0.5 }, { value: 5, z: 0 }, { value: 5, z: 0 }, { value: 7, z: 1 }, { value: 9, z: 2 }], mostUnusual: 9, basis: 'population' } },
    { text: 'standardise these two values', input: { values: [10, 20] }, output: { scores: [-1, 1], mean: 15, stdDev: 5, pairs: [{ value: 10, z: -1 }, { value: 20, z: 1 }], mostUnusual: 10, basis: 'population' } },
    { text: 'sample z-scores for this data', input: { values: [1, 2, 3, 4], sample: true }, output: { scores: [-1.1619, -0.3873, 0.3873, 1.1619], mean: 2.5, stdDev: 1.2910, pairs: [{ value: 1, z: -1.1619 }, { value: 2, z: -0.3873 }, { value: 3, z: 0.3873 }, { value: 4, z: 1.1619 }], mostUnusual: 1, basis: 'sample' } },
    { text: 'which value is furthest from the mean', input: { values: [5, 5, 5, 25] }, output: { scores: [-0.5774, -0.5774, -0.5774, 1.7321], mean: 10, stdDev: 8.6603, pairs: [{ value: 5, z: -0.5774 }, { value: 5, z: -0.5774 }, { value: 5, z: -0.5774 }, { value: 25, z: 1.7321 }], mostUnusual: 25, basis: 'population' } }
  ],
  errorCases: [
    { input: { values: [7, 7, 7] }, code: 'INVALID_INPUT' },
    { input: { values: [5] }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' }
  ],
  run (input) {
    if (input.values.length < 2) return fail('INVALID_INPUT', 'I need at least two numbers.', 'values');
    if (input.sample && input.values.length < 2) return fail('INVALID_INPUT', 'A sample standard deviation needs at least two values.', 'values');
    const sd = stdDev(input.values, input.sample);
    /* Every value identical means no spread, and every z-score would be 0/0.
       Refusing beats reporting NaN dressed up as a number. */
    if (sd === 0) return fail('INVALID_INPUT', 'Every value is the same, so there is no spread to measure against.', 'values');
    const m = mean(input.values);
    const scores = input.values.map(v => round((v - m) / sd, 4));
    const pairs = input.values.map((v, i) => ({ value: v, z: scores[i] }));
    const furthest = pairs.reduce((best, p) => (Math.abs(p.z) > Math.abs(best.z) ? p : best), pairs[0]);
    return ok({
      scores, mean: round(m, 4), stdDev: round(sd, 4), pairs,
      mostUnusual: furthest.value, basis: input.sample ? 'sample' : 'population'
    }, computed());
  }
};
