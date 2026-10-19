import { ok, fail, computed } from '../src/contracts.js';
import { parseDate, addDays, addMonths, toISO, weekdayOf } from '../src/lib/dates.js';

/* Date ± duration. Months are added as calendar months and clamped (31 Jan +
   1 month = 28 Feb), which is the behaviour every calendar app has and the one
   people mean; adding 30 days instead would quietly drift. */
export default {
  name: 'addDuration',
  description: "Move a date forward or back by days, weeks, months or years.",
  category: 'dates',
  tier: 'core',
  unbuilt: false,
  needsNetwork: false,
  dataAsOf: null,
  labels: [],
  replyTemplate: '{{date|date}} — a {{weekday}}.',
  inputSchema: {
    type: 'object',
    required: ['from', 'amount', 'unit'],
    properties: {
      from: { type: 'string', label: 'start date', prompt: 'Which date should I start from?', description: 'a date' },
      amount: { type: 'integer', label: 'how many', prompt: 'How many should I add? (use a negative number to go back)' },
      unit: { type: 'string', label: 'unit', enum: ['days', 'weeks', 'months', 'years'], prompt: 'Days, weeks, months or years?' }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      date: { type: 'string' }, weekday: { type: 'string' }, from: { type: 'string' },
      amount: { type: 'number' }, unit: { type: 'string' }, clamped: { type: 'boolean' }
    }
  },
  examples: [
    { text: 'what date is 90 days after 2026-07-12', input: { from: '2026-07-12', amount: 90, unit: 'days' },
      output: { date: '2026-10-10', weekday: 'Saturday', from: '2026-07-12', amount: 90, unit: 'days', clamped: false } },
    { text: 'six weeks from 1 March 2026', input: { from: '2026-03-01', amount: 6, unit: 'weeks' },
      output: { date: '2026-04-12', weekday: 'Sunday', from: '2026-03-01', amount: 6, unit: 'weeks', clamped: false } },
    { text: 'three months after 31 January 2026', input: { from: '2026-01-31', amount: 3, unit: 'months' },
      output: { date: '2026-04-30', weekday: 'Thursday', from: '2026-01-31', amount: 3, unit: 'months', clamped: true } },
    { text: '18 years from 2008-02-29', input: { from: '2008-02-29', amount: 18, unit: 'years' },
      output: { date: '2026-02-28', weekday: 'Saturday', from: '2008-02-29', amount: 18, unit: 'years', clamped: true } },
    { text: '10 days before 2026-01-05', input: { from: '2026-01-05', amount: -10, unit: 'days' },
      output: { date: '2025-12-26', weekday: 'Friday', from: '2026-01-05', amount: -10, unit: 'days', clamped: false } }
  ],
  errorCases: [
    { input: { from: 'nonsense', amount: 5, unit: 'days' }, code: 'INVALID_INPUT' },
    { input: { from: '2026-01-01', amount: 5, unit: 'fortnights' }, code: 'INVALID_INPUT' },
    { input: { from: '2026-01-01', unit: 'days' }, code: 'MISSING_FIELD' }
  ],
  run (input, ctx) {
    const d = parseDate(input.from, ctx);
    if (!d.ok) return fail('INVALID_INPUT', `I couldn't read "${input.from}" as a date (${d.reason}).`, 'from');
    if (!Number.isInteger(input.amount)) return fail('INVALID_INPUT', 'The amount has to be a whole number.', 'amount');

    let out;
    if (input.unit === 'days') out = addDays(d.ymd, input.amount);
    else if (input.unit === 'weeks') out = addDays(d.ymd, input.amount * 7);
    else if (input.unit === 'months') out = addMonths(d.ymd, input.amount);
    else out = addMonths(d.ymd, input.amount * 12);

    return ok({
      date: toISO(out),
      weekday: weekdayOf(out),
      from: toISO(d.ymd),
      amount: input.amount,
      unit: input.unit,
      /* Told rather than hidden: "31 Jan + 1 month" landing on the 28th is a
         decision, and the renderer can say so. Only months and years can clamp
         — a day or week offset always lands on the day it lands on, and
         reporting that as "clamped" would be noise on every single call. */
      clamped: (input.unit === 'months' || input.unit === 'years') && out.d !== d.ymd.d
    }, computed());
  }
};
