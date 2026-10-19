import { ok, computed } from '../src/contracts.js';
import { toBytes } from '../src/lib/bytes.js';

export default {
  name: 'binaryEncode',
  description: "Write text out as 1s and 0s, eight bits to a byte.",
  category: 'encoding', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{binary|prose}} — {{byteCount}} {{byteCount|plural:byte:bytes}}, {{bitCount}} bits.',
  inputSchema: {
    type: 'object', required: ['text'],
    properties: {
      text: { type: 'string', label: 'text', minLength: 1, prompt: 'Which text should I turn into binary?' },
      separator: { type: 'string', label: 'byte separator', maxLength: 1, default: ' ', description: 'what to put between each byte' }
    }
  },
  outputSchema: { type: 'object', properties: { binary: { type: 'string' }, byteCount: { type: 'integer' }, bitCount: { type: 'integer' } } },
  examples: [
    { text: 'convert A to binary', input: { text: 'A' }, output: { binary: '01000001', byteCount: 1, bitCount: 8 } },
    { text: 'turn Hi into binary', input: { text: 'Hi' }, output: { binary: '01001000 01101001', byteCount: 2, bitCount: 16 } },
    { text: 'what is hello in binary', input: { text: 'hello' }, output: { binary: '01101000 01100101 01101100 01101100 01101111', byteCount: 5, bitCount: 40 } },
    { text: 'binary for Pigeon with no spaces', input: { text: 'Pigeon', separator: '' }, output: { binary: '010100000110100101100111011001010110111101101110', byteCount: 6, bitCount: 48 } },
    { text: 'encode an accented letter as binary', input: { text: 'é' }, output: { binary: '11000011 10101001', byteCount: 2, bitCount: 16 } }
  ],
  errorCases: [
    { input: {}, code: 'MISSING_FIELD' },
    { input: { text: '' }, code: 'MISSING_FIELD' },
    { input: { text: 'a', separator: 'xx' }, code: 'INVALID_INPUT' }
  ],
  run (input) {
    /* Bytes, not code units. "é" is one character but two UTF-8 bytes, and
       encoding the code unit would produce something binaryDecode could not
       turn back into the same letter. */
    const bytes = toBytes(input.text);
    const sep = input.separator ?? ' ';
    return ok({
      binary: [...bytes].map((b) => b.toString(2).padStart(8, '0')).join(sep),
      byteCount: bytes.length, bitCount: bytes.length * 8
    }, computed());
  }
};
