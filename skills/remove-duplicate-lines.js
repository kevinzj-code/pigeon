import { ok, computed } from '../src/contracts.js';
import { lines } from '../src/lib/text.js';

export default {
  name: 'removeDuplicateLines',
  description: 'Remove repeated lines from a text, keeping the first time each one appeared.',
  category: 'text',
  tier: 'core',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{removed}} duplicate {{removed|plural:line:lines}} removed — {{kept}} of {{original}} left.',
  inputSchema: {
    type: 'object',
    required: ['text'],
    properties: {
      text: { type: 'string', label: 'text', minLength: 1, prompt: 'Which text should I deduplicate?' },
      ignoreCase: { type: 'boolean', label: 'ignore case', default: false },
      ignoreSpacing: { type: 'boolean', label: 'ignore spacing', default: false, description: 'treat lines differing only in spacing as the same' }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      result: { type: 'string' }, kept: { type: 'integer' }, removed: { type: 'integer' },
      original: { type: 'integer' }, duplicates: { type: 'array', items: { type: 'string' } }
    }
  },
  examples: [
    { text: 'remove the duplicate lines', input: { text: 'apple\nbanana\napple\ncherry' },
      output: { result: 'apple\nbanana\ncherry', kept: 3, removed: 1, original: 4, duplicates: ['apple'] } },
    { text: 'dedupe this list keeping the order', input: { text: 'b\na\nb\nc\na' },
      output: { result: 'b\na\nc', kept: 3, removed: 2, original: 5, duplicates: ['b', 'a'] } },
    { text: 'remove duplicates ignoring case', input: { text: 'Apple\napple\nAPPLE', ignoreCase: true },
      output: { result: 'Apple', kept: 1, removed: 2, original: 3, duplicates: ['apple'] } },
    { text: 'dedupe ignoring extra spaces', input: { text: 'one  two\none two', ignoreSpacing: true },
      output: { result: 'one  two', kept: 1, removed: 1, original: 2, duplicates: ['one two'] } },
    { text: 'strip repeated lines from text that has none', input: { text: 'x\ny\nz' },
      output: { result: 'x\ny\nz', kept: 3, removed: 0, original: 3, duplicates: [] } }
  ],
  errorCases: [
    { input: {}, code: 'MISSING_FIELD' },
    { input: { text: '' }, code: 'MISSING_FIELD' },
    { input: { text: 'a', ignoreCase: 'sure' }, code: 'INVALID_INPUT' }
  ],
  run (input) {
    const all = lines(input.text);
    const key = (l) => {
      let k = l;
      if (input.ignoreSpacing) k = k.trim().replace(/\s+/g, ' ');
      if (input.ignoreCase) k = k.toLowerCase();
      return k;
    };
    const seen = new Set();
    const dupes = new Set();
    const kept = [];
    for (const l of all) {
      const k = key(l);
      if (seen.has(k)) { dupes.add(k); continue; }
      seen.add(k);
      /* The FIRST occurrence survives, in its original form — which is why the
         result can differ in case or spacing from the key that matched it. */
      kept.push(l);
    }
    return ok({
      result: kept.join('\n'), kept: kept.length,
      removed: all.length - kept.length, original: all.length,
      duplicates: [...dupes]
    }, computed());
  }
};
