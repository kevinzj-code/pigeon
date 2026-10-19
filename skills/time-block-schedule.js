import { ok, fail, computed } from '../src/contracts.js';

const HHMM = /^([01]?\d|2[0-3]):([0-5]\d)$/;
const toMinutes = (t) => { const m = HHMM.exec(String(t).trim()); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
const toClock = (n) => `${String(Math.floor(n / 60) % 24).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;

export default {
  name: 'timeBlockSchedule',
  description: 'Lay tasks out as time blocks through the day, with breaks between them.',
  category: 'organising', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{count}} blocks from {{startTime}} to {{endTime}} — {{workMinutes}} minutes of work, {{breakMinutes}} on breaks:\n{{lines|lines}}',
  inputSchema: {
    type: 'object', required: ['tasks', 'start'],
    properties: {
      tasks: { type: 'array', label: 'tasks', minItems: 1, maxItems: 50, prompt: 'Which tasks, and how long does each take?' },
      start: { type: 'string', label: 'start time', prompt: 'What time do you start?' },
      breakMinutes: { type: 'integer', label: 'break (minutes)', minimum: 0, maximum: 240, default: 0 }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      blocks: { type: 'array' }, lines: { type: 'array', items: { type: 'string' } },
      count: { type: 'integer' }, startTime: { type: 'string' }, endTime: { type: 'string' },
      workMinutes: { type: 'integer' }, breakMinutes: { type: 'integer' }
    }
  },
  examples: [
    { text: 'block out my morning', input: { tasks: [{ task: 'writing', minutes: 90 }, { task: 'email', minutes: 30 }, { task: 'review', minutes: 60 }], start: '09:00', breakMinutes: 15 }, output: { blocks: [{ task: 'writing', start: '09:00', end: '10:30', minutes: 90 }, { task: 'email', start: '10:45', end: '11:15', minutes: 30 }, { task: 'review', start: '11:30', end: '12:30', minutes: 60 }], lines: ['09:00 - 10:30 writing', '10:45 - 11:15 email', '11:30 - 12:30 review'], count: 3, startTime: '09:00', endTime: '12:30', workMinutes: 180, breakMinutes: 30 } },
    { text: 'schedule these tasks back to back', input: { tasks: [{ task: 'standup', minutes: 15 }, { task: 'coding', minutes: 120 }], start: '09:30' }, output: { blocks: [{ task: 'standup', start: '09:30', end: '09:45', minutes: 15 }, { task: 'coding', start: '09:45', end: '11:45', minutes: 120 }], lines: ['09:30 - 09:45 standup', '09:45 - 11:45 coding'], count: 2, startTime: '09:30', endTime: '11:45', workMinutes: 135, breakMinutes: 0 } },
    { text: 'time block a single task', input: { tasks: [{ task: 'deep work', minutes: 180 }], start: '08:00' }, output: { blocks: [{ task: 'deep work', start: '08:00', end: '11:00', minutes: 180 }], lines: ['08:00 - 11:00 deep work'], count: 1, startTime: '08:00', endTime: '11:00', workMinutes: 180, breakMinutes: 0 } },
    { text: 'plan an afternoon with short breaks', input: { tasks: [{ task: 'calls', minutes: 45 }, { task: 'admin', minutes: 45 }], start: '13:00', breakMinutes: 10 }, output: { blocks: [{ task: 'calls', start: '13:00', end: '13:45', minutes: 45 }, { task: 'admin', start: '13:55', end: '14:40', minutes: 45 }], lines: ['13:00 - 13:45 calls', '13:55 - 14:40 admin'], count: 2, startTime: '13:00', endTime: '14:40', workMinutes: 90, breakMinutes: 10 } },
    { text: 'block out four short tasks', input: { tasks: [{ task: 'a', minutes: 20 }, { task: 'b', minutes: 20 }, { task: 'c', minutes: 20 }, { task: 'd', minutes: 20 }], start: '10:00', breakMinutes: 5 }, output: { blocks: [{ task: 'a', start: '10:00', end: '10:20', minutes: 20 }, { task: 'b', start: '10:25', end: '10:45', minutes: 20 }, { task: 'c', start: '10:50', end: '11:10', minutes: 20 }, { task: 'd', start: '11:15', end: '11:35', minutes: 20 }], lines: ['10:00 - 10:20 a', '10:25 - 10:45 b', '10:50 - 11:10 c', '11:15 - 11:35 d'], count: 4, startTime: '10:00', endTime: '11:35', workMinutes: 80, breakMinutes: 15 } }
  ],
  errorCases: [
    { input: { tasks: [{ task: 'x', minutes: 30 }], start: 'morning' }, code: 'INVALID_INPUT' },
    { input: { tasks: [{ task: 'x', minutes: 0 }], start: '09:00' }, code: 'INVALID_INPUT' },
    { input: { tasks: [{ task: 'x', minutes: 30 }] }, code: 'MISSING_FIELD' }
  ],
  run (input) {
    const start = toMinutes(input.start);
    if (start === null) return fail('INVALID_INPUT', `"${input.start}" is not a time I can read — use 24-hour HH:MM.`, 'start');

    const gap = input.breakMinutes ?? 0;
    const blocks = [];
    let cursor = start;
    let workMinutes = 0;
    for (const [i, t] of input.tasks.entries()) {
      const task = String(t?.task ?? '').trim();
      const minutes = Number(t?.minutes);
      if (!task) return fail('INVALID_INPUT', `Task ${i + 1} has no name.`, 'tasks');
      if (!Number.isFinite(minutes) || minutes <= 0) return fail('INVALID_INPUT', `Task ${i + 1} has no usable length in minutes.`, 'tasks');
      blocks.push({ task, start: toClock(cursor), end: toClock(cursor + minutes), minutes });
      workMinutes += minutes;
      cursor += minutes;
      /* No break after the last task — the day ends when the work does, and a
         trailing break would push the reported finish time later than it is. */
      if (i < input.tasks.length - 1) cursor += gap;
    }

    return ok({
      blocks, lines: blocks.map((b) => `${b.start} - ${b.end} ${b.task}`),
      count: blocks.length, startTime: toClock(start), endTime: toClock(cursor),
      workMinutes, breakMinutes: gap * Math.max(0, input.tasks.length - 1)
    }, computed());
  }
};
