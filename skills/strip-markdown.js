import { ok, computed } from '../src/contracts.js';

export default {
  name: 'stripMarkdown',
  description: 'Turn markdown into plain text, dropping the formatting marks.',
  category: 'text', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{result|prose}}',
  inputSchema: {
    type: 'object', required: ['markdown'],
    properties: {
      markdown: { type: 'string', label: 'markdown', minLength: 1, prompt: 'Which markdown should I strip?' },
      keepLinkText: { type: 'boolean', label: 'keep link text', default: true }
    }
  },
  outputSchema: { type: 'object', properties: { result: { type: 'string' }, characters: { type: 'integer' } } },
  examples: [
    { text: 'strip the markdown from **bold** and *italic*', input: { markdown: '**bold** and *italic*' }, output: { result: 'bold and italic', characters: 15 } },
    { text: 'plain text from this heading', input: { markdown: '# Title\n\nSome body text.' }, output: { result: 'Title\n\nSome body text.', characters: 22 } },
    { text: 'remove the markdown link syntax', input: { markdown: 'See [the docs](https://example.com) now.' }, output: { result: 'See the docs now.', characters: 17 } },
    { text: 'strip a bulleted list', input: { markdown: '- one\n- two\n- three' }, output: { result: 'one\ntwo\nthree', characters: 13 } },
    { text: 'strip inline code and a code fence', input: { markdown: 'Use `npm test`.\n\n```js\nconst a = 1;\n```' }, output: { result: 'Use npm test.\n\nconst a = 1;', characters: 27 } }
  ],
  errorCases: [
    { input: {}, code: 'MISSING_FIELD' },
    { input: { markdown: '' }, code: 'MISSING_FIELD' },
    { input: { markdown: ['# x'] }, code: 'INVALID_INPUT' }
  ],
  run (input) {
    let s = input.markdown;
    /* Fences before inline code, and images before links — in both pairs the
       first pattern contains the second, so the other order strips the inner
       one and leaves the outer syntax stranded. */
    s = s.replace(/```[a-z]*\n?([\s\S]*?)```/g, '$1');
    s = s.replace(/`([^`]+)`/g, '$1');
    s = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1');
    s = s.replace(/\[([^\]]*)\]\([^)]*\)/g, input.keepLinkText ? '$1' : '');
    s = s.replace(/^\s{0,3}#{1,6}\s+/gm, '');
    s = s.replace(/^\s{0,3}>\s?/gm, '');
    s = s.replace(/^\s*[-*+]\s+/gm, '');
    s = s.replace(/^\s*\d+\.\s+/gm, '');
    s = s.replace(/^\s*([-*_]\s*){3,}$/gm, '');
    s = s.replace(/(\*\*\*|___)(.+?)\1/g, '$2');
    s = s.replace(/(\*\*|__)(.+?)\1/g, '$2');
    s = s.replace(/(\*|_)(.+?)\1/g, '$2');
    s = s.replace(/~~(.+?)~~/g, '$1');
    s = s.replace(/\n{3,}/g, '\n\n').trim();
    return ok({ result: s, characters: s.length }, computed());
  }
};
