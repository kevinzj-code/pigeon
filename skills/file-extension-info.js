import { ok, fail, bundled } from '../src/contracts.js';
import { MIME_TYPES, MIME_AS_OF, BY_MIME } from '../src/lib/mime-types.js';

export default {
  name: 'fileExtensionInfo',
  description: 'Say what kind of file an extension is and which media type it uses.',
  category: 'files', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: MIME_AS_OF, labels: [],
  replyTemplate: '{{extension}} is {{label}} — media type {{mime}}, {{kind}}.',
  inputSchema: {
    type: 'object', required: ['query'],
    properties: { query: { type: 'string', label: 'extension or filename', minLength: 1, prompt: 'Which file extension or filename?' } }
  },
  outputSchema: {
    type: 'object',
    properties: {
      extension: { type: 'string' }, mime: { type: 'string' }, label: { type: 'string' },
      kind: { type: 'string' }, alsoUsedBy: { type: 'array', items: { type: 'string' } },
      dataAsOf: { type: 'string' }
    }
  },
  examples: [
    { text: 'what kind of file is .csv', input: { query: '.csv' }, output: { extension: 'csv', mime: 'text/csv', label: 'Comma-separated values', kind: 'text', alsoUsedBy: [], dataAsOf: '2026-08-29' } },
    { text: 'what is a json file', input: { query: 'json' }, output: { extension: 'json', mime: 'application/json', label: 'JSON data', kind: 'text', alsoUsedBy: [], dataAsOf: '2026-08-29' } },
    { text: 'file type for report.md', input: { query: 'report.md' }, output: { extension: 'md', mime: 'text/markdown', label: 'Markdown', kind: 'text', alsoUsedBy: [], dataAsOf: '2026-08-29' } },
    { text: 'what does the yml extension mean', input: { query: 'yml' }, output: { extension: 'yml', mime: 'application/yaml', label: 'YAML', kind: 'text', alsoUsedBy: ['yaml'], dataAsOf: '2026-08-29' } },
    { text: 'is html a text file', input: { query: 'HTML' }, output: { extension: 'html', mime: 'text/html', label: 'Web page', kind: 'text', alsoUsedBy: ['htm'], dataAsOf: '2026-08-29' } }
  ],
  errorCases: [
    { input: { query: '.qqq' }, code: 'INVALID_INPUT' },
    { input: { query: 'noextension' }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' }
  ],
  run (input) {
    const q = String(input.query).trim().toLowerCase();
    /* Accepts a bare extension, a dotted one, or a whole filename — people ask
       all three ways and the last segment after a dot is the answer in each. */
    const ext = q.includes('.') ? q.slice(q.lastIndexOf('.') + 1) : q;
    const info = MIME_TYPES[ext];
    if (!info) {
      return fail('INVALID_INPUT', `"${ext}" is not in the bundled extension table.`, 'query');
    }
    return ok({
      extension: ext, mime: info.mime, label: info.label, kind: info.kind,
      alsoUsedBy: (BY_MIME[info.mime] || []).filter((e) => e !== ext),
      dataAsOf: MIME_AS_OF
    }, bundled(MIME_AS_OF));
  }
};
