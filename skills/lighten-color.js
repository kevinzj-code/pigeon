import { ok, fail, computed } from '../src/contracts.js';
import { parseColor, toHex, rgbToHsl, hslToRgb } from '../src/lib/color.js';
import { round } from '../src/lib/num.js';

export default {
  name: 'lightenColor',
  description: "Tint a colour towards white by a percentage.",
  category: 'design', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{original}} lightened by {{by}}% is {{hex}}.',
  inputSchema: {
    type: 'object', required: ['color'],
    properties: {
      color: { type: 'string', label: 'colour', minLength: 3, prompt: 'Which colour?' },
      by: { type: 'number', label: 'lighten by %', minimum: 0, maximum: 100, default: 10 }
    }
  },
  outputSchema: { type: 'object', properties: { hex: { type: 'string' }, rgb: { type: 'string' }, original: { type: 'string' }, by: { type: 'number' }, lightness: { type: 'number' }, wasLightness: { type: 'number' }, capped: { type: 'boolean' } } },
  examples: [
    { text: 'lighten #2C6E8C by 20%', input: { color: '#2C6E8C', by: 20 }, output: { hex: '#55A5C9', rgb: 'rgb(85, 165, 201)', original: '#2C6E8C', by: 20, lightness: 56, wasLightness: 36, capped: false } },
    { text: 'make this colour 10% lighter', input: { color: '#FF5733' }, output: { hex: '#FF8166', rgb: 'rgb(255, 129, 102)', original: '#FF5733', by: 10, lightness: 70, wasLightness: 60, capped: false } },
    { text: 'lighten black by 50%', input: { color: '#000000', by: 50 }, output: { hex: '#808080', rgb: 'rgb(128, 128, 128)', original: '#000000', by: 50, lightness: 50, wasLightness: 0, capped: false } },
    { text: 'lighten a colour past white', input: { color: '#EEEEEE', by: 50 }, output: { hex: '#FFFFFF', rgb: 'rgb(255, 255, 255)', original: '#EEEEEE', by: 50, lightness: 100, wasLightness: 93, capped: true } },
    { text: 'lighten by nothing', input: { color: '#123456', by: 0 }, output: { hex: '#123456', rgb: 'rgb(18, 52, 86)', original: '#123456', by: 0, lightness: 20, wasLightness: 20, capped: false } }
  ],
  errorCases: [
    { input: { color: 'periwinkle' }, code: 'INVALID_INPUT' },
    { input: { color: '#fff', by: 200 }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' }
  ],
  run (input) {
    const c = parseColor(input.color);
    if (!c) return fail('INVALID_INPUT', `I couldn't read "${input.color}" as a colour.`, 'color');
    const { h, s, l } = rgbToHsl(c.r, c.g, c.b);
    /* Lightness moves in HSL, not by scaling RGB — scaling the channels shifts
       the hue as a side effect, so a "lighter blue" comes out a different blue.
       Capping at 100 is reported rather than silent, because asking for more
       than white is a signal the caller's arithmetic is off. */
    const target = Math.min(100, l + input.by);
    const rgb = hslToRgb(h, s, target);
    return ok({
      hex: toHex(rgb.r, rgb.g, rgb.b),
      rgb: `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`,
      original: toHex(c.r, c.g, c.b), by: input.by,
      lightness: round(target, 0), wasLightness: round(l, 0),
      capped: l + input.by > 100
    }, computed());
  }
};
