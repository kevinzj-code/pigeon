import { ok, fail, computed } from '../src/contracts.js';

const NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

export default {
  name: 'daysInMonth',
  description: 'Say how many days long a given month is.',
  category: 'dates', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{monthName|prose}} {{year}} has {{days}} days — {{weekdays}} weekdays and {{weekendDays}} weekend days.',
  inputSchema: {
    type: 'object', required: ['month', 'year'],
    properties: {
      month: { type: 'integer', label: 'month (1–12)', minimum: 1, maximum: 12, prompt: 'Which month, as a number 1–12?' },
      year: { type: 'integer', label: 'year', minimum: 1, maximum: 9999, prompt: 'Which year?' }
    }
  },
  outputSchema: {
    type: 'object',
    properties: { days: { type: 'integer' }, month: { type: 'integer' }, monthName: { type: 'string' }, year: { type: 'integer' }, weekdays: { type: 'integer' }, weekendDays: { type: 'integer' }, firstWeekday: { type: 'string' } }
  },
  examples: [
    { text: 'how many days in february 2026', input: { month: 2, year: 2026 }, output: { days: 28, month: 2, monthName: 'February', year: 2026, weekdays: 20, weekendDays: 8, firstWeekday: 'Sunday' } },
    { text: 'days in february 2028', input: { month: 2, year: 2028 }, output: { days: 29, month: 2, monthName: 'February', year: 2028, weekdays: 21, weekendDays: 8, firstWeekday: 'Tuesday' } },
    { text: 'how long is september 2026', input: { month: 9, year: 2026 }, output: { days: 30, month: 9, monthName: 'September', year: 2026, weekdays: 22, weekendDays: 8, firstWeekday: 'Tuesday' } },
    { text: 'days in december 2026', input: { month: 12, year: 2026 }, output: { days: 31, month: 12, monthName: 'December', year: 2026, weekdays: 23, weekendDays: 8, firstWeekday: 'Tuesday' } },
    { text: 'how many days in january 2027', input: { month: 1, year: 2027 }, output: { days: 31, month: 1, monthName: 'January', year: 2027, weekdays: 21, weekendDays: 10, firstWeekday: 'Friday' } }
  ],
  errorCases: [
    { input: { month: 13, year: 2026 }, code: 'INVALID_INPUT' },
    { input: { month: 0, year: 2026 }, code: 'INVALID_INPUT' },
    { input: { month: 2 }, code: 'MISSING_FIELD' }
  ],
  run (input) {
    const { month, year } = input;
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      return fail('INVALID_INPUT', 'The month has to be a number from 1 to 12.', 'month');
    }
    const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
    /* The weekday split is the reason anyone asks this in a planning context —
       "how many working days is that" is usually the next question. */
    let weekdays = 0, weekendDays = 0;
    for (let d = 1; d <= days; d++) {
      const dow = new Date(Date.UTC(year, month - 1, d)).getUTCDay();
      if (dow === 0 || dow === 6) weekendDays++; else weekdays++;
    }
    const WD = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return ok({
      days, month, monthName: NAMES[month - 1], year, weekdays, weekendDays,
      firstWeekday: WD[new Date(Date.UTC(year, month - 1, 1)).getUTCDay()]
    }, computed());
  }
};
