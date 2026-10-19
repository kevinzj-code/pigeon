import { ok, fail, computed } from '../src/contracts.js';
import { parseDate, toISO, todayYMD } from '../src/lib/dates.js';

/* The one skill here that is genuinely about an instant rather than a calendar
   date, so it works the other way round from lib/dates.js: it resolves a wall
   clock in one zone to a UTC instant, then re-renders that instant in another.
   The IANA database ships inside every JS engine, so DST is handled by the
   platform and not by a table in this repo that would go stale. */

/** Wall clock + zone → UTC instant. Intl only formats one way, so the offset
 *  is recovered by formatting a guess and measuring how far off it landed. */
function zonedToUtc (ymd, h, mi, tz) {
  const guess = Date.UTC(ymd.y, ymd.m - 1, ymd.d, h, mi, 0);
  const seen = readZone(new Date(guess), tz);
  if (!seen) return null;
  const offset = Date.UTC(seen.y, seen.m - 1, seen.d, seen.h, seen.mi, 0) - guess;
  /* One correction is enough everywhere except the ambiguous hour of a
     DST fall-back, where both answers are legitimate; we take the first. */
  return new Date(guess - offset);
}

function readZone (date, tz) {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', weekday: 'short'
    }).formatToParts(date);
    const g = (t) => parts.find(p => p.type === t)?.value;
    return {
      y: Number(g('year')), m: Number(g('month')), d: Number(g('day')),
      h: Number(g('hour')) % 24, mi: Number(g('minute')), weekday: g('weekday')
    };
  } catch { return null; }
}

function zoneAbbr (date, tz) {
  try {
    const p = new Intl.DateTimeFormat('en-GB', { timeZone: tz, timeZoneName: 'short' }).formatToParts(date);
    return p.find(x => x.type === 'timeZoneName')?.value || tz;
  } catch { return tz; }
}

const pad = (n) => String(n).padStart(2, '0');

