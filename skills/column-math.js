import { ok, fail, computed } from '../src/contracts.js';
import { isTable } from '../src/lib/rows.js';
import { round } from '../src/lib/num.js';

const OPS = {
  sum: (v) => v.reduce((a, b) => a + b, 0),
  average: (v) => v.reduce((a, b) => a + b, 0) / v.length,
  min: (v) => Math.min(...v),
  max: (v) => Math.max(...v),
  count: (v) => v.length
};

export default {
  name: 'columnMath',
  description: 'Total, average, or find the smallest or largest value down one column of a table.',
  category: 'data',
  tier: 'core',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: 'The {{operation}} of {{column}} is {{result|comma}}, over {{used}} of {{total}} {{total|plural:row:rows}}.',
  inputSchema: {
    type: 'object',
    required: ['table', 'column', 'operation'],
    properties: {
      table: { type: 'object', label: 'table', prompt: 'Which table?' },
      column: { type: 'string', label: 'column', prompt: 'Which column?' },
      operation: { type: 'string', label: 'operation', enum: Object.keys(OPS), prompt: 'Sum, average, min, max or count?' }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      result: { type: 'number' }, column: { type: 'string' }, operation: { type: 'string' },
      used: { type: 'integer' }, total: { type: 'integer' }, skipped: { type: 'integer' }
    }
  },
  examples: [
    { text: 'add up the amount column', input: { table: { headers: ['name', 'amount'], rows: [{ name: 'Ana', amount: 120 }, { name: 'Bo', amount: 80 }] }, column: 'amount', operation: 'sum' },
      output: { result: 200, column: 'amount', operation: 'sum', used: 2, total: 2, skipped: 0 } },
    { text: 'what is the average q1', input: { table: { headers: ['region', 'q1'], rows: [{ region: 'N', q1: 120 }, { region: 'S', q1: 90 }, { region: 'E', q1: 200 }] }, column: 'q1', operation: 'average' },
      output: { result: 136.6667, column: 'q1', operation: 'average', used: 3, total: 3, skipped: 0 } },
    { text: 'highest value in the score column', input: { table: { headers: ['score'], rows: [{ score: 12 }, { score: 47 }, { score: 31 }] }, column: 'score', operation: 'max' },
      output: { result: 47, column: 'score', operation: 'max', used: 3, total: 3, skipped: 0 } },
    { text: 'sum a column with a blank cell in it', input: { table: { headers: ['v'], rows: [{ v: 10 }, { v: '' }, { v: 5 }] }, column: 'v', operation: 'sum' },
      output: { result: 15, column: 'v', operation: 'sum', used: 2, total: 3, skipped: 1 } },
    { text: 'how many rows have a value in name', input: { table: { headers: ['name'], rows: [{ name: 'Ana' }, { name: 'Bo' }] }, column: 'name', operation: 'count' },
      output: { result: 2, column: 'name', operation: 'count', used: 2, total: 2, skipped: 0 } }
  ],
  errorCases: [
    { input: { table: { headers: ['a'], rows: [{ a: 'x' }] }, column: 'a', operation: 'sum' }, code: 'INVALID_INPUT' },
    { input: { table: { headers: ['a'], rows: [{ a: 1 }] }, column: 'b', operation: 'sum' }, code: 'INVALID_INPUT' },
    { input: { table: { headers: ['a'], rows: [{ a: 1 }] }, column: 'a' }, code: 'MISSING_FIELD' }
  ],
  run (input) {
    if (!isTable(input.table)) return fail('INVALID_INPUT', 'That is not a table — I need headers and rows.', 'table');
    if (!input.table.headers.includes(input.column)) {
      return fail('INVALID_INPUT', `There is no "${input.column}" column. The columns are: ${input.table.headers.join(', ')}.`, 'column');
    }
    const total = input.table.rows.length;

    if (input.operation === 'count') {
      /* count is the one operation that works on any column, because it counts
         cells that HAVE a value rather than doing arithmetic on them. */
      const used = input.table.rows.filter(r => r[input.column] !== '' && r[input.column] !== null && r[input.column] !== undefined).length;
      return ok({ result: used, column: input.column, operation: 'count', used, total, skipped: total - used }, computed());
    }

    /* Blank cells are skipped and COUNTED as skipped rather than treated as
       zero — an average over a column with gaps is a different number
       depending on which you do, and the reply says which happened. */
    const values = input.table.rows
      .map(r => r[input.column])
      .filter(v => v !== '' && v !== null && v !== undefined)
      .map(Number);

    if (!values.length || values.some(v => !Number.isFinite(v))) {
      return fail('INVALID_INPUT', `"${input.column}" doesn't hold numbers, so I can't take its ${input.operation}.`, 'column');
    }
    return ok({
      result: round(OPS[input.operation](values), 4),
      column: input.column, operation: input.operation,
      used: values.length, total, skipped: total - values.length
    }, computed());
  }
};
