import { ok, fail, computed } from '../src/contracts.js';
import { findSensitive, DETECTORS } from '../src/lib/pii.js';

export default {
  name: 'flagPii',
  description: 'Scan text for personal or sensitive data and report what was found and where, leaving the text unchanged.',
  category: 'text', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null,
  /* Pattern matching, so the badge says estimate and the reply says it plainly:
     this both misses things and fires on things that are not what it thinks. */
  labels: ['estimate'],
  title: 'Flag personal data',
  replyTemplate: '{{count}} possible {{count|plural:item:items}} of personal data: {{lines|list}}. These are pattern matches — they miss things, and they flag things that only look the part.',
  inputSchema: {
    type: 'object', required: ['text'],
    properties: {
      text: { type: 'string', label: 'text', minLength: 1, maxLength: 100000, prompt: 'Which text should I check?' },
      kinds: { type: 'array', label: 'kinds to check', maxItems: 10, items: { type: 'string' }, description: 'limit the check to these kinds' }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      found: { type: 'array' }, lines: { type: 'array', items: { type: 'string' } },
      count: { type: 'integer' }, kinds: { type: 'array', items: { type: 'string' } }, clean: { type: 'boolean' }
    }
  },
  examples: [
    { text: 'check this for personal data', input: { text: 'Contact ana@example.com or call 020 7946 0958.' }, output: { found: [{ kind: 'email', label: 'email address', value: 'ana@example.com', start: 8, end: 23 }, { kind: 'phone', label: 'phone number', value: '020 7946 0958', start: 32, end: 45 }], lines: ['email address: ana@example.com', 'phone number: 020 7946 0958'], count: 2, kinds: ['email', 'phone'], clean: false } },
    { text: 'does this contain a card number', input: { text: 'Card 4111 1111 1111 1111 expires soon.' }, output: { found: [{ kind: 'card', label: 'payment card number', value: '4111 1111 1111 1111', start: 5, end: 24 }], lines: ['payment card number: 4111 1111 1111 1111'], count: 1, kinds: ['card'], clean: false } },
    { text: 'is there any pii here', input: { text: 'No sensitive data in this sentence at all.' }, output: { found: [], lines: [], count: 0, kinds: [], clean: true } },
    { text: 'flag sensitive data in this log line', input: { text: 'Server at 192.168.1.10, postcode SW1A 1AA.' }, output: { found: [{ kind: 'ipv4', label: 'IP address', value: '192.168.1.10', start: 10, end: 22 }, { kind: 'postcode', label: 'UK postcode', value: 'SW1A 1AA', start: 33, end: 41 }], lines: ['IP address: 192.168.1.10', 'UK postcode: SW1A 1AA'], count: 2, kinds: ['ipv4', 'postcode'], clean: false } },
    { text: 'check only for email addresses', input: { text: 'Reach me at bo@example.org or on 07700 900123.', kinds: ['email'] }, output: { found: [{ kind: 'email', label: 'email address', value: 'bo@example.org', start: 12, end: 26 }], lines: ['email address: bo@example.org'], count: 1, kinds: ['email'], clean: false } }
  ],
  errorCases: [
    { input: {}, code: 'MISSING_FIELD' },
    { input: { text: '' }, code: 'MISSING_FIELD' },
    { input: { text: 'hello', kinds: ['telepathy'] }, code: 'INVALID_INPUT' }
  ],
  run (input) {
    const known = DETECTORS.map((d) => d.kind);
    for (const k of input.kinds ?? []) {
      if (!known.includes(k)) return fail('INVALID_INPUT', `I have no detector for "${k}" — I look for ${known.join(', ')}.`, 'kinds');
    }
    const found = findSensitive(input.text, input.kinds);
    return ok({
      found,
      lines: found.map((f) => `${f.label}: ${f.value}`),
      count: found.length,
      kinds: [...new Set(found.map((f) => f.kind))],
      clean: found.length === 0
    }, computed());
  }
};
