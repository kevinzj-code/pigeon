import { ok, fail, computed } from '../src/contracts.js';
import { mulberry32, intBetween } from '../src/lib/seeded.js';
import { round } from '../src/lib/num.js';

export default {
  name: 'randomNumber',
  description: 'Pick a random number in a range, from a seed so the same draw can be repeated.',
  category: 'generation',
  tier: 'core',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: ['toy'],
  replyTemplate: '{{numbers|list}} — from {{min}} to {{max}}, seed {{seed}}.',
  inputSchema: {
    type: 'object',
    required: ['min', 'max', 'seed'],
    properties: {
      min: { type: 'number', label: 'lowest', prompt: 'What is the lowest it can be?' },
      max: { type: 'number', label: 'highest', prompt: 'What is the highest it can be?' },
      seed: { type: 'integer', label: 'repeatable seed', minimum: 0, prompt: 'Which seed? Any whole number — the same seed always gives the same numbers.' },
      count: { type: 'integer', label: 'how many', minimum: 1, maximum: 1000, default: 1 },
      whole: { type: 'boolean', label: 'whole numbers only', default: true },
      unique: { type: 'boolean', label: 'no repeats', default: false }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      numbers: { type: 'array', items: { type: 'number' } }, count: { type: 'integer' },
      min: { type: 'number' }, max: { type: 'number' }, seed: { type: 'integer' }
    }
  },
  examples: [
    { text: 'pick a number between 1 and 100 with seed 7', input: { min: 1, max: 100, seed: 7 },
      output: { numbers: [2], count: 1, min: 1, max: 100, seed: 7 } },
    { text: 'random number 1 to 6 seed 1', input: { min: 1, max: 6, seed: 1 },
      output: { numbers: [4], count: 1, min: 1, max: 6, seed: 1 } },
    { text: 'give me 5 numbers between 1 and 50, seed 42', input: { min: 1, max: 50, seed: 42, count: 5 },
      output: { numbers: [31, 23, 43, 34, 9], count: 5, min: 1, max: 50, seed: 42 } },
    { text: 'six unique lottery numbers 1 to 49 seed 2026', input: { min: 1, max: 49, seed: 2026, count: 6, unique: true },
      output: { numbers: [23, 16, 33, 31, 8, 11], count: 6, min: 1, max: 49, seed: 2026 } },
    { text: 'a random decimal between 0 and 1, seed 3', input: { min: 0, max: 1, seed: 3, whole: false },
      output: { numbers: [0.7202], count: 1, min: 0, max: 1, seed: 3 } }
  ],
  errorCases: [
    { input: { min: 10, max: 1, seed: 1 }, code: 'INVALID_INPUT' },
    { input: { min: 1, max: 5, seed: 1, count: 10, unique: true }, code: 'INVALID_INPUT' },
    { input: { min: 1, max: 10 }, code: 'MISSING_FIELD' }
  ],
  run (input) {
    if (input.max < input.min) return fail('INVALID_INPUT', 'The highest value is below the lowest one.', 'max');
    const span = Math.floor(input.max) - Math.ceil(input.min) + 1;
    if (input.unique && input.whole && input.count > span) {
      /* Asking for more distinct whole numbers than the range contains would
         loop forever. Refusing with the arithmetic is more use than hanging. */
      return fail('INVALID_INPUT', `There are only ${span} whole numbers between ${input.min} and ${input.max}, so I can't pick ${input.count} different ones.`, 'count');
    }

    const rand = mulberry32(input.seed);
    const numbers = [];
    const seen = new Set();
    let guard = 0;
    while (numbers.length < input.count && guard < 100000) {
      guard += 1;
      const n = input.whole
        ? intBetween(rand, Math.ceil(input.min), Math.floor(input.max))
        : round(input.min + rand() * (input.max - input.min), 4);
      if (input.unique) {
        if (seen.has(n)) continue;
        seen.add(n);
      }
      numbers.push(n);
    }
    /* Decimals are kept to four places, so a narrow range holds only so many
       different ones. Finding fewer than asked is said, not handed back short. */
    if (numbers.length < input.count) {
      return fail('INVALID_INPUT', `I could only find ${numbers.length} different numbers between ${input.min} and ${input.max} at four decimal places, not ${input.count}.`, 'count');
    }
    return ok({ numbers, count: numbers.length, min: input.min, max: input.max, seed: input.seed }, computed());
  }
};
