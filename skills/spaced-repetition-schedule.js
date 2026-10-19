import { ok, fail, computed } from '../src/contracts.js';
import { parseDate, toISO, dayNumber, fromDayNumber, weekdayOf } from '../src/lib/dates.js';

/* Expanding intervals, the shape every spaced-repetition system shares: review
   soon after learning, then at widening gaps. These are fixed rather than
   adapted to how well each review went - the skill has no record of that and is
   not going to invent one. */
const DEFAULT_INTERVALS = [1, 3, 7, 14, 30, 90];

export default {
  name: 'spacedRepetitionSchedule',
  description: 'Work out the review dates for spaced repetition from a starting date.',
  category: 'learning', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{count}} {{count|plural:review:reviews}} from {{startDate}}: {{lines|list}}.',
  inputSchema: {
    type: 'object',
    properties: {
      date: { type: 'string', label: 'date learned', description: 'the day the material was first learned - today by default' },
      intervals: { type: 'array', label: 'review after (days)', maxItems: 20, items: { type: 'integer' }, description: 'days after the start date to review on' }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      reviews: { type: 'array' }, lines: { type: 'array', items: { type: 'string' } },
      count: { type: 'integer' }, startDate: { type: 'string' }, lastReview: { type: 'string' }
    }
  },
  examples: [
    { text: 'when should I review this', input: { date: '2026-09-01' }, output: { reviews: [{ after: 1, date: '2026-09-02', weekday: 'Wednesday' }, { after: 3, date: '2026-09-04', weekday: 'Friday' }, { after: 7, date: '2026-09-08', weekday: 'Tuesday' }, { after: 14, date: '2026-09-15', weekday: 'Tuesday' }, { after: 30, date: '2026-10-01', weekday: 'Thursday' }, { after: 90, date: '2026-11-30', weekday: 'Monday' }], lines: ['2026-09-02 after 1 day', '2026-09-04 after 3 days', '2026-09-08 after 7 days', '2026-09-15 after 14 days', '2026-10-01 after 30 days', '2026-11-30 after 90 days'], count: 6, startDate: '2026-09-01', lastReview: '2026-11-30' } },
    { text: 'spaced repetition schedule doubling each time', input: { date: '2026-09-01', intervals: [1, 2, 4, 8] }, output: { reviews: [{ after: 1, date: '2026-09-02', weekday: 'Wednesday' }, { after: 2, date: '2026-09-03', weekday: 'Thursday' }, { after: 4, date: '2026-09-05', weekday: 'Saturday' }, { after: 8, date: '2026-09-09', weekday: 'Wednesday' }], lines: ['2026-09-02 after 1 day', '2026-09-03 after 2 days', '2026-09-05 after 4 days', '2026-09-09 after 8 days'], count: 4, startDate: '2026-09-01', lastReview: '2026-09-09' } },
    { text: 'review dates one week and one month out', input: { date: '2026-09-01', intervals: [1, 7, 30] }, output: { reviews: [{ after: 1, date: '2026-09-02', weekday: 'Wednesday' }, { after: 7, date: '2026-09-08', weekday: 'Tuesday' }, { after: 30, date: '2026-10-01', weekday: 'Thursday' }], lines: ['2026-09-02 after 1 day', '2026-09-08 after 7 days', '2026-10-01 after 30 days'], count: 3, startDate: '2026-09-01', lastReview: '2026-10-01' } },
    { text: 'revision schedule starting in december', input: { date: '2026-12-15', intervals: [1, 3, 7] }, output: { reviews: [{ after: 1, date: '2026-12-16', weekday: 'Wednesday' }, { after: 3, date: '2026-12-18', weekday: 'Friday' }, { after: 7, date: '2026-12-22', weekday: 'Tuesday' }], lines: ['2026-12-16 after 1 day', '2026-12-18 after 3 days', '2026-12-22 after 7 days'], count: 3, startDate: '2026-12-15', lastReview: '2026-12-22' } },
    { text: 'give me a revision plan from today', input: {}, output: { reviews: [{ after: 1, date: '2026-09-02', weekday: 'Wednesday' }, { after: 3, date: '2026-09-04', weekday: 'Friday' }, { after: 7, date: '2026-09-08', weekday: 'Tuesday' }, { after: 14, date: '2026-09-15', weekday: 'Tuesday' }, { after: 30, date: '2026-10-01', weekday: 'Thursday' }, { after: 90, date: '2026-11-30', weekday: 'Monday' }], lines: ['2026-09-02 after 1 day', '2026-09-04 after 3 days', '2026-09-08 after 7 days', '2026-09-15 after 14 days', '2026-10-01 after 30 days', '2026-11-30 after 90 days'], count: 6, startDate: '2026-09-01', lastReview: '2026-11-30' } }
  ],
  errorCases: [
    { input: { date: 'whenever' }, code: 'INVALID_INPUT' },
    { input: { date: '2026-09-01', intervals: [0] }, code: 'INVALID_INPUT' },
    { input: { date: '2026-09-01', intervals: [3, 1] }, code: 'INVALID_INPUT' }
  ],
  run (input, ctx) {
    const parsed = parseDate(input.date ?? 'today', { ...ctx, now: input.now });
    if (!parsed.ok) return fail('INVALID_INPUT', `"${input.date}" is not a date I can read — ${parsed.reason}.`, 'date');

    const intervals = input.intervals?.length ? input.intervals : DEFAULT_INTERVALS;
    for (const [i, n] of intervals.entries()) {
      if (n < 1) return fail('INVALID_INPUT', 'Every interval has to be at least one day after the start.', 'intervals');
      if (i > 0 && n <= intervals[i - 1]) return fail('INVALID_INPUT', `Intervals have to increase — ${n} comes after ${intervals[i - 1]}.`, 'intervals');
    }

    const start = dayNumber(parsed.ymd.y, parsed.ymd.m, parsed.ymd.d);
    const reviews = intervals.map((after) => {
      const at = fromDayNumber(start + after);
      return { after, date: toISO(at), weekday: weekdayOf(at) };
    });

    return ok({
      reviews,
      lines: reviews.map((r) => `${r.date} after ${r.after} ${r.after === 1 ? 'day' : 'days'}`),
      count: reviews.length, startDate: toISO(parsed.ymd),
      lastReview: reviews[reviews.length - 1].date
    }, computed());
  }
};
