import { ok, fail, computed } from '../src/contracts.js';
import { round } from '../src/lib/num.js';

const SHAPES = {
  rectangle: { needs: ['width', 'height'], area: (i) => i.width * i.height },
  square: { needs: ['side'], area: (i) => i.side ** 2 },
  circle: { needs: ['radius'], area: (i) => Math.PI * i.radius ** 2 },
  triangle: { needs: ['base', 'height'], area: (i) => (i.base * i.height) / 2 },
  trapezoid: { needs: ['base', 'base2', 'height'], area: (i) => ((i.base + i.base2) / 2) * i.height },
  ellipse: { needs: ['radius', 'radius2'], area: (i) => Math.PI * i.radius * i.radius2 },
  parallelogram: { needs: ['base', 'height'], area: (i) => i.base * i.height }
};

export default {
  name: 'areaOf',
  description: 'Work out the space inside a shape — the area of a rectangle, square, circle, triangle, trapezoid, ellipse or parallelogram.',
  category: 'geometry', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: 'The area of that {{shape|prose}} is {{area|comma}} square units.',
  inputSchema: {
    type: 'object', required: ['shape'],
    properties: {
      shape: { type: 'string', label: 'shape', enum: Object.keys(SHAPES), prompt: 'Which shape? (rectangle, square, circle, triangle, trapezoid, ellipse, parallelogram)' },
      width: { type: 'number', label: 'width', exclusiveMinimum: 0 },
      height: { type: 'number', label: 'height', exclusiveMinimum: 0 },
      side: { type: 'number', label: 'side', exclusiveMinimum: 0 },
      radius: { type: 'number', label: 'radius', exclusiveMinimum: 0 },
      radius2: { type: 'number', label: 'second radius', exclusiveMinimum: 0 },
      base: { type: 'number', label: 'base', exclusiveMinimum: 0 },
      base2: { type: 'number', label: 'second base', exclusiveMinimum: 0 }
    }
  },
  outputSchema: { type: 'object', properties: { area: { type: 'number' }, shape: { type: 'string' }, exact: { type: 'boolean' }, used: { type: 'array', items: { type: 'string' } } } },
  examples: [
    { text: 'area of a rectangle 8 by 5', input: { shape: 'rectangle', width: 8, height: 5 }, output: { area: 40, shape: 'rectangle', exact: true, used: ['width', 'height'] } },
    { text: 'area of a circle with radius 3', input: { shape: 'circle', radius: 3 }, output: { area: 28.2743, shape: 'circle', exact: false, used: ['radius'] } },
    { text: 'area of a triangle with base 10 and height 6', input: { shape: 'triangle', base: 10, height: 6 }, output: { area: 30, shape: 'triangle', exact: true, used: ['base', 'height'] } },
    { text: 'area of a square with 7 metre sides', input: { shape: 'square', side: 7 }, output: { area: 49, shape: 'square', exact: true, used: ['side'] } },
    { text: 'area of a trapezoid with parallel sides 4 and 8, height 5', input: { shape: 'trapezoid', base: 4, base2: 8, height: 5 }, output: { area: 30, shape: 'trapezoid', exact: true, used: ['base', 'base2', 'height'] } }
  ],
  errorCases: [
    { input: { shape: 'circle' }, code: 'MISSING_FIELD' },
    { input: { shape: 'dodecahedron', side: 3 }, code: 'INVALID_INPUT' },
    { input: { shape: 'rectangle', width: 5 }, code: 'MISSING_FIELD' }
  ],
  run (input) {
    const def = SHAPES[input.shape];
    if (!def) return fail('INVALID_INPUT', `I don't do the area of a ${input.shape}.`, 'shape');
    /* Which measurements a shape needs depends on the shape, and the schema
       cannot express that — so the requirement is checked here and reported as
       MISSING_FIELD, which the executor turns into a question (§3.3). */
    const missing = def.needs.filter(k => input[k] === undefined);
    if (missing.length) {
      return { ok: false, error: { code: 'MISSING_FIELD', field: missing[0], message: `A ${input.shape} needs ${def.needs.join(' and ')} — tell me the ${missing.join(' and the ')}.` } };
    }
    const raw = def.area(input);
    const area = round(raw, 4);
    return ok({ area, shape: input.shape, exact: area === raw, used: def.needs }, computed());
  }
};
