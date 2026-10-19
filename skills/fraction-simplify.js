import { ok, fail, computed } from '../src/contracts.js';

const gcd = (a, b) => (b ? gcd(b, a % b) : a);

export default {
  name: 'fractionSimplify',
  description: 'Reduce a fraction like 6/8 to its lowest terms.',
  category: 'math', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  title: 'Simplify a fraction',
  replyTemplate: '{{original}} simplifies to {{simplified}} — {{mixed}} as a mixed number, {{decimal}} as a decimal.',
  inputSchema: {
    type: 'object', required: ['fraction'],
    properties: { fraction: { type: 'string', label: 'fraction', minLength: 3, prompt: 'Which fraction should I simplify? Write it as 6/8.' } }
  },
  outputSchema: {
    type: 'object',
    properties: {
      simplified: { type: 'string' }, original: { type: 'string' }, numerator: { type: 'integer' },
      denominator: { type: 'integer' }, mixed: { type: 'string' }, decimal: { type: 'number' },
      alreadySimplest: { type: 'boolean' }
    }
  },
  examples: [
    { text: 'simplify 6/8', input: { fraction: '6/8' }, output: { simplified: '3/4', original: '6/8', numerator: 3, denominator: 4, mixed: '3/4', decimal: 0.75, alreadySimplest: false } },
    { text: 'reduce 100/250 to lowest terms', input: { fraction: '100/250' }, output: { simplified: '2/5', original: '100/250', numerator: 2, denominator: 5, mixed: '2/5', decimal: 0.4, alreadySimplest: false } },
    { text: 'simplify the fraction 7/3', input: { fraction: '7/3' }, output: { simplified: '7/3', original: '7/3', numerator: 7, denominator: 3, mixed: '2 1/3', decimal: 2.333333, alreadySimplest: true } },
    { text: 'reduce -4/8', input: { fraction: '-4/8' }, output: { simplified: '-1/2', original: '-4/8', numerator: -1, denominator: 2, mixed: '-1/2', decimal: -0.5, alreadySimplest: false } },
    { text: 'simplify 9/3', input: { fraction: '9/3' }, output: { simplified: '3/1', original: '9/3', numerator: 3, denominator: 1, mixed: '3', decimal: 3, alreadySimplest: false } }
  ],
  errorCases: [
    { input: { fraction: '5/0' }, code: 'INVALID_INPUT' },
    { input: { fraction: 'half' }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' }
  ],
  run (input) {
    const m = /^\s*(-?\d+)\s*\/\s*(-?\d+)\s*$/.exec(String(input.fraction));
    if (!m) return fail('INVALID_INPUT', 'Write the fraction as two whole numbers with a slash, like 6/8.', 'fraction');
    const n = Number(m[1]);
    let d = Number(m[2]);
    if (d === 0) return fail('INVALID_INPUT', 'A fraction cannot have zero on the bottom.', 'fraction');

    const g = gcd(Math.abs(n), Math.abs(d)) || 1;
    let sn = n / g;
    d /= g;
    /* The sign lives on the numerator. -1/2 and 1/-2 are the same number, and
       only one of them is a form anyone writes down. */
    if (d < 0) { sn = -sn; d = -d; }

    const whole = Math.trunc(Math.abs(sn) / d);
    const rem = Math.abs(sn) % d;
    const sign = sn < 0 ? '-' : '';
    const mixed = rem === 0 ? `${sign}${whole}` : whole ? `${sign}${whole} ${rem}/${d}` : `${sign}${rem}/${d}`;

    return ok({
      simplified: `${sn}/${d}`, original: `${n}/${m[2].trim()}`,
      numerator: sn, denominator: d, mixed,
      decimal: Number((n / Number(m[2])).toFixed(6)),
      alreadySimplest: g === 1 && Number(m[2]) > 0
    }, computed());
  }
};
