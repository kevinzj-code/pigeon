import { ok, fail, computed } from '../src/contracts.js';

const slug = (s) => s.toLowerCase().trim().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-');

export default {
  name: 'generateTableOfContents',
  description: 'Build a linked table of contents to sit at the top of a document.',
  category: 'writing', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{count}} {{count|plural:heading:headings}}:\n{{toc}}',
  inputSchema: {
    type: 'object', required: ['markdown'],
    properties: {
      markdown: { type: 'string', label: 'markdown', minLength: 1, maxLength: 200000, prompt: 'Which Markdown should I build a contents list from?' },
      maxLevel: { type: 'integer', label: 'deepest heading level', minimum: 1, maximum: 6, default: 3 },
      numbered: { type: 'boolean', label: 'numbered', default: false }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      toc: { type: 'string' }, entries: { type: 'array' },
      count: { type: 'integer' }, deepest: { type: 'integer' }
    }
  },
  examples: [
    { text: 'make a table of contents for this markdown', input: { markdown: '# Title\n\nSome text.\n\n## First part\n\n## Second part\n\n### A detail' }, output: { toc: '- [Title](#title)\n  - [First part](#first-part)\n  - [Second part](#second-part)\n    - [A detail](#a-detail)', entries: [{ level: 1, text: 'Title', anchor: 'title' }, { level: 2, text: 'First part', anchor: 'first-part' }, { level: 2, text: 'Second part', anchor: 'second-part' }, { level: 3, text: 'A detail', anchor: 'a-detail' }], count: 4, deepest: 3 } },
    { text: 'build a contents list', input: { markdown: '## Setup\n## Usage' }, output: { toc: '- [Setup](#setup)\n- [Usage](#usage)', entries: [{ level: 2, text: 'Setup', anchor: 'setup' }, { level: 2, text: 'Usage', anchor: 'usage' }], count: 2, deepest: 2 } },
    { text: 'table of contents down to level two only', input: { markdown: '# One\n## Two\n### Three', maxLevel: 2 }, output: { toc: '- [One](#one)\n  - [Two](#two)', entries: [{ level: 1, text: 'One', anchor: 'one' }, { level: 2, text: 'Two', anchor: 'two' }], count: 2, deepest: 2 } },
    { text: 'numbered table of contents', input: { markdown: '# Alpha\n# Beta', numbered: true }, output: { toc: '1. [Alpha](#alpha)\n2. [Beta](#beta)', entries: [{ level: 1, text: 'Alpha', anchor: 'alpha' }, { level: 1, text: 'Beta', anchor: 'beta' }], count: 2, deepest: 1 } },
    { text: 'contents from headings with punctuation', input: { markdown: '# What is it?\n## Step 1: begin' }, output: { toc: '- [What is it?](#what-is-it)\n  - [Step 1: begin](#step-1-begin)', entries: [{ level: 1, text: 'What is it?', anchor: 'what-is-it' }, { level: 2, text: 'Step 1: begin', anchor: 'step-1-begin' }], count: 2, deepest: 2 } }
  ],
  errorCases: [
    { input: { markdown: 'No headings here at all.' }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' },
    { input: { markdown: '' }, code: 'MISSING_FIELD' }
  ],
  run (input) {
    const entries = [];
    let inFence = false;
    for (const line of String(input.markdown).split(/\r?\n/)) {
      /* Headings inside a fenced code block are code, not headings — a shell
         comment starting with # is the commonest false positive there is. */
      if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; continue; }
      if (inFence) continue;
      const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
      if (!m || m[1].length > input.maxLevel) continue;
      entries.push({ level: m[1].length, text: m[2], anchor: slug(m[2]) });
    }
    if (!entries.length) return fail('INVALID_INPUT', `That document has no Markdown headings at level ${input.maxLevel} or above.`, 'markdown');

    /* Indented relative to the shallowest heading present, so a document whose
       top level is ## does not start with a wasted indent. */
    const top = Math.min(...entries.map((e) => e.level));
    const toc = entries.map((e, i) => {
      const indent = '  '.repeat(e.level - top);
      const bullet = input.numbered ? `${i + 1}.` : '-';
      return `${indent}${bullet} [${e.text}](#${e.anchor})`;
    }).join('\n');

    return ok({ toc, entries, count: entries.length, deepest: Math.max(...entries.map((e) => e.level)) }, computed());
  }
};
