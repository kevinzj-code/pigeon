import { makeConverter } from '../src/lib/make-converter.js';

/* The only converter where case decides meaning: b is a bit, B is a byte, and
   MB (10⁶) is not MiB (2²⁰). resolveUnit() refuses to case-fold data units for
   exactly that reason — see lib/units.js. */
export default makeConverter({
  name: 'convertDataSize',
  dimension: 'data',
  description: 'Convert a file or storage size — bytes, kB, MB, GB, TB, and the binary KiB, MiB, GiB.',
  examples: [
    { text: 'how many GiB is 500 GB', input: { amount: 500, from: 'GB', to: 'GiB' },
      output: { result: 465.7, amount: 500, fromUnit: 'GB', toUnit: 'GiB', dimension: 'data', exact: false } },
    { text: 'convert 1.5 GB to MB', input: { amount: 1.5, from: 'GB', to: 'MB' },
      output: { result: 1500, amount: 1.5, fromUnit: 'GB', toUnit: 'MB', dimension: 'data', exact: true } },
    { text: '4096 bytes in KiB', input: { amount: 4096, from: 'B', to: 'KiB' },
      output: { result: 4, amount: 4096, fromUnit: 'B', toUnit: 'KiB', dimension: 'data', exact: true } },
    { text: 'how big is 2 TB in GB', input: { amount: 2, from: 'TB', to: 'GB' },
      output: { result: 2000, amount: 2, fromUnit: 'TB', toUnit: 'GB', dimension: 'data', exact: true } },
    { text: '8 megabytes in bits', input: { amount: 8, from: 'MB', to: 'b' },
      output: { result: 64000000, amount: 8, fromUnit: 'MB', toUnit: 'b', dimension: 'data', exact: true } }
  ],
  errorCases: [
    { input: { amount: 5, from: 'floppies', to: 'MB' }, code: 'INVALID_INPUT' },
    { input: { amount: 5, from: 'kg', to: 'MB' }, code: 'INVALID_INPUT' },
    { input: { amount: 5, to: 'MB' }, code: 'MISSING_FIELD' }
  ]
});
