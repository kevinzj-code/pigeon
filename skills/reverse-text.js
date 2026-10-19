import { ok, computed } from '../src/contracts.js';
import { words, lines } from '../src/lib/text.js';

export default {
  name: 'reverseText',
  description: 'Reverse a text — by character, by word, or by line.',
  category: 'text', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{result|prose}}',
  inputSchema: {
    type: 'object', required: ['text'],
    properties: {
      text: { type: 'string', label: 'text', minLength: 1, prompt: 'Which text should I reverse?' },
      by: { type: 'string', label: 'reverse by', enum: ['characters', 'words', 'lines'], default: 'characters' }
    }
  },
  outputSchema: { type: 'object', properties: { result: { type: 'string' }, by: { type: 'string' }, original: { type: 'string' }, palindrome: { type: 'boolean' } } },
  examples: [
    { text: 'reverse the word stressed', input: { text: 'stressed' }, output: { result: 'desserts', by: 'characters', original: 'stressed', palindrome: false } },
    { text: 'reverse this text backwards', input: { text: 'hello' }, output: { result: 'olleh', by: 'characters', original: 'hello', palindrome: false } },
    { text: 'reverse the word order of the quick brown fox', input: { text: 'the quick brown fox', by: 'words' }, output: { result: 'fox brown quick the', by: 'words', original: 'the quick brown fox', palindrome: false } },
    { text: 'reverse these lines', input: { text: 'one\ntwo\nthree', by: 'lines' }, output: { result: 'three\ntwo\none', by: 'lines', original: 'one\ntwo\nthree', palindrome: false } },
    { text: 'reverse racecar', input: { text: 'racecar' }, output: { result: 'racecar', by: 'characters', original: 'racecar', palindrome: true } }
  ],
  errorCases: [
    { input: {}, code: 'MISSING_FIELD' },
    { input: { text: '' }, code: 'MISSING_FIELD' },
    { input: { text: 'abc', by: 'sideways' }, code: 'INVALID_INPUT' }
  ],
  run (input) {
    /* Spread rather than split(''): a string split by index cuts astral
       characters (emoji, many CJK extensions) in half and produces mojibake.
       [...str] iterates code points. */
    const result = input.by === 'characters' ? [...input.text].reverse().join('')
      : input.by === 'words' ? words(input.text).reverse().join(' ')
        : lines(input.text).reverse().join('\n');
    return ok({
      result, by: input.by, original: input.text,
      palindrome: input.by === 'characters' && result === input.text
    }, computed());
  }
};
