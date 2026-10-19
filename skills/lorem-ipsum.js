import { ok, computed } from '../src/contracts.js';
import { mulberry32, intBetween } from '../src/lib/seeded.js';

const POOL = `lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor
incididunt ut labore et dolore magna aliqua enim ad minim veniam quis nostrud
exercitation ullamco laboris nisi aliquip ex ea commodo consequat duis aute irure
in reprehenderit voluptate velit esse cillum eu fugiat nulla pariatur excepteur
sint occaecat cupidatat non proident sunt culpa qui officia deserunt mollit anim
id est laborum at vero eos accusamus iusto odio dignissimos ducimus blanditiis
praesentium voluptatum deleniti atque corrupti quos dolores quas molestias`
  .trim().split(/\s+/);

const OPENING = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.';

export default {
  name: 'loremIpsum',
  description: 'Generate meaningless placeholder filler to fill out a layout.',
  category: 'generation', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{wordCount}} words of placeholder text from seed {{seed}} — Latin-looking filler, not writing that means anything.\n{{text}}',
  inputSchema: {
    type: 'object',
    properties: {
      paragraphs: { type: 'integer', label: 'paragraphs', minimum: 1, maximum: 20, default: 1 },
      sentencesPerParagraph: { type: 'integer', label: 'sentences per paragraph', minimum: 1, maximum: 20, default: 4 },
      seed: { type: 'integer', label: 'repeatable seed', minimum: 0, maximum: 2147483647, default: 1 },
      startWithLorem: { type: 'boolean', label: 'start with lorem ipsum', default: true }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      text: { type: 'string' }, paragraphs: { type: 'integer' },
      sentenceCount: { type: 'integer' }, wordCount: { type: 'integer' }, seed: { type: 'integer' }
    }
  },
  examples: [
    { text: 'generate some placeholder text', input: {  }, output: { text: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Lorem cillum quas dolores veniam, occaecat mollit duis molestias irure. Commodo ad incididunt voluptate consectetur ea. Quis et sit duis, excepteur vero quis dolore sunt fugiat est.', paragraphs: 1, sentenceCount: 4, wordCount: 35, seed: 1 } },
    { text: 'lorem ipsum with two paragraphs', input: { paragraphs: 2 }, output: { text: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Lorem cillum quas dolores veniam, occaecat mollit duis molestias irure. Commodo ad incididunt voluptate consectetur ea. Quis et sit duis, excepteur vero quis dolore sunt fugiat est.\n\nIrure laborum molestias enim est incididunt ullamco, consequat ad incididunt. Eiusmod minim sit cupidatat, ducimus enim molestias mollit commodo. Quos deleniti officia deleniti iusto atque do sit, ducimus quis. Atque deserunt ut, culpa corrupti eiusmod quas ut ea.', paragraphs: 2, sentenceCount: 8, wordCount: 73, seed: 1 } },
    { text: 'filler text with a different seed', input: { seed: 42 }, output: { text: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Irure dignissimos culpa labore, cillum veniam cupidatat ducimus reprehenderit. Id nostrud et velit qui, occaecat lorem reprehenderit iusto amet excepteur dolor. Et at cillum dolor labore.', paragraphs: 1, sentenceCount: 4, wordCount: 34, seed: 42 } },
    { text: 'three short sentences of lorem', input: { sentencesPerParagraph: 3, seed: 7 }, output: { text: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Consectetur quas officia cillum commodo. Enim fugiat anim ad incididunt est esse et.', paragraphs: 1, sentenceCount: 3, wordCount: 21, seed: 7 } },
    { text: 'placeholder text without the lorem opening', input: { startWithLorem: false, seed: 3, sentencesPerParagraph: 2 }, output: { text: 'Sit irure adipiscing, est reprehenderit voluptate ut minim fugiat et. Reprehenderit vero blanditiis, ullamco qui quis culpa cillum iusto eu.', paragraphs: 1, sentenceCount: 2, wordCount: 20, seed: 3 } }
  ],
  errorCases: [
    { input: { paragraphs: 0 }, code: 'INVALID_INPUT' },
    { input: { paragraphs: 50 }, code: 'INVALID_INPUT' },
    { input: { sentencesPerParagraph: 0 }, code: 'INVALID_INPUT' }
  ],
  run (input) {
    /* Seeded, per §20. The same seed gives the same filler every time, which is
       what makes the output assertable in a test and a plan replayable — and
       placeholder text has no reason to be unpredictable. */
    const rand = mulberry32(input.seed);
    const paragraphs = [];
    let sentenceCount = 0;

    for (let p = 0; p < input.paragraphs; p++) {
      const sentences = [];
      for (let s = 0; s < input.sentencesPerParagraph; s++) {
        if (p === 0 && s === 0 && input.startWithLorem) { sentences.push(OPENING); sentenceCount++; continue; }
        const length = intBetween(rand, 5, 12);
        const words = Array.from({ length }, () => POOL[intBetween(rand, 0, POOL.length - 1)]);
        /* A comma somewhere in the middle of the longer sentences, so the filler
           has the visual texture of real prose rather than reading as a list. */
        if (length > 8) words[intBetween(rand, 2, length - 3)] += ',';
        const sentence = `${words[0][0].toUpperCase()}${words[0].slice(1)} ${words.slice(1).join(' ')}.`;
        sentences.push(sentence);
        sentenceCount++;
      }
      paragraphs.push(sentences.join(' '));
    }

    const text = paragraphs.join('\n\n');
    return ok({
      text, paragraphs: input.paragraphs, sentenceCount,
      wordCount: (text.match(/\S+/g) || []).length, seed: input.seed
    }, computed());
  }
};
