import { ok, fail, computed } from '../src/contracts.js';

/* Scan for the classic catastrophic shape: a group that is itself repeated
   without bound, whose body also repeats without bound — (a+)+, (\w*)*, (x+){2,}.
   On a near-miss those take exponential time, and JavaScript has no way to
   interrupt a running regex, so the webview would simply stop responding.
   This is a heuristic and says so: it catches the common footgun, not every
   pathological pattern. Rejecting a pattern that would have hung is worth the
   occasional false alarm on one that would not have. */
function repeatedRepeat (pattern) {
  const unbounded = (s) => {
    let i = 0; let cls = false;
    while (i < s.length) {
      const c = s[i];
      if (c === '\\') { i += 2; continue; }
      if (cls) { if (c === ']') cls = false; i++; continue; }
      if (c === '[') { cls = true; i++; continue; }
      if (c === '*' || c === '+') return true;
      if (c === '{' && /^\{\d+,\}/.test(s.slice(i))) return true;
      i++;
    }
    return false;
  };

  const open = [];
  const groups = [];
  let i = 0; let cls = false;
  while (i < pattern.length) {
    const c = pattern[i];
    if (c === '\\') { i += 2; continue; }
    if (cls) { if (c === ']') cls = false; i++; continue; }
    if (c === '[') { cls = true; i++; continue; }
    if (c === '(') open.push(i);
    else if (c === ')') { const s = open.pop(); if (s !== undefined) groups.push([s, i]); }
    i++;
  }

  for (const [start, end] of groups) {
    const q = /^([*+]|\{\d+,\})/.exec(pattern.slice(end + 1));
    if (!q) continue;
    if (unbounded(pattern.slice(start + 1, end))) return pattern.slice(start, end + 1 + q[0].length);
  }
  return null;
}

export default {
  name: 'testRegex',
  description: 'Run a regex pattern over sample text and show every hit it makes.',
  category: 'developer', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{matchCount}} {{matchCount|plural:match:matches}} for {{pattern|prose}}.\n{{summary|lines}}',
  inputSchema: {
    type: 'object', required: ['pattern', 'text'],
    properties: {
      pattern: { type: 'string', label: 'pattern', minLength: 1, maxLength: 500, prompt: 'Which regular expression should I test?' },
      text: { type: 'string', label: 'text', minLength: 1, maxLength: 20000, prompt: 'Which text should I test it against?' },
      flags: { type: 'string', label: 'flags', maxLength: 8, default: 'g' }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      matches: { type: 'array' }, summary: { type: 'array', items: { type: 'string' } },
      matchCount: { type: 'integer' }, pattern: { type: 'string' }, flags: { type: 'string' }
    }
  },
  examples: [
    { text: 'test this regex against my text', input: { pattern: '\\d+', text: 'a1 b22 c333' }, output: { matches: [{ match: '1', index: 1, groups: [] }, { match: '22', index: 4, groups: [] }, { match: '333', index: 8, groups: [] }], summary: ['"1" at 1', '"22" at 4', '"333" at 8'], matchCount: 3, pattern: '\\d+', flags: 'g' } },
    { text: 'what does this pattern capture', input: { pattern: '(\\w+)@(\\w+)', text: 'ana@example bo@test' }, output: { matches: [{ match: 'ana@example', index: 0, groups: ['ana', 'example'] }, { match: 'bo@test', index: 12, groups: ['bo', 'test'] }], summary: ['"ana@example" at 0', '"bo@test" at 12'], matchCount: 2, pattern: '(\\w+)@(\\w+)', flags: 'g' } },
    { text: 'check a regex that finds nothing', input: { pattern: 'z+', text: 'abc' }, output: { matches: [], summary: [], matchCount: 0, pattern: 'z+', flags: 'g' } },
    { text: 'test a case insensitive pattern', input: { pattern: 'cat', text: 'Cat CAT cat', flags: 'gi' }, output: { matches: [{ match: 'Cat', index: 0, groups: [] }, { match: 'CAT', index: 4, groups: [] }, { match: 'cat', index: 8, groups: [] }], summary: ['"Cat" at 0', '"CAT" at 4', '"cat" at 8'], matchCount: 3, pattern: 'cat', flags: 'gi' } },
    { text: 'try a regex with a repeat count', input: { pattern: '[a-z]{2,3}', text: 'ab cde f' }, output: { matches: [{ match: 'ab', index: 0, groups: [] }, { match: 'cde', index: 3, groups: [] }], summary: ['"ab" at 0', '"cde" at 3'], matchCount: 2, pattern: '[a-z]{2,3}', flags: 'g' } },
    { text: 'try this regex on my text and list what it catches', input: { pattern: '[a-z]+@[a-z]+\\.com', text: 'mail ana@example.com or bo@test.com' },
      output: { matches: [{ match: 'ana@example.com', index: 5, groups: [] }, { match: 'bo@test.com', index: 24, groups: [] }], summary: ['"ana@example.com" at 5', '"bo@test.com" at 24'], matchCount: 2, pattern: '[a-z]+@[a-z]+\\.com', flags: 'g' } },
    { text: 'which parts of this text does the regex match', input: { pattern: '\\d{4}', text: 'in 2024 and again in 2026' },
      output: { matches: [{ match: '2024', index: 3, groups: [] }, { match: '2026', index: 21, groups: [] }], summary: ['"2024" at 3', '"2026" at 21'], matchCount: 2, pattern: '\\d{4}', flags: 'g' } }
  ],
  errorCases: [
    { input: { pattern: '(', text: 'abc' }, code: 'INVALID_INPUT' },
    { input: { pattern: '(a+)+b', text: 'aaaaaaaaaaaaaaaaaaaaaaaaaaa!' }, code: 'INVALID_INPUT' },
    { input: { pattern: 'a', text: 'abc', flags: 'zz' }, code: 'INVALID_INPUT' },
    { input: { text: 'abc' }, code: 'MISSING_FIELD' }
  ],
  run (input) {
    const flags = input.flags ?? 'g';
    const bad = /[^dgimsuvy]/.exec(flags);
    if (bad) return fail('INVALID_INPUT', `"${bad[0]}" is not a regular expression flag.`, 'flags');
    if (new Set(flags).size !== flags.length) return fail('INVALID_INPUT', 'That flag list repeats itself.', 'flags');

    const risky = repeatedRepeat(input.pattern);
    if (risky) {
      return fail('INVALID_INPUT', `"${risky}" repeats a group that already repeats. On text that nearly matches, that takes longer to test than anyone will wait, so I will not run it.`, 'pattern');
    }

    let re;
    try { re = new RegExp(input.pattern, flags.includes('g') ? flags : `${flags}g`); }
    catch (e) { return fail('INVALID_INPUT', `That is not a valid regular expression — ${e.message.replace(/^Invalid regular expression: [^:]*: /, '')}.`, 'pattern'); }

    const matches = [];
    for (const m of input.text.matchAll(re)) {
      matches.push({ match: m[0], index: m.index, groups: m.slice(1).map((g) => g ?? null) });
      /* A zero-length match never advances lastIndex, so `matchAll` on a
         pattern like `a*` would sit on the same position forever. */
      if (m[0] === '' && matches.length > input.text.length) break;
    }

    return ok({
      matches, summary: matches.map((m) => `"${m.match}" at ${m.index}`),
      matchCount: matches.length, pattern: input.pattern, flags
    }, computed());
  }
};
