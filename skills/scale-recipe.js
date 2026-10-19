import { ok, fail, computed } from '../src/contracts.js';
import { toKitchenFraction, round } from '../src/lib/num.js';

/* The spec's own §4.1 worked example. Takes either structured ingredients or
   the line-per-ingredient text people actually paste out of a recipe.
 *
 * The interesting decision is the rounding: scaling 3/4 tsp by 1.5 gives
 * 1.125 tsp, and no measuring spoon expresses that. toKitchenFraction snaps to
 * the denominators a kitchen actually has. Counts of whole things (eggs) are a
 * separate case — half an egg is a real instruction, 1.5 eggs is not — so
 * those round to the nearest half and the reply leaves them as written. */

const UNIT_WORDS = /^(cups?|tbsps?|tablespoons?|tsps?|teaspoons?|g|grams?|kg|kilos?|kilograms?|ml|millilitres?|milliliters?|l|litres?|liters?|oz|ounces?|lbs?|pounds?|cloves?|slices?|pinch(?:es)?|cans?|tins?|sticks?|sprigs?|handfuls?|bunch(?:es)?|packets?|sachets?)\b/i;

const VULGAR = { '½': 0.5, '⅓': 1 / 3, '⅔': 2 / 3, '¼': 0.25, '¾': 0.75, '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875 };

/** "2 1/2 cups flour" / "1½ cups flour" / "3 eggs" → {amount, unit, item}. */
function parseIngredient (line) {
  const raw = String(line).trim();
  if (!raw) return null;

  let rest = raw;
  let amount = null;

  /* Mixed numbers first ("2 1/2"), then vulgar fractions, then a plain number.
     Order matters: matching the plain number first would read "2 1/2" as 2. */
  const mixed = /^(\d+)\s+(\d+)\/(\d+)\s*/.exec(rest);
  const vulgarMixed = /^(\d+)\s*([½⅓⅔¼¾⅛⅜⅝⅞])\s*/.exec(rest);
  const fraction = /^(\d+)\/(\d+)\s*/.exec(rest);
  const vulgar = /^([½⅓⅔¼¾⅛⅜⅝⅞])\s*/.exec(rest);
  const plain = /^(\d+(?:\.\d+)?)\s*/.exec(rest);

  if (mixed) { amount = Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]); rest = rest.slice(mixed[0].length); }
  else if (vulgarMixed) { amount = Number(vulgarMixed[1]) + VULGAR[vulgarMixed[2]]; rest = rest.slice(vulgarMixed[0].length); }
  else if (fraction) { amount = Number(fraction[1]) / Number(fraction[2]); rest = rest.slice(fraction[0].length); }
  else if (vulgar) { amount = VULGAR[vulgar[1]]; rest = rest.slice(vulgar[0].length); }
  else if (plain) { amount = Number(plain[1]); rest = rest.slice(plain[0].length); }

  if (amount === null) return { amount: null, unit: '', item: raw };

  const u = UNIT_WORDS.exec(rest.trim());
  const unit = u ? u[0] : '';
  const item = (u ? rest.trim().slice(u[0].length) : rest).trim().replace(/^of\s+/i, '');
  return { amount, unit, item };
}

const isCount = (unit) => !unit || /^(cloves?|slices?|cans?|tins?|sticks?|sprigs?|packets?|sachets?)$/i.test(unit);

export default {
  name: 'scaleRecipe',
  description: 'Multiply every ingredient amount in a recipe by a factor, rounded to sensible kitchen fractions.',
  category: 'everyday',
  tier: 'core',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: 'Scaled to {{factor}}×: {{scaled|list}}',
  inputSchema: {
    type: 'object',
    required: ['ingredients', 'factor'],
    properties: {
      ingredients: { type: 'array', label: 'ingredients', items: { type: 'string' }, minItems: 1, prompt: 'Which ingredients should I scale? One per line.' },
      factor: { type: 'number', label: 'multiply by', exclusiveMinimum: 0, prompt: 'By what factor? (2 to double, 0.5 to halve)' }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      scaled: { type: 'array', items: { type: 'string' } }, factor: { type: 'number' },
      count: { type: 'integer' }, unparsed: { type: 'array', items: { type: 'string' } }
    }
  },
  examples: [
    { text: 'double this recipe: 2 cups flour, 1 egg, 3/4 tsp salt', input: { ingredients: ['2 cups flour', '1 egg', '3/4 tsp salt'], factor: 2 },
      output: { scaled: ['4 cups flour', '2 egg', '1½ tsp salt'], factor: 2, count: 3, unparsed: [] } },
    { text: 'halve these: 1 cup sugar, 2 tbsp butter, 4 eggs', input: { ingredients: ['1 cup sugar', '2 tbsp butter', '4 eggs'], factor: 0.5 },
      output: { scaled: ['½ cup sugar', '1 tbsp butter', '2 eggs'], factor: 0.5, count: 3, unparsed: [] } },
    { text: 'scale by 1.5: 500 g pasta, 200 ml cream', input: { ingredients: ['500 g pasta', '200 ml cream'], factor: 1.5 },
      output: { scaled: ['750 g pasta', '300 ml cream'], factor: 1.5, count: 2, unparsed: [] } },
    { text: 'triple 1½ cups oats and ⅓ cup honey', input: { ingredients: ['1½ cups oats', '⅓ cup honey'], factor: 3 },
      output: { scaled: ['4½ cups oats', '1 cup honey'], factor: 3, count: 2, unparsed: [] } },
    { text: 'double a list with a line that has no amount', input: { ingredients: ['2 cups rice', 'salt to taste'], factor: 2 },
      output: { scaled: ['4 cups rice', 'salt to taste'], factor: 2, count: 2, unparsed: ['salt to taste'] } }
  ],
  errorCases: [
    { input: { ingredients: ['2 cups flour'], factor: 0 }, code: 'INVALID_INPUT' },
    { input: { ingredients: [], factor: 2 }, code: 'INVALID_INPUT' },
    { input: { ingredients: ['2 cups flour'] }, code: 'MISSING_FIELD' }
  ],
  run (input) {
    if (!input.ingredients.length) return fail('INVALID_INPUT', 'There are no ingredients to scale.', 'ingredients');

    const unparsed = [];
    const scaled = input.ingredients.map(line => {
      const p = parseIngredient(line);
      if (!p || p.amount === null) {
        /* A line with no number ("salt to taste") passes through untouched and
           is REPORTED as untouched. Silently dropping it would lose an
           ingredient; silently scaling it is impossible. */
        unparsed.push(String(line).trim());
        return String(line).trim();
      }
      const value = p.amount * input.factor;
      const shown = isCount(p.unit)
        ? String(round(Math.round(value * 2) / 2, 2))
        : toKitchenFraction(value);
      return [shown, p.unit, p.item].filter(Boolean).join(' ');
    });

    return ok({ scaled, factor: input.factor, count: scaled.length, unparsed }, computed());
  }
};
