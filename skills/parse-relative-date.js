import { ok, fail, computed } from '../src/contracts.js';
import { dayNumber, fromDayNumber, toISO, weekdayOf, todayYMD, addMonths, addDays, WEEKDAYS } from '../src/lib/dates.js';

/* Separate from parseDate because the two answer different questions and,
   more to the point, this one is only meaningful relative to `now` — which
   §2.5 says comes from the device and never from the model. Every branch below
   reads ctx; none of them can be answered without it. */
const UNITS = { day: 1, week: 7, fortnight: 14, month: 'M', year: 'Y' };

export default {
  name: 'parseRelativeDate',
  description: 'Turn a relative date like "next Tuesday", "in 3 weeks" or "a month ago" into a real date.',
  category: 'dates',
  tier: 'core',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{phrase|prose}} is {{date|date}} — a {{weekday}}, {{days}} {{days|plural:day:days}} {{tense|prose}}.',
  inputSchema: {
    type: 'object',
    required: ['phrase'],
    properties: { phrase: { type: 'string', label: 'relative date', minLength: 2, prompt: 'Which relative date? (like "next Tuesday" or "in 3 weeks")' } }
  },
  outputSchema: {
    type: 'object',
    properties: {
      date: { type: 'string' }, weekday: { type: 'string' }, phrase: { type: 'string' },
      days: { type: 'integer' }, tense: { type: 'string' }, from: { type: 'string' }
    }
  },
  examples: [
    { text: 'what date is next tuesday', ctx: { now: '2026-09-01T09:00:00Z', timezone: 'UTC', locale: 'en-GB' }, input: { phrase: 'next tuesday' },
      output: { date: '2026-09-08', weekday: 'Tuesday', phrase: 'next tuesday', days: 7, tense: 'from now', from: '2026-09-01' } },
    { text: 'what is the date in 3 weeks', ctx: { now: '2026-09-01T09:00:00Z', timezone: 'UTC', locale: 'en-GB' }, input: { phrase: 'in 3 weeks' },
      output: { date: '2026-09-22', weekday: 'Tuesday', phrase: 'in 3 weeks', days: 21, tense: 'from now', from: '2026-09-01' } },
    { text: 'what date was a month ago', ctx: { now: '2026-09-01T09:00:00Z', timezone: 'UTC', locale: 'en-GB' }, input: { phrase: 'a month ago' },
      output: { date: '2026-08-01', weekday: 'Saturday', phrase: 'a month ago', days: 31, tense: 'ago', from: '2026-09-01' } },
    { text: 'what is the day after tomorrow', ctx: { now: '2026-09-01T09:00:00Z', timezone: 'UTC', locale: 'en-GB' }, input: { phrase: 'day after tomorrow' },
      output: { date: '2026-09-03', weekday: 'Thursday', phrase: 'day after tomorrow', days: 2, tense: 'from now', from: '2026-09-01' } },
    { text: 'what date is in 10 days', ctx: { now: '2026-09-01T09:00:00Z', timezone: 'UTC', locale: 'en-GB' }, input: { phrase: 'in 10 days' },
      output: { date: '2026-09-11', weekday: 'Friday', phrase: 'in 10 days', days: 10, tense: 'from now', from: '2026-09-01' } }
  ],
  errorCases: [
    { input: { phrase: 'at some point' }, code: 'INVALID_INPUT' },
    { input: { phrase: 'when the stars align' }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' }
  ],
  run (input, ctx) {
    const today = todayYMD(ctx);
    const base = dayNumber(today.y, today.m, today.d);
    const p = String(input.phrase).trim().toLowerCase().replace(/\s+/g, ' ');
    let ymd = null;

    const fixed = {
      today: 0, tonight: 0, tomorrow: 1, yesterday: -1,
      'day after tomorrow': 2, 'the day after tomorrow': 2,
      'day before yesterday': -2, 'the day before yesterday': -2
    };
    if (p in fixed) ymd = fromDayNumber(base + fixed[p]);

    /* "next friday" / "last monday" — the same rule nextWeekday uses: today is
       never the answer for "next". */
    if (!ymd) {
      const wd = /^(next|last|this)\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)$/.exec(p);
      if (wd) {
        const target = WEEKDAYS.findIndex(d => d.toLowerCase() === wd[2]);
        const dow = ((base % 7) + 11) % 7;
        const forward = ((target - dow + 7) % 7);
        if (wd[1] === 'this') ymd = fromDayNumber(base + forward);
        else if (wd[1] === 'next') ymd = fromDayNumber(base + (forward || 7));
        else ymd = fromDayNumber(base - (((dow - target + 7) % 7) || 7));
      }
    }

    /* "in 3 weeks" / "3 weeks ago" / "a month ago" — "a"/"an" reads as 1. */
    if (!ymd) {
      const rel = /^(?:in\s+)?(a|an|\d+)\s+(day|week|fortnight|month|year)s?(\s+ago|\s+from now|\s+time)?$/.exec(p);
      if (rel) {
        const n = /^(a|an)$/.test(rel[1]) ? 1 : Number(rel[1]);
        const past = (rel[3] || '').trim() === 'ago';
        const signed = past ? -n : n;
        const unit = UNITS[rel[2]];
        if (unit === 'M') ymd = addMonths(today, signed);
        else if (unit === 'Y') ymd = addMonths(today, signed * 12);
        else ymd = addDays(today, signed * unit);
      }
    }

    if (!ymd) {
      return fail('INVALID_INPUT', `I couldn't read "${input.phrase}" as a relative date. Try something like "next Tuesday" or "in 3 weeks".`, 'phrase');
    }

    const diff = dayNumber(ymd.y, ymd.m, ymd.d) - base;
    return ok({
      date: toISO(ymd), weekday: weekdayOf(ymd), phrase: input.phrase,
      days: Math.abs(diff),
      tense: diff === 0 ? 'away — that is today' : diff > 0 ? 'from now' : 'ago',
      from: toISO(today)
    }, computed());
  }
};
