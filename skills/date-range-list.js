import { ok, fail, computed } from '../src/contracts.js';
import { parseDate, dayNumber, fromDayNumber, toISO, addMonths, weekdayOf } from '../src/lib/dates.js';

export default {
  name: 'dateRangeList',
  description: 'List every date between two dates, optionally stepping by weeks or months.',
  category: 'dates', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{count}} {{count|plural:date:dates}} from {{from|date}} to {{to|date}}, every {{step}} {{unit|prose}}.',
  inputSchema: {
    type: 'object', required: ['from', 'to'],
    properties: {
      from: { type: 'string', label: 'start date', prompt: 'Start from which date?', description: 'a date' },
      to: { type: 'string', label: 'end date', prompt: 'Up to which date?', description: 'a date' },
      step: { type: 'integer', label: 'step', minimum: 1, default: 1 },
      unit: { type: 'string', label: 'step unit', enum: ['days', 'weeks', 'months'], default: 'days' },
      weekdaysOnly: { type: 'boolean', label: 'weekdays only', default: false }
    }
  },
  outputSchema: {
    type: 'object',
    properties: { dates: { type: 'array', items: { type: 'string' } }, count: { type: 'integer' }, from: { type: 'string' }, to: { type: 'string' }, step: { type: 'integer' }, unit: { type: 'string' } }
  },
  examples: [
    { text: 'list the dates from 2026-09-01 to 2026-09-05', input: { from: '2026-09-01', to: '2026-09-05' },
      output: { dates: ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05'], count: 5, from: '2026-09-01', to: '2026-09-05', step: 1, unit: 'days' } },
    { text: 'every monday from 2026-09-07 to 2026-09-28', input: { from: '2026-09-07', to: '2026-09-28', step: 1, unit: 'weeks' },
      output: { dates: ['2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28'], count: 4, from: '2026-09-07', to: '2026-09-28', step: 1, unit: 'weeks' } },
    { text: 'the first of each month from january to april 2026', input: { from: '2026-01-01', to: '2026-04-01', step: 1, unit: 'months' },
      output: { dates: ['2026-01-01', '2026-02-01', '2026-03-01', '2026-04-01'], count: 4, from: '2026-01-01', to: '2026-04-01', step: 1, unit: 'months' } },
    { text: 'weekdays only between 2026-09-04 and 2026-09-09', input: { from: '2026-09-04', to: '2026-09-09', weekdaysOnly: true },
      output: { dates: ['2026-09-04', '2026-09-07', '2026-09-08', '2026-09-09'], count: 4, from: '2026-09-04', to: '2026-09-09', step: 1, unit: 'days' } },
    { text: 'every other day from 2026-09-01 to 2026-09-07', input: { from: '2026-09-01', to: '2026-09-07', step: 2 },
      output: { dates: ['2026-09-01', '2026-09-03', '2026-09-05', '2026-09-07'], count: 4, from: '2026-09-01', to: '2026-09-07', step: 2, unit: 'days' } }
  ],
  errorCases: [
    { input: { from: '2026-09-05', to: '2026-09-01' }, code: 'INVALID_INPUT' },
    { input: { from: '2026-01-01', to: '2200-01-01' }, code: 'INVALID_INPUT' },
    { input: { from: '2026-01-01' }, code: 'MISSING_FIELD' }
  ],
  run (input, ctx) {
    const a = parseDate(input.from, ctx);
    if (!a.ok) return fail('INVALID_INPUT', `I couldn't read "${input.from}" as a date (${a.reason}).`, 'from');
    const b = parseDate(input.to, ctx);
    if (!b.ok) return fail('INVALID_INPUT', `I couldn't read "${input.to}" as a date (${b.reason}).`, 'to');
    if (dayNumber(b.ymd.y, b.ymd.m, b.ymd.d) < dayNumber(a.ymd.y, a.ymd.m, a.ymd.d)) {
      return fail('INVALID_INPUT', 'The end date is before the start date.', 'to');
    }

    const end = dayNumber(b.ymd.y, b.ymd.m, b.ymd.d);
    const dates = [];
    let cursor = { ...a.ymd };
    /* Capped, because "1900 to 2200" is a plausible slip and an unbounded list
       is a hung tab. The refusal names the count so the range can be narrowed. */
    while (dayNumber(cursor.y, cursor.m, cursor.d) <= end) {
      if (dates.length > 3000) {
        return fail('INVALID_INPUT', 'That range runs to more than 3,000 dates — narrow it or step by weeks or months.', 'to');
      }
      const iso = toISO(cursor);
      const wd = weekdayOf(cursor);
      if (!input.weekdaysOnly || (wd !== 'Saturday' && wd !== 'Sunday')) dates.push(iso);
      cursor = input.unit === 'months'
        ? addMonths(cursor, input.step)
        : fromDayNumber(dayNumber(cursor.y, cursor.m, cursor.d) + input.step * (input.unit === 'weeks' ? 7 : 1));
    }
    return ok({
      dates, count: dates.length, from: toISO(a.ymd), to: toISO(b.ymd),
      step: input.step, unit: input.unit
    }, computed());
  }
};
