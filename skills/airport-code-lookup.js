import { ok, fail, bundled } from '../src/contracts.js';
import { AIRPORTS, AIRPORTS_AS_OF } from '../src/lib/airports.js';

export default {
  name: 'airportCodeLookup',
  description: 'Look up an airport by its IATA code, or find the airports serving a city.',
  category: 'reference', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: AIRPORTS_AS_OF, labels: [],
  replyTemplate: '{{summary|prose}}',
  inputSchema: {
    type: 'object', required: ['query'],
    properties: { query: { type: 'string', label: 'airport code or city', minLength: 1, prompt: 'Which airport code or city?' } }
  },
  outputSchema: {
    type: 'object',
    properties: {
      code: { type: 'string' }, name: { type: 'string' }, city: { type: 'string' },
      country: { type: 'string' }, summary: { type: 'string' },
      alternatives: { type: 'array', items: { type: 'string' } }, dataAsOf: { type: 'string' }
    }
  },
  examples: [
    { text: 'what airport is LHR', input: { query: 'LHR' }, output: { code: 'LHR', name: 'Heathrow', city: 'London', country: 'United Kingdom', summary: 'LHR is Heathrow, London, United Kingdom.', alternatives: [], dataAsOf: '2026-09-01' } },
    { text: 'which airport code is JFK', input: { query: 'jfk' }, output: { code: 'JFK', name: 'John F. Kennedy International', city: 'New York', country: 'United States', summary: 'JFK is John F. Kennedy International, New York, United States.', alternatives: [], dataAsOf: '2026-09-01' } },
    { text: 'airports in Tokyo', input: { query: 'Tokyo' }, output: { code: 'NRT', name: 'Narita International', city: 'Tokyo', country: 'Japan', summary: 'NRT is Narita International, Tokyo, Japan.', alternatives: ['HND Haneda'], dataAsOf: '2026-09-01' } },
    { text: 'what is SIN airport', input: { query: 'SIN' }, output: { code: 'SIN', name: 'Changi', city: 'Singapore', country: 'Singapore', summary: 'SIN is Changi, Singapore, Singapore.', alternatives: [], dataAsOf: '2026-09-01' } },
    { text: 'which airports serve London', input: { query: 'London' }, output: { code: 'LHR', name: 'Heathrow', city: 'London', country: 'United Kingdom', summary: 'LHR is Heathrow, London, United Kingdom.', alternatives: ['LGW Gatwick', 'STN Stansted', 'LTN Luton'], dataAsOf: '2026-09-01' } }
  ],
  errorCases: [
    { input: { query: 'ZZZ' }, code: 'INVALID_INPUT' },
    { input: { query: 'Narnia' }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' }
  ],
  run (input) {
    const q = String(input.query).trim();
    const lower = q.toLowerCase();

    const byCode = AIRPORTS.find((a) => a.code.toLowerCase() === lower);
    const inCity = AIRPORTS.filter((a) => a.city.toLowerCase() === lower);
    const hits = byCode ? [byCode] : inCity.length ? inCity : AIRPORTS.filter((a) => a.name.toLowerCase().includes(lower) && lower.length >= 4);

    if (!hits.length) {
      /* "Not in the table" and "does not exist" are different claims, and this
         table holds about 140 of roughly 9,000 IATA codes. */
      return fail('INVALID_INPUT', /^[A-Za-z]{3}$/.test(q)
        ? `"${q.toUpperCase()}" is not in the bundled table, which covers around 140 major international airports rather than all of them.`
        : `I have no airport matching "${q}" in the bundled table of major international airports.`, 'query');
    }

    const [first, ...rest] = hits;
    return ok({
      code: first.code, name: first.name, city: first.city, country: first.country,
      summary: `${first.code} is ${first.name}, ${first.city}, ${first.country}.`,
      alternatives: rest.map((a) => `${a.code} ${a.name}`),
      dataAsOf: AIRPORTS_AS_OF
    }, bundled(AIRPORTS_AS_OF));
  }
};
