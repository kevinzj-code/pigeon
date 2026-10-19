/* derive.js — a value the planner works out from the message, checked by
 * working it out here. Shared by the app's input audit (D94) and the planner
 * rows' checker (scripts/lib/derive.mjs re-exports it).
 *
 * Round 2's rows had to copy every value from the message as written, so the
 * trained planner learnt to copy: "christmas" stayed "christmas", "340 divided
 * by 8 plus 12" stayed in words (patch-planner-misses-r2.md, a write-up outside this repo).
 * Round 3 rows may instead name a rule and the words it applies to:
 *
 *   "derive": [{ "field": "to", "rule": "date", "from": "christmas" }]
 *
 * and the row passes only when `from` is in the message and the rule, run
 * here on those words against the frozen TODAY, gives exactly the plan's
 * value. Seven rules, closed: a phrase a rule does not know is refused, never
 * guessed.
 *
 *   date        a day phrase → ISO date (holidays, end of the month/year,
 *               next/this <weekday>, tomorrow, in N days/weeks, N days ago…)
 *   days        a day phrase → days from today to that day, both counted
 *   fraction    "a fifth" → 0.2, "3 out of 8" → 0.375, "15 percent" → 0.15
 *   quantity    a named amount → its number (half marathon 21.0975, a couple 2)
 *   arithmetic  spoken arithmetic → the expression ("340 divided by 8 plus 12"
 *               → "340 / 8 + 12"), compared without spaces
 *   enum        a phrase → one of the field's enum values: the value's own
 *               word, or a reviewed synonym (bench/planner-rows-3/enum-synonyms.json)
 *   dice        "a couple of dice" → "2d6", "three d20s" → "3d20"
 */

const DAY = 86400000;
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const SMALL = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, twenty: 20, thirty: 30, couple: 2, few: null };
const count = (w) => (/^\d+$/.test(w) ? Number(w) : SMALL[w] ?? null);

/* Fixed-date holidays, as month and day; the next one on or after today. */
const HOLIDAYS = {
  'christmas': [12, 25], 'christmas day': [12, 25], 'xmas': [12, 25], 'christmas eve': [12, 24], 'boxing day': [12, 26],
  "new year's eve": [12, 31], 'new years eve': [12, 31], "new year's day": [1, 1], 'new years day': [1, 1], 'new year': [1, 1],
  'halloween': [10, 31], "valentine's day": [2, 14], 'valentines day': [2, 14], 'bonfire night': [11, 5], 'guy fawkes night': [11, 5],
  "st patrick's day": [3, 17], 'st patricks day': [3, 17], 'independence day': [7, 4], 'the fourth of july': [7, 4], 'july 4th': [7, 4],
  "april fools' day": [4, 1], 'april fools day': [4, 1], 'may day': [5, 1]
};

const iso = (t) => new Date(t).toISOString().slice(0, 10);
const utcDay = (y, m, d) => Date.UTC(y, m - 1, d);

/** A day phrase → ms at UTC midnight, or null when the phrase is not one we know. */
export function dayOf (phrase, today) {
  const p = String(phrase).toLowerCase().trim().replace(/\s+/g, ' ').replace(/^(on |by |before |until |till |for )/, '');
  const t = Date.parse(String(today).slice(0, 10) + 'T00:00:00Z');
  const now = new Date(t);
  const y = now.getUTCFullYear(), m = now.getUTCMonth() + 1, dow = now.getUTCDay();
  if (p === 'today') return t;
  if (p === 'tomorrow') return t + DAY;
  if (p === 'yesterday') return t - DAY;
  if (p === 'the day after tomorrow') return t + 2 * DAY;
  const hol = HOLIDAYS[p.replace(/^the /, '')];
  if (hol) { const d = utcDay(y, hol[0], hol[1]); return d >= t ? d : utcDay(y + 1, hol[0], hol[1]); }
  if (/^(the )?end of (the |this )?month$/.test(p)) return utcDay(y, m + 1, 0);
  if (/^(the )?end of (the |this )?year$/.test(p)) return utcDay(y, 12, 31);
  if (/^(the )?(start|beginning) of next month$/.test(p)) return utcDay(y, m + 1, 1);
  if (/^(the )?end of next month$/.test(p)) return utcDay(y, m + 2, 0);
  let x;
  /* "next friday" is the first friday after today; "this friday" the first on
     or after today; a bare weekday, the first after today. */
  if ((x = p.match(/^(next|this|coming|this coming)? ?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)$/))) {
    const want = WEEKDAYS.indexOf(x[2]);
    let ahead = (want - dow + 7) % 7;
    if (ahead === 0 && x[1] !== 'this') ahead = 7;
    return t + ahead * DAY;
  }
  if ((x = p.match(/^last (sunday|monday|tuesday|wednesday|thursday|friday|saturday)$/))) {
    let back = (dow - WEEKDAYS.indexOf(x[1]) + 7) % 7; if (back === 0) back = 7;
    return t - back * DAY;
  }
  if ((x = p.match(/^(?:in )?(\w+) (day|days|week|weeks|fortnight|fortnights)(?: from (?:now|today))?$/)) && (p.startsWith('in ') || /from (now|today)$/.test(p))) {
    const n = count(x[1]); if (!n) return null;
    return t + n * (x[2].startsWith('day') ? 1 : x[2].startsWith('week') ? 7 : 14) * DAY;
  }
  if ((x = p.match(/^(?:in )?a (week|fortnight)(?: from (?:now|today))?$/)) && (p.startsWith('in ') || /from (now|today)$/.test(p))) return t + (x[1] === 'week' ? 7 : 14) * DAY;
  if ((x = p.match(/^(\w+) (day|days|week|weeks) ago$/))) {
    const n = count(x[1]); if (!n) return null;
    return t - n * (x[2].startsWith('day') ? 1 : 7) * DAY;
  }
  if ((x = p.match(/^a (week|fortnight) ago$/))) return t - (x[1] === 'week' ? 7 : 14) * DAY;
  return null;
}

