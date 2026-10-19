import { ok, fail, computed } from '../src/contracts.js';
import { round } from '../src/lib/num.js';

const SHAPES = {
  rectangle: { needs: ['width', 'height'], perimeter: (i) => 2 * (i.width + i.height) },
  square: { needs: ['side'], perimeter: (i) => 4 * i.side },
  circle: { needs: ['radius'], perimeter: (i) => 2 * Math.PI * i.radius },
  triangle: { needs: ['a', 'b', 'c'], perimeter: (i) => i.a + i.b + i.c },
  regularPolygon: { needs: ['side', 'sides'], perimeter: (i) => i.side * i.sides }
};

export default {
  name: 'perimeterOf',
  description: 'Work out the distance round the edge of a shape — its perimeter or circumference, or how much fencing or edging it takes.',
  category: 'geometry', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: 'The {{measure|prose}} of that {{shape|prose}} is {{perimeter|comma}} units.',
  inputSchema: {
    type: 'object', required: ['shape'],
    properties: {
      shape: { type: 'string', label: 'shape', enum: Object.keys(SHAPES), prompt: 'Which shape? (rectangle, square, circle, triangle, regularPolygon)' },
      width: { type: 'number', label: 'width', exclusiveMinimum: 0 },
      height: { type: 'number', label: 'height', exclusiveMinimum: 0 },
      side: { type: 'number', label: 'side', exclusiveMinimum: 0 },
      sides: { type: 'integer', label: 'number of sides', minimum: 3 },
      radius: { type: 'number', label: 'radius', exclusiveMinimum: 0 },
      a: { type: 'number', label: 'side a', exclusiveMinimum: 0 },
      b: { type: 'number', label: 'side b', exclusiveMinimum: 0 },
      c: { type: 'number', label: 'side c', exclusiveMinimum: 0 }
    }
  },
  outputSchema: { type: 'object', properties: { perimeter: { type: 'number' }, shape: { type: 'string' }, measure: { type: 'string' }, exact: { type: 'boolean' } } },
  examples: [
    { text: 'perimeter of a rectangle 8 by 5', input: { shape: 'rectangle', width: 8, height: 5 }, output: { perimeter: 26, shape: 'rectangle', measure: 'perimeter', exact: true } },
    { text: 'circumference of a circle with radius 3', input: { shape: 'circle', radius: 3 }, output: { perimeter: 18.8496, shape: 'circle', measure: 'circumference', exact: false } },
    { text: 'perimeter of a square with 7 metre sides', input: { shape: 'square', side: 7 }, output: { perimeter: 28, shape: 'square', measure: 'perimeter', exact: true } },
    { text: 'perimeter of a triangle with sides 3 4 5', input: { shape: 'triangle', a: 3, b: 4, c: 5 }, output: { perimeter: 12, shape: 'triangle', measure: 'perimeter', exact: true } },
    { text: 'perimeter of a hexagon with 5cm sides', input: { shape: 'regularPolygon', side: 5, sides: 6 }, output: { perimeter: 30, shape: 'regularPolygon', measure: 'perimeter', exact: true } },
    { text: 'how much fencing goes round a 10 by 7 plot', input: { shape: 'rectangle', width: 10, height: 7 },
      output: { perimeter: 34, shape: 'rectangle', measure: 'perimeter', exact: true } },
    { text: 'length of the edge of a square with side 6', input: { shape: 'square', side: 6 },
      output: { perimeter: 24, shape: 'square', measure: 'perimeter', exact: true } }
  ],
  errorCases: [
    { input: { shape: 'circle' }, code: 'MISSING_FIELD' },
    { input: { shape: 'blob', side: 2 }, code: 'INVALID_INPUT' },
    { input: { shape: 'triangle', a: 1, b: 2, c: 10 }, code: 'INVALID_INPUT' }
  ],
  run (input) {
    const def = SHAPES[input.shape];
    if (!def) return fail('INVALID_INPUT', `I don't do the perimeter of a ${input.shape}.`, 'shape');
    const missing = def.needs.filter(k => input[k] === undefined);
    if (missing.length) {
      return { ok: false, error: { code: 'MISSING_FIELD', field: missing[0], message: `A ${input.shape} needs ${def.needs.join(', ')} — tell me the ${missing.join(' and the ')}.` } };
    }
    /* The triangle inequality: no side may be longer than the other two
       together, or the shape does not close. Adding the three numbers anyway
       would return a perimeter for something that cannot exist. */
    if (input.shape === 'triangle') {
      const [a, b, c] = [input.a, input.b, input.c];
      if (a + b <= c || a + c <= b || b + c <= a) {
        return fail('INVALID_INPUT', `Sides ${a}, ${b} and ${c} cannot make a triangle — one is longer than the other two together.`, 'c');
      }
    }
    const raw = def.perimeter(input);
    const perimeter = round(raw, 4);
    return ok({
      perimeter, shape: input.shape,
      measure: input.shape === 'circle' ? 'circumference' : 'perimeter',
      exact: perimeter === raw
    }, computed());
  }
};