export default {
  name: 'convertTimezone',
  description: 'Convert a time from one time zone to another, using IANA zone names.',
  category: 'dates',
  tier: 'standard',
  unbuilt: false,
  needsNetwork: false,
  dataAsOf: null,
  labels: [],
  title: 'Convert time zone',
  replyTemplate: '{{time}} in {{from}} is {{result}} in {{to}}{{dayNote|prose}}.',
  inputSchema: {
    type: 'object',
    required: ['time', 'from', 'to'],
    properties: {
      time: { type: 'string', label: 'time', prompt: 'What time should I convert? (like 14:30)', pattern: '^\\d{1,2}([:.]\\d{2})?\\s*(am|pm|AM|PM)?$', description: 'a time like 14:30 or 2:30pm' },
      from: { type: 'string', label: 'from time zone', prompt: 'Which time zone is that in?', description: 'an IANA zone like Europe/London' },
      to: { type: 'string', label: 'to time zone', prompt: 'Which time zone should I convert to?', description: 'an IANA zone like America/New_York' },
      date: { type: 'string', label: 'date', description: 'a date — defaults to today, and matters because of daylight saving' }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      result: { type: 'string' }, time: { type: 'string' }, from: { type: 'string' },
      to: { type: 'string' }, date: { type: 'string' }, resultDate: { type: 'string' },
      dayNote: { type: 'string' }, fromAbbr: { type: 'string' }, toAbbr: { type: 'string' },
      offsetHours: { type: 'number' }
    }
  },
  examples: [
    { text: '3pm London in New York on 2026-09-01', input: { time: '15:00', from: 'Europe/London', to: 'America/New_York', date: '2026-09-01' },
      output: { result: '10:00', time: '15:00', from: 'Europe/London', to: 'America/New_York', date: '2026-09-01', resultDate: '2026-09-01', dayNote: '', fromAbbr: 'BST', toAbbr: 'GMT-4', offsetHours: -5 } },
    { text: 'what is 9am Tokyo in London on 2026-01-15', input: { time: '09:00', from: 'Asia/Tokyo', to: 'Europe/London', date: '2026-01-15' },
      output: { result: '00:00', time: '09:00', from: 'Asia/Tokyo', to: 'Europe/London', date: '2026-01-15', resultDate: '2026-01-15', dayNote: '', fromAbbr: 'GMT+9', toAbbr: 'GMT', offsetHours: -9 } },
    { text: '11pm Sydney in Los Angeles 2026-06-10', input: { time: '23:00', from: 'Australia/Sydney', to: 'America/Los_Angeles', date: '2026-06-10' },
      output: { result: '06:00', time: '23:00', from: 'Australia/Sydney', to: 'America/Los_Angeles', date: '2026-06-10', resultDate: '2026-06-10', dayNote: '', fromAbbr: 'GMT+10', toAbbr: 'GMT-7', offsetHours: -17 } },
    { text: '2:30pm in Berlin is what in Mumbai on 2026-03-20', input: { time: '2:30pm', from: 'Europe/Berlin', to: 'Asia/Kolkata', date: '2026-03-20' },
      output: { result: '19:00', time: '14:30', from: 'Europe/Berlin', to: 'Asia/Kolkata', date: '2026-03-20', resultDate: '2026-03-20', dayNote: '', fromAbbr: 'CET', toAbbr: 'GMT+5:30', offsetHours: 4.5 } },
    { text: 'midnight UTC in Auckland on 2026-12-25', input: { time: '00:00', from: 'UTC', to: 'Pacific/Auckland', date: '2026-12-25' },
      output: { result: '13:00', time: '00:00', from: 'UTC', to: 'Pacific/Auckland', date: '2026-12-25', resultDate: '2026-12-25', dayNote: '', fromAbbr: 'UTC', toAbbr: 'GMT+13', offsetHours: 13 } }
  ],
  errorCases: [
    { input: { time: '15:00', from: 'Europe/Narnia', to: 'UTC' }, code: 'INVALID_INPUT' },
    { input: { time: '25:99', from: 'UTC', to: 'Europe/London' }, code: 'INVALID_INPUT' },
    { input: { time: '15:00', from: 'UTC' }, code: 'MISSING_FIELD' }
  ],
  run (input, ctx) {
    const tm = /^(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?$/i.exec(String(input.time).trim());
    if (!tm) return fail('INVALID_INPUT', `I couldn't read "${input.time}" as a time.`, 'time');
    let h = Number(tm[1]);
    const mi = Number(tm[2] ?? 0);
    const ampm = tm[3] && tm[3].toLowerCase();
    if (ampm) {
      if (h < 1 || h > 12) return fail('INVALID_INPUT', 'With am/pm the hour has to be 1–12.', 'time');
      h = (h % 12) + (ampm === 'pm' ? 12 : 0);
    }
    if (h > 23 || mi > 59) return fail('INVALID_INPUT', 'That is not a real time of day.', 'time');

    for (const [field, tz] of [['from', input.from], ['to', input.to]]) {
      if (!readZone(new Date(), tz)) {
        return fail('INVALID_INPUT', `"${tz}" isn't a time zone I know. Try an IANA name like Europe/London.`, field);
      }
    }

    const d = input.date ? parseDate(input.date, ctx) : { ok: true, ymd: todayYMD(ctx) };
    if (!d.ok) return fail('INVALID_INPUT', `I couldn't read "${input.date}" as a date (${d.reason}).`, 'date');

    const instant = zonedToUtc(d.ymd, h, mi, input.from);
    if (!instant || Number.isNaN(instant.getTime())) return fail('INTERNAL', 'That time could not be placed on a clock.', 'time');

    const there = readZone(instant, input.to);
    const here = readZone(instant, input.from);
    const resultDate = { y: there.y, m: there.m, d: there.d };
    const dayShift = Date.UTC(there.y, there.m - 1, there.d) - Date.UTC(here.y, here.m - 1, here.d);
    const shiftDays = Math.round(dayShift / 86400000);

    return ok({
      result: `${pad(there.h)}:${pad(there.mi)}`,
      time: `${pad(h)}:${pad(mi)}`,
      from: input.from,
      to: input.to,
      date: toISO(d.ymd),
      resultDate: toISO(resultDate),
      /* Only ever non-empty when the calendar date actually moves. A note
         saying "the same day" on a same-day conversion is noise, and the
         template concatenates it straight into the sentence, so noise here
         becomes a worse sentence there. */
      dayNote: shiftDays === 0 ? '' : shiftDays > 0 ? ' — the next day' : ' — the day before',
      fromAbbr: zoneAbbr(instant, input.from),
      toAbbr: zoneAbbr(instant, input.to),
      offsetHours: Math.round(((there.h * 60 + there.mi) - (here.h * 60 + here.mi) - shiftDays * -1440) / 60 * 100) / 100
    }, computed());
  }
};
