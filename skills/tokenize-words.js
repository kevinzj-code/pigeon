import { ok, computed } from '../src/contracts.js';
import { words } from '../src/lib/text.js';

/* The tokeniser the other text skills use, exposed as a skill in its own right
   so a plan can split once and pass the tokens on with $ref rather than every
   downstream step re-splitting the same string. */
export default {
  name: 'tokenizeWords',
  description: "Break a sentence at its spaces into separate words.",
  category: 'text',
  tier: 'core',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{count}} {{count|plural:token:tokens}}: {{tokens|list}}',
  inputSchema: {
    type: 'object',
    required: ['text'],
    properties: {
      text: { type: 'string', label: 'text', minLength: 1, prompt: 'Which text should I split?' },
      lowercase: { type: 'boolean', label: 'lowercase', default: false },
      unique: { type: 'boolean', label: 'remove duplicates', default: false }
    }
  },
  outputSchema: {
    type: 'object',
    properties: { tokens: { type: 'array', items: { type: 'string' } }, count: { type: 'integer' }, unique: { type: 'integer' } }
  },
  examples: [
    { text: 'split this into words', input: { text: 'The quick brown fox' },
      output: { tokens: ['The', 'quick', 'brown', 'fox'], count: 4, unique: 4 } },
    { text: 'tokenise keeping the apostrophe', input: { text: "don't stop believing" },
      output: { tokens: ["don't", 'stop', 'believing'], count: 3, unique: 3 } },
    { text: 'split into lowercase word tokens', input: { text: 'Red Green RED', lowercase: true },
      output: { tokens: ['red', 'green', 'red'], count: 3, unique: 2 } },
    { text: 'unique word tokens only', input: { text: 'go go go team', unique: true },
      output: { tokens: ['go', 'team'], count: 2, unique: 2 } },
    { text: 'tokenise a hyphenated phrase', input: { text: 'a state-of-the-art design' },
      output: { tokens: ['a', 'state-of-the-art', 'design'], count: 3, unique: 3 } }
  ],
  errorCases: [
    { input: {}, code: 'MISSING_FIELD' },
    { input: { text: '' }, code: 'MISSING_FIELD' },
    { input: { text: ['a'] }, code: 'INVALID_INPUT' }
  ],
  run (input) {
    let tokens = words(input.text);
    if (input.lowercase) tokens = tokens.map(w => w.toLowerCase());
    /* Counted as the list is de-duplicated: case-sensitively, unless lowercase
       already folded it. */
    const uniqueCount = new Set(tokens).size;
    if (input.unique) tokens = [...new Set(tokens)];
    return ok({ tokens, count: tokens.length, unique: uniqueCount }, computed());
  }
};
