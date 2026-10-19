import { ok, fail, computed } from '../src/contracts.js';

/* "Tuesday, 1 September 2026 at 09:30 UTC" — always UTC, because a timestamp
   IS a UTC instant and rendering it in a local zone without saying so is how a
   debugging session loses an hour. */
function friendlyUtc (d) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: 'UTC', hour12: false
  }).formatToParts(d);
  const g = (t) => parts.find(p => p.type === t)?.value ?? '';
  return `${g('weekday')}, ${g('day')} ${g('month')} ${g('year')} at ${g('hour')}:${g('minute')} UTC`;
}

export default {
  name: 'unixToIso',
  description: "Turn a Unix timestamp into a readable date and time.",
  category: 'dates', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  title: 'Unix timestamp to date',
  replyTemplate: '{{unix|comma}} is {{iso}} — {{friendly|prose}}.',
  inputSchema: {
    type: 'object', required: ['unix'],
    properties: {
      unix: { type: 'number', label: 'timestamp', prompt: 'Which timestamp?' },
      unit: { type: 'string', label: 'timestamp unit', enum: ['seconds', 'milliseconds', 'auto'], default: 'auto' }
    }
  },
  outputSchema: {
    type: 'object',
    properties: { iso: { type: 'string' }, date: { type: 'string' }, time: { type: 'string' }, friendly: { type: 'string' }, unix: { type: 'number' }, unit: { type: 'string' } }
  },
  examples: [
    { text: 'what date is unix timestamp 1788255000', input: { unix: 1788255000 }, output: { iso: '2026-09-01T09:30:00.000Z', date: '2026-09-01', time: '09:30:00', friendly: 'Tuesday, 1 September 2026 at 09:30 UTC', unix: 1788255000, unit: 'seconds' } },
    { text: 'convert 0 from unix time', input: { unix: 0 }, output: { iso: '1970-01-01T00:00:00.000Z', date: '1970-01-01', time: '00:00:00', friendly: 'Thursday, 1 January 1970 at 00:00 UTC', unix: 0, unit: 'seconds' } },
    { text: 'what is 1788255000000 as a date', input: { unix: 1788255000000 }, output: { iso: '2026-09-01T09:30:00.000Z', date: '2026-09-01', time: '09:30:00', friendly: 'Tuesday, 1 September 2026 at 09:30 UTC', unix: 1788255000000, unit: 'milliseconds' } },
    { text: 'timestamp 1000000000 as a date', input: { unix: 1000000000 }, output: { iso: '2001-09-09T01:46:40.000Z', date: '2001-09-09', time: '01:46:40', friendly: 'Sunday, 9 September 2001 at 01:46 UTC', unix: 1000000000, unit: 'seconds' } },
    { text: 'read 1798185600 as a date', input: { unix: 1798185600 }, output: { iso: '2026-12-25T08:00:00.000Z', date: '2026-12-25', time: '08:00:00', friendly: 'Friday, 25 December 2026 at 08:00 UTC', unix: 1798185600, unit: 'seconds' } }
  ],
  errorCases: [
    { input: { unix: 'yesterday' }, code: 'INVALID_INPUT' },
    { input: { unix: 1e18 }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' }
  ],
  run (input) {
    if (!Number.isFinite(input.unix)) return fail('INVALID_INPUT', 'That is not a timestamp.', 'unix');
    /* Seconds and milliseconds are told apart by magnitude: anything past
       ~1e11 seconds is the year 5138, so in practice a number that large is
       milliseconds. Guessing is unavoidable here and `unit` reports the guess. */
    const unit = input.unit === 'auto'
      ? (Math.abs(input.unix) > 1e11 ? 'milliseconds' : 'seconds')
      : input.unit;
    const ms = unit === 'milliseconds' ? input.unix : input.unix * 1000;
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return fail('INVALID_INPUT', 'That timestamp is outside the range of dates I can represent.', 'unix');
    const iso = d.toISOString();
    return ok({
      iso, date: iso.slice(0, 10), time: iso.slice(11, 19),
      /* Assembled from parts rather than string-surgery on a locale format.
         Chaining .replace() onto toLocaleString happened to strip the comma
         after the weekday, and any ICU change would have moved the damage
         somewhere else. formatToParts is stable. */
      friendly: friendlyUtc(d),
      unix: input.unix, unit
    }, computed());
  }
};
