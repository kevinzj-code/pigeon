import { ok, computed } from '../src/contracts.js';
import { round } from '../src/lib/num.js';

export default {
  name: 'remToPx',
  description: "Work out how many pixels a rem value comes to on screen.",
  category: 'design', tier: 'standard',
  title: 'Rem to pixels',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{rem}}rem is {{px}}px at a {{base}}px root.',
  inputSchema: {
    type: 'object', required: ['rem'],
    properties: {
      rem: { type: 'number', label: 'rem', carry: true, prompt: 'How many rem?' },
      base: { type: 'number', label: 'root font size (px)', exclusiveMinimum: 0, default: 16, description: 'the root font size' }
    }
  },
  outputSchema: { type: 'object', properties: { px: { type: 'number' }, rem: { type: 'number' }, base: { type: 'number' }, css: { type: 'string' }, wholePixels: { type: 'boolean' } } },
  examples: [
    { text: 'what is 1.5rem in pixels', input: { rem: 1.5 }, output: { px: 24, rem: 1.5, base: 16, css: '24px', wholePixels: true } },
    { text: 'convert 1rem to px', input: { rem: 1 }, output: { px: 16, rem: 1, base: 16, css: '16px', wholePixels: true } },
    { text: '0.875rem in pixels', input: { rem: 0.875 }, output: { px: 14, rem: 0.875, base: 16, css: '14px', wholePixels: true } },
    { text: 'convert 2rem with a 10px root', input: { rem: 2, base: 10 }, output: { px: 20, rem: 2, base: 10, css: '20px', wholePixels: true } },
    { text: 'what is 1.1rem in px', input: { rem: 1.1 }, output: { px: 17.6, rem: 1.1, base: 16, css: '17.6px', wholePixels: false } }
  ],
  errorCases: [
    { input: { rem: 1, base: -16 }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' },
    { input: { rem: 'one' }, code: 'INVALID_INPUT' }
  ],
  run (input) {
    const px = round(input.rem * input.base, 4);
    return ok({
      px, rem: input.rem, base: input.base, css: `${px}px`,
      /* A fractional pixel is legal CSS and gets rounded by the browser
         differently on every device — worth flagging on a value someone is
         about to put in a border width. */
      wholePixels: Number.isInteger(px)
    }, computed());
  }
};
