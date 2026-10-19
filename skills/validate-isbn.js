import { ok, computed } from '../src/contracts.js';

export default {
  name: 'validateIsbn',
  description: 'Check an ISBN-10 or ISBN-13 book number against its check digit.',
  category: 'validation', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  title: 'Validate ISBN',
  replyTemplate: '{{verdict|prose}}',
  inputSchema: {
    type: 'object', required: ['isbn'],
    properties: { isbn: { type: 'string', label: 'isbn', minLength: 9, prompt: 'Which ISBN should I check?' } }
  },
  outputSchema: { type: 'object', properties: { valid: { type: 'boolean' }, type: { type: 'string' }, verdict: { type: 'string' }, normalised: { type: 'string' }, checkDigit: { type: 'string' }, expectedCheckDigit: { type: 'string' }, problem: { type: 'string' } } },
  examples: [
    { text: 'is 9780306406157 a valid isbn', input: { isbn: '9780306406157' }, output: { valid: true, type: 'ISBN-13', verdict: 'A valid ISBN-13.', normalised: '9780306406157', checkDigit: '7', expectedCheckDigit: '7', problem: '' } },
    { text: 'check this isbn-10', input: { isbn: '0306406152' }, output: { valid: true, type: 'ISBN-10', verdict: 'A valid ISBN-10.', normalised: '0306406152', checkDigit: '2', expectedCheckDigit: '2', problem: '' } },
    { text: 'validate an isbn with dashes', input: { isbn: '978-0-306-40615-7' }, output: { valid: true, type: 'ISBN-13', verdict: 'A valid ISBN-13.', normalised: '9780306406157', checkDigit: '7', expectedCheckDigit: '7', problem: '' } },
    { text: 'check an isbn-10 ending in X', input: { isbn: '043942089X' }, output: { valid: true, type: 'ISBN-10', verdict: 'A valid ISBN-10.', normalised: '043942089X', checkDigit: 'X', expectedCheckDigit: 'X', problem: '' } },
    { text: 'is 9780306406158 valid', input: { isbn: '9780306406158' }, output: { valid: false, type: 'ISBN-13', verdict: 'Not a valid ISBN-13 — the check digit should be 7.', normalised: '9780306406158', checkDigit: '8', expectedCheckDigit: '7', problem: 'check digit mismatch' } }
  ],
  errorCases: [
    { input: { isbn: '12345' }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' },
    { input: { isbn: 'not-an-isbn' }, code: 'INVALID_INPUT' }
  ],
  run (input) {
    const s = String(input.isbn).replace(/[\s-]/g, '').toUpperCase();
    const badInput = (msg) => ({ ok: false, error: { code: 'INVALID_INPUT', field: 'isbn', message: msg } });

    if (s.length === 10) {
      if (!/^\d{9}[\dX]$/.test(s)) return badInput('An ISBN-10 is nine digits and a check digit, which may be X.');
      /* Weighted 10..1, and the check digit can be X for the value 10 — the
         one place a "digit" is not a digit, and the reason this is not just
         another Luhn. */
      let sum = 0;
      for (let i = 0; i < 9; i++) sum += Number(s[i]) * (10 - i);
      const expectedValue = (11 - (sum % 11)) % 11;
      const expected = expectedValue === 10 ? 'X' : String(expectedValue);
      const valid = s[9] === expected;
      return ok({
        valid, type: 'ISBN-10',
        verdict: valid ? 'A valid ISBN-10.' : `Not a valid ISBN-10 — the check digit should be ${expected}.`,
        normalised: s, checkDigit: s[9], expectedCheckDigit: expected,
        problem: valid ? '' : 'check digit mismatch'
      }, computed());
    }

    if (s.length === 13) {
      if (!/^\d{13}$/.test(s)) return badInput('An ISBN-13 is thirteen digits.');
      let sum = 0;
      for (let i = 0; i < 12; i++) sum += Number(s[i]) * (i % 2 === 0 ? 1 : 3);
      const expected = String((10 - (sum % 10)) % 10);
      const valid = s[12] === expected;
      return ok({
        valid, type: 'ISBN-13',
        verdict: valid ? 'A valid ISBN-13.' : `Not a valid ISBN-13 — the check digit should be ${expected}.`,
        normalised: s, checkDigit: s[12], expectedCheckDigit: expected,
        problem: valid ? '' : 'check digit mismatch'
      }, computed());
    }
    return badInput(`An ISBN has 10 or 13 digits — this has ${s.length}.`);
  }
};
