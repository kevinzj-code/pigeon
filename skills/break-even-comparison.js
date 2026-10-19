import { ok, fail, computed } from '../src/contracts.js';
import { round } from '../src/lib/num.js';

export default {
  name: 'breakEvenComparison',
  description: "Find the point at which one option starts to pay off against another.",
  category: 'decisions', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{summary|prose}}',
  inputSchema: {
    type: 'object', required: ['fixedA', 'perUnitA', 'fixedB', 'perUnitB'],
    properties: {
      fixedA: { type: 'number', label: 'first option up front', minimum: 0, prompt: 'What does the first option cost up front?' },
      perUnitA: { type: 'number', label: 'first option per unit', minimum: 0, prompt: 'And per unit?' },
      fixedB: { type: 'number', label: 'second option up front', minimum: 0, prompt: 'What does the second option cost up front?' },
      perUnitB: { type: 'number', label: 'second option per unit', minimum: 0, prompt: 'And per unit?' },
      nameA: { type: 'string', label: 'first option name', default: 'A' },
      nameB: { type: 'string', label: 'second option name', default: 'B' }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      breakEvenUnits: { type: 'number' }, costAtBreakEven: { type: 'number' },
      cheaperBelow: { type: 'string' }, cheaperAbove: { type: 'string' },
      summary: { type: 'string' }, crosses: { type: 'boolean' }
    }
  },
  examples: [
    { text: 'when does the subscription beat paying per use', input: { fixedA: 100, perUnitA: 5, fixedB: 0, perUnitB: 10 }, output: { breakEvenUnits: 20, costAtBreakEven: 200, cheaperBelow: 'B', cheaperAbove: 'A', crosses: true, summary: 'They cost the same at 20 units, 200 each. Below that B is cheaper; above it A is.' } },
    { text: 'break even between buying and renting', input: { fixedA: 0, perUnitA: 12, fixedB: 240, perUnitB: 4, nameA: 'renting', nameB: 'buying' }, output: { breakEvenUnits: 30, costAtBreakEven: 360, cheaperBelow: 'renting', cheaperAbove: 'buying', crosses: true, summary: 'They cost the same at 30 units, 360 each. Below that renting is cheaper; above it buying is.' } },
    { text: 'compare two pricing plans', input: { fixedA: 500, perUnitA: 2, fixedB: 200, perUnitB: 3.5 }, output: { breakEvenUnits: 200, costAtBreakEven: 900, cheaperBelow: 'B', cheaperAbove: 'A', crosses: true, summary: 'They cost the same at 200 units, 900 each. Below that B is cheaper; above it A is.' } },
    { text: 'is there a break even point here', input: { fixedA: 100, perUnitA: 5, fixedB: 50, perUnitB: 5 }, output: { breakEvenUnits: null, costAtBreakEven: null, cheaperBelow: 'B', cheaperAbove: 'B', crosses: false, summary: 'They never cross — both cost the same per unit, so B stays 50 cheaper at every quantity.' } },
    { text: 'break even on a cheaper machine with pricier supplies', input: { fixedA: 30, perUnitA: 1, fixedB: 10, perUnitB: 3 }, output: { breakEvenUnits: 10, costAtBreakEven: 40, cheaperBelow: 'B', cheaperAbove: 'A', crosses: true, summary: 'They cost the same at 10 units, 40 each. Below that B is cheaper; above it A is.' } }
  ],
  errorCases: [
    { input: { fixedA: 100, perUnitA: 5, fixedB: 100, perUnitB: 5 }, code: 'INVALID_INPUT' },
    { input: { fixedA: 100, perUnitA: 5, fixedB: 0 }, code: 'MISSING_FIELD' },
    { input: { fixedA: -5, perUnitA: 5, fixedB: 0, perUnitB: 10 }, code: 'INVALID_INPUT' }
  ],
  run (input) {
    const { fixedA, perUnitA, fixedB, perUnitB } = input;
    const nameA = input.nameA ?? 'A';
    const nameB = input.nameB ?? 'B';

    if (perUnitA === perUnitB) {
      /* Parallel lines: same slope, so the gap never closes. Reporting a
         break-even quantity here would mean dividing by zero and calling the
         infinity a number of units. */
      if (fixedA === fixedB) return fail('INVALID_INPUT', 'Those two options are identical at every quantity, so there is nothing to compare.', 'fixedB');
      const cheaper = fixedA < fixedB ? nameA : nameB;
      return ok({
        breakEvenUnits: null, costAtBreakEven: null, cheaperBelow: cheaper, cheaperAbove: cheaper, crosses: false,
        summary: `They never cross — both cost the same per unit, so ${cheaper} stays ${round(Math.abs(fixedA - fixedB), 10)} cheaper at every quantity.`
      }, computed());
    }

    const units = (fixedB - fixedA) / (perUnitA - perUnitB);
    if (units < 0) {
      const cheaper = fixedA + perUnitA < fixedB + perUnitB ? nameA : nameB;
      return ok({
        breakEvenUnits: null, costAtBreakEven: null, cheaperBelow: cheaper, cheaperAbove: cheaper, crosses: false,
        summary: `They only cross at a negative quantity, so ${cheaper} is cheaper for every real number of units.`
      }, computed());
    }

    const cost = round(fixedA + perUnitA * units, 10);
    const belowIsA = fixedA + perUnitA * (units / 2 || 0) < fixedB + perUnitB * (units / 2 || 0);
    return ok({
      breakEvenUnits: round(units, 10), costAtBreakEven: cost,
      cheaperBelow: belowIsA ? nameA : nameB, cheaperAbove: belowIsA ? nameB : nameA, crosses: true,
      summary: `They cost the same at ${round(units, 10)} units, ${cost} each. Below that ${belowIsA ? nameA : nameB} is cheaper; above it ${belowIsA ? nameB : nameA} is.`
    }, computed());
  }
};
