import { ok, fail, bundled } from '../src/contracts.js';
import { MIME_TYPES, BY_MIME, MIME_AS_OF } from '../src/lib/mime-types.js';

export default {
  name: 'mimeTypeLookup',
  description: 'Look up the MIME type for a file extension, or which extensions use a MIME type.',
  category: 'developer', tier: 'standard',
  title: 'MIME type lookup',
  unbuilt: false, needsNetwork: false, dataAsOf: MIME_AS_OF, labels: [],
  replyTemplate: '{{query|prose}} is {{mime|prose}} — {{label|prose}}, a {{kind|prose}} file.',
  inputSchema: {
    type: 'object', required: ['query'],
    properties: { query: { type: 'string', label: 'extension or mime type', minLength: 1, prompt: 'Which extension, filename or MIME type?' } }
  },
  outputSchema: { type: 'object', properties: { mime: { type: 'string' }, extension: { type: 'string' }, extensions: { type: 'array', items: { type: 'string' } }, label: { type: 'string' }, kind: { type: 'string' }, query: { type: 'string' }, direction: { type: 'string' }, dataAsOf: { type: 'string' } } },
  examples: [
    { text: 'what mime type is a png', input: { query: 'png' }, output: { mime: 'image/png', extension: 'png', extensions: ['png'], label: 'PNG image', kind: 'image', query: 'png', direction: 'extension to type', dataAsOf: '2026-08-29' } },
    { text: 'mime type for report.pdf', input: { query: 'report.pdf' }, output: { mime: 'application/pdf', extension: 'pdf', extensions: ['pdf'], label: 'PDF document', kind: 'document', query: 'report.pdf', direction: 'extension to type', dataAsOf: '2026-08-29' } },
    { text: 'which extensions use image/jpeg', input: { query: 'image/jpeg' }, output: { mime: 'image/jpeg', extension: 'jpg', extensions: ['jpg', 'jpeg'], label: 'JPEG image', kind: 'image', query: 'image/jpeg', direction: 'type to extension', dataAsOf: '2026-08-29' } },
    { text: 'what is a .woff2 file', input: { query: '.woff2' }, output: { mime: 'font/woff2', extension: 'woff2', extensions: ['woff2'], label: 'Web font', kind: 'font', query: '.woff2', direction: 'extension to type', dataAsOf: '2026-08-29' } },
    { text: 'mime type for a gguf model file', input: { query: 'gguf' }, output: { mime: 'application/octet-stream', extension: 'gguf', extensions: ['gguf'], label: 'Model weights', kind: 'binary', query: 'gguf', direction: 'extension to type', dataAsOf: '2026-08-29' } }
  ],
  errorCases: [
    { input: { query: 'xyzzy' }, code: 'INVALID_INPUT' },
    { input: { query: 'application/nonsense' }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' }
  ],
  run (input) {
    const raw = String(input.query).trim().toLowerCase();

    if (raw.includes('/')) {
      const exts = BY_MIME[raw];
      if (!exts) return fail('INVALID_INPUT', `"${input.query}" isn't a MIME type in the bundled table.`, 'query');
      const info = MIME_TYPES[exts[0]];
      return ok({
        mime: raw, extension: exts[0], extensions: exts,
        label: info.label, kind: info.kind, query: input.query,
        direction: 'type to extension', dataAsOf: MIME_AS_OF
      }, bundled(MIME_AS_OF));
    }

    /* A whole filename works, not just a bare extension — that is what people
       paste. The LAST dot wins, so "archive.tar.gz" is a gzip. */
    const ext = raw.includes('.') ? raw.slice(raw.lastIndexOf('.') + 1) : raw;
    const info = MIME_TYPES[ext];
    if (!info) return fail('INVALID_INPUT', `"${ext}" isn't an extension in the bundled table.`, 'query');
    return ok({
      mime: info.mime, extension: ext, extensions: BY_MIME[info.mime],
      label: info.label, kind: info.kind, query: input.query,
      direction: 'extension to type', dataAsOf: MIME_AS_OF
    }, bundled(MIME_AS_OF));
  }
};
