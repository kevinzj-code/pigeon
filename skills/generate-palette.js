import { ok, fail, computed } from '../src/contracts.js';
import { parseColor, toHex, rgbToHsl, hslToRgb } from '../src/lib/color.js';

const SCHEMES = {
  analogous: [-30, 0, 30],
  triadic: [0, 120, 240],
  complementary: [0, 180],
  'split-complementary': [0, 150, 210],
  tetradic: [0, 90, 180, 270]
};

export default {
  name: 'generatePalette',
  description: 'Build a colour palette around a base colour — analogous, triadic, complementary or tints and shades.',
  category: 'design', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{scheme|prose}} palette from {{base}}: {{colors|list}}.',
  inputSchema: {
    type: 'object', required: ['color'],
    properties: {
      color: { type: 'string', label: 'base colour', minLength: 3, prompt: 'Which colour should the palette be built around?' },
      scheme: { type: 'string', label: 'scheme', enum: [...Object.keys(SCHEMES), 'tints', 'shades'], default: 'analogous' },
      count: { type: 'integer', label: 'colours (tints/shades)', minimum: 2, maximum: 10, default: 5, description: 'only used for tints and shades' }
    }
  },
  outputSchema: { type: 'object', properties: { colors: { type: 'array', items: { type: 'string' } }, base: { type: 'string' }, scheme: { type: 'string' }, count: { type: 'integer' } } },
  examples: [
    { text: 'build an analogous palette from #2C6E8C', input: { color: '#2C6E8C' }, output: { colors: ['#2C8C7A', '#2C6E8C', '#2C3E8C'], base: '#2C6E8C', scheme: 'analogous', count: 3 } },
    { text: 'triadic palette for this blue', input: { color: '#2C6E8C', scheme: 'triadic' }, output: { colors: ['#2C6E8C', '#8C2C6E', '#6E8C2C'], base: '#2C6E8C', scheme: 'triadic', count: 3 } },
    { text: 'complementary pair for #FF5733', input: { color: '#FF5733', scheme: 'complementary' }, output: { colors: ['#FF5733', '#33DBFF'], base: '#FF5733', scheme: 'complementary', count: 2 } },
    { text: 'five tints of this colour', input: { color: '#2C6E8C', scheme: 'tints', count: 5 }, output: { colors: ['#2C6E8C', '#459DC5', '#83BDD8', '#C1DEEC', '#FFFFFF'], base: '#2C6E8C', scheme: 'tints', count: 5 } },
    { text: 'four shades of this colour', input: { color: '#2C6E8C', scheme: 'shades', count: 4 }, output: { colors: ['#2C6E8C', '#1D495D', '#0F252F', '#000000'], base: '#2C6E8C', scheme: 'shades', count: 4 } }
  ],
  errorCases: [
    { input: { color: 'mauve' }, code: 'INVALID_INPUT' },
    { input: { color: '#fff', scheme: 'rainbow' }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' }
  ],
  run (input) {
    const c = parseColor(input.color);
    if (!c) return fail('INVALID_INPUT', `I couldn't read "${input.color}" as a colour.`, 'color');
    const { h, s, l } = rgbToHsl(c.r, c.g, c.b);
    const hex = (hh, ss, ll) => { const rgb = hslToRgb(hh, ss, ll); return toHex(rgb.r, rgb.g, rgb.b); };

    let colors;
    if (input.scheme === 'tints' || input.scheme === 'shades') {
      /* Tints step toward white and shades toward black, in equal steps of
         lightness from the base. Stepping in RGB instead would drift the hue
         as the colour approaches either end. */
      const target = input.scheme === 'tints' ? 100 : 0;
      const step = (target - l) / (input.count - 1);
      colors = Array.from({ length: input.count }, (_, i) => hex(h, s, l + step * i));
    } else {
      colors = SCHEMES[input.scheme].map(offset => hex(h + offset, s, l));
    }
    return ok({ colors, base: toHex(c.r, c.g, c.b), scheme: input.scheme, count: colors.length }, computed());
  }
};
