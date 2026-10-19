/* lint-cards.js — the check that would have caught every sibling confusion
 * before a user did.
 *
 * A skill's description does two jobs. It is indexed by the router
 * (router.js:209) and it is the line the planner reads on the card. Both jobs
 * fail the same way: two skills that do OPPOSITE things describe themselves
 * with the same words, and nothing downstream can separate them.
 *
 *   "Turn rows and columns into a formatted markdown table"   toMarkdownTable
 *   "Turn a Markdown table into rows of data"                 parseMarkdownTable
 *
 * Every content word is shared. The direction — drawing one versus reading one
 * — lives only in the word order, which a bag-of-words index discards entirely
 * and a 2B planner reads past. Rewritten so each owns its own verb, those two
 * separated, and nineteen pairs like them did too: wrong-skill picks fell from
 * 32 to 13 on the 308-question bench.
 *
 * WHY THIS IS A LINT AND NOT A MODEL. Three trained adapters were asked to tell
 * these pairs apart at inference time — on the skills' own examples, on
 * paraphrases, on contrastive pairs — and scored −3, +5 and +2 against a rule
 * of +8 (model/round4/SUMMARY.md). The distinction they were asked to make did
 * not exist in the text they were given. Putting it into the text costs nothing
 * at run time and is the thing that worked.
 *
 * WHY IT RUNS OVER EVERY PAIR. The bench holds one question per skill, so it
 * only discovers a confusable pair when a question happens to land on one:
 * 32 pairs out of 46,971. This reads all of them. When it was first run it
 * found `pxToRem`/`remToPx` and `hourlyToSalary`/`salaryToHourly` sharing
 * every content word — pure direction twins that no bench question had ever
 * tested.
 *
 * WHAT IT CATCHES, AND WHAT IT DOES NOT. Measured against the pairs the bench
 * has already judged: all twenty-one that workstream 3a rewrote now pass, and
 * two of the thirteen still failing are flagged. The other eleven fail for a
 * reason this cannot see — `flattenJson` and `unflattenJson` now read quite
 * differently and are still confused, because the MESSAGE is what is ambiguous
 * ("turn this nested object into dot paths" names neither direction). So this
 * is a guard against one specific defect, not a predictor of bench misses. Its
 * value is the pairs nobody has asked a question about yet: on its first run it
 * found `pxToRem`/`remToPx` and `hourlyToSalary`/`salaryToHourly` sharing every
 * content word, and no bench question had ever tested either.
 *
 * WHAT IT DOES NOT DO. It never rewrites a description. Naming what a skill
 * does in the words its own users would type is writing, and the whole point of
 * the exercise is that a person does it. This produces the worklist.
 */

/* Words that carry no distinguishing signal in a one-line description. Kept
   deliberately short: the aim is to compare CONTENT, and over-stripping would
   make unrelated skills look like twins. */
const STOP = new Set(`a an the this that these those and or but if then of to in on at for from by with without into over under
is are was were be been being do does did doing have has had having it its as so than too very just about
into out up down each every one two all any some other another same what which when where why how`.split(/\s+/));

