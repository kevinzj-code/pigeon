import { ok, fail, bundled } from '../src/contracts.js';
import { LANGUAGE_CODES, LANGUAGE_CODES_AS_OF } from '../src/lib/language-codes.js';

export default {
  name: 'languageCodeLookup',
  description: 'Look up what a two-letter language code stands for, or find the code for a language — ISO 639-1.',
  category: 'reference', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: LANGUAGE_CODES_AS_OF, labels: [],
  replyTemplate: '{{code}} is {{name}}.',
  inputSchema: {
    type: 'object', required: ['query'],
    properties: { query: { type: 'string', label: 'language or code', minLength: 1, prompt: 'Which language or code should I look up?' } }
  },
  outputSchema: {
    type: 'object',
    properties: {
      code: { type: 'string' }, name: { type: 'string' },
      alternatives: { type: 'array', items: { type: 'string' } }, dataAsOf: { type: 'string' }
    }
  },
  examples: [
    { text: 'what language is code ta', input: { query: 'ta' }, output: { code: 'ta', name: 'Tamil', alternatives: [], dataAsOf: '2026-09-01' } },
    { text: 'what is the code for Portuguese', input: { query: 'Portuguese' }, output: { code: 'pt', name: 'Portuguese', alternatives: [], dataAsOf: '2026-09-01' } },
    { text: 'which language is de', input: { query: 'de' }, output: { code: 'de', name: 'German', alternatives: [], dataAsOf: '2026-09-01' } },
    { text: 'iso code for Swahili', input: { query: 'Swahili' }, output: { code: 'sw', name: 'Swahili', alternatives: [], dataAsOf: '2026-09-01' } },
    { text: 'what does zh mean', input: { query: 'zh' }, output: { code: 'zh', name: 'Chinese', alternatives: [], dataAsOf: '2026-09-01' } },
    { text: 'which language has the iso code sv', input: { query: 'sv' },
      output: { code: 'sv', name: 'Swedish', alternatives: [], dataAsOf: '2026-09-01' } },
    { text: 'which iso code is finnish', input: { query: 'finnish' },
      output: { code: 'fi', name: 'Finnish', alternatives: [], dataAsOf: '2026-09-01' } }
  ],
  errorCases: [
    { input: { query: 'zz' }, code: 'INVALID_INPUT' },
    { input: { query: 'Klingon' }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' }
  ],
  run (input) {
    const q = String(input.query).trim().toLowerCase();
    let hit = LANGUAGE_CODES.find((l) => l.code === q) ?? LANGUAGE_CODES.find((l) => l.name.toLowerCase() === q);
    let alternatives = [];
    if (!hit && q.length >= 3) {
      const near = LANGUAGE_CODES.filter((l) => l.name.toLowerCase().includes(q));
      if (near.length) { hit = near[0]; alternatives = near.slice(1, 5).map((l) => `${l.code} ${l.name}`); }
    }
    if (!hit) {
      return fail('INVALID_INPUT', q.length === 2
        ? `"${q}" is not an ISO 639-1 code in the bundled table.`
        : `I don't have a language called "${input.query}".`, 'query');
    }
    return ok({ code: hit.code, name: hit.name, alternatives, dataAsOf: LANGUAGE_CODES_AS_OF }, bundled(LANGUAGE_CODES_AS_OF));
  }
};
