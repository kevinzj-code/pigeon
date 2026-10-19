import { ok, fail, computed } from '../src/contracts.js';
import { parseDate, dayNumber, toISO } from '../src/lib/dates.js';
import { round } from '../src/lib/num.js';

export default {
  name: 'habitCompletionRate',
  description: 'Work out how many days you kept a habit, as a percentage of the days in the period.',
  category: 'organising', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{completed}} of {{totalDays}} days — {{rate}}%. {{missed}} missed.',
  inputSchema: {
    type: 'object', required: ['dates', 'from', 'to'],
    properties: {
      dates: { type: 'array', label: 'days done', minItems: 0, maxItems: 3650, items: { type: 'string' }, prompt: 'Which days was it done?' },
      from: { type: 'string', label: 'start date', prompt: 'What is the first day of the period?' },
      to: { type: 'string', label: 'end date', prompt: 'And the last day?' }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      rate: { type: 'number' }, completed: { type: 'integer' }, missed: { type: 'integer' },
      totalDays: { type: 'integer' }, from: { type: 'string' }, to: { type: 'string' },
      outsidePeriod: { type: 'integer' }
    }
  },
  examples: [
    { text: 'how often did I keep this habit', input: { dates: ['2026-08-01', '2026-08-02', '2026-08-03'], from: '2026-08-01', to: '2026-08-10' }, output: { rate: 30, completed: 3, missed: 7, totalDays: 10, from: '2026-08-01', to: '2026-08-10', outsidePeriod: 0 } },
    { text: 'what is my completion rate this week', input: { dates: ['2026-08-25', '2026-08-26', '2026-08-27', '2026-08-28', '2026-08-29', '2026-08-30', '2026-08-31'], from: '2026-08-25', to: '2026-08-31' }, output: { rate: 100, completed: 7, missed: 0, totalDays: 7, from: '2026-08-25', to: '2026-08-31', outsidePeriod: 0 } },
    { text: 'habit rate for a month', input: { dates: ['2026-08-01', '2026-08-05', '2026-08-10', '2026-08-15', '2026-08-20'], from: '2026-08-01', to: '2026-08-20' }, output: { rate: 25, completed: 5, missed: 15, totalDays: 20, from: '2026-08-01', to: '2026-08-20', outsidePeriod: 0 } },
    { text: 'did I do it every day', input: { dates: [], from: '2026-08-01', to: '2026-08-05' }, output: { rate: 0, completed: 0, missed: 5, totalDays: 5, from: '2026-08-01', to: '2026-08-05', outsidePeriod: 0 } },
    { text: 'completion rate ignoring days outside the period', input: { dates: ['2026-07-30', '2026-08-01', '2026-08-02'], from: '2026-08-01', to: '2026-08-04' }, output: { rate: 50, completed: 2, missed: 2, totalDays: 4, from: '2026-08-01', to: '2026-08-04', outsidePeriod: 1 } },
    { text: 'on what share of days did I keep the streak going', input: { dates: ['2026-08-01', '2026-08-03', '2026-08-04'], from: '2026-08-01', to: '2026-08-05' },
      output: { rate: 60, completed: 3, missed: 2, totalDays: 5, from: '2026-08-01', to: '2026-08-05', outsidePeriod: 0 } },
    { text: 'how consistent was I with this over the month', input: { dates: ['2026-07-02', '2026-07-09', '2026-07-16', '2026-07-23'], from: '2026-07-01', to: '2026-07-31' },
      output: { rate: 12.9, completed: 4, missed: 27, totalDays: 31, from: '2026-07-01', to: '2026-07-31', outsidePeriod: 0 } }
  ],
  errorCases: [
    { input: { dates: [], from: '2026-08-10', to: '2026-08-01' }, code: 'INVALID_INPUT' },
    { input: { dates: ['nope'], from: '2026-08-01', to: '2026-08-05' }, code: 'INVALID_INPUT' },
    { input: { dates: [], from: '2026-08-01' }, code: 'MISSING_FIELD' }
  ],
  run (input, ctx) {
    const at = (v, field) => {
      const p = parseDate(v, { ...ctx, now: input.now });
      if (!p.ok) return { error: fail('INVALID_INPUT', `"${v}" is not a date I can read — ${p.reason}.`, field) };
      return { day: dayNumber(p.ymd.y, p.ymd.m, p.ymd.d), ymd: p.ymd };
    };

    const from = at(input.from, 'from');
    if (from.error) return from.error;
    const to = at(input.to, 'to');
    if (to.error) return to.error;
    if (to.day < from.day) return fail('INVALID_INPUT', 'The period ends before it starts.', 'to');

    const done = new Set();
    let outsidePeriod = 0;
    for (const d of input.dates) {
      const parsed = at(d, 'dates');
      if (parsed.error) return parsed.error;
      /* Days logged outside the window are counted separately rather than
         silently dropped or folded in — either would misreport the rate, and
         a stray entry is usually worth knowing about. */
      if (parsed.day < from.day || parsed.day > to.day) { outsidePeriod++; continue; }
      done.add(parsed.day);
    }

    const totalDays = to.day - from.day + 1;
    const completed = done.size;
    return ok({
      rate: round((completed / totalDays) * 100, 1),
      completed, missed: totalDays - completed, totalDays,
      from: toISO(from.ymd), to: toISO(to.ymd), outsidePeriod
    }, computed());
  }
};
