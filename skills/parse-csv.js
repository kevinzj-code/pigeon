import { ok, fail, computed } from '../src/contracts.js';
import { parseCsvText, coerceCell } from '../src/lib/rows.js';

export default {
  name: 'parseCsv',
  description: 'Read CSV text into rows and columns, detecting the header line.',
  category: 'data',
  tier: 'core',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  title: 'Read CSV',
  replyTemplate: '{{rowCount}} {{rowCount|plural:row:rows}} across {{columnCount}} {{columnCount|plural:column:columns}}: {{headers|list}}.',
  inputSchema: {
    type: 'object',
    required: ['text'],
    properties: {
      text: { type: 'string', label: 'csv', minLength: 1, prompt: 'Which CSV text should I read?' },
      delimiter: { type: 'string', label: 'delimiter', enum: [',', ';', '\t', '|'], default: ',' },
      hasHeader: { type: 'boolean', label: 'has header row', default: true }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      headers: { type: 'array', items: { type: 'string' } },
      rows: { type: 'array' }, rowCount: { type: 'integer' }, columnCount: { type: 'integer' }
    }
  },
  examples: [
    { text: 'parse this csv: name,amount\nAna,120\nBo,80', input: { text: 'name,amount\nAna,120\nBo,80' },
      output: { headers: ['name', 'amount'], rows: [{ name: 'Ana', amount: 120 }, { name: 'Bo', amount: 80 }], rowCount: 2, columnCount: 2 } },
    { text: 'read a csv with a quoted comma', input: { text: 'item,note\nDesk,"black, oak"' },
      output: { headers: ['item', 'note'], rows: [{ item: 'Desk', note: 'black, oak' }], rowCount: 1, columnCount: 2 } },
    { text: 'parse semicolon separated data', input: { text: 'a;b\n1;2', delimiter: ';' },
      output: { headers: ['a', 'b'], rows: [{ a: 1, b: 2 }], rowCount: 1, columnCount: 2 } },
    { text: 'parse csv without a header row', input: { text: 'Ana,120\nBo,80', hasHeader: false },
      output: { headers: ['column1', 'column2'], rows: [{ column1: 'Ana', column2: 120 }, { column1: 'Bo', column2: 80 }], rowCount: 2, columnCount: 2 } },
    { text: 'read three columns of sales data', input: { text: 'region,q1,q2\nNorth,120,150\nSouth,90,110\nEast,200,180' },
      output: { headers: ['region', 'q1', 'q2'], rows: [{ region: 'North', q1: 120, q2: 150 }, { region: 'South', q1: 90, q2: 110 }, { region: 'East', q1: 200, q2: 180 }], rowCount: 3, columnCount: 3 } }
  ],
  errorCases: [
    { input: { text: '   ' }, code: 'INVALID_INPUT' },
    { input: { text: 'a,b\n1,2', delimiter: '~' }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' }
  ],
  run (input) {
    const grid = parseCsvText(input.text, input.delimiter);
    if (!grid.length) return fail('INVALID_INPUT', 'There are no rows in that text.', 'text');

    const headers = input.hasHeader
      ? grid[0].map((h, i) => String(h).trim() || `column${i + 1}`)
      : grid[0].map((_, i) => `column${i + 1}`);
    const body = input.hasHeader ? grid.slice(1) : grid;
    if (!body.length) return fail('INVALID_INPUT', 'That has a header row but no data rows.', 'text');

    const rows = body.map(cells => {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = coerceCell(cells[i] ?? ''); });
      return obj;
    });
    return ok({ headers, rows, rowCount: rows.length, columnCount: headers.length }, computed());
  }
};
