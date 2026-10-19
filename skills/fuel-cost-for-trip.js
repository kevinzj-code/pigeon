import { ok, fail, computed } from '../src/contracts.js';
import { round } from '../src/lib/num.js';

export default {
  name: 'fuelCostForTrip',
  description: 'Work out the fuel cost of a journey from distance, consumption and fuel price.',
  category: 'everyday', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{fuelUsed}} {{fuelUnit}} for {{distance}} {{distanceUnit}}, costing {{cost}} at {{price}} per {{fuelUnit}}.',
  inputSchema: {
    type: 'object', required: ['distance', 'price'],
    properties: {
      distance: { type: 'number', label: 'distance', minimum: 0, prompt: 'How far is the trip?' },
      price: { type: 'number', label: 'fuel price', minimum: 0, prompt: 'What does the fuel cost per litre or gallon?' },
      litresPer100km: { type: 'number', label: 'litres per 100km', minimum: 0.1, maximum: 100, description: 'consumption in L/100km' },
      milesPerGallon: { type: 'number', label: 'miles per gallon', minimum: 1, maximum: 200, description: 'consumption in miles per gallon' },
      returnTrip: { type: 'boolean', label: 'return trip', default: false }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      cost: { type: 'number' }, fuelUsed: { type: 'number' }, fuelUnit: { type: 'string' },
      distance: { type: 'number' }, distanceUnit: { type: 'string' }, price: { type: 'number' }
    }
  },
  examples: [
    { text: 'fuel cost for a 500km trip at 7.5 litres per 100km and 1.65 a litre', input: { distance: 500, litresPer100km: 7.5, price: 1.65 }, output: { cost: 61.88, fuelUsed: 37.5, fuelUnit: 'litres', distance: 500, distanceUnit: 'km', price: 1.65 } },
    { text: 'how much fuel for 320 km at 6.2 L per 100', input: { distance: 320, litresPer100km: 6.2, price: 1.48 }, output: { cost: 29.36, fuelUsed: 19.84, fuelUnit: 'litres', distance: 320, distanceUnit: 'km', price: 1.48 } },
    { text: 'petrol cost for 300 miles at 32 mpg', input: { distance: 300, milesPerGallon: 32, price: 4.25 }, output: { cost: 39.84, fuelUsed: 9.375, fuelUnit: 'gallons', distance: 300, distanceUnit: 'miles', price: 4.25 } },
    { text: 'fuel for a return trip of 120km', input: { distance: 120, litresPer100km: 8, price: 1.5, returnTrip: true }, output: { cost: 28.8, fuelUsed: 19.2, fuelUnit: 'litres', distance: 240, distanceUnit: 'km', price: 1.5 } },
    { text: 'cost of driving 50 km at 5 litres per 100km', input: { distance: 50, litresPer100km: 5, price: 2 }, output: { cost: 5, fuelUsed: 2.5, fuelUnit: 'litres', distance: 50, distanceUnit: 'km', price: 2 } }
  ],
  errorCases: [
    { input: { distance: 100, price: 1.5 }, code: 'INVALID_INPUT' },
    { input: { distance: 100, price: 1.5, litresPer100km: 7, milesPerGallon: 30 }, code: 'INVALID_INPUT' },
    { input: { distance: 100 }, code: 'MISSING_FIELD' }
  ],
  run (input) {
    const metric = input.litresPer100km !== undefined;
    const imperial = input.milesPerGallon !== undefined;
    if (metric === imperial) {
      return fail('INVALID_INPUT', metric
        ? 'Give consumption one way or the other — litres per 100km or miles per gallon, not both.'
        : 'I need the consumption: litres per 100km, or miles per gallon.', 'litresPer100km');
    }

    /* The distance unit follows the consumption unit, because mixing them is
       the one mistake that produces a plausible-looking wrong answer: 500 km at
       32 mpg is not a calculation, it is two different journeys. */
    const distance = input.returnTrip ? input.distance * 2 : input.distance;
    const fuelUsed = metric ? (distance * input.litresPer100km) / 100 : distance / input.milesPerGallon;

    return ok({
      cost: round(fuelUsed * input.price, 2),
      fuelUsed: round(fuelUsed, 4),
      fuelUnit: metric ? 'litres' : 'gallons',
      distance, distanceUnit: metric ? 'km' : 'miles', price: input.price
    }, computed());
  }
};
