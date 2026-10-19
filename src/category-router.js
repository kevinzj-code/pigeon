/* category-router.js — §3.1's router, with the model choosing the neighbourhood.
 *
 * The lexical router can only rank a skill that shares a word with the question.
 * Measured on the grading holdout, the right skill scores ZERO for 16 of 145
 * questions — "squash this text down" against a skill whose examples all say
 * compress. No list length reaches those, because they are not on the list at
 * all: a threshold cannot promote something that was never ranked.
 *
 * So this asks a model for the CATEGORY first, then offers that whole category
 * as candidates. Word matching becomes a tiebreaker for ordering inside the
 * category rather than the gate deciding what gets considered. A skill that
 * shares no vocabulary with the question is still reachable, provided the model
 * puts the question in the right neighbourhood.
 *
 * That "provided" is the whole risk, and it is why this is measured rather than
 * assumed: the categorisation is now a single point of failure. Pick the wrong
 * category and the right skill is not merely ranked low, it is absent — exactly
 * the failure this exists to fix, moved one step upstream. The fallback below is
 * not politeness; it is the thing that keeps a bad category from being fatal.
 */

import { twinIndex } from './twins.js';
import { LexicalRouter } from './router.js';

/* Below this, the category is treated as no answer at all.
 *
 * Fitted on HOLDOUT_TUNE and never on the grading half. The adapter answers a
 * question it knows at ~1.00 and guesses at nonsense at ~0.58, so the two are
 * separable; at this bar the grading half gives 88% category accuracy and 24 of
 * 25 refusals, against 92% and 17 of 25 ungated. Four points of accuracy for
 * twenty-eight of refusal is the right side of that trade, because a wrong
 * category does not merely rank badly — it hands the planner twenty tools that
 * matched nothing. */
export const CATEGORY_CONFIDENCE = 0.80;

/* The shipped fallback floor. See `fallbackFloor` below for what it does and
   the measurements behind the number:
     v3 alone            291 / 308 correct · 21 / 100 leaks   (292, 291, 290 over three runs)
     v3 + floor 0.20     290 / 308 correct · 17 / 100 leaks   (290, 290 over two)
     v3 + floor 0.25     289 / 308 correct · 16 / 100 leaks
   0.20 stops four leaks for one answer, and that one answer is inside the
   bench's own run-to-run spread. 0.25 buys the fifth leak at one answer each,
   which is the ground check's bargain again and is not taken. */
export const FALLBACK_FLOOR = 0.20;

/* Widening options A and B as the app runs them (see withTwins and decide
   below). The bench takes these as its defaults too, so a flagless run is the
   app; --no-twins and --no-keep-category measure without. */
export const WIDENING = Object.freeze({ twins: twinIndex(), keepCategory: true, maxListed: 24, capKeepsToday: true });

export const CATEGORY_SYSTEM = (menu) =>
  `Route the user's request to ONE category of tools. Reply with the category name only, or "none" if no tool fits.\n\nCategories:\n${menu}`;

/* This model returns nothing useful without demonstrations — measured, and the
   same reason the planner carries its own. */
export const CATEGORY_SHOTS = [
  ['how many days until christmas', 'dates'],
  ['convert 5 miles to km', 'conversion'],
  ['sha256 of hello', 'encoding'],
  ['what is the median of these numbers', 'statistics'],
  ['count the words in this paragraph', 'text'],
  ['write me a poem about the sea', 'none']
].flatMap(([q, a]) => [{ role: 'user', content: q }, { role: 'assistant', content: a }]);

/* The adapter was fine-tuned on one exact prompt with no demonstrations, so in
   trained mode it must be asked in precisely that form. A menu listing skill
   names, or the shots above, is a different distribution from the one it
   learnt and measurably worse — the shots exist to coax an untrained model and
   become noise once the behaviour is in the weights. Byte-identical is not
   fussiness here; the categories line is asserted against the training file.
   Pure, and exported, so a loader can check a packed prompt against what the
   app would build. `categories` must already be sorted. */
