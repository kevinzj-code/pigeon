/* executor.js — §3.3. Pure JS. The model never runs anything.
 *
 * The loop, exactly as the spec numbers it:
 *   1 resolve $ref placeholders from completed steps
 *   2 merge ctx (ctx wins — §2.5)
 *   3 validate against inputSchema; on failure → Extractor once → revalidate;
 *     a still-missing REQUIRED field ends the turn with ASK_USER, anything
 *     else is FAILED
 *   4 needsNetwork → webEnabled gate
 *   5 run, catching everything
 *   6 append { step, skill, input, output, provenance, ms }
 *
 * On ASK_USER the turn ends where it is. Steps that already ran keep their
 * results, so answering the question resumes rather than restarts. */

import { ERROR_CODES, OUTCOME, PLAN_LIMITS, parseRef, isRef, refsInText, CTX_OWNED_FIELDS, WEB_HOSTS } from './contracts.js';
import { validate } from './schema.js';
import { mergeInput } from './ctx.js';
import { getPath } from './template.js';
import { auditInput, spentFigures } from './audit-input.js';
import { writtenCurrency } from './extractor.js';

/* What the step already holds, for the question to show. A person asked "Which
   text should I read?" cannot tell whether Pigeon understood the rest of their
   sentence; this is the rest of their sentence, read back. Context, enum
   choices and untouched defaults are left out — they are not things the user
   said, so showing them would pad the answer with the app's own furniture. */
function heldValues (skill, input, field) {
  const props = (skill && skill.inputSchema && skill.inputSchema.properties) || {};
  const out = [];
  for (const [name, value] of Object.entries(input || {})) {
    if (name === field || CTX_OWNED_FIELDS.includes(name)) continue;
    if (value === undefined || value === null || value === '') continue;
    const prop = props[name] || {};
    if (prop.default !== undefined && JSON.stringify(prop.default) === JSON.stringify(value)) continue;
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    out.push({ field: name, text: text.length > 60 ? text.slice(0, 57) + '…' : text });
  }
  return out;
}

