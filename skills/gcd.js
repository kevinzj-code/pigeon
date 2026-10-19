import { ok, fail, computed } from '../src/contracts.js';
import { gcd as gcdOf } from '../src/lib/num.js';

export default {
  name: 'gcd',
  description: "Find the biggest number that divides them all exactly.",
  category: 'math', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  title: 'Greatest common divisor',
  replyTemplate: 'The greatest common divisor of {{values|list}} is {{result}}.',
  inputSchema: {
    type: 'object', required: ['values'],
    properties: { values: { type: 'array', label: 'whole numbers', items: { type: 'integer' }, minItems: 2, prompt: 'Which whole numbers?' } }
  },
  outputSchema: { type: 'object', properties: { result: { type: 'integer' }, values: { type: 'array', items: { type: 'integer' } }, coprime: { type: 'boolean' }, reduced: { type: 'array', items: { type: 'integer' } } } },
  examples: [
    { text: 'greatest common divisor of 48 and 18', input: { values: [48, 18] }, output: { result: 6, values: [48, 18], coprime: false, reduced: [8, 3] } },
    { text: 'gcd of 100 and 75', input: { values: [100, 75] }, output: { result: 25, values: [100, 75], coprime: false, reduced: [4, 3] } },
    { text: 'highest common factor of 12 18 and 24', input: { values: [12, 18, 24] }, output: { result: 6, values: [12, 18, 24], coprime: false, reduced: [2, 3, 4] } },
    { text: 'gcd of 17 and 5', input: { values: [17, 5] }, output: { result: 1, values: [17, 5], coprime: true, reduced: [17, 5] } },
    { text: 'what divides 270 and 192 evenly', input: { values: [270, 192] }, output: { result: 6, values: [270, 192], coprime: false, reduced: [45, 32] } }
  ],
  errorCases: [
    { input: { values: [12] }, code: 'INVALID_INPUT' },
    { input: { values: [12, 1.5] }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' }
  ],
  run (input) {
    if (input.values.length < 2) return fail('INVALID_INPUT', 'I need at least two numbers.', 'values');
    if (input.values.some(v => !Number.isInteger(v))) return fail('INVALID_INPUT', 'A common divisor only applies to whole numbers.', 'values');
    if (input.values.every(v => v === 0)) return fail('INVALID_INPUT', 'Every number is zero, so there is no greatest divisor.', 'values');
    const result = input.values.reduce((a, b) => gcdOf(a, b));
    /* `reduced` is what people usually want next: the same ratio in its
       simplest terms. */
    return ok({
      result, values: input.values, coprime: result === 1,
      reduced: input.values.map(v => v / result)
    }, computed());
  }
};
