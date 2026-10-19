import { ok, computed } from '../src/contracts.js';
import { round } from '../src/lib/num.js';
import { CURRENCIES } from '../src/lib/reference.js';

const SYMBOLS = { '£': 'GBP', $: 'USD', '€': 'EUR', '¥': 'JPY', '₹': 'INR', '₩': 'KRW', '₺': 'TRY', '₽': 'RUB' };

export default {
  name: 'extractCurrencyAmounts',
  description: 'Pull every money amount out of a text, with its currency.',
  category: 'text', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{count}} {{count|plural:amount:amounts}}: {{formatted|list}} — {{total|comma}} in total.',
  inputSchema: {
    type: 'object', required: ['text'],
    properties: { text: { type: 'string', label: 'text', minLength: 1, prompt: 'Which text should I search?' } }
  },
  outputSchema: { type: 'object', properties: { amounts: { type: 'array' }, formatted: { type: 'array', items: { type: 'string' } }, count: { type: 'integer' }, total: { type: 'number' }, currencies: { type: 'array', items: { type: 'string' } }, mixed: { type: 'boolean' } } },
  examples: [
    { text: 'get the amounts from this invoice line', input: { text: 'subtotal £120.50, shipping £4.99' },
      output: { amounts: [{ value: 120.5, currency: 'GBP', text: '£120.50' }, { value: 4.99, currency: 'GBP', text: '£4.99' }], formatted: ['£120.50', '£4.99'], count: 2, total: 125.49, currencies: ['GBP'], mixed: false } },
    { text: 'find the prices in this sentence', input: { text: 'it was $19.99 down from $29.99' },
      output: { amounts: [{ value: 19.99, currency: 'USD', text: '$19.99' }, { value: 29.99, currency: 'USD', text: '$29.99' }], formatted: ['$19.99', '$29.99'], count: 2, total: 49.98, currencies: ['USD'], mixed: false } },
    { text: 'extract amounts with thousands separators', input: { text: 'the budget is €1,250,000 this year' },
      output: { amounts: [{ value: 1250000, currency: 'EUR', text: '€1,250,000' }], formatted: ['€1,250,000'], count: 1, total: 1250000, currencies: ['EUR'], mixed: false } },
    { text: 'pull amounts written with codes', input: { text: 'paid 45.00 GBP and 60.00 USD' },
      output: { amounts: [{ value: 45, currency: 'GBP', text: '45.00 GBP' }, { value: 60, currency: 'USD', text: '60.00 USD' }], formatted: ['45.00 GBP', '60.00 USD'], count: 2, total: 105, currencies: ['GBP', 'USD'], mixed: true } },
    { text: 'any money in this line', input: { text: 'nothing priced here' },
      output: { amounts: [], formatted: [], count: 0, total: 0, currencies: [], mixed: false } },
    { text: 'list every price in this text', input: { text: 'The bag is $45.00 and the belt is $12.50' },
      output: { amounts: [{ value: 45, currency: 'USD', text: '$45.00' }, { value: 12.5, currency: 'USD', text: '$12.50' }], formatted: ['$45.00', '$12.50'], count: 2, total: 57.5, currencies: ['USD'], mixed: false } },
    { text: 'which sums of money are mentioned here', input: { text: 'rent €900, deposit €1,800' },
      output: { amounts: [{ value: 900, currency: 'EUR', text: '€900,' }, { value: 1800, currency: 'EUR', text: '€1,800' }], formatted: ['€900,', '€1,800'], count: 2, total: 2700, currencies: ['EUR'], mixed: false } }
  ],
  errorCases: [
    { input: {}, code: 'MISSING_FIELD' },
    { input: { text: '' }, code: 'MISSING_FIELD' },
    { input: { text: ['£1'] }, code: 'INVALID_INPUT' }
  ],
  run (input) {
    const amounts = [];
    const symbolRe = /([£$€¥₹₩₺₽])\s?([\d,]+(?:\.\d{1,2})?)/g;
    const codeRe = /([\d,]+(?:\.\d{1,2})?)\s?([A-Z]{3})\b/g;

    for (const m of input.text.matchAll(symbolRe)) {
      amounts.push({ value: Number(m[2].replace(/,/g, '')), currency: SYMBOLS[m[1]], text: m[0], at: m.index });
    }
    /* Only a real currency code: "5 PMS" is three capitals, not money. */
    for (const m of input.text.matchAll(codeRe)) {
      if (!CURRENCIES[m[2]]) continue;
      amounts.push({ value: Number(m[1].replace(/,/g, '')), currency: m[2], text: m[0], at: m.index });
    }
    /* By where each was found — "$5 … $5" are two amounts in two places, and
       looking the text up again would put both at the first. */
    amounts.sort((a, b) => a.at - b.at);
    for (const a of amounts) delete a.at;

    const currencies = [...new Set(amounts.map(a => a.currency))];
    return ok({
      amounts, formatted: amounts.map(a => a.text), count: amounts.length,
      /* The total is only meaningful in one currency. `mixed` says when it is
         not, so a renderer never presents a sum across currencies as money. */
      total: round(amounts.reduce((n, a) => n + a.value, 0), 2),
      currencies, mixed: currencies.length > 1
    }, computed());
  }
};
