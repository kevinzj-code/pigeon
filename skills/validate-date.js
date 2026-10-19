import { ok, computed } from '../src/contracts.js';
import { parseDate, toISO, weekdayOf, isValidYMD } from '../src/lib/dates.js';

export default {
  name: 'validateDate',
  description: 'Check whether a date actually exists on the calendar.',
  category: 'validation',
  tier: 'core',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{input}} — {{verdict|prose}}.',
  inputSchema: {
    type: 'object',
    required: ['date'],
    properties: { date: { type: 'string', label: 'date', minLength: 1, prompt: 'Which date should I check?' } }
  },
  outputSchema: {
    type: 'object',
    properties: {
      valid: { type: 'boolean' }, verdict: { type: 'string' }, input: { type: 'string' },
      iso: { type: 'string' }, weekday: { type: 'string' }, leapYear: { type: 'boolean' },
      ambiguous: { type: 'boolean' }, problem: { type: 'string' }
    }
  },
  examples: [
    { text: 'is 2026-02-29 a real date', input: { date: '2026-02-29' },
      output: { valid: false, verdict: 'not a real date — 2026 is not a leap year, so February has 28 days', input: '2026-02-29', iso: '', weekday: '', leapYear: false, ambiguous: false, problem: 'February 2026 has only 28 days' } },
    { text: 'check that 2024-02-29 exists', input: { date: '2024-02-29' },
      output: { valid: true, verdict: 'a real date — Thursday', input: '2024-02-29', iso: '2024-02-29', weekday: 'Thursday', leapYear: true, ambiguous: false, problem: '' } },
    { text: 'is 31 april a valid date', input: { date: '2026-04-31' },
      output: { valid: false, verdict: 'not a real date — April has 30 days', input: '2026-04-31', iso: '', weekday: '', leapYear: false, ambiguous: false, problem: 'April 2026 has only 30 days' } },
    { text: 'validate 2026-12-25', input: { date: '2026-12-25' },
      output: { valid: true, verdict: 'a real date — Friday', input: '2026-12-25', iso: '2026-12-25', weekday: 'Friday', leapYear: false, ambiguous: false, problem: '' } },
    { text: 'is 03/04/2026 unambiguous', ctx: { now: '2026-09-01T09:00:00Z', timezone: 'UTC', locale: 'en-GB' }, input: { date: '03/04/2026' },
      output: { valid: true, verdict: 'a real date — Friday, but the day and month could be either way round', input: '03/04/2026', iso: '2026-04-03', weekday: 'Friday', leapYear: false, ambiguous: true, problem: '' } }
  ],
  errorCases: [
    { input: {}, code: 'MISSING_FIELD' },
    { input: { date: '' }, code: 'MISSING_FIELD' },
    { input: { date: [2026] }, code: 'INVALID_INPUT' }
  ],
  run (input, ctx) {
    const raw = String(input.date).trim();
    const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(raw);

    /* An out-of-range ISO date is checked directly rather than through
       parseDate, so the reply can say WHICH month has how many days instead of
       a generic "unrecognised format". */
    if (iso) {
      const [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
      if (!isValidYMD(y, m, d)) {
        const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
        const dim = m >= 1 && m <= 12 ? new Date(Date.UTC(y, m, 0)).getUTCDate() : 0;
        const monthName = m >= 1 && m <= 12
          ? new Date(Date.UTC(2000, m - 1, 1)).toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' })
          : null;
        const problem = monthName
          ? `${monthName} ${y} has only ${dim} days`
          : `there is no month ${m}`;
        const verdict = monthName && m === 2 && !leap
          ? `not a real date — ${y} is not a leap year, so February has 28 days`
          : `not a real date — ${monthName ? `${monthName} has ${dim} days` : problem}`;
        return ok({ valid: false, verdict, input: raw, iso: '', weekday: '', leapYear: leap, ambiguous: false, problem }, computed());
      }
    }

    const parsed = parseDate(raw, ctx);
    if (!parsed.ok) {
      return ok({
        valid: false, verdict: `not a real date — ${parsed.reason}`, input: raw,
        iso: '', weekday: '', leapYear: false, ambiguous: false, problem: parsed.reason
      }, computed());
    }
    const { y } = parsed.ymd;
    const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
    const weekday = weekdayOf(parsed.ymd);
    return ok({
      valid: true,
      verdict: `a real date — ${weekday}${parsed.ambiguous ? ', but the day and month could be either way round' : ''}`,
      input: raw, iso: toISO(parsed.ymd), weekday, leapYear: leap,
      ambiguous: Boolean(parsed.ambiguous), problem: ''
    }, computed());
  }
};
