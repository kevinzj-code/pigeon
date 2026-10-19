import { ok, computed } from '../src/contracts.js';
import { uniqueBy, partition } from '../src/lib/sets.js';

export default {
  name: 'unionLists',
  description: 'Merge two lists into one, dropping repeats.',
  category: 'lists', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{count}} unique {{count|plural:item:items}} across both lists, {{sharedCount}} of which {{sharedCount|plural:was:were}} in both: {{items|list}}',
  inputSchema: {
    type: 'object',
    required: ['first', 'second'],
    properties: {
      first: { type: 'array', label: 'first list', minItems: 1, prompt: 'What is the first list?' },
      second: { type: 'array', label: 'second list', minItems: 1, prompt: 'And the second list?' },
      ignoreCase: { type: 'boolean', label: 'ignore case', default: false }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      items: { type: 'array' }, count: { type: 'integer' }, sharedCount: { type: 'integer' },
      firstCount: { type: 'integer' }, secondCount: { type: 'integer' }
    }
  },
  examples: [
    { text: 'combine these two lists', input: { first: ['a', 'b'], second: ['b', 'c'] },
      output: { items: ['a', 'b', 'c'], count: 3, sharedCount: 1, firstCount: 2, secondCount: 2 } },
    { text: 'merge two lists of numbers', input: { first: [1, 2], second: [3, 4] },
      output: { items: [1, 2, 3, 4], count: 4, sharedCount: 0, firstCount: 2, secondCount: 2 } },
    { text: 'union of two identical lists', input: { first: ['x', 'y'], second: ['x', 'y'] },
      output: { items: ['x', 'y'], count: 2, sharedCount: 2, firstCount: 2, secondCount: 2 } },
    { text: 'join these lists dropping repeats', input: { first: ['a', 'b', 'a'], second: ['b', 'c'] },
      output: { items: ['a', 'b', 'c'], count: 3, sharedCount: 1, firstCount: 3, secondCount: 2 } },
    { text: 'combine two name lists ignoring case', input: { first: ['Ana', 'Bo'], second: ['ana', 'Cy'], ignoreCase: true },
      output: { items: ['Ana', 'Bo', 'Cy'], count: 3, sharedCount: 1, firstCount: 2, secondCount: 2 } }
  ],
  errorCases: [
    { input: { first: [], second: ['a'] }, code: 'INVALID_INPUT' },
    { input: { second: ['a'] }, code: 'MISSING_FIELD' },
    { input: { first: ['a'], second: ['a'], ignoreCase: 'maybe' }, code: 'INVALID_INPUT' }
  ],
  run (input) {
    /* Both lists concatenated and then deduplicated, rather than deduplicating
       each first: that keeps one pass and means a shared item is reported with
       the spelling it had in the FIRST list, which is the one the user led with. */
    const items = uniqueBy([...input.first, ...input.second], input.ignoreCase);
    const { shared } = partition(input.first, input.second, input.ignoreCase);
    return ok({
      items, count: items.length, sharedCount: shared.length,
      firstCount: input.first.length, secondCount: input.second.length
    }, computed());
  }
};
