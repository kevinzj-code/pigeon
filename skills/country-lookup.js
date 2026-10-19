import { ok, fail, bundled } from '../src/contracts.js';
import { findCountry, CURRENCIES, TABLES_AS_OF } from '../src/lib/reference.js';

/* The §4.4 example plan starts here: countryLookup → convertCurrencyFixed,
   with the currency code flowing between them as $s1.currency. That is why
   `currency` is a bare ISO code in the output and the human-readable name sits
   beside it in its own field — a ref has to resolve to something the next
   skill's schema accepts, not to a sentence. */
export default {
  name: 'countryLookup',
  description: "Look up a country's capital city, ISO codes, currency and international dialling code.",
  category: 'reference',
  tier: 'core',
  unbuilt: false,
  needsNetwork: false,
  dataAsOf: TABLES_AS_OF,
  labels: [],
  replyTemplate: "{{name}}'s capital is {{capital}}. It uses the {{currencyName}} ({{currency}}) and its dialling code is {{dialCode}}.",
  inputSchema: {
    type: 'object',
    required: ['query'],
    properties: {
      query: { type: 'string', label: 'country', minLength: 2, prompt: 'Which country?' }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string' }, capital: { type: 'string' }, iso2: { type: 'string' },
      iso3: { type: 'string' }, currency: { type: 'string' }, currencyName: { type: 'string' },
      currencySymbol: { type: 'string' }, dialCode: { type: 'string' }, dataAsOf: { type: 'string' }
    }
  },
  examples: [
    { text: 'what is the capital of Switzerland', input: { query: 'Switzerland' },
      output: { name: 'Switzerland', capital: 'Bern', iso2: 'CH', iso3: 'CHE', currency: 'CHF', currencyName: 'Swiss franc', currencySymbol: 'CHF', dialCode: '+41', dataAsOf: '2026-08-29' } },
    { text: 'what currency does japan use', input: { query: 'Japan' },
      output: { name: 'Japan', capital: 'Tokyo', iso2: 'JP', iso3: 'JPN', currency: 'JPY', currencyName: 'Japanese yen', currencySymbol: '¥', dialCode: '+81', dataAsOf: '2026-08-29' } },
    { text: 'dialling code for brazil', input: { query: 'Brazil' },
      output: { name: 'Brazil', capital: 'Brasília', iso2: 'BR', iso3: 'BRA', currency: 'BRL', currencyName: 'Brazilian real', currencySymbol: 'R$', dialCode: '+55', dataAsOf: '2026-08-29' } },
    { text: 'country code for the netherlands', input: { query: 'Holland' },
      output: { name: 'Netherlands', capital: 'Amsterdam', iso2: 'NL', iso3: 'NLD', currency: 'EUR', currencyName: 'euro', currencySymbol: '€', dialCode: '+31', dataAsOf: '2026-08-29' } },
    { text: 'tell me about NZ', input: { query: 'NZ' },
      output: { name: 'New Zealand', capital: 'Wellington', iso2: 'NZ', iso3: 'NZL', currency: 'NZD', currencyName: 'New Zealand dollar', currencySymbol: 'NZ$', dialCode: '+64', dataAsOf: '2026-08-29' } }
  ],
  errorCases: [
    { input: { query: 'Narnia' }, code: 'INVALID_INPUT' },
    { input: { query: 'ZZ' }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' }
  ],
  run (input) {
    const c = findCountry(input.query);
    /* The table is a subset, not the world. Saying "not in the bundled table"
       rather than "no such country" is the difference between a limit the user
       can work around and a claim that is simply false. */
    if (!c) return fail('INVALID_INPUT', `"${input.query}" isn't in the bundled country table.`, 'query');
    const cur = CURRENCIES[c.currency];
    return ok({
      name: c.name, capital: c.capital, iso2: c.iso2, iso3: c.iso3,
      currency: c.currency,
      currencyName: cur ? cur.name : c.currency,
      currencySymbol: cur ? cur.symbol : c.currency,
      dialCode: c.dialCode,
      dataAsOf: TABLES_AS_OF
    }, bundled(TABLES_AS_OF));
  }
};
