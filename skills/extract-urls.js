import { ok, computed } from '../src/contracts.js';

/* Trailing punctuation is the whole problem here: "see https://x.com/a." must
   not capture the full stop, but "https://x.com/a.b" must keep the dot. The
   pattern captures greedily and then walks the closing punctuation back off,
   balancing brackets, which is the only approach that gets both right. */
const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"'`]+/gi;

function trimTrailing (url) {
  let out = url;
  for (;;) {
    const last = out[out.length - 1];
    if (!'.,;:!?'.includes(last) && !((last === ')' || last === ']') && count(out, last) > count(out, last === ')' ? '(' : '['))) break;
    out = out.slice(0, -1);
  }
  return out;
}
const count = (s, ch) => s.split(ch).length - 1;

export default {
  name: 'extractUrls',
  description: 'List the web addresses appearing in a block of text.',
  category: 'text',
  tier: 'core',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  title: 'Extract URLs',
  replyTemplate: '{{count}} {{count|plural:link:links}}: {{urls|list}}',
  inputSchema: {
    type: 'object',
    required: ['text'],
    properties: {
      text: { type: 'string', label: 'text', minLength: 1, prompt: 'Which text should I search?' },
      unique: { type: 'boolean', label: 'remove duplicates', default: true }
    }
  },
  outputSchema: { type: 'object', properties: { urls: { type: 'array', items: { type: 'string' } }, count: { type: 'integer' }, hosts: { type: 'array', items: { type: 'string' } } } },
  examples: [
    { text: 'get the links from: see https://example.com/docs and www.other.org', input: { text: 'see https://example.com/docs and www.other.org' },
      output: { urls: ['https://example.com/docs', 'www.other.org'], count: 2, hosts: ['example.com', 'other.org'] } },
    { text: 'extract the url, ignore the full stop', input: { text: 'Read more at https://news.site/article-42.' },
      output: { urls: ['https://news.site/article-42'], count: 1, hosts: ['news.site'] } },
    { text: 'find links in a markdown line', input: { text: 'Docs are [here](https://docs.example.com/start) today.' },
      output: { urls: ['https://docs.example.com/start'], count: 1, hosts: ['docs.example.com'] } },
    { text: 'any links in this text', input: { text: 'There is no link in this sentence.' },
      output: { urls: [], count: 0, hosts: [] } },
    { text: 'pull both urls with the query strings intact', input: { text: 'http://a.io/x?q=1 and https://b.io/y?z=2#top' },
      output: { urls: ['http://a.io/x?q=1', 'https://b.io/y?z=2#top'], count: 2, hosts: ['a.io', 'b.io'] } }
  ],
  errorCases: [
    { input: {}, code: 'MISSING_FIELD' },
    { input: { text: { url: 'x' } }, code: 'INVALID_INPUT' },
    { input: { text: 'https://a.io', unique: 'sure' }, code: 'INVALID_INPUT' }
  ],
  run (input) {
    let found = (input.text.match(URL_RE) ?? []).map(trimTrailing).filter(Boolean);
    if (input.unique) found = [...new Set(found)];
    const hosts = [...new Set(found.map(u => {
      const m = /^(?:https?:\/\/)?([^/?#]+)/i.exec(u);
      return m ? m[1].replace(/^www\./i, '').toLowerCase() : u;
    }))];
    return ok({ urls: found, count: found.length, hosts }, computed());
  }
};
