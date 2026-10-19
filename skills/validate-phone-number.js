import { ok, fail, computed } from '../src/contracts.js';
import { splitCountryCode, joinRegion, regionFor, NATIONAL_LENGTHS } from '../src/lib/phone-format.js';
import { PHONE_CODES_AS_OF } from '../src/lib/phone-codes.js';

export default {
  name: 'validatePhoneNumber',
  description: "Say whether a phone number has the right shape for its country.",
  category: 'validation', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: PHONE_CODES_AS_OF, labels: [],
  replyTemplate: '{{summary|prose}}',
  inputSchema: {
    type: 'object', required: ['number'],
    properties: {
      number: { type: 'string', label: 'phone number', minLength: 1, prompt: 'Which phone number should I check?' },
      region: { type: 'string', label: 'default dialling code', description: 'the dialling code to assume when the number has no + prefix' }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      valid: { type: 'boolean' }, e164: { type: 'string' }, countryCode: { type: 'integer' },
      nationalNumber: { type: 'string' }, regions: { type: 'array', items: { type: 'string' } },
      reason: { type: 'string' }, checkedLength: { type: 'boolean' }, summary: { type: 'string' }
    }
  },
  examples: [
    { text: 'is this a valid phone number', input: { number: '+44 20 7946 0958' }, output: { valid: true, e164: '+442079460958', countryCode: 44, nationalNumber: '2079460958', regions: ['United Kingdom'], reason: null, checkedLength: true, summary: 'That is the right shape for a phone number in United Kingdom: +442079460958. This checks the shape only — it cannot tell you whether the number is in service.' } },
    { text: 'check this us number', input: { number: '+1 (415) 555-2671' }, output: { valid: true, e164: '+14155552671', countryCode: 1, nationalNumber: '4155552671', regions: ['United States', 'Canada'], reason: null, checkedLength: true, summary: 'That is the right shape for a phone number in United States: +14155552671. This checks the shape only — it cannot tell you whether the number is in service.' } },
    { text: 'validate +91 98765 43210', input: { number: '+91 98765 43210' }, output: { valid: true, e164: '+919876543210', countryCode: 91, nationalNumber: '9876543210', regions: ['India'], reason: null, checkedLength: true, summary: 'That is the right shape for a phone number in India: +919876543210. This checks the shape only — it cannot tell you whether the number is in service.' } },
    { text: 'is +44 123 a real number', input: { number: '+44 123' }, output: { valid: false, e164: '+44123', countryCode: 44, nationalNumber: '123', regions: ['United Kingdom'], reason: 'length', checkedLength: true, summary: 'A phone number in United Kingdom has 9 to 10 digits after the country code; this one has 3.' } },
    { text: 'check a number with an unknown country code', input: { number: '+999 12345678' }, output: { valid: false, e164: '+99912345678', countryCode: null, nationalNumber: null, regions: [], reason: 'unknown-country-code', checkedLength: false, summary: 'No country in the bundled table uses a dialling code that starts +999.' } }
  ],
  errorCases: [
    { input: { number: 'no digits here' }, code: 'INVALID_INPUT' },
    { input: { number: '2079460958' }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' }
  ],
  run (input) {
    const raw = String(input.number).trim();
    const digits = raw.replace(/\D/g, '');
    if (!digits) return fail('INVALID_INPUT', 'There are no digits in that.', 'number');

    const international = raw.startsWith('+') || raw.startsWith('00');
    const regionDigits = input.region ? String(input.region).replace(/\D/g, '') : '';
    if (!international && !regionDigits) {
      return fail('INVALID_INPUT', 'Without a + and a country code I cannot tell which country that number is from — give it as +44 20 7946 0958, or tell me the region.', 'region');
    }
    const full = international ? digits.replace(/^00/, '') : joinRegion(regionDigits, digits);

    const split = splitCountryCode(full);
    if (!split) {
      return ok({
        valid: false, e164: `+${full}`, countryCode: null, nationalNumber: null, regions: [],
        reason: 'unknown-country-code', checkedLength: false,
        summary: `No country in the bundled table uses a dialling code that starts +${full.slice(0, 3)}.`
      }, computed());
    }

    const { code, national } = split;
    const regions = regionFor(code);
    const range = NATIONAL_LENGTHS[code];
    /* E.164 caps the whole number at 15 digits, so an unlisted region still
       gets a real check — just a much weaker one, and checkedLength says which
       kind of check the answer rests on. */
    const [min, max] = range ?? [4, 15 - String(code).length];
    const valid = national.length >= min && national.length <= max;

    return ok({
      valid, e164: `+${full}`, countryCode: code, nationalNumber: national, regions,
      reason: valid ? null : 'length', checkedLength: Boolean(range),
      summary: valid
        ? `That is the right shape for a phone number in ${regions[0]}: +${full}. This checks the shape only — it cannot tell you whether the number is in service.`
        : `A phone number in ${regions[0]} has ${min === max ? `${min} digits` : `${min} to ${max} digits`} after the country code; this one has ${national.length}.`
    }, computed());
  }
};
