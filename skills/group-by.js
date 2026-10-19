import { ok, fail, computed } from '../src/contracts.js';
import { isTable } from '../src/lib/rows.js';

const OPS = ['count', 'sum', 'mean', 'min', 'max'];

export default {
  name: 'groupBy',
  description: "Total or average rows per category, grouped by a shared value.",
  category: 'data', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: 'Grouped by {{column}} into {{groupCount}} {{groupCount|plural:group:groups}} — {{operation}}: {{summary|list}}',
  inputSchema: {
    type: 'object', required: ['table', 'column'],
    properties: {
      table: { type: 'object', label: 'table', prompt: 'Which table should I group?' },
      column: { type: 'string', label: 'group by column', prompt: 'Which column should I group by?' },
      aggregate: { type: 'string', label: 'value column', description: 'the column to aggregate — required for anything other than count' },
      operation: { type: 'string', label: 'operation', enum: OPS, default: 'count' }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      groups: { type: 'array' }, summary: { type: 'array', items: { type: 'string' } },
      groupCount: { type: 'integer' }, column: { type: 'string' }, operation: { type: 'string' }
    }
  },
  examples: [
    { text: 'group these rows by region and sum the amounts', input: { table: { headers: ['region', 'amount'], rows: [{ region: 'north', amount: 120 }, { region: 'south', amount: 80 }, { region: 'north', amount: 200 }] }, column: 'region', aggregate: 'amount', operation: 'sum' }, output: { groups: [{ key: 'north', count: 2, value: 320 }, { key: 'south', count: 1, value: 80 }], summary: ['north: 320', 'south: 80'], groupCount: 2, column: 'region', operation: 'sum' } },
    { text: 'count the rows in each category', input: { table: { headers: ['category'], rows: [{ category: 'a' }, { category: 'b' }, { category: 'a' }] }, column: 'category' }, output: { groups: [{ key: 'a', count: 2, value: 2 }, { key: 'b', count: 1, value: 1 }], summary: ['a: 2', 'b: 1'], groupCount: 2, column: 'category', operation: 'count' } },
    { text: 'average the score per team', input: { table: { headers: ['team', 'score'], rows: [{ team: 'red', score: 10 }, { team: 'red', score: 20 }, { team: 'blue', score: 7 }] }, column: 'team', aggregate: 'score', operation: 'mean' }, output: { groups: [{ key: 'red', count: 2, value: 15 }, { key: 'blue', count: 1, value: 7 }], summary: ['red: 15', 'blue: 7'], groupCount: 2, column: 'team', operation: 'mean' } },
    { text: 'find the highest price in each shop', input: { table: { headers: ['shop', 'price'], rows: [{ shop: 'x', price: 4 }, { shop: 'x', price: 9 }, { shop: 'y', price: 2 }] }, column: 'shop', aggregate: 'price', operation: 'max' }, output: { groups: [{ key: 'x', count: 2, value: 9 }, { key: 'y', count: 1, value: 2 }], summary: ['x: 9', 'y: 2'], groupCount: 2, column: 'shop', operation: 'max' } },
    { text: 'group by status when every row is the same', input: { table: { headers: ['status'], rows: [{ status: 'open' }, { status: 'open' }] }, column: 'status' }, output: { groups: [{ key: 'open', count: 2, value: 2 }], summary: ['open: 2'], groupCount: 1, column: 'status', operation: 'count' } },
    { text: 'sum the points for each team in this table', input: { table: { headers: ['team', 'points'], rows: [{ team: 'red', points: 10 }, { team: 'blue', points: 5 }, { team: 'red', points: 7 }] }, column: 'team', aggregate: 'points', operation: 'sum' },
      output: { groups: [{ key: 'red', count: 2, value: 17 }, { key: 'blue', count: 1, value: 5 }], summary: ['red: 17', 'blue: 5'], groupCount: 2, column: 'team', operation: 'sum' } },
    { text: 'how many rows fall under each status', input: { table: { headers: ['status'], rows: [{ status: 'open' }, { status: 'done' }, { status: 'open' }] }, column: 'status', operation: 'count' },
      output: { groups: [{ key: 'open', count: 2, value: 2 }, { key: 'done', count: 1, value: 1 }], summary: ['open: 2', 'done: 1'], groupCount: 2, column: 'status', operation: 'count' } }
  ],
  errorCases: [
    { input: { table: { headers: ['a'], rows: [{ a: 1 }] }, column: 'missing' }, code: 'INVALID_INPUT' },
    { input: { table: { headers: ['a'], rows: [{ a: 1 }] }, column: 'a', operation: 'sum' }, code: 'INVALID_INPUT' },
    { input: { table: { headers: ['a', 'b'], rows: [{ a: 1, b: 'x' }] }, column: 'a', aggregate: 'b', operation: 'sum' }, code: 'INVALID_INPUT' },
    { input: { column: 'a' }, code: 'MISSING_FIELD' }
  ],
  run (input) {
    if (!isTable(input.table)) return fail('INVALID_INPUT', 'I need a table with headers and rows to group.', 'table');
    const { headers, rows } = input.table;
    if (!rows.length) return fail('INVALID_INPUT', 'That table has no rows to group.', 'table');
    if (!headers.includes(input.column)) {
      return fail('INVALID_INPUT', `There is no "${input.column}" column — the table has ${headers.map((h) => `"${h}"`).join(', ')}.`, 'column');
    }

    const operation = input.operation ?? 'count';
    if (operation !== 'count') {
      if (!input.aggregate) return fail('INVALID_INPUT', `"${operation}" needs a column to aggregate — which one should I ${operation}?`, 'aggregate');
      if (!headers.includes(input.aggregate)) {
        return fail('INVALID_INPUT', `There is no "${input.aggregate}" column — the table has ${headers.map((h) => `"${h}"`).join(', ')}.`, 'aggregate');
      }
    }

    /* First-appearance order, not alphabetical. The rows arrived in some order
       the author chose and a silent re-sort makes the output hard to line up
       against the input. sortRows is right there if they want it sorted. */
    const buckets = new Map();
    for (const row of rows) {
      const key = String(row[input.column] ?? '');
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(row);
    }

    const groups = [];
    for (const [key, members] of buckets) {
      let value = members.length;
      if (operation !== 'count') {
        const nums = [];
        for (const m of members) {
          const raw = m[input.aggregate];
          const n = typeof raw === 'number' ? raw : Number(String(raw ?? '').trim());
          if (raw === '' || raw === null || raw === undefined || !Number.isFinite(n)) {
            return fail('INVALID_INPUT', `I cannot ${operation} "${input.aggregate}" — ${JSON.stringify(raw ?? null)} in the "${key}" group is not a number.`, 'aggregate');
          }
          nums.push(n);
        }
        if (operation === 'sum') value = nums.reduce((a, b) => a + b, 0);
        else if (operation === 'mean') value = Number((nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(4));
        else if (operation === 'min') value = Math.min(...nums);
        else value = Math.max(...nums);
      }
      groups.push({ key, count: members.length, value });
    }

    return ok({
      groups, summary: groups.map((g) => `${g.key}: ${g.value}`),
      groupCount: groups.length, column: input.column, operation
    }, computed());
  }
};
