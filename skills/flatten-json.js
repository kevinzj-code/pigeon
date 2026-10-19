import { ok, fail, computed } from '../src/contracts.js';

export default {
  name: 'flattenJson',
  description: 'Squash nested JSON down to one level, every key a dot path.',
  category: 'data', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  title: 'Flatten JSON',
  replyTemplate: '{{count}} {{count|plural:path:paths}}, {{depth}} levels deep:\n{{lines|lines}}',
  inputSchema: {
    type: 'object', required: ['json'],
    properties: {
      json: { type: 'string', label: 'json', minLength: 1, prompt: 'Which JSON should I flatten?' },
      separator: { type: 'string', label: 'separator', default: '.', minLength: 1 },
      arrayIndices: { type: 'boolean', label: 'expand arrays', default: true, description: 'expand array items into indexed paths' }
    }
  },
  outputSchema: { type: 'object', properties: { flat: { type: 'object' }, lines: { type: 'array', items: { type: 'string' } }, count: { type: 'integer' }, depth: { type: 'integer' } } },
  examples: [
    { text: 'flatten this json', input: { json: '{"a":{"b":1,"c":2}}' }, output: { flat: { 'a.b': 1, 'a.c': 2 }, lines: ['a.b = 1', 'a.c = 2'], count: 2, depth: 2 } },
    { text: 'flatten a nested config', input: { json: '{"server":{"host":"localhost","port":8080}}' }, output: { flat: { 'server.host': 'localhost', 'server.port': 8080 }, lines: ['server.host = localhost', 'server.port = 8080'], count: 2, depth: 2 } },
    { text: 'flatten json with an array', input: { json: '{"tags":["a","b"]}' }, output: { flat: { 'tags.0': 'a', 'tags.1': 'b' }, lines: ['tags.0 = a', 'tags.1 = b'], count: 2, depth: 2 } },
    { text: 'flatten deeply nested json', input: { json: '{"a":{"b":{"c":{"d":true}}}}' }, output: { flat: { 'a.b.c.d': true }, lines: ['a.b.c.d = true'], count: 1, depth: 4 } },
    { text: 'flatten already flat json', input: { json: '{"x":1,"y":2}' }, output: { flat: { x: 1, y: 2 }, lines: ['x = 1', 'y = 2'], count: 2, depth: 1 } }
  ],
  errorCases: [
    { input: { json: '{not json}' }, code: 'INVALID_INPUT' },
    { input: { json: '"just a string"' }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' }
  ],
  run (input) {
    let parsed;
    try { parsed = JSON.parse(input.json); }
    catch (e) { return fail('INVALID_INPUT', `That isn't valid JSON — ${e.message.replace(/\s*\(line.*|\s*at position \d+/, '')}.`, 'json'); }
    if (parsed === null || typeof parsed !== 'object') {
      return fail('INVALID_INPUT', 'There is nothing to flatten — the JSON has to be an object or an array.', 'json');
    }

    const flat = {};
    let depth = 0;
    const walk = (value, prefix, level) => {
      depth = Math.max(depth, level);
      const isArray = Array.isArray(value);
      if (isArray && !input.arrayIndices) { flat[prefix] = value; return; }
      const entries = isArray ? value.map((v, i) => [String(i), v]) : Object.entries(value);
      /* An empty object or array has no leaves, so it would vanish entirely.
         Keeping it as its own path means flatten/unflatten round-trips. */
      if (!entries.length) { flat[prefix] = isArray ? [] : {}; return; }
      for (const [k, v] of entries) {
        const path = prefix ? `${prefix}${input.separator}${k}` : k;
        if (v !== null && typeof v === 'object') walk(v, path, level + 1);
        else flat[path] = v;
      }
    };
    walk(parsed, '', 1);

    return ok({
      flat,
      lines: Object.entries(flat).map(([k, v]) => `${k} = ${typeof v === 'object' ? JSON.stringify(v) : v}`),
      count: Object.keys(flat).length, depth
    }, computed());
  }
};
