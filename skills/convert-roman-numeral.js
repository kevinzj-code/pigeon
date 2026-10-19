import { ok, fail, computed } from '../src/contracts.js';

const PAIRS = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
  [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
const VALUE = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };

export default {
  name: 'convertRomanNumeral',
  description: 'Convert a number to Roman numerals, or read Roman numerals back as a number.',
  category: 'conversion', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{input|prose}} is {{result|prose}}.',
  inputSchema: {
    type: 'object', required: ['value'],
    properties: { value: { type: 'string', label: 'number or numeral', minLength: 1, prompt: 'Which number or numeral? (e.g. 2026 or MMXXVI)' } }
  },
  outputSchema: { type: 'object', properties: { result: { type: 'string' }, input: { type: 'string' }, number: { type: 'integer' }, direction: { type: 'string' } } },
  examples: [
    { text: 'what is 2026 in roman numerals', input: { value: '2026' }, output: { result: 'MMXXVI', input: '2026', number: 2026, direction: 'to numerals' } },
    { text: 'read MCMLXXXIV', input: { value: 'MCMLXXXIV' }, output: { result: '1984', input: 'MCMLXXXIV', number: 1984, direction: 'to number' } },
    { text: 'roman numeral for 4', input: { value: '4' }, output: { result: 'IV', input: '4', number: 4, direction: 'to numerals' } },
    { text: 'what number is XLII', input: { value: 'XLII' }, output: { result: '42', input: 'XLII', number: 42, direction: 'to number' } },
    { text: 'write 3999 as roman numerals', input: { value: '3999' }, output: { result: 'MMMCMXCIX', input: '3999', number: 3999, direction: 'to numerals' } }
  ],
  errorCases: [
    { input: { value: '0' }, code: 'INVALID_INPUT' },
    { input: { value: 'IIII' }, code: 'INVALID_INPUT' },
    { input: { value: 'hello' }, code: 'INVALID_INPUT' }
  ],
  run (input) {
    const raw = String(input.value).trim().toUpperCase();

    if (/^\d+$/.test(raw)) {
      const n = Number(raw);
      /* 1–3999. There is no standard numeral for zero, and 4000+ needs the
         overbar notation this skill does not do — so it refuses rather than
         emitting MMMM, which is not valid. */
      if (n < 1 || n > 3999) return fail('INVALID_INPUT', 'Roman numerals run from 1 to 3999.', 'value');
      let left = n, out = '';
      for (const [v, sym] of PAIRS) while (left >= v) { out += sym; left -= v; }
      return ok({ result: out, input: raw, number: n, direction: 'to numerals' }, computed());
    }

    if (!/^[IVXLCDM]+$/.test(raw)) {
      return fail('INVALID_INPUT', `"${input.value}" is neither a number nor a Roman numeral.`, 'value');
    }
    let total = 0;
    for (let i = 0; i < raw.length; i++) {
      const v = VALUE[raw[i]];
      total += v < VALUE[raw[i + 1]] ? -v : v;
    }
    /* Round-tripping is the validity check: IIII reads as 4, but 4 writes back
       as IV, so IIII is not a well-formed numeral and is refused rather than
       quietly accepted. */
    let left = total, canonical = '';
    for (const [v, sym] of PAIRS) while (left >= v) { canonical += sym; left -= v; }
    if (canonical !== raw) {
      return fail('INVALID_INPUT', `"${raw}" isn't a well-formed numeral — ${total} is written ${canonical}.`, 'value');
    }
    return ok({ result: String(total), input: raw, number: total, direction: 'to number' }, computed());
  }
};
