import { ok, fail, computed } from '../src/contracts.js';

export default {
  name: 'buildQueryString',
  description: "Assemble a ?key=value query string from named parameters.",
  category: 'data', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{count}} {{count|plural:parameter:parameters}}: {{url}}',
  inputSchema: {
    type: 'object', required: ['params'],
    properties: {
      params: { type: 'object', label: 'parameters', prompt: 'Which parameters should I build the query from?' },
      baseUrl: { type: 'string', label: 'base url', description: 'a URL to hang the query off' },
      sort: { type: 'boolean', label: 'sort alphabetically', default: false, description: 'put the parameters in alphabetical order' }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string' }, url: { type: 'string' },
      count: { type: 'integer' }, keyCount: { type: 'integer' }
    }
  },
  examples: [
    { text: 'build a query string from these parameters', input: { params: { name: 'Ana', age: 34 } }, output: { query: 'name=Ana&age=34', url: 'name=Ana&age=34', count: 2, keyCount: 2 } },
    { text: 'make a query string with a space in the value', input: { params: { q: 'hello world' } }, output: { query: 'q=hello%20world', url: 'q=hello%20world', count: 1, keyCount: 1 } },
    { text: 'build a query with a repeated parameter', input: { params: { tag: ['a', 'b'] } }, output: { query: 'tag=a&tag=b', url: 'tag=a&tag=b', count: 2, keyCount: 1 } },
    { text: 'add a search query to this url', input: { params: { q: 'pigeon' }, baseUrl: 'https://example.com/search' }, output: { query: 'q=pigeon', url: 'https://example.com/search?q=pigeon', count: 1, keyCount: 1 } },
    { text: 'build a query string in alphabetical order', input: { params: { b: 2, a: 1 }, sort: true }, output: { query: 'a=1&b=2', url: 'a=1&b=2', count: 2, keyCount: 2 } }
  ],
  errorCases: [
    { input: { params: {} }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' },
    { input: { params: { a: { nested: true } } }, code: 'INVALID_INPUT' },
    { input: { params: { a: 1 }, baseUrl: 'not a url' }, code: 'INVALID_INPUT' }
  ],
  run (input) {
    let entries = Object.entries(input.params);
    if (!entries.length) return fail('INVALID_INPUT', 'There are no parameters to build a query from.', 'params');
    if (input.sort) entries = [...entries].sort((a, b) => a[0].localeCompare(b[0]));

    const pairs = [];
    for (const [key, value] of entries) {
      const many = Array.isArray(value) ? value : [value];
      for (const v of many) {
        if (v !== null && typeof v === 'object') {
          return fail('INVALID_INPUT', `"${key}" holds a nested object, and a query string can only carry flat text values — flatten it first.`, 'params');
        }
        /* encodeURIComponent, not encodeURI: this is a single value going into
           one parameter, so & = ? and # inside it must be escaped or they would
           be read as structure rather than as content. */
        pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(v === null || v === undefined ? '' : v)}`);
      }
    }

    const query = pairs.join('&');
    let url = query;
    if (input.baseUrl) {
      let base;
      try { base = new URL(input.baseUrl); }
      catch { return fail('INVALID_INPUT', `"${input.baseUrl}" is not a URL I can attach a query to.`, 'baseUrl'); }
      const joiner = base.search ? '&' : '?';
      url = `${input.baseUrl}${joiner}${query}`;
    }

    return ok({ query, url, count: pairs.length, keyCount: entries.length }, computed());
  }
};
