import { ok, fail, computed } from '../src/contracts.js';

/* Country -> total IBAN length. The check digits only prove the number was not
   mistyped; the length is what proves it is the right shape for the country it
   claims to be from, and a wrong-length IBAN can still pass mod-97. */
const LENGTHS = {
  AD: 24, AE: 23, AL: 28, AT: 20, AZ: 28, BA: 20, BE: 16, BG: 22, BH: 22, BR: 29,
  BY: 28, CH: 21, CR: 22, CY: 28, CZ: 24, DE: 22, DK: 18, DO: 28, EE: 20, EG: 29,
  ES: 24, FI: 18, FO: 18, FR: 27, GB: 22, GE: 22, GI: 23, GL: 18, GR: 27, GT: 28,
  HR: 21, HU: 28, IE: 22, IL: 23, IS: 26, IT: 27, JO: 30, KW: 30, KZ: 20, LB: 28,
  LC: 32, LI: 21, LT: 20, LU: 20, LV: 21, LY: 25, MC: 27, MD: 24, ME: 22, MK: 19,
  MR: 27, MT: 31, MU: 30, NL: 18, NO: 15, PK: 24, PL: 28, PS: 29, PT: 25, QA: 29,
  RO: 24, RS: 22, SA: 24, SC: 31, SE: 24, SI: 19, SK: 24, SM: 27, ST: 25, SV: 28,
  TL: 23, TN: 24, TR: 26, UA: 29, VA: 22, VG: 24, XK: 20
};

/* The number is far larger than Number.MAX_SAFE_INTEGER, so mod-97 is done a
   few digits at a time. BigInt would work too; this keeps the arithmetic in the
   range every JavaScript engine handles identically. */
function mod97 (digits) {
  let remainder = 0;
  for (const ch of digits) remainder = (remainder * 10 + Number(ch)) % 97;
  return remainder;
}

export default {
  name: 'validateIban',
  description: "Test an IBAN bank number against its own checksum.",
  category: 'validation', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  title: 'Validate IBAN',
  replyTemplate: '{{summary|prose}}',
  inputSchema: {
    type: 'object', required: ['iban'],
    properties: { iban: { type: 'string', label: 'iban', minLength: 1, prompt: 'Which IBAN should I check?' } }
  },
  outputSchema: {
    type: 'object',
    properties: {
      valid: { type: 'boolean' }, iban: { type: 'string' }, formatted: { type: 'string' },
      country: { type: 'string' }, length: { type: 'integer' }, summary: { type: 'string' },
      reason: { type: 'string' }
    }
  },
  examples: [
    { text: 'is this iban valid', input: { iban: 'GB82 WEST 1234 5698 7654 32' }, output: { valid: true, iban: 'GB82WEST12345698765432', formatted: 'GB82 WEST 1234 5698 7654 32', country: 'GB', length: 22, summary: 'That IBAN is well formed — a GB number of 22 characters that passes the mod-97 check.', reason: null } },
    { text: 'check this german iban', input: { iban: 'DE89370400440532013000' }, output: { valid: true, iban: 'DE89370400440532013000', formatted: 'DE89 3704 0044 0532 0130 00', country: 'DE', length: 22, summary: 'That IBAN is well formed — a DE number of 22 characters that passes the mod-97 check.', reason: null } },
    { text: 'validate this french account number', input: { iban: 'FR1420041010050500013M02606' }, output: { valid: true, iban: 'FR1420041010050500013M02606', formatted: 'FR14 2004 1010 0505 0001 3M02 606', country: 'FR', length: 27, summary: 'That IBAN is well formed — a FR number of 27 characters that passes the mod-97 check.', reason: null } },
    { text: 'is this a real iban', input: { iban: 'GB82 WEST 1234 5698 7654 33' }, output: { valid: false, iban: 'GB82WEST12345698765433', formatted: 'GB82 WEST 1234 5698 7654 33', country: 'GB', length: 22, summary: 'That IBAN fails its check digits, so at least one character is wrong.', reason: 'checksum' } },
    { text: 'check iban NL91ABNA0417164300', input: { iban: 'NL91ABNA0417164300' }, output: { valid: true, iban: 'NL91ABNA0417164300', formatted: 'NL91 ABNA 0417 1643 00', country: 'NL', length: 18, summary: 'That IBAN is well formed — a NL number of 18 characters that passes the mod-97 check.', reason: null } },
    { text: 'does this bank account number check out: GB82 WEST 1234 5698 7654 32', input: { iban: 'GB82 WEST 1234 5698 7654 32' },
      output: { valid: true, iban: 'GB82WEST12345698765432', formatted: 'GB82 WEST 1234 5698 7654 32', country: 'GB', length: 22, summary: 'That IBAN is well formed — a GB number of 22 characters that passes the mod-97 check.', reason: null } },
    { text: 'is DE89 3704 0044 0532 0130 00 a valid iban', input: { iban: 'DE89 3704 0044 0532 0130 00' },
      output: { valid: true, iban: 'DE89370400440532013000', formatted: 'DE89 3704 0044 0532 0130 00', country: 'DE', length: 22, summary: 'That IBAN is well formed — a DE number of 22 characters that passes the mod-97 check.', reason: null } }
  ],
  errorCases: [
    { input: { iban: 'GB82 WEST' }, code: 'INVALID_INPUT' },
    { input: { iban: 'ZZ00 1234 5678' }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' }
  ],
  run (input) {
    const raw = String(input.iban).replace(/[\s-]/g, '').toUpperCase();
    if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(raw)) {
      return fail('INVALID_INPUT', 'An IBAN starts with two country letters and two check digits, then letters and digits only.', 'iban');
    }
    const country = raw.slice(0, 2);
    const expected = LENGTHS[country];
    if (!expected) return fail('INVALID_INPUT', `"${country}" is not a country code in the bundled IBAN table.`, 'iban');

    const formatted = raw.replace(/(.{4})/g, '$1 ').trim();
    if (raw.length !== expected) {
      return fail('INVALID_INPUT', `A ${country} IBAN is ${expected} characters; this one is ${raw.length}.`, 'iban');
    }

    const rearranged = raw.slice(4) + raw.slice(0, 4);
    const digits = [...rearranged].map((c) => (/[A-Z]/.test(c) ? String(c.charCodeAt(0) - 55) : c)).join('');
    const valid = mod97(digits) === 1;

    return ok({
      valid, iban: raw, formatted, country, length: raw.length,
      /* "Well formed" and "real" are different claims. This checks structure and
         check digits — it cannot know whether the account exists. */
      summary: valid
        ? `That IBAN is well formed — a ${country} number of ${raw.length} characters that passes the mod-97 check.`
        : 'That IBAN fails its check digits, so at least one character is wrong.',
      reason: valid ? null : 'checksum'
    }, computed());
  }
};
