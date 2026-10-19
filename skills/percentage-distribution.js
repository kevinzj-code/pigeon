import { ok, fail, computed } from '../src/contracts.js';
import { round } from '../src/lib/num.js';

export default {
  name: 'percentageDistribution',
  description: 'Split a set of numbers into percentage shares of their total.',
  category: 'math',
  tier: 'core',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: 'Out of {{total|comma}}: {{shares|list}}.',
  inputSchema: {
    type: 'object',
    required: ['values'],
    properties: {
      values: { type: 'array', label: 'values', items: { type: 'number' }, minItems: 1, prompt: 'Which values should I break down?' },
      labels: { type: 'array', label: 'names', items: { type: 'string' }, description: 'a name for each value' },
      decimals: { type: 'integer', label: 'decimal places', minimum: 0, maximum: 4, default: 1 }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      percentages: { type: 'array', items: { type: 'number' } },
      shares: { type: 'array', items: { type: 'string' } },
      total: { type: 'number' }, largest: { type: 'string' }, sumsTo: { type: 'number' }
    }
  },
  examples: [
    { text: 'what percentage of the total is each of 30 50 20', input: { values: [30, 50, 20] },
      output: { percentages: [30, 50, 20], shares: ['30%', '50%', '20%'], total: 100, largest: '50%', sumsTo: 100 } },
    { text: 'break down my spending 450 300 250', input: { values: [450, 300, 250], labels: ['rent', 'food', 'other'] },
      output: { percentages: [45, 30, 25], shares: ['rent 45%', 'food 30%', 'other 25%'], total: 1000, largest: 'rent 45%', sumsTo: 100 } },
    { text: 'share of the total for 1 1 1', input: { values: [1, 1, 1] },
      output: { percentages: [33.4, 33.3, 33.3], shares: ['33.4%', '33.3%', '33.3%'], total: 3, largest: '33.4%', sumsTo: 100 } },
    { text: 'percentage split of 7 and 3', input: { values: [7, 3], labels: ['yes', 'no'] },
      output: { percentages: [70, 30], shares: ['yes 70%', 'no 30%'], total: 10, largest: 'yes 70%', sumsTo: 100 } },
    { text: 'distribution of votes 120 80 45 15', input: { values: [120, 80, 45, 15] },
      output: { percentages: [46.1, 30.8, 17.3, 5.8], shares: ['46.1%', '30.8%', '17.3%', '5.8%'], total: 260, largest: '46.1%', sumsTo: 100 } }
  ],
  errorCases: [
    { input: { values: [] }, code: 'INVALID_INPUT' },
    { input: { values: [0, 0] }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' }
  ],
  run (input) {
    const total = input.values.reduce((a, b) => a + b, 0);
    if (!input.values.length) return fail('INVALID_INPUT', 'There are no values to break down.', 'values');
    if (total === 0) return fail('INVALID_INPUT', 'Those values add up to zero, so there are no shares to work out.', 'values');

    /* Largest-remainder, so the percentages SUM to exactly 100. Rounding each
       share independently gives 33.3 + 33.3 + 33.3 = 99.9, and a breakdown
       that does not add up is the first thing anyone notices. */
    const f = Math.pow(10, input.decimals);
    const exact = input.values.map(v => v / total * 100 * f);
    const floors = exact.map(Math.floor);
    let remainder = Math.round(100 * f) - floors.reduce((a, b) => a + b, 0);
    const order = exact.map((v, i) => [v - floors[i], i]).sort((a, b) => b[0] - a[0]);
    const counts = [...floors];
    for (let k = 0; k < remainder; k++) counts[order[k % order.length][1]] += 1;

    const percentages = counts.map(c => round(c / f, input.decimals));
    const shares = percentages.map((p, i) =>
      input.labels && input.labels[i] ? `${input.labels[i]} ${p}%` : `${p}%`);
    const topIndex = percentages.indexOf(Math.max(...percentages));

    return ok({
      percentages, shares, total: round(total, 6),
      largest: shares[topIndex],
      sumsTo: round(percentages.reduce((a, b) => a + b, 0), input.decimals)
    }, computed());
  }
};
