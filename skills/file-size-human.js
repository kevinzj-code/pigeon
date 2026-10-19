import { ok, fail, computed } from '../src/contracts.js';
import { round } from '../src/lib/num.js';

const DECIMAL = [['B', 1], ['kB', 1e3], ['MB', 1e6], ['GB', 1e9], ['TB', 1e12], ['PB', 1e15]];
const BINARY = [['B', 1], ['KiB', 1024], ['MiB', 1048576], ['GiB', 1073741824], ['TiB', 1099511627776], ['PiB', 1125899906842624]];

export default {
  name: 'fileSizeHuman',
  description: 'Turn a number of bytes into a readable file size like 1.4 MB.',
  category: 'files',
  tier: 'core',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{bytes|comma}} bytes is {{result}}.',
  inputSchema: {
    type: 'object',
    required: ['bytes'],
    properties: {
      bytes: { type: 'number', label: 'bytes', carry: true, minimum: 0, prompt: 'How many bytes?' },
      /* Decimal by default because that is what a drive's label, an OS file
         listing and a download dialogue all use. Binary is the opt-in, and the
         unit name says which one you got. */
      base: { type: 'string', label: 'decimal or binary', enum: ['decimal', 'binary'], default: 'decimal' },
      decimals: { type: 'integer', label: 'decimal places', minimum: 0, maximum: 4, default: 1 }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      result: { type: 'string' }, value: { type: 'number' }, unit: { type: 'string' },
      bytes: { type: 'number' }, base: { type: 'string' }
    }
  },
  examples: [
    { text: 'how big is 1500000 bytes', input: { bytes: 1500000 },
      output: { result: '1.5 MB', value: 1.5, unit: 'MB', bytes: 1500000, base: 'decimal' } },
    { text: 'make 1073741824 bytes readable in binary units', input: { bytes: 1073741824, base: 'binary' },
      output: { result: '1 GiB', value: 1, unit: 'GiB', bytes: 1073741824, base: 'binary' } },
    { text: 'what is 512 bytes as a file size', input: { bytes: 512 },
      output: { result: '512 B', value: 512, unit: 'B', bytes: 512, base: 'decimal' } },
    { text: 'human readable size of 2500000000 bytes', input: { bytes: 2500000000 },
      output: { result: '2.5 GB', value: 2.5, unit: 'GB', bytes: 2500000000, base: 'decimal' } },
    { text: 'how big is an empty file', input: { bytes: 0 },
      output: { result: '0 B', value: 0, unit: 'B', bytes: 0, base: 'decimal' } }
  ],
  errorCases: [
    { input: { bytes: -5 }, code: 'INVALID_INPUT' },
    { input: { bytes: 'big' }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' }
  ],
  run (input) {
    if (!Number.isFinite(input.bytes)) return fail('INVALID_INPUT', 'That is not a number of bytes.', 'bytes');
    const table = input.base === 'binary' ? BINARY : DECIMAL;

    let chosen = table[0];
    for (const entry of table) if (input.bytes >= entry[1]) chosen = entry;
    const value = round(input.bytes / chosen[1], chosen[1] === 1 ? 0 : input.decimals);

    return ok({
      result: `${value} ${chosen[0]}`,
      value, unit: chosen[0], bytes: input.bytes, base: input.base
    }, computed());
  }
};
