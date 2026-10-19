import { ok, fail, computed } from '../src/contracts.js';
import { gcd, round } from '../src/lib/num.js';

const NAMED = { '16:9': 'widescreen', '4:3': 'standard', '1:1': 'square', '3:2': '35mm', '21:9': 'ultrawide', '9:16': 'portrait video', '2:3': 'portrait 35mm', '5:4': 'large format' };

export default {
  name: 'aspectRatio',
  description: 'Reduce a width by a height to its screen ratio, like 16:9.',
  category: 'design', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{width}} × {{height}} is {{ratio|prose}}{{namedNote|prose}}, a decimal ratio of {{decimal}}.',
  inputSchema: {
    type: 'object', required: ['width', 'height'],
    properties: {
      width: { type: 'number', label: 'width', exclusiveMinimum: 0, prompt: 'What is the width?' },
      height: { type: 'number', label: 'height', exclusiveMinimum: 0, prompt: 'What is the height?' }
    }
  },
  outputSchema: { type: 'object', properties: { ratio: { type: 'string' }, decimal: { type: 'number' }, width: { type: 'number' }, height: { type: 'number' }, name: { type: 'string' }, namedNote: { type: 'string' }, orientation: { type: 'string' } } },
  examples: [
    { text: 'what aspect ratio is 1920 by 1080', input: { width: 1920, height: 1080 }, output: { ratio: '16:9', decimal: 1.778, width: 1920, height: 1080, name: 'widescreen', namedNote: ', widescreen', orientation: 'landscape' } },
    { text: 'aspect ratio of 1024x768', input: { width: 1024, height: 768 }, output: { ratio: '4:3', decimal: 1.333, width: 1024, height: 768, name: 'standard', namedNote: ', standard', orientation: 'landscape' } },
    { text: 'ratio for a square image', input: { width: 500, height: 500 }, output: { ratio: '1:1', decimal: 1, width: 500, height: 500, name: 'square', namedNote: ', square', orientation: 'square' } },
    { text: 'aspect ratio of a phone video', input: { width: 1080, height: 1920 }, output: { ratio: '9:16', decimal: 0.563, width: 1080, height: 1920, name: 'portrait video', namedNote: ', portrait video', orientation: 'portrait' } },
    { text: 'ratio of an unusual size', input: { width: 1234, height: 567 }, output: { ratio: '1234:567', decimal: 2.176, width: 1234, height: 567, name: '', namedNote: '', orientation: 'landscape' } },
    { text: 'reduce 3840 by 2160 to its simplest ratio', input: { width: 3840, height: 2160 },
      output: { ratio: '16:9', decimal: 1.778, width: 3840, height: 2160, name: 'widescreen', namedNote: ', widescreen', orientation: 'landscape' } },
    { text: 'what ratio is a 1200 by 800 image', input: { width: 1200, height: 800 },
      output: { ratio: '3:2', decimal: 1.5, width: 1200, height: 800, name: '35mm', namedNote: ', 35mm', orientation: 'landscape' } }
  ],
  errorCases: [
    { input: { width: 0, height: 100 }, code: 'INVALID_INPUT' },
    { input: { width: 100 }, code: 'MISSING_FIELD' },
    { input: { width: -16, height: 9 }, code: 'INVALID_INPUT' }
  ],
  run (input) {
    const { width: w, height: h } = input;
    if (!Number.isFinite(w) || !Number.isFinite(h)) return fail('INVALID_INPUT', 'Both sides have to be numbers.', 'width');
    /* Integers only for the reduction — gcd is undefined on fractions, and a
       ratio like 1.5:1 is better expressed as 3:2 anyway. */
    const wi = Math.round(w), hi = Math.round(h);
    const divisor = gcd(wi, hi) || 1;
    const ratio = `${wi / divisor}:${hi / divisor}`;
    const name = NAMED[ratio] ?? '';
    return ok({
      ratio, decimal: round(w / h, 3), width: w, height: h,
      name, namedNote: name ? `, ${name}` : '',
      orientation: w > h ? 'landscape' : w < h ? 'portrait' : 'square'
    }, computed());
  }
};
