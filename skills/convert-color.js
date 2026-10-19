import { ok, fail, computed } from '../src/contracts.js';
import { round } from '../src/lib/num.js';
import { parseColor, toHex, rgbToHsl, hslToRgb } from '../src/lib/color.js';

export default {
  name: 'convertColor',
  description: 'Convert a colour between hex, RGB and HSL.',
  category: 'design', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{hex}} is {{rgb|prose}} and {{hsl|prose}}.',
  inputSchema: {
    type: 'object', required: ['color'],
    properties: { color: { type: 'string', label: 'colour', minLength: 3, prompt: 'Which colour? (hex, rgb() or hsl())' } }
  },
  outputSchema: {
    type: 'object',
    properties: { hex: { type: 'string' }, rgb: { type: 'string' }, hsl: { type: 'string' }, r: { type: 'integer' }, g: { type: 'integer' }, b: { type: 'integer' }, h: { type: 'number' }, s: { type: 'number' }, l: { type: 'number' }, alpha: { type: 'number' } }
  },
  examples: [
    { text: 'convert #FF5733 to rgb', input: { color: '#FF5733' }, output: { hex: '#FF5733', rgb: 'rgb(255, 87, 51)', hsl: 'hsl(11, 100%, 60%)', r: 255, g: 87, b: 51, h: 11, s: 100, l: 60, alpha: 1 } },
    { text: 'what is rgb(44, 110, 140) in hex', input: { color: 'rgb(44, 110, 140)' }, output: { hex: '#2C6E8C', rgb: 'rgb(44, 110, 140)', hsl: 'hsl(199, 52%, 36%)', r: 44, g: 110, b: 140, h: 199, s: 52, l: 36, alpha: 1 } },
    { text: 'convert the shorthand #abc', input: { color: '#abc' }, output: { hex: '#AABBCC', rgb: 'rgb(170, 187, 204)', hsl: 'hsl(210, 25%, 73%)', r: 170, g: 187, b: 204, h: 210, s: 25, l: 73, alpha: 1 } },
    { text: 'turn hsl(120, 100%, 50%) into hex', input: { color: 'hsl(120, 100%, 50%)' }, output: { hex: '#00FF00', rgb: 'rgb(0, 255, 0)', hsl: 'hsl(120, 100%, 50%)', r: 0, g: 255, b: 0, h: 120, s: 100, l: 50, alpha: 1 } },
    { text: 'convert black to every format', input: { color: '#000000' }, output: { hex: '#000000', rgb: 'rgb(0, 0, 0)', hsl: 'hsl(0, 0%, 0%)', r: 0, g: 0, b: 0, h: 0, s: 0, l: 0, alpha: 1 } }
  ],
  errorCases: [
    { input: { color: 'burgundy' }, code: 'INVALID_INPUT' },
    { input: { color: '#12345' }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' }
  ],
  run (input) {
    const c = parseColor(input.color);
    if (!c) return fail('INVALID_INPUT', `I couldn't read "${input.color}" as a colour. Try hex, rgb() or hsl().`, 'color');
    const { h, s, l } = rgbToHsl(c.r, c.g, c.b);
    return ok({
      hex: toHex(c.r, c.g, c.b),
      rgb: `rgb(${c.r}, ${c.g}, ${c.b})`,
      hsl: `hsl(${Math.round(h)}, ${Math.round(s)}%, ${Math.round(l)}%)`,
      r: c.r, g: c.g, b: c.b,
      h: round(h, 0), s: round(s, 0), l: round(l, 0),
      alpha: c.a
    }, computed());
  }
};
