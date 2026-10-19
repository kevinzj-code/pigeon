import { ok, fail, computed } from '../src/contracts.js';
import { parseDate, toISO, isoWeek, dayNumber, fromDayNumber } from '../src/lib/dates.js';

export default {
  name: 'isoWeek',
  description: "Number the week of the year a date sits in, and when that week begins.",
  category: 'dates', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  title: 'ISO week number',
  replyTemplate: '{{date|date}} is in ISO week {{week}} of {{weekYear}}, which runs {{weekStart|date}} to {{weekEnd|date}}.',
  inputSchema: {
    type: 'object', required: ['date'],
    properties: { date: { type: 'string', label: 'date', prompt: 'Which date?', description: 'a date' } }
  },
  outputSchema: {
    type: 'object',
    properties: { week: { type: 'integer' }, weekYear: { type: 'integer' }, date: { type: 'string' }, weekStart: { type: 'string' }, weekEnd: { type: 'string' }, label: { type: 'string' } }
  },
  examples: [
    { text: 'what iso week is 2026-11-14', input: { date: '2026-11-14' }, output: { week: 46, weekYear: 2026, date: '2026-11-14', weekStart: '2026-11-09', weekEnd: '2026-11-15', label: '2026-W46' } },
    { text: 'which week of the year is christmas 2026', input: { date: '2026-12-25' }, output: { week: 52, weekYear: 2026, date: '2026-12-25', weekStart: '2026-12-21', weekEnd: '2026-12-27', label: '2026-W52' } },
    { text: 'iso week for 2000-01-01', input: { date: '2000-01-01' }, output: { week: 52, weekYear: 1999, date: '2000-01-01', weekStart: '1999-12-27', weekEnd: '2000-01-02', label: '1999-W52' } },
    { text: 'what week is 2026-01-05', input: { date: '2026-01-05' }, output: { week: 2, weekYear: 2026, date: '2026-01-05', weekStart: '2026-01-05', weekEnd: '2026-01-11', label: '2026-W02' } },
    { text: 'week number for 2026-06-01', input: { date: '2026-06-01' }, output: { week: 23, weekYear: 2026, date: '2026-06-01', weekStart: '2026-06-01', weekEnd: '2026-06-07', label: '2026-W23' } }
  ],
  errorCases: [
    { input: { date: 'sometime' }, code: 'INVALID_INPUT' },
    { input: { date: '2026-13-01' }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' }
  ],
  run (input, ctx) {
    const d = parseDate(input.date, ctx);
    if (!d.ok) return fail('INVALID_INPUT', `I couldn't read "${input.date}" as a date (${d.reason}).`, 'date');
    const { week, year } = isoWeek(d.ymd);
    /* ISO weeks start on Monday, and the week-year can differ from the calendar
       year at both ends — 1 January 2000 sits in 1999-W52. Returning both, plus
       the actual Monday–Sunday range, is what makes the answer checkable. */
    const dn = dayNumber(d.ymd.y, d.ymd.m, d.ymd.d);
    const dow = ((dn % 7) + 11) % 7;
    const mondayOffset = dow === 0 ? -6 : 1 - dow;
    const start = fromDayNumber(dn + mondayOffset);
    return ok({
      week, weekYear: year, date: toISO(d.ymd),
      weekStart: toISO(start), weekEnd: toISO(fromDayNumber(dn + mondayOffset + 6)),
      label: `${year}-W${String(week).padStart(2, '0')}`
    }, computed());
  }
};
