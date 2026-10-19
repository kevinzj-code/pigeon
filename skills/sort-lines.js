import { ok, computed } from '../src/contracts.js';
import { lines } from '../src/lib/text.js';

export default {
  name: 'sortLines',
  description: 'Put the lines of a text in order — alphabetically, numerically, or by length.',
  category: 'text',
  tier: 'core',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{count}} {{count|plural:line:lines}} sorted {{by}}, {{direction|prose}}:\n{{result}}',
  inputSchema: {
    type: 'object',
    required: ['text'],
    properties: {
      text: { type: 'string', label: 'text', minLength: 1, prompt: 'Which lines should I sort?' },
      by: { type: 'string', label: 'sort by', enum: ['alphabetical', 'numeric', 'length'], default: 'alphabetical' },
      direction: { type: 'string', label: 'order', enum: ['ascending', 'descending'], default: 'ascending' },
      caseSensitive: { type: 'boolean', label: 'match case', default: false }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      result: { type: 'string' }, lines: { type: 'array', items: { type: 'string' } },
      count: { type: 'integer' }, by: { type: 'string' }, direction: { type: 'string' }
    }
  },
  examples: [
    { text: 'sort these lines alphabetically', input: { text: 'cherry\napple\nbanana' },
      output: { result: 'apple\nbanana\ncherry', lines: ['apple', 'banana', 'cherry'], count: 3, by: 'alphabetical', direction: 'ascending' } },
    { text: 'sort this list z to a', input: { text: 'apple\ncherry\nbanana', direction: 'descending' },
      output: { result: 'cherry\nbanana\napple', lines: ['cherry', 'banana', 'apple'], count: 3, by: 'alphabetical', direction: 'descending' } },
    { text: 'sort these numbers properly', input: { text: '100\n9\n25', by: 'numeric' },
      output: { result: '9\n25\n100', lines: ['9', '25', '100'], count: 3, by: 'numeric', direction: 'ascending' } },
    { text: 'order the lines shortest first', input: { text: 'medium one\nx\nlonger line here', by: 'length' },
      output: { result: 'x\nmedium one\nlonger line here', lines: ['x', 'medium one', 'longer line here'], count: 3, by: 'length', direction: 'ascending' } },
    { text: 'sort a shopping list', input: { text: 'Milk\neggs\nBread' },
      output: { result: 'Bread\neggs\nMilk', lines: ['Bread', 'eggs', 'Milk'], count: 3, by: 'alphabetical', direction: 'ascending' } }
  ],
  errorCases: [
    { input: {}, code: 'MISSING_FIELD' },
    { input: { text: 'a\nb', by: 'vibes' }, code: 'INVALID_INPUT' },
    { input: { text: 'a\nb', direction: 'sideways' }, code: 'INVALID_INPUT' }
  ],
  run (input) {
    const all = lines(input.text, { keepBlank: false });
    const sign = input.direction === 'descending' ? -1 : 1;
    const cmp = {
      /* localeCompare, not <, so accented letters sort next to their base
         letter rather than after z. */
      alphabetical: (a, b) => (input.caseSensitive ? a.localeCompare(b) : a.toLowerCase().localeCompare(b.toLowerCase())),
      /* Lines that aren't numbers sort after the ones that are, rather than
         comparing as NaN and corrupting the sort. */
      numeric: (a, b) => {
        const x = Number(a.trim()), y = Number(b.trim());
        const xn = Number.isFinite(x), yn = Number.isFinite(y);
        if (xn && yn) return x - y;
        if (xn) return -1;
        if (yn) return 1;
        return a.localeCompare(b);
      },
      length: (a, b) => a.length - b.length || a.localeCompare(b)
    }[input.by];

    const sorted = [...all].sort((a, b) => cmp(a, b) * sign);
    return ok({
      result: sorted.join('\n'), lines: sorted, count: sorted.length,
      by: input.by, direction: input.direction
    }, computed());
  }
};
