import { ok, computed } from '../src/contracts.js';
import { sentences } from '../src/lib/text.js';

export default {
  name: 'tokenizeSentences',
  description: "Break a passage at its full stops into separate sentences.",
  category: 'text',
  tier: 'core',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: ['estimate'],
  replyTemplate: '{{count}} {{count|plural:sentence:sentences}}:\n{{sentences|lines}}',
  inputSchema: {
    type: 'object',
    required: ['text'],
    properties: { text: { type: 'string', label: 'text', minLength: 1, prompt: 'Which text should I split?' } }
  },
  outputSchema: {
    type: 'object',
    properties: { sentences: { type: 'array', items: { type: 'string' } }, count: { type: 'integer' } }
  },
  examples: [
    { text: 'split this into sentences', input: { text: 'Hello there. How are you? I am well.' },
      output: { sentences: ['Hello there.', 'How are you?', 'I am well.'], count: 3 } },
    { text: 'break the paragraph into sentences', input: { text: 'It rained all morning. Then the sun came out.' },
      output: { sentences: ['It rained all morning.', 'Then the sun came out.'], count: 2 } },
    { text: 'split sentences with an abbreviation', input: { text: 'Dr. Patel called back. She had good news.' },
      output: { sentences: ['Dr. Patel called back.', 'She had good news.'], count: 2 } },
    { text: 'one sentence only', input: { text: 'Nothing to split here' },
      output: { sentences: ['Nothing to split here'], count: 1 } },
    { text: 'split on an exclamation mark', input: { text: 'Watch out! That was close.' },
      output: { sentences: ['Watch out!', 'That was close.'], count: 2 } }
  ],
  errorCases: [
    { input: {}, code: 'MISSING_FIELD' },
    { input: { text: '' }, code: 'MISSING_FIELD' },
    { input: { text: ['a', 'b'] }, code: 'INVALID_INPUT' }
  ],
  run (input) {
    /* Heuristic, and labelled as one: a handful of abbreviations are known,
       an unlisted one will split a sentence in two. */
    const list = sentences(input.text);
    return ok({ sentences: list, count: list.length }, computed());
  }
};
