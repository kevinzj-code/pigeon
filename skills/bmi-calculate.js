import { ok, fail, computed } from '../src/contracts.js';
import { round } from '../src/lib/num.js';

/* §27 of the skill index: "Health math (formula-only, labeled, no targets or
 * advice)". This skill divides one number by another and says what the formula
 * returns. It does NOT tell anyone what their number should be.
 *
 * The `formula-only` label is on it for a reason worth stating: BMI was devised
 * in the 1830s as a population statistic, not an individual diagnostic. It
 * cannot distinguish muscle from fat, and it is well documented to misclassify
 * athletes, older people and several ethnic groups. Returning the number with
 * the standard band names is useful; presenting those bands as a verdict about
 * a person is not something this registry does, which is why `note` says so
 * and the reply template carries it.
 *
 * §10 open decision 4 asks for the exact UI treatment of `formula-only` before
 * §27 moves out of Extended. The renderer shows the label; this text is the
 * skill's own half of that bargain.
 */
export default {
  name: 'bmiCalculate',
  description: 'Work out body mass index from a height and weight — the formula only.',
  category: 'health', tier: 'standard',
  title: 'BMI',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: ['formula-only', 'estimate'],
  replyTemplate: 'BMI {{bmi}} — the formula places that in the {{band|prose}} band.{{note|prose}}',
  inputSchema: {
    type: 'object', required: ['weightKg', 'heightCm'],
    properties: {
      weightKg: { type: 'number', label: 'weight (kg)', exclusiveMinimum: 0, maximum: 700, prompt: 'What is the weight in kilograms?' },
      heightCm: { type: 'number', label: 'height (cm)', exclusiveMinimum: 0, maximum: 300, prompt: 'What is the height in centimetres?' }
    }
  },
  outputSchema: { type: 'object', properties: { bmi: { type: 'number' }, band: { type: 'string' }, weightKg: { type: 'number' }, heightCm: { type: 'number' }, note: { type: 'string' } } },
  examples: [
    { text: 'bmi for 70kg and 175cm', input: { weightKg: 70, heightCm: 175 }, output: { bmi: 22.86, band: 'healthy weight', weightKg: 70, heightCm: 175, note: ' BMI is a population statistic, not a diagnosis — it cannot tell muscle from fat.' } },
    { text: 'work out bmi for 90kg at 180cm', input: { weightKg: 90, heightCm: 180 }, output: { bmi: 27.78, band: 'overweight', weightKg: 90, heightCm: 180, note: ' BMI is a population statistic, not a diagnosis — it cannot tell muscle from fat.' } },
    { text: 'bmi calculation for 55kg and 160cm', input: { weightKg: 55, heightCm: 160 }, output: { bmi: 21.48, band: 'healthy weight', weightKg: 55, heightCm: 160, note: ' BMI is a population statistic, not a diagnosis — it cannot tell muscle from fat.' } },
    { text: 'bmi for 50kg at 175cm', input: { weightKg: 50, heightCm: 175 }, output: { bmi: 16.33, band: 'underweight', weightKg: 50, heightCm: 175, note: ' BMI is a population statistic, not a diagnosis — it cannot tell muscle from fat.' } },
    { text: 'calculate bmi for 110kg and 170cm', input: { weightKg: 110, heightCm: 170 }, output: { bmi: 38.06, band: 'obese', weightKg: 110, heightCm: 170, note: ' BMI is a population statistic, not a diagnosis — it cannot tell muscle from fat.' } }
  ],
  errorCases: [
    { input: { weightKg: 70, heightCm: 0 }, code: 'INVALID_INPUT' },
    { input: { weightKg: -5, heightCm: 175 }, code: 'INVALID_INPUT' },
    { input: { weightKg: 70 }, code: 'MISSING_FIELD' }
  ],
  run (input) {
    if (input.heightCm <= 0) return fail('INVALID_INPUT', 'The height has to be more than zero.', 'heightCm');
    const metres = input.heightCm / 100;
    const bmi = round(input.weightKg / (metres * metres), 2);
    /* The WHO band names, stated as what the FORMULA places the number in —
       not as a statement about the person. */
    const band = bmi < 18.5 ? 'underweight'
      : bmi < 25 ? 'healthy weight'
        : bmi < 30 ? 'overweight' : 'obese';
    return ok({
      bmi, band, weightKg: input.weightKg, heightCm: input.heightCm,
      note: ' BMI is a population statistic, not a diagnosis — it cannot tell muscle from fat.'
    }, computed());
  }
};