export const trainedSystemFor = (categories) =>
  'Route the user\'s request to ONE category of tools. Reply with the category ' +
  'name only, or "none" if no tool fits.\n\nCategories: ' + categories.join(', ');

/* When the adapter says "none" and the words agree, stop.
 *
 * MEASURED, and it corrected the guess this file and turn.js were both built
 * on. The comment in turn.js says the leak is upstream — that the adapter names
 * a category at 0.9 to 1.00 for "he made a hash of the presentation". It does
 * not. The shipped adapter REFUSES that sentence, at 1.00, and 12 of the 21
 * leaks on the bench are messages it refused correctly. They leak HERE, in the
 * fallback: the adapter declines, word matching is asked instead, and word
 * matching always finds something to hand the planner.
 *
 * `fallbackFloor` is the second opinion having to be worth something. Below it
 * the two agree that nothing fits, and the turn declines rather than offering
 * the planner twenty things that matched a word.
 *
 * The number is a trade, not a truth. On the 12 fallback leaks and the 25 real
 * questions that reach this branch:
 *
 *   floor 0.20   stops 4 leaks, costs 2 real questions
 *   floor 0.25   stops 5 leaks, costs 4
 *   floor 0.30   stops 9 leaks, costs 7
 *
 * 0.30 is the tempting one and it is the ground check's bargain again — six
 * leaks for nine answers — which this project has already rejected once. Off by
 * default: a caller opts in, and the bench measures it either way. */
