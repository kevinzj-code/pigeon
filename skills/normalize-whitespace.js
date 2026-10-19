import { ok, computed } from '../src/contracts.js';

export default {
  name: 'normalizeWhitespace',
  description: 'Tidy the spacing in a text — collapse runs of spaces, trim the ends, and unify line endings.',
  category: 'text',
  tier: 'core',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{result}}',
  inputSchema: {
    type: 'object',
    required: ['text'],
    properties: {
      text: { type: 'string', label: 'text', prompt: 'Which text should I tidy?' },
      collapseBlankLines: { type: 'boolean', label: 'collapse blank lines', default: true, description: 'reduce runs of blank lines to one' }
    }
  },
  outputSchema: {
    type: 'object',
    properties: { result: { type: 'string' }, removed: { type: 'integer' }, before: { type: 'integer' }, after: { type: 'integer' } }
  },
  examples: [
    { text: 'tidy up the spacing in this', input: { text: 'too    many     spaces' },
      output: { result: 'too many spaces', removed: 7, before: 22, after: 15 } },
    { text: 'trim and collapse this text', input: { text: '   leading and trailing   ' },
      output: { result: 'leading and trailing', removed: 6, before: 26, after: 20 } },
    { text: 'normalise windows line endings', input: { text: 'one\r\ntwo\r\nthree' },
      output: { result: 'one\ntwo\nthree', removed: 2, before: 15, after: 13 } },
    { text: 'collapse the blank lines', input: { text: 'a\n\n\n\nb' },
      output: { result: 'a\n\nb', removed: 2, before: 6, after: 4 } },
    { text: 'clean up text pasted from a pdf', input: { text: 'The  quick\t\tbrown   fox\n\n\n  jumps' },
      output: { result: 'The quick brown fox\n\njumps', removed: 7, before: 33, after: 26 } }
  ],
  errorCases: [
    { input: {}, code: 'MISSING_FIELD' },
    { input: { text: ['a'] }, code: 'INVALID_INPUT' },
    { input: { text: 'a', collapseBlankLines: 'yes' }, code: 'INVALID_INPUT' }
  ],
  run (input) {
    const before = input.text.length;
    let out = input.text
      .replace(/\r\n?/g, '\n')
      /* [^\S\n] is "whitespace that isn't a newline" — collapsing runs of
         spaces and tabs without eating the line structure, which a plain \s+
         would. */
      .replace(/[^\S\n]+/g, ' ')
      .replace(/ *\n */g, '\n');
    if (input.collapseBlankLines) out = out.replace(/\n{3,}/g, '\n\n');
    out = out.trim();
    return ok({ result: out, removed: before - out.length, before, after: out.length }, computed());
  }
};
