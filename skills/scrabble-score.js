import { ok, fail, computed } from '../src/contracts.js';
import { isWord } from '../src/lib/words.js';

const VALUES = { a: 1, b: 3, c: 3, d: 2, e: 1, f: 4, g: 2, h: 4, i: 1, j: 8, k: 5, l: 1, m: 3, n: 1, o: 1, p: 3, q: 10, r: 1, s: 1, t: 1, u: 1, v: 4, w: 4, x: 8, y: 4, z: 10 };

export default {
  name: 'scrabbleScore',
  description: 'Add up what a word is worth in Scrabble tile values.',
  category: 'games', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{word}} scores {{score}} — {{breakdown}}.',
  inputSchema: {
    type: 'object', required: ['word'],
    properties: { word: { type: 'string', label: 'word', minLength: 1, maxLength: 40, prompt: 'Which word should I score?' } }
  },
  outputSchema: {
    type: 'object',
    properties: {
      word: { type: 'string' }, score: { type: 'integer' }, breakdown: { type: 'string' },
      letters: { type: 'array' }, inDictionary: { type: 'boolean' }
    }
  },
  examples: [
    { text: 'what does pigeon score in scrabble', input: { word: 'pigeon' }, output: { word: 'pigeon', score: 9, breakdown: '3+1+2+1+1+1', letters: [{ letter: 'p', value: 3 }, { letter: 'i', value: 1 }, { letter: 'g', value: 2 }, { letter: 'e', value: 1 }, { letter: 'o', value: 1 }, { letter: 'n', value: 1 }], inDictionary: true } },
    { text: 'scrabble score for quiz', input: { word: 'quiz' }, output: { word: 'quiz', score: 22, breakdown: '10+1+1+10', letters: [{ letter: 'q', value: 10 }, { letter: 'u', value: 1 }, { letter: 'i', value: 1 }, { letter: 'z', value: 10 }], inDictionary: true } },
    { text: 'how many points is jazz worth', input: { word: 'jazz' }, output: { word: 'jazz', score: 29, breakdown: '8+1+10+10', letters: [{ letter: 'j', value: 8 }, { letter: 'a', value: 1 }, { letter: 'z', value: 10 }, { letter: 'z', value: 10 }], inDictionary: true } },
    { text: 'score the word hello', input: { word: 'hello' }, output: { word: 'hello', score: 8, breakdown: '4+1+1+1+1', letters: [{ letter: 'h', value: 4 }, { letter: 'e', value: 1 }, { letter: 'l', value: 1 }, { letter: 'l', value: 1 }, { letter: 'o', value: 1 }], inDictionary: true } },
    { text: 'points for xylophone', input: { word: 'xylophone' }, output: { word: 'xylophone', score: 24, breakdown: '8+4+1+1+3+4+1+1+1', letters: [{ letter: 'x', value: 8 }, { letter: 'y', value: 4 }, { letter: 'l', value: 1 }, { letter: 'o', value: 1 }, { letter: 'p', value: 3 }, { letter: 'h', value: 4 }, { letter: 'o', value: 1 }, { letter: 'n', value: 1 }, { letter: 'e', value: 1 }], inDictionary: true } },
    { text: 'how much is the word quiz worth in scrabble tiles', input: { word: 'quiz' },
      output: { word: 'quiz', score: 22, breakdown: '10+1+1+10', letters: [{ letter: 'q', value: 10 }, { letter: 'u', value: 1 }, { letter: 'i', value: 1 }, { letter: 'z', value: 10 }], inDictionary: true } },
    { text: 'how many points is jazz worth in scrabble', input: { word: 'jazz' },
      output: { word: 'jazz', score: 29, breakdown: '8+1+10+10', letters: [{ letter: 'j', value: 8 }, { letter: 'a', value: 1 }, { letter: 'z', value: 10 }, { letter: 'z', value: 10 }], inDictionary: true } }
  ],
  errorCases: [
    { input: { word: '1234' }, code: 'INVALID_INPUT' },
    { input: { word: '   ' }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' }
  ],
  run (input) {
    const word = String(input.word).trim().toLowerCase();
    if (!/^[a-z]+$/.test(word)) {
      return fail('INVALID_INPUT', 'Scrabble tiles are letters only — I cannot score digits or punctuation.', 'word');
    }
    const letters = [...word].map((letter) => ({ letter, value: VALUES[letter] }));
    /* The tile score, not the board score: this ignores double- and
       triple-letter squares, which depend on where the word is played. */
    return ok({
      word, score: letters.reduce((a, l) => a + l.value, 0),
      breakdown: letters.map((l) => l.value).join('+'),
      letters, inDictionary: isWord(word)
    }, computed());
  }
};
