import { ok, fail, computed } from '../src/contracts.js';
import { parsePath, formatPath, getIn } from '../src/lib/paths.js';

const show = (v) => (typeof v === 'string' ? v : JSON.stringify(v));
const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);

export default {
  name: 'getPath',
  description: 'Read one value out of a JSON document at a dotted path — pull settings.theme out of it.',
  category: 'data', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  title: 'Read a JSON path',
  replyTemplate: '{{path}} holds {{display}} — {{type}}.',
  inputSchema: {
    type: 'object', required: ['json', 'path'],
    properties: {
      json: { type: 'string', label: 'json', minLength: 1, prompt: 'Which JSON should I look inside?' },
      path: { type: 'string', label: 'path', minLength: 1, prompt: 'Which path should I read?' },
      separator: { type: 'string', label: 'separator', default: '.', minLength: 1 }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string' }, display: { type: 'string' }, type: { type: 'string' },
      value: { description: 'the value at that path, whatever type it turned out to be' }
    }
  },
  examples: [
    { text: 'get user.name from this json', input: { json: '{"user":{"name":"Ana","age":34}}', path: 'user.name' }, output: { path: 'user.name', value: 'Ana', display: 'Ana', type: 'string' } },
    { text: 'read the second item sku', input: { json: '{"items":[{"sku":"A1"},{"sku":"B2"}]}', path: 'items[1].sku' }, output: { path: 'items[1].sku', value: 'B2', display: 'B2', type: 'string' } },
    { text: 'what is at a.b.c in this document', input: { json: '{"a":{"b":{"c":true}}}', path: 'a.b.c' }, output: { path: 'a.b.c', value: true, display: 'true', type: 'boolean' } },
    { text: 'get the value at totals.2', input: { json: '{"totals":[10,20,30]}', path: 'totals.2' }, output: { path: 'totals[2]', value: 30, display: '30', type: 'number' } },
    { text: 'look up config.ports in this json', input: { json: '{"config":{"ports":[8080]}}', path: 'config.ports' }, output: { path: 'config.ports', value: [8080], display: '[8080]', type: 'array' } },
    { text: 'read the value stored at settings.theme in this json', input: { json: '{"settings":{"theme":"dark"}}', path: 'settings.theme' },
      output: { path: 'settings.theme', value: 'dark', display: 'dark', type: 'string' } },
    { text: 'what is the value at order.total in this json', input: { json: '{"order":{"total":42}}', path: 'order.total' },
      output: { path: 'order.total', value: 42, display: '42', type: 'number' } }
  ],
  errorCases: [
    { input: { json: '{"a":1}', path: 'b' }, code: 'INVALID_INPUT' },
    { input: { json: '{not json}', path: 'a' }, code: 'INVALID_INPUT' },
    { input: { json: '{"a":1}' }, code: 'MISSING_FIELD' },
    { input: { json: '{"a":1}', path: 'a..b' }, code: 'INVALID_INPUT' }
  ],
  run (input) {
    let doc;
    try { doc = JSON.parse(input.json); }
    catch (e) { return fail('INVALID_INPUT', `That isn't valid JSON — ${e.message.replace(/\s*\(line.*|\s*at position \d+/, '')}.`, 'json'); }

    const sep = input.separator ?? '.';
    const parts = parsePath(input.path, sep);
    if (!parts) return fail('INVALID_INPUT', `"${input.path}" is not a path I can follow — try something like items[0].name.`, 'path');

    const hit = getIn(doc, parts);
    if (!hit.found) {
      /* Naming the deepest point that DID resolve turns "not found" into
         something actionable — usually the path was right and one key was
         spelled differently, and the sibling list says which. */
      const subject = hit.at || 'the document';
      if (hit.reason === 'missing-key') {
        const near = hit.siblings.length
          ? ` It has ${hit.siblings.map((s) => `"${s}"`).join(', ')}.`
          : ' It has no keys at all.';
        return fail('INVALID_INPUT', `There is no "${hit.key}" in ${subject}.${near}`, 'path');
      }
      if (hit.reason === 'out-of-range') return fail('INVALID_INPUT', `${subject} stops before position ${hit.key} — it holds ${hit.length}.`, 'path');
      if (hit.reason === 'name-into-list') return fail('INVALID_INPUT', `${subject} is a list, so "${hit.key}" has to be a position rather than a name.`, 'path');
      return fail('INVALID_INPUT', `${subject} is not something "${hit.key}" can sit inside.`, 'path');
    }

    return ok({
      path: formatPath(parts, sep), value: hit.value,
      display: show(hit.value), type: typeOf(hit.value)
    }, computed());
  }
};
