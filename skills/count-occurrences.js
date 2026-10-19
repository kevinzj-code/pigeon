import { ok, fail, computed } from '../src/contracts.js';

export default {
  name: 'countOccurrences',
  description: 'Count how many times one word or phrase repeats inside a text.',
  category: 'text',
  tier: 'core',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '"{{needle}}" appears {{count}} {{count|plural:time:times}}.',
  inputSchema: {
    type: 'object',
    required: ['text', 'needle'],
    properties: {
      text: { type: 'string', label: 'text', minLength: 1, prompt: 'Which text should I search?' },
      needle: { type: 'string', label: 'what to count', minLength: 1, prompt: 'What should I count?' },
      caseSensitive: { type: 'boolean', label: 'match case', default: false },
      wholeWord: { type: 'boolean', label: 'whole words only', default: false }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      count: { type: 'integer' }, needle: { type: 'string' },
      positions: { type: 'array', items: { type: 'integer' } }, caseSensitive: { type: 'boolean' }
    }
  },
  examples: [
    { text: 'how many times does "the" appear in this', input: { text: 'the cat sat on the mat', needle: 'the' },
      output: { count: 2, needle: 'the', positions: [0, 15], caseSensitive: false } },
    { text: 'count how often "error" shows up in the log', input: { text: 'error: one\nwarn: two\nerror: three', needle: 'error' },
      output: { count: 2, needle: 'error', positions: [0, 21], caseSensitive: false } },
    { text: 'count Cat case-sensitively', input: { text: 'Cat cat CAT', needle: 'Cat', caseSensitive: true },
      output: { count: 1, needle: 'Cat', positions: [0], caseSensitive: true } },
    { text: 'count whole words only, not parts of words', input: { text: 'art started in the art room', needle: 'art', wholeWord: true },
      output: { count: 2, needle: 'art', positions: [0, 19], caseSensitive: false } },
    { text: 'how many times does zebra appear', input: { text: 'no such animal here', needle: 'zebra' },
      output: { count: 0, needle: 'zebra', positions: [], caseSensitive: false } }
  ],
  errorCases: [
    { input: { text: 'hello' }, code: 'MISSING_FIELD' },
    { input: { needle: 'a' }, code: 'MISSING_FIELD' },
    { input: { text: 'hello', needle: '' }, code: 'MISSING_FIELD' }
  ],
  run (input) {
    /* Always a literal search — the needle is what the user typed, not a
       pattern. replaceText is where regular expressions belong. */
    const escaped = input.needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const body = input.wholeWord ? `\\b${escaped}\\b` : escaped;
    let re;
    try { re = new RegExp(body, `g${input.caseSensitive ? '' : 'i'}`); }
    catch (e) { return fail('INVALID_INPUT', `I couldn't search for that: ${e.message}`, 'needle'); }

    const positions = [];
    for (const m of input.text.matchAll(re)) positions.push(m.index);
    return ok({
      count: positions.length, needle: input.needle, positions,
      caseSensitive: input.caseSensitive
    }, computed());
  }
};
