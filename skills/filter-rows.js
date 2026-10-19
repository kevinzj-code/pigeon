import { ok, fail, computed } from '../src/contracts.js';
import { isTable } from '../src/lib/rows.js';

const OPS = {
  '=': (a, b) => a === b,
  '!=': (a, b) => a !== b,
  '>': (a, b) => Number(a) > Number(b),
  '>=': (a, b) => Number(a) >= Number(b),
  '<': (a, b) => Number(a) < Number(b),
  '<=': (a, b) => Number(a) <= Number(b),
  contains: (a, b) => String(a).toLowerCase().includes(String(b).toLowerCase()),
  'starts with': (a, b) => String(a).toLowerCase().startsWith(String(b).toLowerCase())
};

export default {
  name: 'filterRows',
  description: "Drop the rows of a table that fail a condition.",
  category: 'data',
  tier: 'core',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{rowCount}} of {{originalCount}} {{originalCount|plural:row:rows}} where {{column}} {{operator}} {{value}}.',
  inputSchema: {
    type: 'object',
    required: ['table', 'column', 'operator', 'value'],
    properties: {
      table: { type: 'object', label: 'table', prompt: 'Which table should I filter?' },
      column: { type: 'string', label: 'column', prompt: 'Which column should I filter on?' },
      operator: { type: 'string', label: 'comparison', enum: Object.keys(OPS), prompt: 'Which comparison? (=, !=, >, >=, <, <=, contains, starts with)' },
      value: { label: 'compare to', prompt: 'What should I compare it to?' }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      headers: { type: 'array', items: { type: 'string' } }, rows: { type: 'array' },
      rowCount: { type: 'integer' }, originalCount: { type: 'integer' },
      column: { type: 'string' }, operator: { type: 'string' }, value: {}
    }
  },
  examples: [
    { text: 'keep only rows where amount is over 100', input: { table: { headers: ['name', 'amount'], rows: [{ name: 'Ana', amount: 120 }, { name: 'Bo', amount: 80 }] }, column: 'amount', operator: '>', value: 100 },
      output: { headers: ['name', 'amount'], rows: [{ name: 'Ana', amount: 120 }], rowCount: 1, originalCount: 2, column: 'amount', operator: '>', value: 100 } },
    { text: 'show me just the North region rows', input: { table: { headers: ['region', 'q1'], rows: [{ region: 'North', q1: 120 }, { region: 'South', q1: 90 }] }, column: 'region', operator: '=', value: 'North' },
      output: { headers: ['region', 'q1'], rows: [{ region: 'North', q1: 120 }], rowCount: 1, originalCount: 2, column: 'region', operator: '=', value: 'North' } },
    { text: 'filter to names containing "an"', input: { table: { headers: ['name'], rows: [{ name: 'Ana' }, { name: 'Bo' }, { name: 'Hannah' }] }, column: 'name', operator: 'contains', value: 'an' },
      output: { headers: ['name'], rows: [{ name: 'Ana' }, { name: 'Hannah' }], rowCount: 2, originalCount: 3, column: 'name', operator: 'contains', value: 'an' } },
    { text: 'drop everything at or below zero', input: { table: { headers: ['v'], rows: [{ v: -5 }, { v: 0 }, { v: 12 }] }, column: 'v', operator: '>', value: 0 },
      output: { headers: ['v'], rows: [{ v: 12 }], rowCount: 1, originalCount: 3, column: 'v', operator: '>', value: 0 } },
    { text: 'filter where nothing matches', input: { table: { headers: ['n'], rows: [{ n: 1 }, { n: 2 }] }, column: 'n', operator: '>', value: 99 },
      output: { headers: ['n'], rows: [], rowCount: 0, originalCount: 2, column: 'n', operator: '>', value: 99 } }
  ],
  errorCases: [
    { input: { table: { headers: ['a'], rows: [{ a: 1 }] }, column: 'missing', operator: '=', value: 1 }, code: 'INVALID_INPUT' },
    { input: { table: { nope: true }, column: 'a', operator: '=', value: 1 }, code: 'INVALID_INPUT' },
    { input: { column: 'a', operator: '=', value: 1 }, code: 'MISSING_FIELD' }
  ],
  run (input) {
    if (!isTable(input.table)) return fail('INVALID_INPUT', 'That is not a table — I need headers and rows.', 'table');
    if (!input.table.headers.includes(input.column)) {
      return fail('INVALID_INPUT', `There is no "${input.column}" column. The columns are: ${input.table.headers.join(', ')}.`, 'column');
    }
    const op = OPS[input.operator];
    const rows = input.table.rows.filter(r => op(r[input.column], input.value));
    return ok({
      headers: input.table.headers, rows,
      rowCount: rows.length, originalCount: input.table.rows.length,
      column: input.column, operator: input.operator, value: input.value
    }, computed());
  }
};
