import { makeConverter } from '../src/lib/make-converter.js';

export default makeConverter({
  name: 'convertArea',
  dimension: 'area',
  tier: 'standard',
  description: 'Convert an area — square metres, square feet, hectares, acres, square miles.',
  examples: [
    { text: 'how many square feet is 85 square metres', input: { amount: 85, from: 'm2', to: 'ft2' },
      output: { result: 914.9, amount: 85, fromUnit: 'm2', toUnit: 'ft2', dimension: 'area', exact: false } },
    { text: 'convert 2 acres to hectares', input: { amount: 2, from: 'acre', to: 'ha' },
      output: { result: 0.8094, amount: 2, fromUnit: 'acre', toUnit: 'ha', dimension: 'area', exact: false } },
    { text: '1 hectare in square metres', input: { amount: 1, from: 'hectare', to: 'm2' },
      output: { result: 10000, amount: 1, fromUnit: 'ha', toUnit: 'm2', dimension: 'area', exact: true } },
    { text: 'how big is 500 sq ft in square metres', input: { amount: 500, from: 'sq ft', to: 'm2' },
      output: { result: 46.45, amount: 500, fromUnit: 'ft2', toUnit: 'm2', dimension: 'area', exact: false } },
    { text: 'convert 3 square miles to square kilometres', input: { amount: 3, from: 'mi2', to: 'km2' },
      output: { result: 7.77, amount: 3, fromUnit: 'mi2', toUnit: 'km2', dimension: 'area', exact: false } }
  ],
  errorCases: [
    { input: { amount: 5, from: 'acres', to: 'kg' }, code: 'INVALID_INPUT' },
    { input: { amount: 5, from: 'paddocks', to: 'm2' }, code: 'INVALID_INPUT' },
    { input: { amount: 5, to: 'm2' }, code: 'MISSING_FIELD' }
  ]
});
