import { ok, computed } from '../src/contracts.js';
import { toBytes } from '../src/lib/bytes.js';

export default {
  name: 'textFileStats',
  description: 'Count the lines, words and bytes in a piece of text and describe its line endings.',
  category: 'files', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{lines}} {{lines|plural:line:lines}}, {{words}} {{words|plural:word:words}}, {{characters}} characters, {{bytes}} bytes. Line endings: {{lineEnding}}. Encoding: {{encoding}}.',
  inputSchema: {
    type: 'object', required: ['text'],
    properties: { text: { type: 'string', label: 'text', minLength: 1, maxLength: 2000000, prompt: 'Which text should I measure?' } }
  },
  outputSchema: {
    type: 'object',
    properties: {
      lines: { type: 'integer' }, words: { type: 'integer' }, characters: { type: 'integer' },
      bytes: { type: 'integer' }, blankLines: { type: 'integer' }, longestLineLength: { type: 'integer' },
      lineEnding: { type: 'string' }, encoding: { type: 'string' }, endsWithNewline: { type: 'boolean' }
    }
  },
  examples: [
    { text: 'stats for this text', input: { text: 'hello world' }, output: { lines: 1, words: 2, characters: 11, bytes: 11, blankLines: 0, longestLineLength: 11, lineEnding: 'none', encoding: 'ASCII', endsWithNewline: false } },
    { text: 'count the lines in this file', input: { text: 'a\nb\nc\n' }, output: { lines: 3, words: 3, characters: 6, bytes: 6, blankLines: 0, longestLineLength: 1, lineEnding: 'LF', encoding: 'ASCII', endsWithNewline: true } },
    { text: 'file stats with a blank line', input: { text: 'one\n\ntwo' }, output: { lines: 3, words: 2, characters: 8, bytes: 8, blankLines: 1, longestLineLength: 3, lineEnding: 'LF', encoding: 'ASCII', endsWithNewline: false } },
    { text: 'what line endings does this use', input: { text: 'x\r\ny' }, output: { lines: 2, words: 2, characters: 4, bytes: 4, blankLines: 0, longestLineLength: 1, lineEnding: 'CRLF', encoding: 'ASCII', endsWithNewline: false } },
    { text: 'byte count for accented text', input: { text: 'café\n' }, output: { lines: 1, words: 1, characters: 5, bytes: 6, blankLines: 0, longestLineLength: 4, lineEnding: 'LF', encoding: 'UTF-8', endsWithNewline: true } }
  ],
  errorCases: [
    { input: {}, code: 'MISSING_FIELD' },
    { input: { text: '' }, code: 'MISSING_FIELD' },
    { input: { text: 'x'.repeat(2000001) }, code: 'INVALID_INPUT' }
  ],
  run (input) {
    const text = String(input.text);
    const bytes = toBytes(text);

    const hasCrlf = /\r\n/.test(text);
    const hasBareLf = /(?<!\r)\n/.test(text);
    const lineEnding = hasCrlf && hasBareLf ? 'mixed' : hasCrlf ? 'CRLF' : hasBareLf ? 'LF' : 'none';

    /* A trailing newline ends the last line, it does not start a new empty one —
       `wc -l` and every editor agree, and counting it would report one more line
       than the file has. */
    const endsWithNewline = /\r?\n$/.test(text);
    const body = text.replace(/\r?\n$/, '');
    const lines = body.split(/\r\n|\n|\r/);

    return ok({
      lines: lines.length,
      words: (text.match(/\S+/g) || []).length,
      characters: [...text].length,
      bytes: bytes.length,
      blankLines: lines.filter((l) => l.trim() === '').length,
      longestLineLength: Math.max(...lines.map((l) => [...l].length)),
      lineEnding,
      /* The text arrives already decoded, so this says whether it NEEDS more
         than ASCII, which is the useful question — not a guess at what some
         original file on disk was encoded in. */
      encoding: bytes.length === [...text].length && /^[\x00-\x7F]*$/.test(text) ? 'ASCII' : 'UTF-8',
      endsWithNewline
    }, computed());
  }
};
