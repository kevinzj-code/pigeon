import { ok, fail, computed } from '../src/contracts.js';

export default {
  name: 'binaryDecode',
  description: "Read a run of 1s and 0s back into the message it spells.",
  category: 'encoding', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{text|prose}} — from {{byteCount}} {{byteCount|plural:byte:bytes}}, {{bitCount}} bits.',
  inputSchema: {
    type: 'object', required: ['binary'],
    properties: { binary: { type: 'string', label: 'binary', minLength: 1, prompt: 'Which binary digits should I decode?' } }
  },
  outputSchema: { type: 'object', properties: { text: { type: 'string' }, byteCount: { type: 'integer' }, bitCount: { type: 'integer' } } },
  examples: [
    { text: 'decode this binary', input: { binary: '01000001' }, output: { text: 'A', byteCount: 1, bitCount: 8 } },
    { text: 'what does this binary say', input: { binary: '01001000 01101001' }, output: { text: 'Hi', byteCount: 2, bitCount: 16 } },
    { text: 'turn these bits back into text', input: { binary: '01101000 01100101 01101100 01101100 01101111' }, output: { text: 'hello', byteCount: 5, bitCount: 40 } },
    { text: 'decode binary written without spaces', input: { binary: '010100000110100101100111011001010110111101101110' }, output: { text: 'Pigeon', byteCount: 6, bitCount: 48 } },
    { text: 'decode binary that spells an accented letter', input: { binary: '11000011 10101001' }, output: { text: 'é', byteCount: 2, bitCount: 16 } },
    { text: 'these ones and zeros spell what', input: { binary: '01001000 01101001' },
      output: { text: 'Hi', byteCount: 2, bitCount: 16 } },
    { text: 'read this string of bits as text', input: { binary: '01000010' },
      output: { text: 'B', byteCount: 1, bitCount: 8 } }
  ],
  errorCases: [
    { input: { binary: '0100000' }, code: 'INVALID_INPUT' },
    { input: { binary: '01020101' }, code: 'INVALID_INPUT' },
    { input: { binary: '11111111' }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' }
  ],
  run (input) {
    const bits = String(input.binary).replace(/[\s,_.:|-]+/g, '');
    if (!bits.length) return fail('INVALID_INPUT', 'There are no binary digits in that.', 'binary');
    const stray = /[^01]/.exec(bits);
    if (stray) return fail('INVALID_INPUT', `Binary is only 0s and 1s — I found "${stray[0]}".`, 'binary');
    if (bits.length % 8 !== 0) {
      /* Reported as digits SHORT rather than digits over: "7 past a byte" and
         "1 short of a byte" describe the same 7 digits, and only one of them
         tells you what to type next. */
      const short = 8 - (bits.length % 8);
      return fail('INVALID_INPUT', `Binary text comes in groups of eight — this has ${bits.length} digits, ${short} short of a whole number of bytes.`, 'binary');
    }

    const bytes = new Uint8Array(bits.length / 8);
    for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);

    /* fatal: true on purpose. The lenient decoder turns bytes that are not
       valid UTF-8 into replacement characters, which looks like a successful
       decode of text nobody wrote. Better to say the bits are not text. */
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      return ok({ text, byteCount: bytes.length, bitCount: bits.length }, computed());
    } catch {
      return fail('INVALID_INPUT', 'Those bits are a valid run of bytes, but they do not spell text — nothing in UTF-8 looks like that.', 'binary');
    }
  }
};
