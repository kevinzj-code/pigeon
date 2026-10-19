import { ok, computed } from '../src/contracts.js';
import { round } from '../src/lib/num.js';

export default {
  name: 'pxToRem',
  description: "Restate a pixel measurement in rem, against the root font size.",
  category: 'design', tier: 'standard',
  title: 'Pixels to rem',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{px}}px is {{rem}}rem at a {{base}}px root.',
  inputSchema: {
    type: 'object', required: ['px'],
    properties: {
      px: { type: 'number', label: 'pixels', carry: true, prompt: 'How many pixels?' },
      base: { type: 'number', label: 'root font size (px)', exclusiveMinimum: 0, default: 16, description: 'the root font size' }
    }
  },
  outputSchema: { type: 'object', properties: { rem: { type: 'number' }, px: { type: 'number' }, base: { type: 'number' }, css: { type: 'string' }, exact: { type: 'boolean' } } },
  examples: [
    { text: 'what is 24px in rem', input: { px: 24 }, output: { rem: 1.5, px: 24, base: 16, css: '1.5rem', exact: true } },
    { text: 'convert 16px to rem', input: { px: 16 }, output: { rem: 1, px: 16, base: 16, css: '1rem', exact: true } },
    { text: '13px in rem at a 16px root', input: { px: 13 }, output: { rem: 0.8125, px: 13, base: 16, css: '0.8125rem', exact: true } },
    { text: 'convert 20px with a 10px root font size', input: { px: 20, base: 10 }, output: { rem: 2, px: 20, base: 10, css: '2rem', exact: true } },
    { text: 'what is 1px in rem', input: { px: 1 }, output: { rem: 0.0625, px: 1, base: 16, css: '0.0625rem', exact: true } }
  ],
  errorCases: [
    { input: { px: 16, base: 0 }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' },
    { input: { px: 'sixteen' }, code: 'INVALID_INPUT' }
  ],
  run (input) {
    const raw = input.px / input.base;
    /* Six decimals, and `exact` says whether that is the whole answer. A
       rounded rem is a rounded layout, and knowing 13px is exactly 0.8125rem
       while 15px is not is the point of asking. */
    const rem = round(raw, 6);
    return ok({
      rem, px: input.px, base: input.base,
      css: `${rem}rem`, exact: rem === raw
    }, computed());
  }
};