export function categoryRouter ({ registry, complete, maxCandidates = 20, blend = true,
                                  trained = false, minConfidence = 0, fallbackFloor = 0,
                                  trainedSystem, promptedSystem = CATEGORY_SYSTEM,
                                  shots = CATEGORY_SHOTS, lexicalOptions = {},
                                  twins = null, keepCategory = false, maxListed = Infinity, capKeepsToday = false }) {
  const built = registry.routable();
  const byCategory = {};
  for (const s of built) (byCategory[s.category] ??= []).push(s.name);
  const categories = Object.keys(byCategory).sort();

  /* The lexical router is kept, at full width, for two jobs: ordering the
     candidates inside the chosen category, and standing in wholesale when no
     model answers. */
  const lexical = new LexicalRouter(registry, { ...lexicalOptions, k: built.length });

  /* A SECOND lexical router at the shipped width, used when no category is
     chosen. The wide one above exists to order skills inside a category and its
     forPlanner list is correspondingly wide — handing that to the planner on the
     fallback path would offer roughly twice the candidates the shipped router
     would, which is the opposite of falling back. Measured: that mistake cost
     ~4 wrongly-answered nonsense messages on its own. */
  const fallback = new LexicalRouter(registry, lexicalOptions);

  const menu = categories
    .map(c => `- ${c}: ${byCategory[c].slice(0, 5).join(', ')}${byCategory[c].length > 5 ? ', …' : ''}`)
    .join('\n');
  const grammar = `root ::= ${[...categories, 'none'].map(c => `"${c}"`).join(' | ')}`;

  /* See trainedSystemFor above: the trained prompt defaults to exactly what the
     adapter learnt on. */
  const trainedPrompt = trainedSystem ?? trainedSystemFor(categories);


  const router = {
    name: `category-first (${trained ? 'adapter' : 'prompted'} + lexical ordering)`,
    get threshold () { return lexical.threshold; },
    get marginFloor () { return lexical.marginFloor; },
    lastCategory: null,
    lastConfidence: null,
    /* verify.js asks the router which skills sit closest to a draft pick; the
       lexical index is where that lives. */
    similarSkills: (name, n) => lexical.similarSkills(name, n),

    async route (message, opts = {}) {
      const scored = lexical.route(message, opts);
      const scoreOf = new Map(scored.candidates.map(c => [c.name, c]));

      let category = null;
      let confidence = null;
      try {
        const out = await complete({
          messages: trained
            ? [
                { role: 'system', content: trainedPrompt },
                { role: 'user', content: message }
              ]
            : [
                { role: 'system', content: promptedSystem(menu) },
                ...shots,
                { role: 'user', content: message }
              ],
          grammar, maxTokens: 12, temperature: 0,
          wantConfidence: minConfidence > 0,
          /* The trained router is the patch-router Pigeon (D84). */
          ...(trained ? { pigeon: { id: 'patch-router', input: message } } : {})
        });
        category = out.text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
        confidence = out.confidence;

        /* An unsure category is worse than no category. Handing the planner a
           whole category means handing it tools that matched nothing, so a
           wrong guess here does not merely rank badly — it puts twenty plausible
           tools in front of a planner that will pick one. Measured: the adapter
           answers a real question at ~1.00 and guesses at nonsense at ~0.6, so
           the gap is wide enough to gate on. Below the bar we drop to lexical,
           which declines when it recognises nothing. */
        if (minConfidence > 0 && typeof confidence === 'number' && confidence < minConfidence) {
          category = null;
        }
      } catch {
        /* No model reachable. Behave exactly as the lexical router would rather
           than failing the turn — the app is usable without a model and this
           must not be the thing that changes that. */
        category = null;
      }
      router.lastCategory = category;
      router.lastConfidence = confidence;

      if (!category || !byCategory[category]) {
        /* "none", or an answer that is not a category. Falling back to lexical
           rather than declining outright: the model saying "none" is evidence,
           not proof, and the lexical router still applies its own thresholds. */
        const out = fallback.route(message, opts);
        /* Unless the words agree with the refusal. Both said no; offering the
           planner a shortlist anyway is how a sentence the adapter correctly
           declined still ends up running a tool. */
        const best = (out.candidates || [])[0];
        if (fallbackFloor > 0 && (!best || best.score < fallbackFloor)) {
          /* `forPlanner` is the field turn.js actually reads, and emptying
             `candidates` alone did nothing at all — the bench came back
             byte-identical, which is what a change that never ran looks like.
             All three lists go: what the planner is offered, what the router
             would act on itself, and what is shown as a suggestion. */
          return { ...out, candidates: [], forPlanner: [], actionable: [], suggestions: [],
                   backend: router.name, category: category ?? 'unavailable', confidence,
                   declinedBy: 'both the adapter and the words' };
        }
        const today = capKeepsToday ? new Set((out.forPlanner || []).map(c => c.name)) : null;
        return { ...out, forPlanner: capListed(withTwins(out.forPlanner || [], twins, scoreOf), maxListed, twins, today), backend: router.name, category: category ?? 'unavailable', confidence };
      }

      /* Word-ranked members of the category first, then the rest of it. The tail
         is the entire point — those are the skills that scored zero and would
         never have been seen. */
      const members = byCategory[category];
      const ranked = members
        .filter(n => scoreOf.has(n))
        .sort((a, b) => scoreOf.get(b).score - scoreOf.get(a).score);
      const unscored = members.filter(n => !scoreOf.has(n)).sort();

      const candidates = [...ranked, ...unscored]
        .slice(0, maxCandidates)
        .map(n => scoreOf.get(n) ?? { name: n, score: 0, base: 0, biased: false, coverage: 0, via: 'category' });

      /* Blending keeps the lexical router's own top pick in the running even
         when the model chose a different category, so one bad categorisation
         does not throw away an answer the old router would have found. */
      if (blend && scored.candidates.length && !candidates.some(c => c.name === scored.candidates[0].name)) {
        candidates.push(scored.candidates[0]);
      }

      const routed = decide(candidates, lexical, router.name, category, confidence, keepCategory ? new Set(members) : null);
      const today = capKeepsToday ? new Set(decide(candidates, lexical, router.name, category, confidence).forPlanner.map(c => c.name)) : null;
      return { ...routed, forPlanner: capListed(withTwins(routed.forPlanner, twins, scoreOf), maxListed, twins, today) };
    }
  };
  return router;
}

