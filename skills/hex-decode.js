import { ok, fail, computed } from '../src/contracts.js';
import { hexToBytes, fromBytes, looksPrintable } from '../src/lib/bytes.js';

export default {
  name: 'hexDecode',
  description: "Read hex byte values back as the characters they stand for.",
  category: 'encoding', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{result|prose}}',
  inputSchema: {
    type: 'object', required: ['hex'],
    properties: { hex: { type: 'string', label: 'hex', minLength: 2, prompt: 'Which hex should I decode?' } }
  },
  outputSchema: { type: 'object', properties: { result: { type: 'string' }, bytes: { type: 'integer' }, printable: { type: 'boolean' }, note: { type: 'string' } } },
  examples: [
    { text: 'decode 506967656f6e', input: { hex: '506967656f6e' }, output: { result: 'Pigeon', bytes: 6, printable: true, note: '' } },
    { text: 'what is 68656c6c6f in text', input: { hex: '68656c6c6f' }, output: { result: 'hello', bytes: 5, printable: true, note: '' } },
    { text: 'decode hex written with spaces', input: { hex: '68 69' }, output: { result: 'hi', bytes: 2, printable: true, note: '' } },
    { text: 'decode hex with a 0x prefix', input: { hex: '0x616263' }, output: { result: 'abc', bytes: 3, printable: true, note: '' } },
    { text: 'decode an accented byte pair', input: { hex: 'c3a9' }, output: { result: 'é', bytes: 2, printable: true, note: '' } },
    { text: 'what text do the hex bytes 48656c6c6f spell out', input: { hex: '48656c6c6f' },
      output: { result: 'Hello', bytes: 5, printable: true, note: '' } },
    { text: 'turn this hex back into text', input: { hex: '5069' },
      output: { result: 'Pi', bytes: 2, printable: true, note: '' } }
  ],
  errorCases: [
    { input: { hex: 'zz' }, code: 'INVALID_INPUT' },
    { input: { hex: 'abc' }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' }
  ],
  run (input) {
    let bytes;
    try { bytes = hexToBytes(input.hex); }
    catch (e) { return fail('INVALID_INPUT', `That is not hex I can read — ${e.message}.`, 'hex'); }
    if (!bytes.length) return fail('INVALID_INPUT', 'There are no bytes in that.', 'hex');
    const result = fromBytes(bytes);
    const printable = looksPrintable(result);
    return ok({
      result, bytes: bytes.length, printable,
      note: printable ? '' : ' That decoded to binary rather than readable text.'
    }, computed());
  }
};
