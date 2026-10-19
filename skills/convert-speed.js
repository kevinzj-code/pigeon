import { makeConverter } from '../src/lib/make-converter.js';

export default makeConverter({
  name: 'convertSpeed',
  dimension: 'speed',
  tier: 'standard',
  description: 'Convert a speed — miles per hour, kilometres per hour, metres per second, knots.',
  examples: [
    { text: '100 km/h in mph', input: { amount: 100, from: 'km/h', to: 'mph' },
      output: { result: 62.14, amount: 100, fromUnit: 'km/h', toUnit: 'mph', dimension: 'speed', exact: false } },
    { text: 'convert 70 mph to kph', input: { amount: 70, from: 'mph', to: 'kph' },
      output: { result: 112.7, amount: 70, fromUnit: 'mph', toUnit: 'km/h', dimension: 'speed', exact: false } },
    { text: 'how fast is 20 knots in km/h', input: { amount: 20, from: 'knots', to: 'km/h' },
      output: { result: 37.04, amount: 20, fromUnit: 'kn', toUnit: 'km/h', dimension: 'speed', exact: false } },
    { text: '9.58 seconds over 100m — what is 10.44 m/s in mph', input: { amount: 10.44, from: 'm/s', to: 'mph' },
      output: { result: 23.35, amount: 10.44, fromUnit: 'm/s', toUnit: 'mph', dimension: 'speed', exact: false } },
    { text: 'convert 5 m/s to km/h', input: { amount: 5, from: 'm/s', to: 'km/h' },
      output: { result: 18, amount: 5, fromUnit: 'm/s', toUnit: 'km/h', dimension: 'speed', exact: true } }
  ],
  errorCases: [
    { input: { amount: 5, from: 'mph', to: 'kg' }, code: 'INVALID_INPUT' },
    { input: { amount: 5, from: 'warp', to: 'mph' }, code: 'INVALID_INPUT' },
    { input: { amount: 5, from: 'mph' }, code: 'MISSING_FIELD' }
  ]
});
