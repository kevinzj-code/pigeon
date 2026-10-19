import { ok, fail, computed } from '../src/contracts.js';
import { pluralize } from '../src/lib/inflect.js';

export default {
  name: 'pluralize',
  description: "Make one English word into many — its plural.",
  category: 'writing', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: 'The plural of {{singular}} is {{plural}} — {{rule}}.',
  inputSchema: {
    type: 'object', required: ['word'],
    properties: {
      word: { type: 'string', label: 'word', minLength: 1, maxLength: 60, prompt: 'Which word should I make plural?' },
      count: { type: 'integer', label: 'count', description: 'pick the form that agrees with this number' }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      plural: { type: 'string' }, singular: { type: 'string' }, rule: { type: 'string' },
      agreeing: { type: 'string' }
    }
  },
  examples: [
    { text: 'what is the plural of child', input: { word: 'child' }, output: { plural: 'children', singular: 'child', rule: 'irregular', agreeing: 'children' } },
    { text: 'pluralize city', input: { word: 'city' }, output: { plural: 'cities', singular: 'city', rule: 'consonant + -y becomes -ies', agreeing: 'cities' } },
    { text: 'plural of knife', input: { word: 'knife' }, output: { plural: 'knives', singular: 'knife', rule: '-fe becomes -ves', agreeing: 'knives' } },
    { text: 'what is the plural of sheep', input: { word: 'sheep' }, output: { plural: 'sheep', singular: 'sheep', rule: 'unchanging', agreeing: 'sheep' } },
    { text: 'plural of box for 1 item', input: { word: 'box', count: 1 }, output: { plural: 'boxes', singular: 'box', rule: '-s/-x/-z/-ch/-sh takes -es', agreeing: 'box' } }
  ],
  errorCases: [
    { input: { word: '123' }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' },
    { input: { word: '  ' }, code: 'INVALID_INPUT' }
  ],
  run (input) {
    const word = String(input.word).trim();
    if (!/^[A-Za-z][A-Za-z'-]*$/.test(word)) return fail('INVALID_INPUT', 'Give me a single English word to pluralise.', 'word');
    const { result, rule } = pluralize(word);
    /* `agreeing` picks the form that goes with a count, so a caller building a
       sentence does not have to re-derive "1 box" from "boxes". */
    return ok({
      plural: result, singular: word, rule,
      agreeing: input.count === 1 ? word : result
    }, computed());
  }
};
