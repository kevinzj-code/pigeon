import { ok, fail, computed } from '../src/contracts.js';
import { round } from '../src/lib/num.js';

export default {
  name: 'rangeList',
  description: 'Count from one number to another in steps, listing every number on the way.',
  category: 'lists',
  tier: 'core',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{count}} {{count|plural:number:numbers}}: {{items|list}}',
  inputSchema: {
    type: 'object',
    required: ['from', 'to'],
    properties: {
      from: { type: 'number', label: 'from', prompt: 'Start from which number?' },
      to: { type: 'number', label: 'to', prompt: 'Count up to which number?' },
      step: { type: 'number', label: 'step', default: 1 }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      items: { type: 'array', items: { type: 'number' } }, count: { type: 'integer' },
      from: { type: 'number' }, to: { type: 'number' }, step: { type: 'number' }
    }
  },
  examples: [
    { text: 'list the numbers 1 to 5', input: { from: 1, to: 5 },
      output: { items: [1, 2, 3, 4, 5], count: 5, from: 1, to: 5, step: 1 } },
    { text: 'count from 0 to 100 in tens', input: { from: 0, to: 100, step: 10 },
      output: { items: [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100], count: 11, from: 0, to: 100, step: 10 } },
    { text: 'count down from 10 to 1', input: { from: 10, to: 1 },
      output: { items: [10, 9, 8, 7, 6, 5, 4, 3, 2, 1], count: 10, from: 10, to: 1, step: 1 } },
    { text: 'list 0 to 1 in quarters', input: { from: 0, to: 1, step: 0.25 },
      output: { items: [0, 0.25, 0.5, 0.75, 1], count: 5, from: 0, to: 1, step: 0.25 } },
    { text: 'a range where start and end are the same', input: { from: 7, to: 7 },
      output: { items: [7], count: 1, from: 7, to: 7, step: 1 } },
    { text: 'list the multiples of five between 5 and 40', input: { from: 5, to: 40, step: 5 },
      output: { items: [5, 10, 15, 20, 25, 30, 35, 40], count: 8, from: 5, to: 40, step: 5 } },
    { text: 'count from 10 down to 0 in twos', input: { from: 10, to: 0, step: -2 },
      output: { items: [10, 8, 6, 4, 2, 0], count: 6, from: 10, to: 0, step: -2 } }
  ],
  errorCases: [
    { input: { from: 1, to: 10, step: 0 }, code: 'INVALID_INPUT' },
    { input: { from: 1, to: 100000, step: 0.001 }, code: 'INVALID_INPUT' },
    { input: { from: 1 }, code: 'MISSING_FIELD' }
  ],
  run (input) {
    const step = Math.abs(input.step);
    if (step === 0) return fail('INVALID_INPUT', 'A step of zero would never reach the end.', 'step');

    const span = Math.abs(input.to - input.from);
    const count = Math.floor(span / step) + 1;
    /* Capped, because "1 to 1,000,000" is a plausible typo and an unbounded
       array is a hung tab. The limit is stated in the refusal so the user can
       narrow the range rather than guess what went wrong. */
    if (count > 10000) {
      return fail('INVALID_INPUT', `That range would be ${count.toLocaleString('en-GB')} numbers long — I cap it at 10,000.`, 'step');
    }

    /* The direction is inferred rather than demanded: "from 10 to 1" obviously
       counts down, and making the user write step: -1 for it is a papercut. */
    const dir = input.to < input.from ? -1 : 1;
    const items = [];
    for (let i = 0; i < count; i++) items.push(round(input.from + dir * i * step, 10));

    return ok({ items, count: items.length, from: input.from, to: input.to, step: input.step }, computed());
  }
};
