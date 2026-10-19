import { ok, computed } from '../src/contracts.js';
import { round } from '../src/lib/num.js';

export default {
  name: 'simpleInterest',
  description: "Charge flat interest on the original amount only, never on the interest.",
  category: 'finance', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{interest|comma}} interest on {{principal|comma}} at {{rate}}% for {{years}} {{years|plural:year:years}} — {{total|comma}} in total.',
  inputSchema: {
    type: 'object', required: ['principal', 'rate', 'years'],
    properties: {
      principal: { type: 'number', label: 'starting amount', carry: true, exclusiveMinimum: 0, prompt: 'How much is the principal?' },
      rate: { type: 'number', label: 'annual rate %', minimum: 0, prompt: 'What annual interest rate, as a percentage?' },
      years: { type: 'number', label: 'years', exclusiveMinimum: 0, prompt: 'Over how many years?' }
    }
  },
  outputSchema: { type: 'object', properties: { interest: { type: 'number' }, total: { type: 'number' }, principal: { type: 'number' }, rate: { type: 'number' }, years: { type: 'number' }, perYear: { type: 'number' } } },
  examples: [
    { text: 'simple interest on 1000 at 5% for 3 years', input: { principal: 1000, rate: 5, years: 3 }, output: { interest: 150, total: 1150, principal: 1000, rate: 5, years: 3, perYear: 50 } },
    { text: 'how much interest on 2500 at 4.5% over 2 years', input: { principal: 2500, rate: 4.5, years: 2 }, output: { interest: 225, total: 2725, principal: 2500, rate: 4.5, years: 2, perYear: 112.5 } },
    { text: 'interest on 500 at 10% for half a year', input: { principal: 500, rate: 10, years: 0.5 }, output: { interest: 25, total: 525, principal: 500, rate: 10, years: 0.5, perYear: 50 } },
    { text: 'simple interest at zero percent', input: { principal: 800, rate: 0, years: 5 }, output: { interest: 0, total: 800, principal: 800, rate: 0, years: 5, perYear: 0 } },
    { text: 'interest on 10000 at 3.25% for 10 years', input: { principal: 10000, rate: 3.25, years: 10 }, output: { interest: 3250, total: 13250, principal: 10000, rate: 3.25, years: 10, perYear: 325 } },
    { text: 'non-compounding interest on 500 at 4% for 2 years', input: { principal: 500, rate: 4, years: 2 },
      output: { interest: 40, total: 540, principal: 500, rate: 4, years: 2, perYear: 20 } },
    { text: 'flat interest on 1200 at 6 percent over 18 months', input: { principal: 1200, rate: 6, years: 1.5 },
      output: { interest: 108, total: 1308, principal: 1200, rate: 6, years: 1.5, perYear: 72 } }
  ],
  errorCases: [
    { input: { principal: -100, rate: 5, years: 2 }, code: 'INVALID_INPUT' },
    { input: { principal: 100, rate: 5, years: 0 }, code: 'INVALID_INPUT' },
    { input: { principal: 100, rate: 5 }, code: 'MISSING_FIELD' }
  ],
  run (input) {
    /* Simple, not compound: interest is on the ORIGINAL principal every year.
       compoundInterest is the other skill, and mixing them up understates a
       long-term total badly — which is why they are two skills, not a flag. */
    const perYear = input.principal * input.rate / 100;
    const interest = perYear * input.years;
    return ok({
      interest: round(interest, 2), total: round(input.principal + interest, 2),
      principal: input.principal, rate: input.rate, years: input.years,
      perYear: round(perYear, 2)
    }, computed());
  }
};
