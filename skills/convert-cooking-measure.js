import { ok, fail, bundled, computed } from '../src/contracts.js';
import { DIMENSIONS, resolveUnit } from '../src/lib/units.js';
import { sig } from '../src/lib/num.js';

/* Grams per millilitre. This is the one table in the registry where the
   numbers are genuinely approximate rather than definitional — flour packs
   differently depending on whether it was scooped or spooned, and brown sugar
   depends entirely on how hard you pressed. Published values vary by ±10%.
 *
 * So: the table is dated (it is bundled data, not a constant), every
 * volume↔weight answer carries the "estimate" label, and the reply says which
 * ingredient's density it used. A conversion that silently implied precision
 * here would be exactly the confident-but-wrong answer §1 exists to prevent.
 * Volume→volume and weight→weight need no density and are marked "computed". */
const DENSITY = {
  water: 1, milk: 1.03, 'whole milk': 1.03, cream: 1.01, stock: 1, juice: 1.05,
  oil: 0.92, 'olive oil': 0.92, 'vegetable oil': 0.92, butter: 0.911, honey: 1.42,
  'maple syrup': 1.32, treacle: 1.4, 'golden syrup': 1.43,
  flour: 0.53, 'plain flour': 0.53, 'all purpose flour': 0.53, 'bread flour': 0.55,
  'wholemeal flour': 0.55, cornflour: 0.48, cornstarch: 0.48,
  sugar: 0.85, 'caster sugar': 0.85, 'granulated sugar': 0.85,
  'icing sugar': 0.56, 'powdered sugar': 0.56, 'brown sugar': 0.93,
  salt: 1.22, 'table salt': 1.22, rice: 0.85, oats: 0.41, 'rolled oats': 0.41,
  cocoa: 0.51, 'cocoa powder': 0.51, breadcrumbs: 0.35,
  'chocolate chips': 0.68, nuts: 0.5, raisins: 0.6, yoghurt: 1.03, yogurt: 1.03
};
const DENSITY_AS_OF = '2026-08-29';

