import { ok, computed } from '../src/contracts.js';

/* Characters that NFD cannot decompose — they are distinct letters, not
   accented forms, so the Unicode normaliser leaves them alone and a
   transliteration has to name them explicitly. */
const SPECIAL = {
  æ: 'ae', Æ: 'AE', œ: 'oe', Œ: 'OE', ø: 'o', Ø: 'O', ß: 'ss',
  đ: 'd', Đ: 'D', ð: 'd', Ð: 'D', þ: 'th', Þ: 'Th', ł: 'l', Ł: 'L',
  '’': "'", '‘': "'", '“': '"', '”': '"', '–': '-', '—': '-', '…': '...', '€': 'EUR', '£': 'GBP'
};

export default {
  name: 'toAscii',
  description: 'Strip accents and convert a text to plain ASCII.',
  category: 'text', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  title: 'Convert to ASCII',
  replyTemplate: '{{result|prose}}',
  inputSchema: {
    type: 'object', required: ['text'],
    properties: {
      text: { type: 'string', label: 'text', minLength: 1, prompt: 'Which text should I convert?' },
      dropUnknown: { type: 'boolean', label: 'drop unconvertible', default: true, description: 'remove characters with no ASCII equivalent' }
    }
  },
  outputSchema: { type: 'object', properties: { result: { type: 'string' }, changed: { type: 'boolean' }, dropped: { type: 'integer' }, alreadyAscii: { type: 'boolean' } } },
  examples: [
    { text: 'convert café to ascii', input: { text: 'café' }, output: { result: 'cafe', changed: true, dropped: 0, alreadyAscii: false } },
    { text: 'strip the accents from Münster Straße', input: { text: 'Münster Straße' }, output: { result: 'Munster Strasse', changed: true, dropped: 0, alreadyAscii: false } },
    { text: 'make this ascii safe', input: { text: 'naïve résumé' }, output: { result: 'naive resume', changed: true, dropped: 0, alreadyAscii: false } },
    { text: 'convert smart quotes to plain ones', input: { text: '“hello” — it’s fine' }, output: { result: '"hello" - it\'s fine', changed: true, dropped: 0, alreadyAscii: false } },
    { text: 'convert text that is already ascii', input: { text: 'plain text' }, output: { result: 'plain text', changed: false, dropped: 0, alreadyAscii: true } }
  ],
  errorCases: [
    { input: {}, code: 'MISSING_FIELD' },
    { input: { text: '' }, code: 'MISSING_FIELD' },
    { input: { text: ['a'] }, code: 'INVALID_INPUT' }
  ],
  run (input) {
    const alreadyAscii = /^[\x20-\x7E\n\r\t]*$/.test(input.text);
    let s = [...input.text].map(c => SPECIAL[c] ?? c).join('');
    /* NFD splits an accented letter into base + combining mark; removing the
       marks leaves the base letter. Dropping non-ASCII outright would give
       "Mnster" instead of "Munster". */
    s = s.normalize('NFD').replace(/[̀-ͯ]/g, '');
    let dropped = 0;
    if (input.dropUnknown) {
      s = [...s].filter(c => {
        const keep = /[\x20-\x7E\n\r\t]/.test(c);
        if (!keep) dropped++;
        return keep;
      }).join('');
    }
    return ok({ result: s, changed: s !== input.text, dropped, alreadyAscii }, computed());
  }
};
