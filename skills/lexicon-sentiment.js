import { ok, fail, computed } from '../src/contracts.js';
import { SENTIMENT, NEGATIONS, INTENSIFIERS } from '../src/lib/lexicons.js';
import { round } from '../src/lib/num.js';

export default {
  name: 'lexiconSentiment',
  description: 'Judge whether text sounds happy or unhappy, positive or negative.',
  category: 'text', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null,
  /* This counts words from a list. It does not read tone, irony or context, and
     the label plus the reply both say so - a number that looks like a verdict
     needs to arrive with its limits attached. */
  labels: ['lexicon'],
  title: 'Score sentiment',
  replyTemplate: 'Score {{score}} from {{matched}} scored {{matched|plural:word:words}} out of {{wordCount}} — {{verdict}}. This counts words from a list; it cannot tell sarcasm from sincerity.',
  inputSchema: {
    type: 'object', required: ['text'],
    properties: { text: { type: 'string', label: 'text', minLength: 1, maxLength: 50000, prompt: 'Which text should I score?' } }
  },
  outputSchema: {
    type: 'object',
    properties: {
      score: { type: 'number' }, normalised: { type: 'number' }, verdict: { type: 'string' },
      matched: { type: 'integer' }, wordCount: { type: 'integer' },
      positive: { type: 'array' }, negative: { type: 'array' }
    }
  },
  examples: [
    { text: 'how positive is this review', input: { text: 'This is an excellent product and I really love it' }, output: { score: 7.5, normalised: 3.75, verdict: 'positive overall', matched: 2, wordCount: 10, positive: [{ word: 'excellent', weight: 3 }, { word: 'love', weight: 4.5 }], negative: [] } },
    { text: 'score the sentiment of this feedback', input: { text: 'The app is slow and the interface is confusing and frustrating' }, output: { score: -5, normalised: -1.67, verdict: 'negative overall', matched: 3, wordCount: 11, positive: [], negative: [{ word: 'slow', weight: -1 }, { word: 'confusing', weight: -2 }, { word: 'frustrating', weight: -2 }] } },
    { text: 'is this message positive or negative', input: { text: 'The delivery was fine and the packaging was ok' }, output: { score: 2, normalised: 1, verdict: 'positive overall', matched: 2, wordCount: 9, positive: [{ word: 'fine', weight: 1 }, { word: 'ok', weight: 1 }], negative: [] } },
    { text: 'sentiment of a negated sentence', input: { text: 'This is not good and it is not helpful' }, output: { score: -3.2, normalised: -1.6, verdict: 'negative overall', matched: 2, wordCount: 9, positive: [], negative: [{ word: 'good', weight: -1.6 }, { word: 'helpful', weight: -1.6 }] } },
    { text: 'analyse the tone of this comment', input: { text: 'Absolutely brilliant work, very clear and extremely useful' }, output: { score: 6.5, normalised: 2.17, verdict: 'positive overall', matched: 3, wordCount: 8, positive: [{ word: 'brilliant', weight: 3 }, { word: 'clear', weight: 1.5 }, { word: 'useful', weight: 2 }], negative: [] } },
    { text: 'would you say this comes across as cheerful or gloomy', input: { text: 'What a wonderful, delightful surprise' },
      output: { score: 3, normalised: 3, verdict: 'positive overall', matched: 1, wordCount: 5, positive: [{ word: 'wonderful', weight: 3 }], negative: [] } },
    { text: 'is the tone of this positive or negative', input: { text: 'The service was awful and the food was terrible' },
      output: { score: -6, normalised: -3, verdict: 'negative overall', matched: 2, wordCount: 9, positive: [], negative: [{ word: 'awful', weight: -3 }, { word: 'terrible', weight: -3 }] } }
  ],
  errorCases: [
    { input: {}, code: 'MISSING_FIELD' },
    { input: { text: '' }, code: 'MISSING_FIELD' },
    { input: { text: '!!! ???' }, code: 'INVALID_INPUT' }
  ],
  run (input) {
    const tokens = String(input.text).toLowerCase().match(/[\p{L}']+/gu) ?? [];
    if (!tokens.length) return fail('INVALID_INPUT', 'There are no words in that to score.', 'text');

    let score = 0;
    const positive = [];
    const negative = [];
    for (const [i, token] of tokens.entries()) {
      const base = SENTIMENT[token];
      if (base === undefined) continue;
      /* The two words before a scored word can flip or scale it. "not good" is
         not a positive, and "very good" is more than a good - a bare word count
         gets both of those backwards or flat. */
      let weight = base;
      const before = tokens.slice(Math.max(0, i - 2), i);
      if (before.some((w) => NEGATIONS.has(w))) weight = -weight * 0.8;
      for (const w of before) if (INTENSIFIERS[w] && w !== 'a') weight *= INTENSIFIERS[w];
      weight = round(weight, 2);
      score += weight;
      (weight >= 0 ? positive : negative).push({ word: token, weight });
    }

    const matched = positive.length + negative.length;
    const normalised = matched ? round(score / matched, 2) : 0;
    const verdict = score > 0.5 ? 'positive overall' : score < -0.5 ? 'negative overall' : 'neither, on these words';

    return ok({
      score: round(score, 2), normalised, verdict,
      matched, wordCount: tokens.length, positive, negative
    }, computed());
  }
};
