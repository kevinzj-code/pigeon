import { ok, fail, computed } from '../src/contracts.js';
import { words, sentences, STOP_WORDS, stem } from '../src/lib/text.js';
import { round } from '../src/lib/num.js';

export default {
  name: 'keywordsTfidf',
  description: 'Pull the most distinctive words out of a document.',
  category: 'text', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  title: 'Find keywords',
  replyTemplate: '{{count}} {{count|plural:keyword:keywords}} from {{wordCount}} words, scored against {{corpusSize}} {{corpusSize|plural:section:sections}}: {{lines|list}}.',
  inputSchema: {
    type: 'object', required: ['text'],
    properties: {
      text: { type: 'string', label: 'text', minLength: 1, maxLength: 100000, prompt: 'Which text should I pull keywords from?' },
      limit: { type: 'integer', label: 'how many keywords', minimum: 1, maximum: 50, default: 8 },
      corpus: { type: 'array', label: 'other documents', maxItems: 200, items: { type: 'string' }, description: 'other documents to score against - the text is split into its own sections if none are given' }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      keywords: { type: 'array' }, lines: { type: 'array', items: { type: 'string' } },
      count: { type: 'integer' }, wordCount: { type: 'integer' }, corpusSize: { type: 'integer' }
    }
  },
  examples: [
    { text: 'pull the keywords out of this', input: { text: 'The pigeon carried the message. Pigeons have carried messages for centuries. The message arrived safely.', limit: 4 }, output: { keywords: [{ word: 'message', count: 3, score: 0.3, inSections: 3 }, { word: 'carried', count: 2, score: 0.2811, inSections: 2 }, { word: 'pigeon', count: 2, score: 0.2811, inSections: 2 }, { word: 'arrived', count: 1, score: 0.2099, inSections: 1 }], lines: ['message (0.3)', 'carried (0.2811)', 'pigeon (0.2811)', 'arrived (0.2099)'], count: 4, wordCount: 10, corpusSize: 3 } },
    { text: 'what are the main topics here', input: { text: 'Solar panels convert sunlight into electricity. Wind turbines convert wind into electricity. Both are renewable.', limit: 4 }, output: { keywords: [{ word: 'wind', count: 2, score: 0.3229, inSections: 1 }, { word: 'convert', count: 2, score: 0.2162, inSections: 2 }, { word: 'electricity', count: 2, score: 0.2162, inSections: 2 }, { word: 'into', count: 2, score: 0.2162, inSections: 2 }], lines: ['wind (0.3229)', 'convert (0.2162)', 'electricity (0.2162)', 'into (0.2162)'], count: 4, wordCount: 13, corpusSize: 3 } },
    { text: 'keywords from this paragraph', input: { text: 'Coffee is grown in tropical regions. The beans are roasted before brewing. Roasting develops the flavour.', limit: 3 }, output: { keywords: [{ word: 'roasted', count: 2, score: 0.2555, inSections: 2 }, { word: 'beans', count: 1, score: 0.1908, inSections: 1 }, { word: 'before', count: 1, score: 0.1908, inSections: 1 }], lines: ['roasted (0.2555)', 'beans (0.1908)', 'before (0.1908)'], count: 3, wordCount: 11, corpusSize: 3 } },
    { text: 'find the distinctive words', input: { text: 'Cats sleep a lot. Dogs run a lot. Birds fly a lot.', limit: 3 }, output: { keywords: [{ word: 'lot', count: 3, score: 0.3333, inSections: 3 }, { word: 'birds', count: 1, score: 0.2332, inSections: 1 }, { word: 'cats', count: 1, score: 0.2332, inSections: 1 }], lines: ['lot (0.3333)', 'birds (0.2332)', 'cats (0.2332)'], count: 3, wordCount: 9, corpusSize: 3 } },
    { text: 'keywords scored against other documents', input: { text: 'machine learning models need training data', limit: 3, corpus: ['machine learning models need training data', 'cooking recipes need ingredients', 'gardening needs patience'] }, output: { keywords: [{ word: 'data', count: 1, score: 0.3498, inSections: 1 }, { word: 'learning', count: 1, score: 0.3498, inSections: 1 }, { word: 'machine', count: 1, score: 0.3498, inSections: 1 }], lines: ['data (0.3498)', 'learning (0.3498)', 'machine (0.3498)'], count: 3, wordCount: 6, corpusSize: 3 } }
  ],
  errorCases: [
    { input: { text: 'the and of to' }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' },
    { input: { text: '' }, code: 'MISSING_FIELD' }
  ],
  run (input) {
    /* TF-IDF needs a corpus to be inverse-document-frequency of ANYTHING. With
       no other documents supplied, the text's own sentences are the corpus: a
       word in every sentence is the document's subject and scores low, a word
       in one sentence is distinctive to it. The reply says which corpus was
       used, because the two give quite different answers. */
    const documents = input.corpus?.length ? input.corpus : sentences(input.text);
    if (documents.length < 2) {
      return fail('INVALID_INPUT', 'One sentence with nothing to compare it against has no distinctive words — give me more text, or a corpus to score against.', 'text');
    }

    const tokens = words(input.text).map((w) => w.toLowerCase()).filter((w) => w.length > 2 && !STOP_WORDS.has(w));
    if (!tokens.length) return fail('INVALID_INPUT', 'That is all stop words — there is nothing distinctive to pull out.', 'text');

    /* Counted by stem, reported by the commonest spelling: "running" and "runs"
       are one keyword, and showing the stem "run" back would be showing the
       reader something they did not write. */
    const byStem = new Map();
    for (const token of tokens) {
      const key = stem(token);
      if (!byStem.has(key)) byStem.set(key, { count: 0, forms: new Map() });
      const entry = byStem.get(key);
      entry.count++;
      entry.forms.set(token, (entry.forms.get(token) ?? 0) + 1);
    }

    const docStems = documents.map((d) => new Set(words(d).map((w) => stem(w.toLowerCase()))));
    const keywords = [...byStem.entries()].map(([key, entry]) => {
      const appearsIn = docStems.filter((s) => s.has(key)).length || 1;
      const tf = entry.count / tokens.length;
      const idf = Math.log(documents.length / appearsIn) + 1;
      const word = [...entry.forms.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
      return { word, count: entry.count, score: round(tf * idf, 4), inSections: appearsIn };
    });

    keywords.sort((a, b) => b.score - a.score || b.count - a.count || a.word.localeCompare(b.word));
    const top = keywords.slice(0, input.limit);

    return ok({
      keywords: top, lines: top.map((k) => `${k.word} (${k.score})`),
      count: top.length, wordCount: tokens.length, corpusSize: documents.length
    }, computed());
  }
};
