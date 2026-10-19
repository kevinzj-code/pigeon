import { ok, computed } from '../src/contracts.js';

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const UNESCAPES = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", nbsp: ' ' };

export default {
  name: 'escapeHtml',
  description: 'Make text safe to drop into HTML, turning angle brackets and ampersands into entities — or turn escaped ones back.',
  category: 'text', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  title: 'Escape HTML',
  replyTemplate: '{{result|prose}}',
  inputSchema: {
    type: 'object', required: ['text'],
    properties: {
      text: { type: 'string', label: 'text', minLength: 1, prompt: 'Which text?' },
      direction: { type: 'string', label: 'escape or unescape', enum: ['escape', 'unescape'], default: 'escape' }
    }
  },
  outputSchema: { type: 'object', properties: { result: { type: 'string' }, changed: { type: 'integer' }, direction: { type: 'string' } } },
  examples: [
    { text: 'escape this html: <b>bold</b>', input: { text: '<b>bold</b>' }, output: { result: '&lt;b&gt;bold&lt;/b&gt;', changed: 4, direction: 'escape' } },
    { text: 'escape an ampersand', input: { text: 'Tom & Jerry' }, output: { result: 'Tom &amp; Jerry', changed: 1, direction: 'escape' } },
    { text: 'unescape &lt;p&gt;hi&lt;/p&gt;', input: { text: '&lt;p&gt;hi&lt;/p&gt;', direction: 'unescape' }, output: { result: '<p>hi</p>', changed: 4, direction: 'unescape' } },
    { text: 'escape a quoted attribute', input: { text: 'say "hello"' }, output: { result: 'say &quot;hello&quot;', changed: 2, direction: 'escape' } },
    { text: 'escape text with nothing special in it', input: { text: 'plain text' }, output: { result: 'plain text', changed: 0, direction: 'escape' } },
    { text: 'make these angle brackets safe for a web page', input: { text: '<div>a & b</div>' },
      output: { result: '&lt;div&gt;a &amp; b&lt;/div&gt;', changed: 5, direction: 'escape' } },
    { text: 'encode the special characters so html shows them literally', input: { text: '1 < 2 && 3 > 2' },
      output: { result: '1 &lt; 2 &amp;&amp; 3 &gt; 2', changed: 4, direction: 'escape' } }
  ],
  errorCases: [
    { input: {}, code: 'MISSING_FIELD' },
    { input: { text: '' }, code: 'MISSING_FIELD' },
    { input: { text: 'a', direction: 'sideways' }, code: 'INVALID_INPUT' }
  ],
  run (input) {
    let changed = 0;
    let result;
    if (input.direction === 'escape') {
      /* & first, and only once — escaping it after the others would turn the
         & in &lt; into &amp;lt; and double-escape the whole string. Doing it
         in one pass over the original avoids that entirely. */
      result = input.text.replace(/[&<>"']/g, (c) => { changed++; return ESCAPES[c]; });
    } else {
      result = input.text.replace(/&(#?\w+);/g, (whole, name) => {
        const v = UNESCAPES[name];
        if (v === undefined) return whole;
        changed++;
        return v;
      });
    }
    return ok({ result, changed, direction: input.direction }, computed());
  }
};
