import { ok, fail, computed } from '../src/contracts.js';

export default {
  name: 'parseQueryString',
  description: "Break a link’s ?key=value pairs apart and say what each holds.",
  category: 'data', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{count}} {{count|plural:parameter:parameters}}: {{lines|list}}',
  inputSchema: {
    type: 'object', required: ['query'],
    properties: { query: { type: 'string', label: 'query string', minLength: 1, prompt: 'Which query string or URL?' } }
  },
  outputSchema: { type: 'object', properties: { params: { type: 'object' }, lines: { type: 'array', items: { type: 'string' } }, count: { type: 'integer' }, repeated: { type: 'array', items: { type: 'string' } } } },
  examples: [
    { text: 'parse this query string', input: { query: '?name=Ana&age=34' }, output: { params: { name: 'Ana', age: '34' }, lines: ['name = Ana', 'age = 34'], count: 2, repeated: [] } },
    { text: 'break down the parameters in this url', input: { query: 'https://example.com/search?q=pigeon&page=2' }, output: { params: { q: 'pigeon', page: '2' }, lines: ['q = pigeon', 'page = 2'], count: 2, repeated: [] } },
    { text: 'parse a query with encoded values', input: { query: 'q=hello%20world&lang=en-GB' }, output: { params: { q: 'hello world', lang: 'en-GB' }, lines: ['q = hello world', 'lang = en-GB'], count: 2, repeated: [] } },
    { text: 'parse a repeated parameter', input: { query: 'tag=a&tag=b&tag=c' }, output: { params: { tag: ['a', 'b', 'c'] }, lines: ['tag = a, b, c'], count: 1, repeated: ['tag'] } },
    { text: 'parse a parameter with no value', input: { query: 'debug&verbose=1' }, output: { params: { debug: '', verbose: '1' }, lines: ['debug = ', 'verbose = 1'], count: 2, repeated: [] } }
  ],
  errorCases: [
    { input: { query: '???' }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' },
    { input: { query: '' }, code: 'MISSING_FIELD' }
  ],
  run (input) {
    /* A whole URL is accepted, not just the tail — that is what people paste. */
    const raw = String(input.query).trim();
    const qs = raw.includes('?') ? raw.slice(raw.indexOf('?') + 1) : raw;
    const body = qs.split('#')[0];
    if (!body || !/[^&?=]/.test(body)) return fail('INVALID_INPUT', 'There are no parameters in that.', 'query');

    const params = {};
    const repeated = [];
    for (const pair of body.split('&')) {
      if (!pair) continue;
      const eq = pair.indexOf('=');
      const rawKey = eq === -1 ? pair : pair.slice(0, eq);
      const rawVal = eq === -1 ? '' : pair.slice(eq + 1);
      const dec = (s) => { try { return decodeURIComponent(s.replace(/\+/g, ' ')); } catch { return s; } };
      const key = dec(rawKey);
      const value = dec(rawVal);
      /* A repeated key becomes an array rather than the last value winning —
         "tag=a&tag=b" means both, and silently dropping one is data loss. */
      if (key in params) {
        params[key] = Array.isArray(params[key]) ? [...params[key], value] : [params[key], value];
        if (!repeated.includes(key)) repeated.push(key);
      } else {
        params[key] = value;
      }
    }
    return ok({
      params,
      lines: Object.entries(params).map(([k, v]) => `${k} = ${Array.isArray(v) ? v.join(', ') : v}`),
      count: Object.keys(params).length, repeated
    }, computed());
  }
};
