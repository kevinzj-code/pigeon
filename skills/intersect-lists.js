import { ok, computed } from '../src/contracts.js';
import { partition } from '../src/lib/sets.js';

export default {
  name: 'intersectLists',
  description: 'Keep only the items appearing on both lists.',
  category: 'lists', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{count}} {{count|plural:item:items}} in both lists: {{items|list}}',
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
      items: { type: 'array' }, count: { type: 'integer' },
      firstCount: { type: 'integer' }, secondCount: { type: 'integer' }
    }
  },
  examples: [
    { text: 'what is in both of these lists', input: { first: ['apple', 'banana', 'cherry'], second: ['banana', 'cherry', 'date'] },
      output: { items: ['banana', 'cherry'], count: 2, firstCount: 3, secondCount: 3 } },
    { text: 'which numbers appear in both', input: { first: [1, 2, 3, 4], second: [3, 4, 5] },
      output: { items: [3, 4], count: 2, firstCount: 4, secondCount: 3 } },
    { text: 'do these two lists overlap at all', input: { first: ['a', 'b'], second: ['c', 'd'] },
      output: { items: [], count: 0, firstCount: 2, secondCount: 2 } },
    { text: 'names in both lists ignoring case', input: { first: ['Ana', 'Bo'], second: ['ana', 'Cy'], ignoreCase: true },
      output: { items: ['Ana'], count: 1, firstCount: 2, secondCount: 2 } },
    { text: 'common items where the first list repeats one', input: { first: [1, 2, 2, 3], second: [2, 3] },
      output: { items: [2, 3], count: 2, firstCount: 4, secondCount: 2 } },
    { text: 'which items show up in both list a and list b', input: { first: ['a', 'b', 'c'], second: ['b', 'c', 'd'] },
      output: { items: ['b', 'c'], count: 2, firstCount: 3, secondCount: 3 } },
    { text: 'what do these two lists have in common', input: { first: [1, 2, 3], second: [2, 3, 4] },
      output: { items: [2, 3], count: 2, firstCount: 3, secondCount: 3 } }
  ],
  errorCases: [
    { input: { first: [], second: ['a'] }, code: 'INVALID_INPUT' },
    { input: { first: ['a'] }, code: 'MISSING_FIELD' },
    { input: { first: ['a'], second: ['a'], ignoreCase: 'sometimes' }, code: 'INVALID_INPUT' }
  ],
  run (input) {
    const { shared } = partition(input.first, input.second, input.ignoreCase);
    return ok({
      items: shared, count: shared.length,
      firstCount: input.first.length, secondCount: input.second.length
    }, computed());
  }
};
