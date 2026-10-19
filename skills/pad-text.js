import { ok, fail, computed } from '../src/contracts.js';

export default {
  name: 'padText',
  description: 'Pad text out to a fixed width, aligned left, right or centre.',
  category: 'text', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{result|prose}}',
  inputSchema: {
    type: 'object', required: ['text', 'width'],
    properties: {
      text: { type: 'string', label: 'text', prompt: 'Which text should I pad?' },
      width: { type: 'integer', label: 'width', minimum: 1, maximum: 500, prompt: 'Pad to what width?' },
      align: { type: 'string', label: 'align', enum: ['left', 'right', 'centre'], default: 'left' },
      fill: { type: 'string', label: 'fill character', default: ' ', minLength: 1, maxLength: 1 }
    }
  },
  outputSchema: { type: 'object', properties: { result: { type: 'string' }, width: { type: 'integer' }, added: { type: 'integer' }, truncated: { type: 'boolean' } } },
  examples: [
    { text: 'pad "abc" to 8 characters', input: { text: 'abc', width: 8 }, output: { result: 'abc     ', width: 8, added: 5, truncated: false } },
    { text: 'right align 42 in 6 columns', input: { text: '42', width: 6, align: 'right' }, output: { result: '    42', width: 6, added: 4, truncated: false } },
    { text: 'centre the word title in 11', input: { text: 'title', width: 11, align: 'centre' }, output: { result: '   title   ', width: 11, added: 6, truncated: false } },
    { text: 'pad with dots to make a table of contents line', input: { text: 'Chapter 1', width: 20, fill: '.' }, output: { result: 'Chapter 1...........', width: 20, added: 11, truncated: false } },
    { text: 'pad text that is already too long', input: { text: 'far too long already', width: 5 }, output: { result: 'far t', width: 5, added: 0, truncated: true } }
  ],
  errorCases: [
    { input: { text: 'a', width: 0 }, code: 'INVALID_INPUT' },
    { input: { text: 'a', width: 8, fill: '--' }, code: 'INVALID_INPUT' },
    { input: { text: 'a' }, code: 'MISSING_FIELD' }
  ],
  run (input) {
    const s = input.text;
    const f = input.fill;
    if (!f.length) return fail('INVALID_INPUT', 'The fill character cannot be empty.', 'fill');
    /* Longer than the target: truncate and SAY SO. Silently returning something
       wider than the width asked for breaks every table it is used in. */
    if (s.length >= input.width) {
      return ok({
        result: s.slice(0, input.width), width: input.width, added: 0,
        truncated: s.length > input.width
      }, computed());
    }
    const total = input.width - s.length;
    const result = input.align === 'right' ? f.repeat(total) + s
      : input.align === 'centre'
        ? f.repeat(Math.floor(total / 2)) + s + f.repeat(Math.ceil(total / 2))
        : s + f.repeat(total);
    return ok({ result, width: input.width, added: total, truncated: false }, computed());
  }
};
