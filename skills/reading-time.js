import { ok, computed } from '../src/contracts.js';
import { words } from '../src/lib/text.js';
import { round } from '../src/lib/num.js';

export default {
  name: 'readingTime',
  description: 'How long a text takes to read or to say aloud, at a words-per-minute rate you set.',
  category: 'text',
  tier: 'core',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: ['estimate'],
  replyTemplate: 'About {{text}} to read at {{wpm}} words a minute — {{words|comma}} words.',
  inputSchema: {
    type: 'object',
    required: ['text'],
    properties: {
      text: { type: 'string', label: 'text', minLength: 1, prompt: 'Which text should I time?' },
      /* 238 wpm is the mean from Brysbaert's 2019 meta-analysis of silent
         reading in English. It is a DEFAULT, not a claim about this reader —
         hence the label, and hence the reply naming the rate it used. */
      wpm: { type: 'integer', label: 'words per minute', minimum: 30, maximum: 2000, default: 238 }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      minutes: { type: 'number' }, seconds: { type: 'integer' }, text: { type: 'string' },
      words: { type: 'integer' }, wpm: { type: 'integer' }
    }
  },
  examples: [
    { text: 'how long will this take to read', input: { text: 'a '.repeat(500).trim() },
      output: { minutes: 2.1, seconds: 126, text: '2 min 6 sec', words: 500, wpm: 238 } },
    { text: 'reading time for a short note', input: { text: 'Meeting moved to Thursday at three.' },
      output: { minutes: 0.03, seconds: 2, text: '2 sec', words: 6, wpm: 238 } },
    { text: 'how long to read this out loud at 150 wpm', input: { text: 'word '.repeat(300).trim(), wpm: 150 },
      output: { minutes: 2, seconds: 120, text: '2 min', words: 300, wpm: 150 } },
    { text: 'reading time at 200 words a minute', input: { text: 'x '.repeat(1000).trim(), wpm: 200 },
      output: { minutes: 5, seconds: 300, text: '5 min', words: 1000, wpm: 200 } },
    { text: 'how long is this article to read', input: { text: 'w '.repeat(1785).trim() },
      output: { minutes: 7.5, seconds: 450, text: '7 min 30 sec', words: 1785, wpm: 238 } }
  ],
  errorCases: [
    { input: {}, code: 'MISSING_FIELD' },
    { input: { text: 'hello', wpm: 5 }, code: 'INVALID_INPUT' },
    { input: { text: 'hello', wpm: 'fast' }, code: 'INVALID_INPUT' }
  ],
  run (input) {
    const count = words(input.text).length;
    const seconds = Math.max(1, Math.round(count / input.wpm * 60));
    const mins = Math.floor(seconds / 60);
    const rem = seconds % 60;
    return ok({
      minutes: round(count / input.wpm, 2),
      seconds,
      text: mins ? (rem ? `${mins} min ${rem} sec` : `${mins} min`) : `${rem} sec`,
      words: count, wpm: input.wpm
    }, computed());
  }
};
