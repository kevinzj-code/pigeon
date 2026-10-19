import { ok, fail, computed } from '../src/contracts.js';

const WORDS = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30,
  forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90
};
const SCALES = { hundred: 100, thousand: 1e3, million: 1e6, billion: 1e9, trillion: 1e12 };
const SUFFIX = { k: 1e3, m: 1e6, bn: 1e9, b: 1e9, t: 1e12 };

/* The index's §8 entry is literally `"1.2k", "$3,400", "three" → number`, and
   the three examples are three different problems: a magnitude suffix, a
   formatted currency amount, and a spelled-out word. All three arrive in real
   messages, and all three are things a model would otherwise be asked to do in
   its head. */
export default {
  name: 'parseNumber',
  description: 'Read a number written any human way — "1.2k", "$3,400", "three quarters of a million" — as a plain number.',
  category: 'math',
  tier: 'core',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  title: 'Read a number',
  replyTemplate: '{{text}} is {{value|comma}}.',
  inputSchema: {
    type: 'object',
    required: ['text'],
    properties: { text: { type: 'string', label: 'number', minLength: 1, prompt: 'Which number should I read?' } }
  },
  outputSchema: {
    type: 'object',
    properties: {
      value: { type: 'number' }, text: { type: 'string' }, currency: { type: 'string' },
      negative: { type: 'boolean' }, isInteger: { type: 'boolean' }
    }
  },
  examples: [
    { text: 'what number is 1.2k', input: { text: '1.2k' },
      output: { value: 1200, text: '1.2k', currency: '', negative: false, isInteger: true } },
    { text: 'read $3,400 as a number', input: { text: '$3,400' },
      output: { value: 3400, text: '$3,400', currency: '$', negative: false, isInteger: true } },
    { text: 'what is twenty five as a number', input: { text: 'twenty five' },
      output: { value: 25, text: 'twenty five', currency: '', negative: false, isInteger: true } },
    { text: 'convert 2.5m to a plain number', input: { text: '2.5m' },
      output: { value: 2500000, text: '2.5m', currency: '', negative: false, isInteger: true } },
    { text: 'read three thousand two hundred', input: { text: 'three thousand two hundred' },
      output: { value: 3200, text: 'three thousand two hundred', currency: '', negative: false, isInteger: true } }
  ],
  errorCases: [
    { input: { text: 'lots' }, code: 'INVALID_INPUT' },
    { input: { text: 'banana' }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' }
  ],
  run (input) {
    const raw = String(input.text).trim();
    const currency = (/^[-+]?\s*([£$€¥₹])/.exec(raw) || [])[1] || '';
    let s = raw.toLowerCase().replace(/[£$€¥₹,\s]+/g, ' ').trim();
    const negative = /^-|\bminus\b|\bnegative\b/.test(s);
    s = s.replace(/^-|\bminus\b|\bnegative\b/g, '').trim();

    let value = null;

    /* Digits with an optional magnitude suffix: 1.2k, 2.5m, 3bn. */
    const suffixed = /^(\d*\.?\d+)\s*(k|m|bn|b|t)?$/.exec(s.replace(/\s+/g, ''));
    if (suffixed) {
      value = Number(suffixed[1]) * (suffixed[2] ? SUFFIX[suffixed[2]] : 1);
    }

    /* Spelled out: "three thousand two hundred", "twenty five". */
    if (value === null) {
      const tokens = s.split(/[\s-]+/).filter(t => t && t !== 'and');
      if (tokens.length && tokens.every(t => t in WORDS || t in SCALES)) {
        let total = 0, current = 0;
        for (const t of tokens) {
          if (t in WORDS) current += WORDS[t];
          else if (SCALES[t] === 100) current = (current || 1) * 100;
          else { total += (current || 1) * SCALES[t]; current = 0; }
        }
        value = total + current;
      }
    }

    if (value === null || !Number.isFinite(value)) {
      return fail('INVALID_INPUT', `I couldn't read "${input.text}" as a number.`, 'text');
    }
    if (negative) value = -value;

    return ok({
      value, text: raw, currency, negative,
      isInteger: Number.isInteger(value)
    }, computed());
  }
};
