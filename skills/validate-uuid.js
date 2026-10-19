import { ok, computed } from '../src/contracts.js';

export default {
  name: 'validateUuid',
  description: "Test a UUID and say which version it is.",
  category: 'validation', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  title: 'Validate UUID',
  replyTemplate: '{{verdict|prose}}',
  inputSchema: {
    type: 'object', required: ['uuid'],
    properties: { uuid: { type: 'string', label: 'uuid', minLength: 1, prompt: 'Which UUID should I check?' } }
  },
  outputSchema: { type: 'object', properties: { valid: { type: 'boolean' }, version: { type: 'integer' }, variant: { type: 'string' }, verdict: { type: 'string' }, normalised: { type: 'string' }, nil: { type: 'boolean' }, problem: { type: 'string' } } },
  examples: [
    { text: 'is this a valid uuid', input: { uuid: '550e8400-e29b-41d4-a716-446655440000' }, output: { valid: true, version: 4, variant: 'RFC 4122', verdict: 'A valid version 4 UUID.', normalised: '550e8400-e29b-41d4-a716-446655440000', nil: false, problem: '' } },
    { text: 'check this v7 identifier', input: { uuid: '018f0c5e-1c3a-7c2e-8b7f-2a3b4c5d6e7f' }, output: { valid: true, version: 7, variant: 'RFC 4122', verdict: 'A valid version 7 UUID.', normalised: '018f0c5e-1c3a-7c2e-8b7f-2a3b4c5d6e7f', nil: false, problem: '' } },
    { text: 'is the nil uuid valid', input: { uuid: '00000000-0000-0000-0000-000000000000' }, output: { valid: true, version: 0, variant: 'nil', verdict: 'The nil UUID — valid, but it identifies nothing.', normalised: '00000000-0000-0000-0000-000000000000', nil: true, problem: '' } },
    { text: 'validate a uuid with the wrong length', input: { uuid: '550e8400-e29b-41d4-a716' }, output: { valid: false, version: 0, variant: '', verdict: 'Not a valid UUID.', normalised: '', nil: false, problem: 'a UUID has 32 hex digits in 8-4-4-4-12 groups' } },
    { text: 'check a uuid in braces', input: { uuid: '{550E8400-E29B-41D4-A716-446655440000}' }, output: { valid: true, version: 4, variant: 'RFC 4122', verdict: 'A valid version 4 UUID.', normalised: '550e8400-e29b-41d4-a716-446655440000', nil: false, problem: '' } }
  ],
  errorCases: [
    { input: {}, code: 'MISSING_FIELD' },
    { input: { uuid: '' }, code: 'MISSING_FIELD' },
    { input: { uuid: ['x'] }, code: 'INVALID_INPUT' }
  ],
  run (input) {
    /* Braces and urn: prefixes are the two wrappers UUIDs turn up in — from
       Windows registries and from URNs respectively. Stripping them means a
       paste from either place validates. */
    const raw = String(input.uuid).trim().replace(/^urn:uuid:/i, '').replace(/^\{|\}$/g, '');
    const lower = raw.toLowerCase();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(lower)) {
      return ok({
        valid: false, version: 0, variant: '', verdict: 'Not a valid UUID.',
        normalised: '', nil: false,
        problem: 'a UUID has 32 hex digits in 8-4-4-4-12 groups'
      }, computed());
    }
    if (/^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(lower)) {
      return ok({
        valid: true, version: 0, variant: 'nil',
        verdict: 'The nil UUID — valid, but it identifies nothing.',
        normalised: lower, nil: true, problem: ''
      }, computed());
    }
    const version = parseInt(lower[14], 16);
    /* The variant lives in the top bits of the 17th digit: 8–b is RFC 4122. */
    const variantNibble = parseInt(lower[19], 16);
    const variant = variantNibble >= 8 && variantNibble <= 11 ? 'RFC 4122'
      : variantNibble <= 7 ? 'reserved (NCS)' : 'reserved (Microsoft or future)';
    return ok({
      valid: true, version, variant,
      verdict: `A valid version ${version} UUID.`,
      normalised: lower, nil: false, problem: ''
    }, computed());
  }
};
