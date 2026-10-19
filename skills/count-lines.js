import { ok, computed } from '../src/contracts.js';
import { lines } from '../src/lib/text.js';

export default {
  name: 'countLines',
  description: 'Count the lines in a block of text, separating blank lines from lines with content.',
  category: 'text',
  tier: 'core',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{lines}} {{lines|plural:line:lines}} — {{nonBlank}} with content, {{blank}} blank.',
  inputSchema: {
    type: 'object',
    required: ['text'],
    properties: { text: { type: 'string', label: 'text', prompt: 'Which text should I count?' } }
  },
  outputSchema: {
    type: 'object',
    properties: {
      lines: { type: 'integer' }, nonBlank: { type: 'integer' }, blank: { type: 'integer' },
      longest: { type: 'integer' }, paragraphs: { type: 'integer' }
    }
  },
  examples: [
    { text: 'how many lines is this', input: { text: 'one\ntwo\nthree' },
      output: { lines: 3, nonBlank: 3, blank: 0, longest: 5, paragraphs: 1 } },
    { text: 'count lines including the blank ones', input: { text: 'first\n\nsecond\n\nthird' },
      output: { lines: 5, nonBlank: 3, blank: 2, longest: 6, paragraphs: 3 } },
    { text: 'line count of a single line', input: { text: 'just one line' },
      output: { lines: 1, nonBlank: 1, blank: 0, longest: 13, paragraphs: 1 } },
    { text: 'how many lines with windows line endings', input: { text: 'a\r\nb\r\nc' },
      output: { lines: 3, nonBlank: 3, blank: 0, longest: 1, paragraphs: 1 } },
    { text: 'count lines in a list with a trailing newline', input: { text: 'apples\nbananas\n' },
      output: { lines: 3, nonBlank: 2, blank: 1, longest: 7, paragraphs: 1 } },
    { text: 'how many lines are in this file', input: { text: 'alpha\nbeta\n\ngamma' },
      output: { lines: 4, nonBlank: 3, blank: 1, longest: 5, paragraphs: 2 } },
    { text: 'line count for this block', input: { text: 'one\ntwo' },
      output: { lines: 2, nonBlank: 2, blank: 0, longest: 3, paragraphs: 1 } }
  ],
  errorCases: [
    { input: {}, code: 'MISSING_FIELD' },
    { input: { text: { a: 1 } }, code: 'INVALID_INPUT' },
    { input: { text: ['a', 'b'] }, code: 'INVALID_INPUT' }
  ],
  run (input) {
    /* CRLF and CR are normalised to LF first, so a file written on Windows
       does not report twice the lines it has. */
    const all = lines(input.text);
    const nonBlank = all.filter(l => l.trim() !== '');
    return ok({
      lines: all.length,
      nonBlank: nonBlank.length,
      blank: all.length - nonBlank.length,
      longest: all.reduce((n, l) => Math.max(n, l.length), 0),
      paragraphs: input.text.trim() ? input.text.trim().split(/\n\s*\n/).filter(p => p.trim()).length : 0
    }, computed());
  }
};
