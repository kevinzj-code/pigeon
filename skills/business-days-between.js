import { ok, fail, computed } from '../src/contracts.js';
import { parseDate, dayNumber, fromDayNumber, toISO, weekdayOf } from '../src/lib/dates.js';

/* Working days between two dates. NO holiday table: public holidays are
   country-, region- and year-specific, and a bundled list that silently
   assumed one country would be exactly the kind of confident-but-wrong answer
   this whole design exists to prevent. The output says so in `excludes`, and
   the reply template repeats it, so nobody reads this as "business days in my
   country". Holidays are a Standard-tier skill with a real, dated table. */
export default {
  name: 'businessDaysBetween',
  description: 'Count how many working days (Mon–Fri) fall between two dates you give. Does not know public holidays.',
  category: 'dates',
  tier: 'standard',
  unbuilt: false,
  needsNetwork: false,
  dataAsOf: null,
  labels: ['estimate'],
  title: 'Working days between',
  replyTemplate: '{{businessDays|comma}} working {{businessDays|plural:day:days}} between {{from|date}} and {{to|date}} — weekends removed, public holidays not counted.',
  inputSchema: {
    type: 'object',
    required: ['from', 'to'],
    properties: {
      from: { type: 'string', label: 'start date', prompt: 'Which date should I count from?', description: 'a date' },
      to: { type: 'string', label: 'end date', prompt: 'Which date should I count to?', description: 'a date' },
      includeStart: { type: 'boolean', label: 'count start day', default: false, description: 'count the start day itself' }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      businessDays: { type: 'integer' }, calendarDays: { type: 'integer' },
      weekendDays: { type: 'integer' }, from: { type: 'string' }, to: { type: 'string' },
      excludes: { type: 'string' }
    }
  },
  examples: [
    { text: 'working days between 1 September and 30 September 2026', input: { from: '2026-09-01', to: '2026-09-30' },
      output: { businessDays: 21, calendarDays: 29, weekendDays: 8, from: '2026-09-01', to: '2026-09-30', excludes: 'weekends only — no public holidays' } },
    { text: 'how many business days from monday 2026-06-01 to friday 2026-06-05', input: { from: '2026-06-01', to: '2026-06-05' },
      output: { businessDays: 4, calendarDays: 4, weekendDays: 0, from: '2026-06-01', to: '2026-06-05', excludes: 'weekends only — no public holidays' } },
    { text: 'business days in a full year 2026', input: { from: '2026-01-01', to: '2026-12-31' },
      output: { businessDays: 260, calendarDays: 364, weekendDays: 104, from: '2026-01-01', to: '2026-12-31', excludes: 'weekends only — no public holidays' } },
    { text: 'working days from 2026-09-04 to 2026-09-07 over a weekend', input: { from: '2026-09-04', to: '2026-09-07' },
      output: { businessDays: 1, calendarDays: 3, weekendDays: 2, from: '2026-09-04', to: '2026-09-07', excludes: 'weekends only — no public holidays' } },
    { text: 'ten working days from 2026-03-02 counting the first day', input: { from: '2026-03-02', to: '2026-03-13', includeStart: true },
      output: { businessDays: 10, calendarDays: 11, weekendDays: 2, from: '2026-03-02', to: '2026-03-13', excludes: 'weekends only — no public holidays' } }
  ],
  errorCases: [
    { input: { from: 'whenever', to: '2026-09-30' }, code: 'INVALID_INPUT' },
    { input: { from: '2026-09-31', to: '2026-10-30' }, code: 'INVALID_INPUT' },
    { input: { from: '2026-09-01' }, code: 'MISSING_FIELD' }
  ],
  run (input, ctx) {
    const a = parseDate(input.from, ctx);
    if (!a.ok) return fail('INVALID_INPUT', `I couldn't read "${input.from}" as a date (${a.reason}).`, 'from');
    const b = parseDate(input.to, ctx);
    if (!b.ok) return fail('INVALID_INPUT', `I couldn't read "${input.to}" as a date (${b.reason}).`, 'to');

    let da = dayNumber(a.ymd.y, a.ymd.m, a.ymd.d);
    let db = dayNumber(b.ymd.y, b.ymd.m, b.ymd.d);
    if (da > db) [da, db] = [db, da];

    /* Half a million days would be a plausible typo and an unbounded loop; the
       executor's 2s budget would catch it, but failing with a reason beats
       failing with a timeout. */
    if (db - da > 200000) return fail('INVALID_INPUT', 'That range is too large to count day by day.', 'to');

    const start = input.includeStart ? da : da + 1;
    let business = 0, weekend = 0;
    for (let n = start; n <= db; n++) {
      const dow = ((n % 7) + 11) % 7;
      if (dow === 0 || dow === 6) weekend++; else business++;
    }
    void fromDayNumber; void weekdayOf;

    return ok({
      businessDays: business,
      calendarDays: db - da,
      weekendDays: weekend,
      from: toISO(a.ymd),
      to: toISO(b.ymd),
      excludes: 'weekends only — no public holidays'
    }, computed());
  }
};
