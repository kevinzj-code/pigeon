/* stack.js — how the pipeline is assembled from whatever models are reachable.
 *
 * Two windows now run this app: the main one and the menu-bar popover. Both
 * need the same thing — a router, and a planner if one is awake — and neither
 * should own the knowledge of how to build it, or the two would drift and the
 * popover would quietly answer differently from the window.
 *
 * So the assembly lives here and nothing else does. There is no state in this
 * file: each function probes, and either returns the pieces it built or null,
 * which is a normal answer and the one the rail draws as "no model". The
 * caller holds the pieces, because the main window and the popover keep them
 * in different shapes for different reasons.
 *
 * Nothing here touches the DOM, so the test suite can call it.
 */

import { categoryRouter, CATEGORY_CONFIDENCE, FALLBACK_FLOOR, WIDENING } from './category-router.js';
import { detectLlm, CATEGORY_BASE } from './llm.js';
import { llmPlanner } from './planner.js';
import { sentenceFocus } from './focus.js';
import { asksCheck } from './verify.js';

/**
 * The planner and the two passes that share its model, or null when no planner
 * answers. `complete` is handed back as well: the OCR tidy needs a free-text
 * call, which the plan-writing wrapper cannot give it.
 */
export async function buildPlanner (registry, opts = {}) {
  const complete = await detectLlm();
  if (!complete) return null;
  return {
    complete,
    model: await complete.model(),
    ...plannerPieces(registry, complete, opts)
  };
}

/**
 * What buildPlanner builds around a `complete` it already has. `opts` are a
 * skill pack's options (see patch-options.js); with none, every factory gets
 * exactly the arguments it always did.
 */
function plannerPieces (registry, complete, opts = {}) {
  return {
    /* `runway: 'auto'` — the model gets a short free-text "about" field to
       think in before it must name a skill, but only when the category adapter
       (or the lexical gate) already says there is a skill to find. Measured on
       the 302-question holdout: 212 answered right against 142 without it, and
       4 of 50 no-skill messages leaked against 1 — where the runway on every
       turn answers 217 and leaks 22. See planner.js and turn.js for the gate. */
    planner: llmPlanner({ complete, registry, runway: 'auto', ...opts.plannerOptions }),
    /* The same model, one more pass: a long web answer is trimmed to the
       sentence that answers the question. The model returns a sentence NUMBER
       under a grammar and JS renders that sentence verbatim, so this cannot add
       a word the source did not have — see focus.js. */
    focus: sentenceFocus({ complete, ...opts.focusOptions }),
    /* The decline second look is retired (2026-10-13, Kevin). With the trained
       planner and the trained asks check (v9) it fired twice on the 308+100
       bench and both rescues were wrong; with it off the bench is the same
       290/308 and 1/100 leaks, its two rescues becoming declines. One Pigeon
       fewer on Qwen3.5. `declineCheck` stays in verify.js for the bench's
       --second-look. */
    secondLook: null,
    /* Asked alongside the planner: is this message asking for anything at all?
       A plan for a message that was not is the leak that survives every
       confidence gate, because "my morse code is rusty" really does belong to
       encoding by its words. Measured on the 308+100 bench, with the fallback
       floor already in place: 17 leaks to 12, for one correct answer, at about
       185 ms a turn. See verify.js. */
    asksCheck: asksCheck({ complete, ...opts.asksOptions })
  };
}

/**
 * The category adapter's router, or null when that server is not up. It names
 * the neighbourhood a request belongs to, so skills that share no words with
 * the question are still reachable; below its confidence bar it stands aside
 * and the lexical router answers, which is why a wrong category costs nothing
 * the old router would have got right.
 */
export async function buildCategoryRouter (registry, opts = {}) {
  const complete = await detectLlm({ base: CATEGORY_BASE, role: 'category' });
  if (!complete) return null;
  return {
    router: routerFor(registry, complete, opts),
    model: await complete.model()
  };
}

function routerFor (registry, complete, opts = {}) {
  return categoryRouter({ registry, complete, trained: true,
                          minConfidence: CATEGORY_CONFIDENCE, fallbackFloor: FALLBACK_FLOOR,
                          ...WIDENING,
                          ...opts.routerOptions });
}

/**
 * The app's wiring without the probing: the same planner, focus, second look,
 * asks check and router buildPlanner and buildCategoryRouter build, around
 * `complete` functions the caller supplies. `categoryComplete` may be null (no
 * router). Lets a copy check drive exactly what the app runs.
 */
export function assembleStack ({ registry, complete, categoryComplete = null, packOptions = {} }) {
  return {
    ...plannerPieces(registry, complete, packOptions),
    router: categoryComplete ? routerFor(registry, categoryComplete, packOptions) : null
  };
}
