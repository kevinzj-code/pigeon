import { ok, fail, computed } from '../src/contracts.js';
import { round } from '../src/lib/num.js';

/* 50/30/20 is Warren & Tyagi's rule of thumb, and it is a DEFAULT here rather
   than advice: the skill divides an income by whatever ratios it is given and
   says which ones it used. It does not know your rent, your city or your
   circumstances, and §27's "no targets or advice" principle applies just as
   much to money as to health. */
const PRESETS = {
  '50/30/20': { labels: ['needs', 'wants', 'savings'], ratios: [50, 30, 20] },
  '70/20/10': { labels: ['living', 'savings', 'giving'], ratios: [70, 20, 10] },
  '60/20/20': { labels: ['essentials', 'savings', 'discretionary'], ratios: [60, 20, 20] }
};

export default {
  name: 'budgetSplit',
  description: 'Divide an income into budget categories by percentage, using 50/30/20 or ratios you set.',
  category: 'organising',
  tier: 'core',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: 'Out of {{income|comma}}: {{breakdown|list}}. That is the {{preset}} split, not a recommendation.',
  inputSchema: {
    type: 'object',
    required: ['income'],
    properties: {
      income: { type: 'number', label: 'amount to divide', carry: true, exclusiveMinimum: 0, prompt: 'How much is there to divide?' },
      preset: { type: 'string', label: 'budget rule', enum: Object.keys(PRESETS), default: '50/30/20' },
      ratios: { type: 'array', label: 'percentages', items: { type: 'number' }, description: 'your own percentages, which must add to 100' },
      labels: { type: 'array', label: 'category names', items: { type: 'string' }, description: 'a name for each of your own ratios' }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      amounts: { type: 'array', items: { type: 'number' } },
      breakdown: { type: 'array', items: { type: 'string' } },
      labels: { type: 'array', items: { type: 'string' } },
      ratios: { type: 'array', items: { type: 'number' } },
      income: { type: 'number' }, preset: { type: 'string' }, total: { type: 'number' }
    }
  },
  examples: [
    { text: 'split 3000 a month using 50/30/20', input: { income: 3000 },
      output: { amounts: [1500, 900, 600], breakdown: ['needs 1500', 'wants 900', 'savings 600'], labels: ['needs', 'wants', 'savings'], ratios: [50, 30, 20], income: 3000, preset: '50/30/20', total: 3000 } },
    { text: 'budget 2450 with the 70/20/10 rule', input: { income: 2450, preset: '70/20/10' },
      output: { amounts: [1715, 490, 245], breakdown: ['living 1715', 'savings 490', 'giving 245'], labels: ['living', 'savings', 'giving'], ratios: [70, 20, 10], income: 2450, preset: '70/20/10', total: 2450 } },
    { text: 'split 1000 my own way 40 40 20', input: { income: 1000, ratios: [40, 40, 20], labels: ['rent', 'food', 'other'] },
      output: { amounts: [400, 400, 200], breakdown: ['rent 400', 'food 400', 'other 200'], labels: ['rent', 'food', 'other'], ratios: [40, 40, 20], income: 1000, preset: 'custom', total: 1000 } },
    { text: 'divide 3333.33 into 50/30/20', input: { income: 3333.33 },
      output: { amounts: [1666.66, 1000, 666.67], breakdown: ['needs 1666.66', 'wants 1000', 'savings 666.67'], labels: ['needs', 'wants', 'savings'], ratios: [50, 30, 20], income: 3333.33, preset: '50/30/20', total: 3333.33 } },
    { text: 'split 5000 sixty twenty twenty', input: { income: 5000, preset: '60/20/20' },
      output: { amounts: [3000, 1000, 1000], breakdown: ['essentials 3000', 'savings 1000', 'discretionary 1000'], labels: ['essentials', 'savings', 'discretionary'], ratios: [60, 20, 20], income: 5000, preset: '60/20/20', total: 5000 } }
  ],
  errorCases: [
    { input: { income: 1000, ratios: [50, 30] }, code: 'INVALID_INPUT' },
    { input: { income: 1000, ratios: [50, 30, 20], labels: ['a'] }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' }
  ],
  run (input) {
    let ratios, labels, preset;
    if (input.ratios) {
      const total = input.ratios.reduce((a, b) => a + b, 0);
      if (Math.abs(total - 100) > 0.01) {
        return fail('INVALID_INPUT', `Those percentages add up to ${round(total, 2)}, not 100.`, 'ratios');
      }
      if (input.labels && input.labels.length !== input.ratios.length) {
        return fail('INVALID_INPUT', `There are ${input.ratios.length} percentages but ${input.labels.length} label${input.labels.length === 1 ? '' : 's'}.`, 'labels');
      }
      ratios = input.ratios;
      labels = input.labels || ratios.map((r, i) => `part ${i + 1}`);
      preset = 'custom';
    } else {
      ({ ratios, labels } = PRESETS[input.preset]);
      preset = input.preset;
    }

    /* Largest-remainder again, so the parts SUM to the income exactly. A budget
       that is 1p short of the pay cheque is the first thing anyone notices. */
    const cents = Math.round(input.income * 100);
    const exact = ratios.map(r => cents * r / 100);
    const floors = exact.map(Math.floor);
    let left = cents - floors.reduce((a, b) => a + b, 0);
    const order = exact.map((v, i) => [v - floors[i], i]).sort((a, b) => b[0] - a[0]);
    const counts = [...floors];
    for (let k = 0; k < left; k++) counts[order[k % order.length][1]] += 1;
    const amounts = counts.map(c => round(c / 100, 2));

    return ok({
      amounts,
      breakdown: amounts.map((a, i) => `${labels[i]} ${a}`),
      labels, ratios, income: input.income, preset,
      total: round(amounts.reduce((a, b) => a + b, 0), 2)
    }, computed());
  }
};
