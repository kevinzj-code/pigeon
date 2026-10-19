import { ok, computed } from '../src/contracts.js';

const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* Inline pass. Code spans are pulled out FIRST and restored last, so `**not
   bold**` inside backticks stays literal - running the emphasis rules over code
   is the classic way a Markdown converter mangles a document about Markdown.
   The placeholder is a distinctive printable token rather than a bare number:
   parking the index between two spaces would match any ordinary " 7 " in the
   prose and swap a real number for a code span. */
const MARK = (i) => `@@CODE${i}@@`;

function inline (text) {
  const spans = [];
  let out = text.replace(/`([^`]+)`/g, (_, code) => {
    spans.push(`<code>${escapeHtml(code)}</code>`);
    return MARK(spans.length - 1);
  });
  out = escapeHtml(out);
  out = out.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, '<img src="$2" alt="$1">');
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
  out = out.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  return out.replace(/@@CODE(\d+)@@/g, (_, i) => spans[Number(i)]);
}

export default {
  name: 'markdownToHtml',
  description: 'Convert Markdown into HTML.',
  category: 'writing', tier: 'standard',
  title: 'Markdown to HTML',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{blocks}} {{blocks|plural:block:blocks}} converted:\n{{html}}',
  inputSchema: {
    type: 'object', required: ['markdown'],
    properties: { markdown: { type: 'string', label: 'markdown', minLength: 1, maxLength: 200000, prompt: 'Which Markdown should I convert?' } }
  },
  outputSchema: { type: 'object', properties: { html: { type: 'string' }, blocks: { type: 'integer' } } },
  examples: [
    { text: 'convert this markdown to html', input: { markdown: '# Title\n\nSome **bold** text.' }, output: { html: '<h1>Title</h1>\n<p>Some <strong>bold</strong> text.</p>', blocks: 2 } },
    { text: 'markdown list to html', input: { markdown: '- one\n- two\n- three' }, output: { html: '<ul>\n<li>one</li>\n<li>two</li>\n<li>three</li>\n</ul>', blocks: 1 } },
    { text: 'turn this link into html', input: { markdown: 'See [the docs](https://example.com) for more.' }, output: { html: '<p>See <a href="https://example.com">the docs</a> for more.</p>', blocks: 1 } },
    { text: 'convert a numbered list and a quote', input: { markdown: '1. first\n2. second\n\n> a quote' }, output: { html: '<ol>\n<li>first</li>\n<li>second</li>\n</ol>\n<blockquote>a quote</blockquote>', blocks: 2 } },
    { text: 'markdown with inline code to html', input: { markdown: 'Run `npm test` to check.' }, output: { html: '<p>Run <code>npm test</code> to check.</p>', blocks: 1 } }
  ],
  errorCases: [
    { input: {}, code: 'MISSING_FIELD' },
    { input: { markdown: '' }, code: 'MISSING_FIELD' },
    { input: { markdown: 'x'.repeat(200001) }, code: 'INVALID_INPUT' }
  ],
  run (input) {
    const lines = String(input.markdown).split(/\r?\n/);
    const out = [];
    let paragraph = [];
    let list = null;
    let fence = null;
    let quote = [];

    const flushParagraph = () => { if (paragraph.length) { out.push(`<p>${inline(paragraph.join(' '))}</p>`); paragraph = []; } };
    const flushList = () => { if (list) { out.push(`<${list.tag}>\n${list.items.map((i) => `<li>${inline(i)}</li>`).join('\n')}\n</${list.tag}>`); list = null; } };
    const flushQuote = () => { if (quote.length) { out.push(`<blockquote>${inline(quote.join(' '))}</blockquote>`); quote = []; } };
    const flushAll = () => { flushParagraph(); flushList(); flushQuote(); };

    for (const line of lines) {
      if (fence !== null) {
        if (/^\s*```/.test(line)) { out.push(`<pre><code>${escapeHtml(fence.join('\n'))}</code></pre>`); fence = null; }
        else fence.push(line);
        continue;
      }
      if (/^\s*```/.test(line)) { flushAll(); fence = []; continue; }
      if (!line.trim()) { flushAll(); continue; }

      const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
      if (heading) { flushAll(); out.push(`<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`); continue; }
      if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(line)) { flushAll(); out.push('<hr>'); continue; }

      const quoted = /^>\s?(.*)$/.exec(line);
      if (quoted) { flushParagraph(); flushList(); quote.push(quoted[1]); continue; }

      const bullet = /^\s*[-*+]\s+(.+)$/.exec(line);
      const numbered = /^\s*\d+[.)]\s+(.+)$/.exec(line);
      if (bullet || numbered) {
        const tag = bullet ? 'ul' : 'ol';
        flushParagraph(); flushQuote();
        if (list && list.tag !== tag) flushList();
        list ??= { tag, items: [] };
        list.items.push((bullet || numbered)[1]);
        continue;
      }

      flushList(); flushQuote();
      paragraph.push(line.trim());
    }
    if (fence !== null) out.push(`<pre><code>${escapeHtml(fence.join('\n'))}</code></pre>`);
    flushAll();

    return ok({ html: out.join('\n'), blocks: out.length }, computed());
  }
};
