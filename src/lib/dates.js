/* dates.js — calendar arithmetic on civil dates, not instants.
 *
 * "How many days until 14 November" is a question about a calendar, not about
 * elapsed time, so everything here works in whole days on a UTC-anchored day
 * number. That is what makes the answer stable across a DST boundary: the
 * naive `(b - a) / 86400000` returns 73.958333 for a pair of dates spanning a
 * clock change, and rounding it is a coin flip on exactly the dates people
 * most often ask about.
 *
 * Anything genuinely about a moment in time (convertTimezone) uses Intl
 * instead, and says so in its own comments. */

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july',
  'august', 'september', 'october', 'november', 'december'];
const MONTH_ABBR = MONTHS.map(m => m.slice(0, 3));

export const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Days since 1970-01-01, from a civil date. */
export function dayNumber (y, m, d) {
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}

export function fromDayNumber (n) {
  const dt = new Date(n * 86400000);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

export const toISO = ({ y, m, d }) =>
  `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

export function isValidYMD (y, m, d) {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return false;
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** The device's "today", read through ctx and its timezone. §2.5. */
export function todayYMD (ctx) {
  const now = new Date(ctx && ctx.now ? ctx.now : Date.now());
  if (Number.isNaN(now.getTime())) throw new Error('ctx.now is not a valid date');
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: (ctx && ctx.timezone) || 'UTC',
      year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(now);
    const get = (t) => Number(parts.find(p => p.type === t).value);
    return { y: get('year'), m: get('month'), d: get('day') };
  } catch {
    return { y: now.getUTCFullYear(), m: now.getUTCMonth() + 1, d: now.getUTCDate() };
  }
}

/* Locales that write month first. Everywhere else in the world writes the day
   first, so the list is the exception rather than the rule. A slash date from
   an unrecognised locale is read day-first — and where BOTH readings are valid
   and different, parseDate reports the ambiguity rather than picking. */
const MONTH_FIRST = /^en-(US|PH|FM|MH|PW)\b|^en$/i;

/**
 * Parse a human date. Returns {ok:true, ymd} | {ok:false, reason, ambiguous?}.
 * Deliberately narrow: it accepts the forms people actually type and refuses
 * the rest, because a wrong date parsed confidently is worse than a question.
 */
export function parseDate (text, ctx = {}) {
  if (typeof text !== 'string') return { ok: false, reason: 'not a date' };
  const s = text.trim().toLowerCase().replace(/,/g, ' ').replace(/\s+/g, ' ');
  if (!s) return { ok: false, reason: 'empty' };

  const rel = { today: 0, tomorrow: 1, yesterday: -1, tonight: 0 };
  if (s in rel) {
    const t = todayYMD(ctx);
    return { ok: true, ymd: fromDayNumber(dayNumber(t.y, t.m, t.d) + rel[s]) };
  }

  const iso = ISO_RE.exec(text.trim());
  if (iso) {
    const [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
    return isValidYMD(y, m, d) ? { ok: true, ymd: { y, m, d } } : { ok: false, reason: 'not a real date' };
  }

  const today = todayYMD(ctx);

  /* "14 november 2026" / "14 nov" / "november 14 2026" / "nov 14" */
  const named = /^(?:(\d{1,2})(?:st|nd|rd|th)?\s+)?([a-z]{3,9})\.?(?:\s+(\d{1,2})(?:st|nd|rd|th)?)?(?:\s+(\d{4}))?$/.exec(s);
  if (named) {
    const monthName = named[2];
    let mi = MONTHS.indexOf(monthName);
    if (mi === -1) mi = MONTH_ABBR.indexOf(monthName.slice(0, 3));
    if (mi !== -1) {
      const d = Number(named[1] ?? named[3]);
      if (!Number.isFinite(d)) return { ok: false, reason: 'no day of month' };
      const y = named[4] ? Number(named[4]) : rollForward(today, mi + 1, d);
      return isValidYMD(y, mi + 1, d)
        ? { ok: true, ymd: { y, m: mi + 1, d } }
        : { ok: false, reason: 'not a real date' };
    }
  }

  /* Numeric, slash or dash separated. */
  const num = /^(\d{1,4})[/\-.](\d{1,2})(?:[/\-.](\d{2,4}))?$/.exec(s);
  if (num) {
    let a = Number(num[1]), b = Number(num[2]);
    let y = num[3] !== undefined ? Number(num[3]) : null;
    if (y !== null && y < 100) y += y < 70 ? 2000 : 1900;
    if (num[1].length === 4) {
      /* 2026/11/14 — unambiguous */
      const d = y ?? 1;
      return isValidYMD(a, b, y ?? 1) ? { ok: true, ymd: { y: a, m: b, d } } : { ok: false, reason: 'not a real date' };
    }
    const monthFirst = MONTH_FIRST.test((ctx && ctx.locale) || 'en-GB');
    const asDM = { y: y ?? rollForward(today, b, a), m: b, d: a };
    const asMD = { y: y ?? rollForward(today, a, b), m: a, d: b };
    const dmOk = isValidYMD(asDM.y, asDM.m, asDM.d);
    const mdOk = isValidYMD(asMD.y, asMD.m, asMD.d);
    if (dmOk && mdOk && a !== b) {
      /* Both readings are real and they disagree. The locale decides, but the
         caller is told it was a guess so the UI can say so. */
      return { ok: true, ymd: monthFirst ? asMD : asDM, ambiguous: true, other: toISO(monthFirst ? asDM : asMD) };
    }
    if (monthFirst && mdOk) return { ok: true, ymd: asMD };
    if (dmOk) return { ok: true, ymd: asDM };
    if (mdOk) return { ok: true, ymd: asMD };
    return { ok: false, reason: 'not a real date' };
  }

  return { ok: false, reason: 'unrecognised date format' };
}

/* A bare "14 nov" means the next 14 November — the one that hasn't happened
   yet. People asking "how long until X" almost never mean a date in the past,
   and when they do they write the year. */
function rollForward (today, m, d) {
  const y = today.y;
  return dayNumber(y, m, d) < dayNumber(today.y, today.m, today.d) ? y + 1 : y;
}

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function weekdayOf (ymd) {
  return WEEKDAYS[((dayNumber(ymd.y, ymd.m, ymd.d) % 7) + 11) % 7];
}

/** Calendar-aware month addition: 31 Jan + 1 month clamps to 28/29 Feb. */
export function addMonths (ymd, n) {
  const total = ymd.y * 12 + (ymd.m - 1) + n;
  const y = Math.floor(total / 12);
  const m = (total % 12 + 12) % 12 + 1;
  const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { y, m, d: Math.min(ymd.d, dim) };
}

export function addDays (ymd, n) {
  return fromDayNumber(dayNumber(ymd.y, ymd.m, ymd.d) + n);
}

/** ISO-8601 week number and week-year. */
export function isoWeek (ymd) {
  const dn = dayNumber(ymd.y, ymd.m, ymd.d);
  const dow = ((dn % 7) + 11) % 7;           // 0=Sun
  const iso = dow === 0 ? 7 : dow;            // 1=Mon..7=Sun
  const thursday = dn + (4 - iso);
  const t = fromDayNumber(thursday);
  const jan1 = dayNumber(t.y, 1, 1);
  return { week: Math.floor((thursday - jan1) / 7) + 1, year: t.y };
}

/* ── time zones ──────────────────────────────────────────────────────────
 * Offsets come from Intl, not from a bundled table. A table of UTC offsets is
 * wrong twice a year in every zone that observes daylight saving, and wrong
 * permanently whenever a country changes its rules — which several do every
 * year. Intl reads the platform's tzdata, so this is `computed` rather than
 * `bundled`, and there is no date to go stale. */

export function offsetMinutesAt (zone, at) {
  const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: zone, timeZoneName: 'longOffset' });
  const name = fmt.formatToParts(at).find((p) => p.type === 'timeZoneName').value;
  const m = /GMT([+-])(\d{2}):(\d{2})/.exec(name);
  if (!m) return 0; // "GMT" with no offset is UTC itself
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
}

export const formatOffset = (mins) => {
  const sign = mins < 0 ? '-' : '+';
  const a = Math.abs(mins);
  return `${sign}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
};

