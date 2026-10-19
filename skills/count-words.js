import { ok, computed } from '../src/contracts.js';
import { words, sentences, lines } from '../src/lib/text.js';

export default {
  name: 'countWords',
  description: 'Measure how long a piece of text is: its total words, characters, sentences and paragraphs.',
  category: 'text',
  tier: 'core',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{words|comma}} {{words|plural:word:words}}, {{characters|comma}} characters ({{charactersNoSpaces|comma}} without spaces), {{sentences}} {{sentences|plural:sentence:sentences}}, {{paragraphs}} {{paragraphs|plural:paragraph:paragraphs}}.',
  inputSchema: {
    type: 'object',
    required: ['text'],
    properties: { text: { type: 'string', label: 'text', prompt: 'Which text should I count?' } }
  },
  outputSchema: {
    type: 'object',
    properties: {
      words: { type: 'integer' }, characters: { type: 'integer' }, charactersNoSpaces: { type: 'integer' },
      sentences: { type: 'integer' }, paragraphs: { type: 'integer' }, lines: { type: 'integer' }
    }
  },
  examples: [
    { text: 'how many words is this paragraph', input: { text: 'The quick brown fox jumps over the lazy dog.' },
      output: { words: 9, characters: 44, charactersNoSpaces: 36, sentences: 1, paragraphs: 1, lines: 1 } },
    { text: 'word count for a two sentence note', input: { text: 'Hello there. How are you today?' },
      output: { words: 6, characters: 31, charactersNoSpaces: 26, sentences: 2, paragraphs: 1, lines: 1 } },
    { text: 'count the words in my two paragraphs', input: { text: 'First paragraph here.\n\nSecond one is a little longer than the first.' },
      output: { words: 12, characters: 68, charactersNoSpaces: 56, sentences: 2, paragraphs: 2, lines: 3 } },
    { text: 'how long is this', input: { text: "It's a well-known fact." },
      output: { words: 4, characters: 23, charactersNoSpaces: 20, sentences: 1, paragraphs: 1, lines: 1 } },
    { text: 'count a line that is only spaces', input: { text: '   ' },
      output: { words: 0, characters: 3, charactersNoSpaces: 0, sentences: 0, paragraphs: 0, lines: 1 } }
  ],
  errorCases: [
    { input: {}, code: 'MISSING_FIELD' },
    { input: { text: { paste: 'here' } }, code: 'INVALID_INPUT' },
    { input: { text: ['a', 'b'] }, code: 'INVALID_INPUT' }
  ],
  run (input) {
    const t = input.text;
    return ok({
      words: words(t).length,
      characters: t.length,
      charactersNoSpaces: t.replace(/\s/g, '').length,
      sentences: sentences(t).length,
      /* Blank-line separated, which is what a paragraph is in plain text. */
      paragraphs: t.trim() ? t.trim().split(/\n\s*\n/).filter(p => p.trim()).length : 0,
      lines: lines(t).length
    }, computed());
  }
};
