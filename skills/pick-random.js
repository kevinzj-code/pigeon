import { ok, fail, computed } from '../src/contracts.js';
import { mulberry32 } from '../src/lib/seeded.js';

export default {
  name: 'pickRandom',
  description: 'Pick one or more items at random from a list, from a seed so the pick can be repeated.',
  category: 'lists', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: ['toy'],
  replyTemplate: '{{picked|list}} — seed {{seed}}.',
  inputSchema: {
    type: 'object', required: ['items', 'seed'],
    properties: {
      items: { type: 'array', label: 'list', minItems: 1, prompt: 'Which list should I pick from?' },
      seed: { type: 'integer', label: 'repeatable seed', minimum: 0, prompt: 'Which seed? Any whole number — the same seed always picks the same thing.' },
      count: { type: 'integer', label: 'how many', minimum: 1, maximum: 1000, default: 1 },
      allowRepeats: { type: 'boolean', label: 'allow repeats', default: false }
    }
  },
  outputSchema: { type: 'object', properties: { picked: { type: 'array' }, first: {}, count: { type: 'integer' }, from: { type: 'integer' }, seed: { type: 'integer' } } },
  examples: [
    { text: 'pick one of these at random with seed 7', input: { items: ['tea', 'coffee', 'water'], seed: 7 }, output: { picked: ['tea'], first: 'tea', count: 1, from: 3, seed: 7 } },
    { text: 'choose a name from the list, seed 1', input: { items: ['Ana', 'Bo', 'Cy'], seed: 1 }, output: { picked: ['Bo'], first: 'Bo', count: 1, from: 3, seed: 1 } },
    { text: 'pick 2 winners with seed 42', input: { items: ['a', 'b', 'c', 'd', 'e'], seed: 42, count: 2 }, output: { picked: ['d', 'b'], first: 'd', count: 2, from: 5, seed: 42 } },
    { text: 'pick 3 allowing repeats, seed 5', input: { items: ['x', 'y'], seed: 5, count: 3, allowRepeats: true }, output: { picked: ['y', 'y', 'x'], first: 'y', count: 3, from: 2, seed: 5 } },
    { text: 'pick from a one item list', input: { items: ['only'], seed: 9 }, output: { picked: ['only'], first: 'only', count: 1, from: 1, seed: 9 } }
  ],
  errorCases: [
    { input: { items: [], seed: 1 }, code: 'INVALID_INPUT' },
    { input: { items: ['a', 'b'], seed: 1, count: 5 }, code: 'INVALID_INPUT' },
    { input: { items: ['a'] }, code: 'MISSING_FIELD' }
  ],
  run (input) {
    if (!input.items.length) return fail('INVALID_INPUT', 'There is nothing in that list to pick from.', 'items');
    if (!input.allowRepeats && input.count > input.items.length) {
      return fail('INVALID_INPUT', `You asked for ${input.count} but there are only ${input.items.length} to choose from.`, 'count');
    }
    const rand = mulberry32(input.seed);
    const picked = [];
    if (input.allowRepeats) {
      for (let i = 0; i < input.count; i++) picked.push(input.items[Math.floor(rand() * input.items.length)]);
    } else {
      /* Partial Fisher-Yates over a copy: draw without replacement without
         shuffling the whole list, and without the retry loop that would make
         a near-exhaustive pick take unbounded time. */
      const pool = [...input.items];
      for (let i = 0; i < input.count; i++) {
        const j = Math.floor(rand() * pool.length);
        picked.push(pool[j]);
        pool.splice(j, 1);
      }
    }
    return ok({ picked, first: picked[0], count: picked.length, from: input.items.length, seed: input.seed }, computed());
  }
};
