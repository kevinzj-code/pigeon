import { ok, fail, computed } from '../src/contracts.js';
import { mulberry32 } from '../src/lib/seeded.js';

export default {
  name: 'pairUp',
  description: "Draw people into random pairs or teams from a seed.",
  category: 'lists', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{count}} {{count|plural:group:groups}}: {{summary|prose}}{{leftoverNote|prose}}',
  inputSchema: {
    type: 'object', required: ['items', 'seed'],
    properties: {
      items: { type: 'array', label: 'list', minItems: 2, prompt: 'Who or what should I pair up?' },
      seed: { type: 'integer', label: 'repeatable seed', minimum: 0, prompt: 'Which seed? Any whole number — the same seed always draws the same pairs.' },
      groupSize: { type: 'integer', label: 'group size', minimum: 2, default: 2 }
    }
  },
  outputSchema: { type: 'object', properties: { groups: { type: 'array' }, count: { type: 'integer' }, leftover: { type: 'array' }, leftoverNote: { type: 'string' }, summary: { type: 'string' }, seed: { type: 'integer' } } },
  examples: [
    { text: 'pair these four people up, seed 7', input: { items: ['Ana', 'Bo', 'Cy', 'Di'], seed: 7 }, output: { groups: [['Cy', 'Bo'], ['Di', 'Ana']], count: 2, leftover: [], leftoverNote: '', summary: 'Cy & Bo, Di & Ana', seed: 7 } },
    { text: 'draw pairs from five names, seed 1', input: { items: ['a', 'b', 'c', 'd', 'e'], seed: 1 }, output: { groups: [['e', 'c'], ['b', 'a']], count: 2, leftover: ['d'], leftoverNote: ' d is left over.', summary: 'e & c, b & a', seed: 1 } },
    { text: 'split six into teams of three, seed 42', input: { items: [1, 2, 3, 4, 5, 6], seed: 42, groupSize: 3 }, output: { groups: [[2, 1, 5], [6, 3, 4]], count: 2, leftover: [], leftoverNote: '', summary: '2 & 1 & 5, 6 & 3 & 4', seed: 42 } },
    { text: 'pair two people', input: { items: ['x', 'y'], seed: 3 }, output: { groups: [['x', 'y']], count: 1, leftover: [], leftoverNote: '', summary: 'x & y', seed: 3 } },
    { text: 'secret santa draw for three, seed 9', input: { items: ['Ana', 'Bo', 'Cy'], seed: 9 }, output: { groups: [['Cy', 'Bo']], count: 1, leftover: ['Ana'], leftoverNote: ' Ana is left over.', summary: 'Cy & Bo', seed: 9 } }
  ],
  errorCases: [
    { input: { items: ['a'], seed: 1 }, code: 'INVALID_INPUT' },
    { input: { items: ['a', 'b'], seed: 1, groupSize: 5 }, code: 'INVALID_INPUT' },
    { input: { items: ['a', 'b'] }, code: 'MISSING_FIELD' }
  ],
  run (input) {
    if (input.items.length < 2) return fail('INVALID_INPUT', 'I need at least two to pair up.', 'items');
    if (input.groupSize > input.items.length) {
      return fail('INVALID_INPUT', `A group of ${input.groupSize} needs at least that many — there are ${input.items.length}.`, 'groupSize');
    }
    /* Shuffle first, then cut into groups. Cutting an unshuffled list into
       pairs would put whoever was typed together in the same group every time,
       which is the opposite of a draw. */
    const pool = [...input.items];
    const rand = mulberry32(input.seed);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const groups = [];
    while (pool.length >= input.groupSize) groups.push(pool.splice(0, input.groupSize));
    /* Whoever is left over is NAMED rather than quietly dropped or bundled
       into an oversized group — an uneven draw is a fact the organiser needs. */
    return ok({
      groups, count: groups.length, leftover: pool,
      leftoverNote: pool.length ? ` ${pool.join(' and ')} ${pool.length === 1 ? 'is' : 'are'} left over.` : '',
      summary: groups.map(g => g.join(' & ')).join(', '),
      seed: input.seed
    }, computed());
  }
};
