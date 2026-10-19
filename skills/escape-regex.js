import { ok, computed } from '../src/contracts.js';

export default {
  name: 'escapeRegex',
  description: 'Escape special characters so text matches literally inside a regex pattern.',
  category: 'developer', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{result|prose}}',
  inputSchema: {
    type: 'object', required: ['text'],
    properties: { text: { type: 'string', label: 'text', minLength: 1, prompt: 'Which text should I escape?' } }
  },
  outputSchema: { type: 'object', properties: { result: { type: 'string' }, escaped: { type: 'integer' }, characters: { type: 'array', items: { type: 'string' } }, changed: { type: 'boolean' } } },
  examples: [
    { text: 'escape this for a regex: a.b', input: { text: 'a.b' }, output: { result: 'a\\.b', escaped: 1, characters: ['.'], changed: true } },
    { text: 'make this string regex-safe', input: { text: 'price is $9.99 (sale)' }, output: { result: 'price is \\$9\\.99 \\(sale\\)', escaped: 4, characters: ['$', '.', '(', ')'], changed: true } },
    { text: 'escape a path for a pattern', input: { text: 'src/lib/*.js' }, output: { result: 'src/lib/\\*\\.js', escaped: 2, characters: ['*', '.'], changed: true } },
    { text: 'escape a string with brackets', input: { text: 'array[0]' }, output: { result: 'array\\[0\\]', escaped: 2, characters: ['[', ']'], changed: true } },
    { text: 'escape plain text that needs nothing', input: { text: 'plain text' }, output: { result: 'plain text', escaped: 0, characters: [], changed: false } },
    { text: 'make this safe to drop into a regex pattern: c++', input: { text: 'c++' },
      output: { result: 'c\\+\\+', escaped: 2, characters: ['+'], changed: true } },
    { text: 'escape the special characters for a regular expression: (a|b)', input: { text: '(a|b)' },
      output: { result: '\\(a\\|b\\)', escaped: 3, characters: ['(', '|', ')'], changed: true } }
  ],
  errorCases: [
    { input: {}, code: 'MISSING_FIELD' },
    { input: { text: '' }, code: 'MISSING_FIELD' },
    { input: { text: ['a.b'] }, code: 'INVALID_INPUT' }
  ],
  run (input) {
    const seen = [];
    /* The characters the pattern grammar reserves, plus - because it means a
       range inside a character class. NOT / — that only needs escaping inside a
       literal /…/, and this output is for `new RegExp(...)`, where escaping it
       just clutters every path someone pastes in. Missing one of the others
       turns a literal search into a pattern, which looks fine right up until
       the input contains a dot. */
    const RESERVED = /[.*+?^${}()|[\]\\-]/g;
    const result = input.text.replace(RESERVED, (c) => {
      if (!seen.includes(c)) seen.push(c);
      return `\\${c}`;
    });
    return ok({
      result, escaped: (input.text.match(RESERVED) ?? []).length,
      characters: seen, changed: result !== input.text
    }, computed());
  }
};
