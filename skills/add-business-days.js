import { ok, fail, computed } from '../src/contracts.js';
import { parseDate, toISO, dayNumber, fromDayNumber, weekdayOf, WEEKDAYS } from '../src/lib/dates.js';

export default {
  name: 'addBusinessDays',
  description: 'Move a date forward or back by a number of working days — three working days on from a Monday — skipping weekends and holidays.',
  category: 'dates', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  title: 'Add working days',
  replyTemplate: '{{days}} working days from {{startDate}} is {{result}}, a {{weekday}} — {{calendarDays}} calendar days later.',
  inputSchema: {
    type: 'object', required: ['date', 'days'],
    properties: {
      date: { type: 'string', label: 'start date', prompt: 'Which date should I start from?' },
      days: { type: 'integer', label: 'working days', minimum: -2000, maximum: 2000, prompt: 'How many working days?' },
      holidays: { type: 'array', label: 'holidays', items: { type: 'string' }, description: 'dates to skip as well as weekends, in YYYY-MM-DD form' }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      result: { type: 'string' }, weekday: { type: 'string' }, startDate: { type: 'string' },
      days: { type: 'integer' }, calendarDays: { type: 'integer' },
      weekendDaysSkipped: { type: 'integer' }, holidaysSkipped: { type: 'integer' }
    }
  },
  examples: [
    { text: 'what date is 5 working days from 1 September 2026', input: { date: '2026-09-01', days: 5 }, output: { result: '2026-09-08', weekday: 'Tuesday', startDate: '2026-09-01', days: 5, calendarDays: 7, weekendDaysSkipped: 2, holidaysSkipped: 0 } },
    { text: 'add 10 business days to 2026-09-01', input: { date: '2026-09-01', days: 10 }, output: { result: '2026-09-15', weekday: 'Tuesday', startDate: '2026-09-01', days: 10, calendarDays: 14, weekendDaysSkipped: 4, holidaysSkipped: 0 } },
    { text: 'one working day after 2026-09-01', input: { date: '2026-09-01', days: 1 }, output: { result: '2026-09-02', weekday: 'Wednesday', startDate: '2026-09-01', days: 1, calendarDays: 1, weekendDaysSkipped: 0, holidaysSkipped: 0 } },
    { text: 'three working days before 2026-09-01', input: { date: '2026-09-01', days: -3 }, output: { result: '2026-08-27', weekday: 'Thursday', startDate: '2026-09-01', days: -3, calendarDays: 5, weekendDaysSkipped: 2, holidaysSkipped: 0 } },
    { text: 'five working days from 2026-09-01 with a holiday on the third', input: { date: '2026-09-01', days: 5, holidays: ['2026-09-03'] }, output: { result: '2026-09-09', weekday: 'Wednesday', startDate: '2026-09-01', days: 5, calendarDays: 8, weekendDaysSkipped: 2, holidaysSkipped: 1 } }
  ],
  errorCases: [
    { input: { date: 'not a date', days: 5 }, code: 'INVALID_INPUT' },
    { input: { date: '2026-09-01' }, code: 'MISSING_FIELD' },
    { input: { date: '2026-09-01', days: 5, holidays: ['nonsense'] }, code: 'INVALID_INPUT' }
  ],
  run (input, ctx) {
    const parsed = parseDate(input.date, { ...ctx, now: input.now });
    if (!parsed.ok) return fail('INVALID_INPUT', `"${input.date}" is not a date I can read — ${parsed.reason}.`, 'date');
    const start = parsed.ymd;

    const holidays = new Set();
    for (const h of input.holidays ?? []) {
      const d = parseDate(h, { ...ctx, now: input.now });
      if (!d.ok) return fail('INVALID_INPUT', `"${h}" is not a date I can read — ${d.reason}.`, 'holidays');
      holidays.add(toISO(d.ymd));
    }

    /* Counting forward one day at a time rather than by arithmetic: weekends and
       holidays do not fall at a fixed spacing, so there is no closed form once
       an arbitrary holiday list is involved. */
    const step = input.days >= 0 ? 1 : -1;
    let cursor = dayNumber(start.y, start.m, start.d);
    let remaining = Math.abs(input.days);
    let calendarDays = 0;
    let weekendDaysSkipped = 0;
    let holidaysSkipped = 0;

    while (remaining > 0) {
      cursor += step;
      calendarDays++;
      const at = fromDayNumber(cursor);
      const name = weekdayOf(at);
      if (name === 'Saturday' || name === 'Sunday') { weekendDaysSkipped++; continue; }
      if (holidays.has(toISO(at))) { holidaysSkipped++; continue; }
      remaining--;
    }

    const end = fromDayNumber(cursor);
    return ok({
      result: toISO(end), weekday: weekdayOf(end), startDate: toISO(start),
      days: input.days, calendarDays, weekendDaysSkipped, holidaysSkipped
    }, computed());
  }
};
