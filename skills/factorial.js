import { ok, fail, computed } from '../src/contracts.js';

export default {
  name: 'factorial',
  description: 'Work out a factorial — multiply every whole number from 1 up to n together.',
  category: 'math', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{n}}! is {{result|prose}} ({{digits}} digits).',
  inputSchema: {
    type: 'object', required: ['n'],
    properties: { n: { type: 'integer', label: 'number', minimum: 0, maximum: 5000, prompt: 'Factorial of which number?' } }
  },
  outputSchema: { type: 'object', properties: { result: { type: 'string' }, n: { type: 'integer' }, digits: { type: 'integer' }, exact: { type: 'boolean' } } },
  examples: [
    { text: 'what is 10 factorial', input: { n: 10 }, output: { result: '3628800', n: 10, digits: 7, exact: true } },
    { text: 'work out 5 factorial', input: { n: 5 }, output: { result: '120', n: 5, digits: 3, exact: true } },
    { text: 'factorial of 0', input: { n: 0 }, output: { result: '1', n: 0, digits: 1, exact: true } },
    { text: 'how big is 20 factorial', input: { n: 20 }, output: { result: '2432902008176640000', n: 20, digits: 19, exact: true } },
    { text: 'work out 25 factorial', input: { n: 25 }, output: { result: '15511210043330985984000000', n: 25, digits: 26, exact: true } },
    { text: 'what is 1 times 2 times 3 all the way up to 6', input: { n: 6 },
      output: { result: '720', n: 6, digits: 3, exact: true } },
    { text: 'the product of every whole number up to 7', input: { n: 7 },
      output: { result: '5040', n: 7, digits: 4, exact: true } }
  ],
  errorCases: [
    { input: { n: -3 }, code: 'INVALID_INPUT' },
    { input: { n: 2.5 }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' }
  ],
  run (input) {
    if (!Number.isInteger(input.n) || input.n < 0) return fail('INVALID_INPUT', 'Factorial is defined for whole numbers from 0 up.', 'n');
    /* BigInt, and the result is returned as a STRING. 21! already exceeds
       Number.MAX_SAFE_INTEGER, so a number here would be silently wrong for
       most of the range this skill is asked about — and silently wrong is the
       one outcome the whole project is built to avoid. */
    let acc = 1n;
    for (let i = 2n; i <= BigInt(input.n); i++) acc *= i;
    const result = acc.toString();
    return ok({ result, n: input.n, digits: result.length, exact: true }, computed());
  }
};
