import { ok, fail, computed } from '../src/contracts.js';
import { lines } from '../src/lib/text.js';

export default {
  name: 'extractListItems',
  description: 'Pull the bulleted or numbered list items out of a document.',
  category: 'text', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{count}} list {{count|plural:item:items}}:\n{{items|lines}}',
  inputSchema: {
    type: 'object', required: ['text'],
    properties: {
      text: { type: 'string', label: 'text', minLength: 1, prompt: 'Which text should I read?' },
      type: { type: 'string', label: 'list type', enum: ['any', 'bulleted', 'numbered'], default: 'any' }
    }
  },
  outputSchema: { type: 'object', properties: { items: { type: 'array', items: { type: 'string' } }, count: { type: 'integer' }, bulleted: { type: 'integer' }, numbered: { type: 'integer' }, maxDepth: { type: 'integer' } } },
  examples: [
    { text: 'get the list items from this note', input: { text: 'Shopping:\n- milk\n- eggs\n- bread' }, output: { items: ['milk', 'eggs', 'bread'], count: 3, bulleted: 3, numbered: 0, maxDepth: 1 } },
    { text: 'extract the numbered steps', input: { text: '1. preheat\n2. mix\n3. bake' }, output: { items: ['preheat', 'mix', 'bake'], count: 3, bulleted: 0, numbered: 3, maxDepth: 1 } },
    { text: 'pull the items from a nested list', input: { text: '- top\n  - nested\n- other' }, output: { items: ['top', 'nested', 'other'], count: 3, bulleted: 3, numbered: 0, maxDepth: 2 } },
    { text: 'get only the bulleted items', input: { text: '1. first\n* bullet', type: 'bulleted' }, output: { items: ['bullet'], count: 1, bulleted: 1, numbered: 0, maxDepth: 1 } },
    { text: 'extract items from a mixed list', input: { text: '- a\n1. b\n+ c' }, output: { items: ['a', 'b', 'c'], count: 3, bulleted: 2, numbered: 1, maxDepth: 1 } }
  ],
  errorCases: [
    { input: { text: 'no list here at all' }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' },
    { input: { text: '- a', type: 'lettered' }, code: 'INVALID_INPUT' }
  ],
  run (input) {
    const items = [];
    let bulleted = 0, numbered = 0, maxDepth = 1;
    for (const line of lines(input.text)) {
      const m = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line);
      if (!m) continue;
      const isNumbered = /\d/.test(m[2]);
      if (input.type === 'bulleted' && isNumbered) continue;
      if (input.type === 'numbered' && !isNumbered) continue;
      /* Two spaces per level is the markdown convention; the depth is reported
         rather than used to nest, because a flat list of the items is what
         "extract the list" almost always means. */
      maxDepth = Math.max(maxDepth, Math.floor(m[1].length / 2) + 1);
      if (isNumbered) numbered++; else bulleted++;
      items.push(m[3].trim());
    }
    if (!items.length) return fail('INVALID_INPUT', 'I could not find a bulleted or numbered list in that.', 'text');
    return ok({ items, count: items.length, bulleted, numbered, maxDepth }, computed());
  }
};
