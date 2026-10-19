import { ok, fail, computed } from '../src/contracts.js';

const parseTime = (t) => {
  const parts = String(t).trim().split(':').map(Number);
  if (parts.some((n) => !Number.isFinite(n) || n < 0)) return null;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
};

const fmt = (s) => {
  const n = Math.round(s);
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  const sec = n % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
};

export default {
  name: 'splitTimes',
  description: 'Work out the pace and split times needed to finish a distance in a target time.',
  category: 'health', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null,
  /* No label: this is exact division, not a formula that models a body. The
     pace is arithmetic and nothing about it is an estimate — which is also why
     it offers no target and no advice, only the times. */
  labels: [],
  replyTemplate: '{{pace}} per {{unit}} to finish {{distance}} {{unit}} in {{totalTime}}. Splits: {{lines|list}}.',
  inputSchema: {
    type: 'object', required: ['distance', 'time'],
    properties: {
      distance: { type: 'number', label: 'distance', minimum: 0.1, maximum: 1000, prompt: 'How far?' },
      time: { type: 'string', label: 'target time', prompt: 'What is the target time? Write it as 50:00 or 1:45:00.' },
      unit: { type: 'string', label: 'distance unit', enum: ['km', 'miles'], default: 'km' }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      pace: { type: 'string' }, paceSeconds: { type: 'number' }, totalTime: { type: 'string' },
      splits: { type: 'array' }, lines: { type: 'array', items: { type: 'string' } },
      distance: { type: 'number' }, unit: { type: 'string' }
    }
  },
  examples: [
    { text: 'split times for a 10k in 50 minutes', input: { distance: 10, time: '50:00' }, output: { pace: '5:00', paceSeconds: 300, totalTime: '50:00', splits: [{ at: 1, time: '5:00' }, { at: 2, time: '10:00' }, { at: 3, time: '15:00' }, { at: 4, time: '20:00' }, { at: 5, time: '25:00' }, { at: 6, time: '30:00' }, { at: 7, time: '35:00' }, { at: 8, time: '40:00' }, { at: 9, time: '45:00' }, { at: 10, time: '50:00' }], lines: ['1 km 5:00', '2 km 10:00', '3 km 15:00', '4 km 20:00', '5 km 25:00', '6 km 30:00', '7 km 35:00', '8 km 40:00', '9 km 45:00', '10 km 50:00'], distance: 10, unit: 'km' } },
    { text: 'what pace do I need for a 5k in 22:30', input: { distance: 5, time: '22:30' }, output: { pace: '4:30', paceSeconds: 270, totalTime: '22:30', splits: [{ at: 1, time: '4:30' }, { at: 2, time: '9:00' }, { at: 3, time: '13:30' }, { at: 4, time: '18:00' }, { at: 5, time: '22:30' }], lines: ['1 km 4:30', '2 km 9:00', '3 km 13:30', '4 km 18:00', '5 km 22:30'], distance: 5, unit: 'km' } },
    { text: 'pace for 3 miles in 24 minutes', input: { distance: 3, time: '24:00', unit: 'miles' }, output: { pace: '8:00', paceSeconds: 480, totalTime: '24:00', splits: [{ at: 1, time: '8:00' }, { at: 2, time: '16:00' }, { at: 3, time: '24:00' }], lines: ['1 miles 8:00', '2 miles 16:00', '3 miles 24:00'], distance: 3, unit: 'miles' } },
    { text: 'splits for 4km in 20 minutes', input: { distance: 4, time: '20:00' }, output: { pace: '5:00', paceSeconds: 300, totalTime: '20:00', splits: [{ at: 1, time: '5:00' }, { at: 2, time: '10:00' }, { at: 3, time: '15:00' }, { at: 4, time: '20:00' }], lines: ['1 km 5:00', '2 km 10:00', '3 km 15:00', '4 km 20:00'], distance: 4, unit: 'km' } },
    { text: 'pace for 2km in 9 minutes', input: { distance: 2, time: '9:00' }, output: { pace: '4:30', paceSeconds: 270, totalTime: '9:00', splits: [{ at: 1, time: '4:30' }, { at: 2, time: '9:00' }], lines: ['1 km 4:30', '2 km 9:00'], distance: 2, unit: 'km' } }
  ],
  errorCases: [
    { input: { distance: 10, time: 'fast' }, code: 'INVALID_INPUT' },
    { input: { distance: 10, time: '0:00' }, code: 'INVALID_INPUT' },
    { input: { distance: 10 }, code: 'MISSING_FIELD' }
  ],
  run (input) {
    const seconds = parseTime(input.time);
    if (seconds === null) return fail('INVALID_INPUT', `"${input.time}" is not a time I can read — write it as 50:00 or 1:45:00.`, 'time');
    if (seconds === 0) return fail('INVALID_INPUT', 'The target time has to be more than zero.', 'time');

    const unit = input.unit ?? 'km';
    const paceSeconds = seconds / input.distance;
    const splits = [];
    /* Whole units only, plus the finish when the distance is not a whole number
       — a half marathon is 21.1 km and its 21st split is not the finish line. */
    for (let k = 1; k <= Math.floor(input.distance); k++) splits.push({ at: k, time: fmt(paceSeconds * k) });
    if (input.distance % 1 !== 0) splits.push({ at: input.distance, time: fmt(seconds) });

    return ok({
      pace: fmt(paceSeconds), paceSeconds: Math.round(paceSeconds * 100) / 100,
      totalTime: fmt(seconds), splits,
      lines: splits.map((s) => `${s.at} ${unit} ${s.time}`),
      distance: input.distance, unit
    }, computed());
  }
};
