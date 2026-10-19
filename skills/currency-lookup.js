import { ok, fail, bundled } from '../src/contracts.js';
import { CURRENCIES, TABLES_AS_OF } from '../src/lib/reference.js';

export default {
  name: 'currencyLookup',
  description: 'Look up what a currency code stands for — its name, symbol and how many decimal places it uses.',
  category: 'reference',
  tier: 'core',
  unbuilt: false,
  needsNetwork: false,
  dataAsOf: TABLES_AS_OF,
  labels: [],
  replyTemplate: '{{code}} is the {{name}}, written {{symbol}}, with {{decimals}} decimal {{decimals|plural:place:places}}.',
  inputSchema: {
    type: 'object',
    required: ['code'],
    properties: { code: { type: 'string', label: 'currency code', minLength: 2, prompt: 'Which currency code? (like GBP)' } }
  },
  outputSchema: {
    type: 'object',
    properties: {
      code: { type: 'string' }, name: { type: 'string' }, symbol: { type: 'string' },
      decimals: { type: 'integer' }, dataAsOf: { type: 'string' }
    }
  },
  examples: [
    { text: 'what is JPY', input: { code: 'JPY' },
      output: { code: 'JPY', name: 'Japanese yen', symbol: '¥', decimals: 0, dataAsOf: '2026-08-29' } },
    { text: 'what does GBP stand for', input: { code: 'gbp' },
      output: { code: 'GBP', name: 'pound sterling', symbol: '£', decimals: 2, dataAsOf: '2026-08-29' } },
    { text: 'currency symbol for INR', input: { code: 'INR' },
      output: { code: 'INR', name: 'Indian rupee', symbol: '₹', decimals: 2, dataAsOf: '2026-08-29' } },
    { text: 'how many decimals does KWD have', input: { code: 'KWD' },
      output: { code: 'KWD', name: 'Kuwaiti dinar', symbol: 'د.ك', decimals: 3, dataAsOf: '2026-08-29' } },
    { text: 'what is the ZAR currency', input: { code: 'ZAR' },
      output: { code: 'ZAR', name: 'South African rand', symbol: 'R', decimals: 2, dataAsOf: '2026-08-29' } },
    { text: 'what does the currency code NOK mean', input: { code: 'NOK' },
      output: { code: 'NOK', name: 'Norwegian krone', symbol: 'kr', decimals: 2, dataAsOf: '2026-08-29' } },
    { text: 'which currency is CHF', input: { code: 'CHF' },
      output: { code: 'CHF', name: 'Swiss franc', symbol: 'CHF', decimals: 2, dataAsOf: '2026-08-29' } }
  ],
  errorCases: [
    { input: { code: 'XYZ' }, code: 'INVALID_INPUT' },
    { input: { code: 'galleons' }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' }
  ],
  run (input) {
    const code = String(input.code).trim().toUpperCase();
    const c = CURRENCIES[code];
    if (!c) return fail('INVALID_INPUT', `"${input.code}" isn't in the bundled currency table.`, 'code');
    return ok({ ...c, dataAsOf: TABLES_AS_OF }, bundled(TABLES_AS_OF));
  }
};
