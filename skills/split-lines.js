import { ok, fail, computed } from '../src/contracts.js';

export default {
  name: 'splitLines',
  description: 'Split one line into separate lines wherever a delimiter appears.',
  category: 'text',
  tier: 'core',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{count}} {{count|plural:part:parts}}:\n{{parts|lines}}',
  inputSchema: {
    type: 'object',
    required: ['text'],
    properties: {
      text: { type: 'string', label: 'text', minLength: 1, prompt: 'Which text should I split?' },
      delimiter: { type: 'string', label: 'split on', default: ',', minLength: 1 },
      trim: { type: 'boolean', label: 'trim each piece', default: true },
      skipBlank: { type: 'boolean', label: 'skip blank pieces', default: true }
    }
  },
  outputSchema: {
    type: 'object',
    properties: { parts: { type: 'array', items: { type: 'string' } }, result: { type: 'string' }, count: { type: 'integer' } }
  },
  examples: [
    { text: 'split this comma separated list onto lines', input: { text: 'apple, banana, cherry' },
      output: { parts: ['apple', 'banana', 'cherry'], result: 'apple\nbanana\ncherry', count: 3 } },
    { text: 'break this on semicolons', input: { text: 'one;two;three', delimiter: ';' },
      output: { parts: ['one', 'two', 'three'], result: 'one\ntwo\nthree', count: 3 } },
    { text: 'split a tab separated row', input: { text: 'name\tage\tcity', delimiter: '\t' },
      output: { parts: ['name', 'age', 'city'], result: 'name\nage\ncity', count: 3 } },
    { text: 'split and drop the empty pieces', input: { text: 'a,,b,,c' },
      output: { parts: ['a', 'b', 'c'], result: 'a\nb\nc', count: 3 } },
    { text: 'split on the word and', input: { text: 'eggs and milk and flour', delimiter: ' and ' },
      output: { parts: ['eggs', 'milk', 'flour'], result: 'eggs\nmilk\nflour', count: 3 } }
  ],
  errorCases: [
    { input: {}, code: 'MISSING_FIELD' },
    { input: { text: 'a,b', delimiter: '' }, code: 'INVALID_INPUT' },
    { input: { text: 'a,b', trim: 'yes' }, code: 'INVALID_INPUT' }
  ],
  run (input) {
    /* A literal delimiter, always. A user typing "." means a full stop, not
       "any character" — regular expressions live in replaceText. */
    let parts = input.text.split(input.delimiter);
    if (parts.length === 1) {
      return fail('INVALID_INPUT', `"${input.delimiter}" doesn't appear in that text, so there is nothing to split on.`, 'delimiter');
    }
    if (input.trim) parts = parts.map(p => p.trim());
    if (input.skipBlank) parts = parts.filter(p => p !== '');
    return ok({ parts, result: parts.join('\n'), count: parts.length }, computed());
  }
};
