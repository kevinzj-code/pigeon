import { ok, fail, computed } from '../src/contracts.js';
import { round, sig } from '../src/lib/num.js';

export default {
  name: 'roundTo',
  description: 'Round a number to a number of decimal places or significant figures.',
  category: 'math',
  tier: 'core',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  title: 'Round a number',
  replyTemplate: '{{value}} rounded to {{places}} {{mode}} is {{result}}.',
  inputSchema: {
    type: 'object',
    required: ['value', 'places'],
    properties: {
      value: { type: 'number', label: 'number', carry: true, prompt: 'Which number should I round?' },
      places: { type: 'integer', label: 'places or sig figs', minimum: 0, maximum: 15, prompt: 'To how many places?' },
      mode: { type: 'string', label: 'round to', enum: ['decimals', 'significant figures'], default: 'decimals' }
    }
  },
  outputSchema: { type: 'object', properties: { result: { type: 'number' }, value: { type: 'number' }, places: { type: 'integer' }, mode: { type: 'string' }, changed: { type: 'boolean' } } },
  examples: [
    { text: 'round 3.14159 to 2 decimal places', input: { value: 3.14159, places: 2 }, output: { result: 3.14, value: 3.14159, places: 2, mode: 'decimals', changed: true } },
    { text: 'round 1234.5678 to the nearest whole number', input: { value: 1234.5678, places: 0 }, output: { result: 1235, value: 1234.5678, places: 0, mode: 'decimals', changed: true } },
    { text: '0.000123456 to 3 significant figures', input: { value: 0.000123456, places: 3, mode: 'significant figures' }, output: { result: 0.000123, value: 0.000123456, places: 3, mode: 'significant figures', changed: true } },
    { text: 'round 2.5 to 0 decimals', input: { value: 2.5, places: 0 }, output: { result: 3, value: 2.5, places: 0, mode: 'decimals', changed: true } },
    { text: 'round 42 to 2 decimals', input: { value: 42, places: 2 }, output: { result: 42, value: 42, places: 2, mode: 'decimals', changed: false } }
  ],
  errorCases: [
    { input: { value: 3.14, places: -1 }, code: 'INVALID_INPUT' },
    { input: { value: 3.14, places: 2, mode: 'vibes' }, code: 'INVALID_INPUT' },
    { input: { places: 2 }, code: 'MISSING_FIELD' }
  ],
  run (input) {
    if (input.mode === 'significant figures' && input.places < 1) {
      return fail('INVALID_INPUT', 'Significant figures start at 1.', 'places');
    }
    const result = input.mode === 'significant figures' ? sig(input.value, input.places) : round(input.value, input.places);
    return ok({ result, value: input.value, places: input.places, mode: input.mode, changed: result !== input.value }, computed());
  }
};
