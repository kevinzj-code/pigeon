import { ok, computed } from '../src/contracts.js';

/* SYNTAX, not deliverability — the index says "Syntax check" and the skill says
   so out loud. A syntactically perfect address can bounce, and nothing here
   can tell you whether a mailbox exists. Refusing to imply otherwise is the
   whole reason `checks` is returned rather than a bare true/false. */
const LOCAL = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/;
const DOMAIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

export default {
  name: 'validateEmail',
  description: "Say whether an email address is written correctly.",
  category: 'validation',
  tier: 'core',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{email}} — {{verdict|prose}}. This checks the spelling only, not whether the mailbox exists.',
  inputSchema: {
    type: 'object',
    required: ['email'],
    properties: { email: { type: 'string', label: 'email address', minLength: 1, prompt: 'Which email address should I check?' } }
  },
  outputSchema: {
    type: 'object',
    properties: {
      valid: { type: 'boolean' }, verdict: { type: 'string' }, email: { type: 'string' },
      local: { type: 'string' }, domain: { type: 'string' }, tld: { type: 'string' },
      problem: { type: 'string' }
    }
  },
  examples: [
    { text: 'is ana@example.com a valid email', input: { email: 'ana@example.com' },
      output: { valid: true, verdict: 'looks correctly formed', email: 'ana@example.com', local: 'ana', domain: 'example.com', tld: 'com', problem: '' } },
    { text: 'check jo.patel+work@company.co.uk', input: { email: 'jo.patel+work@company.co.uk' },
      output: { valid: true, verdict: 'looks correctly formed', email: 'jo.patel+work@company.co.uk', local: 'jo.patel+work', domain: 'company.co.uk', tld: 'uk', problem: '' } },
    { text: 'is this email valid: no-at-sign.com', input: { email: 'no-at-sign.com' },
      output: { valid: false, verdict: 'not valid', email: 'no-at-sign.com', local: '', domain: '', tld: '', problem: 'there is no @ in it' } },
    { text: 'check ana@localhost', input: { email: 'ana@localhost' },
      output: { valid: false, verdict: 'not valid', email: 'ana@localhost', local: 'ana', domain: 'localhost', tld: '', problem: 'the domain has no dot in it' } },
    { text: 'validate .leading@example.com', input: { email: '.leading@example.com' },
      output: { valid: false, verdict: 'not valid', email: '.leading@example.com', local: '.leading', domain: 'example.com', tld: 'com', problem: 'the part before the @ is not well formed' } }
  ],
  errorCases: [
    { input: {}, code: 'MISSING_FIELD' },
    { input: { email: '' }, code: 'MISSING_FIELD' },
    { input: { email: ['a@b.com'] }, code: 'INVALID_INPUT' }
  ],
  run (input) {
    const email = String(input.email).trim();
    const at = email.lastIndexOf('@');
    const result = (valid, problem, local = '', domain = '') => ok({
      valid, verdict: valid ? 'looks correctly formed' : 'not valid', email,
      local, domain, tld: domain.includes('.') ? domain.split('.').pop() : '',
      problem
    }, computed());

    if (at === -1) return result(false, 'there is no @ in it');
    const local = email.slice(0, at);
    const domain = email.slice(at + 1);
    if (!local) return result(false, 'there is nothing before the @', local, domain);
    if (!domain) return result(false, 'there is nothing after the @', local, domain);
    if (email.length > 254) return result(false, 'it is longer than an address is allowed to be', local, domain);
    if (local.length > 64) return result(false, 'the part before the @ is too long', local, domain);
    if (!domain.includes('.')) return result(false, 'the domain has no dot in it', local, domain);
    if (!LOCAL.test(local)) return result(false, 'the part before the @ is not well formed', local, domain);
    if (!DOMAIN.test(domain)) return result(false, 'the domain is not well formed', local, domain);
    return result(true, '', local, domain);
  }
};
