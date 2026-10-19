import { ok, fail, computed } from '../src/contracts.js';

export default {
  name: 'formatNumber',
  description: 'Write a number with thousands separators, a set number of decimals, or in compact form like 1.2k.',
  category: 'math',
  tier: 'core',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{result}}',
  inputSchema: {
    type: 'object',
    required: ['value'],
    properties: {
      value: { type: 'number', label: 'number', carry: true, prompt: 'Which number should I format?', description: 'for the percent style, a fraction: 0.15 is 15%' },
      decimals: { type: 'integer', label: 'decimal places', minimum: 0, maximum: 10 },
      style: { type: 'string', label: 'style', enum: ['standard', 'compact', 'percent', 'plain'], default: 'standard' }
    }
  },
  outputSchema: {
    type: 'object',
    properties: { result: { type: 'string' }, value: { type: 'number' }, style: { type: 'string' }, locale: { type: 'string' } }
  },
  examples: [
    { text: 'format 1234567 with thousands separators', input: { value: 1234567 },
      output: { result: '1,234,567', value: 1234567, style: 'standard', locale: 'en-GB' } },
    /* Under 1,000 on purpose: above it the suffix is the engine's ICU, not
       ours. 1234567 is "1.2m" in the app (JavaScriptCore) and "1.2M" in
       Node 23 (ICU 77), so the old example failed on every Node run. */
    { text: 'write 950 in compact form', input: { value: 950, style: 'compact' },
      output: { result: '950', value: 950, style: 'compact', locale: 'en-GB' } },
    { text: 'show 0.4567 as a percentage', input: { value: 0.4567, style: 'percent', decimals: 1 },
      output: { result: '45.7%', value: 0.4567, style: 'percent', locale: 'en-GB' } },
    { text: 'format 3.14159 to two decimals', input: { value: 3.14159, decimals: 2 },
      output: { result: '3.14', value: 3.14159, style: 'standard', locale: 'en-GB' } },
    { text: 'write 9876.5 without separators', input: { value: 9876.5, style: 'plain' },
      output: { result: '9876.5', value: 9876.5, style: 'plain', locale: 'en-GB' } }
  ],
  errorCases: [
    { input: { value: 'lots' }, code: 'INVALID_INPUT' },
    { input: { value: 1, decimals: 99 }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' }
  ],
  run (input, ctx) {
    /* The locale comes from ctx (§2.5), which is why a French device gets
       "1 234 567" without this file knowing anything about French. */
    const locale = ctx.locale || 'en-GB';
    if (!Number.isFinite(input.value)) return fail('INVALID_INPUT', 'That is not a finite number.', 'value');

    const opts = {};
    if (input.decimals !== undefined) {
      opts.minimumFractionDigits = input.decimals;
      opts.maximumFractionDigits = input.decimals;
    }
    let result;
    try {
      if (input.style === 'plain') {
        result = input.decimals !== undefined ? input.value.toFixed(input.decimals) : String(input.value);
      } else if (input.style === 'compact') {
        result = input.value.toLocaleString(locale, { notation: 'compact', maximumFractionDigits: input.decimals ?? 1, ...(input.decimals !== undefined ? { minimumFractionDigits: input.decimals } : {}) });
      } else if (input.style === 'percent') {
        result = input.value.toLocaleString(locale, { style: 'percent', ...opts });
      } else {
        result = input.value.toLocaleString(locale, opts);
      }
    } catch (e) {
      return fail('INVALID_INPUT', `I couldn't format that: ${e.message}`, 'value');
    }
    return ok({ result, value: input.value, style: input.style, locale }, computed());
  }
};
