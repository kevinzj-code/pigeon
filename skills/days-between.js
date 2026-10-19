import { ok, fail, computed } from '../src/contracts.js';
import { parseDate, dayNumber, toISO, weekdayOf } from '../src/lib/dates.js';

/* Whole calendar days between two dates. Inclusive-of-neither: 1st to 2nd is
   one day. The "inclusive" flag exists because half the people who ask this
   are counting nights and half are counting days, and guessing is how you get
   an off-by-one in someone's holiday booking. */
export default {
  name: 'daysBetween',
  description: 'Count the days from one given date to another. Takes both dates.',
  category: 'dates',
  tier: 'core',
  unbuilt: false,
  needsNetwork: false,
  dataAsOf: null,
  labels: [],
  replyTemplate: '{{days|comma}} {{days|plural:day:days}} between {{from|date}} and {{to|date}}.',
  inputSchema: {
    type: 'object',
    required: ['from', 'to'],
    properties: {
      from: { type: 'string', label: 'start date', prompt: 'Which date should I count from?', description: 'a date' },
      to: { type: 'string', label: 'end date', prompt: 'Which date should I count to?', description: 'a date' },
      inclusive: { type: 'boolean', label: 'count both end days', default: false, description: 'count both end days' }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      days: { type: 'integer' }, weeks: { type: 'number' },
      from: { type: 'string' }, to: { type: 'string' },
      fromWeekday: { type: 'string' }, toWeekday: { type: 'string' },
      direction: { type: 'string', enum: ['forward', 'backward', 'same'] }
    }
  },
  examples: [
    { text: 'how many days between 12 July 2026 and 25 December 2026',
      input: { from: '2026-07-12', to: '2026-12-25' },
      output: { days: 166, weeks: 23.71, from: '2026-07-12', to: '2026-12-25', fromWeekday: 'Sunday', toWeekday: 'Friday', direction: 'forward' } },
    { text: 'days from 2026-01-01 to 2026-03-01',
      input: { from: '2026-01-01', to: '2026-03-01' },
      output: { days: 59, weeks: 8.43, from: '2026-01-01', to: '2026-03-01', fromWeekday: 'Thursday', toWeekday: 'Sunday', direction: 'forward' } },
    { text: 'how long is my trip if I fly out 3 April and back 17 April, counting both days',
      input: { from: '2026-04-03', to: '2026-04-17', inclusive: true },
      output: { days: 15, weeks: 2.14, from: '2026-04-03', to: '2026-04-17', fromWeekday: 'Friday', toWeekday: 'Friday', direction: 'forward' } },
    { text: 'days between 1 March 2024 and 1 March 2025 (leap year)',
      input: { from: '2024-03-01', to: '2025-03-01' },
      output: { days: 365, weeks: 52.14, from: '2024-03-01', to: '2025-03-01', fromWeekday: 'Friday', toWeekday: 'Saturday', direction: 'forward' } },
    { text: 'how far back was 2026-08-01 from 2026-09-01',
      input: { from: '2026-09-01', to: '2026-08-01' },
      output: { days: 31, weeks: 4.43, from: '2026-09-01', to: '2026-08-01', fromWeekday: 'Tuesday', toWeekday: 'Saturday', direction: 'backward' } }
  ],
  errorCases: [
    { input: { from: 'the day before yesterday-ish', to: '2026-12-25' }, code: 'INVALID_INPUT' },
    { input: { from: '2026-02-30', to: '2026-12-25' }, code: 'INVALID_INPUT' },
    { input: { to: '2026-12-25' }, code: 'MISSING_FIELD' }
  ],
  run (input, ctx) {
    const a = parseDate(input.from, ctx);
    if (!a.ok) return fail('INVALID_INPUT', `I couldn't read "${input.from}" as a date (${a.reason}).`, 'from');
    const b = parseDate(input.to, ctx);
    if (!b.ok) return fail('INVALID_INPUT', `I couldn't read "${input.to}" as a date (${b.reason}).`, 'to');

    const da = dayNumber(a.ymd.y, a.ymd.m, a.ymd.d);
    const db = dayNumber(b.ymd.y, b.ymd.m, b.ymd.d);
    const raw = db - da;
    /* Counting both end days of one day is that day: 1. */
    const days = Math.abs(raw) + (input.inclusive ? 1 : 0);

    return ok({
      days,
      weeks: Math.round((days / 7) * 100) / 100,
      from: toISO(a.ymd),
      to: toISO(b.ymd),
      fromWeekday: weekdayOf(a.ymd),
      toWeekday: weekdayOf(b.ymd),
      direction: raw > 0 ? 'forward' : raw < 0 ? 'backward' : 'same'
    }, computed());
  }
};
