import { ok, fail } from '../src/contracts.js';
import { allWords, WORDS_AS_OF } from '../src/lib/words.js';

/* Which words are still possible, given what the grid has told you.
 *
 * The three colours mean three different things and only one of them is simple:
 *
 *   GREEN  this letter, in this exact position.
 *   YELLOW this letter is in the word, but NOT in the position you tried it.
 *   GREY   this letter is not in the word at all.
 *
 * The trap is grey. If you guess a word with two Es and the answer has one, the
 * first E comes back yellow and the second grey — so "grey means absent" is
 * false for any letter that also appears green or yellow. Filtering on it
 * naively throws away the right answer, which is the one mistake a solver
 * cannot afford. Grey is therefore applied only to letters that appear nowhere
 * else in the constraints.
 *
 * The word list ships with the app, so this shows its date: a wordlist is
 * bundled data, and §3.3 says bundled data carries the day it was true.
 */
export default {
  name: 'wordleFilter',
  description: 'Narrow a word list down from green, yellow and grey letter clues.',
  category: 'games',
  tier: 'extended',
  unbuilt: false,
  needsNetwork: false,
  dataAsOf: WORDS_AS_OF,
  labels: [],
  replyTemplate: '{{count}} words still fit: {{shown}}{{more|prose}}.',
  inputSchema: {
    type: 'object',
    required: ['pattern'],
    properties: {
      pattern: {
        type: 'string', label: 'green letters', minLength: 1, maxLength: 12,
        prompt: 'What are the green letters? Use a dot for each unknown, like c..k.'
      },
      present: { type: 'string', label: 'yellow letters', maxLength: 26, default: '' },
      absent: { type: 'string', label: 'grey letters', maxLength: 26, default: '' },
      limit: { type: 'integer', label: 'max words shown', minimum: 1, maximum: 50, default: 12 }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      count: { type: 'integer' },
      shown: { type: 'array', items: { type: 'string' } },
      more: { type: 'string' },
      length: { type: 'integer' },
      dataAsOf: { type: 'string' }
    }
  },
  examples: [
    { text: "wordle: green c at the start, k in the middle", input: {"pattern":"c..k."},
      output: {"count":9,"shown":["calks","casks","choke","cocks","cocky","conks","cooks","cooky","corks"],"more":"","length":5,"dataAsOf":"2026-09-01"} },
    { text: "five letters starting cr, no e", input: {"pattern":"cr...","absent":"e"},
      output: {"count":35,"shown":["crabs","crack","craft","crags","cramp","crams","crank","craps","crash","crass","crawl","craws"],"more":", and 23 more","length":5,"dataAsOf":"2026-09-01"} },
    { text: "pattern .a.e. with an r somewhere", input: {"pattern":".a.e.","present":"r"},
      output: {"count":80,"shown":["baker","bared","barer","bares","baser","caper","cared","cares","caret","cater","dared","dares"],"more":", and 68 more","length":5,"dataAsOf":"2026-09-01"} },
    { text: "what fits s..re with no t or n", input: {"pattern":"s..re","absent":"tn"},
      output: {"count":10,"shown":["sabre","scare","score","share","shire","shore","spare","spire","spore","swore"],"more":"","length":5,"dataAsOf":"2026-09-01"} },
    { text: "four letters, ends in ing", input: {"pattern":".ing"},
      output: {"count":9,"shown":["ding","hing","king","ping","ring","sing","ting","wing","zing"],"more":"","length":4,"dataAsOf":"2026-09-01"} },
    { text: "green s_a_e, yellow t, grey ru", input: {"pattern":"s.a.e","present":"t","absent":"ru"},
      output: {"count":8,"shown":["skate","slate","spate","stage","stake","stale","state","stave"],"more":"","length":5,"dataAsOf":"2026-09-01"} }
  ],
  errorCases: [
    { input: {}, code: 'MISSING_FIELD' },
    { input: { pattern: 'c..k.', present: '123' }, code: 'INVALID_INPUT' },
    { input: { pattern: 'zz.zz' }, code: 'INVALID_INPUT' }
  ],
  run (input) {
    const pattern = String(input.pattern).toLowerCase().replace(/[_*?]/g, '.');
    if (!/^[a-z.]+$/.test(pattern)) {
      return fail('INVALID_INPUT', 'The pattern takes letters for greens and a dot for each unknown — like c..k.', 'pattern');
    }
    const present = String(input.present ?? '').toLowerCase();
    const absent = String(input.absent ?? '').toLowerCase();
    for (const [field, value] of [['present', present], ['absent', absent]]) {
      if (value && !/^[a-z]+$/.test(value)) {
        return fail('INVALID_INPUT', `"${value}" should be just letters — the ones you know are in the word, or the ones you know are not.`, field);
      }
    }

    const length = pattern.length;
    const greens = [...pattern];
    /* Grey applies only to letters that are not ALSO known present or green.
       A repeated letter comes back grey on its second appearance even when the
       word contains it once, so treating grey as "absent everywhere" would
       discard the answer. */
    const known = new Set([...present, ...greens.filter(c => c !== '.')]);
    const trulyAbsent = [...new Set(absent)].filter(c => !known.has(c));

    const matches = allWords().filter((w) => {
      if (w.length !== length) return false;
      for (let i = 0; i < length; i++) if (greens[i] !== '.' && w[i] !== greens[i]) return false;
      for (const c of present) if (!w.includes(c)) return false;
      for (const c of trulyAbsent) if (w.includes(c)) return false;
      return true;
    });

    if (!matches.length) {
      return fail('INVALID_INPUT', 'No word in the bundled list fits those clues — check a letter is not marked both present and absent.', 'pattern');
    }

    const shown = matches.slice(0, input.limit ?? 12);
    /* `shown` and a count, not the whole list. Five hundred words is not an
       answer anybody reads, and it is not something a later step would chain
       from either — the useful output of a solver is the shortlist. */
    return ok({
      count: matches.length,
      shown,
      more: matches.length > shown.length ? `, and ${matches.length - shown.length} more` : '',
      length,
      dataAsOf: WORDS_AS_OF
    }, { kind: 'bundled', dataAsOf: WORDS_AS_OF });
  }
};
