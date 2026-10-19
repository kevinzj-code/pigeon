import { ok, fail, computed } from '../src/contracts.js';
import { round } from '../src/lib/num.js';

export default {
  name: 'applyDiscount',
  description: 'Take a single percentage or amount off one price and show what you save.',
  category: 'finance',
  tier: 'core',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{price}} less {{discountText}} is {{result}} — you save {{saving}}.',
  inputSchema: {
    type: 'object',
    required: ['price'],
    properties: {
      price: { type: 'number', label: 'price', carry: true, minimum: 0, prompt: 'What is the original price?' },
      percent: { type: 'number', label: 'discount %', minimum: 0, maximum: 100, description: 'a percentage off' },
      amount: { type: 'number', label: 'amount off', minimum: 0, description: 'a fixed amount off' }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      result: { type: 'number' }, saving: { type: 'number' }, price: { type: 'number' },
      effectivePercent: { type: 'number' }, discountText: { type: 'string' }
    }
  },
  examples: [
    { text: '25% off a 80 jacket', input: { price: 80, percent: 25 },
      output: { result: 60, saving: 20, price: 80, effectivePercent: 25, discountText: '25%' } },
    { text: 'take a tenner off 45.50', input: { price: 45.5, amount: 10 },
      output: { result: 35.5, saving: 10, price: 45.5, effectivePercent: 21.98, discountText: '10' } },
    { text: 'what is 15 percent off 19.99', input: { price: 19.99, percent: 15 },
      output: { result: 16.99, saving: 3, price: 19.99, effectivePercent: 15.01, discountText: '15%' } },
    { text: 'half price on 120', input: { price: 120, percent: 50 },
      output: { result: 60, saving: 60, price: 120, effectivePercent: 50, discountText: '50%' } },
    { text: 'a 30 discount on a 25 item', input: { price: 25, amount: 30 },
      output: { result: 0, saving: 25, price: 25, effectivePercent: 100, discountText: '30' } },
    { text: 'reduce a 60 price by 15 percent', input: { price: 60, percent: 15 },
      output: { result: 51, saving: 9, price: 60, effectivePercent: 15, discountText: '15%' } },
    { text: 'knock 20 percent off 149', input: { price: 149, percent: 20 },
      output: { result: 119.2, saving: 29.8, price: 149, effectivePercent: 20, discountText: '20%' } }
  ],
  errorCases: [
    { input: { price: 50 }, code: 'INVALID_INPUT' },
    { input: { price: 50, percent: 20, amount: 5 }, code: 'INVALID_INPUT' },
    { input: { percent: 20 }, code: 'MISSING_FIELD' }
  ],
  run (input) {
    const hasPercent = input.percent !== undefined;
    const hasAmount = input.amount !== undefined;
    if (hasPercent === hasAmount) {
      return fail('INVALID_INPUT', 'Give me either a percentage off or a fixed amount off, not both and not neither.', hasPercent ? 'amount' : 'percent');
    }
    /* A fixed discount larger than the price makes the item free, not negative
       — a bill cannot go below zero, and reporting -5 would be arithmetic
       pretending to be an answer. The saving is capped to match. */
    const nominal = hasPercent ? input.price * input.percent / 100 : input.amount;
    const saving = round(Math.min(nominal, input.price), 2);
    const result = round(input.price - saving, 2);
    return ok({
      result, saving, price: input.price,
      effectivePercent: input.price === 0 ? 0 : round(saving / input.price * 100, 2),
      discountText: hasPercent ? `${input.percent}%` : String(input.amount)
    }, computed());
  }
};
