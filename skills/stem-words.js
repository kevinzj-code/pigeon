import { ok, fail, computed } from '../src/contracts.js';
import { words, stem } from '../src/lib/text.js';

export default {
  name: 'stemWords',
  description: 'Reduce words to their stems so different forms of the same word group together.',
  category: 'text', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: ['estimate'],
  replyTemplate: '{{stems|list}} — {{unique}} distinct {{unique|plural:stem:stems}} from {{count}} words.',
  inputSchema: {
    type: 'object', required: ['text'],
    properties: { text: { type: 'string', label: 'text', minLength: 1, prompt: 'Which words should I stem?' } }
  },
  outputSchema: { type: 'object', properties: { stems: { type: 'array', items: { type: 'string' } }, pairs: { type: 'array' }, count: { type: 'integer' }, unique: { type: 'integer' } } },
  examples: [
    { text: 'stem running runs and runner', input: { text: 'running runs runner' }, output: { stems: ['run', 'run', 'runner'], pairs: [{ word: 'running', stem: 'run' }, { word: 'runs', stem: 'run' }, { word: 'runner', stem: 'runner' }], count: 3, unique: 2 } },
    { text: 'reduce these to stems', input: { text: 'connection connections connected' }, output: { stems: ['connec', 'connec', 'connect'], pairs: [{ word: 'connection', stem: 'connec' }, { word: 'connections', stem: 'connec' }, { word: 'connected', stem: 'connect' }], count: 3, unique: 2 } },
    { text: 'stem the plural forms', input: { text: 'parties party' }, output: { stems: ['party', 'party'], pairs: [{ word: 'parties', stem: 'party' }, { word: 'party', stem: 'party' }], count: 2, unique: 1 } },
    { text: 'stem happily and happiness', input: { text: 'happily happiness' }, output: { stems: ['happi', 'happi'], pairs: [{ word: 'happily', stem: 'happi' }, { word: 'happiness', stem: 'happi' }], count: 2, unique: 1 } },
    { text: 'stem short words that should not change', input: { text: 'cat dog run' }, output: { stems: ['cat', 'dog', 'run'], pairs: [{ word: 'cat', stem: 'cat' }, { word: 'dog', stem: 'dog' }, { word: 'run', stem: 'run' }], count: 3, unique: 3 } }
  ],
  errorCases: [
    { input: { text: '123 456' }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' },
    { input: { text: '' }, code: 'MISSING_FIELD' }
  ],
  run (input) {
    const all = words(input.text).filter(w => /[a-z]/i.test(w));
    if (!all.length) return fail('INVALID_INPUT', 'There are no words in that to stem.', 'text');
    /* A cut-down Porter stemmer, and it shows: stems are not always real words
       ("happi", "connec") and irregular forms are beyond it. That is normal for
       a stemmer and fine for grouping, but it is why this carries the
       "estimate" label rather than claiming to find dictionary roots. */
    const pairs = all.map(w => ({ word: w, stem: stem(w) }));
    const stems = pairs.map(p => p.stem);
    return ok({ stems, pairs, count: all.length, unique: new Set(stems).size }, computed());
  }
};
