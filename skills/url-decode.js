import { ok, fail, computed } from '../src/contracts.js';

export default {
  name: 'urlDecode',
  description: "Turn %20-style escapes back into readable characters.",
  category: 'encoding',
  tier: 'core',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  title: 'URL decode',
  replyTemplate: '{{result}}',
  inputSchema: {
    type: 'object',
    required: ['text'],
    properties: {
      text: { type: 'string', label: 'text', minLength: 1, prompt: 'Which encoded text should I decode?' },
      plusAsSpace: { type: 'boolean', label: '+ means space', default: false, description: 'treat + as a space, as form submissions do' }
    }
  },
  outputSchema: {
    type: 'object',
    properties: { result: { type: 'string' }, original: { type: 'string' }, changed: { type: 'boolean' } }
  },
  examples: [
    { text: 'decode hello%20world', input: { text: 'hello%20world' },
      output: { result: 'hello world', original: 'hello%20world', changed: true } },
    { text: 'what does caf%C3%A9 say', input: { text: 'caf%C3%A9' },
      output: { result: 'café', original: 'caf%C3%A9', changed: true } },
    { text: 'decode a query string value', input: { text: 'name%3DAna%20%26%20Co' },
      output: { result: 'name=Ana & Co', original: 'name%3DAna%20%26%20Co', changed: true } },
    { text: 'decode a form-encoded value with plusses', input: { text: 'hello+there', plusAsSpace: true },
      output: { result: 'hello there', original: 'hello+there', changed: true } },
    { text: 'decode text that is already plain', input: { text: 'nothing-encoded' },
      output: { result: 'nothing-encoded', original: 'nothing-encoded', changed: false } }
  ],
  errorCases: [
    { input: { text: '%ZZ' }, code: 'INVALID_INPUT' },
    { input: { text: '%' }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' }
  ],
  run (input) {
    try {
      /* + means space only in form encoding, not in a path — so it is opt-in.
         Decoding "C++" to "C  " by default would be a wrong answer. */
      const prepared = input.plusAsSpace ? input.text.replace(/\+/g, ' ') : input.text;
      const result = decodeURIComponent(prepared);
      return ok({ result, original: input.text, changed: result !== input.text }, computed());
    } catch {
      return fail('INVALID_INPUT', 'That is not validly encoded — there is a % that is not followed by two hex digits.', 'text');
    }
  }
};
