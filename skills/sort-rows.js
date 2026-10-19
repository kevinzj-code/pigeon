import { ok, fail, computed } from '../src/contracts.js';
import { isTable } from '../src/lib/rows.js';

export default {
  name: 'sortRows',
  description: 'Reorder the rows of a table by a column, changing nothing else.',
  category: 'data',
  tier: 'core',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: 'Sorted {{rowCount}} {{rowCount|plural:row:rows}} by {{sortedBy|list}}.',
  inputSchema: {
    type: 'object',
    required: ['table', 'column'],
    properties: {
      table: { type: 'object', label: 'table', prompt: 'Which table should I sort?' },
      column: { type: 'string', label: 'sort by column', prompt: 'Which column should I sort by?' },
      direction: { type: 'string', label: 'order', enum: ['ascending', 'descending'], default: 'ascending' },
      then: { type: 'string', label: 'then by column', description: 'a second column, used to break ties' }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      headers: { type: 'array', items: { type: 'string' } }, rows: { type: 'array' },
      rowCount: { type: 'integer' }, sortedBy: { type: 'array', items: { type: 'string' } },
      direction: { type: 'string' }
    }
  },
  examples: [
    { text: 'sort by amount, biggest first', input: { table: { headers: ['name', 'amount'], rows: [{ name: 'Ana', amount: 120 }, { name: 'Bo', amount: 80 }, { name: 'Cy', amount: 200 }] }, column: 'amount', direction: 'descending' },
      output: { headers: ['name', 'amount'], rows: [{ name: 'Cy', amount: 200 }, { name: 'Ana', amount: 120 }, { name: 'Bo', amount: 80 }], rowCount: 3, sortedBy: ['amount'], direction: 'descending' } },
    { text: 'sort these names alphabetically', input: { table: { headers: ['name'], rows: [{ name: 'Cy' }, { name: 'Ana' }, { name: 'Bo' }] }, column: 'name' },
      output: { headers: ['name'], rows: [{ name: 'Ana' }, { name: 'Bo' }, { name: 'Cy' }], rowCount: 3, sortedBy: ['name'], direction: 'ascending' } },
    { text: 'order by region then by q1', input: { table: { headers: ['region', 'q1'], rows: [{ region: 'N', q1: 90 }, { region: 'E', q1: 200 }, { region: 'N', q1: 10 }] }, column: 'region', then: 'q1' },
      output: { headers: ['region', 'q1'], rows: [{ region: 'E', q1: 200 }, { region: 'N', q1: 10 }, { region: 'N', q1: 90 }], rowCount: 3, sortedBy: ['region', 'q1'], direction: 'ascending' } },
    { text: 'sort numbers smallest first', input: { table: { headers: ['v'], rows: [{ v: 30 }, { v: 4 }, { v: 100 }] }, column: 'v' },
      output: { headers: ['v'], rows: [{ v: 4 }, { v: 30 }, { v: 100 }], rowCount: 3, sortedBy: ['v'], direction: 'ascending' } },
    { text: 'sort a single row table', input: { table: { headers: ['x'], rows: [{ x: 1 }] }, column: 'x' },
      output: { headers: ['x'], rows: [{ x: 1 }], rowCount: 1, sortedBy: ['x'], direction: 'ascending' } }
  ],
  errorCases: [
    { input: { table: { headers: ['a'], rows: [{ a: 1 }] }, column: 'z' }, code: 'INVALID_INPUT' },
    { input: { table: 'not a table', column: 'a' }, code: 'INVALID_INPUT' },
    { input: { column: 'a' }, code: 'MISSING_FIELD' }
  ],
  run (input) {
    if (!isTable(input.table)) return fail('INVALID_INPUT', 'That is not a table — I need headers and rows.', 'table');
    for (const [field, col] of [['column', input.column], ['then', input.then]]) {
      if (col && !input.table.headers.includes(col)) {
        return fail('INVALID_INPUT', `There is no "${col}" column. The columns are: ${input.table.headers.join(', ')}.`, field);
      }
    }
    const sign = input.direction === 'descending' ? -1 : 1;
    /* Numbers compare numerically, strings by locale. Mixing the two in one
       column sorts numbers first — arbitrary, but stable and documented, which
       beats a comparator that returns inconsistent results and corrupts the
       sort outright. */
    const cmp = (a, b) => {
      if (typeof a === 'number' && typeof b === 'number') return a - b;
      if (typeof a === 'number') return -1;
      if (typeof b === 'number') return 1;
      return String(a).localeCompare(String(b));
    };
    const rows = [...input.table.rows].sort((x, y) => {
      const primary = cmp(x[input.column], y[input.column]) * sign;
      if (primary !== 0 || !input.then) return primary;
      return cmp(x[input.then], y[input.then]) * sign;
    });
    return ok({
      headers: input.table.headers, rows, rowCount: rows.length,
      sortedBy: input.then ? [input.column, input.then] : [input.column],
      direction: input.direction
    }, computed());
  }
};
