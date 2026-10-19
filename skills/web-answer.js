import { ok, fail, web } from '../src/contracts.js';
import { fixtureSearch, reasonFrom } from '../src/search.js';
import { WEB_FIXTURES } from '../src/lib/web-fixtures.js';

/* The first skill in Pigeon that leaves the machine.
 *
 * Everything else here computes from what you typed or from a table that
 * shipped in the bundle. This asks the web, so it plays by §3.3's other rule:
 * the answer arrives with the page it came from, and the renderer marks it as a
 * web value rather than a computed one. A source is not decoration — it is the
 * only thing separating this from the model making something up, which is the
 * failure this whole project is built to avoid.
 *
 * Two things it deliberately does NOT do. It does not summarise, rephrase or
 * stitch several pages together: the answer is the provider's own words, passed
 * through, so there is no step in which a model could quietly invent a detail.
 * And it does not guess — no answer from the provider is reported as "nothing
 * answered that", never as a best effort.
 *
 * The examples run against recorded provider replies (`web-fixtures.js`), so
 * they test this skill rather than the internet. `npm run webcheck` is the live
 * one. */
const fixture = fixtureSearch(WEB_FIXTURES);
const withWeb = { webEnabled: true, search: fixture };

export default {
  name: 'webAnswer',
  description: 'Look up a short factual answer on the web, with the page it came from.',
  category: 'reference',
  tier: 'web',
  unbuilt: false,
  needsNetwork: true,
  labels: [],
  replyTemplate: '{{answer}}',
  inputSchema: {
    type: 'object',
    required: ['question'],
    properties: {
      question: { type: 'string', label: 'question', minLength: 2, prompt: 'What should I look up?' }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      answer: { type: 'string' },
      source: { type: 'string' }
    }
  },
  examples: [
    { text: 'who is the governor of Maryland', input: { question: 'governor of Maryland' }, ctx: withWeb,
      output: { answer: WEB_FIXTURES['governor of Maryland'].answer, source: WEB_FIXTURES['governor of Maryland'].source } },
    { text: 'look up Ada Lovelace', input: { question: 'Ada Lovelace' }, ctx: withWeb,
      output: { answer: WEB_FIXTURES['Ada Lovelace'].answer, source: WEB_FIXTURES['Ada Lovelace'].source } },
    { text: 'what is the James Webb Space Telescope', input: { question: 'James Webb Space Telescope' }, ctx: withWeb,
      output: { answer: WEB_FIXTURES['James Webb Space Telescope'].answer, source: WEB_FIXTURES['James Webb Space Telescope'].source } },
    { text: 'search the web for the capital of Mongolia', input: { question: 'capital of Mongolia' }, ctx: withWeb,
      output: { answer: WEB_FIXTURES['capital of Mongolia'].answer, source: WEB_FIXTURES['capital of Mongolia'].source } },
    { text: 'tell me about Hedy Lamarr', input: { question: 'Hedy Lamarr' }, ctx: withWeb,
      output: { answer: WEB_FIXTURES['Hedy Lamarr'].answer, source: WEB_FIXTURES['Hedy Lamarr'].source } },
    { text: 'what was the Antikythera mechanism', input: { question: 'Antikythera mechanism' }, ctx: withWeb,
      output: { answer: WEB_FIXTURES['Antikythera mechanism'].answer, source: WEB_FIXTURES['Antikythera mechanism'].source } }
  ],
  errorCases: [
    { input: {}, code: 'MISSING_FIELD' },
    { input: { question: 'x' }, code: 'INVALID_INPUT' },
    /* No provider on ctx at all — the app running with its web tier off. */
    { input: { question: 'Ada Lovelace' }, code: 'NETWORK_OFF' },
    /* A provider that answered, with nothing. Saying so is the point. */
    { input: { question: 'qwertyuiop asdfghjkl' }, ctx: withWeb, code: 'INVALID_INPUT' }
  ],
  async run (input, ctx) {
    const search = ctx && ctx.search;
    /* The executor's webEnabled gate normally stops us before here. This is the
       other case: the web is on, but nothing was wired to go and get it. */
    if (typeof search !== 'function') {
      return fail('NETWORK_OFF', 'No search provider is connected, so nothing can be looked up.');
    }

    let reply;
    try {
      reply = await search(input.question);
    } catch (e) {
      return fail('NETWORK_FAILED', `The search request failed — ${reasonFrom(e)}`);
    }

    const answer = reply && typeof reply.answer === 'string' ? reply.answer.trim() : '';
    if (!answer) {
      return fail('INVALID_INPUT', `Nothing on the web gave a direct answer for "${input.question}".`, 'question');
    }
    /* An answer with no source cannot be shown as a web value — the contract
       refuses to build the provenance, so catch it here with a message that
       says what happened rather than letting normaliseProvenance throw. */
    if (!reply.source) {
      return fail('INTERNAL', 'The provider returned an answer with no source, so it cannot be shown.');
    }
    return ok({ answer, source: reply.source }, web(reply.source));
  }
};
