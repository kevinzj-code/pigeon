import { ok, fail, computed } from '../src/contracts.js';
import { parseDate, dayNumber, toISO, todayYMD, addMonths } from '../src/lib/dates.js';

export default {
  name: 'ageFromDate',
  description: "Count how old somebody is from their birthday.",
  category: 'dates',
  tier: 'core',
  unbuilt: false,
  needsNetwork: false,
  dataAsOf: null,
  labels: [],
  replyTemplate: '{{years}} {{years|plural:year:years}}, {{months}} {{months|plural:month:months}} and {{days}} {{days|plural:day:days}} — {{totalDays|comma}} days in total.',
  inputSchema: {
    type: 'object',
    required: ['birthDate'],
    properties: {
      birthDate: { type: 'string', label: 'date of birth', prompt: 'What is the date of birth?', description: 'a date' },
      onDate: { type: 'string', label: 'age on date', description: 'a date — defaults to today' }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      years: { type: 'integer' }, months: { type: 'integer' }, days: { type: 'integer' },
      totalDays: { type: 'integer' }, birthDate: { type: 'string' }, onDate: { type: 'string' },
      nextBirthday: { type: 'string' }, daysToNextBirthday: { type: 'integer' }
    }
  },
  examples: [
    { text: 'how old is someone born 1990-05-20', ctx: { now: '2026-09-01T09:00:00Z', timezone: 'UTC', locale: 'en-GB' },
      input: { birthDate: '1990-05-20' },
      output: { years: 36, months: 3, days: 12, totalDays: 13253, birthDate: '1990-05-20', onDate: '2026-09-01', nextBirthday: '2027-05-20', daysToNextBirthday: 261 } },
    { text: 'age of someone born 2000-01-01 on 2026-01-01', input: { birthDate: '2000-01-01', onDate: '2026-01-01' },
      output: { years: 26, months: 0, days: 0, totalDays: 9497, birthDate: '2000-01-01', onDate: '2026-01-01', nextBirthday: '2027-01-01', daysToNextBirthday: 365 } },
    { text: 'how old will a baby born 2026-06-15 be on 2026-12-25', input: { birthDate: '2026-06-15', onDate: '2026-12-25' },
      output: { years: 0, months: 6, days: 10, totalDays: 193, birthDate: '2026-06-15', onDate: '2026-12-25', nextBirthday: '2027-06-15', daysToNextBirthday: 172 } },
    { text: 'age on a leap-day birthday, born 2004-02-29 on 2026-03-01', input: { birthDate: '2004-02-29', onDate: '2026-03-01' },
      output: { years: 22, months: 0, days: 1, totalDays: 8036, birthDate: '2004-02-29', onDate: '2026-03-01', nextBirthday: '2027-02-28', daysToNextBirthday: 364 } },
    { text: 'someone born yesterday', ctx: { now: '2026-09-01T09:00:00Z', timezone: 'UTC', locale: 'en-GB' },
      input: { birthDate: '2026-08-31' },
      output: { years: 0, months: 0, days: 1, totalDays: 1, birthDate: '2026-08-31', onDate: '2026-09-01', nextBirthday: '2027-08-31', daysToNextBirthday: 364 } }
  ],
  errorCases: [
    { input: { birthDate: 'ages ago' }, code: 'INVALID_INPUT' },
    { input: { birthDate: '2027-01-01', onDate: '2026-01-01' }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' }
  ],
  run (input, ctx) {
    const b = parseDate(input.birthDate, ctx);
    if (!b.ok) return fail('INVALID_INPUT', `I couldn't read "${input.birthDate}" as a date (${b.reason}).`, 'birthDate');
    const on = input.onDate ? parseDate(input.onDate, ctx) : { ok: true, ymd: todayYMD(ctx) };
    if (!on.ok) return fail('INVALID_INPUT', `I couldn't read "${input.onDate}" as a date (${on.reason}).`, 'onDate');

    const db = dayNumber(b.ymd.y, b.ymd.m, b.ymd.d);
    const dOn = dayNumber(on.ymd.y, on.ymd.m, on.ymd.d);
    if (dOn < db) return fail('INVALID_INPUT', 'That birth date is after the date to measure at, so there is no age to give.', 'birthDate');

    /* Walk the calendar rather than dividing by 365.25, and walk it with the
       SAME clamped month arithmetic that decides the birthday below — otherwise
       a 29 February birth date is measured against one convention and
       anniversaried against another, and the two disagree by a day in exactly
       the case people notice. Count whole months first, then the remainder. */
    let totalMonths = (on.ymd.y - b.ymd.y) * 12 + (on.ymd.m - b.ymd.m);
    const dn = (x) => dayNumber(x.y, x.m, x.d);
    if (totalMonths > 0 && dn(addMonths(b.ymd, totalMonths)) > dOn) totalMonths -= 1;
    const anchor = addMonths(b.ymd, totalMonths);
    const years = Math.floor(totalMonths / 12);
    const months = totalMonths % 12;
    const days = dOn - dn(anchor);

    /* A 29 February birthday in a common year is marked on the 28th here.
       Jurisdictions genuinely differ; this is the reading that never invents a
       date that does not exist. */
    const clampToMonth = (ymd) => ({ ...ymd, d: Math.min(ymd.d, new Date(Date.UTC(ymd.y, ymd.m, 0)).getUTCDate()) });
    let nb = clampToMonth({ y: on.ymd.y, m: b.ymd.m, d: b.ymd.d });
    if (dn(nb) <= dOn) nb = clampToMonth({ y: on.ymd.y + 1, m: b.ymd.m, d: b.ymd.d });

    return ok({
      years, months, days,
      totalDays: dOn - db,
      birthDate: toISO(b.ymd),
      onDate: toISO(on.ymd),
      nextBirthday: toISO(nb),
      daysToNextBirthday: dn(nb) - dOn
    }, computed());
  }
};