export default {
  name: 'convertCookingMeasure',
  description: 'Convert a cooking measure between cups, spoons, millilitres and grams, using the ingredient to get weight right.',
  category: 'everyday',
  tier: 'core',
  unbuilt: false, needsNetwork: false, dataAsOf: DENSITY_AS_OF, labels: ['estimate'],
  replyTemplate: '{{amount}} {{fromUnit}} of {{ingredient}} is about {{result}} {{toUnit}}.{{note|prose}}',
  inputSchema: {
    type: 'object',
    required: ['amount', 'from', 'to'],
    properties: {
      amount: { type: 'number', label: 'amount', carry: true, exclusiveMinimum: 0, prompt: 'How much?' },
      from: { type: 'string', label: 'from unit', prompt: 'From which measure? (cups, tbsp, tsp, ml, g)' },
      to: { type: 'string', label: 'to unit', prompt: 'To which measure?' },
      ingredient: { type: 'string', label: 'ingredient', description: 'needed to go between volume and weight' }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      result: { type: 'number' }, amount: { type: 'number' }, fromUnit: { type: 'string' },
      toUnit: { type: 'string' }, ingredient: { type: 'string' }, density: { type: 'number' },
      note: { type: 'string' }
    }
  },
  examples: [
    { text: 'how many grams is 2 cups of flour', input: { amount: 2, from: 'cups', to: 'g', ingredient: 'flour' },
      output: { result: 250.8, amount: 2, fromUnit: 'cup', toUnit: 'g', ingredient: 'flour', density: 0.53, note: ' Weights from volume are approximate — flour packs differently depending how it is measured.' } },
    { text: 'convert 250g of sugar to cups', input: { amount: 250, from: 'g', to: 'cups', ingredient: 'sugar' },
      output: { result: 1.243, amount: 250, fromUnit: 'g', toUnit: 'cup', ingredient: 'sugar', density: 0.85, note: ' Weights from volume are approximate — flour packs differently depending how it is measured.' } },
    { text: '3 tablespoons of butter in grams', input: { amount: 3, from: 'tbsp', to: 'g', ingredient: 'butter' },
      output: { result: 40.41, amount: 3, fromUnit: 'tbsp', toUnit: 'g', ingredient: 'butter', density: 0.911, note: ' Weights from volume are approximate — flour packs differently depending how it is measured.' } },
    { text: 'how many ml is 1 cup', input: { amount: 1, from: 'cup', to: 'ml' },
      output: { result: 236.6, amount: 1, fromUnit: 'cup', toUnit: 'ml', ingredient: '', density: 0, note: '' } },
    { text: 'convert 4 teaspoons to tablespoons', input: { amount: 4, from: 'tsp', to: 'tbsp' },
      output: { result: 1.333, amount: 4, fromUnit: 'tsp', toUnit: 'tbsp', ingredient: '', density: 0, note: '' } }
  ],
  errorCases: [
    { input: { amount: 2, from: 'cups', to: 'g' }, code: 'MISSING_FIELD' },
    { input: { amount: 2, from: 'cups', to: 'g', ingredient: 'unobtainium' }, code: 'INVALID_INPUT' },
    { input: { amount: 2, from: 'furlongs', to: 'g' }, code: 'INVALID_INPUT' }
  ],
  run (input) {
    const a = resolveUnit(input.from);
    if (!a) return fail('INVALID_INPUT', `I don't know the measure "${input.from}".`, 'from');
    const b = resolveUnit(input.to);
    if (!b) return fail('INVALID_INPUT', `I don't know the measure "${input.to}".`, 'to');
    for (const [field, u] of [['from', a], ['to', b]]) {
      if (u.dimension !== 'volume' && u.dimension !== 'mass') {
        return fail('INVALID_INPUT', `${u.unit} is neither a volume nor a weight, so it isn't a cooking measure.`, field);
      }
    }

    /* Same dimension both ends: no density needed, no estimate label earned. */
    if (a.dimension === b.dimension) {
      const def = DIMENSIONS[a.dimension];
      const raw = input.amount * def.units[a.unit] / def.units[b.unit];
      return ok({
        result: sig(raw, 4), amount: input.amount, fromUnit: a.unit, toUnit: b.unit,
        ingredient: '', density: 0, note: ''
      }, computed());
    }

    /* Crossing between volume and weight REQUIRES the ingredient. Without it
       there is no honest number, so the schema's prompt asks for one. */
    if (!input.ingredient) {
      return { ok: false, error: { code: 'MISSING_FIELD', field: 'ingredient', message: 'Going between a volume and a weight needs to know the ingredient — a cup of flour and a cup of honey weigh very different amounts.' } };
    }
    const key = String(input.ingredient).trim().toLowerCase();
    const density = DENSITY[key];
    if (density === undefined) {
      return fail('INVALID_INPUT', `I don't have a density for "${input.ingredient}". I know about ${Object.keys(DENSITY).slice(0, 6).join(', ')} and others.`, 'ingredient');
    }

    const ml = a.dimension === 'volume'
      ? input.amount * DIMENSIONS.volume.units[a.unit] * 1000
      : null;
    const grams = a.dimension === 'mass'
      ? input.amount * DIMENSIONS.mass.units[a.unit] * 1000
      : null;

    const raw = a.dimension === 'volume'
      ? (ml * density) / (DIMENSIONS.mass.units[b.unit] * 1000)
      : (grams / density) / (DIMENSIONS.volume.units[b.unit] * 1000);

    return ok({
      result: sig(raw, 4), amount: input.amount, fromUnit: a.unit, toUnit: b.unit,
      ingredient: key, density,
      note: ' Weights from volume are approximate — flour packs differently depending how it is measured.'
    }, bundled(DENSITY_AS_OF));
  }
};
