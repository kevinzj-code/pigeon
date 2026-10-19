import { ok, computed } from '../src/contracts.js';

export default {
  name: 'caesarShift',
  description: 'Shift every letter along the alphabet by a fixed amount, as a Caesar cipher.',
  category: 'encoding', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: ['toy'],
  replyTemplate: '{{result|prose}}',
  inputSchema: {
    type: 'object', required: ['text', 'shift'],
    properties: {
      text: { type: 'string', label: 'text', minLength: 1, prompt: 'Which text?' },
      shift: { type: 'integer', label: 'shift by', prompt: 'Shift by how many letters? (negative to shift back)' }
    }
  },
  outputSchema: { type: 'object', properties: { result: { type: 'string' }, shift: { type: 'integer' }, lettersChanged: { type: 'integer' }, reverseShift: { type: 'integer' } } },
  examples: [
    { text: 'caesar shift hello by 3', input: { text: 'hello', shift: 3 }, output: { result: 'khoor', shift: 3, lettersChanged: 5, reverseShift: 23 } },
    { text: 'shift khoor back by 3', input: { text: 'khoor', shift: -3 }, output: { result: 'hello', shift: -3, lettersChanged: 5, reverseShift: 3 } },
    { text: 'shift this by 13', input: { text: 'Attack', shift: 13 }, output: { result: 'Nggnpx', shift: 13, lettersChanged: 6, reverseShift: 13 } },
    { text: 'caesar cipher with a shift of 1', input: { text: 'xyz', shift: 1 }, output: { result: 'yza', shift: 1, lettersChanged: 3, reverseShift: 25 } },
    { text: 'shift a phrase by 5 keeping punctuation', input: { text: 'meet at 6!', shift: 5 }, output: { result: 'rjjy fy 6!', shift: 5, lettersChanged: 6, reverseShift: 21 } }
  ],
  errorCases: [
    { input: { text: 'abc' }, code: 'MISSING_FIELD' },
    { input: { text: 'abc', shift: 1.5 }, code: 'INVALID_INPUT' },
    { input: { shift: 3 }, code: 'MISSING_FIELD' }
  ],
  run (input) {
    /* Normalised into 0–25 so a shift of 29 or -3 both behave, and reported so
       the reverse is obvious. A toy cipher, labelled as one. */
    const shift = ((input.shift % 26) + 26) % 26;
    let lettersChanged = 0;
    const result = input.text.replace(/[a-z]/gi, (c) => {
      lettersChanged++;
      const base = c <= 'Z' ? 65 : 97;
      return String.fromCharCode(((c.charCodeAt(0) - base + shift) % 26) + base);
    });
    return ok({
      result, shift: input.shift, lettersChanged,
      reverseShift: (26 - shift) % 26
    }, computed());
  }
};
