import { ok, fail, computed } from '../src/contracts.js';
import { isTable } from '../src/lib/rows.js';

const OPS = ['sum', 'count', 'mean', 'min', 'max'];

export default {
  name: 'pivotRows',
  description: "Cross-tabulate one column against another into a grid of cells.",
  category: 'data', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{rowCount}} {{rowCount|plural:row:rows}} by {{columnCount}} {{columnCount|plural:column:columns}}, {{operation}} of {{valueLabel}}: {{headers|list}}',
  inputSchema: {
    type: 'object', required: ['table', 'rowColumn', 'columnColumn'],
    properties: {
      table: { type: 'object', label: 'table', prompt: 'Which table should I pivot?' },
      rowColumn: { type: 'string', label: 'rows from column', prompt: 'Which column should become the rows?' },
      columnColumn: { type: 'string', label: 'columns from column', prompt: 'Which column should become the columns?' },
      valueColumn: { type: 'string', label: 'value column', description: 'the column to aggregate - required for anything other than count' },
      operation: { type: 'string', label: 'operation', enum: OPS, default: 'sum' }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      headers: { type: 'array', items: { type: 'string' } }, rows: { type: 'array' },
      rowCount: { type: 'integer' }, columnCount: { type: 'integer' },
      operation: { type: 'string' }, valueLabel: { type: 'string' }
    }
  },
  examples: [
    { text: 'pivot amount by region and quarter', input: { table: { headers: ['region', 'quarter', 'amount'], rows: [{ region: 'north', quarter: 'Q1', amount: 10 }, { region: 'north', quarter: 'Q2', amount: 20 }, { region: 'south', quarter: 'Q1', amount: 30 }] }, rowColumn: 'region', columnColumn: 'quarter', valueColumn: 'amount', operation: 'sum' }, output: { headers: ['region', 'Q1', 'Q2'], rows: [{ region: 'north', Q1: 10, Q2: 20 }, { region: 'south', Q1: 30, Q2: null }], rowCount: 2, columnCount: 2, operation: 'sum', valueLabel: 'amount' } },
    { text: 'count rows by day and type', input: { table: { headers: ['day', 'type'], rows: [{ day: 'mon', type: 'a' }, { day: 'mon', type: 'a' }, { day: 'tue', type: 'b' }] }, rowColumn: 'day', columnColumn: 'type', operation: 'count' }, output: { headers: ['day', 'a', 'b'], rows: [{ day: 'mon', a: 2, b: 0 }, { day: 'tue', a: 0, b: 1 }], rowCount: 2, columnCount: 2, operation: 'count', valueLabel: 'rows' } },
    { text: 'average sales by store and month', input: { table: { headers: ['store', 'month', 'sales'], rows: [{ store: 'a', month: 'jan', sales: 10 }, { store: 'a', month: 'jan', sales: 20 }, { store: 'b', month: 'jan', sales: 5 }] }, rowColumn: 'store', columnColumn: 'month', valueColumn: 'sales', operation: 'mean' }, output: { headers: ['store', 'jan'], rows: [{ store: 'a', jan: 15 }, { store: 'b', jan: 5 }], rowCount: 2, columnCount: 1, operation: 'mean', valueLabel: 'sales' } },
    { text: 'pivot a single measurement', input: { table: { headers: ['x', 'y', 'v'], rows: [{ x: 'p', y: 'q', v: 7 }] }, rowColumn: 'x', columnColumn: 'y', valueColumn: 'v' }, output: { headers: ['x', 'q'], rows: [{ x: 'p', q: 7 }], rowCount: 1, columnCount: 1, operation: 'sum', valueLabel: 'v' } },
    { text: 'highest points by team and round', input: { table: { headers: ['team', 'round', 'points'], rows: [{ team: 'red', round: 'r1', points: 3 }, { team: 'red', round: 'r1', points: 9 }, { team: 'blue', round: 'r2', points: 4 }] }, rowColumn: 'team', columnColumn: 'round', valueColumn: 'points', operation: 'max' }, output: { headers: ['team', 'r1', 'r2'], rows: [{ team: 'red', r1: 9, r2: null }, { team: 'blue', r1: null, r2: 4 }], rowCount: 2, columnCount: 2, operation: 'max', valueLabel: 'points' } }
  ],
  errorCases: [
    { input: { table: { headers: ['a', 'b'], rows: [{ a: 1, b: 2 }] }, rowColumn: 'a', columnColumn: 'nope' }, code: 'INVALID_INPUT' },
    { input: { table: { headers: ['a', 'b'], rows: [{ a: 1, b: 2 }] }, rowColumn: 'a', columnColumn: 'b', operation: 'sum' }, code: 'INVALID_INPUT' },
    { input: { table: { headers: ['a', 'b'], rows: [{ a: 1, b: 2 }] }, rowColumn: 'a', columnColumn: 'a' }, code: 'INVALID_INPUT' },
    { input: { table: { headers: ['a'], rows: [] }, rowColumn: 'a', columnColumn: 'a' }, code: 'INVALID_INPUT' }
  ],
  run (input) {
    if (!isTable(input.table)) return fail('INVALID_INPUT', 'I need a table with headers and rows to pivot.', 'table');
    const { headers, rows } = input.table;
    if (!rows.length) return fail('INVALID_INPUT', 'That table has no rows to pivot.', 'table');
    const known = (c) => headers.includes(c);
    for (const [field, col] of [['rowColumn', input.rowColumn], ['columnColumn', input.columnColumn]]) {
      if (!known(col)) return fail('INVALID_INPUT', `There is no "${col}" column - the table has ${headers.map((h) => `"${h}"`).join(', ')}.`, field);
    }
    if (input.rowColumn === input.columnColumn) {
      return fail('INVALID_INPUT', `Rows and columns would both be "${input.rowColumn}", which gives a grid with one cell per row and nothing to compare.`, 'columnColumn');
    }

    const operation = input.operation ?? 'sum';
    if (operation !== 'count') {
      if (!input.valueColumn) return fail('INVALID_INPUT', `"${operation}" needs a column of values - which one should I ${operation}?`, 'valueColumn');
      if (!known(input.valueColumn)) return fail('INVALID_INPUT', `There is no "${input.valueColumn}" column - the table has ${headers.map((h) => `"${h}"`).join(', ')}.`, 'valueColumn');
    }

    const rowKeys = [];
    const colKeys = [];
    const cells = new Map();
    for (const r of rows) {
      const rk = String(r[input.rowColumn] ?? '');
      const ck = String(r[input.columnColumn] ?? '');
      if (!rowKeys.includes(rk)) rowKeys.push(rk);
      if (!colKeys.includes(ck)) colKeys.push(ck);
      const at = JSON.stringify([rk, ck]);
      if (!cells.has(at)) cells.set(at, []);
      cells.get(at).push(r);
    }

    const aggregate = (members) => {
      if (operation === 'count') return members.length;
      const nums = [];
      for (const m of members) {
        const raw = m[input.valueColumn];
        const n = typeof raw === 'number' ? raw : Number(String(raw ?? '').trim());
        if (raw === '' || raw === null || raw === undefined || !Number.isFinite(n)) return { bad: raw ?? null };
        nums.push(n);
      }
      if (operation === 'sum') return nums.reduce((a, b) => a + b, 0);
      if (operation === 'mean') return Number((nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(4));
      if (operation === 'min') return Math.min(...nums);
      return Math.max(...nums);
    };

    const out = [];
    for (const rk of rowKeys) {
      const row = { [input.rowColumn]: rk };
      for (const ck of colKeys) {
        const members = cells.get(JSON.stringify([rk, ck]));
        /* An empty cell counts as zero rows, because that is a fact. For every
           other operation there is nothing to sum or average, and 0 would be a
           claim the data does not support - so it stays blank. */
        if (!members) { row[ck] = operation === 'count' ? 0 : null; continue; }
        const v = aggregate(members);
        if (v && typeof v === 'object' && 'bad' in v) {
          return fail('INVALID_INPUT', `I cannot ${operation} "${input.valueColumn}" - ${JSON.stringify(v.bad)} at ${rk}/${ck} is not a number.`, 'valueColumn');
        }
        row[ck] = v;
      }
      out.push(row);
    }

    return ok({
      headers: [input.rowColumn, ...colKeys], rows: out,
      rowCount: rowKeys.length, columnCount: colKeys.length,
      operation, valueLabel: operation === 'count' ? 'rows' : input.valueColumn
    }, computed());
  }
};
