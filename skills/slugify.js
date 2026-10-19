import { ok, fail, computed } from '../src/contracts.js';

export default {
  name: 'slugify',
  description: 'Turn a title into a URL-safe slug — lowercase, hyphens, no accents or punctuation.',
  category: 'text',
  tier: 'core',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{slug}}',
  inputSchema: {
    type: 'object',
    required: ['text'],
    properties: {
      text: { type: 'string', label: 'text', minLength: 1, prompt: 'What should I turn into a slug?' },
      separator: { type: 'string', label: 'separator', enum: ['-', '_'], default: '-' },
      maxLength: { type: 'integer', label: 'max length', minimum: 1, maximum: 200 }
    }
  },
  outputSchema: { type: 'object', properties: { slug: { type: 'string' }, original: { type: 'string' }, truncated: { type: 'boolean' } } },
  examples: [
    { text: 'make a slug from "Hello, World! A Beginner\'s Guide"', input: { text: "Hello, World! A Beginner's Guide" },
      output: { slug: 'hello-world-a-beginners-guide', original: "Hello, World! A Beginner's Guide", truncated: false } },
    { text: 'url slug for "Café Münster — Opening Times"', input: { text: 'Café Münster — Opening Times' },
      output: { slug: 'cafe-munster-opening-times', original: 'Café Münster — Opening Times', truncated: false } },
    { text: 'slugify with underscores: My Blog Post', input: { text: 'My Blog Post', separator: '_' },
      output: { slug: 'my_blog_post', original: 'My Blog Post', truncated: false } },
    { text: 'short slug, max 12 chars, from "The Complete Guide To Everything"', input: { text: 'The Complete Guide To Everything', maxLength: 12 },
      output: { slug: 'the-complete', original: 'The Complete Guide To Everything', truncated: true } },
    { text: 'slug for "  spaced   out   title  "', input: { text: '  spaced   out   title  ' },
      output: { slug: 'spaced-out-title', original: '  spaced   out   title  ', truncated: false } }
  ],
  errorCases: [
    { input: { text: '!!!???' }, code: 'INVALID_INPUT' },
    { input: { text: 'hello', separator: '+' }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' }
  ],
  run (input) {
    const sep = input.separator;
    /* NFD then strip the combining marks: "Münster" → "Munster" rather than
       "Mnster", which is what dropping non-ASCII outright would give. */
    let slug = input.text
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[''’`]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, sep)
      .replace(new RegExp(`\\${sep}+`, 'g'), sep)
      .replace(new RegExp(`^\\${sep}|\\${sep}$`, 'g'), '');

    if (!slug) return fail('INVALID_INPUT', 'There are no letters or numbers in that to make a slug from.', 'text');

    let truncated = false;
    if (input.maxLength && slug.length > input.maxLength) {
      /* Cut at a word boundary so the slug never ends mid-word — but only trim
         back when the cut ACTUALLY lands mid-word. Trimming unconditionally
         threw away a whole word every time the limit happened to fall exactly
         on a separator ("the-complete" → "the"). */
      let cut = slug.slice(0, input.maxLength);
      const landsMidWord = slug[input.maxLength] !== sep && !cut.endsWith(sep);
      if (landsMidWord && cut.includes(sep)) cut = cut.slice(0, cut.lastIndexOf(sep));
      slug = cut.replace(new RegExp(`\\${sep}$`), '');
      truncated = true;
    }
    return ok({ slug, original: input.text, truncated }, computed());
  }
};
