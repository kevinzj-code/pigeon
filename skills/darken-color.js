import { ok, fail, computed } from '../src/contracts.js';
import { parseColor, toHex, rgbToHsl, hslToRgb } from '../src/lib/color.js';
import { round } from '../src/lib/num.js';

export default {
  name: 'darkenColor',
  description: "Shade a colour towards black by a percentage.",
  category: 'design', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{original}} darkened by {{by}}% is {{hex}}.',
  inputSchema: {
    type: 'object', required: ['color'],
    properties: {
      color: { type: 'string', label: 'colour', minLength: 3, prompt: 'Which colour?' },
      by: { type: 'number', label: 'darken by %', minimum: 0, maximum: 100, default: 10 }
    }
  },
  outputSchema: { type: 'object', properties: { hex: { type: 'string' }, rgb: { type: 'string' }, original: { type: 'string' }, by: { type: 'number' }, lightness: { type: 'number' }, wasLightness: { type: 'number' }, capped: { type: 'boolean' } } },
  examples: [
    { text: 'darken #2C6E8C by 20%', input: { color: '#2C6E8C', by: 20 }, output: { hex: '#14313E', rgb: 'rgb(20, 49, 62)', original: '#2C6E8C', by: 20, lightness: 16, wasLightness: 36, capped: false } },
    { text: 'make this colour 10% darker', input: { color: '#FF5733' }, output: { hex: '#FF2D00', rgb: 'rgb(255, 45, 0)', original: '#FF5733', by: 10, lightness: 50, wasLightness: 60, capped: false } },
    { text: 'darken white by 50%', input: { color: '#FFFFFF', by: 50 }, output: { hex: '#808080', rgb: 'rgb(128, 128, 128)', original: '#FFFFFF', by: 50, lightness: 50, wasLightness: 100, capped: false } },
    { text: 'darken a colour past black', input: { color: '#111111', by: 50 }, output: { hex: '#000000', rgb: 'rgb(0, 0, 0)', original: '#111111', by: 50, lightness: 0, wasLightness: 7, capped: true } },
    { text: 'darken by nothing', input: { color: '#123456', by: 0 }, output: { hex: '#123456', rgb: 'rgb(18, 52, 86)', original: '#123456', by: 0, lightness: 20, wasLightness: 20, capped: false } }
  ],
  errorCases: [
    { input: { color: 'taupe' }, code: 'INVALID_INPUT' },
    { input: { color: '#fff', by: -5 }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' }
  ],
  run (input) {
    const c = parseColor(input.color);
    if (!c) return fail('INVALID_INPUT', `I couldn't read "${input.color}" as a colour.`, 'color');
    const { h, s, l } = rgbToHsl(c.r, c.g, c.b);
    const target = Math.max(0, l - input.by);
    const rgb = hslToRgb(h, s, target);
    return ok({
      hex: toHex(rgb.r, rgb.g, rgb.b),
      rgb: `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`,
      original: toHex(c.r, c.g, c.b), by: input.by,
      lightness: round(target, 0), wasLightness: round(l, 0),
      capped: l - input.by < 0
    }, computed());
  }
};
