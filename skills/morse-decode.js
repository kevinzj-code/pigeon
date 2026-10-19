import { ok, fail, computed } from '../src/contracts.js';
import { FROM_MORSE } from '../src/lib/morse.js';

export default {
  name: 'morseDecode',
  description: "Read dots and dashes back as the words they spell.",
  category: 'encoding', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{result|prose}}',
  inputSchema: {
    type: 'object', required: ['morse'],
    properties: { morse: { type: 'string', label: 'morse', minLength: 1, prompt: 'Which Morse should I decode?' } }
  },
  outputSchema: { type: 'object', properties: { result: { type: 'string' }, characters: { type: 'integer' }, unknown: { type: 'array', items: { type: 'string' } } } },
  examples: [
    { text: 'decode ... --- ...', input: { morse: '... --- ...' }, output: { result: 'SOS', characters: 3, unknown: [] } },
    { text: 'what does this morse say', input: { morse: '.... . .-.. .-.. ---' }, output: { result: 'HELLO', characters: 5, unknown: [] } },
    { text: 'decode morse with a word break', input: { morse: '.... .. / - .... . .-. .' }, output: { result: 'HI THERE', characters: 7, unknown: [] } },
    { text: 'decode morse numbers', input: { morse: '..--- ----- ..--- -....' }, output: { result: '2026', characters: 4, unknown: [] } },
    { text: 'decode morse using dashes and dots', input: { morse: '-.-- . ...' }, output: { result: 'YES', characters: 3, unknown: [] } }
  ],
  errorCases: [
    { input: { morse: 'hello' }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' },
    { input: { morse: '' }, code: 'MISSING_FIELD' }
  ],
  run (input) {
    /* Long dashes and bullet characters get normalised: Morse pasted out of a
       document or a phone keyboard is full of them, and refusing it would fail
       on input that is obviously Morse to a reader. */
    const cleaned = String(input.morse)
      .replace(/[‐-―−]/g, '-')
      .replace(/[·•‧]/g, '.')
      .trim();
    if (!/^[.\-/\s|]+$/.test(cleaned)) {
      return fail('INVALID_INPUT', 'Morse is made of dots, dashes and separators — that has other characters in it.', 'morse');
    }
    const unknown = [];
    let characters = 0;
    const words = cleaned.split(/\s*[/|]\s*/).map(word =>
      word.trim().split(/\s+/).filter(Boolean).map(code => {
        const c = FROM_MORSE[code];
        if (!c) { if (!unknown.includes(code)) unknown.push(code); return ''; }
        characters++;
        return c;
      }).join('')
    );
    const result = words.filter(w => w !== '').join(' ');
    if (!result) return fail('INVALID_INPUT', 'None of those sequences is a Morse character.', 'morse');
    return ok({ result, characters, unknown }, computed());
  }
};
