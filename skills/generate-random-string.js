import { ok, fail, computed } from '../src/contracts.js';
import { round } from '../src/lib/num.js';

const SETS = {
  alphanumeric: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
  letters: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz',
  digits: '0123456789',
  hex: '0123456789abcdef',
  /* No 0/O or 1/l/I — the point of this set is a code someone reads aloud or
     copies off a screen without getting it wrong. */
  unambiguous: 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789',
  symbols: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()-_=+[]{}'
};

export default {
  name: 'generateRandomString',
  description: 'Generate a random string of a given length from a character set you choose.',
  category: 'encoding', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  /* Not seeded, deliberately — §15 specifies a CSPRNG, and a reproducible
     password generator would be a security hole rather than a feature. */
  nondeterministic: true,
  replyTemplate: '{{result|prose}} — {{length}} characters from the {{charset|prose}} set, about {{entropyBits}} bits of entropy.',
  inputSchema: {
    type: 'object',
    properties: {
      length: { type: 'integer', label: 'length', minimum: 1, maximum: 512, default: 16 },
      charset: { type: 'string', label: 'character set', enum: Object.keys(SETS), default: 'alphanumeric' }
    }
  },
  outputSchema: { type: 'object', properties: { result: { type: 'string' }, length: { type: 'integer' }, charset: { type: 'string' }, alphabetSize: { type: 'integer' }, entropyBits: { type: 'number' } } },
  examples: [
    { text: 'generate a random string', input: {}, output: { result: '(random)', length: 16, charset: 'alphanumeric', alphabetSize: 62, entropyBits: 95.27 } },
    { text: 'make a 32 character random string', input: { length: 32 }, output: { result: '(random)', length: 32, charset: 'alphanumeric', alphabetSize: 62, entropyBits: 190.54 } },
    { text: 'generate a random code people can read out', input: { length: 8, charset: 'unambiguous' }, output: { result: '(random)', length: 8, charset: 'unambiguous', alphabetSize: 56, entropyBits: 46.44 } },
    { text: 'random hex string of 12', input: { length: 12, charset: 'hex' }, output: { result: '(random)', length: 12, charset: 'hex', alphabetSize: 16, entropyBits: 48 } },
    { text: 'a strong random password with symbols', input: { length: 20, charset: 'symbols' }, output: { result: '(random)', length: 20, charset: 'symbols', alphabetSize: 80, entropyBits: 126.44 } }
  ],
  errorCases: [
    { input: { length: 0 }, code: 'INVALID_INPUT' },
    { input: { length: 5000 }, code: 'INVALID_INPUT' },
    { input: { charset: 'emoji' }, code: 'INVALID_INPUT' }
  ],
  verify (value, input) {
    const wantLength = input.length ?? 16;
    const set = SETS[input.charset ?? 'alphanumeric'];
    if (value.result.length !== wantLength) return `asked for ${wantLength} characters, got ${value.result.length}`;
    for (const c of value.result) if (!set.includes(c)) return `"${c}" is not in the ${input.charset ?? 'alphanumeric'} set`;
    if (value.alphabetSize !== set.length) return 'reported alphabet size does not match the set';
    return true;
  },
  run (input) {
    const set = SETS[input.charset];
    if (!set) return fail('INVALID_INPUT', `I don't have a "${input.charset}" character set.`, 'charset');
    if (!globalThis.crypto?.getRandomValues) {
      return fail('INTERNAL', 'No secure random source is available in this environment.', 'length');
    }
    /* Rejection sampling, not `% set.length`. The modulo would make the first
       (256 % 62) characters of the alphabet more likely than the rest — a real
       bias, small enough to go unnoticed and exactly the kind of thing that
       quietly weakens a generated password. */
    const out = [];
    const limit = Math.floor(256 / set.length) * set.length;
    while (out.length < input.length) {
      const bytes = globalThis.crypto.getRandomValues(new Uint8Array(input.length));
      for (const b of bytes) {
        if (b >= limit) continue;
        out.push(set[b % set.length]);
        if (out.length === input.length) break;
      }
    }
    return ok({
      result: out.join(''), length: input.length, charset: input.charset,
      alphabetSize: set.length,
      entropyBits: round(input.length * Math.log2(set.length), 2)
    }, computed());
  }
};
