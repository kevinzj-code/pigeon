import { ok, fail, computed } from '../src/contracts.js';
import { parseColor, toHex, rgbToHsl, hslToRgb } from '../src/lib/color.js';
import { round } from '../src/lib/num.js';

export default {
  name: 'complementaryColor',
  description: 'Find the colour opposite a given one on the colour wheel.',
  category: 'design', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: 'The complement of {{original}} is {{hex}} — hue {{hue}} opposite {{originalHue}}.',
  inputSchema: {
    type: 'object', required: ['color'],
    properties: { color: { type: 'string', label: 'colour', minLength: 3, prompt: 'Which colour?' } }
  },
  outputSchema: { type: 'object', properties: { hex: { type: 'string' }, rgb: { type: 'string' }, original: { type: 'string' }, hue: { type: 'number' }, originalHue: { type: 'number' }, grey: { type: 'boolean' } } },
  examples: [
    { text: 'what is the complement of #2C6E8C', input: { color: '#2C6E8C' }, output: { hex: '#8C4A2C', rgb: 'rgb(140, 74, 44)', original: '#2C6E8C', hue: 19, originalHue: 199, grey: false } },
    { text: 'opposite colour to red', input: { color: '#FF0000' }, output: { hex: '#00FFFF', rgb: 'rgb(0, 255, 255)', original: '#FF0000', hue: 180, originalHue: 0, grey: false } },
    { text: 'complement of this orange', input: { color: '#FF5733' }, output: { hex: '#33DBFF', rgb: 'rgb(51, 219, 255)', original: '#FF5733', hue: 191, originalHue: 11, grey: false } },
    { text: 'find the opposite of green', input: { color: '#00FF00' }, output: { hex: '#FF00FF', rgb: 'rgb(255, 0, 255)', original: '#00FF00', hue: 300, originalHue: 120, grey: false } },
    { text: 'complement of a grey', input: { color: '#808080' }, output: { hex: '#808080', rgb: 'rgb(128, 128, 128)', original: '#808080', hue: 180, originalHue: 0, grey: true } }
  ],
  errorCases: [
    { input: { color: 'cerulean' }, code: 'INVALID_INPUT' },
    { input: { color: '#xyz' }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' }
  ],
  run (input) {
    const c = parseColor(input.color);
    if (!c) return fail('INVALID_INPUT', `I couldn't read "${input.color}" as a colour.`, 'color');
    const { h, s, l } = rgbToHsl(c.r, c.g, c.b);
    /* A grey has no hue, so rotating it 180 degrees returns the same colour —
       correct, and worth flagging, because "the complement is identical" looks
       like a bug otherwise. */
    const grey = s === 0;
    const hue = (h + 180) % 360;
    const rgb = hslToRgb(hue, s, l);
    return ok({
      hex: toHex(rgb.r, rgb.g, rgb.b), rgb: `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`,
      original: toHex(c.r, c.g, c.b),
      hue: round(hue, 0), originalHue: round(h, 0), grey
    }, computed());
  }
};
