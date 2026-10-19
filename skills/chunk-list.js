import { ok, fail, computed } from '../src/contracts.js';

export default {
  name: 'chunkList',
  description: 'Split a list into consecutive groups of a fixed size — deal items into groups of four.',
  category: 'lists', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{count}} {{count|plural:group:groups}} of up to {{size}}: {{summary|prose}}',
  inputSchema: {
    type: 'object', required: ['items', 'size'],
    properties: {
      items: { type: 'array', label: 'list', minItems: 1, prompt: 'Which list should I split?' },
      size: { type: 'integer', label: 'group size', minimum: 1, prompt: 'How many per group?' }
    }
  },
  outputSchema: { type: 'object', properties: { chunks: { type: 'array' }, count: { type: 'integer' }, size: { type: 'integer' }, lastSize: { type: 'integer' }, even: { type: 'boolean' }, summary: { type: 'string' } } },
  examples: [
    { text: 'split these into groups of 3', input: { items: [1, 2, 3, 4, 5, 6, 7], size: 3 }, output: { chunks: [[1, 2, 3], [4, 5, 6], [7]], count: 3, size: 3, lastSize: 1, even: false, summary: '[1, 2, 3] [4, 5, 6] [7]' } },
    { text: 'break this list into pairs', input: { items: ['a', 'b', 'c', 'd'], size: 2 }, output: { chunks: [['a', 'b'], ['c', 'd']], count: 2, size: 2, lastSize: 2, even: true, summary: '[a, b] [c, d]' } },
    { text: 'group 10 items 4 at a time', input: { items: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], size: 4 }, output: { chunks: [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10]], count: 3, size: 4, lastSize: 2, even: false, summary: '[1, 2, 3, 4] [5, 6, 7, 8] [9, 10]' } },
    { text: 'chunk a list into ones', input: { items: ['x', 'y'], size: 1 }, output: { chunks: [['x'], ['y']], count: 2, size: 1, lastSize: 1, even: true, summary: '[x] [y]' } },
    { text: 'chunk size larger than the list', input: { items: [1, 2], size: 5 }, output: { chunks: [[1, 2]], count: 1, size: 5, lastSize: 2, even: false, summary: '[1, 2]' } },
    { text: 'deal these names into groups of two', input: { items: ['Ana', 'Bo', 'Cy', 'Di'], size: 2 },
      output: { chunks: [['Ana', 'Bo'], ['Cy', 'Di']], count: 2, size: 2, lastSize: 2, even: true, summary: '[Ana, Bo] [Cy, Di]' } },
    { text: 'break this list into batches of 3', input: { items: [1, 2, 3, 4, 5, 6, 7, 8], size: 3 },
      output: { chunks: [[1, 2, 3], [4, 5, 6], [7, 8]], count: 3, size: 3, lastSize: 2, even: false, summary: '[1, 2, 3] [4, 5, 6] [7, 8]' } }
  ],
  errorCases: [
    { input: { items: [1, 2], size: 0 }, code: 'INVALID_INPUT' },
    { input: { items: [], size: 2 }, code: 'INVALID_INPUT' },
    { input: { items: [1, 2] }, code: 'MISSING_FIELD' }
  ],
  run (input) {
    if (!input.items.length) return fail('INVALID_INPUT', 'There is nothing in that list to split.', 'items');
    const chunks = [];
    for (let i = 0; i < input.items.length; i += input.size) {
      chunks.push(input.items.slice(i, i + input.size));
    }
    const lastSize = chunks[chunks.length - 1].length;
    return ok({
      chunks, count: chunks.length, size: input.size, lastSize,
      /* `even` says whether the last group is short — the thing that decides
         whether a "split into teams" answer is actually usable. */
      even: lastSize === input.size,
      summary: chunks.map(c => `[${c.join(', ')}]`).join(' ')
    }, computed());
  }
};
