import { ok, fail, computed } from '../src/contracts.js';

export default {
  name: 'replaceText',
  description: 'Find and replace text, either literally or with a regular expression.',
  category: 'text',
  tier: 'core',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{replacements}} {{replacements|plural:replacement:replacements}} made.',
  inputSchema: {
    type: 'object',
    required: ['text', 'find', 'replace'],
    properties: {
      text: { type: 'string', label: 'text', prompt: 'Which text should I change?' },
      find: { type: 'string', label: 'find', minLength: 1, prompt: 'What should I search for?' },
      replace: { type: 'string', label: 'replace with', prompt: 'What should I replace it with?' },
      regex: { type: 'boolean', label: 'regular expression', default: false },
      caseSensitive: { type: 'boolean', label: 'match case', default: true }
    }
  },
  outputSchema: {
    type: 'object',
    properties: { result: { type: 'string' }, replacements: { type: 'integer' }, original: { type: 'string' } }
  },
  examples: [
    { text: 'replace "colour" with "color" in my text', input: { text: 'The colour of the colour chart.', find: 'colour', replace: 'color' },
      output: { result: 'The color of the color chart.', replacements: 2, original: 'The colour of the colour chart.' } },
    { text: 'swap all the commas for semicolons', input: { text: 'a, b, c', find: ',', replace: ';' },
      output: { result: 'a; b; c', replacements: 2, original: 'a, b, c' } },
    { text: 'collapse repeated spaces using a regex', input: { text: 'too    many     spaces', find: ' {2,}', replace: ' ', regex: true },
      output: { result: 'too many spaces', replacements: 2, original: 'too    many     spaces' } },
    { text: 'replace Cat ignoring case', input: { text: 'Cat cat CAT', find: 'cat', replace: 'dog', caseSensitive: false },
      output: { result: 'dog dog dog', replacements: 3, original: 'Cat cat CAT' } },
    { text: 'replace something that is not there', input: { text: 'nothing to see', find: 'zebra', replace: 'horse' },
      output: { result: 'nothing to see', replacements: 0, original: 'nothing to see' } }
  ],
  errorCases: [
    { input: { text: 'abc', find: '(unclosed', replace: 'x', regex: true }, code: 'INVALID_INPUT' },
    { input: { text: 'abc', find: '', replace: 'x' }, code: 'MISSING_FIELD' },
    { input: { text: 'abc', replace: 'x' }, code: 'MISSING_FIELD' }
  ],
  run (input) {
    const flags = `g${input.caseSensitive ? '' : 'i'}`;
    let re;
    if (input.regex) {
      try { re = new RegExp(input.find, flags); }
      catch (e) { return fail('INVALID_INPUT', `That regular expression doesn't compile: ${e.message}`, 'find'); }
    } else {
      /* A literal search must not be read as a pattern — searching for "a.b"
         literally has to mean "a.b", not "a", any character, "b". */
      re = new RegExp(input.find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
    }
    const replacements = (input.text.match(re) ?? []).length;
    /* $& and friends in the replacement would be substitution patterns; a
       replacement string the user typed should be taken as written. */
    const result = input.text.replace(re, () => input.replace);
    return ok({ result, replacements, original: input.text }, computed());
  }
};
