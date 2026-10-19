import { ok, computed } from '../src/contracts.js';

export default {
  name: 'validateLuhn',
  description: 'Check a card number against the Luhn checksum.',
  category: 'validation', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  title: 'Luhn check',
  replyTemplate: '{{verdict|prose}}',
  inputSchema: {
    type: 'object', required: ['number'],
    properties: { number: { type: 'string', label: 'number', minLength: 2, prompt: 'Which number should I check?' } }
  },
  outputSchema: { type: 'object', properties: { valid: { type: 'boolean' }, verdict: { type: 'string' }, digits: { type: 'integer' }, checkDigit: { type: 'integer' }, expectedCheckDigit: { type: 'integer' }, masked: { type: 'string' } } },
  examples: [
    { text: 'is 4539578763621486 a valid card number', input: { number: '4539578763621486' }, output: { valid: true, verdict: 'The checksum is correct.', digits: 16, checkDigit: 6, expectedCheckDigit: 6, masked: '************1486' } },
    { text: 'check this number passes luhn', input: { number: '79927398713' }, output: { valid: true, verdict: 'The checksum is correct.', digits: 11, checkDigit: 3, expectedCheckDigit: 3, masked: '*******8713' } },
    { text: 'validate a number with a typo', input: { number: '79927398714' }, output: { valid: false, verdict: 'The checksum does not match — the last digit should be 3.', digits: 11, checkDigit: 4, expectedCheckDigit: 3, masked: '*******8714' } },
    { text: 'check a number written with spaces', input: { number: '4539 5787 6362 1486' }, output: { valid: true, verdict: 'The checksum is correct.', digits: 16, checkDigit: 6, expectedCheckDigit: 6, masked: '************1486' } },
    { text: 'luhn check a short number', input: { number: '18' }, output: { valid: true, verdict: 'The checksum is correct.', digits: 2, checkDigit: 8, expectedCheckDigit: 8, masked: '**18' } }
  ],
  errorCases: [
    { input: { number: 'abcd' }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' },
    { input: { number: '1' }, code: 'INVALID_INPUT' }
  ],
  run (input) {
    const digits = String(input.number).replace(/[\s-]/g, '');
    if (!/^\d{2,}$/.test(digits)) {
      return { ok: false, error: { code: 'INVALID_INPUT', field: 'number', message: 'That needs to be at least two digits, with only spaces or dashes between them.' } };
    }
    /* Luhn: double every second digit from the right, subtract 9 if that goes
       past 9, and the total must be a multiple of 10. It catches every
       single-digit error and most transpositions — which is all it claims. It
       says nothing about whether the account exists. */
    const sumFor = (body) => {
      let sum = 0;
      let double = true;
      for (let i = body.length - 1; i >= 0; i--) {
        let d = Number(body[i]);
        if (double) { d *= 2; if (d > 9) d -= 9; }
        double = !double;
        sum += d;
      }
      return sum;
    };
    const checkDigit = Number(digits[digits.length - 1]);
    const withoutCheck = digits.slice(0, -1);
    const expected = (10 - (sumFor(withoutCheck) % 10)) % 10;
    const valid = checkDigit === expected;
    /* Masked, always. Echoing a full card number back into a transcript is a
       thing this skill should never do, and the check does not need it. */
    return ok({
      valid,
      verdict: valid ? 'The checksum is correct.' : `The checksum does not match — the last digit should be ${expected}.`,
      digits: digits.length, checkDigit, expectedCheckDigit: expected,
      masked: '*'.repeat(Math.max(2, digits.length - 4)) + digits.slice(-4)
    }, computed());
  }
};
