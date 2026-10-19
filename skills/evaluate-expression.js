import { ok, fail, computed } from '../src/contracts.js';
import { evaluate } from '../src/lib/arith.js';
import { round } from '../src/lib/num.js';

/* §1's thesis in one skill: the model reads "what's 18.5 times 12 divided by
   4", the model does NOT do the arithmetic, and lib/arith.js — a hand-written
   parser over a closed grammar, not eval — returns 55.5 every time. */
export default {
  name: 'evaluateExpression',
  description: 'Work out an arithmetic expression exactly. Reads % as a percentage.',
  category: 'math',
  tier: 'core',
  unbuilt: false,
  needsNetwork: false,
  dataAsOf: null,
  labels: [],
  replyTemplate: '{{expression}} = {{result}}',
  inputSchema: {
    type: 'object',
    required: ['expression'],
    properties: {
      expression: { type: 'string', label: 'expression', minLength: 1, prompt: 'What should I work out?' },
      decimals: { type: 'integer', label: 'decimal places', minimum: 0, maximum: 12, description: 'decimal places to round to' }
    }
  },
  outputSchema: {
    type: 'object',
    properties: { result: { type: 'number' }, expression: { type: 'string' }, exact: { type: 'boolean' } }
  },
  examples: [
    { text: "what's (18.5 * 12) / 4", input: { expression: '(18.5 * 12) / 4' },
      output: { result: 55.5, expression: '(18.5 * 12) / 4', exact: true } },
    { text: '15% of 240', input: { expression: '240 * 15%' },
      output: { result: 36, expression: '240 * 15%', exact: true } },
    { text: 'what is 2 to the power of 10', input: { expression: '2^10' },
      output: { result: 1024, expression: '2^10', exact: true } },
    { text: 'square root of 144', input: { expression: 'sqrt(144)' },
      output: { result: 12, expression: 'sqrt(144)', exact: true } },
    { text: 'add up 1250 + 3400 + 890', input: { expression: '1250 + 3400 + 890' },
      output: { result: 5540, expression: '1250 + 3400 + 890', exact: true } },
    { text: 'a third of 100 to two decimals', input: { expression: '100 / 3', decimals: 2 },
      output: { result: 33.33, expression: '100 / 3', exact: false } },
    { text: 'what is 96 divided by 8', input: { expression: '96 / 8' },
      output: { result: 12, expression: '96 / 8', exact: true } },
    { text: 'multiply 14 times 6 then subtract 9', input: { expression: '14 * 6 - 9' },
      output: { result: 75, expression: '14 * 6 - 9', exact: true } },
    /* THE IMPERATIVE FORMS, deliberately. The router matches words, not stems,
       so "what is 96 divided by 8" above does not make this skill reachable for
       someone who types "divide 4000 by 10" — measured, and the consequence was
       not a low rank but the wrong skill entirely: `splitEvenly` (0.40) and
       `lcm` (0.26) own the word "divide" through their own descriptions, and
       this skill scored 0.00. There is no division skill in the index for the
       router to fall back to, so these examples are how the one skill that CAN
       divide becomes findable by the word people actually use. */
    { text: 'divide 4000 by 10', input: { expression: '4000 / 10' },
      output: { result: 400, expression: '4000 / 10', exact: true } },
    { text: 'what is 20 * 200? then divide by 10', input: { expression: '20 * 200 / 10' },
      output: { result: 400, expression: '20 * 200 / 10', exact: true } },
    { text: 'divide 90 by 4', input: { expression: '90 / 4' },
      output: { result: 22.5, expression: '90 / 4', exact: true } },
    { text: 'take 250 and divide it by 8', input: { expression: '250 / 8' },
      output: { result: 31.25, expression: '250 / 8', exact: true } }
  ],
  errorCases: [
    { input: { expression: 'alert(1)' }, code: 'INVALID_INPUT' },
    { input: { expression: '10 / 0' }, code: 'INVALID_INPUT' },
    { input: { expression: '2 +' }, code: 'INVALID_INPUT' }
  ],
  run (input) {
    let value;
    try {
      value = evaluate(input.expression);
    } catch (e) {
      return fail('INVALID_INPUT', e.message, 'expression');
    }
    /* Ten places is past any precision a typed expression carries and short of
       where IEEE-754 noise starts showing up as digits — 1250+3400+890 lands on
       5540.000000000001 in binary floating point, and printing that would be
       reporting an artefact of the representation as if it were the answer.
       Anything tighter is the caller's explicit choice via `decimals`. */
    const dp = input.decimals !== undefined ? input.decimals : 10;
    const result = round(value, dp);
    return ok({
      result,
      expression: String(input.expression).trim(),
      exact: result === value
    }, computed());
  }
};
