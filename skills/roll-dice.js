import { ok, fail, computed } from '../src/contracts.js';
import { mulberry32 } from '../src/lib/seeded.js';

/* §20 of the index is titled "Generation (seeded, reproducible)", and §3.3
   says skills are pure. Those two together decide the whole shape of this
   skill: the seed is a REQUIRED input, not an optional convenience.
 *
 * Math.random() inside a skill would break three things at once — the same
 * plan would stop replaying to the same result, "Show plan" would stop being
 * an honest record of what happened, and the test suite could not assert an
 * output. A required seed costs one ASK_USER when the user didn't give one,
 * and buys all three back. The harness offers a seed in the UI; the model does
 * not get to invent one either. */

const NOTATION = /^(\d{0,3})d(\d{1,4})([+-]\d{1,4})?$/i;

export default {
  name: 'rollDice',
  description: 'Roll dice in standard notation like 2d6+3, from a seed so the same roll can be repeated.',
  category: 'generation',
  tier: 'core',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: ['toy'],
  replyTemplate: '{{notation}} → {{total}} (rolled {{rolls|list}}{{modifierText}}), seed {{seed}}.',
  inputSchema: {
    type: 'object',
    required: ['notation', 'seed'],
    properties: {
      notation: { type: 'string', label: 'dice', pattern: '^\\d{0,3}[dD]\\d{1,4}([+-]\\d{1,4})?$', prompt: 'What should I roll? (like 2d6 or 1d20+3)', description: 'dice notation like 2d6+3' },
      seed: { type: 'integer', label: 'repeatable seed', minimum: 0, prompt: 'Which seed should I roll from? Any whole number — the same seed always gives the same roll.' }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      total: { type: 'integer' }, rolls: { type: 'array', items: { type: 'integer' } },
      notation: { type: 'string' }, count: { type: 'integer' }, sides: { type: 'integer' },
      modifier: { type: 'integer' }, modifierText: { type: 'string' }, seed: { type: 'integer' }
    }
  },
  examples: [
    { text: 'roll 2d6 with seed 7', input: { notation: '2d6', seed: 7 },
      output: { total: 2, rolls: [1, 1], notation: '2d6', count: 2, sides: 6, modifier: 0, modifierText: '', seed: 7 } },
    { text: 'roll a d20 with seed 1', input: { notation: 'd20', seed: 1 },
      output: { total: 13, rolls: [13], notation: '1d20', count: 1, sides: 20, modifier: 0, modifierText: '', seed: 1 } },
    { text: 'roll 3d8+2 seed 42', input: { notation: '3d8+2', seed: 42 },
      output: { total: 18, rolls: [5, 4, 7], notation: '3d8+2', count: 3, sides: 8, modifier: 2, modifierText: ', +2', seed: 42 } },
    { text: 'roll 4d4 with seed 100', input: { notation: '4d4', seed: 100 },
      output: { total: 10, rolls: [1, 2, 3, 4], notation: '4d4', count: 4, sides: 4, modifier: 0, modifierText: '', seed: 100 } },
    { text: 'roll 1d100 seed 2026', input: { notation: '1d100', seed: 2026 },
      output: { total: 46, rolls: [46], notation: '1d100', count: 1, sides: 100, modifier: 0, modifierText: '', seed: 2026 } }
  ],
  errorCases: [
    { input: { notation: '2d6', seed: -1 }, code: 'INVALID_INPUT' },
    { input: { notation: 'roll some dice', seed: 1 }, code: 'INVALID_INPUT' },
    { input: { notation: '2d6' }, code: 'MISSING_FIELD' }
  ],
  run (input) {
    const m = NOTATION.exec(String(input.notation).trim());
    if (!m) return fail('INVALID_INPUT', `I couldn't read "${input.notation}" as dice notation. Try something like 2d6+3.`, 'notation');
    const count = m[1] === '' ? 1 : Number(m[1]);
    const sides = Number(m[2]);
    const modifier = m[3] ? Number(m[3]) : 0;
    if (count < 1) return fail('INVALID_INPUT', 'You have to roll at least one die.', 'notation');
    if (sides < 2) return fail('INVALID_INPUT', 'A die needs at least two sides.', 'notation');

    const rand = mulberry32(input.seed);
    const rolls = Array.from({ length: count }, () => 1 + Math.floor(rand() * sides));
    return ok({
      total: rolls.reduce((a, b) => a + b, 0) + modifier,
      rolls,
      notation: `${count}d${sides}${modifier ? (modifier > 0 ? `+${modifier}` : String(modifier)) : ''}`,
      count, sides, modifier,
      modifierText: modifier ? `, ${modifier > 0 ? '+' : ''}${modifier}` : '',
      seed: input.seed
    }, computed());
  }
};