const words = (s) => String(s || '').toLowerCase().match(/[a-z0-9+#]+/g) || [];
const content = (s) => words(s).filter(w => w.length > 2 && !STOP.has(w));

/* Enough stemming to stop "converts"/"converting"/"conversion" reading as three
   different words. Same shape as the router's, and for the same reason: the
   router indexes these strings, so the lint should see them as it does. */
function stem (w) {
  if (w.length <= 3) return w;
  for (const suf of ['ications', 'ication', 'ingly', 'edly', 'ing', 'ies', 'ied', 'es', 'ed', 's']) {
    if (w.endsWith(suf) && w.length - suf.length >= 3) {
      const base = w.slice(0, -suf.length);
      return (suf === 'ies' || suf === 'ied') ? base + 'y' : base;
    }
  }
  return w;
}

const stems = (s) => new Set(content(s).map(stem));

/* DIRECTION WORDS. A pair may share every noun and still be perfectly clear,
   as long as each side says which way it runs. These are the words that do
   that work, grouped so a pair is only separated when the two sides sit in
   OPPOSITE groups — "draw a table" against "read a table" separates; "draw a
   table" against "draw a chart" does not, and that pair is judged on its nouns
   like any other.

   The list is drawn from the rewrites that measured: it is not a vocabulary
   anybody must use, only the vocabulary this codebase has found sufficient. A
   pair separated by words outside it will be flagged, and the fix is either a
   better sentence or an addition here with a bench number behind it. */
const DIRECTIONS = [
  ['make', 'build', 'draw', 'render', 'generate', 'create', 'produce', 'write', 'lay', 'turn', 'encode', 'compress', 'squash', 'wrap', 'add', 'insert', 'join', 'merge', 'combine', 'pack', 'to', 'into'],
  ['read', 'parse', 'pull', 'extract', 'lift', 'decode', 'unpack', 'decompress', 'rebuild', 'restore', 'strip', 'remove', 'split', 'break', 'take', 'out', 'from', 'back'],
  ['up', 'upper', 'increase', 'grow', 'lighten', 'raise', 'more', 'after', 'next', 'forward', 'future', 'gain'],
  ['down', 'lower', 'decrease', 'shrink', 'darken', 'reduce', 'less', 'before', 'previous', 'back', 'past', 'lose'],
  ['all', 'every', 'whole', 'entire', 'both', 'each'],
  ['some', 'any', 'only', 'part', 'partial', 'single', 'one']
];

/** Which direction groups a description sits in. */
function directionsOf (text) {
  const w = new Set(words(text));
  const out = new Set();
  DIRECTIONS.forEach((group, i) => { if (group.some(g => w.has(g))) out.add(i); });
  return out;
}

/* Two descriptions are separated by direction when each names a group the
   other does not. One-sided direction is not enough: "Draw a table" against
   "A table, formatted" leaves the second saying nothing about which way it
   runs, and that is exactly the case that fails. */
function directionSeparates (a, b) {
  const da = directionsOf(a);
  const db = directionsOf(b);
  const onlyA = [...da].filter(x => !db.has(x));
  const onlyB = [...db].filter(x => !da.has(x));
  return onlyA.length > 0 && onlyB.length > 0;
}

/** Jaccard overlap of two stem sets. */
export function overlap (a, b) {
  const A = stems(a); const B = stems(b);
  if (!A.size || !B.size) return 0;
  const inter = [...A].filter(x => B.has(x)).length;
  return inter / new Set([...A, ...B]).size;
}

/* The bar. Fitted against the pairs the bench had already proven confusable:
   at 0.34 every one of the twenty-three that workstream 3a fixed was inside
   the net, and the count stays small enough to be a worklist rather than a
   wall. Same-category pairs are held to a stricter bar than cross-category
   ones, because the category adapter puts a whole category in front of the
   planner at once — two skills in one category are read side by side on every
   turn that category wins, and two in different categories rarely are. */
export const THRESHOLD = { same: 0.34, cross: 0.45 };

/**
 * Every pair of built skills whose descriptions read alike without saying
 * which way each one runs.
 *
 * @param {Array} skills  registry entries (routable ones)
 * @returns {Array<{a, b, overlap, sameCategory, shared}>} worst first
 */
export function confusablePairs (skills) {
  const built = skills.filter(s => s && !s.unbuilt && s.description);
  const out = [];
  for (let i = 0; i < built.length; i++) {
    for (let j = i + 1; j < built.length; j++) {
      const a = built[i]; const b = built[j];
      const sameCategory = a.category === b.category;
      const score = overlap(a.description, b.description);
      if (score < (sameCategory ? THRESHOLD.same : THRESHOLD.cross)) continue;
      /* Said its direction plainly: not a finding. */
      if (directionSeparates(a.description, b.description)) continue;
      const A = stems(a.description); const B = stems(b.description);
      out.push({
        a: a.name, b: b.name, sameCategory,
        overlap: Number(score.toFixed(2)),
        shared: [...A].filter(x => B.has(x)).sort()
      });
    }
  }
  return out.sort((x, y) => y.overlap - x.overlap || x.a.localeCompare(y.a));
}

/** One line per finding, for a terminal or a test failure. */
export function formatPairs (pairs, descriptionOf = () => '') {
  return pairs.map(p => {
    const da = descriptionOf(p.a); const db = descriptionOf(p.b);
    return `${String(p.overlap).padEnd(4)} ${p.sameCategory ? 'same ' : 'cross'} ${p.a} / ${p.b}\n` +
           `       shared: ${p.shared.join(' ')}\n` +
           (da ? `       ${p.a}: "${da}"\n` : '') +
           (db ? `       ${p.b}: "${db}"\n` : '');
  }).join('\n');
}
