import { ok, computed } from '../src/contracts.js';
import { isWord, allWords, anagramKey, WORDS_AS_OF } from '../src/lib/words.js';
import { levenshtein } from '../src/lib/text.js';

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz';

/* Every string one edit away from the word - deletions, transpositions,
   substitutions and insertions. Generating candidates and testing membership is
   far cheaper than measuring the distance to 65,000 words: about 54n of them for
   a word of length n, each a single set lookup. */
function edits1 (w) {
  const out = new Set();
  for (let i = 0; i <= w.length; i++) {
    if (i < w.length) out.add(w.slice(0, i) + w.slice(i + 1));
    if (i < w.length - 1) out.add(w.slice(0, i) + w[i + 1] + w[i] + w.slice(i + 2));
    for (const c of ALPHABET) {
      if (i < w.length) out.add(w.slice(0, i) + c + w.slice(i + 1));
      out.add(w.slice(0, i) + c + w.slice(i));
    }
  }
  out.delete(w);
  return out;
}

function suggest (word, limit) {
  const key = anagramKey(word);
  /* A candidate made of the same letters is a transposition - the commonest
     typing slip there is - so it outranks everything else. Without this, "teh"
     suggested meh, tea and tee before it got anywhere near "the". */
  /* How much of the word's start and end a candidate keeps. A typo usually
     preserves both ends, so "eror" should offer "error" (which keeps "ror" at
     the end) ahead of "err" (which keeps only "r"), even though both are one
     edit away and "err" wins alphabetically. */
  const overlap = (c) => {
    let head = 0;
    while (head < c.length && head < word.length && c[head] === word[head]) head++;
    let tail = 0;
    while (tail < c.length - head && tail < word.length - head && c[c.length - 1 - tail] === word[word.length - 1 - tail]) tail++;
    return head + tail;
  };

  const rank = (a, b) =>
    (anagramKey(b) === key) - (anagramKey(a) === key) ||
    (b[0] === word[0]) - (a[0] === word[0]) ||
    overlap(b) - overlap(a) ||
    Math.abs(a.length - word.length) - Math.abs(b.length - word.length) ||
    a.localeCompare(b);

  const near = [...edits1(word)].filter(isWord);
  if (near.length) return near.sort(rank).slice(0, limit);

  /* Nothing one edit away: fall back to a scan, narrowed to words of a similar
     length starting with the same letter, which is most of the cost avoided. */
  return allWords()
    .filter((w) => Math.abs(w.length - word.length) <= 2 && w[0] === word[0])
    .map((w) => [w, levenshtein(w, word)])
    .filter(([, d]) => d <= 2)
    .sort((a, b) => a[1] - b[1] || rank(a[0], b[0]))
    .slice(0, limit)
    .map(([w]) => w);
}

