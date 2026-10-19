import { ok, fail, computed } from '../src/contracts.js';
import { parseDate, toISO, dayNumber, fromDayNumber, weekdayOf } from '../src/lib/dates.js';

export default {
  name: 'readingScheduleFromPages',
  description: 'Turn a page count into a daily reading schedule.',
  category: 'learning', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{pagesPerDay}} pages a day for {{days}} days finishes {{totalPages}} pages on {{finishDate}}.',
  inputSchema: {
    type: 'object', required: ['totalPages'],
    properties: {
      totalPages: { type: 'integer', label: 'pages', minimum: 1, maximum: 100000, prompt: 'How many pages?' },
      pagesPerDay: { type: 'integer', label: 'pages per day', minimum: 1, maximum: 10000, description: 'how many pages you read a day' },
      days: { type: 'integer', label: 'days available', minimum: 1, maximum: 3650, description: 'how many days you have' },
      startDate: { type: 'string', label: 'start date', description: 'the first reading day - today by default' }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      schedule: { type: 'array' }, lines: { type: 'array', items: { type: 'string' } },
      days: { type: 'integer' }, pagesPerDay: { type: 'integer' }, totalPages: { type: 'integer' },
      finishDate: { type: 'string' }, lastDayPages: { type: 'integer' }
    }
  },
  examples: [
    { text: 'reading schedule for 60 pages at 20 a day', input: { totalPages: 60, pagesPerDay: 20, startDate: '2026-09-01' }, output: { schedule: [{ day: 1, date: '2026-09-01', from: 1, to: 20, pages: 20 }, { day: 2, date: '2026-09-02', from: 21, to: 40, pages: 20 }, { day: 3, date: '2026-09-03', from: 41, to: 60, pages: 20 }], lines: ['2026-09-01: pages 1 to 20', '2026-09-02: pages 21 to 40', '2026-09-03: pages 41 to 60'], days: 3, pagesPerDay: 20, totalPages: 60, finishDate: '2026-09-03', lastDayPages: 20 } },
    { text: 'how much should I read a day to finish 100 pages in 4 days', input: { totalPages: 100, days: 4, startDate: '2026-09-01' }, output: { schedule: [{ day: 1, date: '2026-09-01', from: 1, to: 25, pages: 25 }, { day: 2, date: '2026-09-02', from: 26, to: 50, pages: 25 }, { day: 3, date: '2026-09-03', from: 51, to: 75, pages: 25 }, { day: 4, date: '2026-09-04', from: 76, to: 100, pages: 25 }], lines: ['2026-09-01: pages 1 to 25', '2026-09-02: pages 26 to 50', '2026-09-03: pages 51 to 75', '2026-09-04: pages 76 to 100'], days: 4, pagesPerDay: 25, totalPages: 100, finishDate: '2026-09-04', lastDayPages: 25 } },
    { text: 'plan 45 pages at 20 pages a day', input: { totalPages: 45, pagesPerDay: 20, startDate: '2026-09-01' }, output: { schedule: [{ day: 1, date: '2026-09-01', from: 1, to: 20, pages: 20 }, { day: 2, date: '2026-09-02', from: 21, to: 40, pages: 20 }, { day: 3, date: '2026-09-03', from: 41, to: 45, pages: 5 }], lines: ['2026-09-01: pages 1 to 20', '2026-09-02: pages 21 to 40', '2026-09-03: pages 41 to 45'], days: 3, pagesPerDay: 20, totalPages: 45, finishDate: '2026-09-03', lastDayPages: 5 } },
    { text: 'split 300 pages into 100 a day', input: { totalPages: 300, pagesPerDay: 100, startDate: '2026-09-01' }, output: { schedule: [{ day: 1, date: '2026-09-01', from: 1, to: 100, pages: 100 }, { day: 2, date: '2026-09-02', from: 101, to: 200, pages: 100 }, { day: 3, date: '2026-09-03', from: 201, to: 300, pages: 100 }], lines: ['2026-09-01: pages 1 to 100', '2026-09-02: pages 101 to 200', '2026-09-03: pages 201 to 300'], days: 3, pagesPerDay: 100, totalPages: 300, finishDate: '2026-09-03', lastDayPages: 100 } },
    { text: 'read 10 pages at 3 a day', input: { totalPages: 10, pagesPerDay: 3, startDate: '2026-09-01' }, output: { schedule: [{ day: 1, date: '2026-09-01', from: 1, to: 3, pages: 3 }, { day: 2, date: '2026-09-02', from: 4, to: 6, pages: 3 }, { day: 3, date: '2026-09-03', from: 7, to: 9, pages: 3 }, { day: 4, date: '2026-09-04', from: 10, to: 10, pages: 1 }], lines: ['2026-09-01: pages 1 to 3', '2026-09-02: pages 4 to 6', '2026-09-03: pages 7 to 9', '2026-09-04: pages 10 to 10'], days: 4, pagesPerDay: 3, totalPages: 10, finishDate: '2026-09-04', lastDayPages: 1 } }
  ],
  errorCases: [
    { input: { totalPages: 300 }, code: 'INVALID_INPUT' },
    { input: { totalPages: 300, pagesPerDay: 25, days: 10 }, code: 'INVALID_INPUT' },
    { input: { pagesPerDay: 25 }, code: 'MISSING_FIELD' }
  ],
  run (input, ctx) {
    const hasRate = input.pagesPerDay !== undefined;
    const hasDays = input.days !== undefined;
    if (hasRate === hasDays) {
      return fail('INVALID_INPUT', hasRate
        ? 'Give me either the pages per day or the number of days — with both, the two would have to agree and usually do not.'
        : 'I need one of the two: how many pages a day you read, or how many days you have.', 'pagesPerDay');
    }

    const parsed = parseDate(input.startDate ?? 'today', { ...ctx, now: input.now });
    if (!parsed.ok) return fail('INVALID_INPUT', `"${input.startDate}" is not a date I can read — ${parsed.reason}.`, 'startDate');

    /* Rounding UP on pages per day. Reading 35.7 pages is not a thing anyone
       does, and rounding down would leave the schedule short of the last page. */
    const pagesPerDay = hasRate ? input.pagesPerDay : Math.ceil(input.totalPages / input.days);
    const days = Math.ceil(input.totalPages / pagesPerDay);
    const start = dayNumber(parsed.ymd.y, parsed.ymd.m, parsed.ymd.d);

    const schedule = [];
    for (let i = 0; i < days; i++) {
      const from = i * pagesPerDay + 1;
      const to = Math.min((i + 1) * pagesPerDay, input.totalPages);
      const at = fromDayNumber(start + i);
      schedule.push({ day: i + 1, date: toISO(at), from, to, pages: to - from + 1 });
    }

    return ok({
      schedule,
      lines: schedule.map((s) => `${s.date}: pages ${s.from} to ${s.to}`),
      days, pagesPerDay, totalPages: input.totalPages,
      finishDate: schedule[schedule.length - 1].date,
      lastDayPages: schedule[schedule.length - 1].pages
    }, computed());
  }
};
