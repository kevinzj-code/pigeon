import { ok, computed } from '../src/contracts.js';
import { lines } from '../src/lib/text.js';

export default {
  name: 'trimLines',
  description: 'Remove the leading and trailing spaces from every line of a text, leaving the lines themselves in place.',
  category: 'text',
  tier: 'core',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{changed}} of {{lines}} {{lines|plural:line:lines}} trimmed.',
  inputSchema: {
    type: 'object',
    required: ['text'],
    properties: {
      text: { type: 'string', label: 'text', prompt: 'Which text should I trim?' },
      dropBlank: { type: 'boolean', label: 'drop blank lines', default: false, description: 'also remove lines that end up empty' }
    }
  },
  outputSchema: {
    type: 'object',
    properties: { result: { type: 'string' }, lines: { type: 'integer' }, changed: { type: 'integer' }, dropped: { type: 'integer' } }
  },
  examples: [
    { text: 'trim the spaces off each line', input: { text: '  one  \n  two\nthree   ' },
      output: { result: 'one\ntwo\nthree', lines: 3, changed: 3, dropped: 0 } },
    { text: 'tidy an indented list', input: { text: '    apples\n    bananas\n    cherries' },
      output: { result: 'apples\nbananas\ncherries', lines: 3, changed: 3, dropped: 0 } },
    { text: 'trim lines and drop the empty ones', input: { text: 'a\n   \nb', dropBlank: true },
      output: { result: 'a\nb', lines: 3, changed: 1, dropped: 1 } },
    { text: 'trim lines that are already clean', input: { text: 'one\ntwo' },
      output: { result: 'one\ntwo', lines: 2, changed: 0, dropped: 0 } },
    { text: 'trim a single padded line', input: { text: '\t hello \t' },
      output: { result: 'hello', lines: 1, changed: 1, dropped: 0 } }
  ],
  errorCases: [
    { input: {}, code: 'MISSING_FIELD' },
    { input: { text: ['a'] }, code: 'INVALID_INPUT' },
    { input: { text: 'a', dropBlank: 'maybe' }, code: 'INVALID_INPUT' }
  ],
  run (input) {
    const all = lines(input.text);
    const trimmed = all.map(l => l.trim());
    const changed = trimmed.filter((l, i) => l !== all[i]).length;
    const kept = input.dropBlank ? trimmed.filter(l => l !== '') : trimmed;
    return ok({
      result: kept.join('\n'), lines: all.length, changed,
      dropped: trimmed.length - kept.length
    }, computed());
  }
};
