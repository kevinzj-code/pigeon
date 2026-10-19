import { ok, fail, computed } from '../src/contracts.js';
import { round } from '../src/lib/num.js';

export default {
  name: 'weightedAverage',
  description: 'Average a set of values where some count for more than others.',
  category: 'statistics',
  tier: 'core',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: 'The weighted average is {{result}} (the plain average would be {{plainAverage}}).',
  inputSchema: {
    type: 'object',
    required: ['values', 'weights'],
    properties: {
      values: { type: 'array', label: 'values', items: { type: 'number' }, minItems: 1, prompt: 'Which values?' },
      weights: { type: 'array', label: 'weights', items: { type: 'number' }, minItems: 1, prompt: 'What weight does each one carry?' }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      result: { type: 'number' }, plainAverage: { type: 'number' }, totalWeight: { type: 'number' },
      count: { type: 'integer' }, contributions: { type: 'array', items: { type: 'number' } }
    }
  },
  examples: [
    { text: 'weighted average of 80 and 90 where the second counts double', input: { values: [80, 90], weights: [1, 2] },
      output: { result: 86.67, plainAverage: 85, totalWeight: 3, count: 2, contributions: [26.67, 60] } },
    { text: 'my grades 72 85 91 with credits 10 20 30', input: { values: [72, 85, 91], weights: [10, 20, 30] },
      output: { result: 85.83, plainAverage: 82.67, totalWeight: 60, count: 3, contributions: [12, 28.33, 45.5] } },
    { text: 'weighted average where all weights are equal', input: { values: [10, 20, 30], weights: [1, 1, 1] },
      output: { result: 20, plainAverage: 20, totalWeight: 3, count: 3, contributions: [3.33, 6.67, 10] } },
    { text: 'average price weighted by quantity', input: { values: [2.5, 4], weights: [100, 25] },
      output: { result: 2.8, plainAverage: 3.25, totalWeight: 125, count: 2, contributions: [2, 0.8] } },
    { text: 'weighted score with a zero weight', input: { values: [50, 100], weights: [0, 1] },
      output: { result: 100, plainAverage: 75, totalWeight: 1, count: 2, contributions: [0, 100] } }
  ],
  errorCases: [
    { input: { values: [1, 2], weights: [1] }, code: 'INVALID_INPUT' },
    { input: { values: [1, 2], weights: [0, 0] }, code: 'INVALID_INPUT' },
    { input: { values: [1, 2] }, code: 'MISSING_FIELD' }
  ],
  run (input) {
    if (input.values.length !== input.weights.length) {
      return fail('INVALID_INPUT', `There are ${input.values.length} values but ${input.weights.length} weights — they have to match up.`, 'weights');
    }
    if (input.weights.some(w => w < 0)) return fail('INVALID_INPUT', 'A weight cannot be negative.', 'weights');
    const totalWeight = input.weights.reduce((a, b) => a + b, 0);
    if (totalWeight === 0) return fail('INVALID_INPUT', 'The weights add up to zero, so there is nothing to average.', 'weights');

    const weighted = input.values.reduce((acc, v, i) => acc + v * input.weights[i], 0);
    return ok({
      result: round(weighted / totalWeight, 2),
      plainAverage: round(input.values.reduce((a, b) => a + b, 0) / input.values.length, 2),
      totalWeight: round(totalWeight, 6),
      count: input.values.length,
      /* How much of the answer each value is responsible for — the thing
         people actually want to see when a weighted average surprises them. */
      contributions: input.values.map((v, i) => round(v * input.weights[i] / totalWeight, 2))
    }, computed());
  }
};
