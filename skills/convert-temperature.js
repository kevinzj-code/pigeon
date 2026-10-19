import { makeConverter } from '../src/lib/make-converter.js';

export default makeConverter({
  name: 'convertTemperature',
  dimension: 'temperature',
  description: 'Convert a temperature between Celsius, Fahrenheit and Kelvin.',
  examples: [
    { text: 'convert 180 celsius to fahrenheit', input: { amount: 180, from: 'celsius', to: 'fahrenheit' },
      output: { result: 356, amount: 180, fromUnit: 'C', toUnit: 'F', dimension: 'temperature', exact: true } },
    { text: 'what is 98.6 F in celsius', input: { amount: 98.6, from: 'F', to: 'C' },
      output: { result: 37, amount: 98.6, fromUnit: 'F', toUnit: 'C', dimension: 'temperature', exact: true } },
    { text: 'gas mark oven 200C in fahrenheit', input: { amount: 200, from: 'C', to: 'F' },
      output: { result: 392, amount: 200, fromUnit: 'C', toUnit: 'F', dimension: 'temperature', exact: true } },
    { text: '0 kelvin in celsius', input: { amount: 0, from: 'K', to: 'C' },
      output: { result: -273.2, amount: 0, fromUnit: 'K', toUnit: 'C', dimension: 'temperature', exact: false } },
    { text: 'how cold is -40 fahrenheit in celsius', input: { amount: -40, from: 'F', to: 'C' },
      output: { result: -40, amount: -40, fromUnit: 'F', toUnit: 'C', dimension: 'temperature', exact: true } }
  ],
  errorCases: [
    { input: { amount: 20, from: 'degrees', to: 'C' }, code: 'INVALID_INPUT' },
    { input: { amount: 20, from: 'kg', to: 'C' }, code: 'INVALID_INPUT' },
    { input: { amount: 20, from: 'C' }, code: 'MISSING_FIELD' }
  ]
});
