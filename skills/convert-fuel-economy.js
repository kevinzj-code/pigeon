import { ok, fail, computed } from '../src/contracts.js';
import { round } from '../src/lib/num.js';

const L_PER_US_GAL = 3.785411784;
const L_PER_UK_GAL = 4.54609;
const KM_PER_MILE = 1.609344;

const UNITS = {
  'l/100km': { label: 'L/100km', inverse: true, toL100: (v) => v, fromL100: (v) => v },
  'km/l': { label: 'km/L', inverse: false, toL100: (v) => 100 / v, fromL100: (v) => 100 / v },
  mpg: { label: 'mpg (US)', inverse: false, toL100: (v) => (100 * L_PER_US_GAL) / (v * KM_PER_MILE), fromL100: (v) => (100 * L_PER_US_GAL) / (v * KM_PER_MILE) },
  'mpg-uk': { label: 'mpg (imperial)', inverse: false, toL100: (v) => (100 * L_PER_UK_GAL) / (v * KM_PER_MILE), fromL100: (v) => (100 * L_PER_UK_GAL) / (v * KM_PER_MILE) }
};

const ALIASES = {
  'l/100km': 'l/100km', 'litres per 100km': 'l/100km', 'liters per 100km': 'l/100km', 'l100km': 'l/100km',
  'km/l': 'km/l', 'kmpl': 'km/l', 'kilometres per litre': 'km/l', 'kilometers per liter': 'km/l',
  mpg: 'mpg', 'mpg-us': 'mpg', 'mpg us': 'mpg', 'miles per gallon': 'mpg', 'us mpg': 'mpg',
  'mpg-uk': 'mpg-uk', 'mpg uk': 'mpg-uk', 'imperial mpg': 'mpg-uk', 'uk mpg': 'mpg-uk'
};

const resolve = (s) => ALIASES[String(s).trim().toLowerCase().replace(/\s+/g, ' ')] ?? null;

export default {
  name: 'convertFuelEconomy',
  description: 'Convert fuel economy between litres per 100km, miles per gallon and kilometres per litre.',
  category: 'conversion', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{amount}} {{fromLabel}} is {{result}} {{toLabel}}.',
  inputSchema: {
    type: 'object', required: ['amount', 'from', 'to'],
    properties: {
      amount: { type: 'number', label: 'fuel economy', carry: true, minimum: 0.01, prompt: 'What is the fuel economy figure?' },
      from: { type: 'string', label: 'from unit', prompt: 'Which unit is it in?' },
      to: { type: 'string', label: 'to unit', prompt: 'Which unit should I convert it to?' }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      result: { type: 'number' }, amount: { type: 'number' },
      fromUnit: { type: 'string' }, toUnit: { type: 'string' },
      fromLabel: { type: 'string' }, toLabel: { type: 'string' }
    }
  },
  examples: [
    { text: 'convert 30 mpg to litres per 100km', input: { amount: 30, from: 'mpg', to: 'l/100km' }, output: { result: 7.84, amount: 30, fromUnit: 'mpg', toUnit: 'l/100km', fromLabel: 'mpg (US)', toLabel: 'L/100km' } },
    { text: 'what is 7.5 l/100km in mpg', input: { amount: 7.5, from: 'l/100km', to: 'mpg' }, output: { result: 31.36, amount: 7.5, fromUnit: 'l/100km', toUnit: 'mpg', fromLabel: 'L/100km', toLabel: 'mpg (US)' } },
    { text: 'convert 40 imperial mpg to l per 100km', input: { amount: 40, from: 'imperial mpg', to: 'l/100km' }, output: { result: 7.06, amount: 40, fromUnit: 'mpg-uk', toUnit: 'l/100km', fromLabel: 'mpg (imperial)', toLabel: 'L/100km' } },
    { text: '8 km per litre in l/100km', input: { amount: 8, from: 'km/l', to: 'l/100km' }, output: { result: 12.5, amount: 8, fromUnit: 'km/l', toUnit: 'l/100km', fromLabel: 'km/L', toLabel: 'L/100km' } },
    { text: 'how many uk mpg is 5 litres per 100km', input: { amount: 5, from: 'l/100km', to: 'mpg-uk' }, output: { result: 56.5, amount: 5, fromUnit: 'l/100km', toUnit: 'mpg-uk', fromLabel: 'L/100km', toLabel: 'mpg (imperial)' } }
  ],
  errorCases: [
    { input: { amount: 30, from: 'mpg', to: 'kg' }, code: 'INVALID_INPUT' },
    { input: { amount: 30, from: 'bananas', to: 'mpg' }, code: 'INVALID_INPUT' },
    { input: { from: 'mpg', to: 'l/100km' }, code: 'MISSING_FIELD' }
  ],
  run (input) {
    const from = resolve(input.from);
    const to = resolve(input.to);
    if (!from) return fail('INVALID_INPUT', `I don't know the fuel economy unit "${input.from}" — try L/100km, mpg, imperial mpg or km/L.`, 'from');
    if (!to) return fail('INVALID_INPUT', `I don't know the fuel economy unit "${input.to}" — try L/100km, mpg, imperial mpg or km/L.`, 'to');

    /* Fuel economy does not convert by a factor: L/100km counts fuel per
       distance and mpg counts distance per fuel, so they are reciprocals of one
       another. Going through L/100km as a common form keeps the reciprocal in
       exactly one place instead of once per pair. */
    const asL100 = UNITS[from].toL100(input.amount);
    const result = UNITS[to].fromL100(asL100);

    return ok({
      result: round(result, 2), amount: input.amount,
      fromUnit: from, toUnit: to,
      fromLabel: UNITS[from].label, toLabel: UNITS[to].label
    }, computed());
  }
};
