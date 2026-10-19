import { ok, computed } from '../src/contracts.js';

/* Articles, coordinating conjunctions and short prepositions stay lowercase
   unless they open or close the title. This is the common newspaper/Chicago
   rule; other style guides draw the preposition line at four or five letters
   instead, which is why the skill reports what it did rather than claiming
   there is one right answer. */
const MINOR = new Set('a an the and as at but by for in nor of on or per to up via vs'.split(' '));

export default {
  name: 'checkTitleCase',
  description: 'Check a title against title-case rules and show which words were wrong.',
  category: 'writing', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{titleCased|prose}}{{note|prose}}',
  inputSchema: {
    type: 'object', required: ['text'],
    properties: { text: { type: 'string', label: 'title', minLength: 1, maxLength: 500, prompt: 'Which title should I check?' } }
  },
  outputSchema: {
    type: 'object',
    properties: {
      titleCased: { type: 'string' }, alreadyCorrect: { type: 'boolean' },
      changes: { type: 'array', items: { type: 'string' } }, changeCount: { type: 'integer' },
      note: { type: 'string' }
    }
  },
  examples: [
    { text: 'put this in title case', input: { text: 'the lord of the rings' }, output: { titleCased: 'The Lord of the Rings', alreadyCorrect: false, changes: ['the → The', 'lord → Lord', 'rings → Rings'], changeCount: 3, note: ' — 3 words changed.' } },
    { text: 'title case a tale of two cities', input: { text: 'a tale of two cities' }, output: { titleCased: 'A Tale of Two Cities', alreadyCorrect: false, changes: ['a → A', 'tale → Tale', 'two → Two', 'cities → Cities'], changeCount: 4, note: ' — 4 words changed.' } },
    { text: 'is this title correctly capitalised', input: { text: 'To Kill a Mockingbird' }, output: { titleCased: 'To Kill a Mockingbird', alreadyCorrect: true, changes: [], changeCount: 0, note: ' — already correct.' } },
    { text: 'fix the capitals in this heading', input: { text: 'THE OLD MAN AND THE SEA' }, output: { titleCased: 'The Old Man and the Sea', alreadyCorrect: false, changes: ['THE → The', 'OLD → Old', 'MAN → Man', 'AND → and', 'THE → the', 'SEA → Sea'], changeCount: 6, note: ' — 6 words changed.' } },
    { text: 'title case gone with the wind', input: { text: 'gone with the wind' }, output: { titleCased: 'Gone With the Wind', alreadyCorrect: false, changes: ['gone → Gone', 'with → With', 'wind → Wind'], changeCount: 3, note: ' — 3 words changed.' } }
  ],
  errorCases: [
    { input: {}, code: 'MISSING_FIELD' },
    { input: { text: '' }, code: 'MISSING_FIELD' },
    { input: { text: 'x'.repeat(600) }, code: 'INVALID_INPUT' }
  ],
  run (input) {
    const words = String(input.text).trim().split(/\s+/);
    const changes = [];
    const out = words.map((word, i) => {
      const bare = word.toLowerCase();
      const isEdge = i === 0 || i === words.length - 1;
      const cased = !isEdge && MINOR.has(bare.replace(/[^a-z]/g, ''))
        ? bare
        : bare.charAt(0).toUpperCase() + bare.slice(1);
      if (cased !== word) changes.push(`${word} → ${cased}`);
      return cased;
    });

    return ok({
      titleCased: out.join(' '), alreadyCorrect: changes.length === 0,
      changes, changeCount: changes.length,
      note: changes.length ? ` — ${changes.length} words changed.` : ' — already correct.'
    }, computed());
  }
};
