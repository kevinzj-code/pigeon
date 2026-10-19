import { ok, fail, computed } from '../src/contracts.js';
import { mulberry32, intBetween } from '../src/lib/seeded.js';

export default {
  name: 'flashcardShuffle',
  description: 'Shuffle a set of flashcards into a study order.',
  category: 'learning', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{count}} {{count|plural:card:cards}} shuffled with seed {{seed}}: {{cards|list}}.',
  inputSchema: {
    type: 'object', required: ['cards'],
    properties: {
      cards: { type: 'array', label: 'cards', minItems: 2, maxItems: 500, items: { type: 'string' }, prompt: 'Which cards should I shuffle?' },
      seed: { type: 'integer', label: 'repeatable seed', minimum: 0, maximum: 2147483647, default: 1 }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      cards: { type: 'array', items: { type: 'string' } }, count: { type: 'integer' },
      seed: { type: 'integer' }, movedCount: { type: 'integer' }
    }
  },
  examples: [
    { text: 'shuffle my flashcards', input: { cards: ['alpha', 'beta', 'gamma', 'delta', 'epsilon'] }, output: { cards: ['epsilon', 'gamma', 'beta', 'alpha', 'delta'], count: 5, seed: 1, movedCount: 5 } },
    { text: 'shuffle these cards with seed 42', input: { cards: ['one', 'two', 'three', 'four'], seed: 42 }, output: { cards: ['one', 'four', 'two', 'three'], count: 4, seed: 42, movedCount: 3 } },
    { text: 'randomise this deck', input: { cards: ['red', 'green', 'blue'], seed: 7 }, output: { cards: ['green', 'blue', 'red'], count: 3, seed: 7, movedCount: 3 } },
    { text: 'mix up my revision cards', input: { cards: ['Paris', 'Rome', 'Madrid', 'Berlin', 'Lisbon', 'Vienna'], seed: 3 }, output: { cards: ['Madrid', 'Berlin', 'Vienna', 'Rome', 'Paris', 'Lisbon'], count: 6, seed: 3, movedCount: 6 } },
    { text: 'shuffle two cards', input: { cards: ['front', 'back'], seed: 2 }, output: { cards: ['front', 'back'], count: 2, seed: 2, movedCount: 0 } }
  ],
  errorCases: [
    { input: { cards: ['only one'] }, code: 'INVALID_INPUT' },
    { input: { cards: [] }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' }
  ],
  run (input) {
    const cards = input.cards.map((c) => String(c));
    /* Fisher-Yates, seeded. Every permutation is equally likely, unlike the
       sort-by-random-comparator trick, which is biased and depends on the
       engine's sort. Seeded so the same deck and seed give the same order -
       a study session you can come back to. */
    const rand = mulberry32(input.seed);
    const out = [...cards];
    for (let i = out.length - 1; i > 0; i--) {
      const j = intBetween(rand, 0, i);
      [out[i], out[j]] = [out[j], out[i]];
    }
    return ok({
      cards: out, count: out.length, seed: input.seed,
      movedCount: out.filter((c, i) => c !== cards[i]).length
    }, computed());
  }
};
