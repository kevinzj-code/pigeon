import { ok, computed } from '../src/contracts.js';

export default {
  name: 'countItems',
  description: 'Count how many times each item appears in a list, ranked most common first.',
  category: 'lists',
  tier: 'core',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{unique}} distinct of {{total}}: {{ranked|list}}.',
  inputSchema: {
    type: 'object',
    required: ['items'],
    properties: {
      items: { type: 'array', label: 'list', minItems: 1, prompt: 'Which list should I tally?' },
      ignoreCase: { type: 'boolean', label: 'ignore case', default: false }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      counts: { type: 'array' }, ranked: { type: 'array', items: { type: 'string' } },
      total: { type: 'integer' }, unique: { type: 'integer' },
      mostCommon: { type: 'string' }, mostCommonCount: { type: 'integer' }
    }
  },
  examples: [
    { text: 'count how many of each are in this list', input: { items: ['red', 'blue', 'red', 'green', 'red'] },
      output: { counts: [{ item: 'red', count: 3 }, { item: 'blue', count: 1 }, { item: 'green', count: 1 }], ranked: ['red ×3', 'blue ×1', 'green ×1'], total: 5, unique: 3, mostCommon: 'red', mostCommonCount: 3 } },
    { text: 'tally these votes', input: { items: ['yes', 'no', 'yes', 'yes'] },
      output: { counts: [{ item: 'yes', count: 3 }, { item: 'no', count: 1 }], ranked: ['yes ×3', 'no ×1'], total: 4, unique: 2, mostCommon: 'yes', mostCommonCount: 3 } },
    { text: 'how many of each number', input: { items: [1, 2, 2, 3, 3, 3] },
      output: { counts: [{ item: '3', count: 3 }, { item: '2', count: 2 }, { item: '1', count: 1 }], ranked: ['3 ×3', '2 ×2', '1 ×1'], total: 6, unique: 3, mostCommon: '3', mostCommonCount: 3 } },
    { text: 'count the names ignoring case', input: { items: ['Ana', 'ana', 'Bo'], ignoreCase: true },
      output: { counts: [{ item: 'ana', count: 2 }, { item: 'bo', count: 1 }], ranked: ['ana ×2', 'bo ×1'], total: 3, unique: 2, mostCommon: 'ana', mostCommonCount: 2 } },
    { text: 'tally a list where everything is different', input: { items: ['a', 'b', 'c'] },
      output: { counts: [{ item: 'a', count: 1 }, { item: 'b', count: 1 }, { item: 'c', count: 1 }], ranked: ['a ×1', 'b ×1', 'c ×1'], total: 3, unique: 3, mostCommon: 'a', mostCommonCount: 1 } }
  ],
  errorCases: [
    { input: { items: [] }, code: 'INVALID_INPUT' },
    { input: { items: ['a'], ignoreCase: 'perhaps' }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' }
  ],
  run (input) {
    const freq = new Map();
    for (const v of input.items) {
      const k = input.ignoreCase ? String(v).toLowerCase() : String(v);
      freq.set(k, (freq.get(k) ?? 0) + 1);
    }
    /* Ties broken alphabetically so the same list always ranks the same way —
       Map iteration order would otherwise leak insertion order into a result
       that reads as a ranking. */
    const counts = [...freq]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([item, count]) => ({ item, count }));

    return ok({
      counts,
      ranked: counts.map(c => `${c.item} ×${c.count}`),
      total: input.items.length,
      unique: counts.length,
      mostCommon: counts[0].item,
      mostCommonCount: counts[0].count
    }, computed());
  }
};
