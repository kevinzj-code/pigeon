import { ok, fail, computed } from '../src/contracts.js';
import { offsetMinutesAt, formatOffset, localTimeIn, findZone } from '../src/lib/dates.js';

export default {
  name: 'listTimezoneOffsets',
  description: 'Show the local time and UTC offset in several time zones at once.',
  category: 'dates', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  title: 'Time zone offsets',
  replyTemplate: '{{count}} {{count|plural:zone:zones}} at {{reference}} UTC:\n{{lines|lines}}',
  inputSchema: {
    type: 'object', required: ['zones'],
    properties: {
      zones: { type: 'array', label: 'time zones', minItems: 1, maxItems: 25, items: { type: 'string' }, prompt: 'Which time zones should I list?' },
      at: { type: 'string', label: 'timestamp', description: 'an ISO timestamp to ask about instead of now' }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      rows: { type: 'array' }, lines: { type: 'array', items: { type: 'string' } },
      count: { type: 'integer' }, reference: { type: 'string' }
    }
  },
  examples: [
    { text: 'show the time in London Tokyo and New York', input: { zones: ['Europe/London', 'Asia/Tokyo', 'America/New_York'] }, output: { rows: [{ zone: 'Europe/London', offset: '+01:00', offsetMinutes: 60, localTime: '2026-09-01 10:00' }, { zone: 'Asia/Tokyo', offset: '+09:00', offsetMinutes: 540, localTime: '2026-09-01 18:00' }, { zone: 'America/New_York', offset: '-04:00', offsetMinutes: -240, localTime: '2026-09-01 05:00' }], lines: ['Europe/London +01:00 — 2026-09-01 10:00', 'Asia/Tokyo +09:00 — 2026-09-01 18:00', 'America/New_York -04:00 — 2026-09-01 05:00'], count: 3, reference: '2026-09-01 09:00' } },
    { text: 'list utc offsets for these zones', input: { zones: ['UTC', 'Asia/Kolkata'] }, output: { rows: [{ zone: 'UTC', offset: '+00:00', offsetMinutes: 0, localTime: '2026-09-01 09:00' }, { zone: 'Asia/Kolkata', offset: '+05:30', offsetMinutes: 330, localTime: '2026-09-01 14:30' }], lines: ['UTC +00:00 — 2026-09-01 09:00', 'Asia/Kolkata +05:30 — 2026-09-01 14:30'], count: 2, reference: '2026-09-01 09:00' } },
    { text: 'what time is it in Sydney and Los Angeles', input: { zones: ['Australia/Sydney', 'America/Los_Angeles'] }, output: { rows: [{ zone: 'Australia/Sydney', offset: '+10:00', offsetMinutes: 600, localTime: '2026-09-01 19:00' }, { zone: 'America/Los_Angeles', offset: '-07:00', offsetMinutes: -420, localTime: '2026-09-01 02:00' }], lines: ['Australia/Sydney +10:00 — 2026-09-01 19:00', 'America/Los_Angeles -07:00 — 2026-09-01 02:00'], count: 2, reference: '2026-09-01 09:00' } },
    { text: 'offsets for one zone', input: { zones: ['Europe/Paris'] }, output: { rows: [{ zone: 'Europe/Paris', offset: '+02:00', offsetMinutes: 120, localTime: '2026-09-01 11:00' }], lines: ['Europe/Paris +02:00 — 2026-09-01 11:00'], count: 1, reference: '2026-09-01 09:00' } },
    { text: 'compare time zones by city name', input: { zones: ['Tokyo', 'Berlin'] }, output: { rows: [{ zone: 'Asia/Tokyo', offset: '+09:00', offsetMinutes: 540, localTime: '2026-09-01 18:00' }, { zone: 'Europe/Berlin', offset: '+02:00', offsetMinutes: 120, localTime: '2026-09-01 11:00' }], lines: ['Asia/Tokyo +09:00 — 2026-09-01 18:00', 'Europe/Berlin +02:00 — 2026-09-01 11:00'], count: 2, reference: '2026-09-01 09:00' } }
  ],
  errorCases: [
    { input: { zones: ['Middle/Earth'] }, code: 'INVALID_INPUT' },
    { input: { zones: [] }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' }
  ],
  run (input) {
    const at = input.at ? new Date(input.at) : new Date(input.now);
    if (Number.isNaN(at.getTime())) return fail('INVALID_INPUT', `"${input.at}" is not a timestamp I can read.`, 'at');

    const rows = [];
    for (const q of input.zones) {
      const hit = findZone(q);
      if (!hit) return fail('INVALID_INPUT', `I don't know a time zone called "${q}" — try an IANA name like Europe/London.`, 'zones');
      const mins = offsetMinutesAt(hit.zone, at);
      rows.push({ zone: hit.zone, offset: formatOffset(mins), offsetMinutes: mins, localTime: localTimeIn(hit.zone, at) });
    }

    return ok({
      rows, lines: rows.map((r) => `${r.zone} ${r.offset} — ${r.localTime}`),
      count: rows.length, reference: localTimeIn('UTC', at)
    }, computed());
  }
};
