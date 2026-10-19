import { ok, fail, computed } from '../src/contracts.js';

export default {
  name: 'rankValues',
  description: 'Put numbers in order and give each its rank position.',
  category: 'statistics', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{ranked|list}}.',
  inputSchema: {
    type: 'object', required: ['values'],
    properties: {
      values: { type: 'array', label: 'numbers', items: { type: 'number' }, minItems: 1, prompt: 'Which numbers should I rank?' },
      labels: { type: 'array', label: 'names', items: { type: 'string' }, description: 'a name for each value' },
      direction: { type: 'string', label: 'order', enum: ['descending', 'ascending'], default: 'descending' },
      method: { type: 'string', label: 'tie method', enum: ['dense', 'ordinal', 'competition'], default: 'competition' }
    }
  },
  outputSchema: { type: 'object', properties: { ranks: { type: 'array', items: { type: 'integer' } }, ranked: { type: 'array', items: { type: 'string' } }, pairs: { type: 'array' }, top: { type: 'string' }, method: { type: 'string' } } },
  examples: [
    { text: 'rank these scores', input: { values: [90, 70, 85] }, output: { ranks: [1, 3, 2], ranked: ['90 (1st)', '85 (2nd)', '70 (3rd)'], pairs: [{ value: 90, rank: 1 }, { value: 85, rank: 2 }, { value: 70, rank: 3 }], top: '90', method: 'competition' } },
    { text: 'rank these with a tie', input: { values: [10, 10, 5] }, output: { ranks: [1, 1, 3], ranked: ['10 (1st)', '10 (1st)', '5 (3rd)'], pairs: [{ value: 10, rank: 1 }, { value: 10, rank: 1 }, { value: 5, rank: 3 }], top: '10', method: 'competition' } },
    { text: 'rank teams by points', input: { values: [12, 18, 15], labels: ['Ants', 'Bees', 'Cats'] }, output: { ranks: [3, 1, 2], ranked: ['Bees 18 (1st)', 'Cats 15 (2nd)', 'Ants 12 (3rd)'], pairs: [{ value: 18, rank: 1, label: 'Bees' }, { value: 15, rank: 2, label: 'Cats' }, { value: 12, rank: 3, label: 'Ants' }], top: 'Bees', method: 'competition' } },
    { text: 'rank smallest first', input: { values: [7, 3, 9], direction: 'ascending' }, output: { ranks: [2, 1, 3], ranked: ['3 (1st)', '7 (2nd)', '9 (3rd)'], pairs: [{ value: 3, rank: 1 }, { value: 7, rank: 2 }, { value: 9, rank: 3 }], top: '3', method: 'competition' } },
    { text: 'dense ranking with a tie', input: { values: [10, 10, 5], method: 'dense' }, output: { ranks: [1, 1, 2], ranked: ['10 (1st)', '10 (1st)', '5 (2nd)'], pairs: [{ value: 10, rank: 1 }, { value: 10, rank: 1 }, { value: 5, rank: 2 }], top: '10', method: 'dense' } },
    { text: 'put these from best to worst: 72 95 88', input: { values: [72, 95, 88] },
      output: { ranks: [3, 1, 2], ranked: ['95 (1st)', '88 (2nd)', '72 (3rd)'], pairs: [{ value: 95, rank: 1 }, { value: 88, rank: 2 }, { value: 72, rank: 3 }], top: '95', method: 'competition' } },
    { text: 'order these results highest first', input: { values: [3.5, 9.1, 7.2] },
      output: { ranks: [3, 1, 2], ranked: ['9.1 (1st)', '7.2 (2nd)', '3.5 (3rd)'], pairs: [{ value: 9.1, rank: 1 }, { value: 7.2, rank: 2 }, { value: 3.5, rank: 3 }], top: '9.1', method: 'competition' } }
  ],
  errorCases: [
    { input: { values: [] }, code: 'INVALID_INPUT' },
    { input: { values: [1, 2], labels: ['only one'] }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' }
  ],
  run (input) {
    if (!input.values.length) return fail('INVALID_INPUT', 'There are no values to rank.', 'values');
    if (input.labels && input.labels.length !== input.values.length) {
      return fail('INVALID_INPUT', `There are ${input.values.length} values but ${input.labels.length} labels.`, 'labels');
    }
    const sign = input.direction === 'ascending' ? 1 : -1;
    const items = input.values.map((value, i) => ({ value, label: input.labels?.[i], index: i }));
    const sorted = [...items].sort((a, b) => sign * (a.value - b.value));

    /* Three tie conventions, because they genuinely differ and the choice
       changes the answer: competition gives 1,1,3 (the Olympic one), dense
       gives 1,1,2 (no gaps), ordinal gives 1,2,3 (ties broken arbitrarily). */
    let rank = 0, seen = 0, prev = null;
    for (const item of sorted) {
      seen += 1;
      if (prev === null || item.value !== prev) {
        rank = input.method === 'dense' ? rank + 1 : input.method === 'ordinal' ? seen : seen;
      } else if (input.method === 'ordinal') {
        rank = seen;
      }
      item.rank = rank;
      prev = item.value;
    }

    const suffix = (n) => {
      const t = n % 100;
      if (t >= 11 && t <= 13) return 'th';
      return ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
    };
    const ranks = new Array(items.length);
    for (const item of sorted) ranks[item.index] = item.rank;
    return ok({
      ranks,
      ranked: sorted.map(i => `${i.label ? `${i.label} ` : ''}${i.value} (${i.rank}${suffix(i.rank)})`),
      pairs: sorted.map(i => (i.label ? { value: i.value, rank: i.rank, label: i.label } : { value: i.value, rank: i.rank })),
      top: sorted[0].label ?? String(sorted[0].value),
      method: input.method
    }, computed());
  }
};
