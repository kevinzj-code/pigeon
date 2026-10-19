import { ok, fail, computed } from '../src/contracts.js';
import { lines } from '../src/lib/text.js';

export default {
  name: 'extractHeadings',
  description: 'Pull the heading structure out of a markdown document as a plain outline.',
  category: 'writing',
  tier: 'core',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{count}} {{count|plural:heading:headings}}, {{levels}} {{levels|plural:level:levels}} deep:\n{{outline|lines}}',
  inputSchema: {
    type: 'object',
    required: ['markdown'],
    properties: { markdown: { type: 'string', label: 'markdown', minLength: 1, prompt: 'Which markdown should I read?' } }
  },
  outputSchema: {
    type: 'object',
    properties: {
      headings: { type: 'array' }, outline: { type: 'array', items: { type: 'string' } },
      count: { type: 'integer' }, levels: { type: 'integer' }, skippedLevels: { type: 'boolean' }
    }
  },
  examples: [
    { text: 'get the headings out of this markdown', input: { markdown: '# Title\n\nSome text.\n\n## Section one\n\n## Section two' },
      output: { headings: [{ level: 1, text: 'Title', line: 1 }, { level: 2, text: 'Section one', line: 5 }, { level: 2, text: 'Section two', line: 7 }], outline: ['Title', '  Section one', '  Section two'], count: 3, levels: 2, skippedLevels: false } },
    { text: 'outline this document', input: { markdown: '# A\n## B\n### C' },
      output: { headings: [{ level: 1, text: 'A', line: 1 }, { level: 2, text: 'B', line: 2 }, { level: 3, text: 'C', line: 3 }], outline: ['A', '  B', '    C'], count: 3, levels: 3, skippedLevels: false } },
    { text: 'find the headings, ignoring code fences', input: { markdown: '# Real\n\n```\n# Not a heading\n```\n\n## Also real' },
      output: { headings: [{ level: 1, text: 'Real', line: 1 }, { level: 2, text: 'Also real', line: 7 }], outline: ['Real', '  Also real'], count: 2, levels: 2, skippedLevels: false } },
    { text: 'does this document skip heading levels', input: { markdown: '# Top\n### Jumped' },
      output: { headings: [{ level: 1, text: 'Top', line: 1 }, { level: 3, text: 'Jumped', line: 2 }], outline: ['Top', '    Jumped'], count: 2, levels: 2, skippedLevels: true } },
    { text: 'extract a single heading', input: { markdown: '## Just one' },
      output: { headings: [{ level: 2, text: 'Just one', line: 1 }], outline: ['  Just one'], count: 1, levels: 1, skippedLevels: false } }
  ],
  errorCases: [
    { input: { markdown: 'no headings at all here' }, code: 'INVALID_INPUT' },
    { input: { markdown: '' }, code: 'MISSING_FIELD' },
    { input: {}, code: 'MISSING_FIELD' }
  ],
  run (input) {
    const all = lines(input.markdown);
    const headings = [];
    let inFence = false;

    all.forEach((line, i) => {
      /* A ``` line toggles a code fence, and "# " inside one is a comment or a
         shell prompt, not a heading. Missing this is the classic markdown
         outliner bug. */
      if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; return; }
      if (inFence) return;
      const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
      if (m) headings.push({ level: m[1].length, text: m[2], line: i + 1 });
    });

    if (!headings.length) return fail('INVALID_INPUT', 'There are no markdown headings in that.', 'markdown');

    const seen = [...new Set(headings.map(h => h.level))].sort((a, b) => a - b);
    return ok({
      headings,
      outline: headings.map(h => '  '.repeat(h.level - 1) + h.text),
      count: headings.length,
      levels: seen.length,
      /* Flagged rather than corrected: jumping H1 → H3 is a real accessibility
         problem, and the document's author is the one who should fix it. */
      skippedLevels: seen.some((lvl, i) => i > 0 && lvl - seen[i - 1] > 1)
    }, computed());
  }
};
