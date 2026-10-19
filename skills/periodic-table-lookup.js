import { ok, fail, bundled } from '../src/contracts.js';
import { ELEMENTS, ELEMENTS_AS_OF } from '../src/lib/elements.js';

const article = (c) => (/^[aeiou]/.test(c) ? 'an' : 'a');

export default {
  name: 'periodicTableLookup',
  description: 'Look up a chemical element — magnesium, Mg, or atomic number 12 — for its symbol, mass and group.',
  category: 'reference', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: ELEMENTS_AS_OF, labels: [],
  replyTemplate: '{{summary|prose}}',
  inputSchema: {
    type: 'object', required: ['query'],
    properties: { query: { type: 'string', label: 'element', minLength: 1, prompt: 'Which element should I look up?' } }
  },
  outputSchema: {
    type: 'object',
    properties: {
      number: { type: 'integer' }, symbol: { type: 'string' }, name: { type: 'string' },
      mass: { type: 'number' }, category: { type: 'string' }, noStandardWeight: { type: 'boolean' },
      summary: { type: 'string' }, dataAsOf: { type: 'string' }
    }
  },
  examples: [
    { text: 'look up the element Au', input: { query: 'Au' }, output: { number: 79, symbol: 'Au', name: 'Gold', mass: 196.97, category: 'transition metal', noStandardWeight: false, summary: 'Gold (Au) is element 79, a transition metal, with a standard atomic weight of 196.97.', dataAsOf: '2026-09-01' } },
    { text: 'what is the atomic weight of carbon', input: { query: 'carbon' }, output: { number: 6, symbol: 'C', name: 'Carbon', mass: 12.011, category: 'nonmetal', noStandardWeight: false, summary: 'Carbon (C) is element 6, a nonmetal, with a standard atomic weight of 12.011.', dataAsOf: '2026-09-01' } },
    { text: 'which element is number 26', input: { query: '26' }, output: { number: 26, symbol: 'Fe', name: 'Iron', mass: 55.845, category: 'transition metal', noStandardWeight: false, summary: 'Iron (Fe) is element 26, a transition metal, with a standard atomic weight of 55.845.', dataAsOf: '2026-09-01' } },
    { text: 'tell me about technetium', input: { query: 'technetium' }, output: { number: 43, symbol: 'Tc', name: 'Technetium', mass: 98, category: 'transition metal', noStandardWeight: true, summary: 'Technetium (Tc) is element 43, a transition metal. It has no standard atomic weight — 98 is the mass number of its most stable isotope.', dataAsOf: '2026-09-01' } },
    { text: 'element 118', input: { query: '118' }, output: { number: 118, symbol: 'Og', name: 'Oganesson', mass: 294, category: 'noble gas', noStandardWeight: true, summary: 'Oganesson (Og) is element 118, a noble gas. It has no standard atomic weight — 294 is the mass number of its most stable isotope.', dataAsOf: '2026-09-01' } },
    { text: 'tell me about the element calcium', input: { query: 'calcium' },
      output: { number: 20, symbol: 'Ca', name: 'Calcium', mass: 40.078, category: 'alkaline earth metal', noStandardWeight: false, summary: 'Calcium (Ca) is element 20, an alkaline earth metal, with a standard atomic weight of 40.078.', dataAsOf: '2026-09-01' } },
    { text: 'what is atomic number 26', input: { query: '26' },
      output: { number: 26, symbol: 'Fe', name: 'Iron', mass: 55.845, category: 'transition metal', noStandardWeight: false, summary: 'Iron (Fe) is element 26, a transition metal, with a standard atomic weight of 55.845.', dataAsOf: '2026-09-01' } }
  ],
  errorCases: [
    { input: { query: 'Xx' }, code: 'INVALID_INPUT' },
    { input: { query: '119' }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' }
  ],
  run (input) {
    const q = String(input.query).trim();
    const lower = q.toLowerCase();
    let hit = null;
    if (/^\d+$/.test(q)) {
      hit = ELEMENTS.find((e) => e.number === Number(q));
      if (!hit) return fail('INVALID_INPUT', `There is no element ${q} — the periodic table runs from 1 to 118.`, 'query');
    } else {
      hit = ELEMENTS.find((e) => e.symbol.toLowerCase() === lower) ?? ELEMENTS.find((e) => e.name.toLowerCase() === lower);
    }
    if (!hit) return fail('INVALID_INPUT', `"${q}" is not an element symbol or name I recognise.`, 'query');

    /* Two different quantities share the "mass" field, so the sentence has to
       say which one it is. Presenting a mass number as a standard atomic weight
       would be a small, quiet, entirely avoidable lie. */
    const summary = hit.noStandardWeight
      ? `${hit.name} (${hit.symbol}) is element ${hit.number}, ${article(hit.category)} ${hit.category}. It has no standard atomic weight — ${hit.mass} is the mass number of its most stable isotope.`
      : `${hit.name} (${hit.symbol}) is element ${hit.number}, ${article(hit.category)} ${hit.category}, with a standard atomic weight of ${hit.mass}.`;

    return ok({ ...hit, summary, dataAsOf: ELEMENTS_AS_OF }, bundled(ELEMENTS_AS_OF));
  }
};
