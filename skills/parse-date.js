import { ok, fail, computed } from '../src/contracts.js';
import { parseDate, toISO, weekdayOf } from '../src/lib/dates.js';

/* The §10 "compound skills" note names parseDate → daysBetween as the example
   of a pair worth promoting to one skill later. Kept separate for now, which
   means this one has to be genuinely useful alone: it is the skill that turns
   whatever a person typed into the ISO string every other date skill wants. */
export default {
  name: 'parseDate',
  description: 'Read a messy date — "14 nov", "3/4/2026", "next Tuesday" is a different skill — and return it as an ISO date.',
  category: 'dates',
  tier: 'core',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  title: 'Read a date',
  replyTemplate: 'That is {{date}} — {{weekday}}, {{date|date}}.{{note|prose}}',
  inputSchema: {
    type: 'object',
    required: ['text'],
    properties: { text: { type: 'string', label: 'date', minLength: 1, prompt: 'Which date should I read?' } }
  },
  outputSchema: {
    type: 'object',
    properties: {
      date: { type: 'string' }, weekday: { type: 'string' }, original: { type: 'string' },
      ambiguous: { type: 'boolean' }, note: { type: 'string' }
    }
  },
  examples: [
    { text: 'what is 14 nov as a date', ctx: { now: '2026-09-01T09:00:00Z', timezone: 'UTC', locale: 'en-GB' }, input: { text: '14 nov' },
      output: { date: '2026-11-14', weekday: 'Saturday', original: '14 nov', ambiguous: false, note: '' } },
    { text: 'parse "December 25 2026"', input: { text: 'December 25 2026' },
      output: { date: '2026-12-25', weekday: 'Friday', original: 'December 25 2026', ambiguous: false, note: '' } },
    { text: 'what date is 2026-07-12', input: { text: '2026-07-12' },
      output: { date: '2026-07-12', weekday: 'Sunday', original: '2026-07-12', ambiguous: false, note: '' } },
    { text: 'read 03/04/2026 as a date', ctx: { now: '2026-09-01T09:00:00Z', timezone: 'UTC', locale: 'en-GB' }, input: { text: '03/04/2026' },
      output: { date: '2026-04-03', weekday: 'Friday', original: '03/04/2026', ambiguous: true, note: ' Read day-first for your locale; month-first it would be 2026-03-04.' } },
    { text: 'what is today as an iso date', ctx: { now: '2026-09-01T09:00:00Z', timezone: 'UTC', locale: 'en-GB' }, input: { text: 'today' },
      output: { date: '2026-09-01', weekday: 'Tuesday', original: 'today', ambiguous: false, note: '' } }
  ],
  errorCases: [
    { input: { text: 'the twelfth of never' }, code: 'INVALID_INPUT' },
    { input: { text: '2026-02-30' }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' }
  ],
  run (input, ctx) {
    const d = parseDate(input.text, ctx);
    if (!d.ok) return fail('INVALID_INPUT', `I couldn't read "${input.text}" as a date (${d.reason}).`, 'text');
    return ok({
      date: toISO(d.ymd),
      weekday: weekdayOf(d.ymd),
      original: input.text,
      ambiguous: Boolean(d.ambiguous),
      /* An ambiguous slash date is answered AND flagged. Silently picking one
         reading is how "3/4" becomes the wrong month in someone's calendar. */
      note: d.ambiguous ? ` Read day-first for your locale; month-first it would be ${d.other}.` : ''
    }, computed());
  }
};
