import { ok, fail, computed } from '../src/contracts.js';
import { round } from '../src/lib/num.js';

export default {
  name: 'ratioSolve',
  description: 'Solve a proportion when one of the four terms is missing.',
  category: 'math', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{equation}} — the missing term is {{answer}}.',
  inputSchema: {
    type: 'object',
    properties: {
      a: { type: 'number', label: 'first term', description: 'first term' },
      b: { type: 'number', label: 'second term', description: 'second term' },
      c: { type: 'number', label: 'third term', description: 'third term' },
      d: { type: 'number', label: 'fourth term', description: 'fourth term' }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      answer: { type: 'number' }, missing: { type: 'string' },
      equation: { type: 'string' }, ratio: { type: 'number' }
    }
  },
  examples: [
    { text: 'solve this proportion, 3 is to 4 as 9 is to what', input: { a: 3, b: 4, c: 9 }, output: { answer: 12, missing: 'd', equation: '3:4 = 9:12', ratio: 0.75 } },
    { text: 'solve 2 to 5 equals what to 20', input: { a: 2, b: 5, d: 20 }, output: { answer: 8, missing: 'c', equation: '2:5 = 8:20', ratio: 0.4 } },
    { text: 'what to 7 as 6 is to 21', input: { b: 7, c: 6, d: 21 }, output: { answer: 2, missing: 'a', equation: '2:7 = 6:21', ratio: 0.285714 } },
    { text: 'one to two as fifty to what', input: { a: 1, b: 2, c: 50 }, output: { answer: 100, missing: 'd', equation: '1:2 = 50:100', ratio: 0.5 } },
    { text: 'scale a recipe from 4 to 6 servings', input: { a: 4, b: 6, c: 200 }, output: { answer: 300, missing: 'd', equation: '4:6 = 200:300', ratio: 0.666667 } }
  ],
  errorCases: [
    { input: { a: 1, b: 2, c: 3, d: 4 }, code: 'INVALID_INPUT' },
    { input: { a: 1, b: 2 }, code: 'INVALID_INPUT' },
    { input: { a: 0, b: 2, c: 5 }, code: 'INVALID_INPUT' }
  ],
  run (input) {
    const given = ['a', 'b', 'c', 'd'].filter((k) => input[k] !== undefined);
    if (given.length !== 3) {
      return fail('INVALID_INPUT', `A proportion is solved from exactly three of its four terms — you gave ${given.length}.`, 'a');
    }
    const missing = ['a', 'b', 'c', 'd'].find((k) => input[k] === undefined);
    const { a, b, c, d } = input;

    /* a:b = c:d means a·d = b·c. Each unknown is that identity rearranged, and
       each rearrangement divides by a different term — so the zero check has to
       name the one that would actually be the divisor. */
    let answer;
    if (missing === 'd') { if (a === 0) return fail('INVALID_INPUT', 'The first term is zero, so the proportion cannot be solved for the fourth.', 'a'); answer = (b * c) / a; }
    else if (missing === 'c') { if (b === 0) return fail('INVALID_INPUT', 'The second term is zero, so the proportion cannot be solved for the third.', 'b'); answer = (a * d) / b; }
    else if (missing === 'b') { if (c === 0) return fail('INVALID_INPUT', 'The third term is zero, so the proportion cannot be solved for the second.', 'c'); answer = (a * d) / c; }
    else { if (d === 0) return fail('INVALID_INPUT', 'The fourth term is zero, so the proportion cannot be solved for the first.', 'd'); answer = (b * c) / d; }

    answer = round(answer, 10);
    const terms = { a, b, c, d, [missing]: answer };
    return ok({
      answer, missing,
      equation: `${terms.a}:${terms.b} = ${terms.c}:${terms.d}`,
      ratio: round(terms.a / terms.b, 6)
    }, computed());
  }
};
