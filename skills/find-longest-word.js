import { ok, fail, computed } from '../src/contracts.js';
import { words } from '../src/lib/text.js';

export default {
  name: 'findLongestWord',
  description: 'Find the longest word in a text — the biggest word, and any that tie with it.',
  category: 'text', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: 'The longest {{count|plural:word is:words are}} {{longest|list}} at {{length}} letters.',
  inputSchema: {
    type: 'object', required: ['text'],
    properties: {
      text: { type: 'string', label: 'text', minLength: 1, prompt: 'Which text should I search?' },
      top: { type: 'integer', label: 'how many words', minimum: 1, maximum: 20, default: 1 }
    }
  },
  outputSchema: { type: 'object', properties: { longest: { type: 'array', items: { type: 'string' } }, length: { type: 'integer' }, count: { type: 'integer' }, totalWords: { type: 'integer' } } },
  examples: [
    { text: 'what is the longest word in this sentence', input: { text: 'The quick brown fox jumps over the lazy dog' }, output: { longest: ['brown'], length: 5, count: 1, totalWords: 9 } },
    { text: 'find the longest word', input: { text: 'antidisestablishmentarianism is long' }, output: { longest: ['antidisestablishmentarianism'], length: 28, count: 1, totalWords: 3 } },
    { text: 'longest three words in this line', input: { text: 'alpha beta gamma delta epsilon', top: 3 }, output: { longest: ['epsilon', 'alpha', 'delta'], length: 7, count: 3, totalWords: 5 } },
    { text: 'longest word when several tie', input: { text: 'cat dog rat' }, output: { longest: ['cat'], length: 3, count: 1, totalWords: 3 } },
    { text: 'longest word in a hyphenated phrase', input: { text: 'a state-of-the-art design' }, output: { longest: ['state-of-the-art'], length: 16, count: 1, totalWords: 3 } },
    { text: 'pick out the lengthiest word in this text', input: { text: 'the extraordinary pigeon flew home' },
      output: { longest: ['extraordinary'], length: 13, count: 1, totalWords: 5 } },
    { text: 'which word here has the most letters', input: { text: 'cat elephant dog' },
      output: { longest: ['elephant'], length: 8, count: 1, totalWords: 3 } }
  ],
  errorCases: [
    { input: { text: '!!!' }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' },
    { input: { text: 'a', top: 0 }, code: 'INVALID_INPUT' }
  ],
  run (input) {
    const all = words(input.text);
    if (!all.length) return fail('INVALID_INPUT', 'There are no words in that.', 'text');
    /* Ties broken alphabetically so the same text always names the same word —
       insertion order would leak the original sentence into a ranking. */
    const ranked = [...new Set(all)].sort((a, b) => b.length - a.length || a.localeCompare(b));
    const longest = ranked.slice(0, input.top);
    return ok({ longest, length: longest[0].length, count: longest.length, totalWords: all.length }, computed());
  }
};
