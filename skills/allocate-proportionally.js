import { ok, fail, computed } from '../src/contracts.js';

export default {
  name: 'allocateProportionally',
  description: 'Split an amount across shares in proportion to their weights.',
  category: 'math', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{total}} split across {{count}} {{count|plural:share:shares}}: {{lines|list}}.',
  inputSchema: {
    type: 'object', required: ['total', 'weights'],
    properties: {
      total: { type: 'number', label: 'amount', carry: true, prompt: 'What amount should I split?' },
      weights: { type: 'array', label: 'weights', minItems: 1, maxItems: 100, items: { type: 'number' }, prompt: 'What are the shares?' },
      labels: { type: 'array', label: 'names', items: { type: 'string' }, description: 'a name for each share' },
      decimals: { type: 'integer', label: 'decimal places', minimum: 0, maximum: 6, default: 2 }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      amounts: { type: 'array', items: { type: 'number' } }, lines: { type: 'array', items: { type: 'string' } },
      total: { type: 'number' }, allocated: { type: 'number' }, count: { type: 'integer' }
    }
  },
  examples: [
    { text: 'share 100 out in equal parts between three', input: { total: 100, weights: [1, 1, 1] }, output: { amounts: [33.34, 33.33, 33.33], lines: ['33.34', '33.33', '33.33'], total: 100, allocated: 100, count: 3 } },
    { text: 'allocate 1000 by 50 30 20', input: { total: 1000, weights: [50, 30, 20] }, output: { amounts: [500, 300, 200], lines: ['500', '300', '200'], total: 1000, allocated: 1000, count: 3 } },
    { text: 'divide 100 in a one to two ratio', input: { total: 100, weights: [1, 2] }, output: { amounts: [33.33, 66.67], lines: ['33.33', '66.67'], total: 100, allocated: 100, count: 2 } },
    { text: 'share 10 items between three people', input: { total: 10, weights: [1, 1, 1], decimals: 0 }, output: { amounts: [4, 3, 3], lines: ['4', '3', '3'], total: 10, allocated: 10, count: 3 } },
    { text: 'split 1200 rent by room size', input: { total: 1200, weights: [3, 1], labels: ['big room', 'small room'] }, output: { amounts: [900, 300], lines: ['big room 900', 'small room 300'], total: 1200, allocated: 1200, count: 2 } }
  ],
  errorCases: [
    { input: { total: 100, weights: [0, 0] }, code: 'INVALID_INPUT' },
    { input: { total: 100, weights: [1, -1] }, code: 'INVALID_INPUT' },
    { input: { weights: [1] }, code: 'MISSING_FIELD' }
  ],
  run (input) {
    const weights = input.weights;
    if (weights.some((w) => !Number.isFinite(w) || w < 0)) return fail('INVALID_INPUT', 'Weights have to be zero or more.', 'weights');
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    if (totalWeight === 0) return fail('INVALID_INPUT', 'All the weights are zero, so there is no proportion to split by.', 'weights');
    if (input.labels && input.labels.length !== weights.length) {
      return fail('INVALID_INPUT', `There are ${weights.length} weights but ${input.labels.length} labels.`, 'labels');
    }

    /* Largest remainder. Rounding each share independently leaves the parts
       not adding up to the whole — three ways of 100 gives 33.33 each and loses
       a penny. The shortfall goes to the shares with the largest discarded
       fraction, so the parts always sum to the total exactly. */
    const scale = 10 ** input.decimals;
    const exact = weights.map((w) => (input.total * w) / totalWeight);
    const units = exact.map((e) => Math.floor(e * scale));
    let short = Math.round(input.total * scale) - units.reduce((a, b) => a + b, 0);
    const order = exact
      .map((e, i) => ({ i, frac: e * scale - units[i] }))
      .sort((a, b) => b.frac - a.frac || a.i - b.i);
    for (let k = 0; short > 0; k++, short--) units[order[k % order.length].i] += 1;

    const amounts = units.map((u) => u / scale);
    return ok({
      amounts,
      lines: amounts.map((a, i) => (input.labels ? `${input.labels[i]} ${a}` : String(a))),
      total: input.total,
      allocated: Number(amounts.reduce((a, b) => a + b, 0).toFixed(input.decimals)),
      count: amounts.length
    }, computed());
  }
};
