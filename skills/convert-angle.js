import { makeConverter } from '../src/lib/make-converter.js';

export default makeConverter({
  name: 'convertAngle',
  dimension: 'angle',
  description: 'Convert an angle — degrees, radians, gradians, turns, arcminutes, arcseconds.',
  examples: [
    { text: 'convert 180 degrees to radians', input: { amount: 180, from: 'degrees', to: 'radians' },
      output: { result: 3.142, amount: 180, fromUnit: 'deg', toUnit: 'rad', dimension: 'angle', exact: false } },
    { text: 'how many degrees is 1 radian', input: { amount: 1, from: 'rad', to: 'deg' },
      output: { result: 57.3, amount: 1, fromUnit: 'rad', toUnit: 'deg', dimension: 'angle', exact: false } },
    { text: '90 degrees in gradians', input: { amount: 90, from: 'deg', to: 'grad' },
      output: { result: 100, amount: 90, fromUnit: 'deg', toUnit: 'grad', dimension: 'angle', exact: false } },
    { text: 'one full turn in degrees', input: { amount: 1, from: 'turn', to: 'degrees' },
      output: { result: 360, amount: 1, fromUnit: 'turn', toUnit: 'deg', dimension: 'angle', exact: true } },
    { text: 'convert 30 degrees to arcminutes', input: { amount: 30, from: 'deg', to: 'arcmin' },
      output: { result: 1800, amount: 30, fromUnit: 'deg', toUnit: 'arcmin', dimension: 'angle', exact: true } }
  ],
  errorCases: [
    { input: { amount: 5, from: 'bananas', to: 'deg' }, code: 'INVALID_INPUT' },
    { input: { amount: 5, from: 'kg', to: 'deg' }, code: 'INVALID_INPUT' },
    { input: { from: 'deg', to: 'rad' }, code: 'MISSING_FIELD' }
  ]
});
