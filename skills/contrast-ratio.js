import { ok, fail, computed } from '../src/contracts.js';
import { parseColor, toHex, luminance } from '../src/lib/color.js';
import { round } from '../src/lib/num.js';

export default {
  name: 'contrastRatio',
  description: 'Work out the contrast ratio between two colours and whether it meets WCAG AA or AAA.',
  category: 'design', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: 'Contrast ratio {{ratio}} — {{verdict|prose}}.',
  inputSchema: {
    type: 'object', required: ['foreground', 'background'],
    properties: {
      foreground: { type: 'string', label: 'text colour', minLength: 3, prompt: 'Which colour is the text?' },
      background: { type: 'string', label: 'background colour', minLength: 3, prompt: 'Which colour is behind it?' },
      largeText: { type: 'boolean', label: 'large text', default: false, description: '18pt or 14pt bold and above' }
    }
  },
  outputSchema: {
    type: 'object',
    properties: { ratio: { type: 'number' }, verdict: { type: 'string' }, aa: { type: 'boolean' }, aaa: { type: 'boolean' }, aaThreshold: { type: 'number' }, aaaThreshold: { type: 'number' }, foreground: { type: 'string' }, background: { type: 'string' } }
  },
  examples: [
    { text: 'contrast between black text and white background', input: { foreground: '#000000', background: '#FFFFFF' }, output: { ratio: 21, verdict: 'passes AA and AAA', aa: true, aaa: true, aaThreshold: 4.5, aaaThreshold: 7, foreground: '#000000', background: '#FFFFFF' } },
    { text: 'is this text readable on that background', input: { foreground: '#16283A', background: '#E5F1F7' }, output: { ratio: 13.05, verdict: 'passes AA and AAA', aa: true, aaa: true, aaThreshold: 4.5, aaaThreshold: 7, foreground: '#16283A', background: '#E5F1F7' } },
    { text: 'check contrast of grey on white', input: { foreground: '#767676', background: '#FFFFFF' }, output: { ratio: 4.54, verdict: 'passes AA but not AAA', aa: true, aaa: false, aaThreshold: 4.5, aaaThreshold: 7, foreground: '#767676', background: '#FFFFFF' } },
    { text: 'contrast for light grey on white', input: { foreground: '#AAAAAA', background: '#FFFFFF' }, output: { ratio: 2.32, verdict: 'fails AA and AAA', aa: false, aaa: false, aaThreshold: 4.5, aaaThreshold: 7, foreground: '#AAAAAA', background: '#FFFFFF' } },
    { text: 'check contrast for large heading text', input: { foreground: '#767676', background: '#FFFFFF', largeText: true }, output: { ratio: 4.54, verdict: 'passes AA and AAA', aa: true, aaa: true, aaThreshold: 3, aaaThreshold: 4.5, foreground: '#767676', background: '#FFFFFF' } }
  ],
  errorCases: [
    { input: { foreground: 'chartreuse', background: '#fff' }, code: 'INVALID_INPUT' },
    { input: { foreground: '#fff' }, code: 'MISSING_FIELD' },
    { input: { foreground: '#fff', background: '#12345' }, code: 'INVALID_INPUT' }
  ],
  run (input) {
    const fg = parseColor(input.foreground);
    if (!fg) return fail('INVALID_INPUT', `I couldn't read "${input.foreground}" as a colour.`, 'foreground');
    const bg = parseColor(input.background);
    if (!bg) return fail('INVALID_INPUT', `I couldn't read "${input.background}" as a colour.`, 'background');

    const lf = luminance(fg.r, fg.g, fg.b);
    const lb = luminance(bg.r, bg.g, bg.b);
    const ratio = (Math.max(lf, lb) + 0.05) / (Math.min(lf, lb) + 0.05);
    /* WCAG 2 thresholds drop for large text — 18pt, or 14pt bold. Applying the
       body-text bar to a heading fails designs that are genuinely compliant. */
    const aaThreshold = input.largeText ? 3 : 4.5;
    const aaaThreshold = input.largeText ? 4.5 : 7;
    const rounded = round(ratio, 2);
    const aa = rounded >= aaThreshold;
    const aaa = rounded >= aaaThreshold;
    return ok({
      ratio: rounded,
      verdict: aaa ? 'passes AA and AAA' : aa ? 'passes AA but not AAA' : 'fails AA and AAA',
      aa, aaa, aaThreshold, aaaThreshold,
      foreground: toHex(fg.r, fg.g, fg.b), background: toHex(bg.r, bg.g, bg.b)
    }, computed());
  }
};
