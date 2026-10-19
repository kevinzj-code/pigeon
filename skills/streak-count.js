import { ok, fail, computed } from '../src/contracts.js';
import { parseDate, toISO, dayNumber, fromDayNumber as fromDay } from '../src/lib/dates.js';

export default {
  name: 'streakCount',
  description: 'Count the days done in a row from a list of dates — the current and longest streak.',
  category: 'organising', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: 'Current streak {{currentStreak}} {{currentStreak|plural:day:days}}, longest {{longestStreak}}. {{totalDays}} days recorded across {{runCount}} {{runCount|plural:run:runs}}.',
  inputSchema: {
    type: 'object', required: ['dates'],
    properties: {
      dates: { type: 'array', label: 'dates', minItems: 1, maxItems: 3650, items: { type: 'string' }, prompt: 'Which dates should I count?' },
      asOf: { type: 'string', label: 'count back from', description: 'the day to count the current streak back from - today by default' }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      currentStreak: { type: 'integer' }, longestStreak: { type: 'integer' },
      totalDays: { type: 'integer' }, runCount: { type: 'integer' },
      longestRun: { type: 'object' }, runs: { type: 'array' }, asOf: { type: 'string' }
    }
  },
  examples: [
    { text: 'how long is my streak', input: { dates: ['2026-08-28', '2026-08-29', '2026-08-30', '2026-09-01'], asOf: '2026-09-01' }, output: { currentStreak: 1, longestStreak: 3, totalDays: 4, runCount: 2, longestRun: { start: '2026-08-28', end: '2026-08-30', length: 3 }, runs: [{ start: '2026-08-28', end: '2026-08-30', length: 3 }, { start: '2026-09-01', end: '2026-09-01', length: 1 }], asOf: '2026-09-01' } },
    { text: 'what is my current run of days', input: { dates: ['2026-08-30', '2026-08-31', '2026-09-01'], asOf: '2026-09-01' }, output: { currentStreak: 3, longestStreak: 3, totalDays: 3, runCount: 1, longestRun: { start: '2026-08-30', end: '2026-09-01', length: 3 }, runs: [{ start: '2026-08-30', end: '2026-09-01', length: 3 }], asOf: '2026-09-01' } },
    { text: 'did I break my streak', input: { dates: ['2026-08-20', '2026-08-21'], asOf: '2026-09-01' }, output: { currentStreak: 0, longestStreak: 2, totalDays: 2, runCount: 1, longestRun: { start: '2026-08-20', end: '2026-08-21', length: 2 }, runs: [{ start: '2026-08-20', end: '2026-08-21', length: 2 }], asOf: '2026-09-01' } },
    { text: 'count my streak counting yesterday', input: { dates: ['2026-08-30', '2026-08-31'], asOf: '2026-09-01' }, output: { currentStreak: 2, longestStreak: 2, totalDays: 2, runCount: 1, longestRun: { start: '2026-08-30', end: '2026-08-31', length: 2 }, runs: [{ start: '2026-08-30', end: '2026-08-31', length: 2 }], asOf: '2026-09-01' } },
    { text: 'streak from a single day', input: { dates: ['2026-09-01'], asOf: '2026-09-01' }, output: { currentStreak: 1, longestStreak: 1, totalDays: 1, runCount: 1, longestRun: { start: '2026-09-01', end: '2026-09-01', length: 1 }, runs: [{ start: '2026-09-01', end: '2026-09-01', length: 1 }], asOf: '2026-09-01' } }
  ],
  errorCases: [
    { input: { dates: ['not a date'] }, code: 'INVALID_INPUT' },
    { input: { dates: [] }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' }
  ],
  run (input, ctx) {
    const days = [];
    for (const d of input.dates) {
      const p = parseDate(d, { ...ctx, now: input.now });
      if (!p.ok) return fail('INVALID_INPUT', `"${d}" is not a date I can read — ${p.reason}.`, 'dates');
      days.push(dayNumber(p.ymd.y, p.ymd.m, p.ymd.d));
    }
    const asOfParsed = parseDate(input.asOf ?? 'today', { ...ctx, now: input.now });
    if (!asOfParsed.ok) return fail('INVALID_INPUT', `"${input.asOf}" is not a date I can read — ${asOfParsed.reason}.`, 'asOf');
    const asOf = dayNumber(asOfParsed.ymd.y, asOfParsed.ymd.m, asOfParsed.ymd.d);

    /* Duplicates are collapsed before counting. Logging the same day twice is a
       common way to keep a habit list, and counting it twice would inflate every
       streak it appears in. */
    const unique = [...new Set(days)].sort((a, b) => a - b);
    const runs = [];
    for (const day of unique) {
      const last = runs[runs.length - 1];
      if (last && day === last.endDay + 1) { last.endDay = day; last.length++; }
      else runs.push({ startDay: day, endDay: day, length: 1 });
    }

    /* A streak that ends yesterday is still alive - today is not over. It only
       breaks once a whole day has passed with nothing logged. */
    const latest = runs[runs.length - 1];
    const currentStreak = latest && (latest.endDay === asOf || latest.endDay === asOf - 1) ? latest.length : 0;
    const longest = runs.reduce((a, b) => (b.length > a.length ? b : a), runs[0]);
    const iso = (r) => ({ start: toISO(fromDay(r.startDay)), end: toISO(fromDay(r.endDay)), length: r.length });

    return ok({
      currentStreak, longestStreak: longest.length,
      totalDays: unique.length, runCount: runs.length,
      longestRun: iso(longest), runs: runs.map(iso), asOf: toISO(asOfParsed.ymd)
    }, computed());
  }
};
