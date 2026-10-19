import { ok, computed } from '../src/contracts.js';
import { toBytes, bytesToHex } from '../src/lib/bytes.js';

export default {
  name: 'hexEncode',
  description: "Write text out as hexadecimal byte values.",
  category: 'encoding', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{result|prose}}',
  inputSchema: {
    type: 'object', required: ['text'],
    properties: {
      text: { type: 'string', label: 'text', minLength: 1, prompt: 'Which text should I encode?' },
      separator: { type: 'string', label: 'byte separator', enum: ['', ' ', ':', '-'], default: '' },
      uppercase: { type: 'boolean', label: 'uppercase', default: false }
    }
  },
  outputSchema: { type: 'object', properties: { result: { type: 'string' }, bytes: { type: 'integer' } } },
  examples: [
    { text: 'hex encode Pigeon', input: { text: 'Pigeon' }, output: { result: '506967656f6e', bytes: 6 } },
    { text: 'convert hello to hex', input: { text: 'hello' }, output: { result: '68656c6c6f', bytes: 5 } },
    { text: 'hex encode with spaces between bytes', input: { text: 'hi', separator: ' ' }, output: { result: '68 69', bytes: 2 } },
    { text: 'uppercase hex for this text', input: { text: 'abc', uppercase: true }, output: { result: '616263', bytes: 3 } },
    { text: 'hex encode an accented character', input: { text: 'é' }, output: { result: 'c3a9', bytes: 2 } }
  ],
  errorCases: [
    { input: {}, code: 'MISSING_FIELD' },
    { input: { text: '' }, code: 'MISSING_FIELD' },
    { input: { text: 'a', separator: '/' }, code: 'INVALID_INPUT' }
  ],
  run (input) {
    const bytes = toBytes(input.text);
    const hex = bytesToHex(bytes, input.separator);
    return ok({ result: input.uppercase ? hex.toUpperCase() : hex, bytes: bytes.length }, computed());
  }
};
