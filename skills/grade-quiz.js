import { ok, fail, computed } from '../src/contracts.js';
import { round } from '../src/lib/num.js';

export default {
  name: 'gradeQuiz',
  description: 'Mark a set of answers against an answer key and give the score, question by question.',
  category: 'learning',
  tier: 'core',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{correct}} out of {{total}} — {{percent}}%. {{wrongList|prose}}',
  inputSchema: {
    type: 'object',
    required: ['answers', 'key'],
    properties: {
      answers: { type: 'array', label: 'answers', items: { type: 'string' }, minItems: 1, prompt: 'What were the answers given?' },
      key: { type: 'array', label: 'answer key', items: { type: 'string' }, minItems: 1, prompt: 'What is the correct answer to each?' },
      caseSensitive: { type: 'boolean', label: 'match case', default: false },
      /* Trimming and case-folding are on by default because "Paris " and
         "paris" are the same answer to a human marker. Anything cleverer —
         spelling tolerance, synonyms — would be marking by guesswork, which is
         not something a deterministic skill should do silently. */
      ignoreSpacing: { type: 'boolean', label: 'ignore extra spaces', default: true }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      correct: { type: 'integer' }, total: { type: 'integer' }, percent: { type: 'number' },
      results: { type: 'array' }, wrong: { type: 'array', items: { type: 'integer' } },
      wrongList: { type: 'string' }
    }
  },
  examples: [
    { text: 'mark these answers against the key', input: { answers: ['Paris', 'Berlin', 'Madrid'], key: ['Paris', 'Rome', 'Madrid'] },
      output: { correct: 2, total: 3, percent: 66.67, results: [{ question: 1, given: 'Paris', expected: 'Paris', correct: true }, { question: 2, given: 'Berlin', expected: 'Rome', correct: false }, { question: 3, given: 'Madrid', expected: 'Madrid', correct: true }], wrong: [2], wrongList: 'Question 2 was wrong.' } },
    { text: 'grade my quiz', input: { answers: ['a', 'b', 'c', 'd'], key: ['a', 'b', 'c', 'd'] },
      output: { correct: 4, total: 4, percent: 100, results: [{ question: 1, given: 'a', expected: 'a', correct: true }, { question: 2, given: 'b', expected: 'b', correct: true }, { question: 3, given: 'c', expected: 'c', correct: true }, { question: 4, given: 'd', expected: 'd', correct: true }], wrong: [], wrongList: 'All correct.' } },
    { text: 'score these ignoring capitals', input: { answers: ['paris', 'ROME'], key: ['Paris', 'Rome'] },
      output: { correct: 2, total: 2, percent: 100, results: [{ question: 1, given: 'paris', expected: 'Paris', correct: true }, { question: 2, given: 'ROME', expected: 'Rome', correct: true }], wrong: [], wrongList: 'All correct.' } },
    { text: 'mark strictly on capitalisation', input: { answers: ['paris'], key: ['Paris'], caseSensitive: true },
      output: { correct: 0, total: 1, percent: 0, results: [{ question: 1, given: 'paris', expected: 'Paris', correct: false }], wrong: [1], wrongList: 'Question 1 was wrong.' } },
    { text: 'grade a test where several are wrong', input: { answers: ['1', '5', '3', '9'], key: ['1', '2', '3', '4'] },
      output: { correct: 2, total: 4, percent: 50, results: [{ question: 1, given: '1', expected: '1', correct: true }, { question: 2, given: '5', expected: '2', correct: false }, { question: 3, given: '3', expected: '3', correct: true }, { question: 4, given: '9', expected: '4', correct: false }], wrong: [2, 4], wrongList: 'Questions 2 and 4 were wrong.' } }
  ],
  errorCases: [
    { input: { answers: ['a'], key: ['a', 'b'] }, code: 'INVALID_INPUT' },
    { input: { answers: [], key: [] }, code: 'INVALID_INPUT' },
    { input: { answers: ['a'] }, code: 'MISSING_FIELD' }
  ],
  run (input) {
    if (input.answers.length !== input.key.length) {
      return fail('INVALID_INPUT', `There are ${input.answers.length} answer${input.answers.length === 1 ? '' : 's'} but ${input.key.length} in the key — they have to match up.`, 'key');
    }
    const norm = (v) => {
      let s = String(v);
      if (input.ignoreSpacing) s = s.trim().replace(/\s+/g, ' ');
      return input.caseSensitive ? s : s.toLowerCase();
    };

    const results = input.answers.map((given, i) => ({
      question: i + 1, given, expected: input.key[i],
      correct: norm(given) === norm(input.key[i])
    }));
    const wrong = results.filter(r => !r.correct).map(r => r.question);
    const correct = results.length - wrong.length;

    return ok({
      correct, total: results.length,
      percent: round(correct / results.length * 100, 2),
      results, wrong,
      wrongList: wrong.length === 0 ? 'All correct.'
        : wrong.length === 1 ? `Question ${wrong[0]} was wrong.`
          : `Questions ${wrong.slice(0, -1).join(', ')} and ${wrong[wrong.length - 1]} were wrong.`
    }, computed());
  }
};
