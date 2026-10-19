import { ok, fail, computed } from '../src/contracts.js';
import { round } from '../src/lib/num.js';

export default {
  name: 'expectedValue',
  description: 'Work out the expected value of a set of outcomes and their probabilities.',
  category: 'decisions', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: 'Expected value {{expectedValue}} across {{count}} {{count|plural:outcome:outcomes}}: {{lines|list}}. That is the long-run average, not what any single try returns.',
  inputSchema: {
    type: 'object', required: ['outcomes'],
    properties: {
      outcomes: { type: 'array', label: 'outcomes', minItems: 1, maxItems: 50, prompt: 'What are the outcomes and their probabilities?' }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      expectedValue: { type: 'number' }, count: { type: 'integer' },
      contributions: { type: 'array' }, lines: { type: 'array', items: { type: 'string' } },
      probabilityTotal: { type: 'number' }
    }
  },
  examples: [
    { text: 'expected value of a coin flip for 100 or minus 50', input: { outcomes: [{ value: 100, probability: 0.5 }, { value: -50, probability: 0.5 }] }, output: { expectedValue: 25, count: 2, contributions: [{ value: 100, probability: 0.5, contribution: 50 }, { value: -50, probability: 0.5, contribution: -25 }], lines: ['100 at 0.5 contributes 50', '-50 at 0.5 contributes -25'], probabilityTotal: 1 } },
    { text: 'what is the expected value of this lottery', input: { outcomes: [{ value: 1000, probability: 0.01 }, { value: 0, probability: 0.99 }] }, output: { expectedValue: 10, count: 2, contributions: [{ value: 1000, probability: 0.01, contribution: 10 }, { value: 0, probability: 0.99, contribution: 0 }], lines: ['1000 at 0.01 contributes 10', '0 at 0.99 contributes 0'], probabilityTotal: 1 } },
    { text: 'expected value across three outcomes', input: { outcomes: [{ value: 10, probability: 0.3 }, { value: 20, probability: 0.5 }, { value: 30, probability: 0.2 }] }, output: { expectedValue: 19, count: 3, contributions: [{ value: 10, probability: 0.3, contribution: 3 }, { value: 20, probability: 0.5, contribution: 10 }, { value: 30, probability: 0.2, contribution: 6 }], lines: ['10 at 0.3 contributes 3', '20 at 0.5 contributes 10', '30 at 0.2 contributes 6'], probabilityTotal: 1 } },
    { text: 'expected payout with percentages', input: { outcomes: [{ value: 200, probability: 25 }, { value: 0, probability: 75 }] }, output: { expectedValue: 50, count: 2, contributions: [{ value: 200, probability: 0.25, contribution: 50 }, { value: 0, probability: 0.75, contribution: 0 }], lines: ['200 at 0.25 contributes 50', '0 at 0.75 contributes 0'], probabilityTotal: 1 } },
    { text: 'expected value of a certain outcome', input: { outcomes: [{ value: 42, probability: 1 }] }, output: { expectedValue: 42, count: 1, contributions: [{ value: 42, probability: 1, contribution: 42 }], lines: ['42 at 1 contributes 42'], probabilityTotal: 1 } }
  ],
  errorCases: [
    { input: { outcomes: [{ value: 10, probability: 0.3 }, { value: 20, probability: 0.3 }] }, code: 'INVALID_INPUT' },
    { input: { outcomes: [{ value: 'lots', probability: 1 }] }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' }
  ],
  run (input) {
    const rows = [];
    for (const [i, o] of input.outcomes.entries()) {
      const value = typeof o?.value === 'number' ? o.value : Number(o?.value);
      let probability = typeof o?.probability === 'number' ? o.probability : Number(o?.probability);
      if (!Number.isFinite(value)) return fail('INVALID_INPUT', `Outcome ${i + 1} has no numeric value.`, 'outcomes');
      if (!Number.isFinite(probability) || probability < 0) return fail('INVALID_INPUT', `Outcome ${i + 1} has no usable probability.`, 'outcomes');
      rows.push({ value, probability });
    }

    /* Probabilities given as percentages are accepted and converted, because
       "25" and "0.25" are both what people mean by a one-in-four chance. The
       switch is on the total, not on individual values, so a genuine set of
       small probabilities is not mistaken for percentages. */
    const rawTotal = rows.reduce((a, r) => a + r.probability, 0);
    const asPercent = Math.abs(rawTotal - 100) < 1e-9;
    if (asPercent) for (const r of rows) r.probability /= 100;

    const total = round(rows.reduce((a, r) => a + r.probability, 0), 10);
    if (Math.abs(total - 1) > 1e-9) {
      return fail('INVALID_INPUT', `Those probabilities add up to ${total}, not 1. I will not rescale them for you — which one is wrong is a question only you can answer.`, 'outcomes');
    }

    const contributions = rows.map((r) => ({ ...r, contribution: round(r.value * r.probability, 10) }));
    return ok({
      expectedValue: round(contributions.reduce((a, c) => a + c.contribution, 0), 10),
      count: rows.length, contributions,
      lines: contributions.map((c) => `${c.value} at ${c.probability} contributes ${c.contribution}`),
      probabilityTotal: total
    }, computed());
  }
};
