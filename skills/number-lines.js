import { ok, computed } from '../src/contracts.js';
import { lines } from '../src/lib/text.js';

export default {
  name: 'numberLines',
  description: 'Put a line number in front of each line of a text.',
  category: 'text', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{result|prose}}',
  inputSchema: {
    type: 'object', required: ['text'],
    properties: {
      text: { type: 'string', label: 'text', minLength: 1, prompt: 'Which text should I number?' },
      start: { type: 'integer', label: 'first number', default: 1 },
      separator: { type: 'string', label: 'separator', default: '. ' },
      skipBlank: { type: 'boolean', label: 'skip blank lines', default: false }
    }
  },
  outputSchema: { type: 'object', properties: { result: { type: 'string' }, lines: { type: 'integer' }, numbered: { type: 'integer' } } },
  examples: [
    { text: 'number these lines', input: { text: 'alpha\nbeta\ngamma' }, output: { result: '1. alpha\n2. beta\n3. gamma', lines: 3, numbered: 3 } },
    { text: 'add line numbers starting at 10', input: { text: 'one\ntwo', start: 10 }, output: { result: '10. one\n11. two', lines: 2, numbered: 2 } },
    { text: 'number lines with a colon', input: { text: 'a\nb', separator: ': ' }, output: { result: '1: a\n2: b', lines: 2, numbered: 2 } },
    { text: 'number only the non-blank lines', input: { text: 'first\n\nsecond', skipBlank: true }, output: { result: '1. first\n\n2. second', lines: 3, numbered: 2 } },
    { text: 'number a ten line list to check the padding', input: { text: 'a\nb\nc\nd\ne\nf\ng\nh\ni\nj' }, output: { result: ' 1. a\n 2. b\n 3. c\n 4. d\n 5. e\n 6. f\n 7. g\n 8. h\n 9. i\n10. j', lines: 10, numbered: 10 } }
  ],
  errorCases: [
    { input: {}, code: 'MISSING_FIELD' },
    { input: { text: '' }, code: 'MISSING_FIELD' },
    { input: { text: 'a', start: 'one' }, code: 'INVALID_INPUT' }
  ],
  run (input) {
    const all = lines(input.text);
    /* Right-aligned to the widest number, so line 9 and line 10 line up. An
       unpadded list looks ragged at exactly the sizes people paste. */
    const last = input.start + all.length - 1;
    const width = String(last).length;
    let n = input.start;
    let numbered = 0;
    const out = all.map(line => {
      if (input.skipBlank && line.trim() === '') return line;
      numbered++;
      return `${String(n++).padStart(width)}${input.separator}${line}`;
    });
    return ok({ result: out.join('\n'), lines: all.length, numbered }, computed());
  }
};
