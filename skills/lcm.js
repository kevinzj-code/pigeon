import { ok, fail, computed } from '../src/contracts.js';
import { lcm as lcmOf } from '../src/lib/num.js';

export default {
  name: 'lcm',
  description: "Find the smallest number they all go into.",
  category: 'math', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  title: 'Lowest common multiple',
  replyTemplate: 'The lowest common multiple of {{values|list}} is {{result|comma}}.',
  inputSchema: {
    type: 'object', required: ['values'],
    properties: { values: { type: 'array', label: 'whole numbers', items: { type: 'integer' }, minItems: 2, prompt: 'Which whole numbers?' } }
  },
  outputSchema: { type: 'object', properties: { result: { type: 'integer' }, values: { type: 'array', items: { type: 'integer' } }, multiples: { type: 'array', items: { type: 'integer' } } } },
  examples: [
    { text: 'lowest common multiple of 4 and 6', input: { values: [4, 6] }, output: { result: 12, values: [4, 6], multiples: [3, 2] } },
    { text: 'lcm of 3 5 and 7', input: { values: [3, 5, 7] }, output: { result: 105, values: [3, 5, 7], multiples: [35, 21, 15] } },
    { text: 'when do buses every 12 and 18 minutes coincide', input: { values: [12, 18] }, output: { result: 36, values: [12, 18], multiples: [3, 2] } },
    { text: 'lcm of 8 and 9', input: { values: [8, 9] }, output: { result: 72, values: [8, 9], multiples: [9, 8] } },
    { text: 'smallest number divisible by 10 and 25', input: { values: [10, 25] }, output: { result: 50, values: [10, 25], multiples: [5, 2] } }
  ],
  errorCases: [
    { input: { values: [6] }, code: 'INVALID_INPUT' },
    { input: { values: [6, 0] }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' }
  ],
  run (input) {
    if (input.values.length < 2) return fail('INVALID_INPUT', 'I need at least two numbers.', 'values');
    if (input.values.some(v => !Number.isInteger(v))) return fail('INVALID_INPUT', 'A common multiple only applies to whole numbers.', 'values');
    if (input.values.some(v => v === 0)) return fail('INVALID_INPUT', 'Zero has no multiples, so there is no lowest common one.', 'values');
    const result = input.values.reduce((a, b) => lcmOf(a, b));
    if (!Number.isSafeInteger(result)) return fail('INVALID_INPUT', 'That multiple is too large to work out exactly.', 'values');
    /* How many times each input goes into the answer — the "every 12 minutes
       and every 18 minutes coincide every 3rd and 2nd time" reading. */
    return ok({ result, values: input.values, multiples: input.values.map(v => result / v) }, computed());
  }
};
