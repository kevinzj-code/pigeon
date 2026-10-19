import { ok, fail, bundled } from '../src/contracts.js';
import { PHONE_CODES, PHONE_CODES_AS_OF } from '../src/lib/phone-codes.js';

export default {
  name: 'phoneRegionLookup',
  description: 'Find which country an international dialling code belongs to, or the code for a country.',
  category: 'reference', tier: 'standard',
  title: 'Dialling code lookup',
  unbuilt: false, needsNetwork: false, dataAsOf: PHONE_CODES_AS_OF, labels: [],
  replyTemplate: '{{summary|prose}}',
  inputSchema: {
    type: 'object', required: ['query'],
    properties: { query: { type: 'string', label: 'dialling code or country', minLength: 1, prompt: 'Which dialling code or country?' } }
  },
  outputSchema: {
    type: 'object',
    properties: {
      code: { type: 'string' }, number: { type: 'integer' },
      regions: { type: 'array', items: { type: 'string' } },
      summary: { type: 'string' }, dataAsOf: { type: 'string' }
    }
  },
  examples: [
    { text: 'what country is +44', input: { query: '+44' }, output: { code: '+44', number: 44, regions: ['United Kingdom'], summary: '+44 is the United Kingdom.', dataAsOf: '2026-09-01' } },
    { text: 'which country uses dialling code 81', input: { query: '81' }, output: { code: '+81', number: 81, regions: ['Japan'], summary: '+81 is Japan.', dataAsOf: '2026-09-01' } },
    { text: 'what is the dialling code for India', input: { query: 'India' }, output: { code: '+91', number: 91, regions: ['India'], summary: '+91 is India.', dataAsOf: '2026-09-01' } },
    { text: 'who does +1 belong to', input: { query: '+1' }, output: { code: '+1', number: 1, regions: ['United States', 'Canada'], summary: '+1 is the United States and Canada — it is the North American Numbering Plan, shared with around twenty Caribbean countries.', dataAsOf: '2026-09-01' } },
    { text: 'calling code for Brazil', input: { query: 'Brazil' }, output: { code: '+55', number: 55, regions: ['Brazil'], summary: '+55 is Brazil.', dataAsOf: '2026-09-01' } }
  ],
  errorCases: [
    { input: { query: '+999' }, code: 'INVALID_INPUT' },
    { input: { query: 'Atlantis' }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' }
  ],
  run (input) {
    const q = String(input.query).trim();
    const digits = q.replace(/^\+/, '');
    let hit = null;
    if (/^\d{1,4}$/.test(digits)) hit = PHONE_CODES.find((p) => p.code === Number(digits));
    if (!hit) {
      const name = q.toLowerCase();
      hit = PHONE_CODES.find((p) => p.regions.some((r) => r.toLowerCase() === name))
        ?? PHONE_CODES.find((p) => p.regions.some((r) => r.toLowerCase().includes(name) && name.length >= 4));
    }
    if (!hit) {
      return fail('INVALID_INPUT', /^\d/.test(digits)
        ? `+${digits} is not a dialling code in the bundled table.`
        : `I don't have a dialling code for "${q}".`, 'query');
    }

    const listed = hit.regions.length > 1
      ? `${hit.regions.slice(0, -1).join(', ')} and ${hit.regions[hit.regions.length - 1]}`
      : hit.regions[0];
    /* +1 and +7 are shared. Naming only the first country would be wrong for
       everyone else behind the same code, so the summary says it is shared. */
    const shared = hit.code === 1
      ? ' — it is the North American Numbering Plan, shared with around twenty Caribbean countries'
      : '';
    const article = /^(United|Netherlands|Philippines|Democratic)/.test(hit.regions[0]) ? 'the ' : '';

    return ok({
      code: `+${hit.code}`, number: hit.code, regions: hit.regions,
      summary: `+${hit.code} is ${article}${listed}${shared}.`,
      dataAsOf: PHONE_CODES_AS_OF
    }, bundled(PHONE_CODES_AS_OF));
  }
};