export default {
  name: 'spellCheck',
  description: 'Find words that are not in the dictionary and suggest corrections.',
  category: 'writing', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: WORDS_AS_OF, labels: [],
  replyTemplate: '{{count}} unrecognised {{count|plural:word:words}} out of {{wordCount}}: {{lines|list}}.',
  inputSchema: {
    type: 'object', required: ['text'],
    properties: {
      text: { type: 'string', label: 'text', minLength: 1, maxLength: 50000, prompt: 'Which text should I check?' },
      suggestions: { type: 'integer', label: 'suggestions per word', minimum: 0, maximum: 10, default: 3 }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      misspelled: { type: 'array' }, lines: { type: 'array', items: { type: 'string' } },
      count: { type: 'integer' }, wordCount: { type: 'integer' },
      skippedProperNouns: { type: 'integer' }, dataAsOf: { type: 'string' }
    }
  },
  examples: [
    { text: 'spell check this sentence', input: { text: 'teh quick brown fox' }, output: { misspelled: [{ word: 'teh', suggestions: ['the', 'tech', 'tea'] }], lines: ['teh: the, tech, tea'], count: 1, wordCount: 4, skippedProperNouns: 0, dataAsOf: '2026-09-01' } },
    { text: 'check my spelling', input: { text: 'I recieve the post' }, output: { misspelled: [{ word: 'recieve', suggestions: ['receive', 'relieve'] }], lines: ['recieve: receive, relieve'], count: 1, wordCount: 4, skippedProperNouns: 0, dataAsOf: '2026-09-01' } },
    { text: 'find spelling mistakes', input: { text: 'This sentance has an eror.' }, output: { misspelled: [{ word: 'sentance', suggestions: ['sentence'] }, { word: 'eror', suggestions: ['error', 'err'] }], lines: ['sentance: sentence', 'eror: error, err'], count: 2, wordCount: 5, skippedProperNouns: 0, dataAsOf: '2026-09-01' } },
    { text: 'are there any typos here', input: { text: 'The quick brown fox jumps over the lazy dog.' }, output: { misspelled: [], lines: [], count: 0, wordCount: 9, skippedProperNouns: 0, dataAsOf: '2026-09-01' } },
    { text: 'check these two commonly misspelled words', input: { text: 'definately seperate' }, output: { misspelled: [{ word: 'definately', suggestions: ['definitely'] }, { word: 'seperate', suggestions: ['separate'] }], lines: ['definately: definitely', 'seperate: separate'], count: 2, wordCount: 2, skippedProperNouns: 0, dataAsOf: '2026-09-01' } },
    { text: 'any misspelt words in this', input: { text: 'the recieve was definately late' },
      output: { misspelled: [{ word: 'recieve', suggestions: ['receive', 'relieve'] }, { word: 'definately', suggestions: ['definitely'] }], lines: ['recieve: receive, relieve', 'definately: definitely'], count: 2, wordCount: 5, skippedProperNouns: 0, dataAsOf: '2026-09-01' } },
    { text: 'find the typos in this paragraph', input: { text: 'I beleive the adress is wrong' },
      output: { misspelled: [{ word: 'beleive', suggestions: ['believe'] }, { word: 'adress', suggestions: ['address', 'dress'] }], lines: ['beleive: believe', 'adress: address, dress'], count: 2, wordCount: 6, skippedProperNouns: 0, dataAsOf: '2026-09-01' } }
  ],
  errorCases: [
    { input: {}, code: 'MISSING_FIELD' },
    { input: { text: '' }, code: 'MISSING_FIELD' },
    { input: { text: 'x'.repeat(50001) }, code: 'INVALID_INPUT' }
  ],
  run (input) {
    const tokens = String(input.text).match(/[A-Za-z][A-Za-z']*/g) || [];
    const misspelled = [];
    const seen = new Set();
    let skippedProperNouns = 0;

    for (const [i, token] of tokens.entries()) {
      const bare = token.replace(/'s$/i, '').toLowerCase();
      /* Single letters are never worth flagging: "a" and "I" are words, and
         anything else of one letter is an initial or a variable name. The
         wordlist starts at two letters, so without this every "I" is an error. */
      if (bare.length < 2 || isWord(bare)) continue;
      /* The wordlist has no proper nouns, so a capitalised word that is not
         opening a sentence is far more likely to be a name than a mistake.
         Counting them separately says what was skipped instead of hiding it. */
      if (i > 0 && /^[A-Z]/.test(token)) { skippedProperNouns++; continue; }
      if (seen.has(bare)) continue;
      seen.add(bare);
      misspelled.push({ word: bare, suggestions: input.suggestions ? suggest(bare, input.suggestions) : [] });
    }

    return ok({
      misspelled,
      lines: misspelled.map((m) => `${m.word}: ${m.suggestions.join(', ') || 'no suggestion'}`),
      count: misspelled.length, wordCount: tokens.length, skippedProperNouns,
      dataAsOf: WORDS_AS_OF
    }, computed());
  }
};
