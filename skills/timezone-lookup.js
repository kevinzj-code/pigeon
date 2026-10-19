import { ok, fail, computed } from '../src/contracts.js';
import { offsetMinutesAt, formatOffset, localTimeIn, daylightSavingAt, findZone } from '../src/lib/dates.js';

export default {
  name: 'timezoneLookup',
  description: 'Find the current time and UTC offset in a time zone.',
  category: 'reference', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: 'In {{zone}} it is {{localTime}}, {{offset}} from UTC.',
  inputSchema: {
    type: 'object', required: ['zone'],
    properties: {
      zone: { type: 'string', label: 'time zone', minLength: 1, prompt: 'Which time zone or city?' },
      at: { type: 'string', label: 'timestamp', description: 'an ISO timestamp to ask about instead of now' }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      zone: { type: 'string' }, offset: { type: 'string' }, offsetMinutes: { type: 'integer' },
      localTime: { type: 'string' }, inDaylightSaving: { type: 'boolean' },
      usesDaylightSaving: { type: 'boolean' }, alternatives: { type: 'array', items: { type: 'string' } }
    }
  },
  examples: [
    { text: 'what time is it in Asia/Tokyo', input: { zone: 'Asia/Tokyo' }, output: { zone: 'Asia/Tokyo', offset: '+09:00', offsetMinutes: 540, localTime: '2026-09-01 18:00', inDaylightSaving: false, usesDaylightSaving: false, alternatives: [] } },
    { text: 'current time in London', input: { zone: 'Europe/London' }, output: { zone: 'Europe/London', offset: '+01:00', offsetMinutes: 60, localTime: '2026-09-01 10:00', inDaylightSaving: true, usesDaylightSaving: true, alternatives: [] } },
    { text: 'what is the utc offset in New York', input: { zone: 'America/New_York' }, output: { zone: 'America/New_York', offset: '-04:00', offsetMinutes: -240, localTime: '2026-09-01 05:00', inDaylightSaving: true, usesDaylightSaving: true, alternatives: [] } },
    { text: 'time in Tokyo', input: { zone: 'Tokyo' }, output: { zone: 'Asia/Tokyo', offset: '+09:00', offsetMinutes: 540, localTime: '2026-09-01 18:00', inDaylightSaving: false, usesDaylightSaving: false, alternatives: [] } },
    { text: 'what is the offset for Asia/Kolkata', input: { zone: 'Asia/Kolkata' }, output: { zone: 'Asia/Kolkata', offset: '+05:30', offsetMinutes: 330, localTime: '2026-09-01 14:30', inDaylightSaving: false, usesDaylightSaving: false, alternatives: [] } }
  ],
  errorCases: [
    { input: { zone: 'Middle/Earth' }, code: 'INVALID_INPUT' },
    { input: { zone: 'Europe/London', at: 'not a date' }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' }
  ],
  run (input) {
    const at = input.at ? new Date(input.at) : new Date(input.now);
    if (Number.isNaN(at.getTime())) return fail('INVALID_INPUT', `"${input.at}" is not a timestamp I can read.`, 'at');

    const hit = findZone(input.zone);
    if (!hit) return fail('INVALID_INPUT', `I don't know a time zone called "${input.zone}" — try an IANA name like Europe/London.`, 'zone');

    const mins = offsetMinutesAt(hit.zone, at);
    const dst = daylightSavingAt(hit.zone, at);
    return ok({
      zone: hit.zone, offset: formatOffset(mins), offsetMinutes: mins,
      localTime: localTimeIn(hit.zone, at),
      inDaylightSaving: dst.inDaylightSaving, usesDaylightSaving: dst.usesDaylightSaving,
      alternatives: hit.others
    }, computed());
  }
};
