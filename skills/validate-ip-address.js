import { ok, computed } from '../src/contracts.js';

export default {
  name: 'validateIpAddress',
  description: "Test an IP address and say whether it is IPv4, IPv6 or neither.",
  category: 'validation', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  title: 'Validate IP address',
  replyTemplate: '{{verdict|prose}}',
  inputSchema: {
    type: 'object', required: ['address'],
    properties: { address: { type: 'string', label: 'ip address', minLength: 1, prompt: 'Which address should I check?' } }
  },
  outputSchema: { type: 'object', properties: { valid: { type: 'boolean' }, version: { type: 'string' }, verdict: { type: 'string' }, scope: { type: 'string' }, address: { type: 'string' }, problem: { type: 'string' } } },
  examples: [
    { text: 'is 192.168.1.1 a valid ip', input: { address: '192.168.1.1' }, output: { valid: true, version: 'IPv4', verdict: 'A valid IPv4 address on a private network.', scope: 'private', address: '192.168.1.1', problem: '' } },
    { text: 'check 8.8.8.8', input: { address: '8.8.8.8' }, output: { valid: true, version: 'IPv4', verdict: 'A valid IPv4 address, publicly routable.', scope: 'public', address: '8.8.8.8', problem: '' } },
    { text: 'is 256.1.1.1 valid', input: { address: '256.1.1.1' }, output: { valid: false, version: '', verdict: 'Not a valid IP address.', scope: '', address: '256.1.1.1', problem: '256 is above the maximum of 255' } },
    { text: 'validate the loopback address', input: { address: '127.0.0.1' }, output: { valid: true, version: 'IPv4', verdict: 'A valid IPv4 address on the loopback interface.', scope: 'loopback', address: '127.0.0.1', problem: '' } },
    { text: 'check an ipv6 address', input: { address: '2001:0db8:85a3:0000:0000:8a2e:0370:7334' }, output: { valid: true, version: 'IPv6', verdict: 'A valid IPv6 address, publicly routable.', scope: 'public', address: '2001:0db8:85a3:0000:0000:8a2e:0370:7334', problem: '' } }
  ],
  errorCases: [
    { input: {}, code: 'MISSING_FIELD' },
    { input: { address: '' }, code: 'MISSING_FIELD' },
    { input: { address: ['1.2.3.4'] }, code: 'INVALID_INPUT' }
  ],
  run (input) {
    const raw = String(input.address).trim();
    const bad = (problem) => ok({ valid: false, version: '', verdict: 'Not a valid IP address.', scope: '', address: raw, problem }, computed());

    if (raw.includes(':')) {
      /* Full form or one :: shorthand. A second :: is ambiguous about how many
         zero groups it stands for, so it is invalid rather than guessed at. */
      if ((raw.match(/::/g) ?? []).length > 1) return bad('an address can contain :: only once');
      const groups = raw.split(':').filter(g => g !== '');
      if (groups.some(g => !/^[0-9a-f]{1,4}$/i.test(g))) return bad('each group must be one to four hex digits');
      if (!raw.includes('::') && raw.split(':').length !== 8) return bad(`an IPv6 address has 8 groups — this has ${raw.split(':').length}`);
      const scope = /^fe80:/i.test(raw) ? 'link-local' : /^f[cd]/i.test(raw) ? 'private' : /^(::1)$/.test(raw) ? 'loopback' : 'public';
      return ok({
        valid: true, version: 'IPv6',
        verdict: `A valid IPv6 address${scope === 'public' ? ', publicly routable' : ` on ${scope === 'loopback' ? 'the loopback interface' : `a ${scope} network`}`}.`,
        scope, address: raw, problem: ''
      }, computed());
    }

    const parts = raw.split('.');
    if (parts.length !== 4) return bad(`an IPv4 address has four parts — this has ${parts.length}`);
    for (const p of parts) {
      if (!/^\d{1,3}$/.test(p)) return bad(`"${p}" is not a number from 0 to 255`);
      if (Number(p) > 255) return bad(`${Number(p)} is above the maximum of 255`);
    }
    const n = parts.map(Number);
    const scope = n[0] === 127 ? 'loopback'
      : n[0] === 10 || (n[0] === 192 && n[1] === 168) || (n[0] === 172 && n[1] >= 16 && n[1] <= 31) ? 'private'
        : n[0] === 169 && n[1] === 254 ? 'link-local'
          : n[0] >= 224 && n[0] <= 239 ? 'multicast' : 'public';
    return ok({
      valid: true, version: 'IPv4',
      verdict: `A valid IPv4 address${scope === 'public' ? ', publicly routable' : scope === 'loopback' ? ' on the loopback interface' : ` on a ${scope} network`}.`,
      scope, address: raw, problem: ''
    }, computed());
  }
};
