import { ok, fail, computed } from '../src/contracts.js';
import { lines, words } from '../src/lib/text.js';
import { diffTokens } from '../src/lib/diff.js';

/* Cap chosen so the LCS table stays under ~16M cells. Beyond that the skill
   refuses with a reason rather than being stopped by the executor's 2s budget,
   because a timeout tells the user nothing about what to do next. */
const MAX_TOKENS = 4000;

export default {
  name: 'diffText',
  description: 'Compare two versions of a text and show what was added and removed, by line or by word.',
  category: 'text',
  tier: 'core',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{added}} added, {{removed}} removed, {{unchanged}} unchanged ({{by}}).',
  inputSchema: {
    type: 'object',
    required: ['before', 'after'],
    properties: {
      before: { type: 'string', label: 'original text', prompt: 'What is the original text?' },
      after: { type: 'string', label: 'new text', prompt: 'What is the new text?' },
      by: { type: 'string', label: 'compare by', enum: ['line', 'word'], default: 'line' }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      added: { type: 'integer' }, removed: { type: 'integer' }, unchanged: { type: 'integer' },
      addedItems: { type: 'array', items: { type: 'string' } },
      removedItems: { type: 'array', items: { type: 'string' } },
      identical: { type: 'boolean' }, by: { type: 'string' }
    }
  },
  examples: [
    { text: 'show me the line by line changes', input: { before: 'apple\nbanana\ncherry', after: 'apple\nblueberry\ncherry' },
      output: { added: 1, removed: 1, unchanged: 2, addedItems: ['blueberry'], removedItems: ['banana'], identical: false, by: 'line' } },
    { text: 'diff these two paragraphs by word', input: { before: 'the quick brown fox', after: 'the slow brown fox', by: 'word' },
      output: { added: 1, removed: 1, unchanged: 3, addedItems: ['slow'], removedItems: ['quick'], identical: false, by: 'word' } },
    { text: 'compare the old and new list', input: { before: 'one\ntwo', after: 'one\ntwo\nthree' },
      output: { added: 1, removed: 0, unchanged: 2, addedItems: ['three'], removedItems: [], identical: false, by: 'line' } },
    { text: 'what was deleted from this list', input: { before: 'a\nb\nc\nd', after: 'a\nd' },
      output: { added: 0, removed: 2, unchanged: 2, addedItems: [], removedItems: ['b', 'c'], identical: false, by: 'line' } },
    { text: 'did anything change', input: { before: 'same text', after: 'same text' },
      output: { added: 0, removed: 0, unchanged: 1, addedItems: [], removedItems: [], identical: true, by: 'line' } },
    { text: 'show me what differs between the earlier draft and the later one', input: { before: 'red\ngreen\nblue', after: 'red\nyellow\nblue' },
      output: { added: 1, removed: 1, unchanged: 2, addedItems: ['yellow'], removedItems: ['green'], identical: false, by: 'line' } },
    { text: 'compare these two drafts line by line', input: { before: 'a\nb', after: 'a\nc' },
      output: { added: 1, removed: 1, unchanged: 1, addedItems: ['c'], removedItems: ['b'], identical: false, by: 'line' } }
  ],
  errorCases: [
    { input: { before: 'a' }, code: 'MISSING_FIELD' },
    { input: { before: 'a', after: 'b', by: 'character' }, code: 'INVALID_INPUT' },
    { input: { before: 'x '.repeat(5000), after: 'y', by: 'word' }, code: 'INVALID_INPUT' }
  ],
  run (input) {
    const split = input.by === 'word'
      ? (t) => words(t)
      : (t) => lines(t, { keepBlank: false });

    const a = split(input.before);
    const b = split(input.after);
    if (a.length > MAX_TOKENS || b.length > MAX_TOKENS) {
      return fail('INVALID_INPUT', `That is too much to diff at once — ${Math.max(a.length, b.length)} ${input.by}s against a limit of ${MAX_TOKENS}.`, a.length > MAX_TOKENS ? 'before' : 'after');
    }

    const ops = diffTokens(a, b);
    const addedItems = ops.filter(o => o.op === 'added').map(o => o.value);
    const removedItems = ops.filter(o => o.op === 'removed').map(o => o.value);
    const unchanged = ops.filter(o => o.op === 'same').length;

    return ok({
      added: addedItems.length, removed: removedItems.length, unchanged,
      addedItems, removedItems,
      identical: addedItems.length === 0 && removedItems.length === 0,
      by: input.by
    }, computed());
  }
};
