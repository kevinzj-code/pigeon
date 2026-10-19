import { ok, computed } from '../src/contracts.js';

export default {
  name: 'extractCodeBlocks',
  description: 'Lift the fenced code snippets out of a markdown document.',
  category: 'text', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{count}} code {{count|plural:block:blocks}}, {{totalLines}} lines in total{{languageNote|prose}}.',
  inputSchema: {
    type: 'object', required: ['markdown'],
    properties: {
      markdown: { type: 'string', label: 'markdown', minLength: 1, prompt: 'Which markdown should I read?' },
      language: { type: 'string', label: 'language', description: 'keep only blocks tagged with this language' }
    }
  },
  outputSchema: { type: 'object', properties: { blocks: { type: 'array' }, count: { type: 'integer' }, totalLines: { type: 'integer' }, languages: { type: 'array', items: { type: 'string' } }, languageNote: { type: 'string' } } },
  examples: [
    { text: 'get the code blocks from this readme', input: { markdown: 'Run it:\n\n```bash\nnpm test\n```\n\nThen:\n\n```js\nconst a = 1;\n```' },
      output: { blocks: [{ language: 'bash', code: 'npm test', lines: 1 }, { language: 'js', code: 'const a = 1;', lines: 1 }], count: 2, totalLines: 2, languages: ['bash', 'js'], languageNote: ' — bash and js' } },
    { text: 'extract just the js blocks', input: { markdown: '```bash\nls\n```\n```js\nlet x;\n```', language: 'js' },
      output: { blocks: [{ language: 'js', code: 'let x;', lines: 1 }], count: 1, totalLines: 1, languages: ['js'], languageNote: ' — js' } },
    { text: 'pull an untagged code block', input: { markdown: '```\nplain code\n```' },
      output: { blocks: [{ language: '', code: 'plain code', lines: 1 }], count: 1, totalLines: 1, languages: [], languageNote: '' } },
    { text: 'get a multi-line block', input: { markdown: '```py\nimport os\nprint(os.getcwd())\n```' },
      output: { blocks: [{ language: 'py', code: 'import os\nprint(os.getcwd())', lines: 2 }], count: 1, totalLines: 2, languages: ['py'], languageNote: ' — py' } },
    { text: 'any code blocks in this document', input: { markdown: 'Just prose, no fences.' },
      output: { blocks: [], count: 0, totalLines: 0, languages: [], languageNote: '' } }
  ],
  errorCases: [
    { input: {}, code: 'MISSING_FIELD' },
    { input: { markdown: '' }, code: 'MISSING_FIELD' },
    { input: { markdown: ['```'] }, code: 'INVALID_INPUT' }
  ],
  run (input) {
    const blocks = [];
    /* Both fence characters, and the closing fence must match the opener — a
       ``` inside a ~~~ block is content, not a terminator. */
    const re = /^(```|~~~)([^\n`]*)\n([\s\S]*?)^\1\s*$/gm;
    for (const m of input.markdown.matchAll(re)) {
      const language = m[2].trim().toLowerCase();
      const code = m[3].replace(/\n$/, '');
      if (input.language && language !== input.language.toLowerCase()) continue;
      blocks.push({ language, code, lines: code === '' ? 0 : code.split('\n').length });
    }
    const languages = [...new Set(blocks.map(b => b.language).filter(Boolean))];
    return ok({
      blocks, count: blocks.length,
      totalLines: blocks.reduce((n, b) => n + b.lines, 0),
      languages,
      languageNote: languages.length ? ` — ${languages.join(' and ')}` : ''
    }, computed());
  }
};
