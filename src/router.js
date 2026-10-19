/* router.js — §3.1.
 *
 * WHAT SHIPS TODAY: LexicalRouter, a deterministic TF-IDF cosine matcher over
 * the registry's examples. No model, no download, no weights.
 *
 * WHAT §3.1 ASKS FOR: an encoder-only embedding model (EmbeddingGemma 308M and
 * friends), one vector per example, max-similarity per skill. That model does
 * not exist in this repo, and §2.4 forbids shipping UI for something that
 * isn't there — so rather than a disabled "embeddings" switch, the seam is a
 * plain interface and the lexical implementation of it is real and running.
 * The app names the backend it is using wherever routing is shown.
 *
 * Everything ELSE in §3.1 is implemented here for real and does not change
 * when the backend does:
 *   · one vector per example plus one for the description, cached at load
 *   · skill score = MAX similarity across its vectors, not the average — an
 *     averaged vector loses recall on varied phrasings, which is the whole
 *     reason the spec says one per example
 *   · router input is the current message plus the previous user turn
 *   · skills used in the previous plan get a +0.05 bias, so "and in euros?"
 *     resolves
 *   · top-k = 5 with scores
 *   · a threshold that belongs to the BACKEND, because cosine scores are not
 *     comparable across encoders and a shared constant would be a bug
 *   · deterministic: same message, same candidates, every time
 *   · adding a skill = adding vectors. No retraining. */

/* How many candidates a route() call returns — and therefore how many a planner
   ever gets to choose from. This is a ceiling on the whole system: a skill that
   does not make this list cannot be picked by anything downstream, however
   capable. It is an instance property (`router.k`) as well as a default so the
   sweep can measure the curve instead of the value being folded into the code.

   Measured on the grading holdout, how often the right skill is present:
     k=5  73%   ·   k=10 82%   ·   k=20 86%   ·   k=100 89%
   It is 10 because that is where the curve stops paying: 20 buys four more
   points of presence and the planner converted none of them, at higher latency.
   The 89% is where word-matching runs out entirely — beyond it the right skill
   shares no word with the question, and no list length reaches it.

   Raising this cannot make the router itself act, or leak. `actionable` reads
   candidates[0] and [1], which a longer list does not reorder — verified as zero
   difference in decisions and in no-skill leaks between k=5 and k=20. */
export const ROUTER_K = 10;

/* How much a bare number counts toward a match, against a word's 1 (see the
   constructor). Patch's own setting: packed as tunables.router.number_weight. */
export const NUMBER_WEIGHT = 0.5;

/* Stopwords do real work here: "how many days until" is four tokens of which
   one carries the signal, and without this the highest-scoring skill for any
   question is whichever one wrote the most examples starting with "how". */
const STOP = new Set(`a an the and or but if then of to in on at for from by with without into over
under is are was were be been being do does did doing have has had having i me my we our you your it
its this that these those what which who whom when where why how many much can could should would will
shall may might must please tell show give get make let s t re ll ve d m about as so than too very just
now new like need want know say says said thing things something anything`.split(/\s+/));

/* Enough stemming to collapse the forms one skill's examples actually vary
   across ("convert/converts/converting", "day/days"). A real stemmer would be
   a dependency to fix a problem this doesn't have. */
function stem (w) {
  if (w.length <= 3) return w;
  for (const suf of ['ications', 'ication', 'ingly', 'edly', 'ing', 'ies', 'ied', 'es', 'ed', 's']) {
    if (w.endsWith(suf) && w.length - suf.length >= 3) {
      let base = w.slice(0, -suf.length);
      if (suf === 'ies' || suf === 'ied') base += 'y';
      return base;
    }
  }
  return w;
}

export function tokenize (text) {
  return String(text ?? '')
    /* Split camelCase so a skill's own name is searchable: countdownTo → "countdown to". */
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    /* "%" is a word people type instead of "percent". Dropped as punctuation,
       "15% of 84.50" was left with nothing but its numbers, and the skill whose
       example happened to contain 84.50 won. */
    .replace(/%/g, ' percent ')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(w => w && !STOP.has(w))
    .map(stem)
    .filter(w => w.length > 1);
}