export async function runPlan (plan, {
  registry, ctx, message = '', prevResults = [], extractor = null,
  onNetworkConfirm = null, signal = null, known = [], answered = null, consent = null
} = {}) {
  const results = [];
  const started = Date.now();

  for (const step of plan.steps) {
    if (signal && signal.aborted) break;
    const skill = registry.skill(step.skill);
    const t0 = Date.now();

    /* 1 — resolve refs. An unresolvable ref is a hard failure: continuing with
       `undefined` in place of a looked-up currency code produces an answer
       that is wrong rather than absent, which is the one outcome worse than
       a failed step. */
    let input;
    try {
      input = resolveRefs(step.input, results, prevResults);
    } catch (e) {
      results.push(record(step, skill, step.input, {
        ok: false, error: { code: ERROR_CODES.UNRESOLVED_REF, field: null, message: e.message }
      }, t0));
      continue;
    }

    // 2 — ctx wins.
    input = mergeInput(input, ctx);

    /* 2b — the planner's values must come from somewhere. A payload the user
       never gave (a CSV, a JSON body, a table) or a number where the message
       had none is dropped here, so that step 3 sees the field as missing —
       which is what the planner should have produced — and asks for it.
       See audit-input.js for the rule and the measurement behind it. */
    /* Fields filled from an earlier result are that result's figures, not
       numbers the person typed, and the audit must not count them as typed. */
    const fromRefs = Object.entries((step.input && typeof step.input === 'object') ? step.input : {})
      .filter(([, v]) => isRef(v)).map(([k]) => k);
    const audit = auditInput(input, { message, skill, results, prevResults, known, fromRefs });
    input = audit.input;
    const dropped = audit.dropped;

    /* 2c — the planner copies amounts and leaves the symbol in front of them
       behind ("£84.50" planned as bill: 84.5), and the extractor only runs for
       a field that is missing and required. The currency is in what was typed,
       so it is read from there, the one way the extractor reads it. */
    if (message && (input.currency === undefined || input.currency === null || input.currency === '')) {
      const sym = writtenCurrency(skill, message);
      if (sym) input = { ...input, currency: sym };
    }

    /* What arrived before defaults were filled in: everything in here was given
       (typed, planned from the message, or answered); anything validation adds
       beyond it is a default. Kept current through every repair below. */
    let given = input;

    // 3 — validate, then repair once, then ask.
    let v = validate(skill.inputSchema, input);
    if (!v.ok && extractor) {
      try {
        const patch = await extractor({
          message, skill, errors: v.errors, input, ctx,
          /* Fields the audit just removed: the planner's value was not in the
             message, so the extractor must not fall back to the message
             either — that would be the same fabrication by another route.
             D93: nor a payload field the planner left out of a message that
             carries no data ("smooth this over a 5 point window") — there is
             nothing there to fill it from, and the ask is the answer. */
          untraceable: [...dropped.map(d => d.field), ...withheldPayload(skill, input, message, known)]
        });
        if (patch && typeof patch === 'object') {
          for (const f of spentFigures(input, patch, { message, known })) delete patch[f];
          given = mergeInput({ ...input, ...patch }, ctx);
          v = validate(skill.inputSchema, given);
        }
      } catch { /* an Extractor that fails is an Extractor that didn't help. */ }
    }
    if (!v.ok) {
      const missing = v.errors.find(e => e.code === ERROR_CODES.MISSING_FIELD && e.prompt);
      if (missing) {
        /* §3.3 ASK_USER: the question is generated by JS from the schema's own
           `prompt` string. Deterministic, and no model is asked to write it. */
        /* `untraceable` says the field was dropped by the audit: the planner
           supplied a value the message does not contain, so asking is the
           right outcome by construction — the bench scores it that way. */
        const audited = dropped.find(d => d.field === missing.field);
        /* Two ways an ask is the honest outcome: the planner invented a value
           and the audit removed it, or the message simply carries no data of
           the kind the field wants — a payload field ("text", "json", a table)
           on a message with no pasted content. Either way the question is
           right and the bench scores it so; the reason is kept for Show plan. */
        const noData = !audited && isPayloadField(skill, missing.field) && !messageCarriesData(message, known);
        return {
          outcome: OUTCOME.ASK_USER,
          ask: {
            step: step.id, skill: skill.name, field: missing.field, question: missing.prompt,
            /* What it is lined up to do, and what of your sentence it already
               read, so the question can say both. */
            does: skill.description,
            have: heldValues(skill, input, missing.field),
            untraceable: Boolean(audited) || noData,
            why: audited ? 'the plan supplied a value that was not in your message' : (noData ? 'your message did not include it' : null),
            dropped
          },
          results, ms: Date.now() - started
        };
      }
      const first = v.errors[0];
      results.push(record(step, skill, input, {
        ok: false,
        error: { code: first.code, field: first.field, message: first.message }
      }, t0, dropped));
      continue;
    }
    /* 3b — a choice the skill does not offer is asked for, never defaulted:
       validation has just filled in the schema's default, which would answer
       a different question without saying so. See audit-input.js. A missing
       field is asked first (above); this comes after it, so "write these rows
       back out as csv" asks for the rows before the delimiter. */
    const offList = dropped.find(d => d.offList && given[d.field] === undefined);
    if (offList) {
      const prop = (skill.inputSchema.properties || {})[offList.field] || {};
      const label = prop.label || offList.field;
      const choices = prop.enum.map(String);
      const list = choices.length > 1 ? `${choices.slice(0, -1).join(', ')} or ${choices[choices.length - 1]}` : choices[0];
      return {
        outcome: OUTCOME.ASK_USER,
        ask: {
          step: step.id, skill: skill.name, field: offList.field,
          question: prop.prompt || `Which ${label}: ${list}?`,
          does: skill.description,
          have: heldValues(skill, input, offList.field),
          untraceable: true,
          why: `the plan chose ${offList.why}`,
          dropped
        },
        results, ms: Date.now() - started
      };
    }

    input = v.value;

    // 4 — the network gate.
    if (skill.needsNetwork) {
      const consented = Boolean(consent && consent.step === step.id);
      /* A look-up that COULD be made — a provider exists and the person has not
         said never — stops here and asks, the way a missing field does. Only
         when it cannot be made at all is it a failure. */
      if (!ctx.webEnabled && !consented && ctx.webAvailable) {
        const [field, query] = Object.entries(input).find(([k, v]) => typeof v === 'string' && v.trim() && !CTX_OWNED_FIELDS.includes(k)) || [null, ''];
        return {
          outcome: OUTCOME.CONSENT_WEB,
          consent: { step: step.id, skill: skill.name, field, query, hosts: [...WEB_HOSTS] },
          results, ms: Date.now() - started
        };
      }
      if (consented && consent.field && typeof consent.query === 'string' && consent.query.trim() && consent.query.trim() !== input[consent.field]) {
        /* What was in the box when the person said yes is what goes, after the
           same schema check the planned input passed. */
        const edited = validate(skill.inputSchema, { ...input, [consent.field]: consent.query.trim() });
        if (!edited.ok) {
          const first = edited.errors[0];
          results.push(record(step, skill, input, { ok: false, error: { code: first.code, field: first.field, message: first.message } }, t0));
          continue;
        }
        input = edited.value;
      }
      if (!ctx.webEnabled) {
        results.push(record(step, skill, input, {
          ok: false,
          error: { code: ERROR_CODES.NETWORK_OFF, field: null, message: `${skill.name} needs the web, and the web is off.` }
        }, t0));
        continue;
      }
      /* A yes given on the card is the confirmation; it is not asked twice. */
      if (!consented && ctx.confirmBeforeNetwork && onNetworkConfirm) {
        const allowed = await onNetworkConfirm({ skill: skill.name, input });
        if (!allowed) {
          results.push(record(step, skill, input, {
            ok: false,
            error: { code: ERROR_CODES.NETWORK_OFF, field: null, message: 'The request wasn\'t sent.' }
          }, t0));
          continue;
        }
        /* The person may rewrite the query before saying yes. What they wrote is
           what goes, after the same schema check the planned input passed. */
        if (typeof allowed === 'object' && allowed.input && typeof allowed.input === 'object') {
          const edited = validate(skill.inputSchema, allowed.input);
          if (!edited.ok) {
            const first = edited.errors[0];
            results.push(record(step, skill, allowed.input, {
              ok: false,
              error: { code: first.code, field: first.field, message: first.message }
            }, t0));
            continue;
          }
          input = edited.value;
        }
      }
    }

    // 5 — run. Skills can't throw out; this is the belt to that braces.
    let env;
    try {
      env = await withBudget(skill.run(input, ctx), PLAN_LIMITS.SKILL_TIMEOUT_MS);
    } catch (e) {
      env = {
        ok: false,
        error: e && e.code === ERROR_CODES.TIMEOUT
          ? { code: ERROR_CODES.TIMEOUT, field: null, message: `${skill.name} took longer than ${PLAN_LIMITS.SKILL_TIMEOUT_MS}ms.` }
          : { code: ERROR_CODES.INTERNAL, field: null, message: (e && e.message) || 'The skill failed unexpectedly.' }
      };
    }
    if (!env || typeof env !== 'object' || typeof env.ok !== 'boolean') {
      env = { ok: false, error: { code: ERROR_CODES.INTERNAL, field: null, message: `${skill.name} returned something that isn't an envelope.` } };
    }

    /* 5b — a field the schema could not know was needed.
       Some skills only discover a requirement once they see the values:
       convertCookingMeasure needs an ingredient to cross between a volume and a
       weight, and needs nothing extra to convert cups to millilitres. That is
       not expressible in the JSON-Schema subset, so the skill returns
       MISSING_FIELD from run() instead — and without this branch that lands in
       the UI as a FAILED step, which is a question rendered as an error.
       §3.3's escalation is the same either way: Extractor once, then ask. */
    if (!env.ok && env.error.code === ERROR_CODES.MISSING_FIELD && env.error.field) {
      const field = env.error.field;
      if (extractor) {
        try {
          const patch = await extractor({ message, skill, errors: [env.error], input, ctx, needField: field, untraceable: dropped.map(d => d.field) });
          if (patch) for (const f of spentFigures(input, patch, { message, known })) delete patch[f];
          if (patch && patch[field] !== undefined) {
            const patched = mergeInput({ ...input, ...patch }, ctx);
            const retry = validate(skill.inputSchema, patched);
            if (retry.ok) {
              try { env = await withBudget(skill.run(retry.value, ctx), PLAN_LIMITS.SKILL_TIMEOUT_MS); }
              catch { /* keep the original MISSING_FIELD */ }
              if (env && env.ok) { input = retry.value; given = { ...given, ...patched }; }
            }
          }
        } catch { /* an Extractor that fails is an Extractor that didn't help. */ }
      }
      if (!env.ok && env.error.code === ERROR_CODES.MISSING_FIELD) {
        const prop = (skill.inputSchema.properties || {})[field] || {};
        return {
          outcome: OUTCOME.ASK_USER,
          ask: {
            step: step.id, skill: skill.name, field,
            does: skill.description,
            have: heldValues(skill, input, field),
            /* The skill's own message is preferred here over the schema's
               generic prompt: it is the one that knows WHY the field became
               necessary. */
            question: env.error.message || prop.prompt || `What should I use for ${field}?`
          },
          results, ms: Date.now() - started
        };
      }
    }

    // 6 — record, with where each value came from.
    results.push({ ...record(step, skill, input, env, t0, dropped), sources: sourcesOf(input, given, { ctx, step, answered }) });
  }

  return {
    outcome: results.some(r => !r.ok) ? OUTCOME.FAILED : OUTCOME.OK,
    ask: null, results, ms: Date.now() - started
  };
}

