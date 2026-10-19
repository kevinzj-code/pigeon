import { ok, computed } from '../src/contracts.js';

export default {
  name: 'checkPalindrome',
  description: 'Check whether a word or phrase reads the same backwards.',
  category: 'games', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{summary|prose}}',
  inputSchema: {
    type: 'object', required: ['text'],
    properties: {
      text: { type: 'string', label: 'text', minLength: 1, maxLength: 2000, prompt: 'What should I check?' },
      strict: { type: 'boolean', label: 'count every character', default: false, description: 'count spaces, punctuation and capitals as part of the text' }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      isPalindrome: { type: 'boolean' }, normalised: { type: 'string' },
      reversed: { type: 'string' }, summary: { type: 'string' }
    }
  },
  examples: [
    { text: 'is racecar a palindrome', input: { text: 'racecar' }, output: { isPalindrome: true, normalised: 'racecar', reversed: 'racecar', summary: '"racecar" is a palindrome.' } },
    { text: 'check if this phrase is a palindrome', input: { text: 'A man, a plan, a canal: Panama' }, output: { isPalindrome: true, normalised: 'amanaplanacanalpanama', reversed: 'amanaplanacanalpanama', summary: '"A man, a plan, a canal: Panama" is a palindrome, ignoring spaces, punctuation and capitals.' } },
    { text: 'is hello a palindrome', input: { text: 'hello' }, output: { isPalindrome: false, normalised: 'hello', reversed: 'olleh', summary: '"hello" is not a palindrome — backwards it reads "olleh".' } },
    { text: 'was it a car or a cat i saw', input: { text: 'Was it a car or a cat I saw?' }, output: { isPalindrome: true, normalised: 'wasitacaroracatisaw', reversed: 'wasitacaroracatisaw', summary: '"Was it a car or a cat I saw?" is a palindrome, ignoring spaces, punctuation and capitals.' } },
    { text: 'check never odd or even strictly', input: { text: 'Never odd or even', strict: true }, output: { isPalindrome: false, normalised: 'Never odd or even', reversed: 'neve ro ddo reveN', summary: '"Never odd or even" is not a palindrome — backwards it reads "neve ro ddo reveN".' } },
    { text: 'is noon spelt the same forwards and backwards', input: { text: 'noon' },
      output: { isPalindrome: true, normalised: 'noon', reversed: 'noon', summary: '"noon" is a palindrome.' } },
    { text: 'is this phrase the same backwards: never odd or even', input: { text: 'never odd or even' },
      output: { isPalindrome: true, normalised: 'neveroddoreven', reversed: 'neveroddoreven', summary: '"never odd or even" is a palindrome, ignoring spaces, punctuation and capitals.' } }
  ],
  errorCases: [
    { input: {}, code: 'MISSING_FIELD' },
    { input: { text: '' }, code: 'MISSING_FIELD' },
    { input: { text: 'x'.repeat(2500) }, code: 'INVALID_INPUT' }
  ],
  run (input) {
    const original = String(input.text);
    /* Loose by default, because "A man, a plan, a canal: Panama" is the answer
       everyone expects. Strict mode keeps every character, which is the honest
       reading of the question if you actually meant it literally. */
    const normalised = input.strict ? original : original.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
    const reversed = [...normalised].reverse().join('');
    const isPalindrome = normalised.length > 0 && normalised === reversed;
    const loose = !input.strict && normalised !== original;

    return ok({
      isPalindrome, normalised, reversed,
      summary: isPalindrome
        ? `"${original}" is a palindrome${loose ? ', ignoring spaces, punctuation and capitals' : ''}.`
        : `"${original}" is not a palindrome — backwards it reads "${reversed}".`
    }, computed());
  }
};
