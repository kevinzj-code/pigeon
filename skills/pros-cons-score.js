import { ok, fail, computed } from '../src/contracts.js';
import { round } from '../src/lib/num.js';

const side = (list, field) => list.map((x, i) => {
  const text = typeof x === 'string' ? x : x?.text;
  const weight = typeof x === 'string' ? 1 : (x?.weight ?? 1);
  if (!text) return { error: `${field} ${i + 1} has no text` };
  if (!Number.isFinite(Number(weight))) return { error: `${field} ${i + 1} has a weight that is not a number` };
  return { text: String(text), weight: Number(weight) };
});

export default {
  name: 'prosConsScore',
  description: 'Add up weighted pros and cons and show the balance.',
  category: 'decisions', tier: 'standard',
  title: 'Pros and cons score',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: 'Pros {{prosTotal}}, cons {{consTotal}}, leaving {{net}}. These are your own weights added up — the arithmetic is mine, the judgement is yours.\n{{lines|lines}}',
  inputSchema: {
    type: 'object', required: ['pros', 'cons'],
    properties: {
      pros: { type: 'array', label: 'pros', minItems: 1, maxItems: 50, prompt: 'What are the points in favour?' },
      cons: { type: 'array', label: 'cons', minItems: 1, maxItems: 50, prompt: 'And the points against?' }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      prosTotal: { type: 'number' }, consTotal: { type: 'number' }, net: { type: 'number' },
      leaning: { type: 'string' }, lines: { type: 'array', items: { type: 'string' } },
      prosCount: { type: 'integer' }, consCount: { type: 'integer' }
    }
  },
  examples: [
    { text: 'weigh up these pros and cons', input: { pros: [{ text: 'cheaper', weight: 3 }, { text: 'closer to work', weight: 2 }], cons: [{ text: 'smaller', weight: 2 }, { text: 'no garden', weight: 1 }] }, output: { prosTotal: 5, consTotal: 3, net: 2, leaning: 'pros', lines: ['+ cheaper (3)', '+ closer to work (2)', '- smaller (2)', '- no garden (1)'], prosCount: 2, consCount: 2 } },
    { text: 'score my pros and cons list', input: { pros: ['fun', 'cheap'], cons: ['far away'] }, output: { prosTotal: 2, consTotal: 1, net: 1, leaning: 'pros', lines: ['+ fun (1)', '+ cheap (1)', '- far away (1)'], prosCount: 2, consCount: 1 } },
    { text: 'is this decision balanced', input: { pros: [{ text: 'good pay', weight: 5 }], cons: [{ text: 'long commute', weight: 3 }, { text: 'less free time', weight: 2 }] }, output: { prosTotal: 5, consTotal: 5, net: 0, leaning: 'balanced', lines: ['+ good pay (5)', '- long commute (3)', '- less free time (2)'], prosCount: 1, consCount: 2 } },
    { text: 'weigh a decision that leans against', input: { pros: [{ text: 'nice view', weight: 1 }], cons: [{ text: 'expensive', weight: 4 }] }, output: { prosTotal: 1, consTotal: 4, net: -3, leaning: 'cons', lines: ['+ nice view (1)', '- expensive (4)'], prosCount: 1, consCount: 1 } },
    { text: 'add up these weighted arguments', input: { pros: [{ text: 'faster', weight: 2.5 }], cons: [{ text: 'riskier', weight: 1.5 }] }, output: { prosTotal: 2.5, consTotal: 1.5, net: 1, leaning: 'pros', lines: ['+ faster (2.5)', '- riskier (1.5)'], prosCount: 1, consCount: 1 } }
  ],
  errorCases: [
    { input: { pros: [], cons: ['x'] }, code: 'INVALID_INPUT' },
    { input: { pros: [{ weight: 2 }], cons: ['x'] }, code: 'INVALID_INPUT' },
    { input: { pros: ['x'] }, code: 'MISSING_FIELD' }
  ],
  run (input) {
    const pros = side(input.pros, 'pro');
    const cons = side(input.cons, 'con');
    const broken = [...pros, ...cons].find((x) => x.error);
    if (broken) return fail('INVALID_INPUT', `${broken.error}.`, 'pros');

    const prosTotal = round(pros.reduce((a, p) => a + p.weight, 0), 10);
    const consTotal = round(cons.reduce((a, c) => a + c.weight, 0), 10);
    const net = round(prosTotal - consTotal, 10);

    /* "leaning" reports which side the numbers came out on. It is not a
       recommendation — the weights were the user's, and a total is a total. */
    return ok({
      prosTotal, consTotal, net,
      leaning: net > 0 ? 'pros' : net < 0 ? 'cons' : 'balanced',
      lines: [...pros.map((p) => `+ ${p.text} (${p.weight})`), ...cons.map((c) => `- ${c.text} (${c.weight})`)],
      prosCount: pros.length, consCount: cons.length
    }, computed());
  }
};