/* A field that wants content rather than a name or a number: a string with
   no enum, or an object/array. The names are the ones skills actually use. */
function isPayloadField (skill, field) {
  const prop = (skill && skill.inputSchema && skill.inputSchema.properties || {})[field];
  if (!prop) return false;
  if (Array.isArray(prop.enum)) return false;
  if (prop.type === 'object' || prop.type === 'array') return true;
  return prop.type === 'string' && /^(text|json|html|csv|markdown|md|table|rows|data|content|body|passage|paragraph|document|source|before|after|items|values|list|query|code|binary|hex|base64|morse|encoded|schema|expression|template|xml|yaml|sql|lines|string|input|sample|first|second|left|right|original|revised)$/i.test(field);
}

/* Does the message (or an answer the user typed) contain anything that could
   BE a payload — a second line, a quoted span, text after a colon, or a run
   of structured characters? If not, a payload field cannot be filled from it
   and asking is the only honest move. */
/* D93: the required payload fields a plan left out of a message that carries
   no data. The extractor must not fill these from the message. */
function withheldPayload (skill, input, message, known) {
  if (messageCarriesData(message, known)) return [];
  return (skill.inputSchema?.required || []).filter(f => isPayloadField(skill, f) && (input?.[f] === undefined || input?.[f] === null || input?.[f] === ''));
}

