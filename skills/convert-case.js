import { ok, computed } from '../src/contracts.js';
import { words } from '../src/lib/text.js';

/* Title case uses the AP-style short-word list rather than capitalising
   everything: "The Lord of the Rings", not "The Lord Of The Rings". The first
   and last words always capitalise regardless. */
const SMALL = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'if', 'in', 'nor', 'of', 'on', 'or', 'per', 'so', 'the', 'to', 'up', 'via', 'vs', 'yet', 'from', 'into', 'with', 'over']);

const CASES = {
  upper: (s) => s.toUpperCase(),
  lower: (s) => s.toLowerCase(),
  title (s) {
    const parts = s.trim().split(/(\s+)/);
    const wordIdx = parts.map((p, i) => (/^\s+$/.test(p) ? -1 : i)).filter(i => i >= 0);
    return parts.map((p, i) => {
      if (/^\s+$/.test(p)) return p;
      const lower = p.toLowerCase();
      const isEdge = i === wordIdx[0] || i === wordIdx[wordIdx.length - 1];
      if (!isEdge && SMALL.has(lower.replace(/[^a-z]/g, ''))) return lower;
      return lower.replace(/[\p{L}]/u, c => c.toUpperCase());
    }).join('');
  },
  sentence (s) {
    return s.toLowerCase().replace(/(^\s*|[.!?]\s+)([\p{Ll}])/gu, (_, pre, c) => pre + c.toUpperCase());
  },
  camel (s) {
    return words(s).map((w, i) => i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase()).join('');
  },
  pascal (s) {
    return words(s).map(w => w[0].toUpperCase() + w.slice(1).toLowerCase()).join('');
  },
  snake: (s) => words(s).map(w => w.toLowerCase()).join('_'),
  kebab: (s) => words(s).map(w => w.toLowerCase()).join('-'),
  constant: (s) => words(s).map(w => w.toUpperCase()).join('_')
};

export default {
  name: 'convertCase',
  description: 'Change text to another capitalisation — title case, upper, lower, camelCase, snake_case.',
  category: 'text',
  tier: 'core',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{result}}',
  inputSchema: {
    type: 'object',
    required: ['text', 'style'],
    properties: {
      text: { type: 'string', label: 'text', minLength: 1, prompt: 'Which text should I change?' },
      style: { type: 'string', label: 'case', enum: Object.keys(CASES), prompt: 'Which case? (upper, lower, title, sentence, camel, pascal, snake, kebab or constant)' }
    }
  },
  outputSchema: { type: 'object', properties: { result: { type: 'string' }, style: { type: 'string' }, original: { type: 'string' } } },
  examples: [
    { text: 'make this title case: the lord of the rings', input: { text: 'the lord of the rings', style: 'title' },
      output: { result: 'The Lord of the Rings', style: 'title', original: 'the lord of the rings' } },
    { text: 'convert "user first name" to camelCase', input: { text: 'user first name', style: 'camel' },
      output: { result: 'userFirstName', style: 'camel', original: 'user first name' } },
    { text: 'snake case for "My Long Variable"', input: { text: 'My Long Variable', style: 'snake' },
      output: { result: 'my_long_variable', style: 'snake', original: 'My Long Variable' } },
    { text: 'shout this: keep it down', input: { text: 'keep it down', style: 'upper' },
      output: { result: 'KEEP IT DOWN', style: 'upper', original: 'keep it down' } },
    { text: 'fix the capitals: HELLO THERE. HOW ARE YOU?', input: { text: 'HELLO THERE. HOW ARE YOU?', style: 'sentence' },
      output: { result: 'Hello there. How are you?', style: 'sentence', original: 'HELLO THERE. HOW ARE YOU?' } },
    { text: 'change my heading to title case: a tale of two cities', input: { text: 'a tale of two cities', style: 'title' },
      output: { result: 'A Tale of Two Cities', style: 'title', original: 'a tale of two cities' } },
    { text: 'put this in upper case: quiet please', input: { text: 'quiet please', style: 'upper' },
      output: { result: 'QUIET PLEASE', style: 'upper', original: 'quiet please' } }
  ],
  errorCases: [
    { input: { text: 'hello', style: 'shouty' }, code: 'INVALID_INPUT' },
    { input: { text: '', style: 'upper' }, code: 'MISSING_FIELD' },
    { input: { style: 'upper' }, code: 'MISSING_FIELD' }
  ],
  run (input) {
    return ok({ result: CASES[input.style](input.text), style: input.style, original: input.text }, computed());
  }
};
