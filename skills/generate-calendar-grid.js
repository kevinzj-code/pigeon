import { ok, fail, computed } from '../src/contracts.js';
import { weekdayOf, WEEKDAYS } from '../src/lib/dates.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const daysIn = (y, m) => [31, (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];

export default {
  name: 'generateCalendarGrid',
  description: 'Draw a month out as a printable calendar grid of weeks.',
  category: 'generation', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{monthName}} {{year}} — {{dayCount}} days across {{weekCount}} weeks.\n{{text}}',
  inputSchema: {
    type: 'object', required: ['year', 'month'],
    properties: {
      year: { type: 'integer', label: 'year', minimum: 1, maximum: 9999, prompt: 'Which year?' },
      month: { type: 'integer', label: 'month', minimum: 1, maximum: 12, prompt: 'Which month, as a number from 1 to 12?' },
      startOn: { type: 'string', label: 'week starts on', enum: ['Monday', 'Sunday'], default: 'Monday' }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      weeks: { type: 'array' }, headers: { type: 'array', items: { type: 'string' } },
      text: { type: 'string' }, monthName: { type: 'string' }, year: { type: 'integer' },
      dayCount: { type: 'integer' }, weekCount: { type: 'integer' }
    }
  },
  examples: [
    { text: 'show me a calendar grid for September 2026', input: { year: 2026, month: 9 }, output: { weeks: [[null, 1, 2, 3, 4, 5, 6], [7, 8, 9, 10, 11, 12, 13], [14, 15, 16, 17, 18, 19, 20], [21, 22, 23, 24, 25, 26, 27], [28, 29, 30, null, null, null, null]], headers: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], text: 'Mon Tue Wed Thu Fri Sat Sun\n      1   2   3   4   5   6\n  7   8   9  10  11  12  13\n 14  15  16  17  18  19  20\n 21  22  23  24  25  26  27\n 28  29  30', monthName: 'September', year: 2026, dayCount: 30, weekCount: 5 } },
    { text: 'calendar for February 2026', input: { year: 2026, month: 2 }, output: { weeks: [[null, null, null, null, null, null, 1], [2, 3, 4, 5, 6, 7, 8], [9, 10, 11, 12, 13, 14, 15], [16, 17, 18, 19, 20, 21, 22], [23, 24, 25, 26, 27, 28, null]], headers: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], text: 'Mon Tue Wed Thu Fri Sat Sun\n                          1\n  2   3   4   5   6   7   8\n  9  10  11  12  13  14  15\n 16  17  18  19  20  21  22\n 23  24  25  26  27  28', monthName: 'February', year: 2026, dayCount: 28, weekCount: 5 } },
    { text: 'month grid for February 2024', input: { year: 2024, month: 2 }, output: { weeks: [[null, null, null, 1, 2, 3, 4], [5, 6, 7, 8, 9, 10, 11], [12, 13, 14, 15, 16, 17, 18], [19, 20, 21, 22, 23, 24, 25], [26, 27, 28, 29, null, null, null]], headers: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], text: 'Mon Tue Wed Thu Fri Sat Sun\n              1   2   3   4\n  5   6   7   8   9  10  11\n 12  13  14  15  16  17  18\n 19  20  21  22  23  24  25\n 26  27  28  29', monthName: 'February', year: 2024, dayCount: 29, weekCount: 5 } },
    { text: 'calendar starting on Sunday for September 2026', input: { year: 2026, month: 9, startOn: 'Sunday' }, output: { weeks: [[null, null, 1, 2, 3, 4, 5], [6, 7, 8, 9, 10, 11, 12], [13, 14, 15, 16, 17, 18, 19], [20, 21, 22, 23, 24, 25, 26], [27, 28, 29, 30, null, null, null]], headers: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], text: 'Sun Mon Tue Wed Thu Fri Sat\n          1   2   3   4   5\n  6   7   8   9  10  11  12\n 13  14  15  16  17  18  19\n 20  21  22  23  24  25  26\n 27  28  29  30', monthName: 'September', year: 2026, dayCount: 30, weekCount: 5 } },
    { text: 'grid for January 2026', input: { year: 2026, month: 1 }, output: { weeks: [[null, null, null, 1, 2, 3, 4], [5, 6, 7, 8, 9, 10, 11], [12, 13, 14, 15, 16, 17, 18], [19, 20, 21, 22, 23, 24, 25], [26, 27, 28, 29, 30, 31, null]], headers: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], text: 'Mon Tue Wed Thu Fri Sat Sun\n              1   2   3   4\n  5   6   7   8   9  10  11\n 12  13  14  15  16  17  18\n 19  20  21  22  23  24  25\n 26  27  28  29  30  31', monthName: 'January', year: 2026, dayCount: 31, weekCount: 5 } },
    { text: 'show february 2027 as a grid of weeks', input: { year: 2027, month: 2 },
      output: { weeks: [[1, 2, 3, 4, 5, 6, 7], [8, 9, 10, 11, 12, 13, 14], [15, 16, 17, 18, 19, 20, 21], [22, 23, 24, 25, 26, 27, 28]], headers: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], text: 'Mon Tue Wed Thu Fri Sat Sun\n  1   2   3   4   5   6   7\n  8   9  10  11  12  13  14\n 15  16  17  18  19  20  21\n 22  23  24  25  26  27  28', monthName: 'February', year: 2027, dayCount: 28, weekCount: 4 } },
    { text: 'lay out march 2027 week by week', input: { year: 2027, month: 3 },
      output: { weeks: [[1, 2, 3, 4, 5, 6, 7], [8, 9, 10, 11, 12, 13, 14], [15, 16, 17, 18, 19, 20, 21], [22, 23, 24, 25, 26, 27, 28], [29, 30, 31, null, null, null, null]], headers: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], text: 'Mon Tue Wed Thu Fri Sat Sun\n  1   2   3   4   5   6   7\n  8   9  10  11  12  13  14\n 15  16  17  18  19  20  21\n 22  23  24  25  26  27  28\n 29  30  31', monthName: 'March', year: 2027, dayCount: 31, weekCount: 5 } }
  ],
  errorCases: [
    { input: { year: 2026, month: 13 }, code: 'INVALID_INPUT' },
    { input: { year: 2026, month: 0 }, code: 'INVALID_INPUT' },
    { input: { year: 2026 }, code: 'MISSING_FIELD' }
  ],
  run (input) {
    const { year, month } = input;
    const sundayFirst = input.startOn === 'Sunday';
    const headers = sundayFirst ? SHORT : [...SHORT.slice(1), SHORT[0]];

    const total = daysIn(year, month);
    /* weekdayOf gives the day's NAME; WEEKDAYS is Sunday-first, so its index is
       the Sunday-first column. A Monday-first grid is the same number shifted
       round by one. */
    const firstWeekday = WEEKDAYS.indexOf(weekdayOf({ y: year, m: month, d: 1 }));
    const lead = sundayFirst ? firstWeekday : (firstWeekday + 6) % 7;

    const cells = [...Array(lead).fill(null), ...Array.from({ length: total }, (_, i) => i + 1)];
    while (cells.length % 7) cells.push(null);
    const weeks = [];
    for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

    /* Trailing blanks are trimmed off the printed rows so the text does not end
       in a run of spaces, but the `weeks` array keeps them — a grid consumer
       wants seven columns in every row. */
    const text = [headers.join(' '), ...weeks.map((w) => w.map((d) => (d === null ? '   ' : String(d).padStart(3))).join(' ').replace(/\s+$/, ''))].join('\n');

    return ok({
      weeks, headers, text, monthName: MONTHS[month - 1], year,
      dayCount: total, weekCount: weeks.length
    }, computed());
  }
};