const FRACTIONS = { half: 0.5, 'a half': 0.5, 'one half': 0.5, 'a quarter': 0.25, 'one quarter': 0.25, quarter: 0.25, 'three quarters': 0.75,
  'a fifth': 0.2, 'one fifth': 0.2, 'two fifths': 0.4, 'three fifths': 0.6, 'four fifths': 0.8, 'a tenth': 0.1, 'one tenth': 0.1,
  'an eighth': 0.125, 'one eighth': 0.125, 'three eighths': 0.375, 'five eighths': 0.625, 'seven eighths': 0.875, 'a twentieth': 0.05, 'half the time': 0.5, 'a quarter of the time': 0.25,
  'a fifth of the time': 0.2, 'a tenth of the time': 0.1 };
const QUANTITIES = { 'half marathon': 21.0975, 'a half marathon': 21.0975, marathon: 42.195, 'a marathon': 42.195, '5k': 5, 'a 5k': 5, '10k': 10, 'a 10k': 10,
  'a dozen': 12, dozen: 12, 'half a dozen': 6, 'a couple': 2, 'a couple of': 2, 'a pair': 2, 'a pair of': 2, 'a score': 20, 'a gross': 144,
  'a fortnight': 14, 'a week': 7, 'a decade': 10, 'a century': 100, 'a leap year': 366, 'a year': 365, 'an hour': 60, 'half an hour': 30, 'a quarter of an hour': 15 };
const ARITH = [[/\bmultiplied by\b/g, '*'], [/\btimes\b/g, '*'], [/\bdivided by\b/g, '/'], [/\bover\b/g, '/'], [/\bplus\b/g, '+'], [/\bminus\b/g, '-'],
  [/\bsquared\b/g, '^2'], [/\bcubed\b/g, '^3'], [/\bto the power of\b/g, '^']];

const close = (a, b) => typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a));

/**
 * Check one derivation. `value` is the plan's; `ctx.today` the frozen date;
 * `enumValues` the field's enum, if any; `synonyms` a { phrase: value } map
 * for that field. Returns null when it holds, or why not.
 */
