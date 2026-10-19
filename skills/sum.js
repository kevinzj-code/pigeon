import { ok, fail, computed } from '../src/contracts.js';
import { round } from '../src/lib/num.js';

export default {
  name: 'sum',
  description: 'Add a list of numbers up to one final total.',
  category: 'math',
  tier: 'core',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{count}} {{count|plural:number:numbers}} add up to {{total|comma}}. The average is {{average}}.',
  inputSchema: {
    type: 'object',
    required: ['values'],
    properties: {
      values: { type: 'array', label: 'numbers', items: { type: 'number' }, minItems: 1, prompt: 'Which numbers should I add up?' }
    }
  },
  outputSchema: {
    type: 'object',
    properties: { total: { type: 'number' }, count: { type: 'integer' }, average: { type: 'number' }, running: { type: 'array', items: { type: 'number' } } }
  },
  examples: [
    { text: 'add up 1250, 3400 and 890', input: { values: [1250, 3400, 890] },
      output: { total: 5540, count: 3, average: 1846.67, running: [1250, 4650, 5540] } },
    { text: 'what is the total of my expenses 12.50 8.20 45', input: { values: [12.5, 8.2, 45] },
      output: { total: 65.7, count: 3, average: 21.9, running: [12.5, 20.7, 65.7] } },
    { text: 'sum these negative and positive numbers', input: { values: [100, -30, -20] },
      output: { total: 50, count: 3, average: 16.67, running: [100, 70, 50] } },
    { text: 'total of a single number', input: { values: [7] },
      output: { total: 7, count: 1, average: 7, running: [7] } },
    { text: 'add up the quarterly figures', input: { values: [42, 58, 61, 39] },
      output: { total: 200, count: 4, average: 50, running: [42, 100, 161, 200] } }
  ],
  errorCases: [
    { input: { values: [] }, code: 'INVALID_INPUT' },
    { input: { values: [1, 'two'] }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' }
  ],
  run (input) {
    if (!input.values.length) return fail('INVALID_INPUT', 'There are no numbers to add up.', 'values');
    /* The running total is returned because "check my arithmetic" is most of
       what this skill is for, and a single total is not checkable. */
    const running = [];
    let total = 0;
    for (const v of input.values) { total += v; running.push(round(total, 6)); }
    return ok({
      total: round(total, 6), count: input.values.length,
      average: round(total / input.values.length, 2), running
    }, computed());
  }
};
