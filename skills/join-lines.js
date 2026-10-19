import { ok, computed } from '../src/contracts.js';
import { lines } from '../src/lib/text.js';

export default {
  name: 'joinLines',
  description: 'Join the lines of a text into one line, separated by a delimiter you choose.',
  category: 'text',
  tier: 'core',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{result}}',
  inputSchema: {
    type: 'object',
    required: ['text'],
    properties: {
      text: { type: 'string', label: 'text', minLength: 1, prompt: 'Which lines should I join?' },
      delimiter: { type: 'string', label: 'separator', default: ', ' },
      skipBlank: { type: 'boolean', label: 'skip blank lines', default: true },
      trim: { type: 'boolean', label: 'trim each line', default: true }
    }
  },
  outputSchema: {
    type: 'object',
    properties: { result: { type: 'string' }, joined: { type: 'integer' }, skipped: { type: 'integer' } }
  },
  examples: [
    { text: 'join these lines with commas', input: { text: 'apple\nbanana\ncherry' },
      output: { result: 'apple, banana, cherry', joined: 3, skipped: 0 } },
    { text: 'turn this list into a comma separated line', input: { text: 'red\ngreen\nblue' },
      output: { result: 'red, green, blue', joined: 3, skipped: 0 } },
    { text: 'join the lines with a pipe', input: { text: 'a\nb\nc', delimiter: ' | ' },
      output: { result: 'a | b | c', joined: 3, skipped: 0 } },
    { text: 'join lines and skip the empty ones', input: { text: 'one\n\ntwo\n\nthree' },
      output: { result: 'one, two, three', joined: 3, skipped: 2 } },
    { text: 'join into a sentence with and', input: { text: 'eggs\nmilk\nflour', delimiter: ' and ' },
      output: { result: 'eggs and milk and flour', joined: 3, skipped: 0 } }
  ],
  errorCases: [
    { input: {}, code: 'MISSING_FIELD' },
    { input: { text: '' }, code: 'MISSING_FIELD' },
    { input: { text: 'a', skipBlank: 'no' }, code: 'INVALID_INPUT' }
  ],
  run (input) {
    const all = lines(input.text);
    const prepped = input.trim ? all.map(l => l.trim()) : all;
    const kept = input.skipBlank ? prepped.filter(l => l !== '') : prepped;
    return ok({
      result: kept.join(input.delimiter),
      joined: kept.length,
      skipped: prepped.length - kept.length
    }, computed());
  }
};
