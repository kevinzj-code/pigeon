import { ok, computed } from '../src/contracts.js';
import { round } from '../src/lib/num.js';

export default {
  name: 'percentOf',
  description: 'Take a percentage of a number — 15% of 240, or 20 percent of a bill.',
  category: 'math',
  tier: 'core',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{percent}}% of {{value|comma}} is {{result|comma}}.',
  inputSchema: {
    type: 'object',
    required: ['percent', 'value'],
    properties: {
      percent: { type: 'number', label: 'percent', prompt: 'What percentage?' },
      value: { type: 'number', label: 'of', carry: true, prompt: 'A percentage of what number?' }
    }
  },
  outputSchema: { type: 'object', properties: { result: { type: 'number' }, percent: { type: 'number' }, value: { type: 'number' }, remainder: { type: 'number' } } },
  examples: [
    { text: 'what is 15% of 240', input: { percent: 15, value: 240 }, output: { result: 36, percent: 15, value: 240, remainder: 204 } },
    { text: '20 percent of 85.50', input: { percent: 20, value: 85.5 }, output: { result: 17.1, percent: 20, value: 85.5, remainder: 68.4 } },
    { text: 'how much is 7.5% of 1200', input: { percent: 7.5, value: 1200 }, output: { result: 90, percent: 7.5, value: 1200, remainder: 1110 } },
    { text: '110% of 50', input: { percent: 110, value: 50 }, output: { result: 55, percent: 110, value: 50, remainder: -5 } },
    { text: 'a third — 33.3% of 900', input: { percent: 33.3, value: 900 }, output: { result: 299.7, percent: 33.3, value: 900, remainder: 600.3 } }
  ],
  errorCases: [
    { input: { percent: 'fifteen', value: 240 }, code: 'INVALID_INPUT' },
    { input: { percent: 15 }, code: 'MISSING_FIELD' },
    { input: { value: 240 }, code: 'MISSING_FIELD' }
  ],
  run (input) {
    const result = round(input.value * input.percent / 100, 6);
    return ok({ result, percent: input.percent, value: input.value, remainder: round(input.value - result, 6) }, computed());
  }
};