/* Bare numbers are the question's DATA, not a clue about which skill answers
   it. No skill's examples can be expected to contain "2026" or "84.50", so
   counting them in the coverage denominator penalises exactly the questions
   that carry the most concrete information: "what day of the week is
   2026-12-25" scored two matched tokens out of five and fell under t_skill.
   They still contribute to the cosine — they are just not evidence of a MISS. */
const isSignal = (t) => !/^\d+$/.test(t);

const dot = (a, b) => {
  let s = 0;
  const [small, big] = a.size < b.size ? [a, b] : [b, a];
  for (const [k, v] of small) { const w = big.get(k); if (w) s += v * w; }
  return s;
};

function normalise (counts, idf, { dropUnknown = false } = {}) {
  const v = new Map();
  let norm = 0;
  for (const [t, c] of counts) {
    /* A token that appears in NO document cannot raise any dot product, but it
       does enlarge the query's norm — so it depresses every score equally, and
       the more concrete the question, the harder it is depressed. "what day of
       the week is 2026-12-25" was pushed under t_skill by its own date.
       Dropping unknown tokens from the QUERY leaves the ranking untouched and
       puts the scores back on a comparable scale, which is the scale the
       threshold is calibrated against. They still count against coverage: a
       message full of words the registry has never seen is a message the
       registry probably does not answer. */
    if (dropUnknown && !idf.has(t)) continue;
    /* log(1 + c), NOT the textbook 1 + log(c). The textbook form assumes an
       integer term count of at least 1; the previous turn's tokens arrive here
       weighted 0.34, and 1 + log(0.34) is NEGATIVE — which silently inverted
       the contribution of every token carried over from the last message, so
       prior context pushed the matching skill DOWN the ranking instead of up.
       log(1 + c) is monotonic and positive across the whole fractional range. */
    const w = Math.log(1 + c) * (idf.get(t) ?? Math.log(2));
    v.set(t, w); norm += w * w;
  }
  norm = Math.sqrt(norm) || 1;
  for (const [t, w] of v) v.set(t, w / norm);
  return v;
}

/* Typing slips, counted: a letter left out, a letter doubled or added, two
   neighbours swapped — one each. Changing one letter into another costs two,
   because that is how one real word becomes a different real word
   ("pavement" / "payment", "tense" / "dense"). Gives up once past `max`. */
function editDistance (a, b, max) {
  let prev2 = null;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let low = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 2;
      let d = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (prev2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d = Math.min(d, prev2[j - 2] + 1);
      cur[j] = d;
      if (d < low) low = d;
    }
    if (low > max) return max + 1;
    prev2 = prev;
    prev = cur;
  }
  return prev[b.length];
}

const counted = (tokens) => {
  const m = new Map();
  for (const t of tokens) m.set(t, (m.get(t) ?? 0) + 1);
  return m;
};

/**
 * The interface a router backend must satisfy. An embedding backend swaps in
 * by implementing these three and nothing else changes:
 *   name       — shown in the UI and in "Show plan"
 *   threshold  — ITS OWN t_skill, calibrated for ITS OWN score distribution
 *   route(message, opts) → { candidates, backend, threshold, aboveThreshold }
 */
/* One built index per registry (see reindex). A WeakMap, so a registry that
   is dropped takes its index with it. */
const INDEX = new WeakMap();
const REPAIRED_CAP = 2000;

