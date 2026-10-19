import { ok, fail, computed } from '../src/contracts.js';
import { CURRENCIES } from '../src/lib/reference.js';

export default {
  name: 'formatCurrency',
  description: 'Write an amount of money the way a currency is normally written, with its symbol and decimal places.',
  category: 'math',
  tier: 'core',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{result}}',
  inputSchema: {
    type: 'object',
    required: ['amount', 'currency'],
    properties: {
      amount: { type: 'number', label: 'amount', carry: true, prompt: 'How much?' },
      currency: { type: 'string', label: 'currency', minLength: 3, maxLength: 3, prompt: 'Which currency? (a three-letter code like GBP)' },
      /* Note on the outputs below: en-GB writes foreign currencies as "US$" and
         "JP¥" to disambiguate them from the local pound, and separates a code
         from its amount with a NON-BREAKING space (U+00A0) so the two never
         wrap apart. Both are correct locale behaviour and neither is normalised
         away — the examples spell the U+00A0 out rather than hiding it. */
      style: { type: 'string', label: 'style', enum: ['symbol', 'code', 'name'], default: 'symbol' }
    }
  },
  outputSchema: {
    type: 'object',
    properties: { result: { type: 'string' }, amount: { type: 'number' }, currency: { type: 'string' }, decimals: { type: 'integer' }, locale: { type: 'string' } }
  },
  examples: [
    { text: 'write 1234.5 as pounds', input: { amount: 1234.5, currency: 'GBP' },
      output: { result: '£1,234.50', amount: 1234.5, currency: 'GBP', decimals: 2, locale: 'en-GB' } },
    { text: 'format 99 as US dollars', input: { amount: 99, currency: 'USD' },
      output: { result: 'US$99.00', amount: 99, currency: 'USD', decimals: 2, locale: 'en-GB' } },
    { text: 'write 5000 yen properly', input: { amount: 5000, currency: 'JPY' },
      output: { result: 'JP¥5,000', amount: 5000, currency: 'JPY', decimals: 0, locale: 'en-GB' } },
    { text: 'show 42.5 euros with the code not the symbol', input: { amount: 42.5, currency: 'EUR', style: 'code' },
      output: { result: 'EUR\u00A042.50', amount: 42.5, currency: 'EUR', decimals: 2, locale: 'en-GB' } },
    { text: 'format 12.345 kuwaiti dinars', input: { amount: 12.345, currency: 'KWD' },
      output: { result: 'KWD\u00A012.345', amount: 12.345, currency: 'KWD', decimals: 3, locale: 'en-GB' } }
  ],
  errorCases: [
    { input: { amount: 10, currency: 'XYZ' }, code: 'INVALID_INPUT' },
    { input: { amount: 10, currency: 'pounds' }, code: 'INVALID_INPUT' },
    { input: { currency: 'GBP' }, code: 'MISSING_FIELD' }
  ],
  run (input, ctx) {
    const code = String(input.currency).trim().toUpperCase();
    const meta = CURRENCIES[code];
    /* The decimal count is looked up, not assumed — yen has none and Kuwaiti
       dinars have three, and "£12.35" styling applied to either would invent a
       subdivision or throw one away. */
    if (!meta) return fail('INVALID_INPUT', `"${input.currency}" isn't a currency code I recognise.`, 'currency');
    const locale = ctx.locale || 'en-GB';
    try {
      const result = input.amount.toLocaleString(locale, {
        style: 'currency', currency: code,
        currencyDisplay: input.style === 'name' ? 'name' : input.style === 'code' ? 'code' : 'symbol',
        minimumFractionDigits: meta.decimals, maximumFractionDigits: meta.decimals
      });
      return ok({ result, amount: input.amount, currency: code, decimals: meta.decimals, locale }, computed());
    } catch (e) {
      return fail('INVALID_INPUT', `I couldn't format that: ${e.message}`, 'currency');
    }
  }
};
