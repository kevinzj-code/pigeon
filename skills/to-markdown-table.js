import { ok, fail, computed } from '../src/contracts.js';
import { isTable } from '../src/lib/rows.js';

export default {
  name: 'toMarkdownTable',
  description: 'Draw rows and columns out as a markdown table, pipes and all.',
  category: 'data',
  tier: 'core',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  title: 'Make a Markdown table',
  replyTemplate: '{{markdown}}',
  inputSchema: {
    type: 'object',
    required: ['table'],
    properties: {
      table: { type: 'object', label: 'table', prompt: 'Which table should I format?' },
      align: { type: 'string', label: 'alignment', enum: ['left', 'right', 'centre'], default: 'left' }
    }
  },
  outputSchema: {
    type: 'object',
    properties: { markdown: { type: 'string' }, rowCount: { type: 'integer' }, columnCount: { type: 'integer' } }
  },
  examples: [
    { text: 'make a markdown table from this data', input: { table: { headers: ['name', 'amount'], rows: [{ name: 'Ana', amount: 120 }, { name: 'Bo', amount: 80 }] } },
      output: { markdown: '| name | amount |\n| :--- | :----- |\n| Ana  | 120    |\n| Bo   | 80     |', rowCount: 2, columnCount: 2 } },
    { text: 'format as a right-aligned markdown table', input: { table: { headers: ['q', 'v'], rows: [{ q: 'Q1', v: 5 }] }, align: 'right' },
      output: { markdown: '|  q | v |\n| ---: | ---: |\n| Q1 | 5 |', rowCount: 1, columnCount: 2 } },
    { text: 'turn one row into markdown', input: { table: { headers: ['x'], rows: [{ x: 1 }] } },
      output: { markdown: '| x |\n| :- |\n| 1 |', rowCount: 1, columnCount: 1 } },
    { text: 'markdown table with a pipe in a cell', input: { table: { headers: ['a'], rows: [{ a: 'x|y' }] } },
      output: { markdown: '| a    |\n| :--- |\n| x\\|y |', rowCount: 1, columnCount: 1 } },
    { text: 'markdown table with an empty cell', input: { table: { headers: ['a', 'b'], rows: [{ a: 'x', b: '' }] } },
      output: { markdown: '| a | b |\n| :- | :- |\n| x |   |', rowCount: 1, columnCount: 2 } }
  ],
  errorCases: [
    { input: { table: { headers: [], rows: [] } }, code: 'INVALID_INPUT' },
    { input: { table: [1, 2, 3] }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' }
  ],
  run (input) {
    if (!isTable(input.table)) return fail('INVALID_INPUT', 'That is not a table — I need headers and rows.', 'table');
    const { headers, rows } = input.table;
    if (!headers.length) return fail('INVALID_INPUT', 'That table has no columns.', 'table');

    /* A pipe inside a cell would end the cell. Escaping it is the difference
       between a table and a broken one. */
    const cell = (v) => String(v ?? '').replace(/\|/g, '\\|');
    const widths = headers.map((h, i) =>
      Math.max(cell(h).length, ...rows.map(r => cell(r[headers[i]]).length), 1));

    const pad = (s, w) => input.align === 'right' ? s.padStart(w) : input.align === 'centre'
      ? s.padStart(Math.floor((w + s.length) / 2)).padEnd(w)
      : s.padEnd(w);

    const rule = widths.map(w => input.align === 'right' ? '---:' : input.align === 'centre' ? `:${'-'.repeat(Math.max(1, w - 2))}:` : `:${'-'.repeat(Math.max(1, w - 1))}`);

    const line = (cells) => `| ${cells.join(' | ')} |`;
    const markdown = [
      line(headers.map((h, i) => pad(cell(h), widths[i]))),
      line(rule),
      ...rows.map(r => line(headers.map((h, i) => pad(cell(r[h]), widths[i]))))
    ].join('\n');

    return ok({ markdown, rowCount: rows.length, columnCount: headers.length }, computed());
  }
};
