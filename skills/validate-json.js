import { ok, computed } from '../src/contracts.js';

export default {
  name: 'validateJson',
  description: 'Check whether some JSON parses, and say exactly where the error is if it does not.',
  category: 'validation',
  tier: 'core',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  title: 'Validate JSON',
  replyTemplate: '{{verdict|prose}}{{where|prose}}',
  inputSchema: {
    type: 'object',
    required: ['text'],
    properties: { text: { type: 'string', label: 'json', minLength: 1, prompt: 'Which JSON should I check?' } }
  },
  outputSchema: {
    type: 'object',
    properties: {
      valid: { type: 'boolean' }, verdict: { type: 'string' }, where: { type: 'string' },
      line: { type: 'integer' }, column: { type: 'integer' }, message: { type: 'string' },
      rootType: { type: 'string' }, keys: { type: 'integer' }
    }
  },
  examples: [
    { text: 'is this json valid: {"a":1}', input: { text: '{"a":1}' },
      output: { valid: true, verdict: 'Valid JSON — an object with 1 key', where: '', line: 0, column: 0, message: '', rootType: 'object', keys: 1 } },
    { text: 'check this json array', input: { text: '[1, 2, 3]' },
      output: { valid: true, verdict: 'Valid JSON — an array of 3 items', where: '', line: 0, column: 0, message: '', rootType: 'array', keys: 3 } },
    { text: 'why will this json not parse', input: { text: '{"a": 1,}' },
      output: { valid: false, verdict: 'Not valid JSON', where: ' — line 1, column 9', line: 1, column: 9, message: 'Expected double-quoted property name in JSON', rootType: '', keys: 0 } },
    { text: 'validate this multi-line json', input: { text: '{\n  "name": "Ana",\n  "age": 34\n}' },
      output: { valid: true, verdict: 'Valid JSON — an object with 2 keys', where: '', line: 0, column: 0, message: '', rootType: 'object', keys: 2 } },
    { text: 'is a bare string valid json', input: { text: '"hello"' },
      output: { valid: true, verdict: 'Valid JSON — a string', where: '', line: 0, column: 0, message: '', rootType: 'string', keys: 0 } }
  ],
  errorCases: [
    { input: {}, code: 'MISSING_FIELD' },
    { input: { text: '' }, code: 'MISSING_FIELD' },
    { input: { text: { a: 1 } }, code: 'INVALID_INPUT' }
  ],
  run (input) {
    try {
      const parsed = JSON.parse(input.text);
      const rootType = Array.isArray(parsed) ? 'array' : parsed === null ? 'null' : typeof parsed;
      const keys = rootType === 'array' ? parsed.length : rootType === 'object' ? Object.keys(parsed).length : 0;
      const summary = rootType === 'array' ? `an array of ${keys} item${keys === 1 ? '' : 's'}`
        : rootType === 'object' ? `an object with ${keys} key${keys === 1 ? '' : 's'}`
          : `a ${rootType}`;
      return ok({
        valid: true, verdict: `Valid JSON — ${summary}`, where: '',
        line: 0, column: 0, message: '', rootType, keys
      }, computed());
    } catch (e) {
      /* V8 puts the character offset in the message; turning it into a line and
         column is the difference between "there is an error somewhere" and a
         place to put the cursor. */
      const at = /position (\d+)/.exec(e.message);
      let line = 0, column = 0;
      if (at) {
        const upto = input.text.slice(0, Number(at[1]));
        const rows = upto.split('\n');
        line = rows.length;
        column = rows[rows.length - 1].length + 1;
      }
      /* The engine's positional suffix is stripped — "at position 8", "(line 1
         column 9)" — because its exact wording differs between V8 versions and
         between browsers, and this app runs in both. The position is already
         reported in `line` and `column`, where it is stable; leaving it in the
         message too would make every example a hostage to the runtime. */
      const message = e.message
        .replace(/\s*\(line \d+ column \d+\)/, '')
        .replace(/\s*at position \d+/, '')
        .trim();
      return ok({
        valid: false, verdict: 'Not valid JSON',
        where: line ? ` — line ${line}, column ${column}` : '',
        line, column, message, rootType: '', keys: 0
      }, computed());
    }
  }
};
