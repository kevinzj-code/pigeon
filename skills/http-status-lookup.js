import { ok, fail, bundled } from '../src/contracts.js';
import { HTTP_STATUS, STATUS_AS_OF } from '../src/lib/http-status.js';

export default {
  name: 'httpStatusLookup',
  description: 'Look up what an HTTP status code means.',
  category: 'developer', tier: 'standard',
  title: 'HTTP status lookup',
  unbuilt: false, needsNetwork: false, dataAsOf: STATUS_AS_OF, labels: [],
  replyTemplate: '{{code}} {{name|prose}} — {{meaning|prose}} ({{category|prose}}).',
  inputSchema: {
    type: 'object', required: ['code'],
    properties: { code: { type: 'integer', label: 'status code', minimum: 100, maximum: 599, prompt: 'Which status code?' } }
  },
  outputSchema: { type: 'object', properties: { code: { type: 'integer' }, name: { type: 'string' }, meaning: { type: 'string' }, category: { type: 'string' }, retryable: { type: 'boolean' }, dataAsOf: { type: 'string' } } },
  examples: [
    { text: 'what does http 404 mean', input: { code: 404 }, output: { code: 404, name: 'Not Found', meaning: 'the server has no resource at that address', category: 'client error', retryable: false, dataAsOf: '2026-08-29' } },
    { text: 'what is a 503', input: { code: 503 }, output: { code: 503, name: 'Service Unavailable', meaning: 'the server is temporarily unable to handle the request', category: 'server error', retryable: true, dataAsOf: '2026-08-29' } },
    { text: 'meaning of status 200', input: { code: 200 }, output: { code: 200, name: 'OK', meaning: 'the request succeeded', category: 'success', retryable: false, dataAsOf: '2026-08-29' } },
    { text: 'what is http 429', input: { code: 429 }, output: { code: 429, name: 'Too Many Requests', meaning: 'the client has sent too many requests in a given time', category: 'client error', retryable: true, dataAsOf: '2026-08-29' } },
    { text: 'explain a 301 redirect', input: { code: 301 }, output: { code: 301, name: 'Moved Permanently', meaning: 'the resource has a new permanent address', category: 'redirection', retryable: false, dataAsOf: '2026-08-29' } }
  ],
  errorCases: [
    { input: { code: 999 }, code: 'INVALID_INPUT' },
    { input: { code: 418.5 }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' }
  ],
  run (input) {
    const entry = HTTP_STATUS[input.code];
    if (!entry) {
      const band = Math.floor(input.code / 100);
      /* An unlisted code in a real band gets the band's meaning rather than a
         flat refusal — servers do invent codes, and "it is a client error"
         is more use than "I do not know". */
      const CATEGORIES = { 1: 'informational', 2: 'success', 3: 'redirection', 4: 'client error', 5: 'server error' };
      if (CATEGORIES[band]) {
        return ok({
          code: input.code, name: 'Unassigned',
          meaning: `not a code I have a name for, but it is in the ${CATEGORIES[band]} range`,
          category: CATEGORIES[band], retryable: band === 5, dataAsOf: STATUS_AS_OF
        }, bundled(STATUS_AS_OF));
      }
      return fail('INVALID_INPUT', `${input.code} is not in any HTTP status range.`, 'code');
    }
    return ok({ code: input.code, ...entry, dataAsOf: STATUS_AS_OF }, bundled(STATUS_AS_OF));
  }
};
