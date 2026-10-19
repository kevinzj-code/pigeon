import { ok, computed } from '../src/contracts.js';

export default {
  name: 'extractMentions',
  description: "Gather the @handles somebody was tagged as.",
  category: 'text', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{count}} {{count|plural:mention:mentions}}: {{mentions|list}}',
  inputSchema: {
    type: 'object', required: ['text'],
    properties: {
      text: { type: 'string', label: 'text', minLength: 1, prompt: 'Which text should I search?' },
      unique: { type: 'boolean', label: 'remove duplicates', default: true }
    }
  },
  outputSchema: { type: 'object', properties: { mentions: { type: 'array', items: { type: 'string' } }, count: { type: 'integer' }, handles: { type: 'array', items: { type: 'string' } } } },
  examples: [
    { text: 'who is mentioned in this post', input: { text: 'thanks @ana and @bo for the help' }, output: { mentions: ['@ana', '@bo'], count: 2, handles: ['ana', 'bo'] } },
    { text: 'get the handles from this thread', input: { text: '@team_lead please review, cc @qa.bot' }, output: { mentions: ['@team_lead', '@qa.bot'], count: 2, handles: ['team_lead', 'qa.bot'] } },
    { text: 'extract mentions but not the email address', input: { text: 'email ana@example.com or ping @ana' }, output: { mentions: ['@ana'], count: 1, handles: ['ana'] } },
    { text: 'mentions with duplicates kept', input: { text: '@a @b @a', unique: false }, output: { mentions: ['@a', '@b', '@a'], count: 3, handles: ['a', 'b', 'a'] } },
    { text: 'any mentions in this line', input: { text: 'nobody is mentioned here' }, output: { mentions: [], count: 0, handles: [] } }
  ],
  errorCases: [
    { input: {}, code: 'MISSING_FIELD' },
    { input: { text: '' }, code: 'MISSING_FIELD' },
    { input: { text: ['@a'] }, code: 'INVALID_INPUT' }
  ],
  run (input) {
    /* The lookbehind is what keeps an email address out: in "ana@example.com"
       the @ follows a word character, so it is not a mention. Without it this
       skill would report every email local-part's domain as a handle. */
    let found = input.text.match(/(?<![\w@.])@[\p{L}\p{N}_]+(?:\.[\p{L}\p{N}_]+)*/gu) ?? [];
    if (input.unique) found = [...new Set(found)];
    return ok({ mentions: found, count: found.length, handles: found.map(m => m.slice(1)) }, computed());
  }
};
