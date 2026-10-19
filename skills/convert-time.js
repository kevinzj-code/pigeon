import { makeConverter } from '../src/lib/make-converter.js';

export default makeConverter({
  name: 'convertTime',
  dimension: 'time',
  description: "Convert a length of time between units \u2014 how long 210 minutes runs to in hours.",
  examples: [
    { text: 'how many hours is 5400 seconds', input: { amount: 5400, from: 's', to: 'h' },
      output: { result: 1.5, amount: 5400, fromUnit: 's', toUnit: 'h', dimension: 'time', exact: true } },
    { text: 'convert 3 days to hours', input: { amount: 3, from: 'days', to: 'hours' },
      output: { result: 72, amount: 3, fromUnit: 'd', toUnit: 'h', dimension: 'time', exact: true } },
    { text: '90 minutes in seconds', input: { amount: 90, from: 'min', to: 's' },
      output: { result: 5400, amount: 90, fromUnit: 'min', toUnit: 's', dimension: 'time', exact: true } },
    { text: 'how many weeks is 100 days', input: { amount: 100, from: 'd', to: 'wk' },
      output: { result: 14.29, amount: 100, fromUnit: 'd', toUnit: 'wk', dimension: 'time', exact: false } },
    { text: '2.5 hours in minutes', input: { amount: 2.5, from: 'h', to: 'min' },
      output: { result: 150, amount: 2.5, fromUnit: 'h', toUnit: 'min', dimension: 'time', exact: true } },
    { text: 'a 210 minute film is how many hours', input: { amount: 210, from: 'min', to: 'h' },
      output: { result: 3.5, amount: 210, fromUnit: 'min', toUnit: 'h', dimension: 'time', exact: true } },
    { text: 'how long is 3 hours in minutes', input: { amount: 3, from: 'h', to: 'min' },
      output: { result: 180, amount: 3, fromUnit: 'h', toUnit: 'min', dimension: 'time', exact: true } }
  ],
  errorCases: [
    { input: { amount: 5, from: 'moons', to: 'd' }, code: 'INVALID_INPUT' },
    { input: { amount: 5, from: 'kg', to: 'h' }, code: 'INVALID_INPUT' },
    { input: { amount: 5, from: 'h' }, code: 'MISSING_FIELD' }
  ]
});
