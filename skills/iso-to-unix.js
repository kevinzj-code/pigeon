import { ok, fail, computed } from '../src/contracts.js';
import { parseDate, toISO } from '../src/lib/dates.js';

export default {
  name: 'isoToUnix',
  description: "Convert a calendar date and clock time to a Unix epoch number.",
  category: 'dates', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  title: 'Date to Unix timestamp',
  replyTemplate: '{{iso}} is {{seconds|comma}} in Unix seconds ({{milliseconds|comma}} in milliseconds).',
  inputSchema: {
    type: 'object', required: ['date'],
    properties: {
      date: { type: 'string', label: 'date', prompt: 'Which date?', description: 'a date' },
      time: { type: 'string', label: 'utc time', pattern: '^\\d{1,2}:\\d{2}(:\\d{2})?$', description: 'a 24-hour time — defaults to midnight' }
    }
  },
  outputSchema: {
    type: 'object',
    properties: { seconds: { type: 'integer' }, milliseconds: { type: 'integer' }, iso: { type: 'string' }, date: { type: 'string' }, time: { type: 'string' } }
  },
  examples: [
    { text: 'unix timestamp for 2026-09-01', input: { date: '2026-09-01' }, output: { seconds: 1788220800, milliseconds: 1788220800000, iso: '2026-09-01T00:00:00.000Z', date: '2026-09-01', time: '00:00:00' } },
    { text: 'what is 2026-09-01 09:30 as a timestamp', input: { date: '2026-09-01', time: '09:30' }, output: { seconds: 1788255000, milliseconds: 1788255000000, iso: '2026-09-01T09:30:00.000Z', date: '2026-09-01', time: '09:30:00' } },
    { text: 'epoch seconds for 1970-01-01', input: { date: '1970-01-01' }, output: { seconds: 0, milliseconds: 0, iso: '1970-01-01T00:00:00.000Z', date: '1970-01-01', time: '00:00:00' } },
    { text: 'timestamp for christmas 2026 at 08:00', input: { date: '2026-12-25', time: '08:00' }, output: { seconds: 1798185600, milliseconds: 1798185600000, iso: '2026-12-25T08:00:00.000Z', date: '2026-12-25', time: '08:00:00' } },
    { text: 'convert 2001-09-09 01:46:40 to unix', input: { date: '2001-09-09', time: '01:46:40' }, output: { seconds: 1000000000, milliseconds: 1000000000000, iso: '2001-09-09T01:46:40.000Z', date: '2001-09-09', time: '01:46:40' } }
  ],
  errorCases: [
    { input: { date: 'whenever' }, code: 'INVALID_INPUT' },
    { input: { date: '2026-01-01', time: '99:99' }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' }
  ],
  run (input, ctx) {
    const d = parseDate(input.date, ctx);
    if (!d.ok) return fail('INVALID_INPUT', `I couldn't read "${input.date}" as a date (${d.reason}).`, 'date');
    let h = 0, mi = 0, sec = 0;
    if (input.time) {
      const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(input.time.trim());
      if (!m) return fail('INVALID_INPUT', `I couldn't read "${input.time}" as a time.`, 'time');
      [h, mi, sec] = [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)];
      if (h > 23 || mi > 59 || sec > 59) return fail('INVALID_INPUT', 'That is not a real time of day.', 'time');
    }
    /* UTC, deliberately and stated. A timestamp is an instant; interpreting a
       bare date in the device's local zone would make the same input produce
       different numbers on two machines, which is the opposite of what a
       timestamp is for. */
    const ms = Date.UTC(d.ymd.y, d.ymd.m - 1, d.ymd.d, h, mi, sec);
    const pad = (n) => String(n).padStart(2, '0');
    return ok({
      seconds: Math.floor(ms / 1000), milliseconds: ms,
      iso: new Date(ms).toISOString(), date: toISO(d.ymd),
      time: `${pad(h)}:${pad(mi)}:${pad(sec)}`
    }, computed());
  }
};
