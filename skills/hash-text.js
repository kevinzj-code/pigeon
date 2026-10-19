import { ok, fail, computed } from '../src/contracts.js';
import { toBytes, bytesToHex } from '../src/lib/bytes.js';

const ALGOS = { 'SHA-256': 'SHA-256', 'SHA-1': 'SHA-1', 'SHA-384': 'SHA-384', 'SHA-512': 'SHA-512' };

export default {
  name: 'hashText',
  description: 'Work out the SHA hash of a piece of text.',
  category: 'encoding', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{algorithm|prose}} of that text is {{hash}}.',
  inputSchema: {
    type: 'object', required: ['text'],
    properties: {
      text: { type: 'string', label: 'text', minLength: 1, prompt: 'Which text should I hash?' },
      algorithm: { type: 'string', label: 'algorithm', enum: Object.keys(ALGOS), default: 'SHA-256' }
    }
  },
  outputSchema: { type: 'object', properties: { hash: { type: 'string' }, algorithm: { type: 'string' }, bits: { type: 'integer' }, short: { type: 'string' } } },
  examples: [
    { text: 'sha256 of hello', input: { text: 'hello' }, output: { hash: '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824', algorithm: 'SHA-256', bits: 256, short: '2cf24dba' } },
    { text: 'hash this string', input: { text: 'Pigeon' }, output: { hash: '513a6ac2bc19523ee0ff041fb8a781f462ebb53bf2c13b53c8dd34570b905918', algorithm: 'SHA-256', bits: 256, short: '513a6ac2' } },
    { text: 'sha1 of abc', input: { text: 'abc', algorithm: 'SHA-1' }, output: { hash: 'a9993e364706816aba3e25717850c26c9cd0d89d', algorithm: 'SHA-1', bits: 160, short: 'a9993e36' } },
    { text: 'sha512 of an empty-ish string', input: { text: 'a', algorithm: 'SHA-512' }, output: { hash: '1f40fc92da241694750979ee6cf582f2d5d7d28e18335de05abc54d0560e0f5302860c652bf08d560252aa5e74210546f369fbbbce8c12cfc7957b2652fe9a75', algorithm: 'SHA-512', bits: 512, short: '1f40fc92' } },
    { text: 'checksum this identifier', input: { text: 'user-1234' }, output: { hash: 'c61a1c5012d6c65245f90fa22c6b97542be011998474fc9887ee6299ab93e3e1', algorithm: 'SHA-256', bits: 256, short: 'c61a1c50' } }
  ],
  errorCases: [
    { input: {}, code: 'MISSING_FIELD' },
    { input: { text: '' }, code: 'MISSING_FIELD' },
    { input: { text: 'x', algorithm: 'MD5' }, code: 'INVALID_INPUT' }
  ],
  async run (input) {
    const algo = ALGOS[input.algorithm];
    /* MD5 is deliberately absent. Every algorithm here comes from
       crypto.subtle, which does not implement it — and a hash function that is
       broken for every purpose people reach for it is not one this registry
       should make easy. */
    if (!algo) return fail('INVALID_INPUT', `I don't do ${input.algorithm}.`, 'algorithm');
    if (!globalThis.crypto?.subtle) {
      return fail('INTERNAL', 'No cryptographic hashing is available in this environment.', 'algorithm');
    }
    const digest = await globalThis.crypto.subtle.digest(algo, toBytes(input.text));
    const hash = bytesToHex(new Uint8Array(digest));
    return ok({
      hash, algorithm: input.algorithm, bits: hash.length * 4,
      /* The first eight digits — what people actually paste into a commit
         message or compare by eye. */
      short: hash.slice(0, 8)
    }, computed());
  }
};
