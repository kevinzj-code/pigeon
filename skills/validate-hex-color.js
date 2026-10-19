import { ok, computed } from '../src/contracts.js';

export default {
  name: 'validateHexColor',
  description: "Test a hex colour code and expand #abc shorthand.",
  category: 'validation', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{input|prose}} — {{verdict|prose}}.',
  inputSchema: {
    type: 'object', required: ['color'],
    properties: { color: { type: 'string', label: 'colour code', minLength: 1, prompt: 'Which colour code should I check?' } }
  },
  outputSchema: { type: 'object', properties: { valid: { type: 'boolean' }, verdict: { type: 'string' }, input: { type: 'string' }, normalised: { type: 'string' }, hasAlpha: { type: 'boolean' }, shorthand: { type: 'boolean' }, problem: { type: 'string' } } },
  examples: [
    { text: 'is #FF5733 a valid hex colour', input: { color: '#FF5733' }, output: { valid: true, verdict: 'a valid 6-digit hex colour', input: '#FF5733', normalised: '#FF5733', hasAlpha: false, shorthand: false, problem: '' } },
    { text: 'check the shorthand #abc', input: { color: '#abc' }, output: { valid: true, verdict: 'a valid shorthand hex colour', input: '#abc', normalised: '#AABBCC', hasAlpha: false, shorthand: true, problem: '' } },
    { text: 'is #12345 valid', input: { color: '#12345' }, output: { valid: false, verdict: 'not valid', input: '#12345', normalised: '', hasAlpha: false, shorthand: false, problem: 'a hex colour has 3, 4, 6 or 8 digits — this has 5' } },
    { text: 'validate a colour with alpha', input: { color: '#FF573380' }, output: { valid: true, verdict: 'a valid 8-digit hex colour with alpha', input: '#FF573380', normalised: '#FF573380', hasAlpha: true, shorthand: false, problem: '' } },
    { text: 'is #GGHHII a colour', input: { color: '#GGHHII' }, output: { valid: false, verdict: 'not valid', input: '#GGHHII', normalised: '', hasAlpha: false, shorthand: false, problem: 'G is not a hex digit' } }
  ],
  errorCases: [
    { input: {}, code: 'MISSING_FIELD' },
    { input: { color: '' }, code: 'MISSING_FIELD' },
    { input: { color: ['#fff'] }, code: 'INVALID_INPUT' }
  ],
  run (input) {
    const raw = String(input.color).trim();
    const body = raw.replace(/^#/, '');
    const bad = (problem) => ok({
      valid: false, verdict: 'not valid', input: raw, normalised: '',
      hasAlpha: false, shorthand: false, problem
    }, computed());

    const badDigit = [...body].find(c => !/[0-9a-f]/i.test(c));
    if (badDigit) return bad(`${badDigit} is not a hex digit`);
    if (![3, 4, 6, 8].includes(body.length)) {
      return bad(`a hex colour has 3, 4, 6 or 8 digits — this has ${body.length}`);
    }
    /* Shorthand doubles each digit: #abc is #aabbcc, not #abc000. Expanding it
       here means every downstream colour skill can assume six or eight. */
    const shorthand = body.length <= 4;
    const expanded = shorthand ? [...body].map(c => c + c).join('') : body;
    const hasAlpha = expanded.length === 8;
    return ok({
      valid: true,
      verdict: shorthand ? 'a valid shorthand hex colour'
        : hasAlpha ? 'a valid 8-digit hex colour with alpha' : 'a valid 6-digit hex colour',
      input: raw, normalised: `#${expanded.toUpperCase()}`,
      hasAlpha, shorthand, problem: ''
    }, computed());
  }
};
