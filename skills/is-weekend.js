import { ok, fail, computed } from '../src/contracts.js';
import { parseDate, toISO, weekdayOf } from '../src/lib/dates.js';

export default {
  name: 'isWeekend',
  description: 'Say whether a date is a weekend or a working day.',
  category: 'dates', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  title: 'Is it a weekend',
  replyTemplate: '{{date|date}} is a {{weekday|prose}} — {{verdict|prose}}.',
  inputSchema: {
    type: 'object', required: ['date'],
    properties: { date: { type: 'string', label: 'date', prompt: 'Which date?', description: 'a date' } }
  },
  outputSchema: {
    type: 'object',
    properties: { weekend: { type: 'boolean' }, weekday: { type: 'string' }, date: { type: 'string' }, verdict: { type: 'string' } }
  },
  examples: [
    { text: 'is 2026-11-14 a weekend', input: { date: '2026-11-14' }, output: { weekend: true, weekday: 'Saturday', date: '2026-11-14', verdict: 'the weekend' } },
    { text: 'is christmas 2026 on a weekend', input: { date: '2026-12-25' }, output: { weekend: false, weekday: 'Friday', date: '2026-12-25', verdict: 'a weekday' } },
    { text: 'does 2026-07-04 fall on a weekend', input: { date: '2026-07-04' }, output: { weekend: true, weekday: 'Saturday', date: '2026-07-04', verdict: 'the weekend' } },
    { text: 'is 2026-06-01 a working day', input: { date: '2026-06-01' }, output: { weekend: false, weekday: 'Monday', date: '2026-06-01', verdict: 'a weekday' } },
    { text: 'is 2026-03-15 a sunday', input: { date: '2026-03-15' }, output: { weekend: true, weekday: 'Sunday', date: '2026-03-15', verdict: 'the weekend' } }
  ],
  errorCases: [
    { input: { date: 'someday' }, code: 'INVALID_INPUT' },
    { input: { date: '2026-02-31' }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' }
  ],
  run (input, ctx) {
    const d = parseDate(input.date, ctx);
    if (!d.ok) return fail('INVALID_INPUT', `I couldn't read "${input.date}" as a date (${d.reason}).`, 'date');
    const weekday = weekdayOf(d.ymd);
    const weekend = weekday === 'Saturday' || weekday === 'Sunday';
    /* Saturday and Sunday only. Which days count as the weekend varies by
       country — Friday/Saturday across much of the Middle East — and this
       skill does not know where you are, so it says what it checked. */
    return ok({ weekend, weekday, date: toISO(d.ymd), verdict: weekend ? 'the weekend' : 'a weekday' }, computed());
  }
};
