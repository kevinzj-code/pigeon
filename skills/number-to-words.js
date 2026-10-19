import { ok, fail, computed } from '../src/contracts.js';

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const SCALES = [[1e12, 'trillion'], [1e9, 'billion'], [1e6, 'million'], [1e3, 'thousand']];
/* The hundredths of a currency, by the name it was given. Pounds have pence and
   rupees paise; the dollars, euros and most others written in words have cents. */
const MINOR = { pound: 'pence', pounds: 'pence', sterling: 'pence', rupee: 'paise', rupees: 'paise' };

function under1000 (n) {
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : '');
  const rest = n % 100;
  return `${ONES[Math.floor(n / 100)]} hundred${rest ? ` and ${under1000(rest)}` : ''}`;
}

export default {
  name: 'numberToWords',
  description: 'Spell a number out in English words, the way it is said aloud or written on a cheque.',
  category: 'conversion', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{value|comma}} in words is {{words|prose}}.',
  inputSchema: {
    type: 'object', required: ['value'],
    properties: {
      value: { type: 'number', label: 'number', carry: true, prompt: 'Which number should I write out?' },
      style: { type: 'string', label: 'plain or money', enum: ['plain', 'currency'], default: 'plain' },
      currency: { type: 'string', label: 'currency name', default: 'pounds' }
    }
  },
  outputSchema: { type: 'object', properties: { words: { type: 'string' }, value: { type: 'number' }, style: { type: 'string' } } },
  examples: [
    { text: 'write 1234 in words', input: { value: 1234 }, output: { words: 'one thousand two hundred and thirty-four', value: 1234, style: 'plain' } },
    { text: 'spell out 42', input: { value: 42 }, output: { words: 'forty-two', value: 42, style: 'plain' } },
    { text: 'write 1000000 in words', input: { value: 1000000 }, output: { words: 'one million', value: 1000000, style: 'plain' } },
    { text: 'write 105.50 as words for a cheque', input: { value: 105.5, style: 'currency', currency: 'pounds' }, output: { words: 'one hundred and five pounds and fifty pence', value: 105.5, style: 'currency' } },
    { text: 'spell out negative 17', input: { value: -17 }, output: { words: 'minus seventeen', value: -17, style: 'plain' } }
  ],
  errorCases: [
    { input: { value: 1e18 }, code: 'INVALID_INPUT' },
    { input: { value: 'lots' }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' }
  ],
  run (input) {
    const v = input.value;
    if (!Number.isFinite(v)) return fail('INVALID_INPUT', 'That is not a number I can write out.', 'value');
    if (Math.abs(v) >= 1e15) return fail('INVALID_INPUT', 'That number is larger than I have words for.', 'value');

    const spell = (n) => {
      if (n === 0) return 'zero';
      let out = '';
      for (const [size, name] of SCALES) {
        if (n >= size) {
          out += `${out ? ' ' : ''}${spell(Math.floor(n / size))} ${name}`;
          n %= size;
        }
      }
      /* British "and": two hundred AND five, one thousand two hundred and
         thirty-four. The hundreds branch inserts it; this one covers a
         remainder under 100 after a scale word. */
      if (n) out += `${out ? (n < 100 ? ' and ' : ' ') : ''}${under1000(n)}`;
      return out;
    };

    const neg = v < 0;
    const abs = Math.abs(v);
    let words;
    if (input.style === 'currency') {
      const whole = Math.floor(abs);
      const minor = Math.round((abs - whole) * 100);
      words = `${spell(whole)} ${input.currency}`;
      if (minor) words += ` and ${spell(minor)} ${MINOR[String(input.currency).trim().toLowerCase()] || 'cents'}`;
    } else {
      const whole = Math.floor(abs);
      words = spell(whole);
      const frac = String(abs).split('.')[1];
      if (frac) words += ` point ${[...frac].map(d => ONES[Number(d)]).join(' ')}`;
    }
    return ok({ words: (neg ? 'minus ' : '') + words, value: v, style: input.style }, computed());
  }
};
