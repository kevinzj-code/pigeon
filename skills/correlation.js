import { ok, fail, computed } from '../src/contracts.js';
import { pearson } from '../src/lib/stats.js';
import { round } from '../src/lib/num.js';

export default {
  name: 'correlation',
  description: 'Measure how strongly two sets of numbers move together, as a correlation coefficient.',
  category: 'statistics', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: 'r = {{r}} — {{strength|prose}}. This measures association only, not cause.',
  inputSchema: {
    type: 'object', required: ['x', 'y'],
    properties: {
      x: { type: 'array', label: 'first set', items: { type: 'number' }, minItems: 3, prompt: 'What is the first set of numbers?' },
      y: { type: 'array', label: 'second set', items: { type: 'number' }, minItems: 3, prompt: 'What is the second set?' }
    }
  },
  outputSchema: { type: 'object', properties: { r: { type: 'number' }, rSquared: { type: 'number' }, strength: { type: 'string' }, direction: { type: 'string' }, n: { type: 'integer' } } },
  examples: [
    { text: 'how correlated are these two series', input: { x: [1, 2, 3, 4, 5], y: [2, 4, 6, 8, 10] }, output: { r: 1, rSquared: 1, strength: 'a perfect positive relationship', direction: 'positive', n: 5 } },
    { text: 'correlation between hours studied and score', input: { x: [1, 2, 3, 4, 5], y: [50, 55, 65, 70, 80] }, output: { r: 0.9934, rSquared: 0.9868, strength: 'a very strong positive relationship', direction: 'positive', n: 5 } },
    { text: 'are these inversely related', input: { x: [1, 2, 3, 4], y: [10, 8, 6, 4] }, output: { r: -1, rSquared: 1, strength: 'a perfect negative relationship', direction: 'negative', n: 4 } },
    { text: 'correlation of two unrelated series', input: { x: [1, 2, 3, 4], y: [5, 2, 8, 3] }, output: { r: 0, rSquared: 0, strength: 'essentially no relationship', direction: 'none', n: 4 } },
    { text: 'weak positive correlation', input: { x: [1, 2, 3, 4, 5, 6], y: [2, 1, 4, 3, 6, 4] }, output: { r: 0.7326, rSquared: 0.5366, strength: 'a strong positive relationship', direction: 'positive', n: 6 } }
  ],
  errorCases: [
    { input: { x: [1, 2, 3], y: [1, 2] }, code: 'INVALID_INPUT' },
    { input: { x: [1, 1, 1], y: [1, 2, 3] }, code: 'INVALID_INPUT' },
    { input: { x: [1, 2, 3] }, code: 'MISSING_FIELD' }
  ],
  run (input) {
    if (input.x.length !== input.y.length) {
      return fail('INVALID_INPUT', `There are ${input.x.length} values in the first set and ${input.y.length} in the second — they have to pair up.`, 'y');
    }
    const r = pearson(input.x, input.y);
    /* NaN means one series is constant. There is no correlation to report, and
       returning 0 would say "unrelated" when the truth is "undefined". */
    if (Number.isNaN(r)) return fail('INVALID_INPUT', 'One of those sets is the same value all the way through, so there is no relationship to measure.', 'x');

    const a = Math.abs(r);
    const strength = a === 1 ? `a perfect ${r > 0 ? 'positive' : 'negative'} relationship`
      : a >= 0.9 ? `a very strong ${r > 0 ? 'positive' : 'negative'} relationship`
        : a >= 0.7 ? `a strong ${r > 0 ? 'positive' : 'negative'} relationship`
          : a >= 0.4 ? `a moderate ${r > 0 ? 'positive' : 'negative'} relationship`
            : a >= 0.2 ? `a weak ${r > 0 ? 'positive' : 'negative'} relationship`
              : 'essentially no relationship';
    return ok({
      r: round(r, 4), rSquared: round(r * r, 4), strength,
      /* Exactly zero has no direction. Calling it "positive" because the
         comparison was >= would be a claim the number does not make. */
      direction: r === 0 ? 'none' : r > 0 ? 'positive' : 'negative',
      n: input.x.length
    }, computed());
  }
};
