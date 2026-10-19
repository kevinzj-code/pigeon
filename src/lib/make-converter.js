/* make-converter.js — §11 lists convertLength, convertMass, convertTemperature,
 * convertVolume, convertDataSize and convertTime as six separate Core skills,
 * not one convertUnit. That is a routing decision, not an implementation one:
 * the index's naming note says "the router matches on `description`, not
 * `name`", and six specific descriptions ("grams, kilograms, pounds, ounces")
 * give the embedding six tight clusters where one generic "convert between
 * units" gives it a vague blob that competes with every other skill.
 *
 * So: six registry entries, six description strings, six example sets — and
 * one implementation, here, because the arithmetic genuinely is identical and
 * six copies of it would be six places for a factor to drift. */

import { ok, fail, computed } from '../contracts.js';
import { DIMENSIONS, TEMPERATURE, resolveUnit } from './units.js';
import { sig } from './num.js';

/* What the number being converted is, in a person's words, for its hover and
   its Change sheet ("Change `length` value"). A dimension not named here reads
   "amount". */
const AMOUNT_LABEL = Object.freeze({
  angle: 'angle', area: 'area', data: 'data size', length: 'length', mass: 'weight',
  speed: 'speed', temperature: 'temperature', time: 'duration', volume: 'volume'
});

export function makeConverter ({ name, dimension, description, examples, errorCases, tier = 'core' }) {
  return {
    name,
    description,
    category: 'conversion',
    tier,
    unbuilt: false,
    needsNetwork: false,
    dataAsOf: null,
    labels: [],
    replyTemplate: '{{amount}} {{fromUnit}} is {{result}} {{toUnit}}.',
    inputSchema: {
      type: 'object',
      required: ['amount', 'from', 'to'],
      properties: {
        amount: { type: 'number', carry: true, prompt: 'How much should I convert?', label: AMOUNT_LABEL[dimension] || 'amount' },
        from: { type: 'string', prompt: 'Converting from which unit?', label: 'from unit' },
        to: { type: 'string', prompt: 'Converting to which unit?', label: 'to unit' }
      }
    },
    outputSchema: {
      type: 'object',
      properties: {
        result: { type: 'number' }, amount: { type: 'number' },
        fromUnit: { type: 'string' }, toUnit: { type: 'string' },
        dimension: { type: 'string' }, exact: { type: 'boolean' }
      }
    },
    examples,
    errorCases,
    run (input) {
      const a = resolveUnit(input.from);
      if (!a) return fail('INVALID_INPUT', `I don't know the unit "${input.from}".`, 'from');
      const b = resolveUnit(input.to);
      if (!b) return fail('INVALID_INPUT', `I don't know the unit "${input.to}".`, 'to');

      /* Each skill owns ONE dimension. A length skill handed kilograms refuses
         rather than quietly converting them, because the router picking the
         wrong one of six near-neighbours is a realistic failure and a silent
         cross-dimension answer would hide it. */
      for (const [field, u] of [['from', a], ['to', b]]) {
        if (u.dimension !== dimension) {
          return fail('INVALID_INPUT', `${u.unit} measures ${u.dimension}, and this converts ${dimension}.`, field);
        }
      }

      let result;
      if (dimension === 'temperature') {
        result = TEMPERATURE.fromC[b.unit](TEMPERATURE.toC[a.unit](input.amount));
      } else {
        const def = DIMENSIONS[dimension];
        result = input.amount * def.units[a.unit] / def.units[b.unit];
      }
      if (!Number.isFinite(result)) return fail('INVALID_INPUT', 'That does not come out to a finite number.', 'amount');

      /* Four significant figures, not two decimals: 0.0001 km and 40000 km both
         want ~4 meaningful digits, and a fixed decimal place would round one of
         them to nothing and pad the other with noise. */
      const rounded = sig(result, 4);
      return ok({
        result: rounded,
        amount: input.amount,
        fromUnit: a.unit,
        toUnit: b.unit,
        dimension,
        /* Whether the number shown IS the answer or a rounding of it. §3's
           honesty rule applies to precision too. */
        exact: rounded === result
      }, computed());
    }
  };
}
