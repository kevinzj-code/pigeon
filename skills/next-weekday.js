import { ok, fail, computed } from '../src/contracts.js';
import { parseDate, dayNumber, fromDayNumber, toISO, todayYMD, WEEKDAYS } from '../src/lib/dates.js';

export default {
  name: 'nextWeekday',
  description: 'Find the date of the next Monday, Tuesday and so on — or the most recent one.',
  category: 'dates',
  tier: 'core',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: 'The {{direction|prose}} {{weekday}} is {{date|date}} — {{days}} {{days|plural:day:days}} {{tense|prose}}.',
  inputSchema: {
    type: 'object',
    required: ['weekday'],
    properties: {
      weekday: { type: 'string', label: 'weekday', enum: WEEKDAYS, prompt: 'Which day of the week?' },
      direction: { type: 'string', label: 'next or previous', enum: ['next', 'previous'], default: 'next' },
      from: { type: 'string', label: 'from date', description: 'a date — defaults to today' }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      date: { type: 'string' }, weekday: { type: 'string' }, direction: { type: 'string' },
      days: { type: 'integer' }, from: { type: 'string' }, tense: { type: 'string' }
    }
  },
  examples: [
    { text: 'when is next tuesday', ctx: { now: '2026-09-01T09:00:00Z', timezone: 'UTC', locale: 'en-GB' }, input: { weekday: 'Tuesday' },
      output: { date: '2026-09-08', weekday: 'Tuesday', direction: 'next', days: 7, from: '2026-09-01', tense: 'from now' } },
    { text: 'what date is the next friday', ctx: { now: '2026-09-01T09:00:00Z', timezone: 'UTC', locale: 'en-GB' }, input: { weekday: 'Friday' },
      output: { date: '2026-09-04', weekday: 'Friday', direction: 'next', days: 3, from: '2026-09-01', tense: 'from now' } },
    { text: 'when was last monday', ctx: { now: '2026-09-01T09:00:00Z', timezone: 'UTC', locale: 'en-GB' }, input: { weekday: 'Monday', direction: 'previous' },
      output: { date: '2026-08-31', weekday: 'Monday', direction: 'previous', days: 1, from: '2026-09-01', tense: 'ago' } },
    { text: 'the sunday after 2026-12-25', input: { weekday: 'Sunday', from: '2026-12-25' },
      output: { date: '2026-12-27', weekday: 'Sunday', direction: 'next', days: 2, from: '2026-12-25', tense: 'from now' } },
    { text: 'next saturday from 2026-11-14', input: { weekday: 'Saturday', from: '2026-11-14' },
      output: { date: '2026-11-21', weekday: 'Saturday', direction: 'next', days: 7, from: '2026-11-14', tense: 'from now' } }
  ],
  errorCases: [
    { input: { weekday: 'Caturday' }, code: 'INVALID_INPUT' },
    { input: { weekday: 'Monday', from: 'whenever' }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' }
  ],
  run (input, ctx) {
    const start = input.from ? parseDate(input.from, ctx) : { ok: true, ymd: todayYMD(ctx) };
    if (!start.ok) return fail('INVALID_INPUT', `I couldn't read "${input.from}" as a date (${start.reason}).`, 'from');

    const target = WEEKDAYS.indexOf(input.weekday);
    const from = dayNumber(start.ymd.y, start.ymd.m, start.ymd.d);
    const fromDow = ((from % 7) + 11) % 7;

    /* "Next Tuesday" on a Tuesday means the one a week away, not today. The
       modulo-then-or-7 is what makes today never the answer — which is the
       reading people mean and the one a naive `% 7` gets wrong. */
    const delta = input.direction === 'next'
      ? ((target - fromDow + 7) % 7) || 7
      : -(((fromDow - target + 7) % 7) || 7);

    const out = fromDayNumber(from + delta);
    return ok({
      date: toISO(out),
      weekday: input.weekday,
      direction: input.direction,
      days: Math.abs(delta),
      from: toISO(start.ymd),
      tense: input.direction === 'next' ? 'from now' : 'ago'
    }, computed());
  }
};
