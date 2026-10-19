import { ok, fail, computed } from '../src/contracts.js';
import { parseDate, toISO, dayNumber } from '../src/lib/dates.js';
import { round } from '../src/lib/num.js';

export default {
  name: 'dayOfYear',
  description: 'Which numbered day of the year a date is, and how much of the year is left.',
  category: 'dates', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{date|date}} is day {{day}} of {{totalDays}} — {{percent}}% through {{year}}, with {{remaining}} days left.',
  inputSchema: {
    type: 'object', required: ['date'],
    properties: { date: { type: 'string', label: 'date', prompt: 'Which date?', description: 'a date' } }
  },
  outputSchema: {
    type: 'object',
    properties: { day: { type: 'integer' }, totalDays: { type: 'integer' }, remaining: { type: 'integer' }, percent: { type: 'number' }, year: { type: 'integer' }, date: { type: 'string' } }
  },
  examples: [
    { text: 'what day of the year is 2026-11-14', input: { date: '2026-11-14' }, output: { day: 318, totalDays: 365, remaining: 47, percent: 87.12, year: 2026, date: '2026-11-14' } },
    { text: 'which day of the year is christmas 2026', input: { date: '2026-12-25' }, output: { day: 359, totalDays: 365, remaining: 6, percent: 98.36, year: 2026, date: '2026-12-25' } },
    { text: 'day of year for 2024-03-01 in a leap year', input: { date: '2024-03-01' }, output: { day: 61, totalDays: 366, remaining: 305, percent: 16.67, year: 2024, date: '2024-03-01' } },
    { text: 'what number day is 2026-01-01', input: { date: '2026-01-01' }, output: { day: 1, totalDays: 365, remaining: 364, percent: 0.27, year: 2026, date: '2026-01-01' } },
    { text: 'day of the year for 2026-06-30', input: { date: '2026-06-30' }, output: { day: 181, totalDays: 365, remaining: 184, percent: 49.59, year: 2026, date: '2026-06-30' } }
  ],
  errorCases: [
    { input: { date: 'whenever' }, code: 'INVALID_INPUT' },
    { input: { date: '2026-02-30' }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' }
  ],
  run (input, ctx) {
    const d = parseDate(input.date, ctx);
    if (!d.ok) return fail('INVALID_INPUT', `I couldn't read "${input.date}" as a date (${d.reason}).`, 'date');
    const { y } = d.ymd;
    const day = dayNumber(y, d.ymd.m, d.ymd.d) - dayNumber(y, 1, 1) + 1;
    const totalDays = dayNumber(y + 1, 1, 1) - dayNumber(y, 1, 1);
    return ok({
      day, totalDays, remaining: totalDays - day,
      percent: round(day / totalDays * 100, 2),
      year: y, date: toISO(d.ymd)
    }, computed());
  }
};
