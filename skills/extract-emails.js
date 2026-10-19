import { ok, computed } from '../src/contracts.js';

/* Deliberately not RFC 5322. The full grammar admits addresses no mail server
   in practice accepts, and a pattern that matches them all matches half a
   sentence too. This is the pragmatic shape, and the skill says "syntax" not
   "valid". */
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*\.[A-Za-z]{2,}/g;

export default {
  name: 'extractEmails',
  description: "List the email addresses written somewhere in a text.",
  category: 'text',
  tier: 'core',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{count}} email {{count|plural:address:addresses}}: {{emails|list}}',
  inputSchema: {
    type: 'object',
    required: ['text'],
    properties: {
      text: { type: 'string', label: 'text', minLength: 1, prompt: 'Which text should I search?' },
      unique: { type: 'boolean', label: 'remove duplicates', default: true }
    }
  },
  outputSchema: { type: 'object', properties: { emails: { type: 'array', items: { type: 'string' } }, count: { type: 'integer' }, domains: { type: 'array', items: { type: 'string' } } } },
  examples: [
    { text: 'get the emails out of this: contact ana@example.com or sales@shop.co.uk', input: { text: 'contact ana@example.com or sales@shop.co.uk' },
      output: { emails: ['ana@example.com', 'sales@shop.co.uk'], count: 2, domains: ['example.com', 'shop.co.uk'] } },
    { text: 'find email addresses in this signature block', input: { text: 'Jo Patel\nHead of Ops\njo.patel+work@company.io\n+44 20 7946 0000' },
      output: { emails: ['jo.patel+work@company.io'], count: 1, domains: ['company.io'] } },
    { text: 'pull the addresses, keeping duplicates', input: { text: 'a@x.com, b@y.com, a@x.com', unique: false },
      output: { emails: ['a@x.com', 'b@y.com', 'a@x.com'], count: 3, domains: ['x.com', 'y.com'] } },
    { text: 'any emails in here?', input: { text: 'No addresses in this sentence at all.' },
      output: { emails: [], count: 0, domains: [] } },
    { text: 'extract emails from a csv line', input: { text: 'name,email\nAna,ana@example.com\nBo,bo@example.com' },
      output: { emails: ['ana@example.com', 'bo@example.com'], count: 2, domains: ['example.com'] } }
  ],
  errorCases: [
    { input: {}, code: 'MISSING_FIELD' },
    { input: { text: ['a@b.com'] }, code: 'INVALID_INPUT' },
    { input: { text: 'a@b.com', unique: 'yes please' }, code: 'INVALID_INPUT' }
  ],
  run (input) {
    let found = input.text.match(EMAIL_RE) ?? [];
    if (input.unique) found = [...new Set(found)];
    return ok({
      emails: found,
      count: found.length,
      domains: [...new Set(found.map(e => e.split('@')[1].toLowerCase()))]
    }, computed());
  }
};
