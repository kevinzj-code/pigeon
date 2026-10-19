import { ok, fail, computed } from '../src/contracts.js';
import { parseColor, toHex } from '../src/lib/color.js';
import { round } from '../src/lib/num.js';

export default {
  name: 'mixColors',
  description: 'Blend two colours together in a proportion you choose.',
  category: 'design', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{weight}}% {{a}} with {{b}} gives {{hex}}.',
  inputSchema: {
    type: 'object', required: ['a', 'b'],
    properties: {
      a: { type: 'string', label: 'first colour', minLength: 3, prompt: 'Which is the first colour?' },
      b: { type: 'string', label: 'second colour', minLength: 3, prompt: 'Which is the second colour?' },
      weight: { type: 'number', label: 'first colour %', minimum: 0, maximum: 100, default: 50, description: 'how much of the first colour, as a percentage' }
    }
  },
  outputSchema: { type: 'object', properties: { hex: { type: 'string' }, rgb: { type: 'string' }, a: { type: 'string' }, b: { type: 'string' }, weight: { type: 'number' }, r: { type: 'integer' }, g: { type: 'integer' }, bChannel: { type: 'integer' } } },
  examples: [
    { text: 'mix red and blue evenly', input: { a: '#FF0000', b: '#0000FF' }, output: { hex: '#BC00BC', rgb: 'rgb(188, 0, 188)', a: '#FF0000', b: '#0000FF', weight: 50, r: 188, g: 0, bChannel: 188 } },
    { text: 'blend these two brand colours', input: { a: '#2C6E8C', b: '#C9A15D' }, output: { hex: '#968B77', rgb: 'rgb(150, 139, 119)', a: '#2C6E8C', b: '#C9A15D', weight: 50, r: 150, g: 139, bChannel: 119 } },
    { text: 'mix 25% white into this colour', input: { a: '#FFFFFF', b: '#2C6E8C', weight: 25 }, output: { hex: '#8EA3B2', rgb: 'rgb(142, 163, 178)', a: '#FFFFFF', b: '#2C6E8C', weight: 25, r: 142, g: 163, bChannel: 178 } },
    { text: 'mix with none of the first colour', input: { a: '#FF0000', b: '#00FF00', weight: 0 }, output: { hex: '#00FF00', rgb: 'rgb(0, 255, 0)', a: '#FF0000', b: '#00FF00', weight: 0, r: 0, g: 255, bChannel: 0 } },
    { text: 'blend black and white', input: { a: '#000000', b: '#FFFFFF' }, output: { hex: '#BCBCBC', rgb: 'rgb(188, 188, 188)', a: '#000000', b: '#FFFFFF', weight: 50, r: 188, g: 188, bChannel: 188 } }
  ],
  errorCases: [
    { input: { a: 'puce', b: '#fff' }, code: 'INVALID_INPUT' },
    { input: { a: '#fff' }, code: 'MISSING_FIELD' },
    { input: { a: '#fff', b: '#000', weight: 150 }, code: 'INVALID_INPUT' }
  ],
  run (input) {
    const ca = parseColor(input.a);
    if (!ca) return fail('INVALID_INPUT', `I couldn't read "${input.a}" as a colour.`, 'a');
    const cb = parseColor(input.b);
    if (!cb) return fail('INVALID_INPUT', `I couldn't read "${input.b}" as a colour.`, 'b');

    /* Mixed in LINEAR light, not in sRGB. Averaging the stored bytes is the
       obvious approach and it is wrong — half-way between black and white
       comes out at #808080, which looks far darker than the midpoint to the
       eye. Undoing the gamma curve, averaging, and reapplying it gives #BCBCBC,
       which is what a painter would call halfway. */
    const toLinear = (v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    const toSrgb = (v) => {
      const c = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
      return Math.round(Math.max(0, Math.min(1, c)) * 255);
    };
    const w = input.weight / 100;
    const mix = (x, y) => toSrgb(toLinear(x) * w + toLinear(y) * (1 - w));
    const r = mix(ca.r, cb.r), g = mix(ca.g, cb.g), b = mix(ca.b, cb.b);

    return ok({
      hex: toHex(r, g, b), rgb: `rgb(${r}, ${g}, ${b})`,
      a: toHex(ca.r, ca.g, ca.b), b: toHex(cb.r, cb.g, cb.b),
      weight: round(input.weight, 2), r, g, bChannel: b
    }, computed());
  }
};
