/* plan.js — §4.4 plan grammar and its gate.
 *
 * The planner is a language model, so this is where "the model cannot invent a
 * skill name" stops being a hope and becomes a check. Everything the plan can
 * get wrong is caught here, before a single skill runs:
 *   unknown skill · unbuilt skill · ref to a later or missing step · cycle ·
 *   too many steps · a non-object input · a duplicate id.
 *
 * §3.2 says the planner never sees skills outside the router's top-k; that is
 * enforced by what we hand it. This file enforces the stronger claim, which is
 * that it does not matter what it saw. */

import { isRef, parseRef, refsInText, PLAN_LIMITS } from './contracts.js';

export function validatePlan (plan, registry, { prevResults = [] } = {}) {
  const errors = [];
  const bad = (msg, step) => errors.push({ message: msg, step: step ?? null });

  if (!plan || typeof plan !== 'object' || !Array.isArray(plan.steps)) {
    return { ok: false, errors: [{ message: 'A plan must be an object with a "steps" array.', step: null }] };
  }
  /* §3.2: an empty plan is legal and means "no skill needed". It is not an
     error and must not be reported as one — that is the model declining to
     call a skill on a writing or chat message, which is a correct answer. */
  if (plan.steps.length === 0) return { ok: true, errors: [], empty: true };

  if (plan.steps.length > PLAN_LIMITS.MAX_STEPS) {
    bad(`A plan can have at most ${PLAN_LIMITS.MAX_STEPS} steps; this one has ${plan.steps.length}.`);
  }

  const seen = new Set();
  const prevIds = new Set(prevResults.map(r => r.id));

  for (const [i, step] of plan.steps.entries()) {
    const where = step && step.id ? step.id : `step ${i + 1}`;
    if (!step || typeof step !== 'object') { bad('Each step must be an object.', where); continue; }
    if (typeof step.id !== 'string' || !/^[A-Za-z][A-Za-z0-9_]*$/.test(step.id)) {
      bad('Each step needs an id like "s1".', where);
    }
    if (seen.has(step.id)) bad(`Two steps share the id "${step.id}".`, where);
    seen.add(step.id);

    if (typeof step.skill !== 'string') { bad('Each step needs a skill name.', where); continue; }
    const skill = registry.skill(step.skill);
    if (!skill) { bad(`There is no skill called "${step.skill}".`, where); continue; }
    if (skill.unbuilt) { bad(`"${step.skill}" is not built yet.`, where); continue; }

    if (!step.input || typeof step.input !== 'object' || Array.isArray(step.input)) {
      bad('A step\'s input must be an object.', where); continue;
    }

    /* Refs may only point BACKWARD within this turn. That single rule is what
       makes the plan a DAG and the executor a straight walk rather than a
       scheduler — there is no cycle to detect because none can be expressed. */
    for (const ref of refsIn(step.input)) {
      const r = parseRef(ref);
      if (!r) { bad(`"${ref}" is not a valid reference.`, where); continue; }
      if (r.prev) {
        if (!prevIds.has(r.stepId)) bad(`"${ref}" points at a step from the previous turn that isn't there.`, where);
        continue;
      }
      if (r.stepId === step.id) { bad(`"${ref}" refers to its own step.`, where); continue; }
      const target = plan.steps.findIndex(s => s && s.id === r.stepId);
      if (target === -1) bad(`"${ref}" points at a step that doesn't exist.`, where);
      else if (target >= i) bad(`"${ref}" points at a step that hasn't run yet.`, where);
    }
  }

  return { ok: errors.length === 0, errors, empty: false };
}

/** Every $ref string anywhere in a nested input — whole-value refs and the
 *  ones embedded in a larger string alike. Both must be validated: an embedded
 *  ref that pointed forward or at a missing step used to reach the executor
 *  unchecked, because this function could not see it. */
export function refsIn (value, out = []) {
  if (isRef(value)) out.push(value);
  else if (typeof value === 'string') out.push(...refsInText(value));
  else if (Array.isArray(value)) value.forEach(v => refsIn(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach(v => refsIn(v, out));
  return out;
}

/* The planner's most common malformed ref, repaired deterministically.
 *
 * Asked "what is 20 * 200, then multiply by 10", the shipped 2B produced
 *   {"id":"s2","skill":"evaluateExpression","input":{"expression":"s1.result * 10"}}
 * — the right plan with the "$" missing. Nothing downstream could rescue it:
 * the string is not a ref, so it was passed through verbatim and the skill
 * failed on "s". The turn showed 4,000 and then an error, which is the worst of
 * the available outcomes.
 *
 * The grammar cannot prevent this — a ref lives inside a JSON string and the
 * grammar has to admit arbitrary strings — so it is repaired instead, and the
 * repair is deliberately narrow. A bare token is rewritten ONLY when `sN` is
 * the id of an EARLIER step in this same plan. "s1.result" in a plan whose
 * first step is s1 is a reference; the same text in a plan without an s1 is
 * left exactly as the model wrote it.
 *
 * It runs on what the MODEL wrote and never on what the user typed — see
 * llmPlanner, which is the only caller — so a message that happens to contain
 * "s1.foo" cannot be rewritten by it.
 */
export function normalisePlanRefs (plan) {
  if (!plan || !Array.isArray(plan.steps)) return plan;
  const earlier = new Set();
  let touched = false;

  const fixString = (str) => {
    /* A whole-value ref is already correct, and a string that mentions no
       earlier step id cannot contain one of these mistakes. */
    if (isRef(str)) return str;
    return str.replace(/(^|[^$\w.])([A-Za-z][A-Za-z0-9_]*)((?:\.[A-Za-z0-9_]+)+)/g,
      (whole, before, id, path) => {
        if (!earlier.has(id)) return whole;
        touched = true;
        return `${before}$${id}${path}`;
      });
  };
  const walk = (v) => {
    if (typeof v === 'string') return fixString(v);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const out = {};
      for (const [k, val] of Object.entries(v)) out[k] = walk(val);
      return out;
    }
    return v;
  };

  const steps = plan.steps.map((step) => {
    if (!step || typeof step !== 'object') return step;
    const input = step.input && typeof step.input === 'object' && !Array.isArray(step.input)
      ? walk(step.input)
      : step.input;
    /* Added AFTER this step's own input is walked, so a step cannot be repaired
       into referring to itself. */
    if (typeof step.id === 'string') earlier.add(step.id);
    return input === step.input ? step : { ...step, input };
  });

  return touched ? { ...plan, steps } : plan;
}
