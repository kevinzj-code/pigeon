import { ok, fail, computed } from '../src/contracts.js';

export default {
  name: 'isLeapYear',
  description: 'Say whether a year is a leap year, and how many days it has.',
  category: 'dates', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  title: 'Is it a leap year',
  replyTemplate: '{{year}} {{verdict|prose}} — {{days}} days, with {{februaryDays}} in February. The next leap year is {{nextLeapYear}}.',
  inputSchema: {
    type: 'object', required: ['year'],
    properties: { year: { type: 'integer', label: 'year', minimum: 1, maximum: 9999, prompt: 'Which year?' } }
  },
  outputSchema: {
    type: 'object',
    properties: { leap: { type: 'boolean' }, year: { type: 'integer' }, days: { type: 'integer' }, februaryDays: { type: 'integer' }, verdict: { type: 'string' }, nextLeapYear: { type: 'integer' }, reason: { type: 'string' } }
  },
  examples: [
    { text: 'is 2026 a leap year', input: { year: 2026 }, output: { leap: false, year: 2026, days: 365, februaryDays: 28, verdict: 'is not a leap year', nextLeapYear: 2028, reason: 'not divisible by 4' } },
    { text: 'is 2028 a leap year', input: { year: 2028 }, output: { leap: true, year: 2028, days: 366, februaryDays: 29, verdict: 'is a leap year', nextLeapYear: 2032, reason: 'divisible by 4' } },
    { text: 'was 1900 a leap year', input: { year: 1900 }, output: { leap: false, year: 1900, days: 365, februaryDays: 28, verdict: 'is not a leap year', nextLeapYear: 1904, reason: 'divisible by 100 but not by 400' } },
    { text: 'was 2000 a leap year', input: { year: 2000 }, output: { leap: true, year: 2000, days: 366, februaryDays: 29, verdict: 'is a leap year', nextLeapYear: 2004, reason: 'divisible by 400' } },
    { text: 'is 2024 a leap year', input: { year: 2024 }, output: { leap: true, year: 2024, days: 366, februaryDays: 29, verdict: 'is a leap year', nextLeapYear: 2028, reason: 'divisible by 4' } }
  ],
  errorCases: [
    { input: { year: 0 }, code: 'INVALID_INPUT' },
    { input: { year: 'last year' }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' }
  ],
  run (input) {
    const y = input.year;
    if (!Number.isInteger(y)) return fail('INVALID_INPUT', 'A year has to be a whole number.', 'year');
    /* The full Gregorian rule, including the century exception people forget:
       1900 was not a leap year and 2000 was. `reason` names which clause
       decided it, because "no" without the reason is the part that surprises. */
    const isLeap = (n) => (n % 4 === 0 && n % 100 !== 0) || n % 400 === 0;
    const leap = isLeap(y);
    const reason = y % 400 === 0 ? 'divisible by 400'
      : y % 100 === 0 ? 'divisible by 100 but not by 400'
        : y % 4 === 0 ? 'divisible by 4' : 'not divisible by 4';
    let next = y + 1;
    while (!isLeap(next)) next += 1;
    return ok({
      leap, year: y, days: leap ? 366 : 365, februaryDays: leap ? 29 : 28,
      verdict: leap ? 'is a leap year' : 'is not a leap year',
      nextLeapYear: next, reason
    }, computed());
  }
};
