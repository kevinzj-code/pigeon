import { ok, fail, computed } from '../src/contracts.js';
import { round } from '../src/lib/num.js';

export default {
  name: 'stackDiscounts',
  description: 'Take one discount off after another — an extra 15% off an already reduced price — and show the real saving.',
  category: 'everyday', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{price}} becomes {{finalPrice}} — {{saved}} off, which is {{effectivePercent}}% rather than the {{namedPercent}}% the discounts add up to.',
  inputSchema: {
    type: 'object', required: ['price', 'discounts'],
    properties: {
      price: { type: 'number', label: 'price', carry: true, minimum: 0, prompt: 'What is the starting price?' },
      discounts: { type: 'array', label: 'discounts %', minItems: 1, maxItems: 10, items: { type: 'number' }, prompt: 'Which discount percentages apply?' }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      finalPrice: { type: 'number' }, price: { type: 'number' }, saved: { type: 'number' },
      effectivePercent: { type: 'number' }, namedPercent: { type: 'number' },
      steps: { type: 'array' }, lines: { type: 'array', items: { type: 'string' } }
    }
  },
  examples: [
    { text: 'stack 20% and 10% off 100', input: { price: 100, discounts: [20, 10] }, output: { finalPrice: 72, price: 100, saved: 28, effectivePercent: 28, namedPercent: 30, steps: [{ percent: 20, from: 100, to: 80 }, { percent: 10, from: 80, to: 72 }], lines: ['20% off 100 leaves 80', '10% off 80 leaves 72'] } },
    { text: 'apply a single 10% discount to 50', input: { price: 50, discounts: [10] }, output: { finalPrice: 45, price: 50, saved: 5, effectivePercent: 10, namedPercent: 10, steps: [{ percent: 10, from: 50, to: 45 }], lines: ['10% off 50 leaves 45'] } },
    { text: 'three discounts on 200', input: { price: 200, discounts: [25, 25, 10] }, output: { finalPrice: 101.25, price: 200, saved: 98.75, effectivePercent: 49.375, namedPercent: 60, steps: [{ percent: 25, from: 200, to: 150 }, { percent: 25, from: 150, to: 112.5 }, { percent: 10, from: 112.5, to: 101.25 }], lines: ['25% off 200 leaves 150', '25% off 150 leaves 112.5', '10% off 112.5 leaves 101.25'] } },
    { text: 'two 5% discounts on 80', input: { price: 80, discounts: [5, 5] }, output: { finalPrice: 72.2, price: 80, saved: 7.8, effectivePercent: 9.75, namedPercent: 10, steps: [{ percent: 5, from: 80, to: 76 }, { percent: 5, from: 76, to: 72.2 }], lines: ['5% off 80 leaves 76', '5% off 76 leaves 72.2'] } },
    { text: 'half price then 10% off 100', input: { price: 100, discounts: [50, 10] }, output: { finalPrice: 45, price: 100, saved: 55, effectivePercent: 55, namedPercent: 60, steps: [{ percent: 50, from: 100, to: 50 }, { percent: 10, from: 50, to: 45 }], lines: ['50% off 100 leaves 50', '10% off 50 leaves 45'] } },
    { text: 'an extra 15 percent off something already 30 percent off, on 200', input: { price: 200, discounts: [30, 15] },
      output: { finalPrice: 119, price: 200, saved: 81, effectivePercent: 40.5, namedPercent: 45, steps: [{ percent: 30, from: 200, to: 140 }, { percent: 15, from: 140, to: 119 }], lines: ['30% off 200 leaves 140', '15% off 140 leaves 119'] } },
    { text: 'apply 10 then 5 percent off 80', input: { price: 80, discounts: [10, 5] },
      output: { finalPrice: 68.4, price: 80, saved: 11.6, effectivePercent: 14.5, namedPercent: 15, steps: [{ percent: 10, from: 80, to: 72 }, { percent: 5, from: 72, to: 68.4 }], lines: ['10% off 80 leaves 72', '5% off 72 leaves 68.4'] } }
  ],
  errorCases: [
    { input: { price: 100, discounts: [120] }, code: 'INVALID_INPUT' },
    { input: { price: 100, discounts: [] }, code: 'INVALID_INPUT' },
    { input: { discounts: [10] }, code: 'MISSING_FIELD' }
  ],
  run (input) {
    for (const d of input.discounts) {
      if (!Number.isFinite(d) || d < 0 || d > 100) return fail('INVALID_INPUT', `${d} is not a percentage between 0 and 100.`, 'discounts');
    }
    const steps = [];
    let current = input.price;
    for (const percent of input.discounts) {
      const to = round(current * (1 - percent / 100), 10);
      steps.push({ percent, from: current, to });
      current = to;
    }
    /* Stacked discounts do not add up: the second one comes off an already
       reduced price. 20% and 10% is 28% off, not 30% — reporting both numbers
       is the whole point of the skill. */
    const saved = round(input.price - current, 10);
    return ok({
      finalPrice: current, price: input.price, saved,
      effectivePercent: input.price === 0 ? 0 : round((saved / input.price) * 100, 10),
      namedPercent: round(input.discounts.reduce((a, b) => a + b, 0), 10),
      steps, lines: steps.map((s) => `${s.percent}% off ${s.from} leaves ${s.to}`)
    }, computed());
  }
};
