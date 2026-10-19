import { ok, computed } from '../src/contracts.js';
import { toBytes, bytesToBase64 } from '../src/lib/bytes.js';

export default {
  name: 'base64Encode',
  description: 'Encode text as base64.',
  category: 'encoding', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{result|prose}}',
  inputSchema: {
    type: 'object', required: ['text'],
    properties: {
      text: { type: 'string', label: 'text', minLength: 1, prompt: 'Which text should I encode?' },
      urlSafe: { type: 'boolean', label: 'url-safe', default: false, description: 'use - and _ and drop the padding' }
    }
  },
  outputSchema: { type: 'object', properties: { result: { type: 'string' }, bytes: { type: 'integer' }, length: { type: 'integer' }, urlSafe: { type: 'boolean' } } },
  examples: [
    { text: 'base64 encode hello world', input: { text: 'hello world' }, output: { result: 'aGVsbG8gd29ybGQ=', bytes: 11, length: 16, urlSafe: false } },
    { text: 'encode this as base64', input: { text: 'Pigeon' }, output: { result: 'UGlnZW9u', bytes: 6, length: 8, urlSafe: false } },
    { text: 'base64 an accented string', input: { text: 'café' }, output: { result: 'Y2Fmw6k=', bytes: 5, length: 8, urlSafe: false } },
    { text: 'url-safe base64 encode', input: { text: 'a?b>c', urlSafe: true }, output: { result: 'YT9iPmM', bytes: 5, length: 7, urlSafe: true } },
    { text: 'encode a single character', input: { text: 'A' }, output: { result: 'QQ==', bytes: 1, length: 4, urlSafe: false } }
  ],
  errorCases: [
    { input: {}, code: 'MISSING_FIELD' },
    { input: { text: '' }, code: 'MISSING_FIELD' },
    { input: { text: ['a'] }, code: 'INVALID_INPUT' }
  ],
  run (input) {
    /* UTF-8 first, then base64. An accented character is two bytes, not one,
       and encoding the characters directly is what makes btoa throw. */
    const bytes = toBytes(input.text);
    const result = bytesToBase64(bytes, { urlSafe: input.urlSafe });
    return ok({ result, bytes: bytes.length, length: result.length, urlSafe: input.urlSafe }, computed());
  }
};
