/* reply.js — §3.5 "template first, model second", and §8's fabrication gate.
 *
 * The order is the whole design:
 *   1. One step, it succeeded, its skill has a replyTemplate → JS renders the
 *      reply and THE CHAT MODEL NEVER RUNS. Zero latency, zero fabrication
 *      risk, and most Pigeon turns are single-step.
 *   2. Anything else — multi-step, a failure to explain, a question the
 *      template doesn't answer — is the Assembler's job.
 *   3. No Assembler installed (which is the case in this build; see the README
 *      ledger) → concatenate the templates. That is §8's own fallback, taken
 *      up front rather than after two wasted model calls.
 *
 * Whichever path runs, the output is SEGMENTS, so the renderer knows which
 * spans are computed values and can mark them (§3.6) without guessing. */

import { render, toPlainText, substituteResultTokens } from './template.js';
import { auditText } from './fabrication.js';
import { refsIn } from './plan.js';
import { parseRef } from './contracts.js';

export const REPLY_SOURCES = Object.freeze({
  TEMPLATE: 'template',
  /* A web answer trimmed to the sentence that answers the question. The model
     chose the sentence NUMBER under a grammar; JS rendered the sentence. See
     focus.js for why it is a selection pass and not a writing one. */
  FOCUSED: 'answer-focused',
  /* A multi-step plan reduced to the one step that is the answer. Same
     mechanism, one level up — and never used when a step failed. */
  FOCUSED_STEP: 'answer-focused (step)',
  TEMPLATES_CONCATENATED: 'templates-concatenated',
  ASSEMBLER: 'assembler',
  ASSEMBLER_FALLBACK: 'assembler-fallback',
  NO_SKILL: 'no-skill'
});

/**
 * @param {Array} results     the executor's results context
 * @param {object} opts
 * @param {Registry} opts.registry
 * @param {string} opts.message
 * @param {object} opts.ctx
 * @param {Function|null} opts.assembler  async ({message, results}) => string
 *        with {{result:sN.field}} tokens. Absent in this build.
 * @param {boolean} opts.forceModel       the "Rephrase" affordance (§3.5)
 * @param {Function|null} opts.focus      async ({message, answer}) => {text} | null
 *        Trims a long web answer to the sentence that answers the question.
 * @param {object|null} opts.plan        the plan these results came from. Used
 *        to tell working from answer in a multi-step turn — see answeringStep.
 */
export async function replyFor (results, { registry, message = '', ctx = {}, assembler = null, forceModel = false, focus = null, plan = null } = {}) {
  if (!results.length) {
    return { source: REPLY_SOURCES.NO_SKILL, segments: [], notes: [] };
  }

  const okSteps = results.filter(r => r.ok);
  const failed = results.filter(r => !r.ok);

  // 1 — the fast path.
  if (!forceModel && results.length === 1 && okSteps.length === 1) {
    const skill = registry.skill(results[0].skill);

    /* 1a — a web answer, focused. The provider returns a whole opening section;
       the question was usually about one sentence of it. Only the passage's own
       sentences can come out of this, so the reply is still the source's words
       and still carries the source's link — what changes is how much of it is
       put in front of the reader. The full text stays one click away under
       "Show plan", and in the value detail behind the marked span, because
       `raw` below is the untrimmed answer. */
    const r = results[0];
    if (focus && r.provenance && r.provenance.kind === 'web' &&
        r.value && typeof r.value.answer === 'string') {
      const got = await focus({ message, answer: r.value.answer });
      if (got && got.text) {
        return {
          source: REPLY_SOURCES.FOCUSED,
          segments: [{
            type: 'value',
            text: got.text,
            /* The whole answer, deliberately: the detail view exists to show
               what the skill actually returned, and trimming that too would
               hide the thing this pass is trusted not to hide. */
            raw: r.value.answer,
            field: 'answer',
            skill: r.skill,
            step: r.id,
            input: r.input,
            provenance: r.provenance
          }],
          notes: [`${got.kept.length} of ${got.of} sentences from the source`],
          /* The one real final model pass in the whole pipeline, recorded so
             the plan view can show it happening. Nothing downstream reads it. */
          focus: { lookingFor: got.lookingFor, kept: got.kept, of: got.of, ms: got.ms }
        };
      }
    }

    if (skill && skill.replyTemplate) {
      return {
        source: REPLY_SOURCES.TEMPLATE,
        segments: renderStep(results[0], skill, ctx),
        notes: []
      };
    }
  }

  // 2 — the Assembler, if this build has one.
  if (assembler && okSteps.length) {
    const attempt = await tryAssembler(assembler, { message, results, ctx });
    if (attempt) return attempt;
  }

  /* 3a — one step of a multi-step plan IS the answer, and the plan says which.
     "20 * 200 = 4000 4000 / 10 = 400" is two true sentences where the question
     wanted one number; the workings are already under Show plan. */
  if (!forceModel && plan && results.length > 1 && !failed.length) {
    const answering = answeringStep(plan, results);
    if (answering) {
      const r = results.find(x => x.id === answering);
      const skill = registry.skill(r.skill);
      return {
        source: REPLY_SOURCES.FOCUSED_STEP,
        /* The step's OWN segments, untouched — so its marked values keep their
           provenance and the detail view still opens on the right step. */
        segments: skill && skill.replyTemplate ? renderStep(r, skill, ctx) : describeUntemplated(r),
        notes: [`step ${answering} of ${results.length}`]
      };
    }
  }

  // 3 — concatenate. §8's fallback: the user always gets a correct reply.
  const segments = [];
  for (const [i, r] of results.entries()) {
    if (i) segments.push({ type: 'text', text: ' ' });
    const skill = registry.skill(r.skill);
    if (r.ok && skill && skill.replyTemplate) segments.push(...renderStep(r, skill, ctx));
    else if (r.ok) segments.push(...describeUntemplated(r));
    else segments.push(...describeFailure(r, skill));
  }
  return {
    source: assembler ? REPLY_SOURCES.ASSEMBLER_FALLBACK : REPLY_SOURCES.TEMPLATES_CONCATENATED,
    segments,
    notes: failed.length ? [`${failed.length} step${failed.length === 1 ? '' : 's'} failed`] : []
  };
}

