import { makeConverter } from '../src/lib/make-converter.js';

export default makeConverter({
  name: 'convertVolume',
  dimension: 'volume',
  description: 'Convert a volume — millilitres, litres, teaspoons, tablespoons, cups, pints, quarts, gallons.',
  examples: [
    { text: '2 cups in ml', input: { amount: 2, from: 'cups', to: 'ml' },
      output: { result: 473.2, amount: 2, fromUnit: 'cup', toUnit: 'ml', dimension: 'volume', exact: false } },
    { text: 'how many tablespoons in 100 ml', input: { amount: 100, from: 'ml', to: 'tbsp' },
      output: { result: 6.763, amount: 100, fromUnit: 'ml', toUnit: 'tbsp', dimension: 'volume', exact: false } },
    { text: 'convert 1 gallon to litres', input: { amount: 1, from: 'gallon', to: 'l' },
      output: { result: 3.785, amount: 1, fromUnit: 'gal', toUnit: 'l', dimension: 'volume', exact: false } },
    { text: 'a pint in ml', input: { amount: 1, from: 'imperial pint', to: 'ml' },
      output: { result: 568.3, amount: 1, fromUnit: 'pt-uk', toUnit: 'ml', dimension: 'volume', exact: false } },
    { text: '3 teaspoons in tablespoons', input: { amount: 3, from: 'tsp', to: 'tbsp' },
      output: { result: 1, amount: 3, fromUnit: 'tsp', toUnit: 'tbsp', dimension: 'volume', exact: true } }
  ],
  errorCases: [
    { input: { amount: 5, from: 'buckets', to: 'l' }, code: 'INVALID_INPUT' },
    { input: { amount: 5, from: 'kg', to: 'l' }, code: 'INVALID_INPUT' },
    { input: { amount: 5, from: 'l' }, code: 'MISSING_FIELD' }
  ]
});
