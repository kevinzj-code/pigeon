import { ok, fail, computed } from '../src/contracts.js';
import { round } from '../src/lib/num.js';

/* §9's header again: "rates always supplied, never assumed". There is no
   bundled VAT table here and there should not be — rates vary by country, by
   region, by product category and by year, and a wrong one applied confidently
   is a wrong invoice. The rate is a required input, so a user who does not
   supply it gets asked rather than guessed at. */
export default {
  name: 'applyTax',
  description: 'Add tax to a price, or work backwards from a price that already includes it, at a rate you supply.',
  category: 'finance',
  tier: 'core',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: 'Net {{net}}, tax {{tax}} at {{rate}}%, gross {{gross}}.',
  inputSchema: {
    type: 'object',
    required: ['amount', 'rate'],
    properties: {
      amount: { type: 'number', label: 'amount', carry: true, minimum: 0, prompt: 'What is the amount?' },
      rate: { type: 'number', label: 'tax rate %', minimum: 0, maximum: 100, prompt: 'What tax rate, as a percentage?' },
      amountIncludesTax: { type: 'boolean', label: 'already includes tax', default: false, description: 'the amount given is the gross, work backwards' }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      net: { type: 'number' }, tax: { type: 'number' }, gross: { type: 'number' },
      rate: { type: 'number' }, direction: { type: 'string' }
    }
  },
  examples: [
    { text: 'add 20% vat to 250', input: { amount: 250, rate: 20 },
      output: { net: 250, tax: 50, gross: 300, rate: 20, direction: 'added to the net' } },
    { text: 'what is the vat included in 300 at 20%', input: { amount: 300, rate: 20, amountIncludesTax: true },
      output: { net: 250, tax: 50, gross: 300, rate: 20, direction: 'taken out of the gross' } },
    { text: 'add 8.875% sales tax to 49.99', input: { amount: 49.99, rate: 8.875 },
      output: { net: 49.99, tax: 4.44, gross: 54.43, rate: 8.875, direction: 'added to the net' } },
    { text: 'how much of my 1200 invoice is 5% tax', input: { amount: 1200, rate: 5, amountIncludesTax: true },
      output: { net: 1142.86, tax: 57.14, gross: 1200, rate: 5, direction: 'taken out of the gross' } },
    { text: 'add zero rated tax to 80', input: { amount: 80, rate: 0 },
      output: { net: 80, tax: 0, gross: 80, rate: 0, direction: 'added to the net' } }
  ],
  errorCases: [
    { input: { amount: 100, rate: -5 }, code: 'INVALID_INPUT' },
    { input: { amount: 100, rate: 150 }, code: 'INVALID_INPUT' },
    { input: { amount: 100 }, code: 'MISSING_FIELD' }
  ],
  run (input) {
    if (!Number.isFinite(input.amount)) return fail('INVALID_INPUT', 'That is not an amount I can work with.', 'amount');
    let net, tax, gross;
    if (input.amountIncludesTax) {
      /* Dividing by (1 + rate), not multiplying by (1 − rate). Taking 20% off
         a gross of 300 gives 240, and the net is 250 — the classic
         reverse-VAT error, and the reason this branch exists at all. */
      net = round(input.amount / (1 + input.rate / 100), 2);
      gross = round(input.amount, 2);
      tax = round(gross - net, 2);
    } else {
      net = round(input.amount, 2);
      tax = round(net * input.rate / 100, 2);
      gross = round(net + tax, 2);
    }
    return ok({
      net, tax, gross, rate: input.rate,
      direction: input.amountIncludesTax ? 'taken out of the gross' : 'added to the net'
    }, computed());
  }
};
