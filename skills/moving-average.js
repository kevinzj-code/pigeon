import { ok, fail, computed } from '../src/contracts.js';
import { round } from '../src/lib/num.js';

export default {
  name: 'movingAverage',
  description: 'Smooth a series of numbers by averaging over a sliding window.',
  category: 'statistics', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{window}}-point moving average: {{averages|list}}.',
  inputSchema: {
    type: 'object', required: ['values', 'window'],
    properties: {
      values: { type: 'array', label: 'numbers', items: { type: 'number' }, minItems: 2, prompt: 'Which numbers?' },
      window: { type: 'integer', label: 'window size', minimum: 2, prompt: 'How many points should each average cover?' },
      type: { type: 'string', label: 'average type', enum: ['simple', 'weighted'], default: 'simple' }
    }
  },
  outputSchema: { type: 'object', properties: { averages: { type: 'array', items: { type: 'number' } }, window: { type: 'integer' }, count: { type: 'integer' }, trend: { type: 'string' }, type: { type: 'string' } } },
  examples: [
    { text: '3 point moving average of these numbers', input: { values: [1, 2, 3, 4, 5], window: 3 }, output: { averages: [2, 3, 4], window: 3, count: 3, trend: 'rising', type: 'simple' } },
    { text: 'smooth these sales figures over 4 months', input: { values: [10, 20, 30, 40, 50, 60], window: 4 }, output: { averages: [25, 35, 45], window: 4, count: 3, trend: 'rising', type: 'simple' } },
    { text: 'moving average of a noisy series', input: { values: [5, 9, 4, 8, 3, 7], window: 2 }, output: { averages: [7, 6.5, 6, 5.5, 5], window: 2, count: 5, trend: 'falling', type: 'simple' } },
    { text: 'weighted moving average favouring recent points', input: { values: [1, 2, 3, 4], window: 3, type: 'weighted' }, output: { averages: [2.3333, 3.3333], window: 3, count: 2, trend: 'rising', type: 'weighted' } },
    { text: 'moving average of a flat series', input: { values: [7, 7, 7, 7], window: 2 }, output: { averages: [7, 7, 7], window: 2, count: 3, trend: 'flat', type: 'simple' } }
  ],
  errorCases: [
    { input: { values: [1, 2], window: 5 }, code: 'INVALID_INPUT' },
    { input: { values: [1, 2, 3], window: 1 }, code: 'INVALID_INPUT' },
    { input: { values: [1, 2, 3] }, code: 'MISSING_FIELD' }
  ],
  run (input) {
    if (input.window > input.values.length) {
      return fail('INVALID_INPUT', `The window is ${input.window} but there are only ${input.values.length} values.`, 'window');
    }
    const averages = [];
    for (let i = 0; i + input.window <= input.values.length; i++) {
      const slice = input.values.slice(i, i + input.window);
      if (input.type === 'weighted') {
        /* Linear weights 1..n, most recent heaviest — the conventional WMA. */
        let num = 0, den = 0;
        slice.forEach((v, k) => { num += v * (k + 1); den += k + 1; });
        averages.push(round(num / den, 4));
      } else {
        averages.push(round(slice.reduce((a, b) => a + b, 0) / input.window, 4));
      }
    }
    /* The smoothed series is what a trend should be read from — that is the
       whole reason for smoothing, so the skill reads it rather than making the
       caller do it again. */
    const first = averages[0], last = averages[averages.length - 1];
    return ok({
      averages, window: input.window, count: averages.length,
      trend: last > first ? 'rising' : last < first ? 'falling' : 'flat',
      type: input.type
    }, computed());
  }
};
