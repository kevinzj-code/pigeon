import { ok, fail, computed } from '../src/contracts.js';

const HHMM = /^([01]?\d|2[0-3]):([0-5]\d)$/;
const toMinutes = (t) => { const m = HHMM.exec(String(t).trim()); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
const toClock = (n) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;

export default {
  name: 'generateSchedule',
  description: 'Divide a stretch of time into even slots, with optional breaks between them.',
  category: 'generation', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{count}} {{count|plural:slot:slots}} of {{slotMinutes}} minutes:\n{{lines|lines}}',
  inputSchema: {
    type: 'object', required: ['start', 'end'],
    properties: {
      start: { type: 'string', label: 'start time', prompt: 'What time does it start?' },
      end: { type: 'string', label: 'end time', prompt: 'What time does it end?' },
      slots: { type: 'integer', label: 'number of slots', minimum: 1, maximum: 100, description: 'how many slots to divide the time into' },
      slotMinutes: { type: 'integer', label: 'slot length (minutes)', minimum: 1, maximum: 1440, description: 'how long each slot should be' },
      breakMinutes: { type: 'integer', label: 'break (minutes)', minimum: 0, maximum: 240, default: 0 }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      slots: { type: 'array' }, lines: { type: 'array', items: { type: 'string' } },
      count: { type: 'integer' }, slotMinutes: { type: 'integer' },
      breakMinutes: { type: 'integer' }, leftoverMinutes: { type: 'integer' }
    }
  },
  examples: [
    { text: 'split 9am to noon into three slots', input: { start: '09:00', end: '12:00', slots: 3 }, output: { slots: [{ start: '09:00', end: '10:00' }, { start: '10:00', end: '11:00' }, { start: '11:00', end: '12:00' }], lines: ['09:00 – 10:00', '10:00 – 11:00', '11:00 – 12:00'], count: 3, slotMinutes: 60, breakMinutes: 0, leftoverMinutes: 0 } },
    { text: 'ninety minute sessions from 9 to 5', input: { start: '09:00', end: '17:00', slotMinutes: 90 }, output: { slots: [{ start: '09:00', end: '10:30' }, { start: '10:30', end: '12:00' }, { start: '12:00', end: '13:30' }, { start: '13:30', end: '15:00' }, { start: '15:00', end: '16:30' }], lines: ['09:00 – 10:30', '10:30 – 12:00', '12:00 – 13:30', '13:30 – 15:00', '15:00 – 16:30'], count: 5, slotMinutes: 90, breakMinutes: 0, leftoverMinutes: 30 } },
    { text: 'three slots with fifteen minute breaks', input: { start: '09:00', end: '12:00', slots: 3, breakMinutes: 15 }, output: { slots: [{ start: '09:00', end: '09:50' }, { start: '10:05', end: '10:55' }, { start: '11:10', end: '12:00' }], lines: ['09:00 – 09:50', '10:05 – 10:55', '11:10 – 12:00'], count: 3, slotMinutes: 50, breakMinutes: 15, leftoverMinutes: 0 } },
    { text: 'twenty minute slots for an hour', input: { start: '13:00', end: '14:00', slotMinutes: 20 }, output: { slots: [{ start: '13:00', end: '13:20' }, { start: '13:20', end: '13:40' }, { start: '13:40', end: '14:00' }], lines: ['13:00 – 13:20', '13:20 – 13:40', '13:40 – 14:00'], count: 3, slotMinutes: 20, breakMinutes: 0, leftoverMinutes: 0 } },
    { text: 'one slot from 10 to half past', input: { start: '10:00', end: '10:30', slots: 1 }, output: { slots: [{ start: '10:00', end: '10:30' }], lines: ['10:00 – 10:30'], count: 1, slotMinutes: 30, breakMinutes: 0, leftoverMinutes: 0 } }
  ],
  errorCases: [
    { input: { start: '09:00', end: '09:00', slots: 2 }, code: 'INVALID_INPUT' },
    { input: { start: '17:00', end: '09:00', slots: 2 }, code: 'INVALID_INPUT' },
    { input: { start: '09:00', end: '10:00' }, code: 'INVALID_INPUT' },
    { input: { start: '09:00', end: '10:00', slots: 3, slotMinutes: 20 }, code: 'INVALID_INPUT' }
  ],
  run (input) {
    const from = toMinutes(input.start);
    const to = toMinutes(input.end);
    if (from === null) return fail('INVALID_INPUT', `"${input.start}" is not a time I can read — use 24-hour HH:MM.`, 'start');
    if (to === null) return fail('INVALID_INPUT', `"${input.end}" is not a time I can read — use 24-hour HH:MM.`, 'end');
    if (to <= from) return fail('INVALID_INPUT', 'The end time has to be after the start time — this schedule does not cross midnight.', 'end');

    const hasCount = input.slots !== undefined;
    const hasLength = input.slotMinutes !== undefined;
    if (hasCount === hasLength) {
      return fail('INVALID_INPUT', 'Tell me either how many slots you want or how long each one should be — with both, the two answers would disagree.', hasCount ? 'slotMinutes' : 'slots');
    }

    const total = to - from;
    const gap = input.breakMinutes ?? 0;
    let count; let length;
    if (hasCount) {
      count = input.slots;
      const usable = total - gap * (count - 1);
      if (usable < count) return fail('INVALID_INPUT', `${total} minutes cannot hold ${count} slots with ${gap}-minute breaks between them.`, 'slots');
      length = Math.floor(usable / count);
    } else {
      length = input.slotMinutes;
      count = Math.floor((total + gap) / (length + gap));
      if (count < 1) return fail('INVALID_INPUT', `${total} minutes is not long enough for even one ${length}-minute slot.`, 'slotMinutes');
    }

    const slots = [];
    let cursor = from;
    for (let i = 0; i < count; i++) {
      slots.push({ start: toClock(cursor), end: toClock(cursor + length) });
      cursor += length + gap;
    }
    /* Time left at the end is reported rather than absorbed. Silently
       stretching the last slot to reach the end time would make the slots
       uneven, which is the one thing this skill promised they would not be. */
    const used = count * length + gap * (count - 1);
    return ok({
      slots, lines: slots.map((s) => `${s.start} – ${s.end}`),
      count, slotMinutes: length, breakMinutes: gap, leftoverMinutes: total - used
    }, computed());
  }
};
