import { makeConverter } from '../src/lib/make-converter.js';

export default makeConverter({
  name: 'convertLength',
  dimension: 'length',
  description: 'Convert a distance or length — millimetres, centimetres, metres, kilometres, inches, feet, yards, miles.',
  examples: [
    { text: 'how many km is 26.2 miles', input: { amount: 26.2, from: 'miles', to: 'km' },
      output: { result: 42.16, amount: 26.2, fromUnit: 'mi', toUnit: 'km', dimension: 'length', exact: false } },
    { text: 'convert 6 feet to cm', input: { amount: 6, from: 'feet', to: 'cm' },
      output: { result: 182.9, amount: 6, fromUnit: 'ft', toUnit: 'cm', dimension: 'length', exact: false } },
    { text: 'what is 100 metres in yards', input: { amount: 100, from: 'm', to: 'yd' },
      output: { result: 109.4, amount: 100, fromUnit: 'm', toUnit: 'yd', dimension: 'length', exact: false } },
    { text: '12 inches in mm', input: { amount: 12, from: 'inches', to: 'mm' },
      output: { result: 304.8, amount: 12, fromUnit: 'in', toUnit: 'mm', dimension: 'length', exact: false } },
    { text: 'how far is 5 km in miles', input: { amount: 5, from: 'km', to: 'miles' },
      output: { result: 3.107, amount: 5, fromUnit: 'km', toUnit: 'mi', dimension: 'length', exact: false } }
  ],
  errorCases: [
    { input: { amount: 5, from: 'bananas', to: 'km' }, code: 'INVALID_INPUT' },
    { input: { amount: 5, from: 'kg', to: 'm' }, code: 'INVALID_INPUT' },
    { input: { from: 'km', to: 'mi' }, code: 'MISSING_FIELD' }
  ]
});
