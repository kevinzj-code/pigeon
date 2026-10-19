import { ok, computed } from '../src/contracts.js';

export default {
  name: 'extractTimes',
  description: 'Pull every clock time out of a text and give each in 24-hour form.',
  category: 'text', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{count}} {{count|plural:time:times}}: {{times|list}}',
  inputSchema: {
    type: 'object', required: ['text'],
    properties: { text: { type: 'string', label: 'text', minLength: 1, prompt: 'Which text should I search?' } }
  },
  outputSchema: { type: 'object', properties: { times: { type: 'array', items: { type: 'string' } }, found: { type: 'array' }, count: { type: 'integer' }, earliest: { type: 'string' }, latest: { type: 'string' } } },
  examples: [
    { text: 'get the times from this message', input: { text: 'the meeting is 9:30am and lunch at 1pm' },
      output: { times: ['09:30', '13:00'], found: [{ text: '9:30am', time: '09:30' }, { text: '1pm', time: '13:00' }], count: 2, earliest: '09:30', latest: '13:00' } },
    { text: 'find the clock times in this line', input: { text: 'doors 19:00, curtain 19:45' },
      output: { times: ['19:00', '19:45'], found: [{ text: '19:00', time: '19:00' }, { text: '19:45', time: '19:45' }], count: 2, earliest: '19:00', latest: '19:45' } },
    { text: 'extract times written with a dot', input: { text: 'train at 7.15am' },
      output: { times: ['07:15'], found: [{ text: '7.15am', time: '07:15' }], count: 1, earliest: '07:15', latest: '07:15' } },
    { text: 'pull midnight and noon', input: { text: 'from 12:00am to 12:00pm' },
      output: { times: ['00:00', '12:00'], found: [{ text: '12:00am', time: '00:00' }, { text: '12:00pm', time: '12:00' }], count: 2, earliest: '00:00', latest: '12:00' } },
    { text: 'any times in this sentence', input: { text: 'no clock times written here' },
      output: { times: [], found: [], count: 0, earliest: '', latest: '' } }
  ],
  errorCases: [
    { input: {}, code: 'MISSING_FIELD' },
    { input: { text: '' }, code: 'MISSING_FIELD' },
    { input: { text: ['9am'] }, code: 'INVALID_INPUT' }
  ],
  run (input) {
    const found = [];
    /* Bare "1pm" counts, but a bare "13" does not — a lone number is far more
       often a quantity than a time, and guessing would flood a log with
       false hits. A time needs either a separator or an am/pm. */
    const re = /\b(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)\b|\b(\d{1,2}):(\d{2})\b/gi;
    for (const m of input.text.matchAll(re)) {
      let h, mi;
      if (m[3]) {
        h = Number(m[1]); mi = Number(m[2] ?? 0);
        if (h < 1 || h > 12 || mi > 59) continue;
        h = (h % 12) + (m[3].toLowerCase() === 'pm' ? 12 : 0);
      } else {
        h = Number(m[4]); mi = Number(m[5]);
        if (h > 23 || mi > 59) continue;
      }
      const pad = (n) => String(n).padStart(2, '0');
      found.push({ text: m[0], time: `${pad(h)}:${pad(mi)}` });
    }
    const times = found.map(f => f.time);
    const sorted = [...times].sort();
    return ok({
      times, found, count: found.length,
      earliest: sorted[0] ?? '', latest: sorted[sorted.length - 1] ?? ''
    }, computed());
  }
};
