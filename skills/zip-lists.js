import { ok, fail, computed } from '../src/contracts.js';

export default {
  name: 'zipLists',
  description: 'Combine two or more lists position by position — pair each name with its score.',
  category: 'lists', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{count}} {{count|plural:row:rows}}: {{summary|prose}}',
  inputSchema: {
    type: 'object', required: ['lists'],
    properties: {
      lists: { type: 'array', label: 'lists', minItems: 2, prompt: 'Which lists should I combine?' },
      names: { type: 'array', label: 'field names', items: { type: 'string' }, description: 'a name for each list, to build objects instead of rows' },
      strict: { type: 'boolean', label: 'equal lengths only', default: false, description: 'refuse when the lists are different lengths' }
    }
  },
  outputSchema: { type: 'object', properties: { rows: { type: 'array' }, count: { type: 'integer' }, ragged: { type: 'boolean' }, lengths: { type: 'array', items: { type: 'integer' } }, summary: { type: 'string' } } },
  examples: [
    { text: 'zip these two lists together', input: { lists: [[1, 2, 3], ['a', 'b', 'c']] }, output: { rows: [[1, 'a'], [2, 'b'], [3, 'c']], count: 3, ragged: false, lengths: [3, 3], summary: '[1, a] [2, b] [3, c]' } },
    { text: 'combine names and ages into records', input: { lists: [['Ana', 'Bo'], [34, 28]], names: ['name', 'age'] }, output: { rows: [{ name: 'Ana', age: 34 }, { name: 'Bo', age: 28 }], count: 2, ragged: false, lengths: [2, 2], summary: '{name: Ana, age: 34} {name: Bo, age: 28}' } },
    { text: 'zip three lists', input: { lists: [[1, 2], ['x', 'y'], [true, false]] }, output: { rows: [[1, 'x', true], [2, 'y', false]], count: 2, ragged: false, lengths: [2, 2, 2], summary: '[1, x, true] [2, y, false]' } },
    { text: 'zip lists of different lengths', input: { lists: [[1, 2, 3], ['a']] }, output: { rows: [[1, 'a']], count: 1, ragged: true, lengths: [3, 1], summary: '[1, a]' } },
    { text: 'zip two single-item lists', input: { lists: [['only'], [42]] }, output: { rows: [['only', 42]], count: 1, ragged: false, lengths: [1, 1], summary: '[only, 42]' } },
    { text: 'match each name up with the corresponding score', input: { lists: [['Ana', 'Bo', 'Cy'], [90, 75, 82]], names: ['name', 'score'] },
      output: { rows: [{ name: 'Ana', score: 90 }, { name: 'Bo', score: 75 }, { name: 'Cy', score: 82 }], count: 3, ragged: false, lengths: [3, 3], summary: '{name: Ana, score: 90} {name: Bo, score: 75} {name: Cy, score: 82}' } },
    { text: 'line these two lists up side by side', input: { lists: [['x', 'y'], [1, 2]] },
      output: { rows: [['x', 1], ['y', 2]], count: 2, ragged: false, lengths: [2, 2], summary: '[x, 1] [y, 2]' } }
  ],
  errorCases: [
    { input: { lists: [[1, 2]] }, code: 'INVALID_INPUT' },
    { input: { lists: [[1], [2]], names: ['only one'] }, code: 'INVALID_INPUT' },
    { input: { lists: [[1, 2], [3]], strict: true }, code: 'INVALID_INPUT' }
  ],
  run (input) {
    if (input.lists.length < 2) return fail('INVALID_INPUT', 'I need at least two lists to combine.', 'lists');
    if (input.lists.some(l => !Array.isArray(l))) return fail('INVALID_INPUT', 'Every entry has to be a list.', 'lists');
    if (input.names && input.names.length !== input.lists.length) {
      return fail('INVALID_INPUT', `There are ${input.lists.length} lists but ${input.names.length} names.`, 'names');
    }
    const lengths = input.lists.map(l => l.length);
    const shortest = Math.min(...lengths);
    const ragged = shortest !== Math.max(...lengths);
    /* Zipping stops at the SHORTEST list — padding with undefined would invent
       values. `ragged` reports when that happened, and `strict` refuses
       instead for callers who would rather know than be truncated. */
    if (ragged && input.strict) {
      return fail('INVALID_INPUT', `Those lists are different lengths (${lengths.join(', ')}).`, 'lists');
    }
    const rows = Array.from({ length: shortest }, (_, i) => (
      input.names
        ? Object.fromEntries(input.names.map((n, k) => [n, input.lists[k][i]]))
        : input.lists.map(l => l[i])
    ));
    return ok({
      rows, count: rows.length, ragged, lengths,
      summary: rows.map(r => (Array.isArray(r)
        ? `[${r.join(', ')}]`
        : `{${Object.entries(r).map(([k, v]) => `${k}: ${v}`).join(', ')}}`)).join(' ')
    }, computed());
  }
};
