import { ok, computed } from '../src/contracts.js';

export default {
  name: 'extractHashtags',
  description: "Gather the #tags used in a post.",
  category: 'text', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{count}} {{count|plural:hashtag:hashtags}}: {{hashtags|list}}',
  inputSchema: {
    type: 'object', required: ['text'],
    properties: {
      text: { type: 'string', label: 'text', minLength: 1, prompt: 'Which text should I search?' },
      unique: { type: 'boolean', label: 'remove duplicates', default: true },
      lowercase: { type: 'boolean', label: 'lowercase', default: false }
    }
  },
  outputSchema: { type: 'object', properties: { hashtags: { type: 'array', items: { type: 'string' } }, count: { type: 'integer' }, withoutHash: { type: 'array', items: { type: 'string' } } } },
  examples: [
    { text: 'get the hashtags from this post', input: { text: 'Shipping today #buildinpublic #indiedev' }, output: { hashtags: ['#buildinpublic', '#indiedev'], count: 2, withoutHash: ['buildinpublic', 'indiedev'] } },
    { text: 'find the tags in this caption', input: { text: 'sunset over the bay #photography #golden_hour' }, output: { hashtags: ['#photography', '#golden_hour'], count: 2, withoutHash: ['photography', 'golden_hour'] } },
    { text: 'extract hashtags ignoring a hex colour', input: { text: 'brand colour is #FF5733 and the tag is #design' }, output: { hashtags: ['#FF5733', '#design'], count: 2, withoutHash: ['FF5733', 'design'] } },
    { text: 'hashtags with duplicates kept', input: { text: '#a #b #a', unique: false }, output: { hashtags: ['#a', '#b', '#a'], count: 3, withoutHash: ['a', 'b', 'a'] } },
    { text: 'any hashtags in this sentence', input: { text: 'no tags here at all' }, output: { hashtags: [], count: 0, withoutHash: [] } }
  ],
  errorCases: [
    { input: {}, code: 'MISSING_FIELD' },
    { input: { text: '' }, code: 'MISSING_FIELD' },
    { input: { text: ['#a'] }, code: 'INVALID_INPUT' }
  ],
  run (input) {
    /* A hashtag must not be preceded by a word character, so "C#code" is not a
       tag. Hex colours like #FF5733 ARE matched — they are indistinguishable
       from a tag by shape alone, and silently dropping them would lose real
       tags that happen to be hex-like. */
    let found = input.text.match(/(?<![\w#])#[\p{L}\p{N}_]+/gu) ?? [];
    if (input.lowercase) found = found.map(t => t.toLowerCase());
    if (input.unique) found = [...new Set(found)];
    return ok({ hashtags: found, count: found.length, withoutHash: found.map(t => t.slice(1)) }, computed());
  }
};
