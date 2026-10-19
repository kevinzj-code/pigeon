import { ok, fail, computed } from '../src/contracts.js';

export default {
  name: 'outlineToMarkdown',
  description: 'Turn your own indented notes into markdown headings and bullets.',
  category: 'writing', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{lineCount}} {{lineCount|plural:line:lines}}, {{depth}} levels deep:\n{{markdown}}',
  inputSchema: {
    type: 'object', required: ['outline'],
    properties: {
      outline: { type: 'string', label: 'outline', minLength: 1, maxLength: 20000, prompt: 'Which outline should I convert?' },
      headingLevels: { type: 'integer', label: 'heading levels', minimum: 0, maximum: 6, default: 1, description: 'how many outline levels become headings rather than bullets' }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      markdown: { type: 'string' }, lineCount: { type: 'integer' },
      depth: { type: 'integer' }, headings: { type: 'integer' }
    }
  },
  examples: [
    { text: 'turn this outline into markdown', input: { outline: 'Introduction\n  Background\n  Aims\nMethod\n  Sampling' }, output: { markdown: '# Introduction\n\n- Background\n- Aims\n\n# Method\n\n- Sampling', lineCount: 5, depth: 2, headings: 2 } },
    { text: 'convert my indented notes to markdown', input: { outline: 'Shopping\n  Fruit\n    Apples\n    Pears' }, output: { markdown: '# Shopping\n\n- Fruit\n  - Apples\n  - Pears', lineCount: 4, depth: 3, headings: 1 } },
    { text: 'outline to markdown with two heading levels', input: { outline: 'Part one\n  Chapter A\n    A point\nPart two', headingLevels: 2 }, output: { markdown: '# Part one\n\n## Chapter A\n\n- A point\n\n# Part two', lineCount: 4, depth: 3, headings: 3 } },
    { text: 'make markdown from a flat list', input: { outline: 'One\nTwo\nThree', headingLevels: 0 }, output: { markdown: '- One\n- Two\n- Three', lineCount: 3, depth: 1, headings: 0 } },
    { text: 'convert an outline using tabs', input: { outline: 'Top\n\tNested\n\t\tDeeper' }, output: { markdown: '# Top\n\n- Nested\n  - Deeper', lineCount: 3, depth: 3, headings: 1 } }
  ],
  errorCases: [
    { input: { outline: '   ' }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' },
    { input: { outline: '  indented first line\ntop' }, code: 'INVALID_INPUT' }
  ],
  run (input) {
    const raw = String(input.outline).split(/\r?\n/).filter((l) => l.trim());
    if (!raw.length) return fail('INVALID_INPUT', 'That outline has no lines in it.', 'outline');

    /* A tab counts as one indent step, as do two spaces. Mixing them in one
       document is common when text is pasted from two places, so both are
       normalised to a level number rather than compared as strings. */
    const levels = raw.map((line) => {
      const lead = /^[\t ]*/.exec(line)[0];
      return Math.floor(lead.replace(/\t/g, '  ').length / 2);
    });
    if (levels[0] !== 0) return fail('INVALID_INPUT', 'The first line is indented, so I cannot tell what it sits under.', 'outline');

    const headingLevels = input.headingLevels ?? 1;
    const blocks = [];
    let headings = 0;
    for (const [i, line] of raw.entries()) {
      const level = levels[i];
      const text = line.trim();
      if (level < headingLevels) {
        blocks.push(`${'#'.repeat(level + 1)} ${text}`);
        headings++;
      } else {
        blocks.push(`${'  '.repeat(level - headingLevels)}- ${text}`);
      }
    }

    /* A blank line after each heading, and between a bullet run and the heading
       that follows it — Markdown needs it, and without it the list gets absorbed
       into the previous paragraph. */
    const out = [];
    for (const [i, block] of blocks.entries()) {
      out.push(block);
      const next = blocks[i + 1];
      if (next && (block.startsWith('#') || next.startsWith('#'))) out.push('');
    }

    return ok({
      markdown: out.join('\n'), lineCount: raw.length,
      depth: Math.max(...levels) + 1, headings
    }, computed());
  }
};
