import { ok, fail, computed } from '../src/contracts.js';
import { round } from '../src/lib/num.js';

const SOLIDS = {
  cube: { needs: ['side'], volume: (i) => i.side ** 3 },
  box: { needs: ['width', 'height', 'depth'], volume: (i) => i.width * i.height * i.depth },
  sphere: { needs: ['radius'], volume: (i) => (4 / 3) * Math.PI * i.radius ** 3 },
  cylinder: { needs: ['radius', 'height'], volume: (i) => Math.PI * i.radius ** 2 * i.height },
  cone: { needs: ['radius', 'height'], volume: (i) => (Math.PI * i.radius ** 2 * i.height) / 3 },
  pyramid: { needs: ['width', 'depth', 'height'], volume: (i) => (i.width * i.depth * i.height) / 3 }
};

export default {
  name: 'volumeOf',
  description: 'Work out the volume of a cube, box, sphere, cylinder, cone or pyramid.',
  category: 'geometry', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: 'The volume of that {{solid|prose}} is {{volume|comma}} cubic units, which is {{litres|comma}} litres if the units are centimetres.',
  inputSchema: {
    type: 'object', required: ['solid'],
    properties: {
      solid: { type: 'string', label: 'solid', enum: Object.keys(SOLIDS), prompt: 'Which solid? (cube, box, sphere, cylinder, cone, pyramid)' },
      side: { type: 'number', label: 'side', exclusiveMinimum: 0 },
      width: { type: 'number', label: 'width', exclusiveMinimum: 0 },
      height: { type: 'number', label: 'height', exclusiveMinimum: 0 },
      depth: { type: 'number', label: 'depth', exclusiveMinimum: 0 },
      radius: { type: 'number', label: 'radius', exclusiveMinimum: 0 }
    }
  },
  outputSchema: { type: 'object', properties: { volume: { type: 'number' }, solid: { type: 'string' }, litres: { type: 'number' }, exact: { type: 'boolean' }, used: { type: 'array', items: { type: 'string' } } } },
  examples: [
    { text: 'volume of a cube with 4cm sides', input: { solid: 'cube', side: 4 }, output: { volume: 64, solid: 'cube', litres: 0.064, exact: true, used: ['side'] } },
    { text: 'volume of a box 10 by 5 by 2', input: { solid: 'box', width: 10, height: 5, depth: 2 }, output: { volume: 100, solid: 'box', litres: 0.1, exact: true, used: ['width', 'height', 'depth'] } },
    { text: 'volume of a sphere with radius 3', input: { solid: 'sphere', radius: 3 }, output: { volume: 113.0973, solid: 'sphere', litres: 0.1131, exact: false, used: ['radius'] } },
    { text: 'volume of a cylinder radius 5 height 10', input: { solid: 'cylinder', radius: 5, height: 10 }, output: { volume: 785.3982, solid: 'cylinder', litres: 0.7854, exact: false, used: ['radius', 'height'] } },
    { text: 'volume of a cone radius 3 height 9', input: { solid: 'cone', radius: 3, height: 9 }, output: { volume: 84.823, solid: 'cone', litres: 0.0848, exact: false, used: ['radius', 'height'] } }
  ],
  errorCases: [
    { input: { solid: 'sphere' }, code: 'MISSING_FIELD' },
    { input: { solid: 'torus', radius: 3 }, code: 'INVALID_INPUT' },
    { input: { solid: 'cylinder', radius: 5 }, code: 'MISSING_FIELD' }
  ],
  run (input) {
    const def = SOLIDS[input.solid];
    if (!def) return fail('INVALID_INPUT', `I don't do the volume of a ${input.solid}.`, 'solid');
    const missing = def.needs.filter(k => input[k] === undefined);
    if (missing.length) {
      return { ok: false, error: { code: 'MISSING_FIELD', field: missing[0], message: `A ${input.solid} needs ${def.needs.join(', ')} — tell me the ${missing.join(' and the ')}.` } };
    }
    const raw = def.volume(input);
    const volume = round(raw, 4);
    /* Litres assuming centimetres, because "how much does it hold" is the
       question behind most volume lookups. Stated as a conditional in the
       reply — the skill does not know what units you used. */
    return ok({
      volume, solid: input.solid, litres: round(raw / 1000, 4),
      exact: volume === raw, used: def.needs
    }, computed());
  }
};
