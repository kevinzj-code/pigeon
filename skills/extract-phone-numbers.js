import { ok, computed } from '../src/contracts.js';
import { findSensitive } from '../src/lib/pii.js';
import { splitCountryCode, regionFor } from '../src/lib/phone-format.js';
import { PHONE_CODES_AS_OF } from '../src/lib/phone-codes.js';

export default {
  name: 'extractPhoneNumbers',
  description: "Spot the phone numbers you could dial in a signature or footer.",
  category: 'text', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: PHONE_CODES_AS_OF,
  labels: ['estimate'],
  replyTemplate: '{{count}} {{count|plural:number:numbers}} found: {{numbers|list}}. Matched by pattern, so long digit runs that are not phone numbers can slip in.',
  inputSchema: {
    type: 'object', required: ['text'],
    properties: {
      text: { type: 'string', label: 'text', minLength: 1, maxLength: 100000, prompt: 'Which text should I search?' },
      defaultRegion: { type: 'string', label: 'default dialling code', description: 'the dialling code to assume for numbers written without one' }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      numbers: { type: 'array', items: { type: 'string' } }, matches: { type: 'array' },
      count: { type: 'integer' }, dataAsOf: { type: 'string' }
    }
  },
  examples: [
    { text: 'find the phone numbers in this text', input: { text: 'Call 020 7946 0958 or 07700 900123 for details.' }, output: { numbers: ['020 7946 0958', '07700 900123'], matches: [{ value: '020 7946 0958', digits: 11, e164: null, regions: [] }, { value: '07700 900123', digits: 11, e164: null, regions: [] }], count: 2, dataAsOf: '2026-09-01' } },
    { text: 'extract phone numbers with country codes', input: { text: 'Reach us on +44 20 7946 0958 or +1 415 555 2671.' }, output: { numbers: ['+44 20 7946 0958', '+1 415 555 2671'], matches: [{ value: '+44 20 7946 0958', digits: 12, e164: '+442079460958', regions: ['United Kingdom'] }, { value: '+1 415 555 2671', digits: 11, e164: '+14155552671', regions: ['United States', 'Canada'] }], count: 2, dataAsOf: '2026-09-01' } },
    { text: 'are there any phone numbers here', input: { text: 'No numbers in this sentence.' }, output: { numbers: [], matches: [], count: 0, dataAsOf: '2026-09-01' } },
    { text: 'pull the number out of this signature', input: { text: 'Ana Smith, Sales, +33 1 42 68 53 00' }, output: { numbers: ['+33 1 42 68 53 00'], matches: [{ value: '+33 1 42 68 53 00', digits: 11, e164: '+33142685300', regions: ['France'] }], count: 1, dataAsOf: '2026-09-01' } },
    { text: 'find numbers assuming a uk default', input: { text: 'Ring 020 7946 0958 today.', defaultRegion: '+44' }, output: { numbers: ['020 7946 0958'], matches: [{ value: '020 7946 0958', digits: 11, e164: '+4402079460958', regions: ['United Kingdom'] }], count: 1, dataAsOf: '2026-09-01' } }
  ],
  errorCases: [
    { input: {}, code: 'MISSING_FIELD' },
    { input: { text: '' }, code: 'MISSING_FIELD' },
    { input: { text: 'x'.repeat(100001) }, code: 'INVALID_INPUT' }
  ],
  run (input) {
    const hits = findSensitive(input.text, ['phone']);
    const region = input.defaultRegion ? String(input.defaultRegion).replace(/\D/g, '') : '';

    const matches = hits.map((h) => {
      const digits = h.value.replace(/\D/g, '');
      /* An E.164 form is only offered when the country is actually known -
         from a + in the text, or a default region the caller supplied. Guessing
         a country for a bare local number would invent the most important part
         of it. */
      const international = h.value.trim().startsWith('+');
      const full = international ? digits : region ? region + digits : null;
      const split = full ? splitCountryCode(full) : null;
      return {
        value: h.value.trim(), digits: digits.length,
        e164: full ? `+${full}` : null,
        regions: split ? regionFor(split.code) : []
      };
    });

    return ok({
      numbers: matches.map((m) => m.value), matches,
      count: matches.length, dataAsOf: PHONE_CODES_AS_OF
    }, computed());
  }
};
