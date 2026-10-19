import { ok, fail, computed } from '../src/contracts.js';

const UNITS = [
  ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60], ['second', 1]
];
const SHORT = { week: 'w', day: 'd', hour: 'h', minute: 'm', second: 's' };

export default {
  name: 'durationToText',
  description: 'Turn a raw number of seconds into readable words like "1h 30m".',
  category: 'dates',
  tier: 'core',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  title: 'Seconds in words',
  replyTemplate: '{{seconds|comma}} seconds is {{text}}.',
  inputSchema: {
    type: 'object',
    required: ['seconds'],
    properties: {
      seconds: { type: 'number', label: 'seconds', carry: true, minimum: 0, prompt: 'How many seconds?' },
      style: { type: 'string', label: 'style', enum: ['short', 'long'], default: 'short' },
      maxUnits: { type: 'integer', label: 'most units shown', minimum: 1, maximum: 5, default: 2 }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      text: { type: 'string' }, seconds: { type: 'number' },
      parts: { type: 'array', items: { type: 'string' } }, style: { type: 'string' }
    }
  },
  examples: [
    { text: 'what is 5400 seconds as a duration', input: { seconds: 5400 },
      output: { text: '1h 30m', seconds: 5400, parts: ['1h', '30m'], style: 'short' } },
    { text: 'how long is 90 seconds in words', input: { seconds: 90, style: 'long' },
      output: { text: '1 minute 30 seconds', seconds: 90, parts: ['1 minute', '30 seconds'], style: 'long' } },
    { text: 'express 100000 seconds readably', input: { seconds: 100000 },
      output: { text: '1d 3h', seconds: 100000, parts: ['1d', '3h'], style: 'short' } },
    { text: 'show 3661 seconds with three units', input: { seconds: 3661, maxUnits: 3 },
      output: { text: '1h 1m 1s', seconds: 3661, parts: ['1h', '1m', '1s'], style: 'short' } },
    { text: 'what is 45 seconds', input: { seconds: 45 },
      output: { text: '45s', seconds: 45, parts: ['45s'], style: 'short' } }
  ],
  errorCases: [
    { input: { seconds: -10 }, code: 'INVALID_INPUT' },
    { input: { seconds: 'a while' }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' }
  ],
  run (input) {
    if (!Number.isFinite(input.seconds)) return fail('INVALID_INPUT', 'That is not a number of seconds.', 'seconds');
    let left = Math.round(input.seconds);
    if (left === 0) {
      return ok({ text: input.style === 'long' ? '0 seconds' : '0s', seconds: input.seconds, parts: [], style: input.style }, computed());
    }

    const parts = [];
    for (const [name, size] of UNITS) {
      if (parts.length >= input.maxUnits) break;
      const n = Math.floor(left / size);
      /* Skip a unit that is zero UNLESS something bigger already appeared —
         "1h 0m 5s" is noise, but the leading zeros have to go entirely, not
         count against maxUnits. */
      if (n === 0) continue;
      left -= n * size;
      parts.push(input.style === 'long' ? `${n} ${name}${n === 1 ? '' : 's'}` : `${n}${SHORT[name]}`);
    }
    return ok({ text: parts.join(' '), seconds: input.seconds, parts, style: input.style }, computed());
  }
};
