import { ok, fail, computed } from '../src/contracts.js';
import { round } from '../src/lib/num.js';

export default {
  name: 'cumulativeSum',
  description: 'Build a running total as you go, showing the sum after each number.',
  category: 'statistics', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: 'Running total: {{sums|list}} — {{total|comma}} at the end.',
  inputSchema: {
    type: 'object', required: ['values'],
    properties: {
      values: { type: 'array', label: 'numbers', items: { type: 'number' }, minItems: 1, prompt: 'Which numbers should I total up?' },
      asPercent: { type: 'boolean', label: 'as percentages', default: false, description: 'report each running total as a share of the final total' }
    }
  },
  outputSchema: { type: 'object', properties: { sums: { type: 'array', items: { type: 'number' } }, total: { type: 'number' }, count: { type: 'integer' }, halfwayAt: { type: 'integer' } } },
  examples: [
    { text: 'running total of 10 20 30', input: { values: [10, 20, 30] }, output: { sums: [10, 30, 60], total: 60, count: 3, halfwayAt: 2 } },
    { text: 'cumulative sum of my monthly savings', input: { values: [200, 200, 250, 300] }, output: { sums: [200, 400, 650, 950], total: 950, count: 4, halfwayAt: 3 } },
    { text: 'running total as percentages', input: { values: [25, 25, 50], asPercent: true }, output: { sums: [25, 50, 100], total: 100, count: 3, halfwayAt: 2 } },
    { text: 'cumulative total with a negative', input: { values: [100, -30, 50] }, output: { sums: [100, 70, 120], total: 120, count: 3, halfwayAt: 1 } },
    { text: 'running total of a single value', input: { values: [42] }, output: { sums: [42], total: 42, count: 1, halfwayAt: 1 } },
    { text: 'add these up as I go along: 5 10 15', input: { values: [5, 10, 15] },
      output: { sums: [5, 15, 30], total: 30, count: 3, halfwayAt: 2 } },
    { text: 'give me the running tally of 100 250 75', input: { values: [100, 250, 75] },
      output: { sums: [100, 350, 425], total: 425, count: 3, halfwayAt: 2 } }
  ],
  errorCases: [
    { input: { values: [] }, code: 'INVALID_INPUT' },
    { input: { values: [0, 0], asPercent: true }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' }
  ],
  run (input) {
    if (!input.values.length) return fail('INVALID_INPUT', 'There are no numbers to total.', 'values');
    const raw = [];
    let acc = 0;
    for (const v of input.values) { acc += v; raw.push(round(acc, 6)); }
    const total = raw[raw.length - 1];

    if (input.asPercent) {
      if (total === 0) return fail('INVALID_INPUT', 'The total is zero, so there are no shares to work out.', 'values');
      const pct = raw.map(v => round(v / total * 100, 4));
      return ok({ sums: pct, total: 100, count: raw.length, halfwayAt: pct.findIndex(v => v >= 50) + 1 }, computed());
    }
    /* Where the running total first passes half the final figure — the
       "when had I saved half of it" question, which is why anyone wants a
       cumulative sum rather than a plain total. */
    return ok({
      sums: raw, total, count: raw.length,
      halfwayAt: raw.findIndex(v => Math.abs(v) >= Math.abs(total) / 2) + 1
    }, computed());
  }
};