export function messageCarriesData (message, known = []) {
  const all = [message, ...known].join('\n');
  return /\n/.test(all.trim()) || /:\s*\S/.test(all) || /["“”']([^"“”']{2,})["“”']/.test(all) || /[{}\[\]|]/.test(all) || (all.match(/,/g) || []).length >= 2;
}

/* Where each value in a step's input came from:
     context  — the app's own (today's date, the timezone), never the person;
     asked    — the answer to the question this step asked;
     given    — present before validation: typed, or planned from the message;
     default  — filled in by the skill's schema because nothing was given.
   What the person is shown as "what Patch used" is given and asked only. */
function sourcesOf (input, given, { ctx, step, answered }) {
  const out = {};
  for (const k of Object.keys(input || {})) {
    if (input[k] === undefined) continue;
    if (CTX_OWNED_FIELDS.includes(k) && ctx && ctx[k] !== undefined) out[k] = 'context';
    else if (answered && answered.field === k && answered.step === step.id) out[k] = 'asked';
    else if (given && Object.prototype.hasOwnProperty.call(given, k) && given[k] !== undefined) out[k] = 'given';
    else out[k] = 'default';
  }
  return out;
}

function record (step, skill, input, env, t0, dropped = []) {
  return {
    id: step.id,
    skill: step.skill,
    input,
    /* Fields the audit removed before the step ran, kept so Show plan can say
       "the planner supplied X; it was not in your message and was not used". */
    ...(dropped.length ? { dropped } : {}),
    ok: env.ok,
    value: env.ok ? env.value : undefined,
    error: env.ok ? undefined : env.error,
    provenance: env.ok ? env.provenance : null,
    labels: (skill && skill.labels) || [],
    /* What each input is called where a person reads it ("tip %"), for the
       value chips' hover and the Change sheet. Only fields that have one. */
    ...fieldLabelsOf(skill),
    /* The name a person reads, when the skill has one; the page humanises the
       code name otherwise. */
    ...(skill && skill.title ? { title: skill.title } : {}),
    ms: Date.now() - t0
  };
}

