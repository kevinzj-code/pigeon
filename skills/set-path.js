import { ok, fail, computed } from '../src/contracts.js';
import { parsePath, formatPath, getIn, setIn, PathError } from '../src/lib/paths.js';

const show = (v) => (typeof v === 'string' ? v : JSON.stringify(v));

export default {
  name: 'setPath',
  description: 'Change or add a value in a JSON document at a dotted path — update config.timeout to 30.',
  category: 'data', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  title: 'Set a JSON path',
  replyTemplate: '{{action}} {{path}} to {{display}}.\n{{json}}',
  inputSchema: {
    type: 'object', required: ['json', 'path', 'value'],
    properties: {
      json: { type: 'string', label: 'json', minLength: 1, prompt: 'Which JSON should I change?' },
      path: { type: 'string', label: 'path', minLength: 1, prompt: 'Which path should I set?' },
      value: { type: 'string', label: 'new value', prompt: 'What should I set it to?', description: 'read as JSON when it parses as JSON, otherwise as plain text' },
      separator: { type: 'string', label: 'separator', default: '.', minLength: 1 }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      json: { type: 'string' }, path: { type: 'string' }, display: { type: 'string' },
      action: { type: 'string' }, previousDisplay: { type: 'string' }
    }
  },
  examples: [
    { text: 'set user.name to Bea in this json', input: { json: '{"user":{"name":"Ana"}}', path: 'user.name', value: 'Bea' }, output: { json: '{\n  "user": {\n    "name": "Bea"\n  }\n}', path: 'user.name', display: 'Bea', action: 'Changed', previousDisplay: 'Ana' } },
    { text: 'change the port to 9000', input: { json: '{"server":{"port":8080}}', path: 'server.port', value: '9000' }, output: { json: '{\n  "server": {\n    "port": 9000\n  }\n}', path: 'server.port', display: '9000', action: 'Changed', previousDisplay: '8080' } },
    { text: 'add an email field to this json', input: { json: '{"user":{"name":"Ana"}}', path: 'user.email', value: 'ana@example.com' }, output: { json: '{\n  "user": {\n    "name": "Ana",\n    "email": "ana@example.com"\n  }\n}', path: 'user.email', display: 'ana@example.com', action: 'Added', previousDisplay: null } },
    { text: 'set the first tag to urgent', input: { json: '{"tags":["low","later"]}', path: 'tags[0]', value: 'urgent' }, output: { json: '{\n  "tags": [\n    "urgent",\n    "later"\n  ]\n}', path: 'tags[0]', display: 'urgent', action: 'Changed', previousDisplay: 'low' } },
    { text: 'set enabled to true', input: { json: '{"flags":{}}', path: 'flags.enabled', value: 'true' }, output: { json: '{\n  "flags": {\n    "enabled": true\n  }\n}', path: 'flags.enabled', display: 'true', action: 'Added', previousDisplay: null } },
    { text: 'set the timeout under config to 30 in this json', input: { json: '{"config":{"timeout":10}}', path: 'config.timeout', value: '30' },
      output: { json: '{\n  "config": {\n    "timeout": 30\n  }\n}', path: 'config.timeout', display: '30', action: 'Changed', previousDisplay: '10' } },
    { text: 'update the theme to dark inside this document', input: { json: '{"settings":{"theme":"light"}}', path: 'settings.theme', value: 'dark' },
      output: { json: '{\n  "settings": {\n    "theme": "dark"\n  }\n}', path: 'settings.theme', display: 'dark', action: 'Changed', previousDisplay: 'light' } }
  ],
  errorCases: [
    { input: { json: '{not json}', path: 'a', value: '1' }, code: 'INVALID_INPUT' },
    { input: { json: '{"a":1}', path: 'a.b', value: '2' }, code: 'INVALID_INPUT' },
    { input: { json: '{"a":1}', value: '2' }, code: 'MISSING_FIELD' },
    { input: { json: '{"a":[1]}', path: 'a.name', value: '2' }, code: 'INVALID_INPUT' }
  ],
  run (input) {
    let doc;
    try { doc = JSON.parse(input.json); }
    catch (e) { return fail('INVALID_INPUT', `That isn't valid JSON — ${e.message.replace(/\s*\(line.*|\s*at position \d+/, '')}.`, 'json'); }

    const sep = input.separator ?? '.';
    const parts = parsePath(input.path, sep);
    if (!parts) return fail('INVALID_INPUT', `"${input.path}" is not a path I can follow — try something like items[0].name.`, 'path');

    /* A bare word like `urgent` is not JSON, and quoting every string value
       would be a trap for anyone typing this by hand. So: JSON first, plain
       text as the fallback. `true`, `9000` and `[1,2]` therefore arrive as
       their real types rather than as strings that merely look like them. */
    let value;
    try { value = JSON.parse(input.value); }
    catch { value = input.value; }

    const before = getIn(doc, parts);
    let updated;
    try { updated = setIn(doc, parts, value); }
    catch (e) {
      if (e instanceof PathError) return fail('INVALID_INPUT', `I cannot set that path — ${e.message}.`, 'path');
      throw e;
    }

    return ok({
      json: JSON.stringify(updated, null, 2),
      path: formatPath(parts, sep),
      display: show(value),
      action: before.found ? 'Changed' : 'Added',
      previousDisplay: before.found ? show(before.value) : null
    }, computed());
  }
};
