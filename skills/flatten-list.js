import { ok, computed } from '../src/contracts.js';

export default {
  name: 'flattenList',
  description: 'Flatten a list of nested lists into a single flat list.',
  category: 'lists', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{count}} {{count|plural:item:items}} from {{depth}} levels: {{items|list}}',
  inputSchema: {
    type: 'object', required: ['items'],
    properties: {
      items: { type: 'array', label: 'list', minItems: 1, prompt: 'Which nested list should I flatten?' },
      depth: { type: 'integer', label: 'levels to flatten', minimum: 1, maximum: 20, description: 'how many levels to flatten — all of them by default' }
    }
  },
  outputSchema: { type: 'object', properties: { items: { type: 'array' }, count: { type: 'integer' }, depth: { type: 'integer' }, originalCount: { type: 'integer' } } },
  examples: [
    { text: 'flatten this nested list', input: { items: [1, [2, 3], [4, [5]]] }, output: { items: [1, 2, 3, 4, 5], count: 5, depth: 3, originalCount: 3 } },
    { text: 'flatten a list of lists', input: { items: [['a', 'b'], ['c']] }, output: { items: ['a', 'b', 'c'], count: 3, depth: 2, originalCount: 2 } },
    { text: 'flatten only one level deep', input: { items: [1, [2, [3, 4]]], depth: 1 }, output: { items: [1, 2, [3, 4]], count: 3, depth: 3, originalCount: 2 } },
    { text: 'flatten an already flat list', input: { items: [1, 2, 3] }, output: { items: [1, 2, 3], count: 3, depth: 1, originalCount: 3 } },
    { text: 'flatten deeply nested groups', input: { items: [[[['deep']]]] }, output: { items: ['deep'], count: 1, depth: 4, originalCount: 1 } }
  ],
  errorCases: [
    { input: { items: [] }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' },
    { input: { items: [1], depth: 0 }, code: 'INVALID_INPUT' }
  ],
  run (input) {
    /* The ORIGINAL depth is reported even when only part of it is flattened,
       so "flatten one level" tells you how much nesting is still there.
       A non-array is depth 0 and a list is one more than its deepest member —
       the earlier version threaded a level counter through and came out one
       short on every input. */
    const measure = (v) => (Array.isArray(v) ? 1 + Math.max(0, ...v.map(measure)) : 0);
    const depth = measure(input.items);
    const items = input.items.flat(input.depth ?? Infinity);
    return ok({ items, count: items.length, depth, originalCount: input.items.length }, computed());
  }
};
