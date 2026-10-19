import { ok, fail, computed } from '../src/contracts.js';
import { words, sentences } from '../src/lib/text.js';
import { round } from '../src/lib/num.js';

export default {
  name: 'averageWordLength',
  description: 'Work out the typical word size in a text — its average word length.',
  category: 'text', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: 'Average word length is {{average}} letters across {{words|comma}} words, and {{averagePerSentence}} words per sentence.',
  inputSchema: {
    type: 'object', required: ['text'],
    properties: { text: { type: 'string', label: 'text', minLength: 1, prompt: 'Which text should I measure?' } }
  },
  outputSchema: { type: 'object', properties: { average: { type: 'number' }, words: { type: 'integer' }, letters: { type: 'integer' }, longest: { type: 'integer' }, shortest: { type: 'integer' }, averagePerSentence: { type: 'number' } } },
  examples: [
    { text: 'average word length of this sentence', input: { text: 'The quick brown fox jumps over the lazy dog' }, output: { average: 3.89, words: 9, letters: 35, longest: 5, shortest: 3, averagePerSentence: 9 } },
    { text: 'how long are the words on average', input: { text: 'Extraordinarily complicated terminology' }, output: { average: 12.33, words: 3, letters: 37, longest: 15, shortest: 11, averagePerSentence: 3 } },
    { text: 'mean word length here', input: { text: 'a bb ccc dddd' }, output: { average: 2.5, words: 4, letters: 10, longest: 4, shortest: 1, averagePerSentence: 4 } },
    { text: 'average word length across two sentences', input: { text: 'Short one. This is the second sentence.' }, output: { average: 4.43, words: 7, letters: 31, longest: 8, shortest: 2, averagePerSentence: 3.5 } },
    { text: 'word length for a single word', input: { text: 'hello' }, output: { average: 5, words: 1, letters: 5, longest: 5, shortest: 5, averagePerSentence: 1 } },
    { text: 'how long is the average word in this sentence', input: { text: 'Short words keep prose brisk' },
      output: { average: 4.8, words: 5, letters: 24, longest: 5, shortest: 4, averagePerSentence: 5 } },
    { text: 'how long are the words in this on average', input: { text: 'a bb ccc dddd' },
      output: { average: 2.5, words: 4, letters: 10, longest: 4, shortest: 1, averagePerSentence: 4 } }
  ],
  errorCases: [
    { input: { text: '...' }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' },
    { input: { text: ['a'] }, code: 'INVALID_INPUT' }
  ],
  run (input) {
    const all = words(input.text);
    if (!all.length) return fail('INVALID_INPUT', 'There are no words in that.', 'text');
    const lengths = all.map(w => w.length);
    const letters = lengths.reduce((a, b) => a + b, 0);
    const s = sentences(input.text).length || 1;
    return ok({
      average: round(letters / all.length, 2), words: all.length, letters,
      longest: Math.max(...lengths), shortest: Math.min(...lengths),
      averagePerSentence: round(all.length / s, 2)
    }, computed());
  }
};
