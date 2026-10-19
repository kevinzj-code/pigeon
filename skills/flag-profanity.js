import { ok, computed } from '../src/contracts.js';
import { PROFANITY } from '../src/lib/lexicons.js';

const LIST = new Set(PROFANITY);

export default {
  name: 'flagProfanity',
  description: 'Flag swear words in text against a word list.',
  category: 'text', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null,
  /* A word list, and nothing more. It cannot tell an insult from a quotation,
     it misses anything spelled around it, and it will flag Scunthorpe-style
     false positives in longer words - which is why matching is word-boundary
     only and the reply says what the check is. */
  labels: ['lexicon'],
  replyTemplate: '{{count}} flagged {{count|plural:word:words}} out of {{wordCount}}: {{found|list}}. This matches a word list — it cannot tell a quotation from an insult.',
  inputSchema: {
    type: 'object', required: ['text'],
    properties: { text: { type: 'string', label: 'text', minLength: 1, maxLength: 100000, prompt: 'Which text should I check?' } }
  },
  outputSchema: {
    type: 'object',
    properties: {
      found: { type: 'array', items: { type: 'string' } }, matches: { type: 'array' },
      count: { type: 'integer' }, wordCount: { type: 'integer' }, clean: { type: 'boolean' },
      listSize: { type: 'integer' }
    }
  },
  examples: [
    { text: 'check this for swearing', input: { text: 'What a bloody mess this is' }, output: { found: ['bloody'], matches: [{ word: 'bloody', at: 3 }], count: 1, wordCount: 6, clean: false, listSize: 27 } },
    { text: 'is there profanity in this text', input: { text: 'A perfectly polite sentence about pigeons' }, output: { found: [], matches: [], count: 0, wordCount: 6, clean: true, listSize: 27 } },
    { text: 'flag rude words', input: { text: 'This damn thing is crap' }, output: { found: ['damn', 'crap'], matches: [{ word: 'damn', at: 2 }, { word: 'crap', at: 5 }], count: 2, wordCount: 5, clean: false, listSize: 27 } },
    { text: 'does this contain swearing inside longer words', input: { text: 'I visited Scunthorpe and Penistone' }, output: { found: [], matches: [], count: 0, wordCount: 5, clean: true, listSize: 27 } },
    { text: 'check a repeated swear word', input: { text: 'hell, what the hell' }, output: { found: ['hell', 'hell'], matches: [{ word: 'hell', at: 1 }, { word: 'hell', at: 4 }], count: 2, wordCount: 4, clean: false, listSize: 27 } }
  ],
  errorCases: [
    { input: {}, code: 'MISSING_FIELD' },
    { input: { text: '' }, code: 'MISSING_FIELD' },
    { input: { text: 'x'.repeat(100001) }, code: 'INVALID_INPUT' }
  ],
  run (input) {
    /* Word boundaries only. Substring matching is how a filter ends up refusing
       to let anyone say they live in Scunthorpe. */
    const tokens = String(input.text).toLowerCase().match(/[\p{L}']+/gu) ?? [];
    const matches = [];
    tokens.forEach((token, i) => { if (LIST.has(token)) matches.push({ word: token, at: i + 1 }); });

    return ok({
      found: matches.map((m) => m.word), matches,
      count: matches.length, wordCount: tokens.length,
      clean: matches.length === 0, listSize: LIST.size
    }, computed());
  }
};
