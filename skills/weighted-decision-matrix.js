import { ok, fail, computed } from '../src/contracts.js';
import { round } from '../src/lib/num.js';

/* Every number here is the user's: the options, the criteria, the weights and
   the scores all arrive as input. The skill does the arithmetic and the
   ranking, and nothing else — it has no opinion about which criteria matter,
   and the reply says the ranking follows the weights it was given. That is the
   whole difference between decision SUPPORT and advice. */
export default {
  name: 'weightedDecisionMatrix',
  description: 'Score options against weighted criteria and rank them, from scores you provide.',
  category: 'decisions',
  tier: 'core',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{winner}} comes out top at {{winnerScore}}, ahead of {{runnerUp}} at {{runnerUpScore}}. Full ranking: {{ranked|list}}. These follow the weights you gave.',
  inputSchema: {
    type: 'object',
    required: ['options', 'criteria', 'weights', 'scores'],
    properties: {
      options: { type: 'array', label: 'options', items: { type: 'string' }, minItems: 2, prompt: 'Which options are you deciding between?' },
      criteria: { type: 'array', label: 'criteria', items: { type: 'string' }, minItems: 1, prompt: 'What criteria matter?' },
      weights: { type: 'array', label: 'weights', items: { type: 'number' }, minItems: 1, prompt: 'How much does each criterion weigh?' },
      scores: { type: 'array', label: 'scores', minItems: 2, prompt: 'Score each option against each criterion — one row of numbers per option.' }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      results: { type: 'array' }, ranked: { type: 'array', items: { type: 'string' } },
      winner: { type: 'string' }, winnerScore: { type: 'number' },
      runnerUp: { type: 'string' }, runnerUpScore: { type: 'number' },
      margin: { type: 'number' }, close: { type: 'boolean' }
    }
  },
  examples: [
    { text: 'help me choose between two flats on price and commute', input: { options: ['Flat A', 'Flat B'], criteria: ['price', 'commute'], weights: [3, 2], scores: [[8, 4], [5, 9]] },
      output: { results: [{ option: 'Flat B', total: 6.6, breakdown: [3, 3.6] }, { option: 'Flat A', total: 6.4, breakdown: [4.8, 1.6] }], ranked: ['Flat B 6.6', 'Flat A 6.4'], winner: 'Flat B', winnerScore: 6.6, runnerUp: 'Flat A', runnerUpScore: 6.4, margin: 0.2, close: true } },
    { text: 'rank three job offers', input: { options: ['Offer A', 'Offer B', 'Offer C'], criteria: ['salary', 'team', 'growth'], weights: [4, 3, 3], scores: [[9, 5, 6], [6, 9, 7], [7, 7, 9]] },
      output: { results: [{ option: 'Offer C', total: 7.6, breakdown: [2.8, 2.1, 2.7] }, { option: 'Offer B', total: 7.2, breakdown: [2.4, 2.7, 2.1] }, { option: 'Offer A', total: 6.9, breakdown: [3.6, 1.5, 1.8] }], ranked: ['Offer C 7.6', 'Offer B 7.2', 'Offer A 6.9'], winner: 'Offer C', winnerScore: 7.6, runnerUp: 'Offer B', runnerUpScore: 7.2, margin: 0.4, close: false } },
    { text: 'decide between two laptops', input: { options: ['Laptop X', 'Laptop Y'], criteria: ['battery', 'weight', 'price'], weights: [5, 3, 2], scores: [[9, 6, 4], [5, 9, 8]] },
      output: { results: [{ option: 'Laptop X', total: 7.1, breakdown: [4.5, 1.8, 0.8] }, { option: 'Laptop Y', total: 6.8, breakdown: [2.5, 2.7, 1.6] }], ranked: ['Laptop X 7.1', 'Laptop Y 6.8'], winner: 'Laptop X', winnerScore: 7.1, runnerUp: 'Laptop Y', runnerUpScore: 6.8, margin: 0.3, close: true } },
    { text: 'a decision where one option clearly wins', input: { options: ['Good', 'Poor'], criteria: ['a', 'b'], weights: [1, 1], scores: [[9, 9], [2, 2]] },
      output: { results: [{ option: 'Good', total: 9, breakdown: [4.5, 4.5] }, { option: 'Poor', total: 2, breakdown: [1, 1] }], ranked: ['Good 9', 'Poor 2'], winner: 'Good', winnerScore: 9, runnerUp: 'Poor', runnerUpScore: 2, margin: 7, close: false } },
    { text: 'compare two suppliers on one criterion', input: { options: ['Supplier 1', 'Supplier 2'], criteria: ['reliability'], weights: [1], scores: [[7], [8]] },
      output: { results: [{ option: 'Supplier 2', total: 8, breakdown: [8] }, { option: 'Supplier 1', total: 7, breakdown: [7] }], ranked: ['Supplier 2 8', 'Supplier 1 7'], winner: 'Supplier 2', winnerScore: 8, runnerUp: 'Supplier 1', runnerUpScore: 7, margin: 1, close: false } }
  ],
  errorCases: [
    { input: { options: ['A', 'B'], criteria: ['x'], weights: [1, 2], scores: [[1], [2]] }, code: 'INVALID_INPUT' },
    { input: { options: ['A', 'B'], criteria: ['x'], weights: [1], scores: [[1]] }, code: 'INVALID_INPUT' },
    { input: { options: ['A', 'B'], criteria: ['x'], weights: [1] }, code: 'MISSING_FIELD' }
  ],
  run (input) {
    if (input.criteria.length !== input.weights.length) {
      return fail('INVALID_INPUT', `There are ${input.criteria.length} criteria but ${input.weights.length} weights — they have to match up.`, 'weights');
    }
    if (input.scores.length !== input.options.length) {
      return fail('INVALID_INPUT', `There are ${input.options.length} options but ${input.scores.length} rows of scores.`, 'scores');
    }
    for (const [i, row] of input.scores.entries()) {
      if (!Array.isArray(row) || row.length !== input.criteria.length) {
        return fail('INVALID_INPUT', `The scores for "${input.options[i]}" need one number per criterion (${input.criteria.length}).`, 'scores');
      }
      if (row.some(v => typeof v !== 'number' || !Number.isFinite(v))) {
        return fail('INVALID_INPUT', `The scores for "${input.options[i]}" have to all be numbers.`, 'scores');
      }
    }
    const totalWeight = input.weights.reduce((a, b) => a + b, 0);
    if (totalWeight <= 0) return fail('INVALID_INPUT', 'The weights add up to zero, so nothing can be ranked.', 'weights');

    /* Normalised by total weight, so the score stays on the same scale as the
       inputs — a 1–10 scoring scheme produces a 1–10 result rather than a
       number whose size depends on how many criteria you happened to list. */
    const results = input.options.map((option, i) => {
      const breakdown = input.scores[i].map((s, j) => round(s * input.weights[j] / totalWeight, 4));
      return { option, total: round(breakdown.reduce((a, b) => a + b, 0), 4), breakdown };
    }).sort((a, b) => b.total - a.total);

    const margin = round(results[0].total - results[1].total, 4);
    return ok({
      results,
      ranked: results.map(r => `${r.option} ${r.total}`),
      winner: results[0].option, winnerScore: results[0].total,
      runnerUp: results[1].option, runnerUpScore: results[1].total,
      margin,
      /* Flagged when the top two are within 5% of the leader's score: a
         "winner" half a point clear is a coin toss dressed as a decision, and
         saying so is more honest than announcing it. */
      close: margin < results[0].total * 0.05
    }, computed());
  }
};
