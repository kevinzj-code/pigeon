import { ok, fail, computed } from '../src/contracts.js';
import { round } from '../src/lib/num.js';

const PER_YEAR = { annually: 1, 'semi-annually': 2, quarterly: 4, monthly: 12, weekly: 52, daily: 365 };

export default {
  name: 'compoundInterest',
  description: "Grow a sum year on year, with each year’s interest earning interest too.",
  category: 'finance', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{principal|comma}} grows to {{total|comma}} in {{years}} {{years|plural:year:years}} at {{rate}}% compounded {{frequency|prose}} — {{interest|comma}} of interest.',
  inputSchema: {
    type: 'object', required: ['principal', 'rate', 'years'],
    properties: {
      principal: { type: 'number', label: 'starting amount', carry: true, exclusiveMinimum: 0, prompt: 'How much is the starting amount?' },
      rate: { type: 'number', label: 'annual rate %', minimum: 0, prompt: 'What annual interest rate, as a percentage?' },
      years: { type: 'number', label: 'years', exclusiveMinimum: 0, prompt: 'Over how many years?' },
      frequency: { type: 'string', label: 'compounding', enum: Object.keys(PER_YEAR), default: 'annually' },
      contribution: { type: 'number', label: 'added each period', minimum: 0, default: 0, description: 'added each compounding period' }
    }
  },
  outputSchema: { type: 'object', properties: { total: { type: 'number' }, interest: { type: 'number' }, principal: { type: 'number' }, contributed: { type: 'number' }, rate: { type: 'number' }, years: { type: 'number' }, frequency: { type: 'string' }, effectiveRate: { type: 'number' } } },
  examples: [
    { text: 'what does 1000 grow to at 5% for 10 years', input: { principal: 1000, rate: 5, years: 10 }, output: { total: 1628.89, interest: 628.89, principal: 1000, contributed: 0, rate: 5, years: 10, frequency: 'annually', effectiveRate: 5 } },
    { text: 'compound 5000 at 4% monthly for 5 years', input: { principal: 5000, rate: 4, years: 5, frequency: 'monthly' }, output: { total: 6104.98, interest: 1104.98, principal: 5000, contributed: 0, rate: 4, years: 5, frequency: 'monthly', effectiveRate: 4.07 } },
    { text: 'save 200 a month at 6% for 20 years', input: { principal: 0.01, rate: 6, years: 20, frequency: 'monthly', contribution: 200 }, output: { total: 92408.21, interest: 44408.2, principal: 0.01, contributed: 48000, rate: 6, years: 20, frequency: 'monthly', effectiveRate: 6.17 } },
    { text: 'compound 2500 quarterly at 3% for 3 years', input: { principal: 2500, rate: 3, years: 3, frequency: 'quarterly' }, output: { total: 2734.52, interest: 234.52, principal: 2500, contributed: 0, rate: 3, years: 3, frequency: 'quarterly', effectiveRate: 3.03 } },
    { text: 'growth at zero interest', input: { principal: 1000, rate: 0, years: 5 }, output: { total: 1000, interest: 0, principal: 1000, contributed: 0, rate: 0, years: 5, frequency: 'annually', effectiveRate: 0 } }
  ],
  errorCases: [
    { input: { principal: 1000, rate: 5, years: 0 }, code: 'INVALID_INPUT' },
    { input: { principal: 1000, rate: 5, years: 3, frequency: 'hourly' }, code: 'INVALID_INPUT' },
    { input: { principal: 1000, rate: 5 }, code: 'MISSING_FIELD' }
  ],
  run (input) {
    const n = PER_YEAR[input.frequency];
    if (!n) return fail('INVALID_INPUT', `I don't compound ${input.frequency}.`, 'frequency');
    const periods = input.years * n;
    const r = input.rate / 100 / n;

    /* Two parts: the principal compounding, plus the future value of a regular
       contribution made every period. The r === 0 branch matters — the annuity
       formula divides by r, and a zero-rate account still accumulates the
       deposits. */
    const grown = input.principal * Math.pow(1 + r, periods);
    const fromContributions = input.contribution === 0 ? 0
      : r === 0 ? input.contribution * periods
        : input.contribution * ((Math.pow(1 + r, periods) - 1) / r);
    const total = grown + fromContributions;
    const contributed = input.contribution * periods;

    return ok({
      total: round(total, 2),
      interest: round(total - input.principal - contributed, 2),
      principal: input.principal, contributed: round(contributed, 2),
      rate: input.rate, years: input.years, frequency: input.frequency,
      /* The annual rate you actually get once compounding is counted — the
         number that makes "4% monthly" comparable to "4.07% annually". */
      effectiveRate: round((Math.pow(1 + r, n) - 1) * 100, 2)
    }, computed());
  }
};
