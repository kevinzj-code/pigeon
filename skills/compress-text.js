import { ok, computed } from '../src/contracts.js';
import { toBytes, bytesToBase64 } from '../src/lib/bytes.js';
import { lzwCompress } from '../src/lib/lzw.js';
import { round } from '../src/lib/num.js';

export default {
  name: 'compressText',
  description: "Squash text down into a shorter base64 string to store or send.",
  category: 'encoding', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{compressed|prose}} — {{originalBytes}} bytes in, {{compressedBytes}} out ({{verdict}}).',
  inputSchema: {
    type: 'object', required: ['text'],
    properties: { text: { type: 'string', label: 'text', minLength: 1, maxLength: 100000, prompt: 'Which text should I compress?' } }
  },
  outputSchema: {
    type: 'object',
    properties: {
      compressed: { type: 'string' }, originalBytes: { type: 'integer' },
      compressedBytes: { type: 'integer' }, savedPercent: { type: 'number' }, verdict: { type: 'string' }
    }
  },
  examples: [
    { text: 'compress this repeated sentence', input: { text: 'the pigeon sat on the pigeon perch. the pigeon sat on the pigeon perch. the pigeon sat on the pigeon perch. ' }, output: { compressed: 'AAAAbDoaDKIDgaTOZTebhAczCdBBCBBAIFBINDzgZTkYzQLohAYHBYPCYXDYfEY9FITFoxGo5Eo/D5FDoTJYnIIHF4zGwA==', originalBytes: 108, compressedBytes: 70, savedPercent: 35.2, verdict: '35.2% smaller' } },
    { text: 'compress a short word', input: { text: 'hello' }, output: { compressed: 'AAAABTQZTYbDeA==', originalBytes: 5, compressedBytes: 10, savedPercent: -100, verdict: '100% larger' } },
    { text: 'shrink this repeating pattern', input: { text: 'abababababababababababababababababababab' }, output: { compressed: 'AAAAKDCYoBAoDBIHBoLCIPAw', originalBytes: 40, compressedBytes: 18, savedPercent: 55, verdict: '55% smaller' } },
    { text: 'compress a repeated list of names', input: { text: 'name,name,name,name,name,name,name,name' }, output: { compressed: 'AAAAJzcYTaZRZAIFBIDA4LCYRB4NCoaZQA==', originalBytes: 39, compressedBytes: 25, savedPercent: 35.9, verdict: '35.9% smaller' } },
    { text: 'make this repeated word smaller', input: { text: 'pigeon pigeon pigeon pigeon pigeon pigeon pigeon pigeon pigeon pigeon pigeon pigeon ' }, output: { compressed: 'AAAAVDgaTOZTebhBAIFBINAYHBYPDIVCIbC4TDopE4lEYhD4rGIe', originalBytes: 84, compressedBytes: 39, savedPercent: 53.6, verdict: '53.6% smaller' } },
    { text: 'squash this text down to something shorter', input: { text: 'pigeon pigeon pigeon pigeon pigeon pigeon pigeon pigeon' },
      output: { compressed: 'AAAANzgaTOZTebhBAIFBINAYHBYPDIVCIbC4TDopEzcA', originalBytes: 55, compressedBytes: 33, savedPercent: 40, verdict: '40% smaller' } },
    { text: 'shrink this block of text', input: { text: 'the rain in spain stays mainly in the plain. the rain in spain stays mainly in the plain. ' },
      output: { compressed: 'AAAAWjoaDKIDkYTSbhBBhAczhBYOczoYTycxAbYabDzCIPAIEcDZDRcII3A4bGYVDITD4jE4rBovJZFHY+IA', originalBytes: 90, compressedBytes: 63, savedPercent: 30, verdict: '30% smaller' } }
  ],
  errorCases: [
    { input: {}, code: 'MISSING_FIELD' },
    { input: { text: '' }, code: 'MISSING_FIELD' },
    { input: { text: 'x'.repeat(100001) }, code: 'INVALID_INPUT' }
  ],
  run (input) {
    const bytes = toBytes(input.text);
    const packed = lzwCompress(bytes);
    const savedPercent = round((1 - packed.length / bytes.length) * 100, 1);
    /* Short or varied text comes out BIGGER — every scheme has inputs it cannot
       help, and the four-byte length header alone costs more than a short word
       can save. Saying "100% larger" is the honest reading of that, and hiding
       it behind a ratio of 2.0 would not be. */
    const verdict = savedPercent > 0 ? `${savedPercent}% smaller`
      : savedPercent < 0 ? `${Math.abs(savedPercent)}% larger`
        : 'the same size';
    return ok({
      compressed: bytesToBase64(packed), originalBytes: bytes.length,
      compressedBytes: packed.length, savedPercent, verdict
    }, computed());
  }
};
