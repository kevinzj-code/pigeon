import { ok, computed } from '../src/contracts.js';

export default {
  name: 'rot13',
  description: 'Apply the ROT13 letter substitution, which is its own reverse.',
  category: 'encoding', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: ['toy'],
  title: 'ROT13',
  replyTemplate: '{{result|prose}}',
  inputSchema: {
    type: 'object', required: ['text'],
    properties: { text: { type: 'string', label: 'text', minLength: 1, prompt: 'Which text?' } }
  },
  outputSchema: { type: 'object', properties: { result: { type: 'string' }, lettersChanged: { type: 'integer' } } },
  examples: [
    { text: 'rot13 this text', input: { text: 'Hello' }, output: { result: 'Uryyb', lettersChanged: 5 } },
    { text: 'what does Uryyb say in rot13', input: { text: 'Uryyb' }, output: { result: 'Hello', lettersChanged: 5 } },
    { text: 'rot13 a sentence', input: { text: 'The quick brown fox' }, output: { result: 'Gur dhvpx oebja sbk', lettersChanged: 16 } },
    { text: 'rot13 leaves numbers alone', input: { text: 'abc 123' }, output: { result: 'nop 123', lettersChanged: 3 } },
    { text: 'rot13 a spoiler', input: { text: 'the butler did it' }, output: { result: 'gur ohgyre qvq vg', lettersChanged: 14 } }
  ],
  errorCases: [
    { input: {}, code: 'MISSING_FIELD' },
    { input: { text: '' }, code: 'MISSING_FIELD' },
    { input: { text: ['a'] }, code: 'INVALID_INPUT' }
  ],
  run (input) {
    let lettersChanged = 0;
    /* Labelled a toy, and it is one: ROT13 hides a spoiler from a casual
       glance and nothing more. It is not encryption and this skill never
       suggests it is. */
    const result = input.text.replace(/[a-z]/gi, (c) => {
      lettersChanged++;
      const base = c <= 'Z' ? 65 : 97;
      return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
    });
    return ok({ result, lettersChanged }, computed());
  }
};
