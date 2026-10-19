import { ok, fail, computed } from '../src/contracts.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export default {
  name: 'generateUuid',
  description: 'Generate a UUID — a GUID, a v4 random identifier — one or several.',
  category: 'encoding', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  title: 'Generate UUID',
  /* §20's "seeded, reproducible" rule does NOT apply here, and the exception is
     the point: a UUID that a seed could reproduce is not unique, which is the
     only property it has. Declared nondeterministic so the test suite checks
     the SHAPE via verify() instead of comparing to a fixed value — see
     registry.js, which refuses one without the other. */
  nondeterministic: true,
  replyTemplate: '{{uuids|list}}',
  inputSchema: {
    type: 'object',
    properties: {
      count: { type: 'integer', label: 'how many', minimum: 1, maximum: 100, default: 1 },
      uppercase: { type: 'boolean', label: 'uppercase', default: false }
    }
  },
  outputSchema: { type: 'object', properties: { uuids: { type: 'array', items: { type: 'string' } }, first: { type: 'string' }, count: { type: 'integer' }, version: { type: 'integer' } } },
  examples: [
    { text: 'generate a uuid', input: {}, output: { uuids: ['(random)'], first: '(random)', count: 1, version: 4 } },
    { text: 'give me a v4 identifier', input: { count: 1 }, output: { uuids: ['(random)'], first: '(random)', count: 1, version: 4 } },
    { text: 'make 3 uuids', input: { count: 3 }, output: { uuids: ['(random)'], first: '(random)', count: 3, version: 4 } },
    { text: 'generate 5 unique ids', input: { count: 5 }, output: { uuids: ['(random)'], first: '(random)', count: 5, version: 4 } },
    { text: 'a uuid in capitals', input: { uppercase: true }, output: { uuids: ['(random)'], first: '(random)', count: 1, version: 4 } },
    { text: 'give me a fresh guid', input: {  },
      output: { uuids: ['(random)'], first: '(random)', count: 1, version: 4 } },
    { text: 'I need a new unique id', input: {  },
      output: { uuids: ['(random)'], first: '(random)', count: 1, version: 4 } }
  ],
  errorCases: [
    { input: { count: 0 }, code: 'INVALID_INPUT' },
    { input: { count: 500 }, code: 'INVALID_INPUT' },
    { input: { count: 'a few' }, code: 'INVALID_INPUT' }
  ],
  /** What must hold of EVERY run, since no single output can be asserted. */
  verify (value, input) {
    if (value.count !== (input.count ?? 1)) return `asked for ${input.count ?? 1}, got ${value.count}`;
    if (value.uuids.length !== value.count) return 'count does not match the list length';
    if (new Set(value.uuids).size !== value.uuids.length) return 'two generated UUIDs were identical';
    for (const u of value.uuids) {
      if (!UUID_RE.test(u.toLowerCase())) return `"${u}" is not a well-formed v4 UUID`;
    }
    if (input.uppercase && value.uuids.some(u => u !== u.toUpperCase())) return 'uppercase was requested but not applied';
    return true;
  },
  run (input) {
    if (!globalThis.crypto?.getRandomValues) {
      return fail('INTERNAL', 'No secure random source is available in this environment.', 'count');
    }
    const uuids = Array.from({ length: input.count }, () => {
      /* randomUUID where it exists; otherwise the same construction by hand
         from CSPRNG bytes — version nibble to 4, variant nibble to 8–b. Never
         Math.random(), which is predictable and would make collisions likely
         rather than astronomically unlikely. */
      if (globalThis.crypto.randomUUID) return globalThis.crypto.randomUUID();
      const b = globalThis.crypto.getRandomValues(new Uint8Array(16));
      b[6] = (b[6] & 0x0f) | 0x40;
      b[8] = (b[8] & 0x3f) | 0x80;
      const hex = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }).map(u => (input.uppercase ? u.toUpperCase() : u));

    return ok({ uuids, first: uuids[0], count: uuids.length, version: 4 }, computed());
  }
};
