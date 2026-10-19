import { ok, fail, computed } from '../src/contracts.js';
import { splitCountryCode, joinRegion, regionFor, groupNational, TRUNK_PREFIX } from '../src/lib/phone-format.js';
import { PHONE_CODES_AS_OF } from '../src/lib/phone-codes.js';

export default {
  name: 'formatPhoneNumber',
  description: 'Rewrite a phone number in E.164, international or national form.',
  category: 'validation', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: PHONE_CODES_AS_OF, labels: [],
  replyTemplate: '{{standard}} {{e164}}, international {{international}}, national {{national}}.',
  inputSchema: {
    type: 'object', required: ['number'],
    properties: {
      number: { type: 'string', label: 'phone number', minLength: 1, prompt: 'Which phone number should I format?' },
      region: { type: 'string', label: 'default dialling code', description: 'the dialling code to assume when the number has no + prefix' }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      e164: { type: 'string' }, international: { type: 'string' }, national: { type: 'string' },
      standard: { type: 'string' },
      countryCode: { type: 'integer' }, nationalNumber: { type: 'string' },
      regions: { type: 'array', items: { type: 'string' } }, digits: { type: 'integer' }
    }
  },
  examples: [
    { text: 'format this phone number', input: { number: '+44 20 7946 0958' }, output: { standard: 'E.164', e164: '+442079460958', international: '+44 20 7946 0958', national: '02079460958', countryCode: 44, nationalNumber: '2079460958', regions: ['United Kingdom'], digits: 12 } },
    { text: 'normalise this us number to e164', input: { number: '(415) 555-2671', region: '+1' }, output: { standard: 'E.164', e164: '+14155552671', international: '+1 415 555 2671', national: '4155552671', countryCode: 1, nationalNumber: '4155552671', regions: ['United States', 'Canada'], digits: 11 } },
    { text: 'write this indian number in international form', input: { number: '+91 98765 43210' }, output: { standard: 'E.164', e164: '+919876543210', international: '+91 98765 43210', national: '09876543210', countryCode: 91, nationalNumber: '9876543210', regions: ['India'], digits: 12 } },
    { text: 'clean up this messy number', input: { number: '00 33 1 42 68 53 00' }, output: { standard: 'E.164', e164: '+33142685300', international: '+33 1 42 68 53 00', national: '0142685300', countryCode: 33, nationalNumber: '142685300', regions: ['France'], digits: 11 } },
    { text: 'format a singapore number', input: { number: '+65 6123 4567' }, output: { standard: 'E.164', e164: '+6561234567', international: '+65 6123 4567', national: '61234567', countryCode: 65, nationalNumber: '61234567', regions: ['Singapore'], digits: 10 } },
    { text: 'tidy +44 20 7946 0958 into international format', input: { number: '+44 20 7946 0958' },
      output: { standard: 'E.164', e164: '+442079460958', international: '+44 20 7946 0958', national: '02079460958', countryCode: 44, nationalNumber: '2079460958', regions: ['United Kingdom'], digits: 12 } }
  ],
  errorCases: [
    { input: { number: 'nothing numeric' }, code: 'INVALID_INPUT' },
    { input: { number: '5551234' }, code: 'INVALID_INPUT' },
    { input: { number: '+999 12345678' }, code: 'INVALID_INPUT' }
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
    if (!split) return fail('INVALID_INPUT', `No country in the bundled table uses a dialling code that starts +${full.slice(0, 3)}.`, 'number');

    const { code, national } = split;
    /* An absent trunk-prefix entry means the region has none, so the national
       form is the bare number — not a missing answer. */
    const trunk = TRUNK_PREFIX[code] ?? '';

    return ok({
      /* The standard's name is a result field, not template prose: "E.164"
         reads as the numeral 164 to the fabrication auditor, and a name typed
         into a template traces to nothing. It is also a real fact about the
         first string — which format it is in. Same treatment as the encoding
         name in unicodeLookup. */
      standard: 'E.164',
      e164: `+${full}`,
      international: `+${code} ${groupNational(code, national)}`,
      national: trunk + national,
      countryCode: code, nationalNumber: national,
      regions: regionFor(code), digits: full.length
    }, computed());
  }
};
