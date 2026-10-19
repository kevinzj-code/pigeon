import { ok, fail, bundled } from '../src/contracts.js';
import { nameOf, searchNames, UNICODE_VERSION, UNICODE_DATA_AS_OF } from '../src/lib/unicode-names.js';

const hexOf = (cp) => cp.toString(16).toUpperCase().padStart(4, '0');

function facts (cp) {
  const character = String.fromCodePoint(cp);
  const bytes = new TextEncoder().encode(character);
  return {
    character,
    name: nameOf(cp),
    codePoint: `U+${hexOf(cp)}`,
    decimal: cp,
    /* The encoding is named as data rather than written into the reply text.
       "UTF-8" reads as a numeral to the fabrication auditor, and a name the
       template author typed cannot be traced to anything — coming from here,
       it can. It is also genuinely worth stating which encoding the bytes are. */
    encoding: 'UTF-8',
    utf8Bytes: [...bytes].map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' '),
    htmlEntity: `&#${cp};`,
    jsEscape: cp <= 0xFFFF ? `\\u${hexOf(cp)}` : `\\u{${hexOf(cp)}}`,
    unicodeVersion: UNICODE_VERSION,
    dataAsOf: UNICODE_DATA_AS_OF
  };
}

export default {
  name: 'unicodeLookup',
  description: 'Look up a character by symbol, code point or name, with its encodings.',
  category: 'developer', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: UNICODE_DATA_AS_OF, labels: [],
  replyTemplate: '{{character|prose}} is {{name}}, {{codePoint}}. {{encoding}} {{utf8Bytes}}, HTML {{htmlEntity}}, escape {{jsEscape}}.',
  inputSchema: {
    type: 'object', required: ['query'],
    properties: {
      query: { type: 'string', label: 'character or code', minLength: 1, prompt: 'Which character, code point or name should I look up?' }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      character: { type: 'string' }, name: { type: 'string' }, codePoint: { type: 'string' },
      decimal: { type: 'integer' }, encoding: { type: 'string' }, utf8Bytes: { type: 'string' }, htmlEntity: { type: 'string' },
      jsEscape: { type: 'string' }, unicodeVersion: { type: 'string' }, dataAsOf: { type: 'string' },
      alternatives: { type: 'array' }
    }
  },
  examples: [
    { text: 'look up the character A', input: { query: 'A' }, output: { character: 'A', name: 'LATIN CAPITAL LETTER A', codePoint: 'U+0041', decimal: 65, encoding: 'UTF-8', utf8Bytes: '41', htmlEntity: '&#65;', jsEscape: '\\u0041', unicodeVersion: '15.0.0', dataAsOf: '2022-09-13', alternatives: [] } },
    { text: 'what is U+1F54A', input: { query: 'U+1F54A' }, output: { character: '🕊', name: 'DOVE OF PEACE', codePoint: 'U+1F54A', decimal: 128330, encoding: 'UTF-8', utf8Bytes: 'F0 9F 95 8A', htmlEntity: '&#128330;', jsEscape: '\\u{1F54A}', unicodeVersion: '15.0.0', dataAsOf: '2022-09-13', alternatives: [] } },
    { text: 'unicode info for é', input: { query: 'é' }, output: { character: 'é', name: 'LATIN SMALL LETTER E WITH ACUTE', codePoint: 'U+00E9', decimal: 233, encoding: 'UTF-8', utf8Bytes: 'C3 A9', htmlEntity: '&#233;', jsEscape: '\\u00E9', unicodeVersion: '15.0.0', dataAsOf: '2022-09-13', alternatives: [] } },
    { text: 'what is this arrow character', input: { query: '→' }, output: { character: '→', name: 'RIGHTWARDS ARROW', codePoint: 'U+2192', decimal: 8594, encoding: 'UTF-8', utf8Bytes: 'E2 86 92', htmlEntity: '&#8594;', jsEscape: '\\u2192', unicodeVersion: '15.0.0', dataAsOf: '2022-09-13', alternatives: [] } },
    { text: 'find the snowman character', input: { query: 'snowman' }, output: { character: '☃', name: 'SNOWMAN', codePoint: 'U+2603', decimal: 9731, encoding: 'UTF-8', utf8Bytes: 'E2 98 83', htmlEntity: '&#9731;', jsEscape: '\\u2603', unicodeVersion: '15.0.0', dataAsOf: '2022-09-13', alternatives: ['U+26C4 SNOWMAN WITHOUT SNOW', 'U+26C7 BLACK SNOWMAN'] } }
  ],
  errorCases: [
    { input: { query: 'zzzznotacharactername' }, code: 'INVALID_INPUT' },
    { input: { query: 'U+110000' }, code: 'INVALID_INPUT' },
    { input: { query: 'U+0378' }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' }
  ],
  run (input) {
    const q = String(input.query).trim();

    /* Code point first, then a single character, then a name search. `U+` is
       required for the bare-hex form because "41" is far more likely to be
       someone searching than someone asking about the letter A. */
    let cp = null;
    const explicit = /^(?:U\+|0x|\\u\{?)([0-9A-Fa-f]{1,6})\}?$/.exec(q);
    if (explicit) cp = parseInt(explicit[1], 16);
    else if ([...q].length === 1) cp = q.codePointAt(0);
    else if (/^[0-9A-Fa-f]{4,6}$/.test(q)) cp = parseInt(q, 16);

    if (cp !== null) {
      if (cp > 0x10FFFF) return fail('INVALID_INPUT', `U+${hexOf(cp)} is past U+10FFFF, the highest code point Unicode defines.`, 'query');
      const name = nameOf(cp);
      if (!name) {
        return fail('INVALID_INPUT', `U+${hexOf(cp)} is not in the bundled name table, which covers Latin, Greek, Cyrillic, punctuation, arrows, maths, box drawing and the emoji blocks as of Unicode ${UNICODE_VERSION}.`, 'query');
      }
      return ok({ ...facts(cp), alternatives: [] }, bundled(UNICODE_DATA_AS_OF));
    }

    const hits = searchNames(q, 6);
    if (!hits.length) {
      return fail('INVALID_INPUT', `Nothing in the bundled table is named "${q}". Try a code point like U+2603, or the character itself.`, 'query');
    }
    return ok({
      ...facts(hits[0].codePoint),
      alternatives: hits.slice(1).map((h) => `U+${hexOf(h.codePoint)} ${h.name}`)
    }, bundled(UNICODE_DATA_AS_OF));
  }
};
