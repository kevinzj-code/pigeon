import { ok, fail, computed } from '../src/contracts.js';

export default {
  name: 'urlEncode',
  description: "Percent-escape text so it survives inside a web address.",
  category: 'encoding',
  tier: 'core',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  title: 'URL encode',
  replyTemplate: '{{result}}',
  inputSchema: {
    type: 'object',
    required: ['text'],
    properties: {
      text: { type: 'string', label: 'text', minLength: 1, prompt: 'Which text should I encode?' },
      /* "component" escapes & = ? / — correct for a query VALUE. "full" leaves
         them alone, for encoding a whole URL. Getting this backwards silently
         breaks the query string, so it is an explicit choice, not a guess. */
      scope: { type: 'string', label: 'whole url or part', enum: ['component', 'full'], default: 'component' }
    }
  },
  outputSchema: {
    type: 'object',
    properties: { result: { type: 'string' }, original: { type: 'string' }, changed: { type: 'boolean' }, scope: { type: 'string' } }
  },
  examples: [
    { text: 'url encode "hello world"', input: { text: 'hello world' },
      output: { result: 'hello%20world', original: 'hello world', changed: true, scope: 'component' } },
    { text: 'encode this for a query string', input: { text: 'name=Ana & Co' },
      output: { result: 'name%3DAna%20%26%20Co', original: 'name=Ana & Co', changed: true, scope: 'component' } },
    { text: 'percent encode an accented word', input: { text: 'café' },
      output: { result: 'caf%C3%A9', original: 'café', changed: true, scope: 'component' } },
    { text: 'encode a whole url leaving the slashes', input: { text: 'https://example.com/a b', scope: 'full' },
      output: { result: 'https://example.com/a%20b', original: 'https://example.com/a b', changed: true, scope: 'full' } },
    { text: 'encode text that needs no encoding', input: { text: 'plain-text_123' },
      output: { result: 'plain-text_123', original: 'plain-text_123', changed: false, scope: 'component' } },
    { text: 'make this text safe for a url query: café au lait', input: { text: 'café au lait' },
      output: { result: 'caf%C3%A9%20au%20lait', original: 'café au lait', changed: true, scope: 'component' } },
    { text: 'percent encode this for a web address: a&b=c', input: { text: 'a&b=c' },
      output: { result: 'a%26b%3Dc', original: 'a&b=c', changed: true, scope: 'component' } }
  ],
  errorCases: [
    { input: {}, code: 'MISSING_FIELD' },
    { input: { text: '' }, code: 'MISSING_FIELD' },
    { input: { text: 'a', scope: 'partial' }, code: 'INVALID_INPUT' }
  ],
  run (input) {
    try {
      const result = input.scope === 'full' ? encodeURI(input.text) : encodeURIComponent(input.text);
      return ok({ result, original: input.text, changed: result !== input.text, scope: input.scope }, computed());
    } catch (e) {
      return fail('INVALID_INPUT', `That text can't be encoded: ${e.message}`, 'text');
    }
  }
};