export class LexicalRouter {
  constructor (registry, { k = ROUTER_K, threshold = 0.375, marginFloor = 0.12, numberWeight = NUMBER_WEIGHT } = {}) {
    this.name = 'lexical (TF-IDF cosine)';
    this.k = k;
    /* How much a bare number in the question counts toward the match, against a
       word's 1. Numbers are the question's data, and an example that happens to
       share the figures ("84.50") can outvote the words. Swept on HOLDOUT_TUNE +
       every registry example + the no-skill set (2026-09-14): 0.5 is one better
       and none worse there, and "15% of 84.50" stops being answered as a bill.
       0.1 routes that one to percentOf but loses 32 others. */
    this.numberWeight = numberWeight;
    /* Every constant here is SWEPT, not chosen — scripts/sweep.mjs measures
       them against scripts/holdout.mjs, which holds one phrasing per built
       skill that appears in no skill's examples. Tuning on the registry's own
       examples is meaningless: they built the index, so they score 0.65–0.97
       and every value looks good.

       The holdout is split. sweep.mjs fits these constants to HOLDOUT_TUNE;
       gate.mjs grades HOLDOUT_GRADE, which the fitting never sees. Measured on
       the grading half (145 phrasings) and 50 no-skill messages:
         34 routed to the right skill · 11 to the wrong one · 100 declined
         3 of the 50 no-skill messages wrongly accepted
         recall@5 106/145 (73%) — what a planner, which sees the top five, gets

       The same router scores 83% recall@5 on the tuning half. That 10-point gap
       is why the split exists.

       Note what changed when the registry grew from 42 skills to 100: at 42 a
       threshold existed that made ZERO wrong-skill calls, and at 100 no
       threshold does. That property was a property of a small registry, not of
       the router, and pretending otherwise would have been the more
       comfortable read.

       At 301 skills it is worse again: no threshold brings the wrong-skill rate
       under 5% without declining a large share of the questions it currently
       answers right. And no threshold touches recall@5 at all, which sits at 73% whatever this is
       set to — recall@5 is a question about RANKING, and a bar cannot reorder a
       list. That is the measurement that argues for an encoder. */
    this.threshold = threshold;
    /* How hard a partial-coverage match is damped; swept alongside t_skill. */
    this.coverageFloor = 0.30;
    /* A MARGIN, not just a bar. Nearly every wrong-skill call was a near tie
       between two neighbours — percentOf against whatPercent, countWords
       against wordFrequency — where the top score cleared t_skill comfortably
       and the runner-up was 0.01 behind. A score that high says "this message
       is about arithmetic"; it does not say which of two arithmetic skills.
       Requiring a gap to the runner-up cut wrong calls from 7 to 3 while
       INCREASING correct ones, because it also let t_skill come down. A tie
       goes to the user as a two-way suggestion, which is the honest outcome:
       the router genuinely does not know. */
    this.marginFloor = marginFloor;
    /* §10 open decision 2: "Two places can say 'no skill.' Proposal: router
       gates cheaply; planner can still return empty; planner cannot add skills
       the router didn't offer."
       t_skill above is NOT a cheap gate — it is calibrated for single-skill
       mode, where the router IS the decision and a wrong call is unrecoverable.
       When a planner exists the decision moves downstream, and holding
       candidates back at 0.35 skips pass 2 on precisely the questions that
       needed it. So a planner sees everything above this much lower bar, and
       answers "no skill" the way §3.2 says it should — by returning an empty
       plan. Low enough to let recall@5 (99/101) through; not zero, because a
       candidate scoring nothing at all is noise in the prompt. */
    this.plannerFloor = 0.10;
    /* Candidates between suggestFloor and t_skill are shown as "did you mean",
       never run. There is no clean floor here — useful near-misses run 0.24–0.38 and
       the no-skill set tops out at 0.49, so the bands genuinely overlap. 0.22
       keeps the suggestions worth having ("what does SEK mean" → currencyLookup
       at 0.24) and drops the weakest noise; the rest is handled by wording and
       by showing the score, so a 0.25 suggestion looks like what it is. */
    this.suggestFloor = 0.22;
    this.reindex(registry);
  }

