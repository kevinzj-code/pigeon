import { ok, fail, computed } from '../src/contracts.js';
import { base64ToBytes, fromBytes, isValidBase64, looksPrintable } from '../src/lib/bytes.js';

export default {
  name: 'base64Decode',
  description: "Decode plain base64 back into readable text — un-base64 a string.",
  category: 'encoding', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{result|prose}}',
  inputSchema: {
    type: 'object', required: ['base64'],
    properties: { base64: { type: 'string', label: 'base64', minLength: 1, prompt: 'Which base64 should I decode?' } }
  },
  outputSchema: { type: 'object', properties: { result: { type: 'string' }, bytes: { type: 'integer' }, printable: { type: 'boolean' }, note: { type: 'string' } } },
  examples: [
    { text: 'decode aGVsbG8gd29ybGQ=', input: { base64: 'aGVsbG8gd29ybGQ=' }, output: { result: 'hello world', bytes: 11, printable: true, note: '' } },
    { text: 'what does UGlnZW9u say', input: { base64: 'UGlnZW9u' }, output: { result: 'Pigeon', bytes: 6, printable: true, note: '' } },
    { text: 'decode an accented base64 string', input: { base64: 'Y2Fmw6k=' }, output: { result: 'café', bytes: 5, printable: true, note: '' } },
    { text: 'decode url-safe base64 with no padding', input: { base64: 'YT9iPmM' }, output: { result: 'a?b>c', bytes: 5, printable: true, note: '' } },
    { text: 'decode QQ==', input: { base64: 'QQ==' }, output: { result: 'A', bytes: 1, printable: true, note: '' } },
    { text: 'decode this base64 blob: UGlnZW9u', input: { base64: 'UGlnZW9u' },
      output: { result: 'Pigeon', bytes: 6, printable: true, note: '' } },
    { text: 'turn base64 back into plain text: aGk=', input: { base64: 'aGk=' },
      output: { result: 'hi', bytes: 2, printable: true, note: '' } }
  ],
  errorCases: [
    { input: { base64: 'not base64!!' }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' },
    { input: { base64: '' }, code: 'MISSING_FIELD' }
  ],
  run (input) {
    if (!isValidBase64(input.base64)) {
      return fail('INVALID_INPUT', 'That contains characters base64 does not use.', 'base64');
    }
    let bytes;
    try { bytes = base64ToBytes(input.base64); }
    catch { return fail('INVALID_INPUT', 'That is not validly padded base64.', 'base64'); }
    const result = fromBytes(bytes);
    const printable = looksPrintable(result);
    return ok({
      result, bytes: bytes.length, printable,
      /* Base64 often carries binary rather than text. Saying so stops a wall of
         replacement characters from being read as the answer. */
      note: printable ? '' : ' That decoded to binary rather than readable text.'
    }, computed());
  }
};