/* Local wall-clock time in a zone, as "YYYY-MM-DD HH:MM". Built from the shifted
   epoch rather than from a formatted string so the pieces cannot disagree. */
export function localTimeIn (zone, at) {
  const shifted = new Date(at.getTime() + offsetMinutesAt(zone, at) * 60000);
  return `${shifted.toISOString().slice(0, 10)} ${shifted.toISOString().slice(11, 16)}`;
}

/* Standard time is the SMALLER of the January and July offsets — which puts
   the southern hemisphere the right way round, where January is the summer. */
export function daylightSavingAt (zone, at) {
  const y = at.getUTCFullYear();
  const jan = offsetMinutesAt(zone, new Date(Date.UTC(y, 0, 15)));
  const jul = offsetMinutesAt(zone, new Date(Date.UTC(y, 6, 15)));
  const standard = Math.min(jan, jul);
  const now = offsetMinutesAt(zone, at);
  return { usesDaylightSaving: jan !== jul, inDaylightSaving: now > standard, standardOffsetMinutes: standard };
}

export function findZone (query) {
  const q = String(query).trim();

  /* Ask Intl whether it accepts the name before searching for it. Its zone list
     holds canonical names only, so it has "Asia/Calcutta" but not the alias
     "Asia/Kolkata", and no "UTC" at all — both of which it nonetheless accepts.
     The name the caller typed is kept rather than the resolved one: Intl maps
     Kolkata back to the older Calcutta, and which alias wins depends on the
     platform's ICU version, so echoing their own valid name is both friendlier
     and stable across environments. */
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: q });
    return { zone: q, others: [] };
  } catch { /* not a zone name; fall through to searching */ }

  const zones = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
  const key = q.replace(/\s+/g, '_').toLowerCase();
  const city = zones.filter((z) => z.split('/').pop().toLowerCase() === key);
  if (city.length) return { zone: city[0], others: city.slice(1) };
  const loose = zones.filter((z) => z.toLowerCase().includes(key));
  return loose.length ? { zone: loose[0], others: loose.slice(1, 6) } : null;
}
