import { ok, fail, computed } from '../src/contracts.js';

export default {
  name: 'convertBase',
  description: 'Write a number in another base — 200 in base 7, 255 as hex, or 1011 back from binary. Any radix from 2 to 36.',
  category: 'conversion', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{input|prose}} in base {{fromBase}} is {{result|prose}} in base {{toBase}}.',
  inputSchema: {
    type: 'object', required: ['value', 'fromBase', 'toBase'],
    properties: {
      value: { type: 'string', label: 'number', minLength: 1, prompt: 'Which number should I convert?' },
      fromBase: { type: 'integer', label: 'from base', minimum: 2, maximum: 36, prompt: 'What base is it in? (2 for binary, 16 for hex)' },
      toBase: { type: 'integer', label: 'to base', minimum: 2, maximum: 36, prompt: 'Which base should I convert to?' }
    }
  },
  outputSchema: { type: 'object', properties: { result: { type: 'string' }, decimal: { type: 'integer' }, input: { type: 'string' }, fromBase: { type: 'integer' }, toBase: { type: 'integer' } } },
  examples: [
    { text: 'convert 255 to hexadecimal', input: { value: '255', fromBase: 10, toBase: 16 }, output: { result: 'FF', decimal: 255, input: '255', fromBase: 10, toBase: 16 } },
    { text: 'what is binary 11111111 in decimal', input: { value: '11111111', fromBase: 2, toBase: 10 }, output: { result: '255', decimal: 255, input: '11111111', fromBase: 2, toBase: 10 } },
    { text: 'convert hex 1A4 to decimal', input: { value: '1A4', fromBase: 16, toBase: 10 }, output: { result: '420', decimal: 420, input: '1A4', fromBase: 16, toBase: 10 } },
    { text: 'write 100 in binary', input: { value: '100', fromBase: 10, toBase: 2 }, output: { result: '1100100', decimal: 100, input: '100', fromBase: 10, toBase: 2 } },
    { text: 'convert 777 octal to hex', input: { value: '777', fromBase: 8, toBase: 16 }, output: { result: '1FF', decimal: 511, input: '777', fromBase: 8, toBase: 16 } }
  ],
  errorCases: [
    { input: { value: '2', fromBase: 2, toBase: 10 }, code: 'INVALID_INPUT' },
    { input: { value: 'ZZ', fromBase: 16, toBase: 10 }, code: 'INVALID_INPUT' },
    { input: { value: '10', fromBase: 10 }, code: 'MISSING_FIELD' }
  ],
  run (input) {
    const raw = String(input.value).trim().replace(/^0[bxo]/i, '');
    /* parseInt is too forgiving — it stops at the first bad digit and returns
       whatever it read, so "2" in base 2 would come back as NaN but "12" would
       come back as 1. Validating the alphabet first is the only way to tell a
       typo from a number. */
    const digits = '0123456789abcdefghijklmnopqrstuvwxyz'.slice(0, input.fromBase);
    const bad = [...raw.toLowerCase()].find(c => !digits.includes(c));
    if (bad !== undefined) {
      return fail('INVALID_INPUT', `"${bad}" is not a digit in base ${input.fromBase}.`, 'value');
    }
    const decimal = parseInt(raw, input.fromBase);
    if (!Number.isFinite(decimal)) return fail('INVALID_INPUT', `I couldn't read "${input.value}" in base ${input.fromBase}.`, 'value');
    if (!Number.isSafeInteger(decimal)) return fail('INVALID_INPUT', 'That number is too large to convert exactly.', 'value');
    return ok({
      result: decimal.toString(input.toBase).toUpperCase(),
      decimal, input: String(input.value), fromBase: input.fromBase, toBase: input.toBase
    }, computed());
  }
};
