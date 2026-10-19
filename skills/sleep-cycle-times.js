import { ok, fail, computed } from '../src/contracts.js';

/* §27: formula-only. This adds multiples of a cycle length to a time. The
 * 90-minute figure is an average from sleep research and varies between people
 * and across a night — so it is an INPUT with a default, not a constant, and
 * the reply says the arithmetic is what it is. No advice about how much sleep
 * anyone needs appears anywhere in this file. */
export default {
  name: 'sleepCycleTimes',
  description: 'Work out wake or bedtimes a whole number of sleep cycles apart.',
  category: 'health', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: ['formula-only', 'estimate'],
  replyTemplate: 'Counting back from {{time}}: {{summary|prose}}.{{note|prose}}',
  inputSchema: {
    type: 'object', required: ['time'],
    properties: {
      time: { type: 'string', label: 'time', pattern: '^\\d{1,2}:\\d{2}$', prompt: 'What time? (24-hour, like 07:00)' },
      direction: { type: 'string', label: 'time given is', enum: ['wake', 'sleep'], default: 'wake', description: 'wake = the time given is when you want to get up' },
      cycleMinutes: { type: 'integer', label: 'cycle length (minutes)', minimum: 30, maximum: 180, default: 90 },
      fallAsleepMinutes: { type: 'integer', label: 'minutes to fall asleep', minimum: 0, maximum: 120, default: 14 }
    }
  },
  outputSchema: { type: 'object', properties: { times: { type: 'array', items: { type: 'string' } }, cycles: { type: 'array', items: { type: 'integer' } }, summary: { type: 'string' }, time: { type: 'string' }, direction: { type: 'string' }, note: { type: 'string' } } },
  examples: [
    { text: 'when should I go to bed to wake at 7am', input: { time: '07:00' }, output: { times: ['21:46', '23:16', '00:46', '02:16', '03:46', '05:16'], cycles: [6, 5, 4, 3, 2, 1], summary: '21:46 for 6 cycles, 23:16 for 5, 00:46 for 4, 02:16 for 3, 03:46 for 2, 05:16 for 1', time: '07:00', direction: 'wake', note: ' Cycle length varies between people and across a night — this is arithmetic on the figure you gave.' } },
    { text: 'bedtimes to wake at 06:30', input: { time: '06:30' }, output: { times: ['21:16', '22:46', '00:16', '01:46', '03:16', '04:46'], cycles: [6, 5, 4, 3, 2, 1], summary: '21:16 for 6 cycles, 22:46 for 5, 00:16 for 4, 01:46 for 3, 03:16 for 2, 04:46 for 1', time: '06:30', direction: 'wake', note: ' Cycle length varies between people and across a night — this is arithmetic on the figure you gave.' } },
    { text: 'if I go to sleep now at 23:00 when should I wake', input: { time: '23:00', direction: 'sleep' }, output: { times: ['00:44', '02:14', '03:44', '05:14', '06:44', '08:14'], cycles: [1, 2, 3, 4, 5, 6], summary: '00:44 for 1 cycle, 02:14 for 2, 03:44 for 3, 05:14 for 4, 06:44 for 5, 08:14 for 6', time: '23:00', direction: 'sleep', note: ' Cycle length varies between people and across a night — this is arithmetic on the figure you gave.' } },
    { text: 'wake times with a 100 minute cycle', input: { time: '22:00', direction: 'sleep', cycleMinutes: 100 }, output: { times: ['23:54', '01:34', '03:14', '04:54', '06:34', '08:14'], cycles: [1, 2, 3, 4, 5, 6], summary: '23:54 for 1 cycle, 01:34 for 2, 03:14 for 3, 04:54 for 4, 06:34 for 5, 08:14 for 6', time: '22:00', direction: 'sleep', note: ' Cycle length varies between people and across a night — this is arithmetic on the figure you gave.' } },
    { text: 'bedtimes for a 08:00 alarm with no wind-down', input: { time: '08:00', fallAsleepMinutes: 0 }, output: { times: ['23:00', '00:30', '02:00', '03:30', '05:00', '06:30'], cycles: [6, 5, 4, 3, 2, 1], summary: '23:00 for 6 cycles, 00:30 for 5, 02:00 for 4, 03:30 for 3, 05:00 for 2, 06:30 for 1', time: '08:00', direction: 'wake', note: ' Cycle length varies between people and across a night — this is arithmetic on the figure you gave.' } }
  ],
  errorCases: [
    { input: { time: '25:00' }, code: 'INVALID_INPUT' },
    { input: { time: 'bedtime' }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' }
  ],
  run (input) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(input.time.trim());
    if (!m) return fail('INVALID_INPUT', `I couldn't read "${input.time}" as a time.`, 'time');
    const [h, mi] = [Number(m[1]), Number(m[2])];
    if (h > 23 || mi > 59) return fail('INVALID_INPUT', 'That is not a real time of day.', 'time');

    const base = h * 60 + mi;
    const pad = (n) => String(n).padStart(2, '0');
    const clock = (mins) => {
      /* Wraps around midnight — a bedtime six cycles before 07:00 is the
         previous evening, and a negative minute count would otherwise print
         as a negative hour. */
      const t = ((mins % 1440) + 1440) % 1440;
      return `${pad(Math.floor(t / 60))}:${pad(t % 60)}`;
    };

    const counts = [1, 2, 3, 4, 5, 6];
    const order = input.direction === 'wake' ? [...counts].reverse() : counts;
    const times = order.map(n => clock(input.direction === 'wake'
      ? base - n * input.cycleMinutes - input.fallAsleepMinutes
      : base + input.fallAsleepMinutes + n * input.cycleMinutes));

    return ok({
      times, cycles: order,
      /* The word "cycle" appears once, on the first entry, and has to agree with
         ITS number — counting up from 1 gave "1 cycles". */
      summary: times.map((t, i) => `${t} for ${order[i]}${i === 0 ? (order[i] === 1 ? ' cycle' : ' cycles') : ''}`).join(', '),
      time: input.time, direction: input.direction,
      note: ' Cycle length varies between people and across a night — this is arithmetic on the figure you gave.'
    }, computed());
  }
};
