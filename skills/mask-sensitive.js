import { ok, fail, computed } from '../src/contracts.js';
import { findSensitive, DETECTORS } from '../src/lib/pii.js';

export default {
  name: 'maskSensitive',
  description: 'Hide private details in text — emails, phone numbers, cards — behind placeholders.',
  category: 'text', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null,
  labels: ['estimate'],
  replyTemplate: '{{count}} {{count|plural:item:items}} masked:\n{{text}}\nThis is pattern matching — check the result before sharing it, because anything the patterns missed is still in there.',
  inputSchema: {
    type: 'object', required: ['text'],
    properties: {
      text: { type: 'string', label: 'text', minLength: 1, maxLength: 100000, prompt: 'Which text should I redact?' },
      style: { type: 'string', label: 'mask style', enum: ['label', 'stars', 'partial'], default: 'label' },
      kinds: { type: 'array', label: 'kinds to mask', maxItems: 10, items: { type: 'string' }, description: 'limit the masking to these kinds' }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      text: { type: 'string' }, count: { type: 'integer' },
      masked: { type: 'array' }, kinds: { type: 'array', items: { type: 'string' } }
    }
  },
  examples: [
    { text: 'redact the personal data in this', input: { text: 'Contact ana@example.com or call 020 7946 0958.' }, output: { text: 'Contact [EMAIL] or call [PHONE].', count: 2, masked: ['ana@example.com', '020 7946 0958'], kinds: ['email', 'phone'] } },
    { text: 'mask this card number with stars', input: { text: 'Card 4111 1111 1111 1111 on file.', style: 'stars' }, output: { text: 'Card ******************* on file.', count: 1, masked: ['4111 1111 1111 1111'], kinds: ['card'] } },
    { text: 'partially mask the email', input: { text: 'Write to ana@example.com today.', style: 'partial' }, output: { text: 'Write to an***********om today.', count: 1, masked: ['ana@example.com'], kinds: ['email'] } },
    { text: 'nothing to redact here', input: { text: 'A perfectly ordinary sentence.' }, output: { text: 'A perfectly ordinary sentence.', count: 0, masked: [], kinds: [] } },
    { text: 'mask only the phone number', input: { text: 'Call 020 7946 0958 or email bo@example.org.', kinds: ['phone'] }, output: { text: 'Call [PHONE] or email bo@example.org.', count: 1, masked: ['020 7946 0958'], kinds: ['phone'] } },
    { text: 'scrub the email and phone number out of this', input: { text: 'Email bo@example.com or ring 020 7946 0123.' },
      output: { text: 'Email [EMAIL] or ring [PHONE].', count: 2, masked: ['bo@example.com', '020 7946 0123'], kinds: ['email', 'phone'] } },
    { text: 'blank out the personal information here', input: { text: 'Reach ana@example.org for details.' },
      output: { text: 'Reach [EMAIL] for details.', count: 1, masked: ['ana@example.org'], kinds: ['email'] } }
  ],
  errorCases: [
    { input: {}, code: 'MISSING_FIELD' },
    { input: { text: '' }, code: 'MISSING_FIELD' },
    { input: { text: 'hi', kinds: ['vibes'] }, code: 'INVALID_INPUT' }
  ],
  run (input) {
    const known = DETECTORS.map((d) => d.kind);
    for (const k of input.kinds ?? []) {
      if (!known.includes(k)) return fail('INVALID_INPUT', `I have no detector for "${k}" — I look for ${known.join(', ')}.`, 'kinds');
    }

    const found = findSensitive(input.text, input.kinds);
    const style = input.style ?? 'label';
    const replacement = (f) => {
      if (style === 'stars') return '*'.repeat(f.value.length);
      /* Partial keeps the first two and last two characters. Enough to
         recognise a value you already know, not enough to learn one you do not. */
      if (style === 'partial') {
        return f.value.length <= 6
          ? '*'.repeat(f.value.length)
          : f.value.slice(0, 2) + '*'.repeat(f.value.length - 4) + f.value.slice(-2);
      }
      return `[${f.kind.toUpperCase()}]`;
    };

    /* Rebuilt back to front so each replacement cannot shift the offsets of the
       ones not yet applied. */
    let text = String(input.text);
    for (const f of [...found].reverse()) text = text.slice(0, f.start) + replacement(f) + text.slice(f.end);

    return ok({
      text, count: found.length,
      masked: found.map((f) => f.value),
      kinds: [...new Set(found.map((f) => f.kind))]
    }, computed());
  }
};
