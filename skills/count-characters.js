import { ok, computed } from '../src/contracts.js';

/* Separate from countWords because "will this fit in a tweet" and "how long is
   this essay" are different questions with different units, and §5's naming
   note is explicit that one skill does one job. */
export default {
  name: 'countCharacters',
  description: 'Count the characters in a text — with spaces, without spaces, and how many are letters or digits.',
  category: 'text',
  tier: 'core',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{characters|comma}} characters ({{withoutSpaces|comma}} without spaces).',
  inputSchema: {
    type: 'object',
    required: ['text'],
    properties: { text: { type: 'string', label: 'text', prompt: 'Which text should I measure?' } }
  },
  outputSchema: {
    type: 'object',
    properties: {
      characters: { type: 'integer' }, withoutSpaces: { type: 'integer' },
      letters: { type: 'integer' }, digits: { type: 'integer' },
      punctuation: { type: 'integer' }, whitespace: { type: 'integer' }
    }
  },
  examples: [
    { text: 'how many characters is this', input: { text: 'The quick brown fox.' },
      output: { characters: 20, withoutSpaces: 17, letters: 16, digits: 0, punctuation: 1, whitespace: 3 } },
    { text: 'character count with spaces and without', input: { text: 'hello world' },
      output: { characters: 11, withoutSpaces: 10, letters: 10, digits: 0, punctuation: 0, whitespace: 1 } },
    { text: 'will this fit in 280 characters', input: { text: 'Shipping the thing at 5pm — 2 blockers left, both small.' },
      output: { characters: 56, withoutSpaces: 46, letters: 41, digits: 2, punctuation: 3, whitespace: 10 } },
    { text: 'count the characters in a number-heavy line', input: { text: 'Order 12345 total 99.50' },
      output: { characters: 23, withoutSpaces: 20, letters: 10, digits: 9, punctuation: 1, whitespace: 3 } },
    { text: 'how long is a single word', input: { text: 'antidisestablishmentarianism' },
      output: { characters: 28, withoutSpaces: 28, letters: 28, digits: 0, punctuation: 0, whitespace: 0 } }
  ],
  errorCases: [
    { input: {}, code: 'MISSING_FIELD' },
    { input: { text: ['a'] }, code: 'INVALID_INPUT' },
    { input: { text: { a: 1 } }, code: 'INVALID_INPUT' }
  ],
  run (input) {
    const t = input.text;
    /* Unicode-aware classes, so an accented letter counts as a letter and an
       em-dash counts as punctuation rather than "other". */
    const count = (re) => (t.match(re) ?? []).length;
    return ok({
      characters: [...t].length,
      withoutSpaces: t.replace(/\s/g, '').length,
      letters: count(/\p{L}/gu),
      digits: count(/\p{Nd}/gu),
      punctuation: count(/[\p{P}\p{S}]/gu),
      whitespace: count(/\s/g)
    }, computed());
  }
};
