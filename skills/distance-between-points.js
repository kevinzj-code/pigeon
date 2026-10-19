import { ok, computed } from '../src/contracts.js';
import { round } from '../src/lib/num.js';

export default {
  name: 'distanceBetweenPoints',
  description: 'Work out the straight-line distance between two points on a plane or in space.',
  category: 'geometry', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: 'The distance is {{distance}} — {{dimensions}} dimensions, midpoint {{midpointText|prose}}.',
  inputSchema: {
    type: 'object', required: ['x1', 'y1', 'x2', 'y2'],
    properties: {
      x1: { type: 'number', label: 'first x', prompt: 'What is the first x?' },
      y1: { type: 'number', label: 'first y', prompt: 'What is the first y?' },
      x2: { type: 'number', label: 'second x', prompt: 'What is the second x?' },
      y2: { type: 'number', label: 'second y', prompt: 'What is the second y?' },
      z1: { type: 'number', label: 'first z', description: 'the first z, for a 3D distance' },
      z2: { type: 'number', label: 'second z', description: 'the second z' }
    }
  },
  outputSchema: { type: 'object', properties: { distance: { type: 'number' }, dimensions: { type: 'integer' }, dx: { type: 'number' }, dy: { type: 'number' }, dz: { type: 'number' }, midpointText: { type: 'string' }, manhattan: { type: 'number' } } },
  examples: [
    { text: 'distance between (0,0) and (3,4)', input: { x1: 0, y1: 0, x2: 3, y2: 4 }, output: { distance: 5, dimensions: 2, dx: 3, dy: 4, dz: 0, midpointText: '(1.5, 2)', manhattan: 7 } },
    { text: 'how far apart are these two points', input: { x1: 1, y1: 1, x2: 4, y2: 5 }, output: { distance: 5, dimensions: 2, dx: 3, dy: 4, dz: 0, midpointText: '(2.5, 3)', manhattan: 7 } },
    { text: 'distance in 3d space', input: { x1: 0, y1: 0, z1: 0, x2: 1, y2: 2, z2: 2 }, output: { distance: 3, dimensions: 3, dx: 1, dy: 2, dz: 2, midpointText: '(0.5, 1, 1)', manhattan: 5 } },
    { text: 'distance between identical points', input: { x1: 5, y1: 5, x2: 5, y2: 5 }, output: { distance: 0, dimensions: 2, dx: 0, dy: 0, dz: 0, midpointText: '(5, 5)', manhattan: 0 } },
    { text: 'distance with negative coordinates', input: { x1: -3, y1: -4, x2: 0, y2: 0 }, output: { distance: 5, dimensions: 2, dx: 3, dy: 4, dz: 0, midpointText: '(-1.5, -2)', manhattan: 7 } }
  ],
  errorCases: [
    { input: { x1: 0, y1: 0, x2: 1 }, code: 'MISSING_FIELD' },
    { input: { x1: 'a', y1: 0, x2: 1, y2: 1 }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' }
  ],
  run (input) {
    /* 3D only when BOTH z values are given — one alone is an incomplete point,
       and defaulting the other to zero would silently invent a coordinate. */
    const is3d = input.z1 !== undefined && input.z2 !== undefined;
    const dx = input.x2 - input.x1;
    const dy = input.y2 - input.y1;
    const dz = is3d ? input.z2 - input.z1 : 0;
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const mid = [round((input.x1 + input.x2) / 2, 4), round((input.y1 + input.y2) / 2, 4)];
    if (is3d) mid.push(round((input.z1 + input.z2) / 2, 4));
    return ok({
      distance: round(distance, 4), dimensions: is3d ? 3 : 2,
      dx: round(Math.abs(dx), 4), dy: round(Math.abs(dy), 4), dz: round(Math.abs(dz), 4),
      midpointText: `(${mid.join(', ')})`,
      /* Manhattan distance too — the "how far by the grid" reading, which is
         the right one for city blocks and board games. */
      manhattan: round(Math.abs(dx) + Math.abs(dy) + Math.abs(dz), 4)
    }, computed());
  }
};
