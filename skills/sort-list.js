import { ok, computed } from '../src/contracts.js';

export default {
  name: 'sortList',
  description: 'Put a list of items in order — alphabetically, numerically, or in natural order where numbers inside names count.',
  category: 'lists',
  tier: 'core',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{count}} {{count|plural:item:items}} in {{by}} order: {{items|list}}',
  inputSchema: {
    type: 'object',
    required: ['items'],
    properties: {
      items: { type: 'array', label: 'list', minItems: 1, prompt: 'Which list should I sort?' },
      by: { type: 'string', label: 'sort by', enum: ['alphabetical', 'numeric', 'natural'], default: 'alphabetical' },
      direction: { type: 'string', label: 'order', enum: ['ascending', 'descending'], default: 'ascending' }
    }
  },
  outputSchema: {
    type: 'object',
    properties: { items: { type: 'array' }, count: { type: 'integer' }, by: { type: 'string' }, direction: { type: 'string' } }
  },
  examples: [
    { text: 'sort this list alphabetically', input: { items: ['cherry', 'apple', 'banana'] },
      output: { items: ['apple', 'banana', 'cherry'], count: 3, by: 'alphabetical', direction: 'ascending' } },
    { text: 'sort these numbers largest first', input: { items: [5, 100, 25], by: 'numeric', direction: 'descending' },
      output: { items: [100, 25, 5], count: 3, by: 'numeric', direction: 'descending' } },
    { text: 'sort file names in natural order', input: { items: ['file10', 'file2', 'file1'], by: 'natural' },
      output: { items: ['file1', 'file2', 'file10'], count: 3, by: 'natural', direction: 'ascending' } },
    { text: 'order these names z to a', input: { items: ['Ana', 'Zoe', 'Bo'], direction: 'descending' },
      output: { items: ['Zoe', 'Bo', 'Ana'], count: 3, by: 'alphabetical', direction: 'descending' } },
    { text: 'sort a mixed-case list', input: { items: ['banana', 'Apple', 'cherry'] },
      output: { items: ['Apple', 'banana', 'cherry'], count: 3, by: 'alphabetical', direction: 'ascending' } }
  ],
  errorCases: [
    { input: { items: [] }, code: 'INVALID_INPUT' },
    { input: { items: ['a'], by: 'magic' }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' }
  ],
  run (input) {
    const sign = input.direction === 'descending' ? -1 : 1;
    /* "natural" is what people mean by sorted when names contain numbers:
       file2 before file10, which plain alphabetical gets backwards. Intl's
       numeric collation does it properly, including for mixed scripts. */
    const natural = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
    const cmp = {
      alphabetical: (a, b) => String(a).localeCompare(String(b)),
      numeric: (a, b) => {
        const x = Number(a), y = Number(b);
        const xn = Number.isFinite(x), yn = Number.isFinite(y);
        if (xn && yn) return x - y;
        if (xn) return -1;
        if (yn) return 1;
        return String(a).localeCompare(String(b));
      },
      natural: (a, b) => natural.compare(String(a), String(b))
    }[input.by];

    const items = [...input.items].sort((a, b) => cmp(a, b) * sign);
    return ok({ items, count: items.length, by: input.by, direction: input.direction }, computed());
  }
};
