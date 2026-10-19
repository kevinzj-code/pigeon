import { ok, fail, computed } from '../src/contracts.js';
import { leafPaths } from '../src/lib/paths.js';

const show = (v) => (typeof v === 'string' ? v : JSON.stringify(v));

export default {
  name: 'diffJson',
  description: 'Compare two JSON documents and list the paths added, removed and changed.',
  category: 'data', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  title: 'Compare JSON',
  replyTemplate: '{{totalDifferences}} {{totalDifferences|plural:difference:differences}} - {{changedCount}} changed, {{addedCount}} added, {{removedCount}} removed.\n{{lines|lines}}',
  inputSchema: {
    type: 'object', required: ['left', 'right'],
    properties: {
      left: { type: 'string', label: 'original json', minLength: 1, prompt: 'Which JSON should I compare from?' },
      right: { type: 'string', label: 'new json', minLength: 1, prompt: 'Which JSON should I compare to?' }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      changed: { type: 'array' }, added: { type: 'array' }, removed: { type: 'array' },
      changedCount: { type: 'integer' }, addedCount: { type: 'integer' }, removedCount: { type: 'integer' },
      totalDifferences: { type: 'integer' }, lines: { type: 'array', items: { type: 'string' } }
    }
  },
  examples: [
    { text: 'diff these two json documents', input: { left: '{"name":"Ana","age":34}', right: '{"name":"Bea","age":34,"city":"Leeds"}' }, output: { changed: [{ path: 'name', from: 'Ana', to: 'Bea' }], added: [{ path: 'city', value: 'Leeds' }], removed: [], changedCount: 1, addedCount: 1, removedCount: 0, totalDifferences: 2, lines: ['name: Ana → Bea', '+ city = Leeds'] } },
    { text: 'compare two identical json objects', input: { left: '{"a":1}', right: '{"a":1}' }, output: { changed: [], added: [], removed: [], changedCount: 0, addedCount: 0, removedCount: 0, totalDifferences: 0, lines: [] } },
    { text: 'what was removed between these two versions', input: { left: '{"a":1,"b":2}', right: '{"a":1}' }, output: { changed: [], added: [], removed: [{ path: 'b', value: 2 }], changedCount: 0, addedCount: 0, removedCount: 1, totalDifferences: 1, lines: ['- b = 2'] } },
    { text: 'diff a nested config change', input: { left: '{"server":{"port":8080}}', right: '{"server":{"port":9090}}' }, output: { changed: [{ path: 'server.port', from: 8080, to: 9090 }], added: [], removed: [], changedCount: 1, addedCount: 0, removedCount: 0, totalDifferences: 1, lines: ['server.port: 8080 → 9090'] } },
    { text: 'compare two lists of tags', input: { left: '{"tags":["a","b"]}', right: '{"tags":["a","c"]}' }, output: { changed: [{ path: 'tags[1]', from: 'b', to: 'c' }], added: [], removed: [], changedCount: 1, addedCount: 0, removedCount: 0, totalDifferences: 1, lines: ['tags[1]: b → c'] } }
  ],
  errorCases: [
    { input: { left: '{not json}', right: '{}' }, code: 'INVALID_INPUT' },
    { input: { left: '{}', right: '{oops}' }, code: 'INVALID_INPUT' },
    { input: { left: '{"a":1}' }, code: 'MISSING_FIELD' },
    { input: { left: '"a string"', right: '{}' }, code: 'INVALID_INPUT' }
  ],
  run (input) {
    const parse = (text, field) => {
      try { return { value: JSON.parse(text) }; }
      catch (e) { return { error: fail('INVALID_INPUT', `The ${field} document isn't valid JSON - ${e.message.replace(/\s*\(line.*|\s*at position \d+/, '')}.`, field) }; }
    };
    const a = parse(input.left, 'left');
    if (a.error) return a.error;
    const b = parse(input.right, 'right');
    if (b.error) return b.error;
    for (const [side, doc] of [['left', a.value], ['right', b.value]]) {
      if (doc === null || typeof doc !== 'object') {
        return fail('INVALID_INPUT', `The ${side} document is a single value rather than an object or a list, so there are no paths to compare.`, side);
      }
    }

    /* Comparing leaves rather than whole branches: a key added deep inside an
       object shows up as one added path, not as "this whole branch changed",
       which is the difference between a diff you can act on and one you have
       to re-read both documents to interpret. */
    const left = leafPaths(a.value);
    const right = leafPaths(b.value);
    const changed = [];
    const removed = [];
    const added = [];

    for (const [path, value] of left) {
      if (!right.has(path)) { removed.push({ path, value }); continue; }
      const to = right.get(path);
      if (JSON.stringify(value) !== JSON.stringify(to)) changed.push({ path, from: value, to });
    }
    for (const [path, value] of right) if (!left.has(path)) added.push({ path, value });

    const lines = [
      ...changed.map((c) => `${c.path}: ${show(c.from)} → ${show(c.to)}`),
      ...added.map((x) => `+ ${x.path} = ${show(x.value)}`),
      ...removed.map((x) => `- ${x.path} = ${show(x.value)}`)
    ];

    return ok({
      changed, added, removed,
      changedCount: changed.length, addedCount: added.length, removedCount: removed.length,
      totalDifferences: changed.length + added.length + removed.length, lines
    }, computed());
  }
};
