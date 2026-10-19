import { ok, fail, computed } from '../src/contracts.js';
import { coerceCell } from '../src/lib/rows.js';

export default {
  name: 'parseKeyValue',
  description: 'Read key/value or INI-style settings text into structured data.',
  category: 'data', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  title: 'Read settings text',
  replyTemplate: '{{count}} {{count|plural:setting:settings}}: {{lines|list}}',
  inputSchema: {
    type: 'object', required: ['text'],
    properties: {
      text: { type: 'string', label: 'text', minLength: 1, prompt: 'Which settings text should I read?' },
      separator: { type: 'string', label: 'separator', description: 'the character between key and value — = and : are both recognised by default' }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      object: { type: 'object' }, lines: { type: 'array', items: { type: 'string' } },
      count: { type: 'integer' }, sections: { type: 'array', items: { type: 'string' } }
    }
  },
  examples: [
    { text: 'parse these key value pairs', input: { text: 'a=1\nb=2' }, output: { object: { a: 1, b: 2 }, lines: ['a = 1', 'b = 2'], count: 2, sections: [] } },
    { text: 'read this config text', input: { text: 'host: localhost\nport: 8080' }, output: { object: { host: 'localhost', port: 8080 }, lines: ['host = localhost', 'port = 8080'], count: 2, sections: [] } },
    { text: 'parse an ini file with sections', input: { text: '[server]\nhost=localhost\n[client]\nretries=3' }, output: { object: { server: { host: 'localhost' }, client: { retries: 3 } }, lines: ['server.host = localhost', 'client.retries = 3'], count: 2, sections: ['server', 'client'] } },
    { text: 'parse settings that have comments', input: { text: '# the key\nkey=value\n; and another\nx=1' }, output: { object: { key: 'value', x: 1 }, lines: ['key = value', 'x = 1'], count: 2, sections: [] } },
    { text: 'parse a value containing an equals sign', input: { text: 'path=/a=b' }, output: { object: { path: '/a=b' }, lines: ['path = /a=b'], count: 1, sections: [] } },
    { text: 'read my .env lines as key and value pairs', input: { text: 'PORT=8080\nDEBUG=true' },
      output: { object: { PORT: 8080, DEBUG: 'true' }, lines: ['PORT = 8080', 'DEBUG = true'], count: 2, sections: [] } },
    { text: 'read these settings lines as data', input: { text: 'host=localhost\nport=5432' },
      output: { object: { host: 'localhost', port: 5432 }, lines: ['host = localhost', 'port = 5432'], count: 2, sections: [] } }
  ],
  errorCases: [
    { input: { text: 'no separators here' }, code: 'INVALID_INPUT' },
    { input: { text: '# only a comment' }, code: 'INVALID_INPUT' },
    { input: { text: '=novalue' }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' }
  ],
  run (input) {
    const seps = input.separator ? [input.separator] : ['=', ':'];
    const out = {};
    const lines = [];
    const sections = [];
    let section = null;
    let sawPair = false;

    for (const raw of String(input.text).split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#') || line.startsWith(';')) continue;

      const heading = /^\[(.+)\]$/.exec(line);
      if (heading) {
        section = heading[1].trim();
        if (!sections.includes(section)) { sections.push(section); out[section] = out[section] ?? {}; }
        continue;
      }

      /* Split on the FIRST separator only. A path like `path=/a=b` has a value
         that legitimately contains the separator, and splitting on all of them
         would truncate it at the first one. */
      let at = -1;
      let used = null;
      for (const s of seps) {
        const i = line.indexOf(s);
        if (i > -1 && (at === -1 || i < at)) { at = i; used = s; }
      }
      if (at === -1) continue;

      const key = line.slice(0, at).trim();
      const value = coerceCell(line.slice(at + used.length).trim());
      if (!key) return fail('INVALID_INPUT', `"${line}" has a value but no name in front of it.`, 'text');

      sawPair = true;
      if (section) { out[section][key] = value; lines.push(`${section}.${key} = ${value}`); }
      else { out[key] = value; lines.push(`${key} = ${value}`); }
    }

    if (!sawPair) {
      return fail('INVALID_INPUT', `I could not find any settings — each line should look like name${seps[0]}value.`, 'text');
    }
    return ok({ object: out, lines, count: lines.length, sections }, computed());
  }
};
