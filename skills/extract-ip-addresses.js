import { ok, computed } from '../src/contracts.js';

export default {
  name: 'extractIpAddresses',
  description: "Find the IPv4 and IPv6 addresses in a server log.",
  category: 'text', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  title: 'Extract IP addresses',
  replyTemplate: '{{count}} IP {{count|plural:address:addresses}}: {{addresses|list}}',
  inputSchema: {
    type: 'object', required: ['text'],
    properties: {
      text: { type: 'string', label: 'text', minLength: 1, prompt: 'Which text should I search?' },
      unique: { type: 'boolean', label: 'remove duplicates', default: true },
      version: { type: 'string', label: 'ip version', enum: ['both', 'v4', 'v6'], default: 'both' }
    }
  },
  outputSchema: { type: 'object', properties: { addresses: { type: 'array', items: { type: 'string' } }, count: { type: 'integer' }, v4: { type: 'integer' }, v6: { type: 'integer' }, private: { type: 'array', items: { type: 'string' } } } },
  examples: [
    { text: 'get the ip addresses from this log', input: { text: 'from 192.168.1.10 to 8.8.8.8' }, output: { addresses: ['192.168.1.10', '8.8.8.8'], count: 2, v4: 2, v6: 0, private: ['192.168.1.10'] } },
    { text: 'find the ips in these lines', input: { text: 'GET / 10.0.0.5\nGET / 203.0.113.7' }, output: { addresses: ['10.0.0.5', '203.0.113.7'], count: 2, v4: 2, v6: 0, private: ['10.0.0.5'] } },
    { text: 'extract ipv6 addresses', input: { text: 'listening on 2001:0db8:85a3:0000:0000:8a2e:0370:7334' }, output: { addresses: ['2001:0db8:85a3:0000:0000:8a2e:0370:7334'], count: 1, v4: 0, v6: 1, private: [] } },
    { text: 'ignore a version number that looks like an ip', input: { text: 'version 1.2.3 and host 172.16.0.1' }, output: { addresses: ['172.16.0.1'], count: 1, v4: 1, v6: 0, private: ['172.16.0.1'] } },
    { text: 'any ip addresses here', input: { text: 'no addresses in this line' }, output: { addresses: [], count: 0, v4: 0, v6: 0, private: [] } }
  ],
  errorCases: [
    { input: {}, code: 'MISSING_FIELD' },
    { input: { text: '' }, code: 'MISSING_FIELD' },
    { input: { text: '1.2.3.4', version: 'v9' }, code: 'INVALID_INPUT' }
  ],
  run (input) {
    /* Each octet is bounded 0–255 in the pattern itself, so "1.2.3" and
       "999.1.1.1" are not matches. A looser \d{1,3} pattern would report
       version strings and build numbers as addresses. */
    const OCT = '(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)';
    const v4re = new RegExp(`(?<![\\w.])${OCT}(?:\\.${OCT}){3}(?![\\w.])`, 'g');
    const v6re = /(?<![\w:])(?:[0-9a-f]{1,4}:){7}[0-9a-f]{1,4}(?![\w:])/gi;

    let v4 = input.version === 'v6' ? [] : (input.text.match(v4re) ?? []);
    let v6 = input.version === 'v4' ? [] : (input.text.match(v6re) ?? []);
    let all = [...v4, ...v6];
    if (input.unique) {
      all = [...new Set(all)];
      v4 = [...new Set(v4)]; v6 = [...new Set(v6)];
    }
    /* RFC 1918 plus loopback — the ones that mean "this is internal traffic",
       which is usually the point of pulling addresses out of a log. */
    const isPrivate = (ip) => /^10\./.test(ip) || /^192\.168\./.test(ip) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(ip) || /^127\./.test(ip);
    return ok({
      addresses: all, count: all.length, v4: v4.length, v6: v6.length,
      private: all.filter(isPrivate)
    }, computed());
  }
};
