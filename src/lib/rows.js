/* rows.js — the tabular shape the §13 skills pass between each other.
 *
 * A "table" here is { headers: string[], rows: Array<Record<string, string|number>> }.
 * parseCsv produces it; filterRows, sortRows, columnMath and toMarkdownTable
 * consume it. That shared shape is what makes them chain in a plan:
 *
 *   s1 parseCsv     → { headers, rows }
 *   s2 filterRows   { table: "$s1", ... }
 *   s3 columnMath   { table: "$s2", column: "amount", operation: "sum" }
 *
 * A $ref resolves to whatever the earlier step's field held, so passing whole
 * tables between steps costs nothing and needs no special support. */

/* RFC 4180 quoting: doubled quotes inside a quoted field, embedded newlines
   and commas allowed. Written as a character walk rather than a regex because
   a regex that handles embedded newlines correctly is unreadable and the ones
   that look right usually don't. */
export function parseCsvText (text, delimiter = ',') {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let i = 0;
  const s = String(text ?? '').replace(/\r\n?/g, '\n');

  while (i < s.length) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i += 2; continue; }
        quoted = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"' && field === '') { quoted = true; i++; continue; }
    if (c === delimiter) { row.push(field); field = ''; i++; continue; }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    field += c; i++;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => !(r.length === 1 && r[0] === ''));
}

/* A cell that is entirely a number becomes a number, so columnMath and
   sortRows do arithmetic rather than string comparison. "007" stays a string —
   it is an identifier, and turning it into 7 loses the thing that made it one. */
export function coerceCell (v) {
  const s = String(v).trim();
  if (s === '') return '';
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (Number.isFinite(n)) return n;
  }
  return v;
}

export const isTable = (t) => Boolean(t && Array.isArray(t.headers) && Array.isArray(t.rows));
