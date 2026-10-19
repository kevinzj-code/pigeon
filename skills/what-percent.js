import { ok, fail, computed } from '../src/contracts.js';
import { round } from '../src/lib/num.js';

export default {
  name: 'whatPercent',
  description: 'Work out what share one number is of another, as a percentage — what proportion 18 is of 24, or a score out of a maximum.',
  category: 'math',
  tier: 'core',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{part|comma}} is {{percent}}% of {{whole|comma}}.',
  inputSchema: {
    type: 'object',
    required: ['part', 'whole'],
    properties: {
      part: { type: 'number', label: 'part', carry: true, prompt: 'Which number is the part?' },
      whole: { type: 'number', label: 'out of', prompt: 'A percentage of what total?' }
    }
  },
  outputSchema: { type: 'object', properties: { percent: { type: 'number' }, part: { type: 'number' }, whole: { type: 'number' }, fraction: { type: 'number' } } },
  examples: [
    { text: '36 out of 240 as a percentage', input: { part: 36, whole: 240 }, output: { percent: 15, part: 36, whole: 240, fraction: 0.15 } },
    { text: 'i got 47 out of 60, what percent is that', input: { part: 47, whole: 60 }, output: { percent: 78.33, part: 47, whole: 60, fraction: 0.783333 } },
    { text: '1 out of 3 as a percentage', input: { part: 1, whole: 3 }, output: { percent: 33.33, part: 1, whole: 3, fraction: 0.333333 } },
    { text: '250 out of 200 as a percentage', input: { part: 250, whole: 200 }, output: { percent: 125, part: 250, whole: 200, fraction: 1.25 } },
    { text: 'what percent of 1500 is 45', input: { part: 45, whole: 1500 }, output: { percent: 3, part: 45, whole: 1500, fraction: 0.03 } },
    { text: 'what proportion is 15 of 60, as a percentage', input: { part: 15, whole: 60 },
      output: { percent: 25, part: 15, whole: 60, fraction: 0.25 } },
    { text: 'as a percentage, how much of 24 is 18', input: { part: 18, whole: 24 },
      output: { percent: 75, part: 18, whole: 24, fraction: 0.75 } }
  ],
  errorCases: [
    { input: { part: 5, whole: 0 }, code: 'INVALID_INPUT' },
    { input: { part: 'five', whole: 20 }, code: 'INVALID_INPUT' },
    { input: { part: 5 }, code: 'MISSING_FIELD' }
  ],
  run (input) {
    /* Out of zero has no percentage. Returning Infinity would render as a value
       and read as an answer. */
    if (input.whole === 0) return fail('INVALID_INPUT', 'Nothing can be a percentage of zero.', 'whole');
    return ok({
      percent: round(input.part / input.whole * 100, 2),
      part: input.part, whole: input.whole,
      fraction: round(input.part / input.whole, 6)
    }, computed());
  }
};
