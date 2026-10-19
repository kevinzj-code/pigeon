import { ok, fail, computed } from '../src/contracts.js';

/* The formatting RULES are bundled; the FACTS are all supplied. Nothing here
   looks up a paper, invents a publisher or guesses a year — every field in the
   output came from the input, which is what makes a citation from this skill
   checkable rather than plausible. That distinction matters more here than
   almost anywhere else in the registry: a fabricated citation is the single
   most-cited example of what language models get wrong. */

const surnameFirst = (name) => {
  const parts = String(name).trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  const last = parts.pop();
  return `${last}, ${parts.map(p => `${p[0].toUpperCase()}.`).join(' ')}`;
};

/* An initial already ends in a full stop, so appending the separator's own
   period produces "Ruiz, A.." — right in every APA example, wrong in every MLA
   and Chicago one, because only those put the period straight after the name. */
const dot = (s) => (s.endsWith('.') ? s : `${s}.`);

const joinAuthors = (authors, style) => {
  if (style === 'MLA') {
    if (authors.length === 1) return surnameFirst(authors[0]);
    if (authors.length === 2) return `${surnameFirst(authors[0])}, and ${authors[1]}`;
    return `${surnameFirst(authors[0])}, et al.`;
  }
  if (style === 'Chicago') {
    if (authors.length === 1) return surnameFirst(authors[0]);
    return `${surnameFirst(authors[0])}, and ${authors.slice(1).join(', and ')}`;
  }
  // APA
  const formatted = authors.map(surnameFirst);
  if (formatted.length === 1) return formatted[0];
  if (formatted.length === 2) return `${formatted[0]}, & ${formatted[1]}`;
  return `${formatted.slice(0, -1).join(', ')}, & ${formatted[formatted.length - 1]}`;
};

export default {
  name: 'formatCitation',
  description: 'Assemble a reference in APA, MLA or Chicago style from details you provide.',
  category: 'writing',
  tier: 'core',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{citation}}',
  inputSchema: {
    type: 'object',
    required: ['authors', 'title', 'year'],
    properties: {
      authors: { type: 'array', label: 'authors', items: { type: 'string' }, minItems: 1, prompt: 'Who are the authors?' },
      title: { type: 'string', label: 'title', minLength: 1, prompt: 'What is the title?' },
      year: { type: 'integer', label: 'year', prompt: 'What year was it published?' },
      style: { type: 'string', label: 'style', enum: ['APA', 'MLA', 'Chicago'], default: 'APA' },
      container: { type: 'string', label: 'journal, book or site', description: 'the journal, book or site it appeared in' },
      publisher: { type: 'string', label: 'publisher' },
      volume: { type: 'string', label: 'volume' },
      pages: { type: 'string', label: 'pages' },
      url: { type: 'string', label: 'url' }
    }
  },
  outputSchema: {
    type: 'object',
    properties: { citation: { type: 'string' }, style: { type: 'string' }, authorCount: { type: 'integer' } }
  },
  examples: [
    { text: 'format this as an APA reference', input: { authors: ['Jane Smith'], title: 'On measurement', year: 2024, container: 'Journal of Things', volume: '12', pages: '3-19' },
      output: { citation: 'Smith, J. (2024). On measurement. Journal of Things, 12, 3-19.', style: 'APA', authorCount: 1 } },
    { text: 'make an MLA citation for this book', input: { authors: ['Ana Ruiz'], title: 'The Long Road', year: 2021, publisher: 'Northgate Press', style: 'MLA' },
      output: { citation: 'Ruiz, A. The Long Road. Northgate Press, 2021.', style: 'MLA', authorCount: 1 } },
    { text: 'APA reference with two authors', input: { authors: ['Jane Smith', 'Bo Chen'], title: 'A second look', year: 2023, container: 'Review Quarterly' },
      output: { citation: 'Smith, J., & Chen, B. (2023). A second look. Review Quarterly.', style: 'APA', authorCount: 2 } },
    { text: 'chicago style citation for a book', input: { authors: ['Kofi Mensah'], title: 'Field Notes', year: 2019, publisher: 'Harbour Books', style: 'Chicago' },
      output: { citation: 'Mensah, K. Field Notes. Harbour Books, 2019.', style: 'Chicago', authorCount: 1 } },
    { text: 'APA citation with a url', input: { authors: ['Lee Park'], title: 'Open data practices', year: 2025, container: 'Data Review', url: 'https://example.org/od' },
      output: { citation: 'Park, L. (2025). Open data practices. Data Review. https://example.org/od', style: 'APA', authorCount: 1 } }
  ],
  errorCases: [
    { input: { authors: [], title: 'x', year: 2020 }, code: 'INVALID_INPUT' },
    { input: { authors: ['A B'], title: 'x' }, code: 'MISSING_FIELD' },
    { input: { authors: ['A B'], title: 'x', year: 2020, style: 'Harvard' }, code: 'INVALID_INPUT' }
  ],
  run (input) {
    if (!input.authors.length) return fail('INVALID_INPUT', 'A citation needs at least one author.', 'authors');
    const who = joinAuthors(input.authors, input.style);
    const bits = [];

    if (input.style === 'APA') {
      bits.push(`${who} (${input.year}). ${input.title}.`);
      if (input.container) {
        let c = input.container;
        if (input.volume) c += `, ${input.volume}`;
        if (input.pages) c += `, ${input.pages}`;
        bits.push(`${c}.`);
      }
      if (input.publisher) bits.push(`${input.publisher}.`);
    } else {
      bits.push(`${dot(who)} ${input.title}.`);
      if (input.container) bits.push(`${input.container}${input.volume ? ` ${input.volume}` : ''},`);
      if (input.publisher) bits.push(`${input.publisher},`);
      bits.push(`${input.year}${input.pages ? `, ${input.pages}` : ''}.`);
    }
    if (input.url) bits.push(input.url);

    return ok({
      citation: bits.join(' ').replace(/\s+/g, ' ').trim(),
      style: input.style, authorCount: input.authors.length
    }, computed());
  }
};
