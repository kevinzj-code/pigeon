import { ok, fail, computed } from '../src/contracts.js';
import { CURRENCIES } from '../src/lib/reference.js';
import { round } from '../src/lib/num.js';

/* §9 of the skill index is titled "Finance math (rates always supplied, never
   assumed)", and this skill is why the title is worded that way.
 *
 * A bundled exchange-rate table would be the single most dangerous thing in
 * the registry: wrong within a day, indistinguishable from a fresh rate, and
 * acted on with money. So the rate is an INPUT. If the user doesn't have one,
 * the schema's prompt asks for it (ASK_USER) rather than the app inventing a
 * plausible number. §22 lists a live convertCurrencyLive as a Web-tier skill;
 * no SearchProvider ships in this build, so it is not in the registry at all
 * (§2.4 — no aspirational UI).
 *
 * provenance is "computed", not "bundled": the arithmetic is ours, the rate is
 * the user's, and nothing here came out of a table with a date on it. */
export default {
  name: 'convertCurrencyFixed',
  description: 'Convert an amount between currencies at an exchange rate you supply.',
  category: 'finance',
  tier: 'core',
  unbuilt: false,
  needsNetwork: false,
  dataAsOf: null,
  labels: [],
  title: 'Convert currency',
  replyTemplate: 'At {{rate}}, {{amount}} {{from}} is {{result}} {{to}}.',
  inputSchema: {
    type: 'object',
    required: ['amount', 'from', 'to', 'rate'],
    properties: {
      amount: { type: 'number', label: 'amount', carry: true, prompt: 'How much should I convert?' },
      from: { type: 'string', label: 'from currency', minLength: 3, maxLength: 3, prompt: 'Which currency is it in? (a three-letter code)' },
      to: { type: 'string', label: 'to currency', minLength: 3, maxLength: 3, prompt: 'Which currency should I convert to?' },
      rate: { type: 'number', label: 'rate per 1 unit', exclusiveMinimum: 0, prompt: 'What exchange rate should I use? (how many of the target currency per 1 of the source)' }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      result: { type: 'number' }, amount: { type: 'number' }, from: { type: 'string' },
      to: { type: 'string' }, rate: { type: 'number' }, decimals: { type: 'integer' },
      inverseRate: { type: 'number' }
    }
  },
  examples: [
    { text: 'convert 100 EUR to USD at 1.0842', input: { amount: 100, from: 'EUR', to: 'USD', rate: 1.0842 },
      output: { result: 108.42, amount: 100, from: 'EUR', to: 'USD', rate: 1.0842, decimals: 2, inverseRate: 0.922339 } },
    { text: '50 gbp in euros at a rate of 1.18', input: { amount: 50, from: 'gbp', to: 'eur', rate: 1.18 },
      output: { result: 59, amount: 50, from: 'GBP', to: 'EUR', rate: 1.18, decimals: 2, inverseRate: 0.847458 } },
    { text: 'how much is 250 dollars in yen at 150.53', input: { amount: 250, from: 'USD', to: 'JPY', rate: 150.53 },
      output: { result: 37633, amount: 250, from: 'USD', to: 'JPY', rate: 150.53, decimals: 0, inverseRate: 0.006643 } },
    { text: '1200 SEK to GBP at 0.0753', input: { amount: 1200, from: 'SEK', to: 'GBP', rate: 0.0753 },
      output: { result: 90.36, amount: 1200, from: 'SEK', to: 'GBP', rate: 0.0753, decimals: 2, inverseRate: 13.280212 } },
    { text: 'convert 75 CHF into KWD at 0.2547', input: { amount: 75, from: 'CHF', to: 'KWD', rate: 0.2547 },
      output: { result: 19.103, amount: 75, from: 'CHF', to: 'KWD', rate: 0.2547, decimals: 3, inverseRate: 3.926188 } }
  ],
  errorCases: [
    { input: { amount: 100, from: 'EUR', to: 'XYZ', rate: 1.1 }, code: 'INVALID_INPUT' },
    { input: { amount: 100, from: 'EUR', to: 'USD', rate: -2 }, code: 'INVALID_INPUT' },
    { input: { amount: 100, from: 'EUR', to: 'USD' }, code: 'MISSING_FIELD' }
  ],
  run (input) {
    const from = String(input.from).trim().toUpperCase();
    const to = String(input.to).trim().toUpperCase();
    if (!CURRENCIES[from]) return fail('INVALID_INPUT', `"${input.from}" isn't a currency code I recognise.`, 'from');
    if (!CURRENCIES[to]) return fail('INVALID_INPUT', `"${input.to}" isn't a currency code I recognise.`, 'to');

    /* Rounded to the TARGET currency's own minor unit: yen has no subdivision
       and Kuwaiti dinars have three, so a blanket two decimals would invent
       fractions of a yen and throw away a third of a fils. */
    const decimals = CURRENCIES[to].decimals;
    return ok({
      result: round(input.amount * input.rate, decimals),
      amount: input.amount, from, to, rate: input.rate, decimals,
      inverseRate: round(1 / input.rate, 6)
    }, computed());
  }
};
