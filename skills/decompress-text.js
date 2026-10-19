import { ok, fail, computed } from '../src/contracts.js';
import { fromBytes, base64ToBytes, isValidBase64 } from '../src/lib/bytes.js';
import { lzwDecompress } from '../src/lib/lzw.js';

export default {
  name: 'decompressText',
  description: "Unpack a compressed base64 blob back into the text it came from.",
  category: 'encoding', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{text|prose}} — {{compressedBytes}} bytes back to {{originalBytes}}.',
  inputSchema: {
    type: 'object', required: ['compressed'],
    properties: { compressed: { type: 'string', label: 'compressed text', minLength: 1, prompt: 'Which compressed string should I restore?' } }
  },
  outputSchema: { type: 'object', properties: { text: { type: 'string' }, originalBytes: { type: 'integer' }, compressedBytes: { type: 'integer' } } },
  examples: [
    { text: 'decompress this string', input: { compressed: 'AAAAbDoaDKIDgaTOZTebhAczCdBBCBBAIFBINDzgZTkYzQLohAYHBYPCYXDYfEY9FITFoxGo5Eo/D5FDoTJYnIIHF4zGwA==' }, output: { text: 'the pigeon sat on the pigeon perch. the pigeon sat on the pigeon perch. the pigeon sat on the pigeon perch. ', originalBytes: 108, compressedBytes: 70 } },
    { text: 'restore this compressed text', input: { compressed: 'AAAABTQZTYbDeA==' }, output: { text: 'hello', originalBytes: 5, compressedBytes: 10 } },
    { text: 'expand this back out', input: { compressed: 'AAAAKDCYoBAoDBIHBoLCIPAw' }, output: { text: 'abababababababababababababababababababab', originalBytes: 40, compressedBytes: 18 } },
    { text: 'uncompress this list', input: { compressed: 'AAAAJzcYTaZRZAIFBIDA4LCYRB4NCoaZQA==' }, output: { text: 'name,name,name,name,name,name,name,name', originalBytes: 39, compressedBytes: 25 } },
    { text: 'what text does this compressed string hold', input: { compressed: 'AAAAVDgaTOZTebhBAIFBINAYHBYPDIVCIbC4TDopE4lEYhD4rGIe' }, output: { text: 'pigeon pigeon pigeon pigeon pigeon pigeon pigeon pigeon pigeon pigeon pigeon pigeon ', originalBytes: 84, compressedBytes: 39 } }
  ],
  errorCases: [
    { input: { compressed: 'not base64!!' }, code: 'INVALID_INPUT' },
    { input: { compressed: 'AAA=' }, code: 'INVALID_INPUT' },
    { input: { compressed: 'AAAACf////8=' }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' }
  ],
  run (input) {
    const trimmed = String(input.compressed).replace(/\s/g, '');
    if (!isValidBase64(trimmed)) {
      return fail('INVALID_INPUT', 'That is not base64 — a compressed string only contains letters, digits, + and /.', 'compressed');
    }
    let bytes;
    try { bytes = base64ToBytes(trimmed); }
    catch { return fail('INVALID_INPUT', 'That base64 is incomplete, so there is nothing I can unpack from it.', 'compressed'); }
    if (bytes.length < 4) {
      return fail('INVALID_INPUT', 'That is too short to be a compressed string — the first four bytes alone record the original length.', 'compressed');
    }

    try {
      const out = lzwDecompress(bytes);
      return ok({ text: fromBytes(out), originalBytes: out.length, compressedBytes: bytes.length }, computed());
    } catch (e) {
      /* A valid base64 string that is not one of ours decodes to bytes and then
         asks for a dictionary entry that was never built. Better to say the
         string is not a compressed one than to hand back the partial garbage
         decoded before it went wrong. */
      return fail('INVALID_INPUT', `That base64 decodes, but it is not something compressText produced — ${e.message}.`, 'compressed');
    }
  }
};
