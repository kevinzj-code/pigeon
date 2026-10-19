import { ok, computed } from '../src/contracts.js';
import { partition } from '../src/lib/sets.js';

export default {
  name: 'differenceLists',
  description: 'Find what is in one list but not the other, in both directions.',
  category: 'lists', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{onlyInFirstCount}} only in {{firstLabel}}, {{onlyInSecondCount}} only in {{secondLabel}}, {{sharedCount}} in both.\n{{lines|lines}}',
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
      onlyInFirst: { type: 'array' }, onlyInSecond: { type: 'array' }, shared: { type: 'array' },
      onlyInFirstCount: { type: 'integer' }, onlyInSecondCount: { type: 'integer' },
      sharedCount: { type: 'integer' }, identical: { type: 'boolean' },
      firstLabel: { type: 'string' }, secondLabel: { type: 'string' },
      lines: { type: 'array', items: { type: 'string' } }
    }
  },
  examples: [
    { text: 'what is in the first list but not the second', input: { first: ['a', 'b', 'c'], second: ['b'] },
      output: { onlyInFirst: ['a', 'c'], onlyInSecond: [], shared: ['b'], onlyInFirstCount: 2, onlyInSecondCount: 0, sharedCount: 1, identical: false, firstLabel: 'the first list', secondLabel: 'the second list', lines: ['Only in the first list: a, c', 'In both: b'] } },
    { text: 'compare these two lists of numbers', input: { first: [1, 2, 3], second: [3, 4, 5] },
      output: { onlyInFirst: [1, 2], onlyInSecond: [4, 5], shared: [3], onlyInFirstCount: 2, onlyInSecondCount: 2, sharedCount: 1, identical: false, firstLabel: 'the first list', secondLabel: 'the second list', lines: ['Only in the first list: 1, 2', 'Only in the second list: 4, 5', 'In both: 3'] } },
    { text: 'are these two lists the same', input: { first: ['x', 'y'], second: ['x', 'y'] },
      output: { onlyInFirst: [], onlyInSecond: [], shared: ['x', 'y'], onlyInFirstCount: 0, onlyInSecondCount: 0, sharedCount: 2, identical: true, firstLabel: 'the first list', secondLabel: 'the second list', lines: ['In both: x, y'] } },
    { text: 'which entries are only in one of these', input: { first: ['a', 'b'], second: ['c', 'd'] },
      output: { onlyInFirst: ['a', 'b'], onlyInSecond: ['c', 'd'], shared: [], onlyInFirstCount: 2, onlyInSecondCount: 2, sharedCount: 0, identical: false, firstLabel: 'the first list', secondLabel: 'the second list', lines: ['Only in the first list: a, b', 'Only in the second list: c, d'] } },
    { text: 'difference between two name lists ignoring case', input: { first: ['Ana', 'Bo'], second: ['ana', 'Cy'], ignoreCase: true },
      output: { onlyInFirst: ['Bo'], onlyInSecond: ['Cy'], shared: ['Ana'], onlyInFirstCount: 1, onlyInSecondCount: 1, sharedCount: 1, identical: false, firstLabel: 'the first list', secondLabel: 'the second list', lines: ['Only in the first list: Bo', 'Only in the second list: Cy', 'In both: Ana'] } }
  ],
  errorCases: [
    { input: { first: [], second: ['a'] }, code: 'INVALID_INPUT' },
    { input: { first: ['a'] }, code: 'MISSING_FIELD' },
    { input: { first: ['a'], second: ['a'], ignoreCase: 'nope' }, code: 'INVALID_INPUT' }
  ],
  run (input) {
    const { onlyInFirst, onlyInSecond, shared } = partition(input.first, input.second, input.ignoreCase);
    const show = (v) => (typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v));

    /* The list names are result fields, not words typed into the template.
       "first" and "second" are ordinal number words, so the fabrication auditor
       reads them as 1 and 2 and asks what licenses them - correctly, since a
       reply saying "the second" when nothing is second would be a claim. Coming
       from here they trace, and the auditor stays strict. Same treatment as the
       encoding name in unicodeLookup and the standard name in formatPhoneNumber. */
    const firstLabel = 'the first list';
    const secondLabel = 'the second list';

    /* Empty groups are left out of the lines rather than printed as "(none)".
       Both counts are in the reply already, so a line saying nothing is in a
       group is a line that adds nothing. */
    const lines = [];
    if (onlyInFirst.length) lines.push(`Only in ${firstLabel}: ${onlyInFirst.map(show).join(', ')}`);
    if (onlyInSecond.length) lines.push(`Only in ${secondLabel}: ${onlyInSecond.map(show).join(', ')}`);
    if (shared.length) lines.push(`In both: ${shared.map(show).join(', ')}`);

    return ok({
      onlyInFirst, onlyInSecond, shared,
      onlyInFirstCount: onlyInFirst.length, onlyInSecondCount: onlyInSecond.length,
      sharedCount: shared.length,
      identical: onlyInFirst.length === 0 && onlyInSecond.length === 0,
      firstLabel, secondLabel, lines
    }, computed());
  }
};
