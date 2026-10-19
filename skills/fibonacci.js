import { ok, fail, computed } from '../src/contracts.js';

export default {
  name: 'fibonacci',
  description: 'Give the nth Fibonacci number, or the first n of them.',
  category: 'math', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{summary|prose}}',
  inputSchema: {
    type: 'object', required: ['n'],
    properties: {
      n: { type: 'integer', label: 'position or count', minimum: 0, maximum: 1000, prompt: 'Which position in the sequence?' },
      mode: { type: 'string', label: 'mode', enum: ['nth', 'sequence'], default: 'nth' }
    }
  },
  outputSchema: { type: 'object', properties: { result: { type: 'string' }, sequence: { type: 'array', items: { type: 'string' } }, n: { type: 'integer' }, mode: { type: 'string' }, summary: { type: 'string' } } },
  examples: [
    { text: 'what is the 10th fibonacci number', input: { n: 10 }, output: { result: '55', sequence: [], n: 10, mode: 'nth', summary: 'Fibonacci number 10 is 55.' } },
    { text: 'first 8 fibonacci numbers', input: { n: 8, mode: 'sequence' }, output: { result: '13', sequence: ['0', '1', '1', '2', '3', '5', '8', '13'], n: 8, mode: 'sequence', summary: 'The first 8 Fibonacci numbers are 0, 1, 1, 2, 3, 5, 8, 13.' } },
    { text: 'fibonacci number 1', input: { n: 1 }, output: { result: '1', sequence: [], n: 1, mode: 'nth', summary: 'Fibonacci number 1 is 1.' } },
    { text: 'the 50th fibonacci number', input: { n: 50 }, output: { result: '12586269025', sequence: [], n: 50, mode: 'nth', summary: 'Fibonacci number 50 is 12586269025.' } },
    { text: 'fibonacci at position 0', input: { n: 0 }, output: { result: '0', sequence: [], n: 0, mode: 'nth', summary: 'Fibonacci number 0 is 0.' } }
  ],
  errorCases: [
    { input: { n: -1 }, code: 'INVALID_INPUT' },
    { input: { n: 1.5 }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' }
  ],
  run (input) {
    if (!Number.isInteger(input.n) || input.n < 0) return fail('INVALID_INPUT', 'The position has to be a whole number from 0 up.', 'n');
    /* BigInt again, and strings out: F(79) passes MAX_SAFE_INTEGER, and this
       skill is most often asked about exactly the range where a float would
       start rounding. Indexing is F(0)=0, F(1)=1 — stated because the other
       convention exists and the answers differ by one place. */
    const seq = [0n, 1n];
    for (let i = 2; i <= input.n; i++) seq.push(seq[i - 1] + seq[i - 2]);

    if (input.mode === 'sequence') {
      const list = seq.slice(0, Math.max(input.n, 0)).map(String);
      return ok({
        result: list[list.length - 1] ?? '0', sequence: list, n: input.n, mode: 'sequence',
        summary: `The first ${input.n} Fibonacci numbers are ${list.join(', ')}.`
      }, computed());
    }
    const result = String(seq[input.n]);
    return ok({
      result, sequence: [], n: input.n, mode: 'nth',
      summary: `Fibonacci number ${input.n} is ${result}.`
    }, computed());
  }
};
