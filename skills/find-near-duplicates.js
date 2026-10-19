import { ok, fail, computed } from '../src/contracts.js';
import { levenshtein } from '../src/lib/text.js';
import { round } from '../src/lib/num.js';

const normalise = (s) => String(s).toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();

export default {
  name: 'findNearDuplicates',
  description: 'Find entries in a list that are nearly the same as each other.',
  category: 'text', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{groupCount}} {{groupCount|plural:group:groups}} of near duplicates among {{count}} entries:\n{{lines|lines}}',
  inputSchema: {
    type: 'object', required: ['items'],
    properties: {
      items: { type: 'array', label: 'list', minItems: 2, maxItems: 500, items: { type: 'string' }, prompt: 'Which list should I check?' },
      threshold: { type: 'number', label: 'similarity (0.5–1)', minimum: 0.5, maximum: 1, default: 0.85, description: 'how similar two entries must be to count as duplicates' }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      groups: { type: 'array' }, lines: { type: 'array', items: { type: 'string' } },
      groupCount: { type: 'integer' }, duplicateCount: { type: 'integer' },
      count: { type: 'integer' }, threshold: { type: 'number' }
    }
  },
  examples: [
    { text: 'find near duplicates in this list', input: { items: ['apple pie', 'apple pies', 'banana bread'] }, output: { groups: [{ members: ['apple pie', 'apple pies'], similarity: 0.9 }], lines: ['apple pie / apple pies (0.9)'], groupCount: 1, duplicateCount: 1, count: 3, threshold: 0.85 } },
    { text: 'are any of these the same', input: { items: ['red', 'green', 'blue'] }, output: { groups: [], lines: [], groupCount: 0, duplicateCount: 0, count: 3, threshold: 0.85 } },
    { text: 'spot duplicate entries ignoring case and punctuation', input: { items: ['Smith, John', 'smith john', 'Jones, Amy'] }, output: { groups: [{ members: ['Smith, John', 'smith john'], similarity: 1 }], lines: ['Smith, John / smith john (1)'], groupCount: 1, duplicateCount: 1, count: 3, threshold: 0.85 } },
    { text: 'find similar lines', input: { items: ['the quick brown fox', 'the quick brown fox jumps', 'something else entirely'], threshold: 0.7 }, output: { groups: [{ members: ['the quick brown fox', 'the quick brown fox jumps'], similarity: 0.76 }], lines: ['the quick brown fox / the quick brown fox jumps (0.76)'], groupCount: 1, duplicateCount: 1, count: 3, threshold: 0.7 } },
    { text: 'check three near identical spellings', input: { items: ['colour', 'color', 'colours'], threshold: 0.8 }, output: { groups: [{ members: ['colour', 'color', 'colours'], similarity: 0.83 }], lines: ['colour / color / colours (0.83)'], groupCount: 1, duplicateCount: 2, count: 3, threshold: 0.8 } }
  ],
  errorCases: [
    { input: { items: ['only one'] }, code: 'INVALID_INPUT' },
    { input: { items: ['a', 'b'], threshold: 0.1 }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' }
  ],
  run (input) {
    const items = input.items.map((i) => String(i));
    const keys = items.map(normalise);
    if (keys.some((k) => !k)) return fail('INVALID_INPUT', 'One of those entries has nothing comparable in it once punctuation is stripped.', 'items');

    const similarity = (a, b) => {
      const longest = Math.max(a.length, b.length);
      return longest === 0 ? 1 : 1 - levenshtein(a, b) / longest;
    };

    /* Single-link grouping: A joins B's group if it is close enough to ANY
       member, so colour/color/colours land together even though the two ends of
       that chain are further apart than the threshold. The reported similarity
       is the weakest link, which is the honest summary of a chained group. */
    const groups = [];
    const placed = new Array(items.length).fill(-1);
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const score = similarity(keys[i], keys[j]);
        if (score < input.threshold) continue;
        const target = placed[i] >= 0 ? placed[i] : placed[j];
        if (target >= 0) {
          const g = groups[target];
          for (const k of [i, j]) if (placed[k] < 0) { g.indexes.push(k); placed[k] = target; }
          g.weakest = Math.min(g.weakest, score);
        } else {
          groups.push({ indexes: [i, j], weakest: score });
          placed[i] = groups.length - 1;
          placed[j] = groups.length - 1;
        }
      }
    }

    const out = groups.map((g) => ({
      members: g.indexes.map((k) => items[k]),
      similarity: round(g.weakest, 2)
    }));

    return ok({
      groups: out,
      lines: out.map((g) => `${g.members.join(' / ')} (${g.similarity})`),
      groupCount: out.length,
      duplicateCount: out.reduce((a, g) => a + g.members.length - 1, 0),
      count: items.length, threshold: input.threshold
    }, computed());
  }
};
