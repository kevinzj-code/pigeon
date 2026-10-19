import { ok, fail, computed } from '../src/contracts.js';
import { mulberry32 } from '../src/lib/seeded.js';

export default {
  name: 'shuffleList',
  description: "Jumble any list into a random order from a seed.",
  category: 'lists', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: ['toy'],
  replyTemplate: '{{items|list}} — seed {{seed}}.',
  inputSchema: {
    type: 'object', required: ['items', 'seed'],
    properties: {
      items: { type: 'array', label: 'list', minItems: 2, prompt: 'Which list should I shuffle?' },
      seed: { type: 'integer', label: 'repeatable seed', minimum: 0, prompt: 'Which seed? Any whole number — the same seed always gives the same order.' }
    }
  },
  outputSchema: { type: 'object', properties: { items: { type: 'array' }, count: { type: 'integer' }, seed: { type: 'integer' }, moved: { type: 'integer' } } },
  examples: [
    { text: 'shuffle these with seed 7', input: { items: [1, 2, 3, 4, 5], seed: 7 }, output: { items: [4, 2, 3, 5, 1], count: 5, seed: 7, moved: 3 } },
    { text: 'randomise this list, seed 1', input: { items: ['a', 'b', 'c'], seed: 1 }, output: { items: ['c', 'a', 'b'], count: 3, seed: 1, moved: 3 } },
    { text: 'shuffle the running order with seed 42', input: { items: ['Ana', 'Bo', 'Cy', 'Di'], seed: 42 }, output: { items: ['Ana', 'Di', 'Bo', 'Cy'], count: 4, seed: 42, moved: 3 } },
    { text: 'shuffle two items with seed 3', input: { items: ['heads', 'tails'], seed: 3 }, output: { items: ['heads', 'tails'], count: 2, seed: 3, moved: 0 } },
    { text: 'shuffle six numbers seed 2026', input: { items: [1, 2, 3, 4, 5, 6], seed: 2026 }, output: { items: [4, 1, 5, 6, 2, 3], count: 6, seed: 2026, moved: 6 } },
    { text: 'jumble up this playlist, seed 9', input: { items: ['intro', 'verse', 'chorus', 'outro'], seed: 9 },
      output: { items: ['verse', 'outro', 'chorus', 'intro'], count: 4, seed: 9, moved: 3 } },
    { text: 'mix these into a random order with seed 2', input: { items: [1, 2, 3, 4, 5, 6], seed: 2 },
      output: { items: [1, 3, 4, 6, 2, 5], count: 6, seed: 2, moved: 5 } }
  ],
  errorCases: [
    { input: { items: [1], seed: 1 }, code: 'INVALID_INPUT' },
    { input: { items: [1, 2], seed: -1 }, code: 'INVALID_INPUT' },
    { input: { items: [1, 2] }, code: 'MISSING_FIELD' }
  ],
  run (input) {
    if (input.items.length < 2) return fail('INVALID_INPUT', 'A list needs at least two items to shuffle.', 'items');
    /* Fisher-Yates, walking backwards — the only shuffle that gives every
       permutation equal probability. The naive `sort(() => rand() - 0.5)` does
       not, and biases badly toward the original order. */
    const items = [...input.items];
    const rand = mulberry32(input.seed);
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
    return ok({
      items, count: items.length, seed: input.seed,
      moved: items.filter((v, i) => v !== input.items[i]).length
    }, computed());
  }
};
