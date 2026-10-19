import { ok, fail, computed } from '../src/contracts.js';
import { parseDate, dayNumber, toISO, weekdayOf, todayYMD } from '../src/lib/dates.js';

/* "How many days till X." Distinct from daysBetween because one end is always
   the device's today (§2.5), which means the model never gets to supply it and
   never gets it wrong. */
export default {
  name: 'countdownTo',
  description: 'Count how long until a date, or how long since one, from today. Takes the one date.',
  category: 'dates',
  tier: 'core',
  unbuilt: false,
  needsNetwork: false,
  dataAsOf: null,
  labels: [],
  replyTemplate: '{{days|comma}} {{days|plural:day:days}} {{tense|prose}} — {{date|date}} is a {{weekday}}.',
  inputSchema: {
    type: 'object',
    required: ['to'],
    properties: {
      to: { type: 'string', label: 'date', prompt: 'Which date should I count to?', description: 'a date' }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      days: { type: 'integer' }, weeks: { type: 'number' }, date: { type: 'string' },
      weekday: { type: 'string' }, tense: { type: 'string' }, past: { type: 'boolean' },
      today: { type: 'string' }
    }
  },
  examples: [
    { text: "how many days till my sister's wedding on nov 14",
      ctx: { now: '2026-09-01T09:00:00Z', timezone: 'UTC', locale: 'en-GB' },
      input: { to: '2026-11-14' },
      output: { days: 74, weeks: 10.57, date: '2026-11-14', weekday: 'Saturday', tense: 'to go', past: false, today: '2026-09-01' } },
    { text: 'days until christmas',
      ctx: { now: '2026-09-01T09:00:00Z', timezone: 'UTC', locale: 'en-GB' },
      input: { to: '2026-12-25' },
      output: { days: 115, weeks: 16.43, date: '2026-12-25', weekday: 'Friday', tense: 'to go', past: false, today: '2026-09-01' } },
    { text: 'how long until tomorrow',
      ctx: { now: '2026-09-01T09:00:00Z', timezone: 'UTC', locale: 'en-GB' },
      input: { to: 'tomorrow' },
      output: { days: 1, weeks: 0.14, date: '2026-09-02', weekday: 'Wednesday', tense: 'to go', past: false, today: '2026-09-01' } },
    { text: 'how long ago was 1 January 2026',
      ctx: { now: '2026-09-01T09:00:00Z', timezone: 'UTC', locale: 'en-GB' },
      input: { to: '2026-01-01' },
      output: { days: 243, weeks: 34.71, date: '2026-01-01', weekday: 'Thursday', tense: 'ago', past: true, today: '2026-09-01' } },
    { text: 'days till today',
      ctx: { now: '2026-09-01T09:00:00Z', timezone: 'UTC', locale: 'en-GB' },
      input: { to: 'today' },
      output: { days: 0, weeks: 0, date: '2026-09-01', weekday: 'Tuesday', tense: 'away — that is today', past: false, today: '2026-09-01' } }
  ],
  errorCases: [
    { input: { to: 'sometime next-ish' }, code: 'INVALID_INPUT' },
    { input: { to: '2026-13-01' }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' }
  ],
  run (input, ctx) {
    const t = parseDate(input.to, ctx);
    if (!t.ok) return fail('INVALID_INPUT', `I couldn't read "${input.to}" as a date (${t.reason}).`, 'to');

    const today = todayYMD(ctx);
    const diff = dayNumber(t.ymd.y, t.ymd.m, t.ymd.d) - dayNumber(today.y, today.m, today.d);
    const days = Math.abs(diff);

    return ok({
      days,
      weeks: Math.round((days / 7) * 100) / 100,
      date: toISO(t.ymd),
      weekday: weekdayOf(t.ymd),
      tense: diff === 0 ? 'away — that is today' : diff > 0 ? 'to go' : 'ago',
      past: diff < 0,
      today: toISO(today)
    }, computed());
  }
};
