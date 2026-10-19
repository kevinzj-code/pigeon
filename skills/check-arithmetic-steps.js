import { ok, fail, computed } from '../src/contracts.js';
import { evaluate } from '../src/lib/arith.js';
import { round } from '../src/lib/num.js';

export default {
  name: 'checkArithmeticSteps',
  description: 'Check each line of a worked calculation and find the first one that is wrong.',
  category: 'learning', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{summary|prose}}\n{{lines|lines}}',
  inputSchema: {
    type: 'object', required: ['steps'],
    properties: {
      steps: { type: 'array', label: 'steps', minItems: 1, maxItems: 100, items: { type: 'string' }, prompt: 'Which steps should I check? Write each as "expression = answer".' },
      tolerance: { type: 'number', label: 'allowed difference', minimum: 0, maximum: 1, default: 0.000001 }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      results: { type: 'array' }, lines: { type: 'array', items: { type: 'string' } },
      allCorrect: { type: 'boolean' }, firstWrong: { type: 'integer' },
      correctCount: { type: 'integer' }, count: { type: 'integer' }, summary: { type: 'string' }
    }
  },
  examples: [
    { text: 'check my working', input: { steps: ['2 + 3 * 4 = 14', '14 - 4 = 10', '10 / 2 = 5'] }, output: { results: [{ step: 1, expression: '2 + 3 * 4', claimed: 14, actual: 14, correct: true }, { step: 2, expression: '14 - 4', claimed: 10, actual: 10, correct: true }, { step: 3, expression: '10 / 2', claimed: 5, actual: 5, correct: true }], lines: ['1. 2 + 3 * 4 = 14 correct', '2. 14 - 4 = 10 correct', '3. 10 / 2 = 5 correct'], allCorrect: true, firstWrong: null, correctCount: 3, count: 3, summary: 'All 3 steps check out.' } },
    { text: 'is this calculation right', input: { steps: ['5 * 6 = 30', '30 + 7 = 38'] }, output: { results: [{ step: 1, expression: '5 * 6', claimed: 30, actual: 30, correct: true }, { step: 2, expression: '30 + 7', claimed: 38, actual: 37, correct: false }], lines: ['1. 5 * 6 = 30 correct', '2. 30 + 7 = 38 should be 37'], allCorrect: false, firstWrong: 2, correctCount: 1, count: 2, summary: 'Step 2 is wrong: 30 + 7 is 37, not 38.' } },
    { text: 'check these sums', input: { steps: ['100 / 4 = 25'] }, output: { results: [{ step: 1, expression: '100 / 4', claimed: 25, actual: 25, correct: true }], lines: ['1. 100 / 4 = 25 correct'], allCorrect: true, firstWrong: null, correctCount: 1, count: 1, summary: 'All 1 steps check out.' } },
    { text: 'find the mistake in my working', input: { steps: ['8 * 8 = 64', '64 - 14 = 50', '50 / 5 = 11'] }, output: { results: [{ step: 1, expression: '8 * 8', claimed: 64, actual: 64, correct: true }, { step: 2, expression: '64 - 14', claimed: 50, actual: 50, correct: true }, { step: 3, expression: '50 / 5', claimed: 11, actual: 10, correct: false }], lines: ['1. 8 * 8 = 64 correct', '2. 64 - 14 = 50 correct', '3. 50 / 5 = 11 should be 10'], allCorrect: false, firstWrong: 3, correctCount: 2, count: 3, summary: 'Step 3 is wrong: 50 / 5 is 10, not 11.' } },
    { text: 'verify this arithmetic with brackets', input: { steps: ['(7 - 2) * 3 = 15', '15 + 0.5 = 15.5'] }, output: { results: [{ step: 1, expression: '(7 - 2) * 3', claimed: 15, actual: 15, correct: true }, { step: 2, expression: '15 + 0.5', claimed: 15.5, actual: 15.5, correct: true }], lines: ['1. (7 - 2) * 3 = 15 correct', '2. 15 + 0.5 = 15.5 correct'], allCorrect: true, firstWrong: null, correctCount: 2, count: 2, summary: 'All 2 steps check out.' } }
  ],
  errorCases: [
    { input: { steps: ['2 + 2'] }, code: 'INVALID_INPUT' },
    { input: { steps: ['banana = 4'] }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' }
  ],
  run (input) {
    const results = [];
    for (const [i, raw] of input.steps.entries()) {
      const at = String(raw).lastIndexOf('=');
      if (at === -1) return fail('INVALID_INPUT', `Step ${i + 1} has no "=" in it — write each step as "expression = answer".`, 'steps');
      const expression = String(raw).slice(0, at).trim();
      const claimedText = String(raw).slice(at + 1).trim();
      const claimed = Number(claimedText);
      if (!Number.isFinite(claimed)) return fail('INVALID_INPUT', `Step ${i + 1} claims "${claimedText}", which is not a number.`, 'steps');

      let actual;
      try { actual = evaluate(expression); }
      catch (e) { return fail('INVALID_INPUT', `Step ${i + 1} is not arithmetic I can evaluate — ${e.message}`, 'steps'); }

      /* Compared with a tolerance, not with ===. A worked answer of 0.1 + 0.2 =
         0.3 is right, and binary floating point disagrees by 5.5e-17. */
      results.push({
        step: i + 1, expression, claimed, actual: round(actual, 10),
        correct: Math.abs(actual - claimed) <= input.tolerance
      });
    }

    const wrong = results.find((r) => !r.correct);
    const correctCount = results.filter((r) => r.correct).length;
    return ok({
      results,
      lines: results.map((r) => `${r.step}. ${r.expression} = ${r.claimed} ${r.correct ? 'correct' : `should be ${r.actual}`}`),
      allCorrect: !wrong, firstWrong: wrong ? wrong.step : null,
      correctCount, count: results.length,
      summary: wrong
        ? `Step ${wrong.step} is wrong: ${wrong.expression} is ${wrong.actual}, not ${wrong.claimed}.`
        : `All ${results.length} steps check out.`
    }, computed());
  }
};
