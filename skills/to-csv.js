import { ok, fail, computed } from '../src/contracts.js';
import { isTable } from '../src/lib/rows.js';

export default {
  name: 'toCsv',
  description: 'Turn rows and columns back into CSV text, quoting anything that needs it.',
  category: 'data',
  tier: 'core',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  title: 'Write CSV',
  replyTemplate: '{{csv}}',
  inputSchema: {
    type: 'object',
    required: ['table'],
    properties: {
      table: { type: 'object', label: 'table', prompt: 'Which table should I write out?' },
      delimiter: { type: 'string', label: 'delimiter', enum: [',', ';', '\t', '|'], default: ',' },
      includeHeader: { type: 'boolean', label: 'include header row', default: true }
    }
  },
  outputSchema: {
    type: 'object',
    properties: { csv: { type: 'string' }, rows: { type: 'integer' }, columns: { type: 'integer' }, quoted: { type: 'integer' } }
  },
  examples: [
    { text: 'turn this table back into csv', input: { table: { headers: ['name', 'amount'], rows: [{ name: 'Ana', amount: 120 }, { name: 'Bo', amount: 80 }] } },
      output: { csv: 'name,amount\nAna,120\nBo,80', rows: 2, columns: 2, quoted: 0 } },
    { text: 'write this out as csv, quoting the comma', input: { table: { headers: ['item', 'note'], rows: [{ item: 'Desk', note: 'black, oak' }] } },
      output: { csv: 'item,note\nDesk,"black, oak"', rows: 1, columns: 2, quoted: 1 } },
    { text: 'export as semicolon separated', input: { table: { headers: ['a', 'b'], rows: [{ a: 1, b: 2 }] }, delimiter: ';' },
      output: { csv: 'a;b\n1;2', rows: 1, columns: 2, quoted: 0 } },
    { text: 'csv without the header row', input: { table: { headers: ['x'], rows: [{ x: 'one' }, { x: 'two' }] }, includeHeader: false },
      output: { csv: 'one\ntwo', rows: 2, columns: 1, quoted: 0 } },
    { text: 'write a cell containing a quote mark', input: { table: { headers: ['q'], rows: [{ q: 'she said "hi"' }] } },
      output: { csv: 'q\n"she said ""hi"""', rows: 1, columns: 1, quoted: 1 } }
  ],
  errorCases: [
    { input: { table: { nope: 1 } }, code: 'INVALID_INPUT' },
    { input: { table: { headers: [], rows: [] } }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' }
  ],
  run (input) {
    if (!isTable(input.table)) return fail('INVALID_INPUT', 'That is not a table — I need headers and rows.', 'table');
    const { headers, rows } = input.table;
    if (!headers.length) return fail('INVALID_INPUT', 'That table has no columns.', 'table');

    let quoted = 0;
    const cell = (v) => {
      const s = v === null || v === undefined ? '' : String(v);
      /* RFC 4180: quote when the value contains the delimiter, a quote mark or
         a newline — and double any quote inside. Anything less produces a file
         that reads back as a different table. */
      if (s.includes(input.delimiter) || s.includes('"') || /[\r\n]/.test(s)) {
        quoted += 1;
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    };

    const body = rows.map(r => headers.map(h => cell(r[h])).join(input.delimiter));
    const out = input.includeHeader
      ? [headers.map(cell).join(input.delimiter), ...body]
      : body;

    return ok({ csv: out.join('\n'), rows: rows.length, columns: headers.length, quoted }, computed());
  }
};
