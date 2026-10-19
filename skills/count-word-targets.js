import { ok, fail, computed } from '../src/contracts.js';
import { words } from '../src/lib/text.js';
import { round } from '../src/lib/num.js';

export default {
  name: 'countWordTargets',
  description: 'Check a draft against a word count target and say how far off it is.',
  category: 'writing',
  tier: 'core',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{words|comma}} of {{target|comma}} words — {{percent}}% there, {{verdict|prose}}.',
  inputSchema: {
    type: 'object',
    required: ['text', 'target'],
    properties: {
      text: { type: 'string', label: 'text', prompt: 'Which draft should I count?' },
      target: { type: 'integer', label: 'word target', exclusiveMinimum: 0, prompt: 'What is the word count target?' },
      tolerance: { type: 'number', label: 'tolerance %', minimum: 0, maximum: 100, default: 10, description: 'how many percent over or under still counts as on target' }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      words: { type: 'integer' }, target: { type: 'integer' }, difference: { type: 'integer' },
      percent: { type: 'number' }, verdict: { type: 'string' }, onTarget: { type: 'boolean' },
      lower: { type: 'integer' }, upper: { type: 'integer' }
    }
  },
  examples: [
    { text: 'is my 450 word draft close to 500 words', input: { text: 'word '.repeat(450).trim(), target: 500 },
      output: { words: 450, target: 500, difference: -50, percent: 90, verdict: 'within the 10% tolerance', onTarget: true, lower: 450, upper: 550 } },
    { text: 'how far off 1000 words am I', input: { text: 'x '.repeat(620).trim(), target: 1000 },
      output: { words: 620, target: 1000, difference: -380, percent: 62, verdict: '380 words short', onTarget: false, lower: 900, upper: 1100 } },
    { text: 'am I over the 250 word limit', input: { text: 'a '.repeat(300).trim(), target: 250 },
      output: { words: 300, target: 250, difference: 50, percent: 120, verdict: '50 words over', onTarget: false, lower: 225, upper: 275 } },
    { text: 'check my draft against 800 words exactly', input: { text: 'w '.repeat(800).trim(), target: 800 },
      output: { words: 800, target: 800, difference: 0, percent: 100, verdict: 'exactly on target', onTarget: true, lower: 720, upper: 880 } },
    { text: 'progress towards 2000 words with a 5% tolerance', input: { text: 'y '.repeat(1950).trim(), target: 2000, tolerance: 5 },
      output: { words: 1950, target: 2000, difference: -50, percent: 97.5, verdict: 'within the 5% tolerance', onTarget: true, lower: 1900, upper: 2100 } }
  ],
  errorCases: [
    { input: { text: 'hello', target: 0 }, code: 'INVALID_INPUT' },
    { input: { text: 'hello', target: -100 }, code: 'INVALID_INPUT' },
    { input: { text: 'hello' }, code: 'MISSING_FIELD' }
  ],
  run (input) {
    const count = words(input.text).length;
    if (input.target <= 0) return fail('INVALID_INPUT', 'The target has to be more than zero words.', 'target');

    const band = input.target * input.tolerance / 100;
    const lower = Math.round(input.target - band);
    const upper = Math.round(input.target + band);
    const difference = count - input.target;
    const onTarget = count >= lower && count <= upper;

    return ok({
      words: count, target: input.target, difference,
      percent: round(count / input.target * 100, 2),
      verdict: difference === 0 ? 'exactly on target'
        : onTarget ? `within the ${input.tolerance}% tolerance`
          : difference > 0 ? `${difference} words over` : `${Math.abs(difference)} words short`,
      onTarget, lower, upper
    }, computed());
  }
};
