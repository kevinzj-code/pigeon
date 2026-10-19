import { ok, fail, computed } from '../src/contracts.js';
import { round } from '../src/lib/num.js';

export default {
  name: 'savingsGoal',
  description: 'Work out how long a savings goal takes, or how much to put aside each month.',
  category: 'finance', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{summary|prose}}',
  inputSchema: {
    type: 'object', required: ['target', 'annualRate'],
    properties: {
      target: { type: 'number', label: 'savings goal', carry: true, minimum: 0.01, prompt: 'How much do you want to save?' },
      annualRate: { type: 'number', label: 'annual rate %', minimum: 0, maximum: 100, prompt: 'What annual interest rate does the account pay? Use 0 if it pays none.' },
      monthly: { type: 'number', label: 'monthly deposit', minimum: 0.01, description: 'how much goes in each month' },
      months: { type: 'integer', label: 'months', minimum: 1, maximum: 1200, description: 'how many months you have' }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      months: { type: 'integer' }, monthly: { type: 'number' }, finalBalance: { type: 'number' },
      totalDeposited: { type: 'number' }, interestEarned: { type: 'number' },
      target: { type: 'number' }, solvedFor: { type: 'string' }, summary: { type: 'string' }
    }
  },
  examples: [
    { text: 'how long to save 10000 at 250 a month with no interest', input: { target: 10000, monthly: 250, annualRate: 0 }, output: { months: 40, monthly: 250, finalBalance: 10000, totalDeposited: 10000, interestEarned: 0, target: 10000, solvedFor: 'months', summary: '40 months at 250 a month reaches 10000. You would pay in 10000 and earn 0 in interest.' } },
    { text: 'how many months to save 10000 at 250 a month at 3 percent', input: { target: 10000, monthly: 250, annualRate: 3 }, output: { months: 39, monthly: 250, finalBalance: 10227.73, totalDeposited: 9750, interestEarned: 477.73, target: 10000, solvedFor: 'months', summary: '39 months at 250 a month reaches 10227.73. You would pay in 9750 and earn 477.73 in interest.' } },
    { text: 'saving 100 a month at 2 percent for a 5000 goal', input: { target: 5000, monthly: 100, annualRate: 2 }, output: { months: 49, monthly: 100, finalBalance: 5101.22, totalDeposited: 4900, interestEarned: 201.22, target: 5000, solvedFor: 'months', summary: '49 months at 100 a month reaches 5101.22. You would pay in 4900 and earn 201.22 in interest.' } },
    { text: 'how much a month to save 10000 in 24 months at 3 percent', input: { target: 10000, months: 24, annualRate: 3 }, output: { months: 24, monthly: 404.81, finalBalance: 10000, totalDeposited: 9715.44, interestEarned: 284.56, target: 10000, solvedFor: 'monthly', summary: '404.81 a month for 24 months reaches 10000. You would pay in 9715.44 and earn 284.56 in interest.' } },
    { text: 'what monthly amount saves 6000 in 3 years at 2.5 percent', input: { target: 6000, months: 36, annualRate: 2.5 }, output: { months: 36, monthly: 160.67, finalBalance: 6000, totalDeposited: 5784.12, interestEarned: 215.88, target: 6000, solvedFor: 'monthly', summary: '160.67 a month for 36 months reaches 6000. You would pay in 5784.12 and earn 215.88 in interest.' } }
  ],
  errorCases: [
    { input: { target: 10000, annualRate: 3 }, code: 'INVALID_INPUT' },
    { input: { target: 10000, annualRate: 3, monthly: 250, months: 24 }, code: 'INVALID_INPUT' },
    { input: { monthly: 250, annualRate: 3 }, code: 'MISSING_FIELD' }
  ],
  run (input) {
    const hasMonthly = input.monthly !== undefined;
    const hasMonths = input.months !== undefined;
    if (hasMonthly === hasMonths) {
      return fail('INVALID_INPUT', hasMonthly
        ? 'Give me either the monthly amount or the number of months — with both, there is nothing left to work out.'
        : 'I need one of the two: how much you can save each month, or how many months you have.', 'monthly');
    }

    /* Section 9 again: the rate is supplied, never assumed. Deposits are treated
       as landing at the end of each month, which is how a standing order into a
       savings account actually behaves. */
    const r = input.annualRate / 100 / 12;

    if (hasMonthly) {
      const monthly = input.monthly;
      const months = r === 0
        ? Math.ceil(input.target / monthly)
        : Math.ceil(Math.log(1 + (input.target * r) / monthly) / Math.log(1 + r));
      /* The last month usually overshoots — you cannot pay in a fraction of a
         standing order — so the final balance is at or above the target, and
         the amount above it is reported rather than trimmed away. */
      let balance = 0;
      for (let i = 0; i < months; i++) balance = balance * (1 + r) + monthly;
      const totalDeposited = round(monthly * months, 2);
      const finalBalance = round(balance, 2);
      return ok({
        months, monthly, finalBalance, totalDeposited,
        interestEarned: round(finalBalance - totalDeposited, 2),
        target: input.target, solvedFor: 'months',
        summary: `${months} months at ${monthly} a month reaches ${finalBalance}. You would pay in ${totalDeposited} and earn ${round(finalBalance - totalDeposited, 2)} in interest.`
      }, computed());
    }

    const months = input.months;
    const exact = r === 0 ? input.target / months : (input.target * r) / ((1 + r) ** months - 1);
    const monthly = round(exact, 2);
    const totalDeposited = round(monthly * months, 2);
    const finalBalance = round(input.target, 2);
    return ok({
      months, monthly, finalBalance, totalDeposited,
      interestEarned: round(finalBalance - totalDeposited, 2),
      target: input.target, solvedFor: 'monthly',
      summary: `${monthly} a month for ${months} months reaches ${finalBalance}. You would pay in ${totalDeposited} and earn ${round(finalBalance - totalDeposited, 2)} in interest.`
    }, computed());
  }
};
