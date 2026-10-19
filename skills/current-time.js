import { ok, computed } from '../src/contracts.js';
import { todayYMD, toISO, weekdayOf, isoWeek } from '../src/lib/dates.js';

/* The purest illustration of §2.5: this skill has no required input at all,
   because everything it reports comes from the harness. If the model tried to
   supply `now`, mergeInput would overwrite it before run() ever saw it. */
export default {
  name: 'currentTime',
  description: "Today's date and the current time, in your own time zone.",
  category: 'dates',
  tier: 'core',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: "It's {{time}} on {{weekday}} {{date|date}} ({{timezone}}).",
  inputSchema: {
    type: 'object',
    properties: {
      /* NOT called `timezone`. That name is ctx-owned (§2.5/§4.2), so
         mergeInput overwrites it with the device's zone before run() is
         called — which is correct, and which means a skill that wants to be
         ASKED for a zone has to use a different field name. Colliding with a
         ctx field is silent by design: ctx always wins. */
      zone: { type: 'string', label: 'time zone', description: 'an IANA zone to report instead — defaults to the device time zone' }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      date: { type: 'string' }, time: { type: 'string' }, iso: { type: 'string' },
      weekday: { type: 'string' }, timezone: { type: 'string' },
      week: { type: 'integer' }, dayOfYear: { type: 'integer' }, unix: { type: 'integer' }
    }
  },
  examples: [
    { text: 'what is the date today', ctx: { now: '2026-09-01T09:30:00Z', timezone: 'UTC', locale: 'en-GB' }, input: {},
      output: { date: '2026-09-01', time: '09:30', iso: '2026-09-01T09:30:00.000Z', weekday: 'Tuesday', timezone: 'UTC', week: 36, dayOfYear: 244, unix: 1788255000 } },
    { text: 'what time is it', ctx: { now: '2026-09-01T14:05:00Z', timezone: 'Europe/London', locale: 'en-GB' }, input: {},
      output: { date: '2026-09-01', time: '15:05', iso: '2026-09-01T14:05:00.000Z', weekday: 'Tuesday', timezone: 'Europe/London', week: 36, dayOfYear: 244, unix: 1788271500 } },
    { text: 'what time is it in tokyo', ctx: { now: '2026-09-01T14:05:00Z', timezone: 'UTC', locale: 'en-GB' }, input: { zone: 'Asia/Tokyo' },
      output: { date: '2026-09-01', time: '23:05', iso: '2026-09-01T14:05:00.000Z', weekday: 'Tuesday', timezone: 'Asia/Tokyo', week: 36, dayOfYear: 244, unix: 1788271500 } },
    { text: 'what day is it today', ctx: { now: '2026-12-25T08:00:00Z', timezone: 'UTC', locale: 'en-GB' }, input: {},
      output: { date: '2026-12-25', time: '08:00', iso: '2026-12-25T08:00:00.000Z', weekday: 'Friday', timezone: 'UTC', week: 52, dayOfYear: 359, unix: 1798185600 } },
    { text: 'what week of the year are we in', ctx: { now: '2026-01-05T12:00:00Z', timezone: 'UTC', locale: 'en-GB' }, input: {},
      output: { date: '2026-01-05', time: '12:00', iso: '2026-01-05T12:00:00.000Z', weekday: 'Monday', timezone: 'UTC', week: 2, dayOfYear: 5, unix: 1767614400 } }
  ],
  errorCases: [
    { input: { zone: 'Middle/Earth' }, code: 'INVALID_INPUT' },
    { input: { zone: 'not a zone at all' }, code: 'INVALID_INPUT' },
    { input: { zone: ['UTC'] }, code: 'INVALID_INPUT' }
  ],
  run (input, ctx) {
    const zone = input.zone || ctx.timezone || 'UTC';
    const now = new Date(ctx.now);
    let parts;
    try {
      parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: zone, hour12: false,
        year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
      }).formatToParts(now);
    } catch {
      return { ok: false, error: { code: 'INVALID_INPUT', field: 'zone', message: `"${zone}" isn't a time zone I know. Try an IANA name like Europe/London.` } };
    }
    const g = (t) => parts.find(p => p.type === t).value;
    const ymd = { y: Number(g('year')), m: Number(g('month')), d: Number(g('day')) };
    void todayYMD;

    return ok({
      date: toISO(ymd),
      time: `${String(Number(g('hour')) % 24).padStart(2, '0')}:${g('minute')}`,
      iso: now.toISOString(),
      weekday: weekdayOf(ymd),
      timezone: zone,
      week: isoWeek(ymd).week,
      dayOfYear: Math.round((Date.UTC(ymd.y, ymd.m - 1, ymd.d) - Date.UTC(ymd.y, 0, 1)) / 86400000) + 1,
      unix: Math.floor(now.getTime() / 1000)
    }, computed());
  }
};
