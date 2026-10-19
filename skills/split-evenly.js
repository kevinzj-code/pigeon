import { ok, fail, computed } from '../src/contracts.js';
import { splitAmount } from '../src/lib/num.js';

export default {
  name: 'splitEvenly',
  description: 'Split an amount into equal parts, assigning the leftover pennies so the parts add back up.',
  category: 'math',
  tier: 'core',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{amount}} split {{parts}} ways: {{shares|list}}.',
  inputSchema: {
    type: 'object',
    required: ['amount', 'parts'],
    properties: {
      amount: { type: 'number', label: 'amount', carry: true, prompt: 'What amount should I split?' },
      parts: { type: 'integer', label: 'parts', minimum: 1, prompt: 'Into how many parts?' },
      decimals: { type: 'integer', label: 'decimal places', minimum: 0, maximum: 6, default: 2 }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      shares: { type: 'array', items: { type: 'number' } }, amount: { type: 'number' },
      parts: { type: 'integer' }, even: { type: 'boolean' }, base: { type: 'number' }, remainder: { type: 'integer' }
    }
  },
  examples: [
    { text: 'split 100 three ways', input: { amount: 100, parts: 3 },
      output: { shares: [33.34, 33.33, 33.33], amount: 100, parts: 3, even: false, base: 33.33, remainder: 1 } },
    { text: 'divide 60 between 4 people', input: { amount: 60, parts: 4 },
      output: { shares: [15, 15, 15, 15], amount: 60, parts: 4, even: true, base: 15, remainder: 0 } },
    { text: 'split 10 seven ways', input: { amount: 10, parts: 7 },
      output: { shares: [1.43, 1.43, 1.43, 1.43, 1.43, 1.43, 1.42], amount: 10, parts: 7, even: false, base: 1.42, remainder: 6 } },
    { text: 'split 0.05 between 2', input: { amount: 0.05, parts: 2 },
      output: { shares: [0.03, 0.02], amount: 0.05, parts: 2, even: false, base: 0.02, remainder: 1 } },
    { text: 'split 250 to whole numbers between 3', input: { amount: 250, parts: 3, decimals: 0 },
      output: { shares: [84, 83, 83], amount: 250, parts: 3, even: false, base: 83, remainder: 1 } }
  ],
  errorCases: [
    { input: { amount: 100, parts: 0 }, code: 'INVALID_INPUT' },
    { input: { amount: 100, parts: 2.5 }, code: 'INVALID_INPUT' },
    { input: { parts: 3 }, code: 'MISSING_FIELD' }
  ],
  run (input) {
    if (input.parts > 10000) return fail('INVALID_INPUT', 'That is more parts than I will list out.', 'parts');
    const shares = splitAmount(input.amount, input.parts, input.decimals);
    const f = Math.pow(10, input.decimals);
    const base = Math.floor(Math.round(input.amount * f) / input.parts) / f;
    return ok({
      shares, amount: input.amount, parts: input.parts,
      even: new Set(shares).size === 1,
      base,
      /* How many shares carry an extra minor unit. Shown because "they're not
         all the same" is the first thing anyone asks about an uneven split. */
      remainder: Math.round(input.amount * f) - Math.floor(Math.round(input.amount * f) / input.parts) * input.parts
    }, computed());
  }
};