export function checkDerivation ({ rule, from, value, today, enumValues = null, synonyms = {} }) {
  const f = String(from).toLowerCase().trim();
  switch (rule) {
    case 'date': {
      const d = dayOf(f, today);
      if (d === null) return `"${from}" is not a day phrase the date rule knows`;
      return value === iso(d) ? null : `"${from}" is ${iso(d)}, the plan has ${JSON.stringify(value)}`;
    }
    case 'days': {
      const d = dayOf(f, today);
      if (d === null) return `"${from}" is not a day phrase the days rule knows`;
      const n = Math.round((d - Date.parse(String(today).slice(0, 10) + 'T00:00:00Z')) / DAY) + 1;
      return value === n ? null : `"${from}" is ${n} days counting today, the plan has ${JSON.stringify(value)}`;
    }
    case 'fraction': {
      let n = FRACTIONS[f];
      let x;
      if (n === undefined && (x = f.match(/^(\d+) out of (\d+)$/))) n = Number(x[1]) / Number(x[2]);
      if (n === undefined && (x = f.match(/^one in (\d+)$/))) n = 1 / Number(x[1]);
      if (n === undefined && (x = f.match(/^(\d+(?:\.\d+)?) ?(%|percent|per cent)$/))) n = Number(x[1]) / 100;
      if (n === undefined) return `"${from}" is not a fraction the rule knows`;
      return close(value, n) ? null : `"${from}" is ${n}, the plan has ${JSON.stringify(value)}`;
    }
    case 'quantity': {
      const n = QUANTITIES[f];
      if (n === undefined) return `"${from}" is not a named quantity the rule knows`;
      return close(value, n) ? null : `"${from}" is ${n}, the plan has ${JSON.stringify(value)}`;
    }
    case 'arithmetic': {
      let e = f.replace(/,(?=\d{3}\b)/g, '');
      for (const [re, sym] of ARITH) e = e.replace(re, ` ${sym} `);
      if (/[a-z]/.test(e)) return `"${from}" has words the arithmetic rule does not turn into symbols`;
      const squash = (s) => String(s).replace(/\s+/g, '').replace(/[×x]/g, '*').replace(/÷/g, '/');
      return squash(value) === squash(e) ? null : `"${from}" is ${squash(e)}, the plan has ${JSON.stringify(value)}`;
    }
    case 'enum': {
      if (!Array.isArray(enumValues)) return 'the enum rule needs a field with an enum';
      if (!enumValues.includes(value)) return `${JSON.stringify(value)} is not one of ${enumValues.join(', ')}`;
      /* The value's own word, starting a word of the phrase ("maximum" is
         max, "left-aligned" is left) but never inside one ("semi-annually"
         is not annually); a blank or one-character value ("", " ", ";")
         only ever by synonym. */
      const v = String(value).toLowerCase().trim();
      const esc = v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const own = (v.length >= 2 && new RegExp(`(^|[^a-z0-9-])${esc}`).test(f)) || (v.length === 1 && f === v);
      const syn = synonyms[f] === value;
      return own || syn ? null : `"${from}" is neither "${value}" nor a reviewed synonym for it`;
    }
    case 'dice': {
      const x = f.match(/^(a|an|one|two|three|four|five|six|a couple of|a pair of|\d+) (?:(\d+)-sided |d(\d+) ?)?(?:dice|die|d(\d+)s?)$/);
      if (!x) return `"${from}" is not a dice phrase the rule knows`;
      const n = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, 'a couple of': 2, 'a pair of': 2 }[x[1]] ?? Number(x[1]);
      const sides = Number(x[2] || x[3] || x[4] || 6);
      return value === `${n}d${sides}` ? null : `"${from}" is ${n}d${sides}, the plan has ${JSON.stringify(value)}`;
    }
    default:
      return `no rule "${rule}"`;
  }
}

export const RULES = ['date', 'days', 'fraction', 'quantity', 'arithmetic', 'enum', 'dice'];

/** The value at a dotted path ("outcomes.0.probability") in an input. */
export function valueAt (input, path) {
  return String(path).split('.').reduce((v, k) => (v == null ? undefined : v[/^\d+$/.test(k) ? Number(k) : k]), input);
}
/** The input with the value at `path` removed (so the literal check skips it). */
export function without (input, path) {
  const copy = JSON.parse(JSON.stringify(input));
  const keys = String(path).split('.');
  const last = keys.pop();
  const parent = keys.reduce((v, k) => (v == null ? undefined : v[/^\d+$/.test(k) ? Number(k) : k]), copy);
  if (parent && typeof parent === 'object') delete parent[/^\d+$/.test(last) ? Number(last) : last];
  return copy;
}

/**
 * D94: every number the fraction and quantity rules produce from phrases in
 * `text` ("a fifth" → 0.2, "3 out of 8" → 0.375, "a marathon" → 42.195). The
 * input audit counts these as stated: the planner worked them out from the
 * person's own words, as it should.
 */
export function derivedNumbers (text) {
  const t = ' ' + String(text).toLowerCase().replace(/[^a-z0-9%.\s-]/g, ' ').replace(/\s+/g, ' ') + ' ';
  const out = new Set();
  const has = (phrase) => t.includes(` ${phrase} `);
  for (const [phrase, n] of Object.entries(FRACTIONS)) if (has(phrase)) out.add(n);
  for (const [phrase, n] of Object.entries(QUANTITIES)) if (has(phrase)) out.add(n);
  for (const m of t.matchAll(/ (\d+) out of (\d+) /g)) if (Number(m[2])) out.add(Number(m[1]) / Number(m[2]));
  for (const m of t.matchAll(/ one in (\d+) /g)) if (Number(m[1])) out.add(1 / Number(m[1]));
  for (const m of t.matchAll(/ (\d+(?:\.\d+)?) ?(?:%|percent|per cent) /g)) out.add(Number(m[1]) / 100);
  return out;
}
