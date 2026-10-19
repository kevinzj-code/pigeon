import { ok, fail, computed } from '../src/contracts.js';

export default {
  name: 'primeFactors',
  description: 'Break a whole number down into the prime numbers it is made of.',
  category: 'math', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{value|comma}} = {{expression|prose}}',
  inputSchema: {
    type: 'object', required: ['value'],
    properties: { value: { type: 'integer', label: 'number', carry: true, minimum: 2, prompt: 'Which whole number should I factor?' } }
  },
  outputSchema: { type: 'object', properties: { factors: { type: 'array', items: { type: 'integer' } }, unique: { type: 'array', items: { type: 'integer' } }, expression: { type: 'string' }, value: { type: 'integer' }, prime: { type: 'boolean' }, divisorCount: { type: 'integer' } } },
  examples: [
    { text: 'prime factors of 360', input: { value: 360 }, output: { factors: [2, 2, 2, 3, 3, 5], unique: [2, 3, 5], expression: '2³ × 3² × 5', value: 360, prime: false, divisorCount: 24 } },
    { text: 'factorise 84', input: { value: 84 }, output: { factors: [2, 2, 3, 7], unique: [2, 3, 7], expression: '2² × 3 × 7', value: 84, prime: false, divisorCount: 12 } },
    { text: 'what are the prime factors of 97', input: { value: 97 }, output: { factors: [97], unique: [97], expression: '97', value: 97, prime: true, divisorCount: 2 } },
    { text: 'break 1024 into primes', input: { value: 1024 }, output: { factors: [2, 2, 2, 2, 2, 2, 2, 2, 2, 2], unique: [2], expression: '2¹⁰', value: 1024, prime: false, divisorCount: 11 } },
    { text: 'prime factorisation of 100', input: { value: 100 }, output: { factors: [2, 2, 5, 5], unique: [2, 5], expression: '2² × 5²', value: 100, prime: false, divisorCount: 9 } }
  ],
  errorCases: [
    { input: { value: 1 }, code: 'INVALID_INPUT' },
    { input: { value: 12.5 }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' }
  ],
  run (input) {
    let n = input.value;
    if (!Number.isInteger(n) || n < 2) return fail('INVALID_INPUT', 'Factorisation starts at 2.', 'value');
    if (n > 2 ** 45) return fail('INVALID_INPUT', 'That number is too large for me to factor by trial division.', 'value');

    const factors = [];
    for (let d = 2; d * d <= n; d += (d === 2 ? 1 : 2)) {
      while (n % d === 0) { factors.push(d); n /= d; }
    }
    if (n > 1) factors.push(n);

    const counts = new Map();
    for (const f of factors) counts.set(f, (counts.get(f) ?? 0) + 1);
    const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹';
    const sup = (k) => String(k).split('').map(c => SUP[Number(c)]).join('');
    return ok({
      factors, unique: [...counts.keys()],
      expression: [...counts].map(([f, k]) => (k === 1 ? String(f) : `${f}${sup(k)}`)).join(' × '),
      value: input.value, prime: factors.length === 1,
      /* The number of divisors follows from the exponents: (a+1)(b+1)… — a
         free extra that people asking about factors usually want next. */
      divisorCount: [...counts.values()].reduce((acc, k) => acc * (k + 1), 1)
    }, computed());
  }
};
