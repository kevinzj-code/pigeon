import { ok, fail, computed } from '../src/contracts.js';
import { words } from '../src/lib/text.js';

export default {
  name: 'truncateText',
  description: 'Cut text off at a maximum length and end it with an ellipsis.',
  category: 'text',
  tier: 'core',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{result}}',
  inputSchema: {
    type: 'object',
    required: ['text', 'limit'],
    properties: {
      text: { type: 'string', label: 'text', minLength: 1, prompt: 'Which text should I shorten?' },
      limit: { type: 'integer', label: 'max length', minimum: 1, prompt: 'Shorten it to how many?' },
      unit: { type: 'string', label: 'characters or words', enum: ['characters', 'words'], default: 'characters' },
      ellipsis: { type: 'string', label: 'ellipsis', default: '…' },
      breakWords: { type: 'boolean', label: 'cut mid-word', default: false, description: 'allow cutting in the middle of a word' }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      result: { type: 'string' }, truncated: { type: 'boolean' },
      length: { type: 'integer' }, originalLength: { type: 'integer' }, unit: { type: 'string' }
    }
  },
  examples: [
    { text: 'shorten this to 20 characters', input: { text: 'The quick brown fox jumps over the lazy dog', limit: 20 },
      output: { result: 'The quick brown fox…', truncated: true, length: 20, originalLength: 43, unit: 'characters' } },
    { text: 'cut this down to 5 words', input: { text: 'one two three four five six seven', limit: 5, unit: 'words' },
      output: { result: 'one two three four five…', truncated: true, length: 24, originalLength: 33, unit: 'words' } },
    { text: 'truncate a string already short enough', input: { text: 'short', limit: 20 },
      output: { result: 'short', truncated: false, length: 5, originalLength: 5, unit: 'characters' } },
    { text: 'shorten to 10 chars with a custom ellipsis', input: { text: 'abcdefghijklmnop', limit: 10, ellipsis: '...' },
      output: { result: 'abcdefg...', truncated: true, length: 10, originalLength: 16, unit: 'characters' } },
    { text: 'truncate mid-word if it has to', input: { text: 'antidisestablishmentarianism', limit: 8, breakWords: true },
      output: { result: 'antidis…', truncated: true, length: 8, originalLength: 28, unit: 'characters' } }
  ],
  errorCases: [
    { input: { text: 'hello' }, code: 'MISSING_FIELD' },
    { input: { text: 'hello', limit: 0 }, code: 'INVALID_INPUT' },
    { input: { text: 'hello', limit: 2, ellipsis: 'far too long an ellipsis' }, code: 'INVALID_INPUT' }
  ],
  run (input) {
    const el = input.ellipsis;
    const original = input.text;

    if (input.unit === 'words') {
      const w = words(original);
      if (w.length <= input.limit) {
        return ok({ result: original, truncated: false, length: original.length, originalLength: original.length, unit: 'words' }, computed());
      }
      /* Cut at the START of the word after the limit, so the kept words keep
         whatever punctuation and spacing they had in the original. */
      let seen = 0, cut = original.length;
      const re = /[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu;
      for (const m of original.matchAll(re)) {
        seen += 1;
        if (seen === input.limit) { cut = m.index + m[0].length; break; }
      }
      const result = original.slice(0, cut) + el;
      return ok({ result, truncated: true, length: result.length, originalLength: original.length, unit: 'words' }, computed());
    }

    /* The ellipsis counts toward the limit — "no more than 20 characters" has
       to mean the string it hands back, not the string before decoration. */
    if (el.length >= input.limit) {
      return fail('INVALID_INPUT', `The ellipsis is ${el.length} characters and the limit is ${input.limit}, so there would be nothing left of the text.`, 'ellipsis');
    }
    if (original.length <= input.limit) {
      return ok({ result: original, truncated: false, length: original.length, originalLength: original.length, unit: 'characters' }, computed());
    }
    const cutAt = input.limit - el.length;
    let body = original.slice(0, cutAt);
    /* Only back off to the previous space when the cut ACTUALLY lands inside a
       word. Backing off unconditionally threw away a whole word every time the
       limit happened to fall on a space — "The quick brown fox…" came out as
       "The quick brown…" and four characters of the budget went unused. */
    if (!input.breakWords && !/\s/.test(original[cutAt] ?? ' ')) {
      const space = body.lastIndexOf(' ');
      if (space > 0) body = body.slice(0, space);
    }
    const result = body.trimEnd() + el;
    return ok({ result, truncated: true, length: result.length, originalLength: original.length, unit: 'characters' }, computed());
  }
};
