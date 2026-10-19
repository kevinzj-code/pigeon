import { ok, fail, computed } from '../src/contracts.js';
import { round } from '../src/lib/num.js';

export default {
  name: 'amortizeLoan',
  description: 'Work out the monthly payment and total interest on a loan.',
  category: 'finance', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  title: 'Loan repayments',
  replyTemplate: '{{monthlyPayment}} a month for {{months}} months at {{annualRate}}% — {{totalPaid}} paid in all, of which {{totalInterest}} is interest.',
  inputSchema: {
    type: 'object', required: ['principal', 'annualRate', 'months'],
    properties: {
      principal: { type: 'number', label: 'loan amount', carry: true, minimum: 0.01, prompt: 'How much is borrowed?' },
      annualRate: { type: 'number', label: 'annual rate %', minimum: 0, maximum: 100, prompt: 'What is the annual interest rate, as a percentage?' },
      months: { type: 'integer', label: 'term (months)', minimum: 1, maximum: 1200, prompt: 'Over how many months?' }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      monthlyPayment: { type: 'number' }, totalPaid: { type: 'number' }, totalInterest: { type: 'number' },
      principal: { type: 'number' }, annualRate: { type: 'number' }, months: { type: 'integer' },
      monthlyRate: { type: 'number' }
    }
  },
  examples: [
    { text: 'monthly payment on a 200000 mortgage at 5 percent over 30 years', input: { principal: 200000, annualRate: 5, months: 360 }, output: { monthlyPayment: 1073.64, totalPaid: 386510.4, totalInterest: 186510.4, principal: 200000, annualRate: 5, months: 360, monthlyRate: 0.0041667 } },
    { text: 'repayments on a 15000 car loan at 7.5% over 5 years', input: { principal: 15000, annualRate: 7.5, months: 60 }, output: { monthlyPayment: 300.57, totalPaid: 18034.2, totalInterest: 3034.2, principal: 15000, annualRate: 7.5, months: 60, monthlyRate: 0.00625 } },
    { text: 'amortise 100000 at 3.25 percent over 20 years', input: { principal: 100000, annualRate: 3.25, months: 240 }, output: { monthlyPayment: 567.2, totalPaid: 136128, totalInterest: 36128, principal: 100000, annualRate: 3.25, months: 240, monthlyRate: 0.0027083 } },
    { text: 'interest free loan of 1200 over 12 months', input: { principal: 1200, annualRate: 0, months: 12 }, output: { monthlyPayment: 100, totalPaid: 1200, totalInterest: 0, principal: 1200, annualRate: 0, months: 12, monthlyRate: 0 } },
    { text: 'monthly cost of borrowing 5000 at 10% for 24 months', input: { principal: 5000, annualRate: 10, months: 24 }, output: { monthlyPayment: 230.72, totalPaid: 5537.28, totalInterest: 537.28, principal: 5000, annualRate: 10, months: 24, monthlyRate: 0.0083333 } }
  ],
  errorCases: [
    { input: { principal: 1000, annualRate: 5 }, code: 'MISSING_FIELD' },
    { input: { principal: 0, annualRate: 5, months: 12 }, code: 'INVALID_INPUT' },
    { input: { principal: 1000, annualRate: 5, months: 0 }, code: 'INVALID_INPUT' }
  ],
  run (input) {
    const { principal, annualRate, months } = input;
    /* Section 9: the rate is always supplied and never assumed. There is no
       bundled "typical mortgage rate" here and there should not be - the number
       that matters is the one on the offer in front of the borrower. */
    const monthlyRate = annualRate / 100 / 12;
    const payment = monthlyRate === 0
      ? principal / months
      : (principal * monthlyRate) / (1 - (1 + monthlyRate) ** -months);
    /* The total is the ROUNDED payment times the term, not the exact one. A
       lender charges whole pence and squares the difference off against the
       final instalment, and more to the point: anyone who multiplies the
       monthly figure shown here by the number of months should get the total
       shown here. An exact-payment total is off by a few pence and looks like
       an arithmetic error. */
    const monthlyPayment = round(payment, 2);
    const totalPaid = round(monthlyPayment * months, 2);

    return ok({
      monthlyPayment,
      totalPaid,
      totalInterest: round(totalPaid - principal, 2),
      principal, annualRate, months,
      monthlyRate: round(monthlyRate, 7)
    }, computed());
  }
};
