import { ok, fail, computed } from '../src/contracts.js';
import { round } from '../src/lib/num.js';

export default {
  name: 'percentChange',
  description: 'Percentage change between two numbers, and the difference in plain terms.',
  category: 'math',
  tier: 'core',
  unbuilt: false,
  needsNetwork: false,
  dataAsOf: null,
  labels: [],
  replyTemplate: 'That is {{direction|prose}} of {{percent}}% — from {{from|comma}} to {{to|comma}}, a difference of {{difference|comma}}.',
  inputSchema: {
    type: 'object',
    required: ['from', 'to'],
    properties: {
      from: { type: 'number', label: 'old value', prompt: 'What was the starting number?' },
      to: { type: 'number', label: 'new value', prompt: 'What is the new number?' }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      percent: { type: 'number' }, difference: { type: 'number' }, from: { type: 'number' },
      to: { type: 'number' }, direction: { type: 'string' }, multiplier: { type: 'number' }
    }
  },
  examples: [
    { text: 'my rent went from 1200 to 1350, what percent increase is that', input: { from: 1200, to: 1350 },
      output: { percent: 12.5, difference: 150, from: 1200, to: 1350, direction: 'an increase', multiplier: 1.125 } },
    { text: 'percentage change from 80 to 60', input: { from: 80, to: 60 },
      output: { percent: 25, difference: -20, from: 80, to: 60, direction: 'a decrease', multiplier: 0.75 } },
    { text: 'what percent bigger is 45 than 30', input: { from: 30, to: 45 },
      output: { percent: 50, difference: 15, from: 30, to: 45, direction: 'an increase', multiplier: 1.5 } },
    { text: 'change from 200 to 200', input: { from: 200, to: 200 },
      output: { percent: 0, difference: 0, from: 200, to: 200, direction: 'no change', multiplier: 1 } },
    { text: 'sales fell from 12500 to 9800 — how much is that as a percentage', input: { from: 12500, to: 9800 },
      output: { percent: 21.6, difference: -2700, from: 12500, to: 9800, direction: 'a decrease', multiplier: 0.784 } }
  ],
  errorCases: [
    { input: { from: 0, to: 50 }, code: 'INVALID_INPUT' },
    { input: { from: 'a lot', to: 50 }, code: 'INVALID_INPUT' },
    { input: { to: 50 }, code: 'MISSING_FIELD' }
  ],
  run (input) {
    /* Percentage change from zero is undefined, not infinite — there is no
       honest number here and returning Infinity would render as a value. */
    if (input.from === 0) {
      return fail('INVALID_INPUT', 'Percentage change from zero has no answer — everything is an infinite increase on nothing.', 'from');
    }
    const difference = input.to - input.from;
    return ok({
      /* Reported unsigned, with the direction as a word. "-25%" and "a
         decrease of 25%" in the same sentence is how a reply ends up saying
         the change twice and meaning it once. */
      percent: round(Math.abs(difference / input.from) * 100, 2),
      difference: round(difference, 6),
      from: input.from,
      to: input.to,
      direction: difference > 0 ? 'an increase' : difference < 0 ? 'a decrease' : 'no change',
      multiplier: round(input.to / input.from, 6)
    }, computed());
  }
};