/* A synchronous skill cannot be interrupted from here — there is no preemption
   in a single JS thread. So the budget is enforced two ways: async work loses
   the race, and sync work that overran is reported as a TIMEOUT after the fact.
   The second is a diagnostic, not a guarantee, and saying so is cheaper than
   pretending otherwise. */
async function withBudget (maybePromise, ms) {
  if (!maybePromise || typeof maybePromise.then !== 'function') return maybePromise;
  let timer;
  try {
    return await Promise.race([
      maybePromise,
      new Promise((_, rej) => {
        timer = setTimeout(() => {
          const e = new Error('budget exceeded'); e.code = ERROR_CODES.TIMEOUT; rej(e);
        }, ms);
      })
    ]);
  } finally { clearTimeout(timer); }
}

/** One ref, resolved to the value it names, or an explanatory throw. */
function lookupRef (ref, results, prevResults) {
  const r = parseRef(ref);
  const pool = r.prev ? prevResults : results;
  const step = pool.find(x => x.id === r.stepId);
  if (!step) throw new Error(`${ref} — step ${r.stepId} isn't in ${r.prev ? 'the previous turn' : 'this plan'}.`);
  if (!step.ok) throw new Error(`${ref} — step ${r.stepId} failed, so there is nothing to read from it.`);
  const out = r.path.length ? getPath(step.value, r.path.join('.')) : step.value;
  if (out === undefined) throw new Error(`${ref} — step ${r.stepId} has no "${r.path.join('.')}".`);
  return out;
}

/* A resolved value, rendered for use inside a larger string. Scalars print as
   themselves; anything structured is JSON, which is defined behaviour rather
   than "[object Object]" landing in an expression. */
const inline = (v) => (v !== null && typeof v === 'object' ? JSON.stringify(v) : String(v));

/** §3.3 step 1 — "$s1.currency" and "$prev.s1.currency", whole or embedded. */
export function resolveRefs (value, results, prevResults) {
  /* A WHOLE-VALUE ref keeps its type: a number stays a number, an array stays
     an array, and a schema expecting one is satisfied. This case must stay
     first — interpolating it would turn every referenced number into a string. */
  if (isRef(value)) return lookupRef(value, results, prevResults);

  /* An EMBEDDED ref — "$s1.result * 10" — can only produce text, and that is
     the point: it is how a plan computes over an earlier result. Without this,
     a chained question ("what is 20 * 200, then multiply by 10") had no
     expressible plan at all; the model wrote the obvious one and the string
     reached the skill verbatim. */
  if (typeof value === 'string') {
    const refs = refsInText(value);
    if (!refs.length) return value;
    let out = value;
    for (const ref of refs) {
      /* Resolved before substituting, so an unresolvable ref still throws and
         the step fails cleanly rather than half-substituting. */
      const resolved = inline(lookupRef(ref, results, prevResults));
      out = out.split(ref).join(resolved);
    }
    return out;
  }

  if (Array.isArray(value)) return value.map(v => resolveRefs(v, results, prevResults));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = resolveRefs(v, results, prevResults);
    return out;
  }
  return value;
}

function fieldLabelsOf (skill) {
  const props = (skill && skill.inputSchema && skill.inputSchema.properties) || {};
  const out = {};
  for (const [k, p] of Object.entries(props)) if (p && typeof p.label === 'string' && p.label) out[k] = p.label;
  return Object.keys(out).length ? { fieldLabels: out } : {};
}
