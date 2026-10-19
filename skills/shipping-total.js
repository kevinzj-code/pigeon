import { ok, fail, computed } from '../src/contracts.js';
import { round } from '../src/lib/num.js';

export default {
  name: 'shippingTotal',
  description: 'Total a basket — items, postage, free-delivery thresholds and tax.',
  category: 'everyday', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: 'Subtotal {{subtotal}}, shipping {{shipping}}, tax {{tax}} — {{total}} in total.',
  inputSchema: {
    type: 'object', required: ['items'],
    properties: {
      items: { type: 'array', label: 'items', minItems: 1, maxItems: 200, prompt: 'What is in the order?' },
      shipping: { type: 'number', label: 'shipping cost', minimum: 0, default: 0 },
      freeShippingOver: { type: 'number', label: 'free shipping from', minimum: 0, description: 'subtotal at which shipping becomes free' },
      taxRate: { type: 'number', label: 'tax %', minimum: 0, maximum: 100, default: 0, description: 'as a percentage' },
      taxOnShipping: { type: 'boolean', label: 'tax on shipping', default: true }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      subtotal: { type: 'number' }, shipping: { type: 'number' }, tax: { type: 'number' },
      total: { type: 'number' }, itemCount: { type: 'integer' },
      freeShipping: { type: 'boolean' }, shortOfFreeShipping: { type: 'number' },
      lines: { type: 'array', items: { type: 'string' } }
    }
  },
  examples: [
    { text: 'total this order with shipping', input: { items: [{ price: 12.5, quantity: 2 }, { price: 8, quantity: 1 }], shipping: 4.99, freeShippingOver: 50 }, output: { subtotal: 33, shipping: 4.99, tax: 0, total: 37.99, itemCount: 3, freeShipping: false, shortOfFreeShipping: 17, lines: ['2 x 12.5 = 25', '1 x 8 = 8'] } },
    { text: 'order total with 20 percent tax', input: { items: [{ price: 12.5, quantity: 2 }, { price: 8, quantity: 1 }], shipping: 4.99, freeShippingOver: 30, taxRate: 20 }, output: { subtotal: 33, shipping: 0, tax: 6.6, total: 39.6, itemCount: 3, freeShipping: true, shortOfFreeShipping: 0, lines: ['2 x 12.5 = 25', '1 x 8 = 8'] } },
    { text: 'how much is my basket', input: { items: [{ price: 20, quantity: 1 }] }, output: { subtotal: 20, shipping: 0, tax: 0, total: 20, itemCount: 1, freeShipping: false, shortOfFreeShipping: 0, lines: ['1 x 20 = 20'] } },
    { text: 'am I close to free delivery', input: { items: [{ price: 15, quantity: 3 }], shipping: 5, freeShippingOver: 50 }, output: { subtotal: 45, shipping: 5, tax: 0, total: 50, itemCount: 3, freeShipping: false, shortOfFreeShipping: 5, lines: ['3 x 15 = 45'] } },
    { text: 'total with tax not charged on delivery', input: { items: [{ price: 100, quantity: 1 }], shipping: 10, taxRate: 10, taxOnShipping: false }, output: { subtotal: 100, shipping: 10, tax: 10, total: 120, itemCount: 1, freeShipping: false, shortOfFreeShipping: 0, lines: ['1 x 100 = 100'] } }
  ],
  errorCases: [
    { input: { items: [] }, code: 'INVALID_INPUT' },
    { input: { items: [{ quantity: 2 }] }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' }
  ],
  run (input) {
    const lines = [];
    let subtotal = 0;
    let itemCount = 0;
    for (const [i, item] of input.items.entries()) {
      const price = Number(item?.price);
      const quantity = item?.quantity === undefined ? 1 : Number(item.quantity);
      if (!Number.isFinite(price) || price < 0) return fail('INVALID_INPUT', `Item ${i + 1} has no usable price.`, 'items');
      if (!Number.isFinite(quantity) || quantity < 0) return fail('INVALID_INPUT', `Item ${i + 1} has no usable quantity.`, 'items');
      subtotal += price * quantity;
      itemCount += quantity;
      lines.push(`${quantity} x ${price} = ${round(price * quantity, 10)}`);
    }
    subtotal = round(subtotal, 2);

    /* The threshold is compared against the subtotal before tax, which is how
       shops actually apply it — comparing after tax would flip the answer for
       any basket sitting just under the line. */
    const freeShipping = input.freeShippingOver !== undefined && subtotal >= input.freeShippingOver;
    const shipping = freeShipping ? 0 : (input.shipping ?? 0);
    const taxable = subtotal + (input.taxOnShipping === false ? 0 : shipping);
    const tax = round((taxable * (input.taxRate ?? 0)) / 100, 2);

    return ok({
      subtotal, shipping, tax, total: round(subtotal + shipping + tax, 2), itemCount, freeShipping,
      shortOfFreeShipping: input.freeShippingOver !== undefined && !freeShipping
        ? round(input.freeShippingOver - subtotal, 2) : 0,
      lines
    }, computed());
  }
};
