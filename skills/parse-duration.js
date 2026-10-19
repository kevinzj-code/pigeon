import { ok, fail, computed } from '../src/contracts.js';
import { round } from '../src/lib/num.js';

const UNIT_SECONDS = {
  w: 604800, week: 604800, weeks: 604800,
  d: 86400, day: 86400, days: 86400,
  h: 3600, hr: 3600, hrs: 3600, hour: 3600, hours: 3600,
  m: 60, min: 60, mins: 60, minute: 60, minutes: 60,
  s: 1, sec: 1, secs: 1, second: 1, seconds: 1
};

export default {
  name: 'parseDuration',
  description: 'Read "2h 15m" or "2 days 4 hours" and give the total in seconds.',
  category: 'dates',
  tier: 'core',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{text}} is {{seconds|comma}} seconds — {{minutes}} minutes, or {{hours}} hours.',
  inputSchema: {
    type: 'object',
    required: ['text'],
    properties: { text: { type: 'string', label: 'duration', minLength: 1, prompt: 'How long? (like "1h 30m")' } }
  },
  outputSchema: {
    type: 'object',
    properties: {
      seconds: { type: 'number' }, minutes: { type: 'number' }, hours: { type: 'number' },
      days: { type: 'number' }, text: { type: 'string' }
    }
  },
  examples: [
    { text: 'how many seconds is 1h 30m', input: { text: '1h 30m' },
      output: { seconds: 5400, minutes: 90, hours: 1.5, days: 0.06, text: '1h 30m' } },
    { text: 'convert 2 days 4 hours to seconds', input: { text: '2 days 4 hours' },
      output: { seconds: 187200, minutes: 3120, hours: 52, days: 2.17, text: '2 days 4 hours' } },
    { text: 'how long is 45 minutes in seconds', input: { text: '45 minutes' },
      output: { seconds: 2700, minutes: 45, hours: 0.75, days: 0.03, text: '45 minutes' } },
    { text: 'parse 1w2d', input: { text: '1w2d' },
      output: { seconds: 777600, minutes: 12960, hours: 216, days: 9, text: '1w2d' } },
    { text: 'what is 90s in seconds', input: { text: '90s' },
      output: { seconds: 90, minutes: 1.5, hours: 0.03, days: 0, text: '90s' } }
  ],
  errorCases: [
    { input: { text: 'a little while' }, code: 'INVALID_INPUT' },
    { input: { text: '5 parsecs' }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' }
  ],
  run (input) {
    const src = String(input.text).trim().toLowerCase();
    const re = /(\d+(?:\.\d+)?)\s*([a-z]+)/g;
    let seconds = 0;
    let matched = 0;
    let unknown = null;

    for (const m of src.matchAll(re)) {
      const unit = UNIT_SECONDS[m[2]];
      /* An unrecognised unit is refused rather than skipped: silently ignoring
         "5 parsecs" would return 0 seconds and look like an answer. */
      if (unit === undefined) { unknown = m[2]; break; }
      seconds += Number(m[1]) * unit;
      matched += 1;
    }
    if (unknown) return fail('INVALID_INPUT', `I don't know the unit "${unknown}".`, 'text');
    if (!matched) return fail('INVALID_INPUT', `I couldn't read "${input.text}" as a length of time. Try something like "1h 30m".`, 'text');

    return ok({
      seconds: round(seconds, 3),
      minutes: round(seconds / 60, 2),
      hours: round(seconds / 3600, 2),
      days: round(seconds / 86400, 2),
      text: input.text
    }, computed());
  }
};
