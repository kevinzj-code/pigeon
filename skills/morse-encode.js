import { ok, fail, computed } from '../src/contracts.js';
import { MORSE } from '../src/lib/morse.js';

export default {
  name: 'morseEncode',
  description: "Write words out as Morse dots and dashes.",
  category: 'encoding', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{result|prose}}',
  inputSchema: {
    type: 'object', required: ['text'],
    properties: { text: { type: 'string', label: 'text', minLength: 1, prompt: 'Which text should I encode?' } }
  },
  outputSchema: { type: 'object', properties: { result: { type: 'string' }, characters: { type: 'integer' }, skipped: { type: 'array', items: { type: 'string' } } } },
  examples: [
    { text: 'morse code for SOS', input: { text: 'SOS' }, output: { result: '... --- ...', characters: 3, skipped: [] } },
    { text: 'encode hello in morse', input: { text: 'hello' }, output: { result: '.... . .-.. .-.. ---', characters: 5, skipped: [] } },
    { text: 'morse for two words', input: { text: 'hi there' }, output: { result: '.... .. / - .... . .-. .', characters: 7, skipped: [] } },
    { text: 'encode a number in morse', input: { text: '2026' }, output: { result: '..--- ----- ..--- -....', characters: 4, skipped: [] } },
    { text: 'morse code with a question mark', input: { text: 'why?' }, output: { result: '.-- .... -.-- ..--..', characters: 4, skipped: [] } }
  ],
  errorCases: [
    { input: {}, code: 'MISSING_FIELD' },
    { input: { text: '' }, code: 'MISSING_FIELD' },
    { input: { text: 'éè' }, code: 'INVALID_INPUT' }
  ],
  run (input) {
    const skipped = [];
    const words = String(input.text).toUpperCase().trim().split(/\s+/);
    let characters = 0;
    const encodedWords = words.map(word => [...word].map(c => {
      const code = MORSE[c];
      /* An unencodable character is REPORTED, not dropped silently — losing a
         letter from a message is exactly the failure Morse is used to avoid. */
      if (!code) { if (!skipped.includes(c)) skipped.push(c); return null; }
      characters++;
      return code;
    }).filter(Boolean).join(' '));

    const result = encodedWords.filter(w => w).join(' / ');
    if (!result) return fail('INVALID_INPUT', `None of that can be written in Morse${skipped.length ? ` — ${skipped.join(', ')} ${skipped.length === 1 ? 'has' : 'have'} no code` : ''}.`, 'text');
    return ok({ result, characters, skipped }, computed());
  }
};
