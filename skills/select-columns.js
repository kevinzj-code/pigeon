import { ok, fail, computed } from '../src/contracts.js';
import { isTable } from '../src/lib/rows.js';

export default {
  name: 'selectColumns',
  description: "Pick which columns of a table to keep, renaming them if you like.",
  category: 'data',
  tier: 'core',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{columnCount}} {{columnCount|plural:column:columns}} kept: {{headers|list}}, across {{rowCount}} {{rowCount|plural:row:rows}}.',
  inputSchema: {
    type: 'object',
    required: ['table', 'columns'],
    properties: {
      table: { type: 'object', label: 'table', prompt: 'Which table?' },
      columns: { type: 'array', label: 'columns to keep', items: { type: 'string' }, minItems: 1, prompt: 'Which columns should I keep?' },
      rename: { type: 'array', label: 'new names', items: { type: 'string' }, description: 'a new name for each kept column, in the same order' }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      headers: { type: 'array', items: { type: 'string' } }, rows: { type: 'array' },
      rowCount: { type: 'integer' }, columnCount: { type: 'integer' },
      dropped: { type: 'array', items: { type: 'string' } }
    }
  },
  examples: [
    { text: 'keep only the name and amount columns', input: { table: { headers: ['name', 'amount', 'note'], rows: [{ name: 'Ana', amount: 120, note: 'x' }] }, columns: ['name', 'amount'] },
      output: { headers: ['name', 'amount'], rows: [{ name: 'Ana', amount: 120 }], rowCount: 1, columnCount: 2, dropped: ['note'] } },
    { text: 'pick the region column and rename it to area', input: { table: { headers: ['region', 'q1'], rows: [{ region: 'North', q1: 120 }] }, columns: ['region'], rename: ['area'] },
      output: { headers: ['area'], rows: [{ area: 'North' }], rowCount: 1, columnCount: 1, dropped: ['q1'] } },
    { text: 'reorder the columns', input: { table: { headers: ['a', 'b', 'c'], rows: [{ a: 1, b: 2, c: 3 }] }, columns: ['c', 'a'] },
      output: { headers: ['c', 'a'], rows: [{ c: 3, a: 1 }], rowCount: 1, columnCount: 2, dropped: ['b'] } },
    { text: 'keep every column', input: { table: { headers: ['x', 'y'], rows: [{ x: 1, y: 2 }] }, columns: ['x', 'y'] },
      output: { headers: ['x', 'y'], rows: [{ x: 1, y: 2 }], rowCount: 1, columnCount: 2, dropped: [] } },
    { text: 'select two columns and rename both', input: { table: { headers: ['first', 'last', 'age'], rows: [{ first: 'Jo', last: 'Patel', age: 34 }] }, columns: ['first', 'last'], rename: ['given', 'family'] },
      output: { headers: ['given', 'family'], rows: [{ given: 'Jo', family: 'Patel' }], rowCount: 1, columnCount: 2, dropped: ['age'] } },
    { text: 'drop every column except name and email', input: { table: { headers: ['name', 'email', 'age'], rows: [{ name: 'Ana', email: 'ana@example.com', age: 34 }] }, columns: ['name', 'email'] },
      output: { headers: ['name', 'email'], rows: [{ name: 'Ana', email: 'ana@example.com' }], rowCount: 1, columnCount: 2, dropped: ['age'] } }
  ],
  errorCases: [
    { input: { table: { headers: ['a'], rows: [{ a: 1 }] }, columns: ['z'] }, code: 'INVALID_INPUT' },
    { input: { table: { headers: ['a', 'b'], rows: [] }, columns: ['a'], rename: ['x', 'y'] }, code: 'INVALID_INPUT' },
    { input: { columns: ['a'] }, code: 'MISSING_FIELD' }
  ],
  run (input) {
    if (!isTable(input.table)) return fail('INVALID_INPUT', 'That is not a table — I need headers and rows.', 'table');
    for (const c of input.columns) {
      if (!input.table.headers.includes(c)) {
        return fail('INVALID_INPUT', `There is no "${c}" column. The columns are: ${input.table.headers.join(', ')}.`, 'columns');
      }
    }
    if (input.rename && input.rename.length !== input.columns.length) {
      return fail('INVALID_INPUT', `You gave ${input.columns.length} column${input.columns.length === 1 ? '' : 's'} but ${input.rename.length} new name${input.rename.length === 1 ? '' : 's'} — they have to match up.`, 'rename');
    }

    const headers = input.rename ? [...input.rename] : [...input.columns];
    /* Rows are rebuilt in the requested column ORDER, so selectColumns doubles
       as a reorder — which is what people are usually doing when they name
       columns explicitly. */
    const rows = input.table.rows.map(r => {
      const out = {};
      input.columns.forEach((c, i) => { out[headers[i]] = r[c]; });
      return out;
    });

    return ok({
      headers, rows, rowCount: rows.length, columnCount: headers.length,
      dropped: input.table.headers.filter(h => !input.columns.includes(h))
    }, computed());
  }
};
