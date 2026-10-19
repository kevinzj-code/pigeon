import { ok, computed } from '../src/contracts.js';
import { mulberry32 } from '../src/lib/seeded.js';

export default {
  name: 'flipCoin',
  description: 'Flip a coin for heads or tails, one flip or several, from a seed so it can be repeated.',
  category: 'generation',
  tier: 'core',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: ['toy'],
  replyTemplate: '{{summary|prose}} (seed {{seed}}).',
  inputSchema: {
    type: 'object',
    required: ['seed'],
    properties: {
      seed: { type: 'integer', label: 'repeatable seed', minimum: 0, prompt: 'Which seed should I flip from? Any whole number — the same seed always gives the same flip.' },
      count: { type: 'integer', label: 'flips', minimum: 1, maximum: 1000, default: 1 }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      results: { type: 'array', items: { type: 'string' } }, heads: { type: 'integer' },
      tails: { type: 'integer' }, count: { type: 'integer' }, seed: { type: 'integer' },
      summary: { type: 'string' }
    }
  },
  examples: [
    { text: 'flip a coin with seed 1', input: { seed: 1 },
      output: { results: ['tails'], heads: 0, tails: 1, count: 1, seed: 1, summary: 'tails' } },
    { text: 'flip a coin seed 7', input: { seed: 7 },
      output: { results: ['heads'], heads: 1, tails: 0, count: 1, seed: 7, summary: 'heads' } },
    { text: 'flip 5 coins with seed 42', input: { seed: 42, count: 5 },
      output: { results: ['tails', 'heads', 'tails', 'tails', 'heads'], heads: 2, tails: 3, count: 5, seed: 42, summary: '2 heads and 3 tails' } },
    { text: 'flip 10 coins seed 2026', input: { seed: 2026, count: 10 },
      output: { results: ['heads', 'heads', 'tails', 'tails', 'heads', 'heads', 'tails', 'tails', 'heads', 'heads'], heads: 6, tails: 4, count: 10, seed: 2026, summary: '6 heads and 4 tails' } },
    { text: 'coin toss with seed 100', input: { seed: 100 },
      output: { results: ['heads'], heads: 1, tails: 0, count: 1, seed: 100, summary: 'heads' } },
    { text: 'heads or tails with seed 3', input: { seed: 3 },
      output: { results: ['tails'], heads: 0, tails: 1, count: 1, seed: 3, summary: 'tails' } },
    { text: 'toss a coin for me, seed 12', input: { seed: 12 },
      output: { results: ['heads'], heads: 1, tails: 0, count: 1, seed: 12, summary: 'heads' } }
  ],
  errorCases: [
    { input: { seed: -1 }, code: 'INVALID_INPUT' },
    { input: { seed: 1, count: 0 }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' }
  ],
  run (input) {
    const rand = mulberry32(input.seed);
    const results = Array.from({ length: input.count }, () => (rand() < 0.5 ? 'heads' : 'tails'));
    const heads = results.filter(r => r === 'heads').length;
    const tails = results.length - heads;
    return ok({
      results, heads, tails, count: results.length, seed: input.seed,
      summary: results.length === 1 ? results[0] : `${heads} heads and ${tails} tails`
    }, computed());
  }
};
