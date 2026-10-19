import { ok, fail, web } from '../src/contracts.js';
import { fixtureSearch, reasonFrom } from '../src/search.js';
import { WEB_FIXTURES } from '../src/lib/web-fixtures.js';

/* Pages to go and read, rather than an answer.
 *
 * webAnswer is for a question with one factual answer. This is for the other
 * case — you want the sources themselves, because the question is broad, or
 * because you would rather judge the pages than trust a summary of them. It
 * returns titles and links and nothing else: no ranking of its own, no
 * synthesis, no opinion about which is right.
 *
 * `count` is a real count of what came back, not a claim about how much exists
 * on the web. The fabrication auditor traces every numeral in the reply back to
 * this result, which is why it is a field rather than something the template
 * works out. */
const fixture = fixtureSearch(WEB_FIXTURES);
const withWeb = { webEnabled: true, search: fixture };
const shape = (q) => {
  const f = WEB_FIXTURES[q];
  return { titles: f.results.map(r => r.title), results: f.results, count: f.results.length,
           source: f.results[0].source };
};

export default {
  name: 'webSearch',
  description: 'Search the web and get back the matching pages, with links.',
  category: 'reference',
  tier: 'web',
  unbuilt: false,
  needsNetwork: true,
  labels: [],
  replyTemplate: 'Found {{count}} pages: {{titles}}.',
  inputSchema: {
    type: 'object',
    required: ['query'],
    properties: {
      query: { type: 'string', label: 'search', minLength: 2, prompt: 'What should I search for?' }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      titles: { type: 'array', items: { type: 'string' } },
      results: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string' }, snippet: { type: 'string' }, source: { type: 'string' }
          }
        }
      },
      count: { type: 'integer' },
      source: { type: 'string' }
    }
  },
  examples: [
    { text: 'search the web for the Antikythera mechanism', input: { query: 'Antikythera mechanism' }, ctx: withWeb,
      output: shape('Antikythera mechanism') },
    { text: 'find pages about Voyager 1', input: { query: 'Voyager 1' }, ctx: withWeb,
      output: shape('Voyager 1') },
    { text: 'web search governor of Maryland', input: { query: 'governor of Maryland' }, ctx: withWeb,
      output: shape('governor of Maryland') },
    { text: 'look on the web for Ada Lovelace', input: { query: 'Ada Lovelace' }, ctx: withWeb,
      output: shape('Ada Lovelace') },
    { text: 'find links about Hedy Lamarr', input: { query: 'Hedy Lamarr' }, ctx: withWeb,
      output: shape('Hedy Lamarr') },
    { text: 'search online for the James Webb Space Telescope', input: { query: 'James Webb Space Telescope' }, ctx: withWeb,
      output: shape('James Webb Space Telescope') }
  ],
  errorCases: [
    { input: {}, code: 'MISSING_FIELD' },
    { input: { query: 'x' }, code: 'INVALID_INPUT' },
    { input: { query: 'Voyager 1' }, code: 'NETWORK_OFF' },
    { input: { query: 'qwertyuiop asdfghjkl' }, ctx: withWeb, code: 'INVALID_INPUT' }
  ],
  async run (input, ctx) {
    const search = ctx && ctx.search;
    if (typeof search !== 'function') {
      return fail('NETWORK_OFF', 'No search provider is connected, so nothing can be searched.');
    }

    let reply;
    try {
      reply = await search(input.query);
    } catch (e) {
      return fail('NETWORK_FAILED', `The search request failed — ${reasonFrom(e)}`);
    }

    const results = (reply && Array.isArray(reply.results) ? reply.results : [])
      .filter(r => r && r.title && r.source);
    if (!results.length) {
      return fail('INVALID_INPUT', `Nothing on the web matched "${input.query}".`, 'query');
    }
    return ok({
      titles: results.map(r => r.title),
      results,
      count: results.length,
      source: results[0].source
    }, web(results[0].source));
  }
};
