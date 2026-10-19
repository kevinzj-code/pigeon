import { ok, computed } from '../src/contracts.js';

/* Extended_Pictographic covers the pictographs themselves; the rest of the
   class is the machinery that joins them into one glyph - variation selectors,
   zero-width joiners, skin tone modifiers, regional indicator pairs and the
   keycap combiner. Removing the pictograph without its modifiers leaves the
   leftovers visible as stray marks, which is worse than leaving the emoji in. */
const EMOJI = /(\p{Extended_Pictographic}(️|︎)?(‍\p{Extended_Pictographic}(️|︎)?)*|[\u{1F3FB}-\u{1F3FF}]|[\u{1F1E6}-\u{1F1FF}]{2}|[0-9#*]️?⃣)/gu;

export default {
  name: 'removeEmoji',
  description: 'Strip emoji out of text.',
  category: 'text', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{removed}} {{removed|plural:emoji:emoji}} removed: {{text|prose}}',
  inputSchema: {
    type: 'object', required: ['text'],
    properties: {
      text: { type: 'string', label: 'text', minLength: 1, maxLength: 50000, prompt: 'Which text should I strip emoji from?' },
      replaceWith: { type: 'string', label: 'replace emoji with', maxLength: 10, default: '' }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      text: { type: 'string' }, removed: { type: 'integer' },
      found: { type: 'array', items: { type: 'string' } }, originalLength: { type: 'integer' }
    }
  },
  examples: [
    { text: "remove the emoji from this", input: { text: "Great work 👍 thanks 🎉" }, output: { text: "Great work thanks", removed: 2, found: ["👍", "🎉"], originalLength: 21 } },
    { text: "strip emoji out", input: { text: "Hello 🌍!" }, output: { text: "Hello !", removed: 1, found: ["🌍"], originalLength: 8 } },
    { text: "take the emoji out of this message", input: { text: "No emoji here at all" }, output: { text: "No emoji here at all", removed: 0, found: [], originalLength: 20 } },
    { text: "clean emoji from this text", input: { text: "Team 🏴‍☠️ ready 🇬🇧" }, output: { text: "Team ready", removed: 2, found: ["🏴‍☠️", "🇬🇧"], originalLength: 18 } },
    { text: "remove emoji and keep the words", input: { text: "I ❤️ pigeons" }, output: { text: "I pigeons", removed: 1, found: ["❤️"], originalLength: 12 } }
  ],
  errorCases: [
    { input: {}, code: 'MISSING_FIELD' },
    { input: { text: '' }, code: 'MISSING_FIELD' },
    { input: { text: 'hi', replaceWith: 'far too long' }, code: 'INVALID_INPUT' }
  ],
  run (input) {
    const original = String(input.text);
    const found = original.match(EMOJI) ?? [];
    const replaced = original.replace(EMOJI, input.replaceWith ?? '');
    /* Whitespace is tidied only where an emoji left a gap behind it, so text
       that never had emoji comes back byte-for-byte unchanged. */
    const text = found.length && !(input.replaceWith ?? '')
      ? replaced.replace(/[^\S\n]{2,}/g, ' ').replace(/[^\S\n]+$/gm, '').trim()
      : replaced;
    return ok({ text, removed: found.length, found, originalLength: [...original].length }, computed());
  }
};
