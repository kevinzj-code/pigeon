import { ok, computed } from '../src/contracts.js';

export default {
  name: 'validateUrl',
  description: "Say whether a web address is well formed, and split out its host and path.",
  category: 'validation',
  tier: 'core',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  title: 'Validate URL',
  replyTemplate: '{{url}} — {{verdict|prose}}. Host {{host}}, path {{path}}.',
  inputSchema: {
    type: 'object',
    required: ['url'],
    properties: { url: { type: 'string', label: 'url', minLength: 1, prompt: 'Which address should I check?' } }
  },
  outputSchema: {
    type: 'object',
    properties: {
      valid: { type: 'boolean' }, verdict: { type: 'string' }, url: { type: 'string' },
      protocol: { type: 'string' }, host: { type: 'string' }, path: { type: 'string' },
      query: { type: 'string' }, fragment: { type: 'string' }, port: { type: 'string' },
      problem: { type: 'string' }
    }
  },
  examples: [
    { text: 'is https://example.com/docs a valid url', input: { url: 'https://example.com/docs' },
      output: { valid: true, verdict: 'valid', url: 'https://example.com/docs', protocol: 'https', host: 'example.com', path: '/docs', query: '', fragment: '', port: '', problem: '' } },
    { text: 'break this url into its parts', input: { url: 'https://shop.example.co.uk:8443/cart?item=42&qty=2#summary' },
      output: { valid: true, verdict: 'valid', url: 'https://shop.example.co.uk:8443/cart?item=42&qty=2#summary', protocol: 'https', host: 'shop.example.co.uk', path: '/cart', query: 'item=42&qty=2', fragment: 'summary', port: '8443', problem: '' } },
    { text: 'check www.example.org without a protocol', input: { url: 'www.example.org' },
      output: { valid: true, verdict: 'valid', url: 'www.example.org', protocol: 'https', host: 'www.example.org', path: '/', query: '', fragment: '', port: '', problem: '' } },
    { text: 'is "not a url at all" valid', input: { url: 'not a url at all' },
      output: { valid: false, verdict: 'not valid', url: 'not a url at all', protocol: '', host: '', path: '', query: '', fragment: '', port: '', problem: "it isn't in the shape of a web address" } },
    { text: 'validate an ftp address', input: { url: 'ftp://files.example.com/pub' },
      output: { valid: true, verdict: 'valid', url: 'ftp://files.example.com/pub', protocol: 'ftp', host: 'files.example.com', path: '/pub', query: '', fragment: '', port: '', problem: '' } }
  ],
  errorCases: [
    { input: {}, code: 'MISSING_FIELD' },
    { input: { url: '' }, code: 'MISSING_FIELD' },
    { input: { url: ['https://a.io'] }, code: 'INVALID_INPUT' }
  ],
  run (input) {
    const raw = String(input.url).trim();
    const bad = (problem) => ok({
      valid: false, verdict: 'not valid', url: raw,
      protocol: '', host: '', path: '', query: '', fragment: '', port: '', problem
    }, computed());

    /* A bare "example.com" is what people type and mean. Assuming https is a
       parsing convenience, and `protocol` reports what was assumed rather than
       pretending the user wrote it. */
    const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
    let u;
    try { u = new URL(candidate); }
    catch { return bad("it isn't in the shape of a web address"); }

    if (!u.hostname || !u.hostname.includes('.')) return bad('the host has no dot in it');
    if (/\s/.test(raw)) return bad("it isn't in the shape of a web address");

    return ok({
      valid: true, verdict: 'valid', url: raw,
      protocol: u.protocol.replace(':', ''),
      host: u.hostname,
      path: u.pathname,
      query: u.search.replace(/^\?/, ''),
      fragment: u.hash.replace(/^#/, ''),
      port: u.port,
      problem: ''
    }, computed());
  }
};
