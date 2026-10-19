import { ok, fail, computed } from '../src/contracts.js';
import { singularize } from '../src/lib/inflect.js';

export default {
  name: 'singularize',
  description: "Cut a plural English word back to one of the thing.",
  category: 'writing', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: 'The singular of {{plural}} is {{singular}} — {{rule}}.',
  inputSchema: {
    type: 'object', required: ['word'],
    properties: { word: { type: 'string', label: 'word', minLength: 1, maxLength: 60, prompt: 'Which word should I make singular?' } }
  },
  outputSchema: {
    type: 'object',
    properties: { singular: { type: 'string' }, plural: { type: 'string' }, rule: { type: 'string' } }
  },
  examples: [
    { text: 'what is the singular of children', input: { word: 'children' }, output: { singular: 'child', plural: 'children', rule: 'irregular' } },
    { text: 'singularize cities', input: { word: 'cities' }, output: { singular: 'city', plural: 'cities', rule: '-ies becomes -y' } },
    { text: 'singular form of knives', input: { word: 'knives' }, output: { singular: 'knife', plural: 'knives', rule: '-ves becomes -f or -fe' } },
    { text: 'what is the singular of buses', input: { word: 'buses' }, output: { singular: 'bus', plural: 'buses', rule: '-es removed' } },
    { text: 'singularize analyses', input: { word: 'analyses' }, output: { singular: 'analysis', plural: 'analyses', rule: 'irregular' } }
  ],
  errorCases: [
    { input: { word: '456' }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' },
    { input: { word: ' ' }, code: 'INVALID_INPUT' }
  ],
  run (input) {
    const word = String(input.word).trim();
    if (!/^[A-Za-z][A-Za-z'-]*$/.test(word)) return fail('INVALID_INPUT', 'Give me a single English word to singularise.', 'word');
    const { result, rule } = singularize(word);
    return ok({ singular: result, plural: word, rule }, computed());
  }
};
