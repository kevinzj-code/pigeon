import { ok, fail, computed } from '../src/contracts.js';
import { round } from '../src/lib/num.js';

export default {
  name: 'product',
  description: 'Multiply a list of numbers you give together.',
  category: 'math',
  tier: 'core',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  title: 'Multiply numbers',
  replyTemplate: '{{values|list}} multiplied together is {{result|comma}}.',
  inputSchema: {
    type: 'object',
    required: ['values'],
    properties: {
      values: { type: 'array', label: 'numbers', items: { type: 'number' }, minItems: 1, prompt: 'Which numbers should I multiply?' }
    }
  },
  outputSchema: {
    type: 'object',
    properties: { result: { type: 'number' }, count: { type: 'integer' }, values: { type: 'array', items: { type: 'number' } }, exact: { type: 'boolean' } }
  },
  examples: [
    { text: 'multiply 12 by 8 by 3', input: { values: [12, 8, 3] },
      output: { result: 288, count: 3, values: [12, 8, 3], exact: true } },
    { text: 'what is 2.5 times 4 times 10', input: { values: [2.5, 4, 10] },
      output: { result: 100, count: 3, values: [2.5, 4, 10], exact: true } },
    { text: 'multiply these dimensions 3 x 4 x 5', input: { values: [3, 4, 5] },
      output: { result: 60, count: 3, values: [3, 4, 5], exact: true } },
    { text: 'product of a list containing zero', input: { values: [7, 0, 12] },
      output: { result: 0, count: 3, values: [7, 0, 12], exact: true } },
    { text: 'multiply two negatives', input: { values: [-6, -7] },
      output: { result: 42, count: 2, values: [-6, -7], exact: true } },
    { text: 'what is 7 times 9 times 3', input: { values: [7, 9, 3] },
      output: { result: 189, count: 3, values: [7, 9, 3], exact: true } },
    { text: 'what do 4, 5 and 6 come to multiplied together', input: { values: [4, 5, 6] },
      output: { result: 120, count: 3, values: [4, 5, 6], exact: true } }
  ],
  errorCases: [
    { input: { values: [] }, code: 'INVALID_INPUT' },
    { input: { values: ['x', 2] }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' }
  ],
  run (input) {
    if (!input.values.length) return fail('INVALID_INPUT', 'There are no numbers to multiply.', 'values');
    const raw = input.values.reduce((a, b) => a * b, 1);
    if (!Number.isFinite(raw)) return fail('INVALID_INPUT', 'That product is too large to represent.', 'values');
    const result = round(raw, 6);
    return ok({ result, count: input.values.length, values: input.values, exact: result === raw }, computed());
  }
};
