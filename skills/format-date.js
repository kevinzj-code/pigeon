import { ok, fail, computed } from '../src/contracts.js';
import { parseDate, toISO, weekdayOf, WEEKDAYS } from '../src/lib/dates.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

/* Ordered longest-token-first so YYYY is matched before YY and MMMM before MM.
   A naive token loop would rewrite the YY inside YYYY and produce "2626". */
const TOKENS = [
  ['YYYY', (d) => String(d.y).padStart(4, '0')],
  ['MMMM', (d) => MONTHS[d.m - 1]],
  ['MMM', (d) => MONTHS[d.m - 1].slice(0, 3)],
  ['DDDD', (d) => weekdayOf(d)],
  ['DDD', (d) => weekdayOf(d).slice(0, 3)],
  ['YY', (d) => String(d.y).slice(-2)],
  ['MM', (d) => String(d.m).padStart(2, '0')],
  ['DD', (d) => String(d.d).padStart(2, '0')],
  ['M', (d) => String(d.m)],
  ['D', (d) => String(d.d)]
];

export default {
  name: 'formatDate',
  description: 'Rewrite a date in a layout you choose, like DD/MM/YYYY or "D MMMM YYYY".',
  category: 'dates',
  tier: 'core',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{result}}',
  inputSchema: {
    type: 'object',
    required: ['date', 'format'],
    properties: {
      date: { type: 'string', label: 'date', prompt: 'Which date should I reformat?', description: 'a date' },
      format: { type: 'string', label: 'format', minLength: 1, prompt: 'What layout? (YYYY, MM, DD, MMMM for the month name, DDDD for the weekday)' }
    }
  },
  outputSchema: {
    type: 'object',
    properties: { result: { type: 'string' }, iso: { type: 'string' }, format: { type: 'string' } }
  },
  examples: [
    { text: 'format 2026-11-14 as DD/MM/YYYY', input: { date: '2026-11-14', format: 'DD/MM/YYYY' },
      output: { result: '14/11/2026', iso: '2026-11-14', format: 'DD/MM/YYYY' } },
    { text: 'write that date as D MMMM YYYY', input: { date: '2026-11-14', format: 'D MMMM YYYY' },
      output: { result: '14 November 2026', iso: '2026-11-14', format: 'D MMMM YYYY' } },
    { text: 'show christmas as DDDD, D MMM', input: { date: '2026-12-25', format: 'DDDD, D MMM' },
      output: { result: 'Friday, 25 Dec', iso: '2026-12-25', format: 'DDDD, D MMM' } },
    { text: 'format as MM-DD-YY for an american form', input: { date: '2026-07-04', format: 'MM-DD-YY' },
      output: { result: '07-04-26', iso: '2026-07-04', format: 'MM-DD-YY' } },
    { text: 'reformat 14 nov 2026 as YYYY/MM/DD', input: { date: '14 nov 2026', format: 'YYYY/MM/DD' },
      output: { result: '2026/11/14', iso: '2026-11-14', format: 'YYYY/MM/DD' } }
  ],
  errorCases: [
    { input: { date: 'not a date', format: 'YYYY' }, code: 'INVALID_INPUT' },
    { input: { date: '2026-01-01', format: 'nothing here' }, code: 'INVALID_INPUT' },
    { input: { date: '2026-01-01' }, code: 'MISSING_FIELD' }
  ],
  run (input, ctx) {
    const d = parseDate(input.date, ctx);
    if (!d.ok) return fail('INVALID_INPUT', `I couldn't read "${input.date}" as a date (${d.reason}).`, 'date');
    if (!TOKENS.some(([t]) => input.format.includes(t))) {
      return fail('INVALID_INPUT', 'That format has no date tokens in it — use YYYY, MM, DD, MMMM or DDDD.', 'format');
    }

    /* Single pass with one alternation, so a substituted value can never be
       re-scanned as a token. "MMMM" → "March" must not then match "M". */
    const re = new RegExp(TOKENS.map(([t]) => t).join('|'), 'g');
    const table = new Map(TOKENS);
    const result = input.format.replace(re, (t) => table.get(t)(d.ymd));

    void WEEKDAYS;
    return ok({ result, iso: toISO(d.ymd), format: input.format }, computed());
  }
};
