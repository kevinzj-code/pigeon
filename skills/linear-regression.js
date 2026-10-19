import { ok, fail, computed } from '../src/contracts.js';
import { pearson, mean } from '../src/lib/stats.js';
import { round } from '../src/lib/num.js';

export default {
  name: 'linearRegression',
  description: 'Fit a straight line through a set of points and give its slope, intercept and fit.',
  category: 'statistics', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{equation|prose}} — r² of {{rSquared}}, so the line explains {{explained}}% of the variation.',
  inputSchema: {
    type: 'object', required: ['x', 'y'],
    properties: {
      x: { type: 'array', label: 'x values', items: { type: 'number' }, minItems: 3, prompt: 'What are the x values?' },
      y: { type: 'array', label: 'y values', items: { type: 'number' }, minItems: 3, prompt: 'What are the y values?' },
      predictAt: { type: 'number', label: 'predict at x', description: 'an x value to predict y for' }
    }
  },
  outputSchema: { type: 'object', properties: { slope: { type: 'number' }, intercept: { type: 'number' }, rSquared: { type: 'number' }, equation: { type: 'string' }, explained: { type: 'number' }, prediction: { type: 'number' }, n: { type: 'integer' } } },
  examples: [
    { text: 'fit a line through these points', input: { x: [1, 2, 3, 4, 5], y: [2, 4, 6, 8, 10] }, output: { slope: 2, intercept: 0, rSquared: 1, equation: 'y = 2x', explained: 100, prediction: 0, n: 5 } },
    { text: 'trend line for these sales figures', input: { x: [1, 2, 3, 4], y: [100, 120, 135, 160] }, output: { slope: 19.5, intercept: 80, rSquared: 0.9909, equation: 'y = 19.5x + 80', explained: 99.09, prediction: 0, n: 4 } },
    { text: 'predict the value at x = 10', input: { x: [1, 2, 3, 4], y: [3, 5, 7, 9], predictAt: 10 }, output: { slope: 2, intercept: 1, rSquared: 1, equation: 'y = 2x + 1', explained: 100, prediction: 21, n: 4 } },
    { text: 'fit a declining trend', input: { x: [1, 2, 3, 4], y: [20, 15, 11, 6] }, output: { slope: -4.6, intercept: 24.5, rSquared: 0.9981, equation: 'y = -4.6x + 24.5', explained: 99.81, prediction: 0, n: 4 } },
    { text: 'regression through noisy points', input: { x: [1, 2, 3, 4, 5], y: [2, 5, 4, 8, 9] }, output: { slope: 1.7, intercept: 0.5, rSquared: 0.8705, equation: 'y = 1.7x + 0.5', explained: 87.05, prediction: 0, n: 5 } }
  ],
  errorCases: [
    { input: { x: [1, 2, 3], y: [1, 2] }, code: 'INVALID_INPUT' },
    { input: { x: [2, 2, 2], y: [1, 2, 3] }, code: 'INVALID_INPUT' },
    { input: { x: [1, 2, 3] }, code: 'MISSING_FIELD' }
  ],
  run (input) {
    if (input.x.length !== input.y.length) {
      return fail('INVALID_INPUT', `There are ${input.x.length} x values and ${input.y.length} y values — they have to pair up.`, 'y');
    }
    const mx = mean(input.x), my = mean(input.y);
    let num = 0, den = 0;
    for (let i = 0; i < input.x.length; i++) {
      num += (input.x[i] - mx) * (input.y[i] - my);
      den += (input.x[i] - mx) ** 2;
    }
    /* A vertical line has infinite slope. Every x being the same is the one
       shape ordinary least squares cannot fit. */
    if (den === 0) return fail('INVALID_INPUT', 'Every x is the same value, so no line can be fitted through them.', 'x');

    const slope = num / den;
    const intercept = my - slope * mx;
    const r = pearson(input.x, input.y);
    const rSquared = Number.isNaN(r) ? 0 : r * r;
    const s = round(slope, 4), b = round(intercept, 4);
    return ok({
      slope: s, intercept: b, rSquared: round(rSquared, 4),
      equation: b === 0 ? `y = ${s}x` : `y = ${s}x ${b < 0 ? '-' : '+'} ${Math.abs(b)}`,
      explained: round(rSquared * 100, 2),
      prediction: input.predictAt === undefined ? 0 : round(slope * input.predictAt + intercept, 4),
      n: input.x.length
    }, computed());
  }
};
