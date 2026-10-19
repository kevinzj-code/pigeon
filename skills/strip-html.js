import { ok, computed } from '../src/contracts.js';

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…' };

export default {
  name: 'stripHtml',
  description: 'Strip the tags out of HTML markup and leave the readable words.',
  category: 'text', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  title: 'Strip HTML',
  replyTemplate: '{{result|prose}}',
  inputSchema: {
    type: 'object', required: ['html'],
    properties: {
      html: { type: 'string', label: 'html', minLength: 1, prompt: 'Which HTML should I strip?' },
      keepLineBreaks: { type: 'boolean', label: 'keep line breaks', default: true }
    }
  },
  outputSchema: { type: 'object', properties: { result: { type: 'string' }, tagsRemoved: { type: 'integer' }, characters: { type: 'integer' } } },
  examples: [
    { text: 'strip the tags from <p>Hello <b>world</b></p>', input: { html: '<p>Hello <b>world</b></p>' }, output: { result: 'Hello world', tagsRemoved: 4, characters: 11 } },
    { text: 'get the text out of this html', input: { html: '<div><h1>Title</h1><p>Body text.</p></div>' }, output: { result: 'Title\nBody text.', tagsRemoved: 6, characters: 16 } },
    { text: 'remove tags and decode the entities', input: { html: '<span>Tom &amp; Jerry</span>' }, output: { result: 'Tom & Jerry', tagsRemoved: 2, characters: 11 } },
    { text: 'strip a script tag and its contents', input: { html: '<p>Safe</p><script>alert(1)</script>' }, output: { result: 'Safe', tagsRemoved: 4, characters: 4 } },
    { text: 'strip html with a line break', input: { html: 'one<br>two' }, output: { result: 'one\ntwo', tagsRemoved: 1, characters: 7 } },
    { text: 'drop the tags and give me the plain words from this html', input: { html: '<h1>Title</h1><p>Body text</p>' },
      output: { result: 'Title\nBody text', tagsRemoved: 4, characters: 15 } },
    { text: 'remove the html and leave the words', input: { html: '<ul><li>one</li><li>two</li></ul>' },
      output: { result: 'one\ntwo', tagsRemoved: 6, characters: 7 } }
  ],
  errorCases: [
    { input: {}, code: 'MISSING_FIELD' },
    { input: { html: '' }, code: 'MISSING_FIELD' },
    { input: { html: ['<p>'] }, code: 'INVALID_INPUT' }
  ],
  run (input) {
    let s = input.html;
    let tagsRemoved = 0;

    /* <script> and <style> contents go with the tags. Stripping only the tags
       would leave JavaScript source sitting in the "readable text", which is
       both wrong and the classic way this function surprises people. */
    s = s.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, (m) => {
      tagsRemoved += (m.match(/<[^>]+>/g) || []).length;
      return '';
    });

    if (input.keepLineBreaks) {
      s = s.replace(/<br\s*\/?>/gi, () => { tagsRemoved++; return '\n'; })
        .replace(/<\/(p|div|h[1-6]|li|tr|section|article)\s*>/gi, () => { tagsRemoved++; return '\n'; });
    }
    s = s.replace(/<[^>]+>/g, () => { tagsRemoved++; return ''; });
    s = s.replace(/&(#?\w+);/g, (whole, name) => ENTITIES[name] ?? whole);
    s = s.replace(/[^\S\n]+/g, ' ').replace(/ *\n+ */g, '\n').trim();

    return ok({ result: s, tagsRemoved, characters: s.length }, computed());
  }
};
