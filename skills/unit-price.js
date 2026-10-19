import { ok, fail, computed } from '../src/contracts.js';
import { round } from '../src/lib/num.js';

export default {
  name: 'unitPrice',
  description: 'Work out the price per unit — per litre, per kilo, per item — so sizes can be compared.',
  category: 'everyday',
  tier: 'core',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{price}} for {{quantity}} {{unit}} is {{unitPrice}} per {{unit}}.',
  inputSchema: {
    type: 'object',
    required: ['price', 'quantity'],
    properties: {
      price: { type: 'number', label: 'price', carry: true, minimum: 0, prompt: 'What does it cost?' },
      quantity: { type: 'number', label: 'quantity', exclusiveMinimum: 0, prompt: 'How much do you get?' },
      unit: { type: 'string', label: 'unit', default: 'unit', description: 'what the quantity is measured in' }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      unitPrice: { type: 'number' }, price: { type: 'number' }, quantity: { type: 'number' },
      unit: { type: 'string' }, per100: { type: 'number' }, quantityPerCurrency: { type: 'number' }
    }
  },
  examples: [
    { text: 'what is the price per litre of 2.4 litres for 3.60', input: { price: 3.6, quantity: 2.4, unit: 'litre' },
      output: { unitPrice: 1.5, price: 3.6, quantity: 2.4, unit: 'litre', per100: 150, quantityPerCurrency: 0.667 } },
    { text: 'price per kilo for 750g at 4.20', input: { price: 4.2, quantity: 0.75, unit: 'kg' },
      output: { unitPrice: 5.6, price: 4.2, quantity: 0.75, unit: 'kg', per100: 560, quantityPerCurrency: 0.179 } },
    { text: 'cost per item for a pack of 12 at 5.99', input: { price: 5.99, quantity: 12, unit: 'item' },
      output: { unitPrice: 0.4992, price: 5.99, quantity: 12, unit: 'item', per100: 49.92, quantityPerCurrency: 2.003 } },
    { text: 'unit price of 500ml for 1.25', input: { price: 1.25, quantity: 500, unit: 'ml' },
      output: { unitPrice: 0.0025, price: 1.25, quantity: 500, unit: 'ml', per100: 0.25, quantityPerCurrency: 400 } },
    { text: 'price per sheet for 240 sheets at 2.40', input: { price: 2.4, quantity: 240, unit: 'sheet' },
      output: { unitPrice: 0.01, price: 2.4, quantity: 240, unit: 'sheet', per100: 1, quantityPerCurrency: 100 } },
    { text: 'what does that work out to per litre: 3.60 for 1.5 litres', input: { price: 3.6, quantity: 1.5, unit: 'litre' },
      output: { unitPrice: 2.4, price: 3.6, quantity: 1.5, unit: 'litre', per100: 240, quantityPerCurrency: 0.417 } }
  ],
  errorCases: [
    { input: { price: 5, quantity: 0 }, code: 'INVALID_INPUT' },
    { input: { price: -5, quantity: 2 }, code: 'INVALID_INPUT' },
    { input: { price: 5 }, code: 'MISSING_FIELD' }
  ],
  run (input) {
    if (input.quantity <= 0) return fail('INVALID_INPUT', 'The quantity has to be more than zero.', 'quantity');
    const unitPrice = input.price / input.quantity;
    return ok({
      /* Four decimals, not two: at supermarket sizes a per-millilitre price is
         often 0.0025, and rounding that to 0.00 makes the whole answer useless. */
      unitPrice: round(unitPrice, 4),
      price: input.price, quantity: input.quantity, unit: input.unit,
      per100: round(unitPrice * 100, 2),
      quantityPerCurrency: input.price > 0 ? round(input.quantity / input.price, 3) : 0
    }, computed());
  }
};
