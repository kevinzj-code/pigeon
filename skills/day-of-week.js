import { ok, fail, computed } from '../src/contracts.js';
import { parseDate, toISO, weekdayOf, isoWeek } from '../src/lib/dates.js';

export default {
  name: 'dayOfWeek',
  description: "Name the weekday a date lands on — a Monday, a Saturday.",
  category: 'dates',
  tier: 'core',
  unbuilt: false,
  needsNetwork: false,
  dataAsOf: null,
  labels: [],
  replyTemplate: '{{date|date}} is a {{weekday}} (ISO week {{week}}).',
  inputSchema: {
    type: 'object',
    required: ['date'],
    properties: { date: { type: 'string', label: 'date', prompt: 'Which date?', description: 'a date' } }
  },
  outputSchema: {
    type: 'object',
    properties: {
      weekday: { type: 'string' }, date: { type: 'string' }, week: { type: 'integer' },
      weekYear: { type: 'integer' }, weekend: { type: 'boolean' }
    }
  },
  examples: [
    { text: 'what day of the week is 14 November 2026', input: { date: '2026-11-14' },
      output: { weekday: 'Saturday', date: '2026-11-14', week: 46, weekYear: 2026, weekend: true } },
    { text: 'is christmas 2026 a weekday', input: { date: '2026-12-25' },
      output: { weekday: 'Friday', date: '2026-12-25', week: 52, weekYear: 2026, weekend: false } },
    { text: 'what day was 1 January 2000', input: { date: '2000-01-01' },
      output: { weekday: 'Saturday', date: '2000-01-01', week: 52, weekYear: 1999, weekend: true } },
    { text: 'day of week for 29 Feb 2024', input: { date: '2024-02-29' },
      output: { weekday: 'Thursday', date: '2024-02-29', week: 9, weekYear: 2024, weekend: false } },
    { text: 'what day is 2026-06-01', input: { date: '2026-06-01' },
      output: { weekday: 'Monday', date: '2026-06-01', week: 23, weekYear: 2026, weekend: false } },
    { text: 'which weekday is 2026-10-31, and is it a sunday', input: { date: '2026-10-31' },
      output: { weekday: 'Saturday', date: '2026-10-31', week: 44, weekYear: 2026, weekend: true } },
    { text: 'does 25 december 2026 fall on a weekend day', input: { date: '2026-12-25' },
      output: { weekday: 'Friday', date: '2026-12-25', week: 52, weekYear: 2026, weekend: false } }
  ],
  errorCases: [
    { input: { date: 'blueberry' }, code: 'INVALID_INPUT' },
    { input: { date: '2026-02-31' }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' }
  ],
  run (input, ctx) {
    const d = parseDate(input.date, ctx);
    if (!d.ok) return fail('INVALID_INPUT', `I couldn't read "${input.date}" as a date (${d.reason}).`, 'date');
    const wd = weekdayOf(d.ymd);
    const { week, year } = isoWeek(d.ymd);
    return ok({
      weekday: wd, date: toISO(d.ymd), week, weekYear: year,
      weekend: wd === 'Saturday' || wd === 'Sunday'
    }, computed());
  }
};
