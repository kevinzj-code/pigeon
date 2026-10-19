import { ok, fail, computed } from '../src/contracts.js';
import { offsetMinutesAt, formatOffset, findZone } from '../src/lib/dates.js';

const pad = (n) => String(n).padStart(2, '0');
const clock = (h) => `${pad(((h % 24) + 24) % 24)}:00`;

export default {
  name: 'findCommonMeetingHours',
  description: 'Find the hours when everyone is inside their working day, across time zones.',
  category: 'organising', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{summary|prose}}',
  inputSchema: {
    type: 'object', required: ['participants'],
    properties: {
      participants: { type: 'array', label: 'time zones', minItems: 1, maxItems: 20, prompt: 'Which time zones are people in?' },
      workStart: { type: 'integer', label: 'work starts (hour)', minimum: 0, maximum: 23, default: 9 },
      workEnd: { type: 'integer', label: 'work ends (hour)', minimum: 1, maximum: 24, default: 17 },
      on: { type: 'string', label: 'date', description: 'the date to use for daylight saving - today by default' }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      overlapHours: { type: 'integer' }, startUtc: { type: 'string' }, endUtc: { type: 'string' },
      local: { type: 'array' }, lines: { type: 'array', items: { type: 'string' } },
      summary: { type: 'string' }, anyOverlap: { type: 'boolean' }
    }
  },
  examples: [
    { text: 'when can London and New York meet', input: { participants: ['Europe/London', 'America/New_York'], on: '2026-09-01' }, output: { overlapHours: 3, startUtc: '13:00', endUtc: '16:00', local: [{ zone: 'Europe/London', offset: '+01:00', start: '14:00', end: '17:00' }, { zone: 'America/New_York', offset: '-04:00', start: '09:00', end: '12:00' }], lines: ['Europe/London 14:00 to 17:00', 'America/New_York 09:00 to 12:00'], anyOverlap: true, summary: '3 hours overlap, 13:00 to 16:00 UTC.' } },
    { text: 'common working hours for London and Berlin', input: { participants: ['Europe/London', 'Europe/Berlin'], on: '2026-09-01' }, output: { overlapHours: 7, startUtc: '08:00', endUtc: '15:00', local: [{ zone: 'Europe/London', offset: '+01:00', start: '09:00', end: '16:00' }, { zone: 'Europe/Berlin', offset: '+02:00', start: '10:00', end: '17:00' }], lines: ['Europe/London 09:00 to 16:00', 'Europe/Berlin 10:00 to 17:00'], anyOverlap: true, summary: '7 hours overlap, 08:00 to 15:00 UTC.' } },
    { text: 'can London and Tokyo find a meeting time', input: { participants: ['Europe/London', 'Asia/Tokyo'], on: '2026-09-01' }, output: { overlapHours: 0, startUtc: null, endUtc: null, local: [], lines: [], anyOverlap: false, summary: 'There is no hour when everyone is inside a 09:00 to 17:00 working day.' } },
    { text: 'meeting slot for three offices', input: { participants: ['Europe/London', 'Europe/Berlin', 'America/New_York'], on: '2026-09-01' }, output: { overlapHours: 2, startUtc: '13:00', endUtc: '15:00', local: [{ zone: 'Europe/London', offset: '+01:00', start: '14:00', end: '16:00' }, { zone: 'Europe/Berlin', offset: '+02:00', start: '15:00', end: '17:00' }, { zone: 'America/New_York', offset: '-04:00', start: '09:00', end: '11:00' }], lines: ['Europe/London 14:00 to 16:00', 'Europe/Berlin 15:00 to 17:00', 'America/New_York 09:00 to 11:00'], anyOverlap: true, summary: '2 hours overlap, 13:00 to 15:00 UTC.' } },
    { text: 'working hours for one person', input: { participants: ['Asia/Tokyo'], on: '2026-09-01' }, output: { overlapHours: 8, startUtc: '00:00', endUtc: '08:00', local: [{ zone: 'Asia/Tokyo', offset: '+09:00', start: '09:00', end: '17:00' }], lines: ['Asia/Tokyo 09:00 to 17:00'], anyOverlap: true, summary: '8 hours overlap, 00:00 to 08:00 UTC.' } }
  ],
  errorCases: [
    { input: { participants: ['Middle/Earth'] }, code: 'INVALID_INPUT' },
    { input: { participants: ['Europe/London'], workStart: 17, workEnd: 9 }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' }
  ],
  run (input, ctx) {
    const workStart = input.workStart ?? 9;
    const workEnd = input.workEnd ?? 17;
    if (workEnd <= workStart) return fail('INVALID_INPUT', 'The working day has to end after it starts.', 'workEnd');

    const at = input.on ? new Date(`${input.on}T12:00:00Z`) : new Date(input.now);
    if (Number.isNaN(at.getTime())) return fail('INVALID_INPUT', `"${input.on}" is not a date I can read.`, 'on');

    /* Everyone's working day is converted into UTC and intersected there. Doing
       it in any one person's local time works right up until a daylight saving
       change makes two zones disagree about how far apart they are. */
    const rows = [];
    for (const p of input.participants) {
      const zone = String(typeof p === 'string' ? p : p?.zone ?? '');
      const hit = findZone(zone);
      if (!hit) return fail('INVALID_INPUT', `I don't know a time zone called "${zone}" — try an IANA name like Europe/London.`, 'participants');
      const offset = offsetMinutesAt(hit.zone, at) / 60;
      rows.push({ zone: hit.zone, offset, startUtc: workStart - offset, endUtc: workEnd - offset });
    }

    const startUtc = Math.max(...rows.map((r) => r.startUtc));
    const endUtc = Math.min(...rows.map((r) => r.endUtc));
    const overlapHours = Math.max(0, endUtc - startUtc);

    if (overlapHours <= 0) {
      return ok({
        overlapHours: 0, startUtc: null, endUtc: null, local: [], lines: [], anyOverlap: false,
        summary: `There is no hour when everyone is inside a ${clock(workStart)} to ${clock(workEnd)} working day.`
      }, computed());
    }

    const local = rows.map((r) => ({
      zone: r.zone, offset: formatOffset(r.offset * 60),
      start: clock(startUtc + r.offset), end: clock(endUtc + r.offset)
    }));

    return ok({
      overlapHours, startUtc: clock(startUtc), endUtc: clock(endUtc), local,
      lines: local.map((l) => `${l.zone} ${l.start} to ${l.end}`),
      anyOverlap: true,
      summary: `${overlapHours} hours overlap, ${clock(startUtc)} to ${clock(endUtc)} UTC.`
    }, computed());
  }
};
