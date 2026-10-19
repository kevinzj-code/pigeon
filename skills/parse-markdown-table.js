import { ok, fail, computed } from '../src/contracts.js';
import { coerceCell } from '../src/lib/rows.js';

/* Cells are split on unescaped pipes only. A cell containing `\|` is a pipe the
   author deliberately escaped, and splitting on it would silently invent an
   extra column. */
function splitCells (line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells = [];
  let buf = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && s[i + 1] === '|') { buf += '|'; i++; continue; }
    if (s[i] === '|') { cells.push(buf.trim()); buf = ''; continue; }
    buf += s[i];
  }
  cells.push(buf.trim());
  return cells;
}

const isRule = (cells) => cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c.replace(/\s+/g, '')));

export default {
  name: 'parseMarkdownTable',
  description: 'Read an existing markdown table back into rows of data.',
  category: 'data', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  title: 'Read a Markdown table',
  replyTemplate: '{{rowCount}} {{rowCount|plural:row:rows}} across {{columnCount}} {{columnCount|plural:column:columns}}: {{headers|list}}',
  inputSchema: {
    type: 'object', required: ['text'],
    properties: { text: { type: 'string', label: 'markdown table', minLength: 1, prompt: 'Which Markdown table should I parse?' } }
  },
  outputSchema: {
    type: 'object',
    properties: {
      headers: { type: 'array', items: { type: 'string' } }, rows: { type: 'array' },
      rowCount: { type: 'integer' }, columnCount: { type: 'integer' }
    }
  },
  examples: [
    { text: 'parse this markdown table', input: { text: '| name | age |\n| --- | --- |\n| Ana | 34 |\n| Bo | 28 |' }, output: { headers: ['name', 'age'], rows: [{ name: 'Ana', age: 34 }, { name: 'Bo', age: 28 }], rowCount: 2, columnCount: 2 } },
    { text: 'turn this markdown table into rows', input: { text: 'a | b\n--- | ---\n1 | 2' }, output: { headers: ['a', 'b'], rows: [{ a: 1, b: 2 }], rowCount: 1, columnCount: 2 } },
    { text: 'read a table with alignment markers', input: { text: '| left | mid | right |\n|:--- |:---:| ---:|\n| 1 | 2 | 3 |' }, output: { headers: ['left', 'mid', 'right'], rows: [{ left: 1, mid: 2, right: 3 }], rowCount: 1, columnCount: 3 } },
    { text: 'parse a markdown table with no data rows', input: { text: '| a | b |\n| --- | --- |' }, output: { headers: ['a', 'b'], rows: [], rowCount: 0, columnCount: 2 } },
    { text: 'parse a table containing an escaped pipe', input: { text: '| name | note |\n| --- | --- |\n| Ana | a \\| b |' }, output: { headers: ['name', 'note'], rows: [{ name: 'Ana', note: 'a | b' }], rowCount: 1, columnCount: 2 } }
  ],
  errorCases: [
    { input: { text: 'just a sentence' }, code: 'INVALID_INPUT' },
    { input: { text: '| a | b |' }, code: 'INVALID_INPUT' },
    { input: { text: '| a | b |\n| c | d |' }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' }
  ],
  run (input) {
    const lines = String(input.text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length < 2) return fail('INVALID_INPUT', 'A Markdown table needs at least a header row and a row of dashes under it.', 'text');

    const headers = splitCells(lines[0]);
    if (headers.length < 2 && !lines[0].includes('|')) {
      return fail('INVALID_INPUT', 'I could not find any table columns — Markdown tables separate their cells with | characters.', 'text');
    }
    if (!isRule(splitCells(lines[1]))) {
      return fail('INVALID_INPUT', 'The second line has to be the row of dashes that separates the header from the data, like | --- | --- |.', 'text');
    }
    if (headers.some((h) => h === '')) {
      return fail('INVALID_INPUT', 'One of the columns has no name, so its values would have nothing to sit under.', 'text');
    }

    const rows = [];
    for (const line of lines.slice(2)) {
      const cells = splitCells(line);
      const row = {};
      /* Ragged rows are extremely common in hand-written Markdown. A short row
         gets empty cells rather than an error; a long one keeps its extras
         under a numbered name so nothing is silently dropped. */
      headers.forEach((h, i) => { row[h] = coerceCell(cells[i] ?? ''); });
      cells.slice(headers.length).forEach((c, i) => { row[`column${headers.length + i + 1}`] = coerceCell(c); });
      rows.push(row);
    }

    return ok({ headers, rows, rowCount: rows.length, columnCount: headers.length }, computed());
  }
};
