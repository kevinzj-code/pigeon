import { ok, fail, computed } from '../src/contracts.js';
import { parseDate, toISO, addDays, addMonths, weekdayOf, dayNumber } from '../src/lib/dates.js';

const UNITS = ['day', 'week', 'month', 'year'];

/* "Every second Tuesday from the 3rd" — turned into the actual dates.
 *
 * Two decisions worth stating.
 *
 * MONTHLY DATES THAT DO NOT EXIST ARE SKIPPED, not moved. The 31st monthly from
 * January gives the 31st of March, May, July… and simply has no February entry.
 * The alternative — quietly sliding to the 28th — invents a date the user never
 * asked for, and a rota that silently gains a meeting is worse than one with an
 * honest gap. `skipped` reports how many were dropped so the gap is visible
 * rather than mysterious.
 *
 * IT STOPS. Either `count` or `until` must be given, and the count is capped.
 * A recurrence with no end is not a list, and an app that tried to render one
 * would hang rather than answer.
 */
export default {
  name: 'expandRecurrence',
  description: 'List the dates a repeating schedule falls on — the first Thursday monthly, every fortnight, every 90 days.',
  category: 'dates',
  tier: 'extended',
  unbuilt: false,
  needsNetwork: false,
  dataAsOf: null,
  labels: [],
  title: 'Repeating dates',
  replyTemplate: '{{count}} dates, every {{everyText|prose}} from {{start}}: {{shown}}{{more|prose}}.',
  inputSchema: {
    type: 'object',
    required: ['start'],
    properties: {
      start: { type: 'string', label: 'start date', minLength: 4, prompt: 'What date does it start on?' },
      every: { type: 'string', label: 'repeat unit', enum: UNITS, default: 'week' },
      interval: { type: 'integer', label: 'repeat interval', minimum: 1, maximum: 365, default: 1 },
      count: { type: 'integer', label: 'how many dates', minimum: 1, maximum: 60, description: 'defaults to 10 without an end date' },
      until: { type: 'string', label: 'end date' }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      dates: { type: 'array', items: { type: 'string' } },
      shown: { type: 'array', items: { type: 'string' } },
      more: { type: 'string' },
      count: { type: 'integer' },
      start: { type: 'string' },
      weekday: { type: 'string' },
      everyText: { type: 'string' },
      skipped: { type: 'integer' }
    }
  },
  examples: [
    { text: "every fortnight from 2026-09-07, eight times", input: {"start":"2026-09-07","every":"week","interval":2,"count":8},
      output: {"dates":["2026-09-07","2026-09-21","2026-10-05","2026-10-19","2026-11-02","2026-11-16","2026-11-30","2026-12-14"],"shown":["2026-09-07","2026-09-21","2026-10-05","2026-10-19","2026-11-02","2026-11-16","2026-11-30","2026-12-14"],"more":"","count":8,"start":"2026-09-07","weekday":"Monday","everyText":"2 weeks","skipped":0} },
    { text: "the 1st of every month for six months from 2026-10-01", input: {"start":"2026-10-01","every":"month","count":6},
      output: {"dates":["2026-10-01","2026-11-01","2026-12-01","2027-01-01","2027-02-01","2027-03-01"],"shown":["2026-10-01","2026-11-01","2026-12-01","2027-01-01","2027-02-01","2027-03-01"],"more":"","count":6,"start":"2026-10-01","weekday":"Thursday","everyText":"month","skipped":0} },
    { text: "every 90 days from 2026-01-15, five times", input: {"start":"2026-01-15","every":"day","interval":90,"count":5},
      output: {"dates":["2026-01-15","2026-04-15","2026-07-14","2026-10-12","2027-01-10"],"shown":["2026-01-15","2026-04-15","2026-07-14","2026-10-12","2027-01-10"],"more":"","count":5,"start":"2026-01-15","weekday":"Thursday","everyText":"90 days","skipped":0} },
    { text: "weekly standups from 2026-09-07 until 2026-10-12", input: {"start":"2026-09-07","every":"week","until":"2026-10-12"},
      output: {"dates":["2026-09-07","2026-09-14","2026-09-21","2026-09-28","2026-10-05","2026-10-12"],"shown":["2026-09-07","2026-09-14","2026-09-21","2026-09-28","2026-10-05","2026-10-12"],"more":"","count":6,"start":"2026-09-07","weekday":"Monday","everyText":"week","skipped":0} },
    { text: "the 31st monthly from 2026-01-31 for six", input: {"start":"2026-01-31","every":"month","count":6},
      output: {"dates":["2026-01-31","2026-03-31","2026-05-31","2026-07-31","2026-08-31","2026-10-31"],"shown":["2026-01-31","2026-03-31","2026-05-31","2026-07-31","2026-08-31","2026-10-31"],"more":"","count":6,"start":"2026-01-31","weekday":"Saturday","everyText":"month","skipped":4} },
    { text: "my birthday every year from 2026-03-09, four times", input: {"start":"2026-03-09","every":"year","count":4},
      output: {"dates":["2026-03-09","2027-03-09","2028-03-09","2029-03-09"],"shown":["2026-03-09","2027-03-09","2028-03-09","2029-03-09"],"more":"","count":4,"start":"2026-03-09","weekday":"Monday","everyText":"year","skipped":0} }
  ],
  errorCases: [
    { input: {}, code: 'MISSING_FIELD' },
    { input: { start: 'not a date' }, code: 'INVALID_INPUT' },
    { input: { start: '2026-09-07', until: '2026-08-01' }, code: 'INVALID_INPUT' }
  ],
  run (input, ctx) {
    const parsedStart = parseDate(input.start, ctx);
    if (!parsedStart.ok) return fail('INVALID_INPUT', `"${input.start}" isn't a date I can read.`, 'start');
    const start = parsedStart.ymd;

    const every = input.every ?? 'week';
    const interval = input.interval ?? 1;
    /* No schema default: a count someone gave has to be told apart from none,
       because with an end date as well it stops at whichever comes first. */
    const wantCount = input.count ?? 10;

    let until = null;
    if (input.until) {
      const parsedUntil = parseDate(input.until, ctx);
      if (!parsedUntil.ok) return fail('INVALID_INPUT', `"${input.until}" isn't a date I can read.`, 'until');
      until = parsedUntil.ymd;
      if (dayNumber(until.y, until.m, until.d) < dayNumber(start.y, start.m, start.d)) {
        return fail('INVALID_INPUT', 'The end date is before the start date, so the schedule never runs.', 'until');
      }
    }

    const dates = [];
    let skipped = 0;
    /* Capped even when a `count` was given, because `until` with a one-day
       interval could otherwise ask for years of dates. */
    const limit = until ? Math.min(366, input.count ?? 366) : wantCount;

    for (let i = 0; dates.length < limit && i < 4000; i++) {
      let d;
      if (every === 'day') d = addDays(start, i * interval);
      else if (every === 'week') d = addDays(start, i * interval * 7);
      else if (every === 'month') d = addMonths(start, i * interval);
      else d = addMonths(start, i * interval * 12);

      /* addMonths clamps into the month, so the 31st becomes the 30th or the
         28th. That is a different date from the one asked for, so it is dropped
         rather than reported as though it were the answer. */
      if ((every === 'month' || every === 'year') && d.d !== start.d) { skipped++; continue; }

      if (until && dayNumber(d.y, d.m, d.d) > dayNumber(until.y, until.m, until.d)) break;
      dates.push(toISO(d));
      if (!until && dates.length >= wantCount) break;
    }

    if (!dates.length) return fail('INVALID_INPUT', 'That schedule produces no dates at all.', 'start');

    const shown = dates.slice(0, 8);
    const unitText = interval === 1 ? every : `${interval} ${every}s`;
    return ok({
      dates,
      shown,
      more: dates.length > shown.length ? `, and ${dates.length - shown.length} more` : '',
      count: dates.length,
      start: toISO(start),
      weekday: weekdayOf(start),
      everyText: unitText,
      skipped
    }, computed());
  }
};
