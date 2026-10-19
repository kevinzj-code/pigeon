import { ok, fail, computed } from '../src/contracts.js';

export default {
  name: 'isPrime',
  description: 'Say whether a whole number is prime, and give a divisor if it is not.',
  category: 'math', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  title: 'Is it prime',
  replyTemplate: '{{value|comma}} {{verdict|prose}}.',
  inputSchema: {
    type: 'object', required: ['value'],
    properties: { value: { type: 'integer', label: 'number', carry: true, prompt: 'Which whole number?' } }
  },
  outputSchema: { type: 'object', properties: { prime: { type: 'boolean' }, value: { type: 'integer' }, verdict: { type: 'string' }, divisor: { type: 'integer' }, nextPrime: { type: 'integer' } } },
  examples: [
    { text: 'is 97 prime', input: { value: 97 }, output: { prime: true, value: 97, verdict: 'is prime', divisor: 0, nextPrime: 101 } },
    { text: 'is 91 a prime number', input: { value: 91 }, output: { prime: false, value: 91, verdict: 'is not prime — it divides by 7', divisor: 7, nextPrime: 97 } },
    { text: 'is 1 prime', input: { value: 1 }, output: { prime: false, value: 1, verdict: 'is not prime — 1 is neither prime nor composite', divisor: 0, nextPrime: 2 } },
    { text: 'is 7919 prime', input: { value: 7919 }, output: { prime: true, value: 7919, verdict: 'is prime', divisor: 0, nextPrime: 7927 } },
    { text: 'is 2 prime', input: { value: 2 }, output: { prime: true, value: 2, verdict: 'is prime', divisor: 0, nextPrime: 3 } }
  ],
  errorCases: [
    { input: { value: -5 }, code: 'INVALID_INPUT' },
    { input: { value: 2.5 }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' }
  ],
  run (input) {
    const n = input.value;
    if (!Number.isInteger(n)) return fail('INVALID_INPUT', 'Primality only applies to whole numbers.', 'value');
    if (n < 1) return fail('INVALID_INPUT', 'Primality is defined for positive whole numbers.', 'value');
    if (n > 2 ** 40) return fail('INVALID_INPUT', 'That number is too large for me to test by trial division.', 'value');

    /* Trial division up to √n, skipping evens after 2. Fine to a trillion;
       beyond that the skill refuses rather than spinning, because a fast
       primality test is a different skill with different guarantees. */
    const isP = (x) => {
      if (x < 2) return false;
      if (x < 4) return true;
      if (x % 2 === 0) return false;
      for (let i = 3; i * i <= x; i += 2) if (x % i === 0) return false;
      return true;
    };
    const smallestDivisor = (x) => {
      if (x % 2 === 0) return 2;
      for (let i = 3; i * i <= x; i += 2) if (x % i === 0) return i;
      return 0;
    };

    const prime = isP(n);
    let next = n + 1;
    while (!isP(next)) next += 1;
    const divisor = prime || n === 1 ? 0 : smallestDivisor(n);
    return ok({
      prime, value: n,
      verdict: prime ? 'is prime'
        : n === 1 ? 'is not prime — 1 is neither prime nor composite'
          : `is not prime — it divides by ${divisor}`,
      divisor, nextPrime: next
    }, computed());
  }
};