  /** The n skills in the same category closest to this one, by the same
   *  TF-IDF cosine the router scores messages with — and by the same rule:
   *  MAX similarity across the two skills' vectors (description and every
   *  example), not the description alone. Descriptions of true siblings often
   *  share no words ("Take a percentage off a price" / "Apply several
   *  discounts one after another") while their examples do ("25% off a 80
   *  jacket" / "stack 20% and 10% off 100"); description-only put
   *  stackDiscounts nowhere near applyDiscount. Used by verify.js to choose
   *  which siblings to put beside the planner's draft pick — chosen here,
   *  deterministically, rather than asked of the model. Cached on first use. */
  similarSkills (name, n = 2) {
    this._siblings ??= new Map();
    if (!this._siblings.has(name)) {
      const mine = this.vectors.filter(d => d.skill === name);
      const me = this.registry.skill(name);
      const best = new Map();
      if (mine.length && me) {
        for (const d of this.vectors) {
          if (d.skill === name) continue;
          const other = this.registry.skill(d.skill);
          if (!other || other.unbuilt || other.category !== me.category) continue;
          let m = 0;
          for (const v of mine) { const c = dot(v.vec, d.vec); if (c > m) m = c; }
          if (m > (best.get(d.skill) ?? 0)) best.set(d.skill, m);
        }
      }
      this._siblings.set(name, [...best].map(([n2, score]) => ({ name: n2, score }))
        .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)));
    }
    return this._siblings.get(name).slice(0, n);
  }

  /** §3.1: adding a skill is adding vectors, done at registry load. */
  reindex (registry) {
    this.registry = registry;
    /* The index is a function of the registry alone — k, the threshold and
       the number weight are applied at query time — so every router over one
       registry (the category router's wide and shipped ones, the app's own,
       the composer's suggestion) reads one index instead of building four. */
    const shared = INDEX.get(registry);
    if (shared) {
      ({ idf: this.idf, vectors: this.vectors, docCount: this.docCount } = shared);
      this.vocab = null;
      this.repaired = null;
      return;
    }
    const docs = [];
    /* §5 stub policy, enforced at the index: unbuilt entries are not read. */
    for (const s of registry.routable()) {
      docs.push({ skill: s.name, kind: 'description', tokens: tokenize(`${s.name} ${s.description} ${s.category}`) });
      for (const [i, ex] of (s.examples || []).entries()) {
        docs.push({ skill: s.name, kind: `example[${i}]`, tokens: tokenize(`${s.name} ${ex.text}`) });
      }
    }
    const df = new Map();
    for (const d of docs) for (const t of new Set(d.tokens)) df.set(t, (df.get(t) ?? 0) + 1);
    this.idf = new Map([...df].map(([t, n]) => [t, Math.log((docs.length + 1) / (n + 0.5))]));
    /* The spelling repairs belong to this vocabulary; a new one starts clean. */
    this.vocab = null;
    this.repaired = null;
    this.vectors = docs.map(d => ({ ...d, vec: normalise(counted(d.tokens), this.idf) }));
    this.docCount = docs.length;
    INDEX.set(registry, { idf: this.idf, vectors: this.vectors, docCount: this.docCount });
  }

  /* A misspelt word is a word the index has never seen, and an unseen word is
     dropped — so "govenor of Virginia" lost the one word that said what it
     was. An unknown word of six letters or more is read as the known word it
     is one typing slip from, when both start and end with the same letter and
     no other known word is as close: a guess between two is not a repair, and
     a word that differs at either end ("party" / "part", "flight" / "light")
     is usually a different word, not a slip. Known words, short words and
     numbers are never touched. */
  repair (tokens) {
    if (!this.vocab) this.vocab = [...this.idf.keys()].filter(t => t.length >= 4 && isSignal(t));
    if (!this.repaired) this.repaired = new Map();
    /* Bounded: every misspelling ever typed would otherwise stay for the
       session. The oldest go first. */
    if (this.repaired.size > REPAIRED_CAP) for (const key of [...this.repaired.keys()].slice(0, this.repaired.size - REPAIRED_CAP)) this.repaired.delete(key);
    return tokens.map(t => {
      if (this.idf.has(t) || t.length < 6 || !isSignal(t)) return t;
      if (this.repaired.has(t)) return this.repaired.get(t);
      const max = 1;
      let best = null, bestD = max + 1, tied = false;
      for (const v of this.vocab) {
        if (Math.abs(v.length - t.length) > max || v[0] !== t[0] || v[v.length - 1] !== t[t.length - 1]) continue;
        const d = editDistance(t, v, max);
        if (d < bestD) { best = v; bestD = d; tied = false; }
        else if (d === bestD) tied = true;
      }
      const out = best && !tied ? best : t;
      this.repaired.set(t, out);
      return out;
    });
  }

  /**
   * @param {string} message              the current user turn
   * @param {object} opts
   * @param {string} opts.prevMessage     the previous user turn (§3.1)
   * @param {string[]} opts.prevSkills    skills used in the previous plan (§3.1 bias)
   */
  route (message, { prevMessage = '', prevSkills = [] } = {}) {
    /* The previous turn is context, not the question: it is included so
       "and in euros?" has something to attach to, at a third of the weight so
       it cannot outvote what was actually just asked. */
    /* Coverage is measured over the ROUTER'S input, which §3.1 defines as this
       turn plus the previous one — not over this turn alone. Measuring only the
       current message punished exactly the case the previous turn exists to
       rescue: "and in euros?" is two content tokens, neither of which a
       currency skill's examples contain, so its coverage was zero and the
       follow-up bias had nothing left to lift. */
    const mine = this.repair(tokenize(message));
    const before = this.repair(tokenize(prevMessage));
    const own = new Set([...mine, ...before].filter(isSignal));
    const counts = counted(mine);
    if (this.numberWeight !== 1) for (const [t, c] of counts) if (!isSignal(t)) counts.set(t, c * this.numberWeight);
    const prev = counted(before);
    for (const [t, c] of prev) counts.set(t, (counts.get(t) ?? 0) + c * 0.34);
    const q = normalise(counts, this.idf, { dropUnknown: true });

    const best = new Map();
    for (const d of this.vectors) {
      const cosine = dot(q, d.vec);
      if (cosine <= 0) continue;
      /* COVERAGE DAMPING.
         Cosine over a normalised query cannot tell "the whole question matched
         this skill" from "one word of a six-word question did". Both come out
         high, because normalising the query makes a single shared token fill
         it. That is precisely the shape of every false positive this router
         had: "describe the smell of rain on hot pavement" matched
         describeNumbers on the word "describe" alone and scored 0.639, while
         genuine matches bottomed out at 0.652 — a 0.004 gap to place a
         threshold in.
         Scaling by how MUCH of the question the skill accounts for restores
         the separation without touching the queries that legitimately are one
         word ("what is JPY"), which have full coverage by definition. The 0.4
         floor keeps a partial match ranked rather than erased — the planner
         still sees it in the top-k, it just doesn't clear t_skill alone. */
      const distinct = [...new Set(d.tokens)];
      const matched = distinct.filter(t => own.has(t)).length;
      /* A query with no signal tokens at all ("15% of 240" is numerals and
         stopwords) has nothing for coverage to measure. Damping it to the floor
         would bury the arithmetic skills that answer exactly those questions,
         so coverage is 1 — undamped — and the cosine decides alone. */
      const coverage = own.size ? matched / own.size : 1;
      const floor = this.coverageFloor;
      const score = cosine * (floor + (1 - floor) * coverage);

      const held = best.get(d.skill);
      /* MAX across the skill's vectors — §3.1. */
      if (!held || score > held.score) best.set(d.skill, { score, via: d.kind, coverage });
    }

    const biased = new Set(prevSkills);
    const candidates = [...best]
      .map(([name, { score, via, coverage }]) => ({
        name,
        score: Math.round((score + (biased.has(name) ? 0.05 : 0)) * 1e6) / 1e6,
        base: Math.round(score * 1e6) / 1e6,
        biased: biased.has(name),
        coverage: Math.round(coverage * 100) / 100,
        via
      }))
      /* Ties broken by name so the same message always yields the same order —
         §3.1's determinism claim has to survive a tie. */
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
      .slice(0, this.k);

    const aboveThreshold = candidates.filter(c => c.score >= this.threshold);
    /* Clearing t_skill is necessary but not sufficient: the top candidate also
       has to be clear of the runner-up by marginFloor. One candidate on its own
       has nothing to be confused with and passes automatically. */
    const decided = aboveThreshold.length > 0 &&
      (candidates.length < 2 || candidates[0].score - candidates[1].score >= this.marginFloor);
    const actionable = decided ? [candidates[0]] : [];

    return {
      backend: this.name,
      threshold: this.threshold,
      marginFloor: this.marginFloor,
      candidates,
      aboveThreshold,
      /* What a PLANNER may consider — a cheap gate, per §10 decision 2. */
      forPlanner: candidates.filter(c => c.score >= this.plannerFloor),
      /* What the executor may run without asking, when there is no planner. */
      actionable,
      /* Everything else worth showing: the band under t_skill, plus the
         near-ties that cleared it but could not be told apart. Declining
         outright is honest but unhelpful when the router can see what was
         probably meant; running one of two tied neighbours is unhelpful AND
         dishonest. */
      /* Capped at three: a longer list of weak guesses is a worse answer than a
         short one, and the fourth is never the one. */
      suggestions: candidates
        .filter(c => c.score >= this.suggestFloor && !actionable.includes(c))
        .slice(0, 3)
    };
  }
}