/* Which step of a plan is the ANSWER, as opposed to working.
 *
 * The plan already contains this and no model is needed to guess it: a step
 * whose output another step consumes is an intermediate. "$s1.result / 10"
 * makes s1 working and s2 the answer, exactly as a person reading the plan
 * would say.
 *
 * Returns a step id only when the plan has ONE terminal step. Two terminal
 * steps mean two things were asked for — "summarise these and give me the
 * median" — and concatenating both is the correct reply, not a fallback.
 *
 * A model was tried here first, given the rendered steps and asked to pick.
 * It got 4 of 6 and defaulted to "show everything" on precisely the chained
 * cases this exists to fix, so it was replaced by the derivation above: no
 * call, no latency, and the same answer every time.
 */
export function answeringStep (plan, results) {
  if (!plan || !Array.isArray(plan.steps) || plan.steps.length < 2) return null;

  /* Every step id referenced by any step in this plan. `refsIn` sees both whole
     and embedded refs, so "$s1.result / 10" counts — which is the whole point. */
  const consumed = new Set();
  for (const step of plan.steps) {
    if (!step || typeof step.input !== 'object') continue;
    for (const ref of refsIn(step.input)) {
      const r = parseRef(ref);
      /* $prev refs point at a previous TURN and say nothing about this plan. */
      if (r && !r.prev) consumed.add(r.stepId);
    }
  }
  if (!consumed.size) return null; // independent steps: nothing is working

  const terminal = results.filter(r => r.ok && !consumed.has(r.id));
  return terminal.length === 1 ? terminal[0].id : null;
}

/* The words for one step. A skill may say a sentence differently when a value
   was never given and fell back to its default — "no tip" rather than "with a
   0% tip", which reads as something the person said. The first variant whose
   fields all defaulted wins; a step with no sources (an old saved turn) keeps
   the plain template. */
export function templateFor (skill, sources) {
  const variants = Array.isArray(skill.replyWhenDefault) ? skill.replyWhenDefault : [];
  if (sources && typeof sources === 'object') {
    for (const v of variants) {
      if (v && Array.isArray(v.defaults) && v.defaults.length && v.defaults.every(f => sources[f] === 'default')) return v.template;
    }
  }
  return skill.replyTemplate;
}

function renderStep (r, skill, ctx) {
  return render(templateFor(skill, r.sources), r.value, {
    skill: r.skill, step: r.id, input: r.input, provenance: r.provenance, locale: ctx.locale
  });
}

/* A skill with no replyTemplate still has to say something. Listing its output
   fields is dull, but it is accurate and it is JS — which beats handing the
   turn to a model because the author forgot a one-line string. */
function describeUntemplated (r) {
  const segs = [];
  const pairs = Object.entries(r.value ?? {});
  pairs.forEach(([k, v], i) => {
    if (i) segs.push({ type: 'text', text: ', ' });
    segs.push({ type: 'text', text: `${humanise(k)} ` });
    segs.push({ type: 'value', text: String(v), raw: v, field: k, skill: r.skill, step: r.id, input: r.input, provenance: r.provenance });
  });
  segs.push({ type: 'text', text: '.' });
  return segs;
}

/* §3.6: "Failed steps render inline: 'Couldn't compute X (invalid date).'"
   The reason comes from the typed error, so the sentence is as specific as the
   failure was and no more. */
function describeFailure (r, skill) {
  const what = skill ? skill.description.replace(/\.$/, '').toLowerCase() : r.skill;
  return [{
    type: 'failure',
    text: `Couldn't ${what} — ${r.error.message}`,
    code: r.error.code,
    field: r.error.field,
    skill: r.skill
  }];
}

const humanise = (k) => k.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();

/* §8: "On a violation the Assembler is re-run once; if it violates again, JS
   falls back to the concatenated replyTemplates." Note what is audited — the
   PROSE the model wrote, with the {{result}} tokens already replaced by real
   values. A number the model typed instead of referencing is exactly what this
   catches, and it is the only thing it needs to catch. */
async function tryAssembler (assembler, { message, results, ctx }) {
  for (let attempt = 0; attempt < 2; attempt++) {
    let raw;
    try {
      raw = await assembler({ message, results: readOnly(results), ctx, retry: attempt > 0 });
    } catch { return null; }
    if (typeof raw !== 'string' || !raw.trim()) return null;

    const segments = substituteResultTokens(raw, results, { locale: ctx.locale });
    const prose = segments.filter(s => s.type === 'text').map(s => s.text).join(' ');
    const audit = auditText(prose, { results, message });
    if (audit.ok) {
      return { source: REPLY_SOURCES.ASSEMBLER, segments, notes: attempt ? ['assembler re-run once'] : [] };
    }
  }
  return null; // caller falls through to the templates
}

/* §3.5 "read-only access to results". A structuredClone is not a security
   boundary — it is a statement about intent that also happens to make an
   accidental mutation impossible. */
function readOnly (results) {
  const copy = typeof structuredClone === 'function'
    ? structuredClone(results.map(r => ({ id: r.id, skill: r.skill, ok: r.ok, value: r.value, error: r.error, provenance: r.provenance })))
    : JSON.parse(JSON.stringify(results));
  return Object.freeze(copy.map(Object.freeze));
}

export { toPlainText };
