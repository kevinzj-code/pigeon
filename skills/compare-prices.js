import { ok, fail, computed } from '../src/contracts.js';
import { round } from '../src/lib/num.js';

export default {
  name: 'comparePrices',
  description: 'Rank several sizes or packs by value for money and say which is cheapest per unit.',
  category: 'everyday',
  tier: 'core',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{best}} is the best value at {{bestUnitPrice}} per {{unit}} — {{saving}}% cheaper than the worst. Ranked: {{ranked|list}}.',
  inputSchema: {
    type: 'object',
    required: ['options'],
    properties: {
      options: {
        type: 'array', label: 'options', minItems: 2, prompt: 'Which options should I compare? Each needs a price and a quantity.',
        items: { type: 'object' }
      },
      unit: { type: 'string', label: 'unit', default: 'unit' }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      ranked: { type: 'array', items: { type: 'string' } }, results: { type: 'array' },
      best: { type: 'string' }, bestUnitPrice: { type: 'number' },
      worst: { type: 'string' }, saving: { type: 'number' }, unit: { type: 'string' }
    }
  },
  examples: [
    { text: 'which is better value, 500ml for 1.20 or 1.5l for 3.30', input: { options: [{ name: '500ml bottle', price: 1.2, quantity: 0.5 }, { name: '1.5l bottle', price: 3.3, quantity: 1.5 }], unit: 'litre' },
      output: { ranked: ['500ml bottle 2.4/litre', '1.5l bottle 2.2/litre'], results: [{ name: '1.5l bottle', price: 3.3, quantity: 1.5, unitPrice: 2.2 }, { name: '500ml bottle', price: 1.2, quantity: 0.5, unitPrice: 2.4 }], best: '1.5l bottle', bestUnitPrice: 2.2, worst: '500ml bottle', saving: 8.33, unit: 'litre' } },
    { text: 'compare three pack sizes', input: { options: [{ name: 'small', price: 2, quantity: 4 }, { name: 'medium', price: 3.5, quantity: 8 }, { name: 'large', price: 6, quantity: 16 }], unit: 'item' },
      output: { ranked: ['small 0.5/item', 'medium 0.4375/item', 'large 0.375/item'], results: [{ name: 'large', price: 6, quantity: 16, unitPrice: 0.375 }, { name: 'medium', price: 3.5, quantity: 8, unitPrice: 0.4375 }, { name: 'small', price: 2, quantity: 4, unitPrice: 0.5 }], best: 'large', bestUnitPrice: 0.375, worst: 'small', saving: 25, unit: 'item' } },
    { text: 'is the bigger box cheaper per kilo', input: { options: [{ name: 'box', price: 4, quantity: 1 }, { name: 'sack', price: 15, quantity: 5 }], unit: 'kg' },
      output: { ranked: ['box 4/kg', 'sack 3/kg'], results: [{ name: 'sack', price: 15, quantity: 5, unitPrice: 3 }, { name: 'box', price: 4, quantity: 1, unitPrice: 4 }], best: 'sack', bestUnitPrice: 3, worst: 'box', saving: 25, unit: 'kg' } },
    { text: 'compare two identically priced options', input: { options: [{ name: 'a', price: 2, quantity: 1 }, { name: 'b', price: 4, quantity: 2 }] },
      output: { ranked: ['a 2/unit', 'b 2/unit'], results: [{ name: 'a', price: 2, quantity: 1, unitPrice: 2 }, { name: 'b', price: 4, quantity: 2, unitPrice: 2 }], best: 'a', bestUnitPrice: 2, worst: 'b', saving: 0, unit: 'unit' } },
    { text: 'which coffee is best value', input: { options: [{ name: '200g bag', price: 6.5, quantity: 200 }, { name: '1kg bag', price: 24, quantity: 1000 }], unit: 'g' },
      output: { ranked: ['200g bag 0.0325/g', '1kg bag 0.024/g'], results: [{ name: '1kg bag', price: 24, quantity: 1000, unitPrice: 0.024 }, { name: '200g bag', price: 6.5, quantity: 200, unitPrice: 0.0325 }], best: '1kg bag', bestUnitPrice: 0.024, worst: '200g bag', saving: 26.15, unit: 'g' } }
  ],
  errorCases: [
    { input: { options: [{ name: 'a', price: 1, quantity: 1 }] }, code: 'INVALID_INPUT' },
    { input: { options: [{ name: 'a', price: 1 }, { name: 'b', price: 2, quantity: 1 }] }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' }
  ],
  run (input) {
    if (input.options.length < 2) return fail('INVALID_INPUT', 'I need at least two options to compare.', 'options');

    const priced = [];
    for (const [i, o] of input.options.entries()) {
      const name = o && o.name !== undefined ? String(o.name) : `option ${i + 1}`;
      if (!o || typeof o.price !== 'number' || typeof o.quantity !== 'number') {
        return fail('INVALID_INPUT', `"${name}" needs both a price and a quantity as numbers.`, 'options');
      }
      if (o.quantity <= 0) return fail('INVALID_INPUT', `"${name}" has a quantity of zero or less.`, 'options');
      priced.push({ name, price: o.price, quantity: o.quantity, unitPrice: round(o.price / o.quantity, 6) });
    }

    /* Ranked cheapest-first; `ranked` keeps the ORIGINAL order so the reply can
       list the options the way the user typed them while still naming a winner.
       Ties keep their input order, so "a" beats an equally-priced "b". */
    const sorted = [...priced].sort((a, b) => a.unitPrice - b.unitPrice);
    const best = sorted[0];
    const worst = sorted[sorted.length - 1];

    return ok({
      ranked: priced.map(p => `${p.name} ${p.unitPrice}/${input.unit}`),
      results: sorted,
      best: best.name, bestUnitPrice: best.unitPrice,
      worst: worst.name,
      saving: worst.unitPrice > 0 ? round((1 - best.unitPrice / worst.unitPrice) * 100, 2) : 0,
      unit: input.unit
    }, computed());
  }
};