/* The same gates the lexical router applies, over whatever candidate set it is
   given. Acting still requires clearing t_skill AND beating the runner-up by a
   margin, so a model-chosen category cannot make the router commit to something
   the scores do not support. */
/* WIDENING (router-widening proposal, options A and B, 2026-10-12).
 *
 * A, twins ride together: `twins` (twins.js's index) lists a skill's twin
 * beside it, in any category. Round 3's misses were twins confused with both
 * listed, and its rows could only teach a pair the router happened to list
 * together; this lists them together by rule.
 *
 * B, no small-score drop inside the category: with `keepCategory`, every
 * member of the chosen category's top 20 reaches the planner. Without it a
 * member scoring 0 < score < plannerFloor is dropped while one scoring nothing
 * is kept, which is how a twin sharing a word or two with the message vanished.
 */
function withTwins (list, twins, scoreOf) {
  if (!twins || !list.length) return list;
  const have = new Set(list.map(c => c.name));
  const out = [...list];
  for (const c of list) {
    for (const t of twins.get(c.name) || []) {
      if (have.has(t)) continue;
      have.add(t);
      out.push({ ...(scoreOf.get(t) || { name: t, score: 0, base: 0, biased: false, coverage: 0 }), via: 'twin' });
    }
  }
  return out;
}

/* THE CAP, after twins are added (Kevin, 2026-10-12): one list reached 34.
   What goes first is what the words never scored and nobody asked for as a
   twin (a category's alphabetical tail), from the end; then the lowest-scored
   non-twins; twins last. A twin is any skill twinned with another on the
   list, however it got there. Order is otherwise kept. */
/* `keep` (capKeepsToday, on in WIDENING): the names today's rule lists are
   never cut, so the cap trims only what widening added. Measured 2026-10-12,
   gates on: cutting unscored members first (Kevin's rule as first written)
   listed the right skill for 284 of 308 and the planner scored 283 (11 text
   skills the words never score lost to twins); keeping today's list holds 306
   and 293, identical to uncapped on all 408 questions. */
function capListed (list, max, twins = null, keep = null) {
  if (!(list.length > max)) return list;
  const names = new Set(list.map(c => c.name));
  const isTwin = (c) => c.via === 'twin' || Boolean(twins && (twins.get(c.name) || []).some(t => names.has(t)));
  const rank = list.map((c, i) => ({ c, i,
    tier: keep && keep.has(c.name) ? 3 : isTwin(c) ? 2 : (c.score > 0 ? 1 : 0) }));
  const drop = new Set(rank
    .sort((a, b) => a.tier - b.tier || (a.tier === 1 ? a.c.score - b.c.score : b.i - a.i))
    .slice(0, list.length - max)
    .map(r => r.i));
  return list.filter((_, i) => !drop.has(i));
}

function decide (candidates, lexical, backend, category, confidence = null, members = null) {
  const sorted = [...candidates].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  const aboveThreshold = sorted.filter(c => c.score >= lexical.threshold);
  const decided = aboveThreshold.length > 0 &&
    (sorted.length < 2 || sorted[0].score - sorted[1].score >= lexical.marginFloor);
  const actionable = decided ? [sorted[0]] : [];
  return {
    backend, category,
    /* What the adapter's own first token was worth. Carried on the routing so a
       later pass can ask how sure the neighbourhood was, not just which one it
       was — turn.js's ground check is the caller that needs it. */
    confidence,
    threshold: lexical.threshold,
    marginFloor: lexical.marginFloor,
    candidates: sorted,
    aboveThreshold,
    forPlanner: sorted.filter(c => c.score >= lexical.plannerFloor || c.via === 'category' || (members && members.has(c.name))),
    actionable,
    suggestions: sorted.filter(c => c.score >= lexical.suggestFloor && !actionable.includes(c)).slice(0, 3)
  };
}

