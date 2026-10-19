import { ok, fail, computed } from '../src/contracts.js';

export default {
  name: 'formatJson',
  description: 'Tidy JSON into readable indented form, or squash it onto one line.',
  category: 'data',
  tier: 'core',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  title: 'Format JSON',
  replyTemplate: '{{result}}',
  inputSchema: {
    type: 'object',
    required: ['text'],
    properties: {
      text: { type: 'string', label: 'json', minLength: 1, prompt: 'Which JSON should I format?' },
      style: { type: 'string', label: 'style', enum: ['pretty', 'minified'], default: 'pretty' },
      indent: { type: 'integer', label: 'indent spaces', minimum: 0, maximum: 8, default: 2 },
      sortKeys: { type: 'boolean', label: 'sort keys', default: false }
    }
  },
  outputSchema: {
    type: 'object',
    properties: { result: { type: 'string' }, style: { type: 'string' }, before: { type: 'integer' }, after: { type: 'integer' } }
  },
  examples: [
    { text: 'pretty print this json', input: { text: '{"a":1,"b":2}' },
      output: { result: '{\n  "a": 1,\n  "b": 2\n}', style: 'pretty', before: 13, after: 22 } },
    { text: 'minify this json', input: { text: '{\n  "a": 1\n}', style: 'minified' },
      output: { result: '{"a":1}', style: 'minified', before: 12, after: 7 } },
    { text: 'format with 4 space indent', input: { text: '{"x":[1,2]}', indent: 4 },
      output: { result: '{\n    "x": [\n        1,\n        2\n    ]\n}', style: 'pretty', before: 11, after: 41 } },
    { text: 'tidy the json and sort the keys', input: { text: '{"b":2,"a":1}', sortKeys: true },
      output: { result: '{\n  "a": 1,\n  "b": 2\n}', style: 'pretty', before: 13, after: 22 } },
    { text: 'pretty print a json array', input: { text: '[1,2,3]' },
      output: { result: '[\n  1,\n  2,\n  3\n]', style: 'pretty', before: 7, after: 17 } },
    { text: 'tidy this json so a person can read it', input: { text: '{"a":1,"b":[1,2]}' },
      output: { result: '{\n  "a": 1,\n  "b": [\n    1,\n    2\n  ]\n}', style: 'pretty', before: 17, after: 39 } }
  ],
  errorCases: [
    { input: { text: '{not json}' }, code: 'INVALID_INPUT' },
    { input: { text: '{"a":1,}' }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' }
  ],
  run (input) {
    let parsed;
    try { parsed = JSON.parse(input.text); }
    catch (e) {
      /* Same normalisation as validateJson, and for the same reason: the
         engine's positional wording is not stable across runtimes. */
      const msg = e.message.replace(/\s*\(line \d+ column \d+\)/, '').replace(/\s*at position \d+/, '').trim();
      return fail('INVALID_INPUT', `That isn't valid JSON — ${msg}. Try validateJson to find where.`, 'text');
    }

    const sorted = input.sortKeys ? sortDeep(parsed) : parsed;
    const result = input.style === 'minified'
      ? JSON.stringify(sorted)
      : JSON.stringify(sorted, null, input.indent);

    return ok({ result, style: input.style, before: input.text.length, after: result.length }, computed());
  }
};

/* Recursive so nested objects sort too. Arrays keep their order — the order of
   an array is data, not presentation. */
function sortDeep (v) {
  if (Array.isArray(v)) return v.map(sortDeep);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.keys(v).sort().map(k => [k, sortDeep(v[k])]));
  }
  return v;
}
