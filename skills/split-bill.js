import { ok, fail, computed } from '../src/contracts.js';
import { round, splitAmount } from '../src/lib/num.js';

export default {
  name: 'splitBill',
  description: 'Add a tip to a bill and split it between people, to the exact penny.',
  category: 'everyday',
  tier: 'core',
  unbuilt: false,
  needsNetwork: false,
  dataAsOf: null,
  labels: [],
  title: 'Split a bill',
  replyTemplate: '{{total|cur:2}} in total with a {{tipPercent}}% tip — {{perPerson|cur:2}} each, between {{people}} {{people|plural:person:people}}.',
  /* A tip or a head count nobody gave is not said back as if they had. */
  replyWhenDefault: [
    { defaults: ['tipPercent', 'people'], template: '{{total|cur:2}} in total, no tip.' },
    { defaults: ['tipPercent'], template: '{{total|cur:2}} in total, no tip — {{perPerson|cur:2}} each, between {{people}} {{people|plural:person:people}}.' },
    { defaults: ['people'], template: '{{total|cur:2}} in total with a {{tipPercent}}% tip.' }
  ],
  inputSchema: {
    type: 'object',
    required: ['bill'],
    properties: {
      bill: { type: 'number', carry: true, exclusiveMinimum: 0, prompt: 'How much was the bill?', label: 'bill' },
      tipPercent: { type: 'number', minimum: 0, maximum: 100, default: 0, label: 'tip %' },
      people: { type: 'integer', minimum: 1, default: 1, label: 'people' },
      currency: { type: 'string', enum: ['£', '$', '€', '₹', '¥'], label: 'currency' }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      total: { type: 'number' }, tip: { type: 'number' }, bill: { type: 'number' },
      tipPercent: { type: 'number' }, people: { type: 'integer' },
      perPerson: { type: 'array', items: { type: 'number' } }, even: { type: 'boolean' },
      currency: { type: 'string' }
    }
  },
  examples: [
    { text: 'split a 84.50 bill four ways with 15% tip', input: { bill: 84.5, tipPercent: 15, people: 4 },
      output: { total: 97.18, tip: 12.68, bill: 84.5, tipPercent: 15, people: 4, perPerson: [24.3, 24.3, 24.29, 24.29], even: false } },
    { text: 'what is 20% tip on 60', input: { bill: 60, tipPercent: 20 },
      output: { total: 72, tip: 12, bill: 60, tipPercent: 20, people: 1, perPerson: [72], even: true } },
    { text: 'split 100 between 3 of us', input: { bill: 100, people: 3 },
      output: { total: 100, tip: 0, bill: 100, tipPercent: 0, people: 3, perPerson: [33.34, 33.33, 33.33], even: false } },
    { text: 'dinner was 45.60, 12.5 percent tip, two people', input: { bill: 45.6, tipPercent: 12.5, people: 2 },
      output: { total: 51.3, tip: 5.7, bill: 45.6, tipPercent: 12.5, people: 2, perPerson: [25.65, 25.65], even: true } },
    { text: 'bill of 200 split 8 ways with 10% service', input: { bill: 200, tipPercent: 10, people: 8 },
      output: { total: 220, tip: 20, bill: 200, tipPercent: 10, people: 8, perPerson: [27.5, 27.5, 27.5, 27.5, 27.5, 27.5, 27.5, 27.5], even: true } }
  ],
  errorCases: [
    { input: { bill: -20 }, code: 'INVALID_INPUT' },
    { input: { bill: 50, people: 0 }, code: 'INVALID_INPUT' },
    { input: { tipPercent: 15 }, code: 'MISSING_FIELD' }
  ],
  run (input) {
    const tip = round(input.bill * (input.tipPercent / 100), 2);
    const total = round(input.bill + tip, 2);
    /* Largest-remainder, so the shares SUM to the total. Dividing and rounding
       each share independently leaves the table 1p short, which is exactly the
       kind of small wrongness nobody notices and everybody re-checks. */
    const perPerson = splitAmount(total, input.people, 2);
    if (!perPerson.every(Number.isFinite)) return fail('INTERNAL', 'That split did not come out to numbers.', 'people');
    return ok({
      total, tip, bill: input.bill,
      tipPercent: input.tipPercent, people: input.people,
      perPerson,
      even: new Set(perPerson).size === 1,
      /* Only ever a symbol the person typed; never a guessed one. */
      ...(input.currency ? { currency: input.currency } : {})
    }, computed());
  }
};
