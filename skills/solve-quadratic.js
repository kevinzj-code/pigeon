import { ok, fail, computed } from '../src/contracts.js';
import { round } from '../src/lib/num.js';

/* Roots of ax² + bx + c = 0.
 *
 * Two things here are deliberate.
 *
 * COMPLEX ROOTS ARE REPORTED, not refused. A negative discriminant is not an
 * error — the equation has two perfectly good roots, they simply are not real.
 * Returning INVALID_INPUT for x² + 1 = 0 would be telling the user their maths
 * is wrong when it is not.
 *
 * a = 0 IS refused, because then it is not a quadratic. It is bx + c = 0, which
 * has one root and is a different question; silently solving the linear case
 * would answer something the user did not ask.
 */
export default {
  name: 'solveQuadratic',
  description: 'Solve a quadratic equation — the roots of ax² + bx + c = 0, real or complex.',
  category: 'math',
  tier: 'extended',
  unbuilt: false,
  needsNetwork: false,
  dataAsOf: null,
  labels: [],
  replyTemplate: '{{equation}} has {{summary|prose}}.',
  inputSchema: {
    type: 'object',
    required: ['a', 'b', 'c'],
    properties: {
      a: { type: 'number', label: 'x² coefficient', prompt: 'What is the x² coefficient (a)?' },
      b: { type: 'number', label: 'x coefficient', prompt: 'What is the x coefficient (b)?' },
      c: { type: 'number', label: 'constant', prompt: 'What is the constant (c)?' }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      equation: { type: 'string' },
      discriminant: { type: 'number' },
      kind: { type: 'string' },
      roots: { type: 'array', items: { type: 'string' } },
      x1: { type: 'number' },
      x2: { type: 'number' },
      vertexX: { type: 'number' },
      vertexY: { type: 'number' },
      summary: { type: 'string' }
    }
  },
  examples: [
    { text: "solve x^2 - 5x + 6 = 0", input: {"a":1,"b":-5,"c":6},
      output: {"equation":"x² − 5x + 6 = 0","discriminant":1,"kind":"two real roots","roots":["2","3"],"x1":2,"x2":3,"vertexX":2.5,"vertexY":-0.25,"summary":"two real roots, x = 2 and x = 3"} },
    { text: "roots of 2x^2 + 4x - 6", input: {"a":2,"b":4,"c":-6},
      output: {"equation":"2x² + 4x − 6 = 0","discriminant":64,"kind":"two real roots","roots":["-3","1"],"x1":-3,"x2":1,"vertexX":-1,"vertexY":-8,"summary":"two real roots, x = -3 and x = 1"} },
    { text: "solve x squared plus 2x plus 1", input: {"a":1,"b":2,"c":1},
      output: {"equation":"x² + 2x + 1 = 0","discriminant":0,"kind":"one repeated root","roots":["-1"],"x1":-1,"x2":-1,"vertexX":-1,"vertexY":0,"summary":"one repeated root, x = -1"} },
    { text: "what are the roots of x^2 + 1", input: {"a":1,"b":0,"c":1},
      output: {"equation":"x² + 1 = 0","discriminant":-4,"kind":"two complex roots","roots":["0 + 1i","0 − 1i"],"x1":0,"x2":0,"vertexX":0,"vertexY":1,"summary":"no real roots — x = 0 + 1i and x = 0 − 1i"} },
    { text: "solve 3x^2 - 2x - 8 = 0", input: {"a":3,"b":-2,"c":-8},
      output: {"equation":"3x² − 2x − 8 = 0","discriminant":100,"kind":"two real roots","roots":["-1.3333","2"],"x1":-1.3333,"x2":2,"vertexX":0.3333,"vertexY":-8.3333,"summary":"two real roots, x = -1.3333 and x = 2"} },
    { text: "quadratic formula for a=1 b=-3 c=-10", input: {"a":1,"b":-3,"c":-10},
      output: {"equation":"x² − 3x − 10 = 0","discriminant":49,"kind":"two real roots","roots":["-2","5"],"x1":-2,"x2":5,"vertexX":1.5,"vertexY":-12.25,"summary":"two real roots, x = -2 and x = 5"} }
  ],
  errorCases: [
    { input: { b: 2, c: 1 }, code: 'MISSING_FIELD' },
    { input: { a: 0, b: 2, c: 1 }, code: 'INVALID_INPUT' },
    { input: { a: 'one', b: 2, c: 1 }, code: 'INVALID_INPUT' }
  ],
  run (input) {
    const { a, b, c } = input;
    if (a === 0) {
      return fail('INVALID_INPUT', 'With a = 0 this is not a quadratic — it is a linear equation, which is a different question.', 'a');
    }

    const d = b * b - 4 * a * c;
    const term = (n) => (Number.isInteger(n) ? String(n) : String(round(n, 4)));
    /* Written the way a person would write it: no "1x²", no "+ 0x". An equation
       echoed back in a form nobody uses reads as though it were misunderstood. */
    const lead = a === 1 ? 'x²' : a === -1 ? '−x²' : `${term(a)}x²`;
    const mid = b === 0 ? '' : ` ${b < 0 ? '−' : '+'} ${Math.abs(b) === 1 ? '' : term(Math.abs(b))}x`;
    const tail = c === 0 ? '' : ` ${c < 0 ? '−' : '+'} ${term(Math.abs(c))}`;
    const equation = `${lead}${mid}${tail} = 0`;

    const vertexX = round(-b / (2 * a), 4);
    const vertexY = round(a * vertexX * vertexX + b * vertexX + c, 4);

    if (d > 0) {
      const r = Math.sqrt(d);
      const x1 = round((-b + r) / (2 * a), 4);
      const x2 = round((-b - r) / (2 * a), 4);
      const [lo, hi] = x1 <= x2 ? [x1, x2] : [x2, x1];
      return ok({
        equation, discriminant: round(d, 4), kind: 'two real roots',
        roots: [term(lo), term(hi)], x1: lo, x2: hi, vertexX, vertexY,
        summary: `two real roots, x = ${term(lo)} and x = ${term(hi)}`
      }, computed());
    }

    if (d === 0) {
      const x = round(-b / (2 * a), 4);
      return ok({
        equation, discriminant: 0, kind: 'one repeated root',
        roots: [term(x)], x1: x, x2: x, vertexX, vertexY,
        summary: `one repeated root, x = ${term(x)}`
      }, computed());
    }

    /* Not an error — the roots exist, they are just off the real line. */
    const re = round(-b / (2 * a), 4);
    const im = round(Math.sqrt(-d) / (2 * Math.abs(a)), 4);
    const pair = [`${term(re)} + ${term(im)}i`, `${term(re)} − ${term(im)}i`];
    return ok({
      equation, discriminant: round(d, 4), kind: 'two complex roots',
      roots: pair, x1: re, x2: re, vertexX, vertexY,
      summary: `no real roots — x = ${pair[0]} and x = ${pair[1]}`
    }, computed());
  }
};
