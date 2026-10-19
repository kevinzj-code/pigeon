import { ok, computed } from '../src/contracts.js';
import { isValidYMD, toISO } from '../src/lib/dates.js';

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const monthIndex = (name) => MONTHS.findIndex((m) => m.startsWith(String(name).toLowerCase().slice(0, 3)));

const PATTERNS = [
  { kind: 'iso', re: /\b(\d{4})-(\d{2})-(\d{2})\b/g, build: (m) => ({ y: +m[1], mo: +m[2], d: +m[3] }) },
  { kind: 'named', re: /\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,?\s+(\d{4})\b/gi, build: (m) => ({ y: +m[3], mo: monthIndex(m[2]) + 1, d: +m[1] }) },
  { kind: 'named', re: /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/gi, build: (m) => ({ y: +m[3], mo: monthIndex(m[1]) + 1, d: +m[2] }) },
  { kind: 'slashed', re: /\b(\d{1,2})[/.](\d{1,2})[/.](\d{4})\b/g, build: (m) => ({ y: +m[3], mo: +m[2], d: +m[1], other: { y: +m[3], mo: +m[1], d: +m[2] } }) }
];

export default {
  name: 'extractDates',
  description: 'Pull the dates already written in a block of text back out of it.',
  category: 'text', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{count}} {{count|plural:date:dates}} found: {{dates|list}}.{{ambiguityNote|prose}}',
  inputSchema: {
    type: 'object', required: ['text'],
    properties: {
      text: { type: 'string', label: 'text', minLength: 1, maxLength: 100000, prompt: 'Which text should I search for dates?' },
      dayFirst: { type: 'boolean', label: 'day before month', default: true, description: 'read 03/04/2026 as 3 April rather than 4 March' }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      dates: { type: 'array', items: { type: 'string' } }, matches: { type: 'array' },
      count: { type: 'integer' }, ambiguousCount: { type: 'integer' }, ambiguityNote: { type: 'string' }
    }
  },
  examples: [
    { text: 'find the dates in this text', input: { text: 'The meeting is on 2026-09-01 and the deadline is 2026-10-15.' }, output: { dates: ['2026-09-01', '2026-10-15'], matches: [{ text: '2026-09-01', date: '2026-09-01', format: 'iso', ambiguous: false }, { text: '2026-10-15', date: '2026-10-15', format: 'iso', ambiguous: false }], count: 2, ambiguousCount: 0, ambiguityNote: '' } },
    { text: 'extract dates written out in words', input: { text: 'Signed on 1 September 2026, effective from Oct 15, 2026.' }, output: { dates: ['2026-09-01', '2026-10-15'], matches: [{ text: '1 September 2026', date: '2026-09-01', format: 'named', ambiguous: false }, { text: 'Oct 15, 2026', date: '2026-10-15', format: 'named', ambiguous: false }], count: 2, ambiguousCount: 0, ambiguityNote: '' } },
    { text: 'are there any dates here', input: { text: 'No dates in this sentence whatsoever.' }, output: { dates: [], matches: [], count: 0, ambiguousCount: 0, ambiguityNote: '' } },
    { text: 'pull out the slashed dates', input: { text: 'Invoice dated 03/04/2026 is due 17/04/2026.' }, output: { dates: ['2026-04-03', '2026-04-17'], matches: [{ text: '03/04/2026', date: '2026-04-03', format: 'slashed', ambiguous: true, alternative: '2026-03-04' }, { text: '17/04/2026', date: '2026-04-17', format: 'slashed', ambiguous: false }], count: 2, ambiguousCount: 1, ambiguityNote: ' One of them could be read either way round — 03/04/2026 is 2026-04-03 read day-first, or 2026-03-04 read month-first.' } },
    { text: 'read the dates month first', input: { text: 'Filed 03/04/2026.', dayFirst: false }, output: { dates: ['2026-03-04'], matches: [{ text: '03/04/2026', date: '2026-03-04', format: 'slashed', ambiguous: true, alternative: '2026-04-03' }], count: 1, ambiguousCount: 1, ambiguityNote: ' One of them could be read either way round — 03/04/2026 is 2026-03-04 read month-first, or 2026-04-03 read day-first.' } }
  ],
  errorCases: [
    { input: {}, code: 'MISSING_FIELD' },
    { input: { text: '' }, code: 'MISSING_FIELD' },
    { input: { text: 'x'.repeat(100001) }, code: 'INVALID_INPUT' }
  ],
  run (input) {
    const dayFirst = input.dayFirst !== false;
    const matches = [];
    const taken = [];

    for (const pattern of PATTERNS) {
      for (const m of String(input.text).matchAll(pattern.re)) {
        const start = m.index;
        const end = start + m[0].length;
        if (taken.some(([s, e]) => start < e && end > s)) continue;

        const parts = pattern.build(m);
        let primary = parts;
        let secondary = parts.other ?? null;
        /* 03/04/2026 is 3 April to most of the world and 4 March in the United
           States. There is no way to tell from the string, so BOTH readings are
           reported and the one not chosen is named rather than discarded. */
        if (secondary && !dayFirst) { primary = secondary; secondary = parts; }
        if (!isValidYMD(primary.y, primary.mo, primary.d)) continue;

        taken.push([start, end]);
        const ambiguous = Boolean(secondary) && isValidYMD(secondary.y, secondary.mo, secondary.d) &&
          !(secondary.mo === primary.mo && secondary.d === primary.d);
        const entry = {
          text: m[0], date: toISO({ y: primary.y, m: primary.mo, d: primary.d }),
          format: pattern.kind, ambiguous
        };
        if (ambiguous) entry.alternative = toISO({ y: secondary.y, m: secondary.mo, d: secondary.d });
        matches.push({ ...entry, start });
      }
    }

    matches.sort((a, b) => a.start - b.start);
    const clean = matches.map(({ start, ...rest }) => rest);
    const ambiguousCount = clean.filter((m) => m.ambiguous).length;
    const first = clean.find((m) => m.ambiguous);

    return ok({
      dates: clean.map((m) => m.date), matches: clean, count: clean.length, ambiguousCount,
      ambiguityNote: first
        ? ` ${ambiguousCount === 1 ? 'One of them' : `${ambiguousCount} of them`} could be read either way round — ${first.text} is ${first.date} read ${dayFirst ? 'day-first' : 'month-first'}, or ${first.alternative} read ${dayFirst ? 'month-first' : 'day-first'}.`
        : ''
    }, computed());
  }
};
