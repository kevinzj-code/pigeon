import { ok, fail, computed } from '../src/contracts.js';
import { parseDate, dayNumber, todayYMD, toISO } from '../src/lib/dates.js';

/* The thresholds below are the conventional ones every "3 days ago" label
   uses. They are rounding rules, and rounding rules lose information — so the
   exact day count travels alongside the phrase in `days`, and the renderer can
   show it. */
export default {
  name: 'timeAgo',
  description: 'Say how long ago a date was, or how far off it is, in plain words like "3 days ago".',
  category: 'dates',
  tier: 'core',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{date|date}} was {{phrase|prose}}.',
  inputSchema: {
    type: 'object',
    required: ['date'],
    properties: { date: { type: 'string', label: 'date', prompt: 'Which date?', description: 'a date' } }
  },
  outputSchema: {
    type: 'object',
    properties: {
      phrase: { type: 'string' }, days: { type: 'integer' }, date: { type: 'string' },
      past: { type: 'boolean' }, today: { type: 'string' }
    }
  },
  examples: [
    { text: 'how long ago was 2026-08-29', ctx: { now: '2026-09-01T09:00:00Z', timezone: 'UTC', locale: 'en-GB' }, input: { date: '2026-08-29' },
      output: { phrase: '3 days ago', days: 3, date: '2026-08-29', past: true, today: '2026-09-01' } },
    { text: 'how far off is christmas', ctx: { now: '2026-09-01T09:00:00Z', timezone: 'UTC', locale: 'en-GB' }, input: { date: '2026-12-25' },
      output: { phrase: 'in 4 months', days: 115, date: '2026-12-25', past: false, today: '2026-09-01' } },
    { text: 'when was 2025-09-01 in plain words', ctx: { now: '2026-09-01T09:00:00Z', timezone: 'UTC', locale: 'en-GB' }, input: { date: '2025-09-01' },
      output: { phrase: 'a year ago', days: 365, date: '2025-09-01', past: true, today: '2026-09-01' } },
    { text: 'how long ago was yesterday', ctx: { now: '2026-09-01T09:00:00Z', timezone: 'UTC', locale: 'en-GB' }, input: { date: 'yesterday' },
      output: { phrase: 'yesterday', days: 1, date: '2026-08-31', past: true, today: '2026-09-01' } },
    { text: 'how long until 2026-09-15', ctx: { now: '2026-09-01T09:00:00Z', timezone: 'UTC', locale: 'en-GB' }, input: { date: '2026-09-15' },
      output: { phrase: 'in 2 weeks', days: 14, date: '2026-09-15', past: false, today: '2026-09-01' } }
  ],
  errorCases: [
    { input: { date: 'ages back' }, code: 'INVALID_INPUT' },
    { input: { date: '2026-02-31' }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' }
  ],
  run (input, ctx) {
    const d = parseDate(input.date, ctx);
    if (!d.ok) return fail('INVALID_INPUT', `I couldn't read "${input.date}" as a date (${d.reason}).`, 'date');

    const today = todayYMD(ctx);
    const diff = dayNumber(d.ymd.y, d.ymd.m, d.ymd.d) - dayNumber(today.y, today.m, today.d);
    const n = Math.abs(diff);
    const past = diff < 0;

    let phrase;
    if (diff === 0) phrase = 'today';
    else if (n === 1) phrase = past ? 'yesterday' : 'tomorrow';
    else {
      const [value, unit] =
        n < 7 ? [n, 'day']
          : n < 31 ? [Math.round(n / 7), 'week']
            : n < 365 ? [Math.round(n / 30.44), 'month']
              : [Math.round(n / 365.25), 'year'];
      const amount = value === 1 ? `a ${unit}` : `${value} ${unit}s`;
      phrase = past ? `${amount} ago` : `in ${amount}`;
    }

    return ok({ phrase, days: n, date: toISO(d.ymd), past, today: toISO(today) }, computed());
  }
};
