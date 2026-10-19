import { ok, fail, computed } from '../src/contracts.js';
import { round } from '../src/lib/num.js';
import { WORDS } from '../src/lib/wordlist.js';

export default {
  name: 'generatePassphrase',
  description: 'Generate a memorable passphrase from random words.',
  category: 'encoding', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  /* Not seeded. A passphrase you could reproduce from a seed is only as secret
     as the seed, and the whole point of this one is that nothing anywhere can
     reproduce it. Same reasoning as generateRandomString. */
  nondeterministic: true,
  replyTemplate: '{{passphrase|prose}} — {{wordCount}} words from a list of {{alphabetSize}}, about {{entropyBits}} bits of entropy.',
  inputSchema: {
    type: 'object',
    properties: {
      words: { type: 'integer', label: 'number of words', minimum: 2, maximum: 12, default: 5 },
      separator: { type: 'string', label: 'separator', maxLength: 3, default: '-' },
      capitalise: { type: 'boolean', label: 'capitalise', default: false },
      number: { type: 'boolean', label: 'add a number', default: false, description: 'add a two-digit number on the end' }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      passphrase: { type: 'string' }, wordCount: { type: 'integer' },
      alphabetSize: { type: 'integer' }, entropyBits: { type: 'number' }
    }
  },
  examples: [
    { text: 'generate a passphrase', input: {}, output: { passphrase: '(random)', wordCount: 5, alphabetSize: 512, entropyBits: 45 } },
    { text: 'make a memorable password from words', input: { words: 4 }, output: { passphrase: '(random)', wordCount: 4, alphabetSize: 512, entropyBits: 36 } },
    { text: 'passphrase with six words separated by dots', input: { words: 6, separator: '.' }, output: { passphrase: '(random)', wordCount: 6, alphabetSize: 512, entropyBits: 54 } },
    { text: 'generate a capitalised passphrase with a number', input: { words: 4, capitalise: true, number: true }, output: { passphrase: '(random)', wordCount: 4, alphabetSize: 512, entropyBits: 42.64 } },
    { text: 'a long passphrase of eight words', input: { words: 8 }, output: { passphrase: '(random)', wordCount: 8, alphabetSize: 512, entropyBits: 72 } }
  ],
  errorCases: [
    { input: { words: 1 }, code: 'INVALID_INPUT' },
    { input: { words: 40 }, code: 'INVALID_INPUT' },
    { input: { separator: 'wayTooLong' }, code: 'INVALID_INPUT' }
  ],
  verify (value, input) {
    const wanted = input.words ?? 5;
    const sep = input.separator ?? '-';
    const parts = value.passphrase.split(sep);
    const expected = wanted + (input.number ? 1 : 0);
    if (parts.length !== expected) return `expected ${expected} segments, got ${parts.length}`;
    if (input.number && !/^\d{2}$/.test(parts[parts.length - 1])) return 'the trailing number is not two digits';
    for (const p of parts.slice(0, wanted)) {
      if (!WORDS.includes(p.toLowerCase())) return `"${p}" is not in the word list`;
      if (input.capitalise && p[0] !== p[0].toUpperCase()) return `"${p}" was not capitalised`;
    }
    if (value.wordCount !== wanted) return 'reported word count does not match';
    if (value.alphabetSize !== WORDS.length) return 'reported alphabet size does not match the list';
    return true;
  },
  run (input) {
    if (!globalThis.crypto?.getRandomValues) {
      return fail('INTERNAL', 'No secure random source is available in this environment.', 'words');
    }
    const count = input.words ?? 5;
    const sep = input.separator ?? '-';

    /* 65536 is an exact multiple of 512, so masking a random 16-bit value down
       to 9 bits is uniform and needs no rejection step. That is the only reason
       the list is 512 long rather than a round-sounding 500. */
    const picks = globalThis.crypto.getRandomValues(new Uint16Array(count));
    const chosen = [...picks].map((v) => {
      const w = WORDS[v & (WORDS.length - 1)];
      return input.capitalise ? w[0].toUpperCase() + w.slice(1) : w;
    });

    let entropyBits = count * Math.log2(WORDS.length);
    if (input.number) {
      const d = globalThis.crypto.getRandomValues(new Uint32Array(1))[0] % 100;
      chosen.push(String(d).padStart(2, '0'));
      entropyBits += Math.log2(100);
    }

    /* No "characters" field. It would vary with the words drawn, so no example
       could state it honestly, and the suite skips output comparison for a
       nondeterministic skill — a wrong number there would never be caught. */
    return ok({
      passphrase: chosen.join(sep), wordCount: count, alphabetSize: WORDS.length,
      entropyBits: round(entropyBits, 2)
    }, computed());
  }
};
