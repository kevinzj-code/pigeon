import { ok, computed } from '../src/contracts.js';
import { sentences, words } from '../src/lib/text.js';

export default {
  name: 'countSentences',
  description: 'Count the sentences in a text, and the average sentence length.',
  category: 'text',
  tier: 'core',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: ['estimate'],
  replyTemplate: '{{sentences}} {{sentences|plural:sentence:sentences}}, averaging {{averageWords}} words each. Longest is {{longestWords}} words.',
  inputSchema: {
    type: 'object',
    required: ['text'],
    properties: { text: { type: 'string', label: 'text', minLength: 1, prompt: 'Which text should I count?' } }
  },
  outputSchema: {
    type: 'object',
    properties: {
      sentences: { type: 'integer' }, averageWords: { type: 'number' },
      longestWords: { type: 'integer' }, shortestWords: { type: 'integer' },
      totalWords: { type: 'integer' }
    }
  },
  examples: [
    { text: 'how many sentences is this', input: { text: 'Hello there. How are you today? I am well.' },
      output: { sentences: 3, averageWords: 3, longestWords: 4, shortestWords: 2, totalWords: 9 } },
    { text: 'count sentences in one line', input: { text: 'Just the one sentence here.' },
      output: { sentences: 1, averageWords: 5, longestWords: 5, shortestWords: 5, totalWords: 5 } },
    { text: 'sentence count with an abbreviation in it', input: { text: 'Dr. Smith arrived late. The meeting went ahead.' },
      output: { sentences: 2, averageWords: 4, longestWords: 4, shortestWords: 4, totalWords: 8 } },
    { text: 'how many sentences with exclamations', input: { text: 'Stop! Look both ways. Then cross.' },
      output: { sentences: 3, averageWords: 2, longestWords: 3, shortestWords: 1, totalWords: 6 } },
    { text: 'average sentence length of this paragraph', input: { text: 'Short one. This second sentence is considerably longer than the first one was.' },
      output: { sentences: 2, averageWords: 6.5, longestWords: 11, shortestWords: 2, totalWords: 13 } }
  ],
  errorCases: [
    { input: {}, code: 'MISSING_FIELD' },
    { input: { text: '' }, code: 'MISSING_FIELD' },
    { input: { text: [1, 2] }, code: 'INVALID_INPUT' }
  ],
  run (input) {
    /* Sentence splitting without a model is a heuristic — "e.g." and "Dr."
       are handled, but an unlisted abbreviation will over-split. Hence the
       "estimate" label, which the renderer shows. */
    const list = sentences(input.text);
    const lengths = list.map(s => words(s).length);
    const total = lengths.reduce((a, b) => a + b, 0);
    return ok({
      sentences: list.length,
      averageWords: list.length ? Math.round((total / list.length) * 100) / 100 : 0,
      longestWords: lengths.length ? Math.max(...lengths) : 0,
      shortestWords: lengths.length ? Math.min(...lengths) : 0,
      totalWords: total
    }, computed());
  }
};
