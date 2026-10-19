import { ok, fail, computed } from '../src/contracts.js';
import { LANGUAGE_STOPWORDS, LANGUAGE_HINTS } from '../src/lib/lexicons.js';
import { round } from '../src/lib/num.js';

const SETS = Object.fromEntries(Object.entries(LANGUAGE_STOPWORDS).map(([k, v]) => [k, new Set(v)]));

export default {
  name: 'detectLanguage',
  description: 'Guess which language a piece of text is written in.',
  category: 'text', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null,
  /* A stopword count is a guess, and a short or mixed sample makes it a weak
     one. The badge and the reply both say so. */
  labels: ['estimate', 'lexicon'],
  replyTemplate: '{{language}}, matching {{matched}} of {{wordCount}} words against its commonest function words. {{caveat|prose}}',
  inputSchema: {
    type: 'object', required: ['text'],
    properties: { text: { type: 'string', label: 'text', minLength: 1, maxLength: 20000, prompt: 'Which text should I identify?' } }
  },
  outputSchema: {
    type: 'object',
    properties: {
      language: { type: 'string' }, confidence: { type: 'number' }, matched: { type: 'integer' },
      wordCount: { type: 'integer' }, scores: { type: 'array' }, caveat: { type: 'string' }
    }
  },
  examples: [
    { text: 'what language is this', input: { text: 'The quick brown fox jumps over the lazy dog and then it goes to sleep' }, output: { language: 'English', confidence: 0.33, matched: 5, wordCount: 15, scores: [{ language: 'English', matched: 5 }, { language: 'Dutch', matched: 1 }, { language: 'French', matched: 0 }], caveat: 'This is a word-frequency guess, not a reliable identification.' } },
    { text: 'identify the language of this sentence', input: { text: 'Je ne sais pas ce que vous voulez dire par la' }, output: { language: 'French', confidence: 0.73, matched: 8, wordCount: 11, scores: [{ language: 'French', matched: 8 }, { language: 'Spanish', matched: 2 }, { language: 'Dutch', matched: 1 }], caveat: 'This is a word-frequency guess, not a reliable identification.' } },
    { text: 'which language is this written in', input: { text: 'Ich habe das Buch nicht gelesen und es ist mir auch nicht wichtig' }, output: { language: 'German', confidence: 0.54, matched: 7, wordCount: 13, scores: [{ language: 'German', matched: 7 }, { language: 'Portuguese', matched: 1 }, { language: 'Spanish', matched: 1 }], caveat: 'This is a word-frequency guess, not a reliable identification.' } },
    { text: 'detect the language', input: { text: 'No se lo que quieres decir con eso pero no es para tanto' }, output: { language: 'Spanish', confidence: 0.69, matched: 9, wordCount: 13, scores: [{ language: 'Spanish', matched: 9 }, { language: 'Portuguese', matched: 5 }, { language: 'French', matched: 2 }], caveat: 'This is a word-frequency guess, not a reliable identification.' } },
    { text: 'what language is a short phrase in', input: { text: 'buongiorno' }, output: { language: 'unknown', confidence: 0, matched: 0, wordCount: 1, scores: [], caveat: 'No function words matched, and one word is far too little to go on.' } }
  ],
  errorCases: [
    { input: {}, code: 'MISSING_FIELD' },
    { input: { text: '' }, code: 'MISSING_FIELD' },
    { input: { text: '12345 !!!' }, code: 'INVALID_INPUT' }
  ],
  run (input) {
    const tokens = String(input.text).toLowerCase().match(/[\p{L}']+/gu) ?? [];
    if (!tokens.length) return fail('INVALID_INPUT', 'There are no words in that to identify.', 'text');

    const scores = Object.entries(SETS)
      .map(([language, set]) => ({ language, matched: tokens.filter((t) => set.has(t)).length }))
      .sort((a, b) => b.matched - a.matched || a.language.localeCompare(b.language));

    const best = scores[0];
    if (best.matched === 0) {
      return ok({
        language: 'unknown', confidence: 0, matched: 0, wordCount: tokens.length, scores: [],
        caveat: `No function words matched, and ${tokens.length === 1 ? 'one word is' : `${tokens.length} words are`} far too little to go on.`
      }, computed());
    }

    /* A tie on function words is broken by characters only one of the tied
       languages uses. It settles the common Spanish/Portuguese and
       German/Dutch confusions without pretending to be more than a hint. */
    const tied = scores.filter((s) => s.matched === best.matched);
    const winner = tied.length > 1
      ? tied.find((s) => LANGUAGE_HINTS[s.language]?.test(input.text)) ?? best
      : best;

    return ok({
      language: winner.language,
      confidence: round(winner.matched / tokens.length, 2),
      matched: winner.matched, wordCount: tokens.length,
      scores: scores.slice(0, 3),
      caveat: 'This is a word-frequency guess, not a reliable identification.'
    }, computed());
  }
};
