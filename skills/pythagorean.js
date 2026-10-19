import { ok, fail, computed } from '../src/contracts.js';
import { round } from '../src/lib/num.js';

export default {
  name: 'pythagorean',
  description: 'Find a missing side of a right-angled triangle — a ladder\'s length, a diagonal, a hypotenuse — from the other two.',
  category: 'geometry', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: 'The {{solvedFor|prose}} is {{result}} — {{a}}, {{b}} and {{c}} make a right-angled triangle.',
  inputSchema: {
    type: 'object',
    properties: {
      a: { type: 'number', label: 'short side', exclusiveMinimum: 0, description: 'one short side' },
      b: { type: 'number', label: 'other short side', exclusiveMinimum: 0, description: 'the other short side' },
      c: { type: 'number', label: 'hypotenuse', exclusiveMinimum: 0, description: 'the hypotenuse' }
    }
  },
  outputSchema: { type: 'object', properties: { result: { type: 'number' }, a: { type: 'number' }, b: { type: 'number' }, c: { type: 'number' }, solvedFor: { type: 'string' }, area: { type: 'number' }, perimeter: { type: 'number' }, wholeNumbers: { type: 'boolean' } } },
  examples: [
    { text: 'hypotenuse of a triangle with sides 3 and 4', input: { a: 3, b: 4 }, output: { result: 5, a: 3, b: 4, c: 5, solvedFor: 'hypotenuse', area: 6, perimeter: 12, wholeNumbers: true } },
    { text: 'find the missing side if the hypotenuse is 13 and one side is 5', input: { a: 5, c: 13 }, output: { result: 12, a: 5, b: 12, c: 13, solvedFor: 'other short side', area: 30, perimeter: 30, wholeNumbers: true } },
    { text: 'diagonal of a 1920 by 1080 screen', input: { a: 1920, b: 1080 }, output: { result: 2202.9072, a: 1920, b: 1080, c: 2202.9072, solvedFor: 'hypotenuse', area: 1036800, perimeter: 5202.9072, wholeNumbers: false } },
    { text: 'right triangle with legs 6 and 8', input: { a: 6, b: 8 }, output: { result: 10, a: 6, b: 8, c: 10, solvedFor: 'hypotenuse', area: 24, perimeter: 24, wholeNumbers: true } },
    { text: 'missing leg with hypotenuse 10 and side 6', input: { b: 6, c: 10 }, output: { result: 8, a: 8, b: 6, c: 10, solvedFor: 'other short side', area: 24, perimeter: 24, wholeNumbers: true } },
    { text: 'ladder length if the wall is 12 and the base is 5', input: { a: 12, b: 5 },
      output: { result: 13, a: 12, b: 5, c: 13, solvedFor: 'hypotenuse', area: 30, perimeter: 30, wholeNumbers: true } },
    { text: 'diagonal of a 6 by 8 rectangle', input: { a: 6, b: 8 },
      output: { result: 10, a: 6, b: 8, c: 10, solvedFor: 'hypotenuse', area: 24, perimeter: 24, wholeNumbers: true } }
  ],
  errorCases: [
    { input: { a: 3 }, code: 'INVALID_INPUT' },
    { input: { a: 5, c: 3 }, code: 'INVALID_INPUT' },
    { input: { a: 3, b: 4, c: 5 }, code: 'INVALID_INPUT' }
  ],
  run (input) {
    const given = ['a', 'b', 'c'].filter(k => input[k] !== undefined);
    if (given.length !== 2) {
      return fail('INVALID_INPUT', `Give me exactly two sides — you gave ${given.length}.`, given.length < 2 ? 'b' : 'c');
    }
    let { a, b, c } = input;
    let solvedFor;
    if (c === undefined) { c = Math.sqrt(a * a + b * b); solvedFor = 'hypotenuse'; }
    else {
      const known = a ?? b;
      /* The hypotenuse is the longest side by definition. A "hypotenuse"
         shorter than a leg is not a triangle, and sqrt of a negative would
         come back NaN rather than saying so. */
      if (c <= known) return fail('INVALID_INPUT', 'The hypotenuse has to be longer than either short side.', 'c');
      const other = Math.sqrt(c * c - known * known);
      if (a === undefined) a = other; else b = other;
      solvedFor = 'other short side';
    }
    const r = (n) => round(n, 4);
    return ok({
      result: r(solvedFor === 'hypotenuse' ? c : (input.a === undefined ? a : b)),
      a: r(a), b: r(b), c: r(c), solvedFor,
      area: r(a * b / 2), perimeter: r(a + b + c),
      wholeNumbers: [a, b, c].every(v => Number.isInteger(round(v, 6)))
    }, computed());
  }
};
