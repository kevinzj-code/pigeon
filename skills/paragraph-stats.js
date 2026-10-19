import { ok, fail, computed } from '../src/contracts.js';
import { words, sentences } from '../src/lib/text.js';
import { round } from '../src/lib/num.js';

export default {
  name: 'paragraphStats',
  description: 'Break a document into paragraphs and report the word and sentence count of each.',
  category: 'writing',
  tier: 'core',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{paragraphs}} {{paragraphs|plural:paragraph:paragraphs}}, {{totalWords|comma}} words. Longest is paragraph {{longestIndex}} at {{longestWords}} words.',
  inputSchema: {
    type: 'object',
    required: ['text'],
    properties: { text: { type: 'string', label: 'text', minLength: 1, prompt: 'Which document should I break down?' } }
  },
  outputSchema: {
    type: 'object',
    properties: {
      stats: { type: 'array' }, paragraphs: { type: 'integer' }, totalWords: { type: 'integer' },
      totalSentences: { type: 'integer' }, averageWords: { type: 'number' },
      longestWords: { type: 'integer' }, longestIndex: { type: 'integer' }
    }
  },
  examples: [
    { text: 'break this document into paragraph stats', input: { text: 'First paragraph here. It has two sentences.\n\nSecond one is shorter.' },
      output: { stats: [{ index: 1, words: 7, sentences: 2, characters: 43 }, { index: 2, words: 4, sentences: 1, characters: 22 }], paragraphs: 2, totalWords: 11, totalSentences: 3, averageWords: 5.5, longestWords: 7, longestIndex: 1 } },
    { text: 'how long is each paragraph', input: { text: 'One.\n\nTwo two.\n\nThree three three.' },
      output: { stats: [{ index: 1, words: 1, sentences: 1, characters: 4 }, { index: 2, words: 2, sentences: 1, characters: 8 }, { index: 3, words: 3, sentences: 1, characters: 18 }], paragraphs: 3, totalWords: 6, totalSentences: 3, averageWords: 2, longestWords: 3, longestIndex: 3 } },
    { text: 'paragraph breakdown of a single block', input: { text: 'Just the one paragraph, with two sentences. Here is the second.' },
      output: { stats: [{ index: 1, words: 11, sentences: 2, characters: 63 }], paragraphs: 1, totalWords: 11, totalSentences: 2, averageWords: 11, longestWords: 11, longestIndex: 1 } },
    { text: 'which paragraph is longest', input: { text: 'Short.\n\nThis paragraph is quite a lot longer than the other one is.' },
      output: { stats: [{ index: 1, words: 1, sentences: 1, characters: 6 }, { index: 2, words: 12, sentences: 1, characters: 59 }], paragraphs: 2, totalWords: 13, totalSentences: 2, averageWords: 6.5, longestWords: 12, longestIndex: 2 } },
    { text: 'stats for a document with extra blank lines', input: { text: 'A one.\n\n\n\nB two.' },
      output: { stats: [{ index: 1, words: 2, sentences: 1, characters: 6 }, { index: 2, words: 2, sentences: 1, characters: 6 }], paragraphs: 2, totalWords: 4, totalSentences: 2, averageWords: 2, longestWords: 2, longestIndex: 2 } }
  ],
  errorCases: [
    { input: { text: '   ' }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' },
    { input: { text: ['a'] }, code: 'INVALID_INPUT' }
  ],
  run (input) {
    const paras = input.text.trim().split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
    if (!paras.length) return fail('INVALID_INPUT', 'There are no paragraphs in that.', 'text');

    const stats = paras.map((p, i) => ({
      index: i + 1, words: words(p).length, sentences: sentences(p).length, characters: p.length
    }));
    const totalWords = stats.reduce((n, s) => n + s.words, 0);
    /* Ties go to the LAST longest paragraph — arbitrary, but fixed, so the
       same document always names the same one. */
    const longest = stats.reduce((best, s) => (s.words >= best.words ? s : best), stats[0]);

    return ok({
      stats, paragraphs: paras.length, totalWords,
      totalSentences: stats.reduce((n, s) => n + s.sentences, 0),
      averageWords: round(totalWords / paras.length, 2),
      longestWords: longest.words, longestIndex: longest.index
    }, computed());
  }
};
