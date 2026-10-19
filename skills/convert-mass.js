import { makeConverter } from '../src/lib/make-converter.js';

export default makeConverter({
  name: 'convertMass',
  dimension: 'mass',
  description: 'Convert a weight or mass — grams, kilograms, tonnes, ounces, pounds, stone.',
  examples: [
    { text: 'what is 70 kg in stone', input: { amount: 70, from: 'kg', to: 'stone' },
      output: { result: 11.02, amount: 70, fromUnit: 'kg', toUnit: 'st', dimension: 'mass', exact: false } },
    { text: 'convert 500 grams to ounces', input: { amount: 500, from: 'g', to: 'oz' },
      output: { result: 17.64, amount: 500, fromUnit: 'g', toUnit: 'oz', dimension: 'mass', exact: false } },
    { text: 'how many kg is 165 pounds', input: { amount: 165, from: 'lb', to: 'kg' },
      output: { result: 74.84, amount: 165, fromUnit: 'lb', toUnit: 'kg', dimension: 'mass', exact: false } },
    { text: '2 tonnes in kg', input: { amount: 2, from: 'tonne', to: 'kg' },
      output: { result: 2000, amount: 2, fromUnit: 't', toUnit: 'kg', dimension: 'mass', exact: true } },
    { text: '8 oz of flour in grams', input: { amount: 8, from: 'oz', to: 'g' },
      output: { result: 226.8, amount: 8, fromUnit: 'oz', toUnit: 'g', dimension: 'mass', exact: false } }
  ],
  errorCases: [
    { input: { amount: 5, from: 'smoots', to: 'kg' }, code: 'INVALID_INPUT' },
    { input: { amount: 5, from: 'km', to: 'kg' }, code: 'INVALID_INPUT' },
    { input: { amount: 5, to: 'kg' }, code: 'MISSING_FIELD' }
  ]
});
