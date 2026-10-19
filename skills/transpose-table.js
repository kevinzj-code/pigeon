import { ok, fail, computed } from '../src/contracts.js';
import { isTable } from '../src/lib/rows.js';

export default {
  name: 'transposeTable',
  description: "Pivot a table on its side, so rows become columns.",
  category: 'data', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: 'Transposed into {{rowCount}} {{rowCount|plural:row:rows}} and {{columnCount}} {{columnCount|plural:column:columns}}: {{headers|list}}',
  inputSchema: {
    type: 'object', required: ['table'],
    properties: { table: { type: 'object', label: 'table', prompt: 'Which table should I transpose?' } }
  },
  outputSchema: {
    type: 'object',
    properties: {
      headers: { type: 'array', items: { type: 'string' } }, rows: { type: 'array' },
      rowCount: { type: 'integer' }, columnCount: { type: 'integer' }
    }
  },
  examples: [
    { text: 'transpose this table', input: { table: { headers: ['name', 'q1', 'q2'], rows: [{ name: 'Ana', q1: 1, q2: 2 }, { name: 'Bo', q1: 3, q2: 4 }] } }, output: { headers: ['name', 'Ana', 'Bo'], rows: [{ name: 'q1', Ana: 1, Bo: 3 }, { name: 'q2', Ana: 2, Bo: 4 }], rowCount: 2, columnCount: 3 } },
    { text: 'swap the rows and columns', input: { table: { headers: ['city', 'pop'], rows: [{ city: 'Leeds', pop: 800000 }] } }, output: { headers: ['city', 'Leeds'], rows: [{ city: 'pop', Leeds: 800000 }], rowCount: 1, columnCount: 2 } },
    { text: 'flip this table on its side', input: { table: { headers: ['metric', 'jan', 'feb', 'mar'], rows: [{ metric: 'sales', jan: 10, feb: 20, mar: 30 }] } }, output: { headers: ['metric', 'sales'], rows: [{ metric: 'jan', sales: 10 }, { metric: 'feb', sales: 20 }, { metric: 'mar', sales: 30 }], rowCount: 3, columnCount: 2 } },
    { text: 'transpose a table with three records', input: { table: { headers: ['id', 'score'], rows: [{ id: 'a', score: 5 }, { id: 'b', score: 6 }, { id: 'c', score: 7 }] } }, output: { headers: ['id', 'a', 'b', 'c'], rows: [{ id: 'score', a: 5, b: 6, c: 7 }], rowCount: 1, columnCount: 4 } },
    { text: 'turn columns into rows', input: { table: { headers: ['key', 'value'], rows: [{ key: 'host', value: 'localhost' }, { key: 'port', value: 8080 }] } }, output: { headers: ['key', 'host', 'port'], rows: [{ key: 'value', host: 'localhost', port: 8080 }], rowCount: 1, columnCount: 3 } },
    { text: 'flip this table so its columns become its rows', input: { table: { headers: ['a', 'b'], rows: [{ a: 1, b: 2 }, { a: 3, b: 4 }] } },
      output: { headers: ['a', '1', '3'], rows: [{ '1': 2, '3': 4, a: 'b' }], rowCount: 1, columnCount: 3 } }
  ],
  errorCases: [
    { input: { table: { headers: ['a'], rows: [] } }, code: 'INVALID_INPUT' },
    { input: { table: { headers: ['k', 'v'], rows: [{ k: 'x', v: 1 }, { k: 'x', v: 2 }] } }, code: 'INVALID_INPUT' },
    { input: { table: { headers: [], rows: [{}] } }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' }
  ],
  run (input) {
    if (!isTable(input.table)) return fail('INVALID_INPUT', 'I need a table with headers and rows to transpose.', 'table');
    const { headers, rows } = input.table;
    if (!headers.length) return fail('INVALID_INPUT', 'That table has no columns.', 'table');
    if (!rows.length) return fail('INVALID_INPUT', 'That table has no rows to transpose.', 'table');

    /* The first column supplies the new headers, so its values have to be
       usable as column names. Two rows labelled the same would collapse into
       one column and quietly discard a row's worth of data. */
    const [label, ...rest] = headers;
    const labels = rows.map((r) => String(r[label] ?? ''));
    const dupes = labels.filter((l, i) => labels.indexOf(l) !== i);
    if (dupes.length) {
      return fail('INVALID_INPUT', `The "${label}" column repeats ${[...new Set(dupes)].map((d) => `"${d}"`).join(', ')}, so those rows cannot become separate columns.`, 'table');
    }

    const out = rest.map((h) => {
      const row = { [label]: h };
      rows.forEach((r, i) => { row[labels[i]] = r[h]; });
      return row;
    });

    return ok({
      headers: [label, ...labels], rows: out,
      rowCount: out.length, columnCount: labels.length + 1
    }, computed());
  }
};
