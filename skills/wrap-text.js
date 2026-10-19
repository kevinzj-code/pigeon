import { ok, fail, computed } from '../src/contracts.js';
import { lines } from '../src/lib/text.js';

export default {
  name: 'wrapText',
  description: 'Hard-wrap text to a maximum line width, breaking lines at a set number of characters.',
  category: 'text', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{result|prose}}',
  inputSchema: {
    type: 'object', required: ['text'],
    properties: {
      text: { type: 'string', label: 'text', minLength: 1, prompt: 'Which text should I wrap?' },
      width: { type: 'integer', label: 'line width', minimum: 10, maximum: 400, default: 72 },
      indent: { type: 'string', label: 'indent', default: '' }
    }
  },
  outputSchema: { type: 'object', properties: { result: { type: 'string' }, lines: { type: 'integer' }, width: { type: 'integer' }, longest: { type: 'integer' } } },
  examples: [
    { text: 'wrap this at 20 characters', input: { text: 'The quick brown fox jumps over the lazy dog', width: 20 },
      output: { result: 'The quick brown fox\njumps over the lazy\ndog', lines: 3, width: 20, longest: 19 } },
    { text: 'hard wrap at 30 columns', input: { text: 'Pigeon is the smallest aircraft in the fleet', width: 30 },
      output: { result: 'Pigeon is the smallest\naircraft in the fleet', lines: 2, width: 30, longest: 22 } },
    { text: 'wrap with an indent', input: { text: 'one two three four five', width: 12, indent: '> ' },
      output: { result: '> one two\n> three four\n> five', lines: 3, width: 12, longest: 12 } },
    { text: 'wrap text that already fits', input: { text: 'short line', width: 40 },
      output: { result: 'short line', lines: 1, width: 40, longest: 10 } },
    { text: 'wrap a paragraph keeping the blank line', input: { text: 'first para here\n\nsecond para here', width: 10 },
      output: { result: 'first para\nhere\n\nsecond\npara here', lines: 5, width: 10, longest: 10 } },
    { text: 'rewrap this paragraph to 30 columns', input: { text: 'The quick brown fox jumps over the lazy dog and keeps on running', width: 30 },
      output: { result: 'The quick brown fox jumps over\nthe lazy dog and keeps on\nrunning', lines: 3, width: 30, longest: 30 } },
    { text: 'reflow this so no line passes 16 characters', input: { text: 'pack my box with five dozen liquor jugs', width: 16 },
      output: { result: 'pack my box with\nfive dozen\nliquor jugs', lines: 3, width: 16, longest: 16 } }
  ],
  errorCases: [
    { input: { text: 'hello', width: 3 }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' },
    { input: { text: 'hello', width: 'wide' }, code: 'INVALID_INPUT' }
  ],
  run (input) {
    const room = input.width - input.indent.length;
    if (room < 4) return fail('INVALID_INPUT', 'The indent leaves no room to wrap into.', 'indent');

    /* Existing line breaks are respected — a blank line between paragraphs
       survives, because re-flowing a document into one block is not wrapping,
       it is destroying its structure. */
    const out = [];
    for (const line of lines(input.text)) {
      if (line.trim() === '') { out.push(''); continue; }
      let current = '';
      for (const word of line.split(/\s+/).filter(Boolean)) {
        if (!current) { current = word; continue; }
        if (current.length + 1 + word.length <= room) current += ` ${word}`;
        else { out.push(input.indent + current); current = word; }
      }
      if (current) out.push(input.indent + current);
    }
    return ok({
      result: out.join('\n'), lines: out.length, width: input.width,
      longest: out.reduce((n, l) => Math.max(n, l.length), 0)
    }, computed());
  }
};
