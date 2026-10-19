import { ok, computed } from '../src/contracts.js';
import { words, STOP_WORDS } from '../src/lib/text.js';

export default {
  name: 'removeStopWords',
  description: 'Strip the common filler words from a text, leaving only the content words.',
  category: 'text',
  tier: 'core',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{removed}} filler {{removed|plural:word:words}} removed, {{kept}} left: {{result}}',
  inputSchema: {
    type: 'object',
    required: ['text'],
    properties: {
      text: { type: 'string', label: 'text', minLength: 1, prompt: 'Which text should I strip?' },
      extra: { type: 'array', label: 'extra words to remove', items: { type: 'string' }, description: 'more words to treat as filler' }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      result: { type: 'string' }, tokens: { type: 'array', items: { type: 'string' } },
      kept: { type: 'integer' }, removed: { type: 'integer' },
      removedWords: { type: 'array', items: { type: 'string' } }
    }
  },
  examples: [
    { text: 'strip the filler words from this', input: { text: 'the cat sat on the mat' },
      output: { result: 'cat sat mat', tokens: ['cat', 'sat', 'mat'], kept: 3, removed: 3, removedWords: ['the', 'on'] } },
    { text: 'remove stop words from a search query', input: { text: 'what is the best way to boil an egg' },
      output: { result: 'best way boil egg', tokens: ['best', 'way', 'boil', 'egg'], kept: 4, removed: 5, removedWords: ['what', 'is', 'the', 'to', 'an'] } },
    { text: 'strip filler and my own extra words', input: { text: 'the project is on track', extra: ['project'] },
      output: { result: 'track', tokens: ['track'], kept: 1, removed: 4, removedWords: ['the', 'project', 'is', 'on'] } },
    { text: 'remove stop words when there are none', input: { text: 'quantum entanglement research' },
      output: { result: 'quantum entanglement research', tokens: ['quantum', 'entanglement', 'research'], kept: 3, removed: 0, removedWords: [] } },
    { text: 'strip a sentence that is all filler', input: { text: 'it is what it is' },
      output: { result: '', tokens: [], kept: 0, removed: 5, removedWords: ['it', 'is', 'what'] } }
  ],
  errorCases: [
    { input: {}, code: 'MISSING_FIELD' },
    { input: { text: '' }, code: 'MISSING_FIELD' },
    { input: { text: 'hello', extra: [['nested']] }, code: 'INVALID_INPUT' }
  ],
  run (input) {
    const extra = new Set((input.extra || []).map(w => String(w).toLowerCase()));
    const all = words(input.text);
    const isStop = (w) => STOP_WORDS.has(w.toLowerCase()) || extra.has(w.toLowerCase());
    const tokens = all.filter(w => !isStop(w));
    /* The words taken out are listed, deduplicated, because "I stripped 5
       words" without saying which is a change the user cannot check. */
    const removedWords = [...new Set(all.filter(isStop).map(w => w.toLowerCase()))];
    return ok({
      result: tokens.join(' '), tokens,
      kept: tokens.length, removed: all.length - tokens.length, removedWords
    }, computed());
  }
};
