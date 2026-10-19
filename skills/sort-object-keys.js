import { ok, fail, computed } from '../src/contracts.js';

export default {
  name: 'sortObjectKeys',
  description: 'Sort the keys of a JSON object alphabetically, all the way down.',
  category: 'data', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  title: 'Sort JSON keys',
  replyTemplate: '{{result|prose}}',
  inputSchema: {
    type: 'object', required: ['json'],
    properties: {
      json: { type: 'string', label: 'json', minLength: 1, prompt: 'Which JSON should I sort?' },
      direction: { type: 'string', label: 'order', enum: ['ascending', 'descending'], default: 'ascending' },
      indent: { type: 'integer', label: 'indent spaces', minimum: 0, maximum: 8, default: 2 }
    }
  },
  outputSchema: { type: 'object', properties: { result: { type: 'string' }, keys: { type: 'integer' }, alreadySorted: { type: 'boolean' } } },
  examples: [
    { text: 'sort the keys in this json', input: { json: '{"b":2,"a":1}' }, output: { result: '{\n  "a": 1,\n  "b": 2\n}', keys: 2, alreadySorted: false } },
    { text: 'alphabetise this config', input: { json: '{"port":80,"host":"x"}' }, output: { result: '{\n  "host": "x",\n  "port": 80\n}', keys: 2, alreadySorted: false } },
    { text: 'sort nested keys too', input: { json: '{"z":{"b":1,"a":2}}' }, output: { result: '{\n  "z": {\n    "a": 2,\n    "b": 1\n  }\n}', keys: 3, alreadySorted: false } },
    { text: 'sort keys in reverse', input: { json: '{"a":1,"b":2}', direction: 'descending' }, output: { result: '{\n  "b": 2,\n  "a": 1\n}', keys: 2, alreadySorted: false } },
    { text: 'sort json whose keys are already in order', input: { json: '{"a":1,"b":2}' }, output: { result: '{\n  "a": 1,\n  "b": 2\n}', keys: 2, alreadySorted: true } },
    { text: 'alphabetise the keys in this json object', input: { json: '{"b":1,"a":2}' },
      output: { result: '{\n  "a": 2,\n  "b": 1\n}', keys: 2, alreadySorted: false } }
  ],
  errorCases: [
    { input: { json: '{bad}' }, code: 'INVALID_INPUT' },
    { input: { json: '[1,2,3]' }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' }
  ],
  run (input) {
    let parsed;
    try { parsed = JSON.parse(input.json); }
    catch (e) { return fail('INVALID_INPUT', `That isn't valid JSON — ${e.message.replace(/\s*\(line.*|\s*at position \d+/, '')}.`, 'json'); }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return fail('INVALID_INPUT', 'Only an object has keys to sort.', 'json');
    }

    let keys = 0;
    const sort = (v) => {
      if (Array.isArray(v)) return v.map(sort);
      if (v === null || typeof v !== 'object') return v;
      /* Arrays keep their order — the order of an array is data, not
         presentation, and reordering one changes what the document says. */
      const names = Object.keys(v).sort((a, b) => (input.direction === 'descending' ? b.localeCompare(a) : a.localeCompare(b)));
      keys += names.length;
      return Object.fromEntries(names.map(k => [k, sort(v[k])]));
    };
    const sorted = sort(parsed);
    return ok({
      result: JSON.stringify(sorted, null, input.indent),
      keys,
      alreadySorted: JSON.stringify(sorted) === JSON.stringify(parsed)
    }, computed());
  }
};
