import { ok, fail, computed } from '../src/contracts.js';
import { parsePath, setIn, PathError } from '../src/lib/paths.js';

export default {
  name: 'unflattenJson',
  description: 'Rebuild deep nested JSON from keys that are already flat dot paths.',
  category: 'data', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  title: 'Unflatten JSON',
  replyTemplate: '{{count}} {{count|plural:path:paths}} rebuilt into {{depth}} levels:\n{{json}}',
  inputSchema: {
    type: 'object', required: ['json'],
    properties: {
      json: { type: 'string', label: 'json', minLength: 1, prompt: 'Which flat JSON should I rebuild?' },
      separator: { type: 'string', label: 'separator', default: '.', minLength: 1 }
    }
  },
  outputSchema: { type: 'object', properties: { json: { type: 'string' }, count: { type: 'integer' }, depth: { type: 'integer' } } },
  examples: [
    { text: 'unflatten this json', input: { json: '{"a.b":1,"a.c":2}' }, output: { json: '{\n  "a": {\n    "b": 1,\n    "c": 2\n  }\n}', count: 2, depth: 2 } },
    { text: 'rebuild nested config from dotted keys', input: { json: '{"server.host":"localhost","server.port":8080}' }, output: { json: '{\n  "server": {\n    "host": "localhost",\n    "port": 8080\n  }\n}', count: 2, depth: 2 } },
    { text: 'turn indexed paths back into an array', input: { json: '{"tags.0":"a","tags.1":"b"}' }, output: { json: '{\n  "tags": [\n    "a",\n    "b"\n  ]\n}', count: 2, depth: 2 } },
    { text: 'unflatten a deep path', input: { json: '{"a.b.c.d":true}' }, output: { json: '{\n  "a": {\n    "b": {\n      "c": {\n        "d": true\n      }\n    }\n  }\n}', count: 1, depth: 4 } },
    { text: 'unflatten keys that are already flat', input: { json: '{"x":1,"y":2}' }, output: { json: '{\n  "x": 1,\n  "y": 2\n}', count: 2, depth: 1 } }
  ],
  errorCases: [
    { input: { json: '{not json}' }, code: 'INVALID_INPUT' },
    { input: { json: '[1,2]' }, code: 'INVALID_INPUT' },
    { input: { json: '{"a":1,"a.b":2}' }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' }
  ],
  run (input) {
    let flat;
    try { flat = JSON.parse(input.json); }
    catch (e) { return fail('INVALID_INPUT', `That isn't valid JSON — ${e.message.replace(/\s*\(line.*|\s*at position \d+/, '')}.`, 'json'); }
    if (flat === null || typeof flat !== 'object' || Array.isArray(flat)) {
      return fail('INVALID_INPUT', 'Unflattening needs an object of path/value pairs, like {"a.b": 1}.', 'json');
    }

    const sep = input.separator ?? '.';
    const entries = Object.entries(flat);
    if (!entries.length) return fail('INVALID_INPUT', 'That object has no paths in it.', 'json');

    let out = {};
    for (const [key, value] of entries) {
      const parts = parsePath(key, sep);
      if (!parts) return fail('INVALID_INPUT', `"${key}" is not a path I can rebuild.`, 'json');
      try { out = setIn(out, parts, value); }
      catch (e) {
        /* `{"a": 1, "a.b": 2}` asks for a value and a container at the same
           place. Guessing which one the author meant would quietly drop the
           other, so this stays an error. */
        if (e instanceof PathError) return fail('INVALID_INPUT', `"${key}" conflicts with another path — ${e.message}.`, 'json');
        throw e;
      }
    }

    const measure = (v) => (v !== null && typeof v === 'object' && (Array.isArray(v) ? v.length : Object.keys(v).length)
      ? 1 + Math.max(...Object.values(v).map(measure)) : (v !== null && typeof v === 'object' ? 1 : 0));
    return ok({ json: JSON.stringify(out, null, 2), count: entries.length, depth: measure(out) }, computed());
  }
};
