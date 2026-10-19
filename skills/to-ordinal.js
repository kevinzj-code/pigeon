import { ok, fail, computed } from '../src/contracts.js';

export default {
  name: 'toOrdinal',
  description: 'Add the ordinal suffix to a number — 3 becomes 3rd, 42 becomes 42nd.',
  category: 'math', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  title: 'Ordinal number',
  replyTemplate: '{{ordinal|prose}}',
  inputSchema: {
    type: 'object', required: ['value'],
    properties: {
      value: { type: 'integer', label: 'number', carry: true, prompt: 'Which number?' },
      style: { type: 'string', label: 'style', enum: ['short', 'words'], default: 'short' }
    }
  },
  outputSchema: { type: 'object', properties: { ordinal: { type: 'string' }, value: { type: 'integer' }, suffix: { type: 'string' }, style: { type: 'string' } } },
  examples: [
    { text: 'write 3 as an ordinal', input: { value: 3 }, output: { ordinal: '3rd', value: 3, suffix: 'rd', style: 'short' } },
    { text: 'what is 21 as an ordinal', input: { value: 21 }, output: { ordinal: '21st', value: 21, suffix: 'st', style: 'short' } },
    { text: 'ordinal for 112', input: { value: 112 }, output: { ordinal: '112th', value: 112, suffix: 'th', style: 'short' } },
    { text: 'write 2 as an ordinal word', input: { value: 2, style: 'words' }, output: { ordinal: 'second', value: 2, suffix: 'nd', style: 'words' } },
    { text: 'ordinal of 11', input: { value: 11 }, output: { ordinal: '11th', value: 11, suffix: 'th', style: 'short' } },
    { text: 'write 21 as twenty-first style, with its ending', input: { value: 21 },
      output: { ordinal: '21st', value: 21, suffix: 'st', style: 'short' } },
    { text: 'write 102 with its st nd rd th ending', input: { value: 102 },
      output: { ordinal: '102nd', value: 102, suffix: 'nd', style: 'short' } }
  ],
  errorCases: [
    { input: { value: 3.5 }, code: 'INVALID_INPUT' },
    { input: { value: 'third' }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' }
  ],
  run (input) {
    const n = input.value;
    if (!Number.isInteger(n)) return fail('INVALID_INPUT', 'Ordinals apply to whole numbers.', 'value');
    const abs = Math.abs(n);
    /* The 11/12/13 exception is the whole reason this needs code: 11th, 12th
       and 13th break the 1st/2nd/3rd pattern, and 111th breaks it again. */
    const teens = abs % 100;
    const suffix = teens >= 11 && teens <= 13 ? 'th'
      : ['th', 'st', 'nd', 'rd'][abs % 10] ?? 'th';

    const WORDS = ['zeroth', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth',
      'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth', 'thirteenth',
      'fourteenth', 'fifteenth', 'sixteenth', 'seventeenth', 'eighteenth', 'nineteenth', 'twentieth'];
    const ordinal = input.style === 'words' && abs <= 20
      ? (n < 0 ? `minus ${WORDS[abs]}` : WORDS[abs])
      : `${n}${suffix}`;
    return ok({ ordinal, value: n, suffix, style: input.style }, computed());
  }
};
