import { ok, fail, bundled } from '../src/contracts.js';
import { US_STATES, US_STATES_AS_OF } from '../src/lib/us-states.js';

export default {
  name: 'usStateLookup',
  description: 'Look up a US state by name or postal abbreviation.',
  category: 'reference', tier: 'standard',
  title: 'US state lookup',
  unbuilt: false, needsNetwork: false, dataAsOf: US_STATES_AS_OF, labels: [],
  replyTemplate: '{{summary|prose}}',
  inputSchema: {
    type: 'object', required: ['query'],
    properties: { query: { type: 'string', label: 'state', minLength: 1, prompt: 'Which state should I look up?' } }
  },
  outputSchema: {
    type: 'object',
    properties: {
      code: { type: 'string' }, name: { type: 'string' }, capital: { type: 'string' },
      year: { type: 'integer' }, isState: { type: 'boolean' }, summary: { type: 'string' },
      dataAsOf: { type: 'string' }
    }
  },
  examples: [
    { text: 'what is the capital of California', input: { query: 'California' }, output: { code: 'CA', name: 'California', capital: 'Sacramento', year: 1850, isState: true, summary: 'California (CA) — capital Sacramento, entered the Union in 1850.', dataAsOf: '2026-09-01' } },
    { text: 'look up TX', input: { query: 'TX' }, output: { code: 'TX', name: 'Texas', capital: 'Austin', year: 1845, isState: true, summary: 'Texas (TX) — capital Austin, entered the Union in 1845.', dataAsOf: '2026-09-01' } },
    { text: 'state info for new york', input: { query: 'new york' }, output: { code: 'NY', name: 'New York', capital: 'Albany', year: 1788, isState: true, summary: 'New York (NY) — capital Albany, entered the Union in 1788.', dataAsOf: '2026-09-01' } },
    { text: 'what about DC', input: { query: 'DC' }, output: { code: 'DC', name: 'District of Columbia', capital: 'Washington', year: 1790, isState: false, summary: 'District of Columbia (DC) — the federal district, established in 1790. It is not a state.', dataAsOf: '2026-09-01' } },
    { text: 'capital of Hawaii', input: { query: 'Hawaii' }, output: { code: 'HI', name: 'Hawaii', capital: 'Honolulu', year: 1959, isState: true, summary: 'Hawaii (HI) — capital Honolulu, entered the Union in 1959.', dataAsOf: '2026-09-01' } }
  ],
  errorCases: [
    { input: { query: 'Ontario' }, code: 'INVALID_INPUT' },
    { input: { query: 'ZZ' }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' }
  ],
  run (input) {
    const q = String(input.query).trim().toLowerCase();
    const hit = US_STATES.find((s) => s.code.toLowerCase() === q || s.name.toLowerCase() === q)
      ?? US_STATES.find((s) => s.name.toLowerCase().startsWith(q) && q.length >= 4);
    if (!hit) {
      return fail('INVALID_INPUT', `"${input.query}" is not one of the 50 states or the District of Columbia.`, 'query');
    }
    const isState = hit.code !== 'DC';
    return ok({
      ...hit, isState,
      summary: isState
        ? `${hit.name} (${hit.code}) — capital ${hit.capital}, entered the Union in ${hit.year}.`
        : `${hit.name} (${hit.code}) — the federal district, established in ${hit.year}. It is not a state.`,
      dataAsOf: US_STATES_AS_OF
    }, bundled(US_STATES_AS_OF));
  }
};
