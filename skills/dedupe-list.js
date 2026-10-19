import { ok, computed } from '../src/contracts.js';

export default {
  name: 'dedupeList',
  description: 'Remove repeated items from a list, keeping the first of each and the original order.',
  category: 'lists',
  tier: 'core',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{kept}} unique of {{original}} — {{removed}} {{removed|plural:duplicate:duplicates}} removed: {{items|list}}',
  inputSchema: {
    type: 'object',
    required: ['items'],
    properties: {
      items: { type: 'array', label: 'list', minItems: 1, prompt: 'Which list should I deduplicate?' },
      ignoreCase: { type: 'boolean', label: 'ignore case', default: false }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      items: { type: 'array' }, kept: { type: 'integer' }, removed: { type: 'integer' },
      original: { type: 'integer' }, duplicates: { type: 'array' }
    }
  },
  examples: [
    { text: 'remove the duplicates from this list', input: { items: ['apple', 'banana', 'apple', 'cherry'] },
      output: { items: ['apple', 'banana', 'cherry'], kept: 3, removed: 1, original: 4, duplicates: ['apple'] } },
    { text: 'dedupe these numbers', input: { items: [1, 2, 2, 3, 1] },
      output: { items: [1, 2, 3], kept: 3, removed: 2, original: 5, duplicates: [2, 1] } },
    { text: 'unique names ignoring case', input: { items: ['Ana', 'ana', 'Bo'], ignoreCase: true },
      output: { items: ['Ana', 'Bo'], kept: 2, removed: 1, original: 3, duplicates: ['ana'] } },
    { text: 'dedupe a list with nothing repeated', input: { items: ['x', 'y', 'z'] },
      output: { items: ['x', 'y', 'z'], kept: 3, removed: 0, original: 3, duplicates: [] } },
    { text: 'remove duplicate email addresses', input: { items: ['a@x.com', 'b@y.com', 'a@x.com'] },
      output: { items: ['a@x.com', 'b@y.com'], kept: 2, removed: 1, original: 3, duplicates: ['a@x.com'] } },
    { text: 'take the repeated entries out of this list', input: { items: ['red', 'blue', 'red', 'green', 'blue'] },
      output: { items: ['red', 'blue', 'green'], kept: 3, removed: 2, original: 5, duplicates: ['red', 'blue'] } },
    { text: 'drop the repeats and keep each item once', input: { items: ['a', 'b', 'a', 'c'] },
      output: { items: ['a', 'b', 'c'], kept: 3, removed: 1, original: 4, duplicates: ['a'] } }
  ],
  errorCases: [
    { input: { items: [] }, code: 'INVALID_INPUT' },
    { input: { items: ['a'], ignoreCase: 'yes please' }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' }
  ],
  run (input) {
    const key = (v) => {
      /* Objects compare by their JSON, so two structurally identical entries
         deduplicate — reference equality would keep both and look broken. */
      const s = typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v);
      return input.ignoreCase ? s.toLowerCase() : s;
    };
    const seen = new Set();
    const items = [];
    const duplicates = [];
    for (const v of input.items) {
      const k = key(v);
      if (seen.has(k)) { duplicates.push(v); continue; }
      seen.add(k);
      items.push(v);
    }
    return ok({
      items, kept: items.length, removed: duplicates.length,
      original: input.items.length, duplicates
    }, computed());
  }
};
