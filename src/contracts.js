/* contracts.js — Pigeon §4, the shapes everything else agrees on.
 *
 * INVARIANT: a skill's `run` returns an Envelope and never throws out. The
 * executor wraps every call in try/catch anyway, because "never throws" is a
 * contract and contracts get broken; but a skill that throws is a bug in that
 * skill, not a supported path.
 *
 * Nothing in this file imports anything. It is the bottom of the stack. */

/* §4.3 error codes. ASK_USER is deliberately NOT in here — it is a non-error
   outcome, and putting it beside the failures is how it ends up rendered like
   one. It lives in OUTCOME below. */
export const ERROR_CODES = Object.freeze({
  INVALID_INPUT: 'INVALID_INPUT',
  MISSING_FIELD: 'MISSING_FIELD',
  UNRESOLVED_REF: 'UNRESOLVED_REF',
  NETWORK_OFF: 'NETWORK_OFF',
  NETWORK_FAILED: 'NETWORK_FAILED',
  TIMEOUT: 'TIMEOUT',
  UNBUILT: 'UNBUILT',
  INTERNAL: 'INTERNAL'
});

export const OUTCOME = Object.freeze({
  OK: 'OK',
  FAILED: 'FAILED',
  ASK_USER: 'ASK_USER',
  /* A look-up that could be made and has not been agreed to. Like ASK_USER the
     plan stops and waits, and nothing has left the machine. */
  CONSENT_WEB: 'CONSENT_WEB'
});

/* The only hosts a look-up contacts (src-tauri/src/lib.rs web_search). Named
   here so the question put to the person lists exactly these. */
export const WEB_HOSTS = Object.freeze(['api.duckduckgo.com', 'en.wikipedia.org']);

/* §3.3: provenance.kind is the one thing the UI reads to decide how a value is
   marked. "computed" = this machine did the arithmetic. "bundled" = it came out
   of a table that shipped with the app, and therefore has a date. "web" = it
   came off the network and therefore has a source. */
export const PROVENANCE_KINDS = Object.freeze(['computed', 'bundled', 'web']);

/** Success envelope. §4.3 */
export function ok (value, provenance) {
  return {
    ok: true,
    value,
    provenance: normaliseProvenance(provenance)
  };
}

/** Failure envelope. §4.3 */
export function fail (code, message, field = null) {
  if (!ERROR_CODES[code]) code = ERROR_CODES.INTERNAL;
  return { ok: false, error: { code, field, message: String(message) } };
}

/* A bundled table without a date is exactly the kind of unlabelled claim the
   whole design exists to prevent, so this throws rather than defaulting. Same
   for a web value without a source. Both are author errors, caught at the
   first test run, never at runtime in front of a user. */
export function normaliseProvenance (p) {
  const kind = (p && p.kind) || 'computed';
  if (!PROVENANCE_KINDS.includes(kind)) {
    throw new Error(`provenance.kind must be one of ${PROVENANCE_KINDS.join('|')}, got ${kind}`);
  }
  if (kind === 'bundled' && !(p && p.dataAsOf)) {
    throw new Error('provenance.kind "bundled" requires dataAsOf (§3 honesty: bundled data shows its date)');
  }
  if (kind === 'web' && !(p && p.source)) {
    throw new Error('provenance.kind "web" requires source (§3 honesty: web values show their source)');
  }
  return {
    kind,
    dataAsOf: (p && p.dataAsOf) || null,
    source: (p && p.source) || null
  };
}

/** Convenience for the common case: this machine did the arithmetic. */
export const computed = () => ({ kind: 'computed', dataAsOf: null, source: null });
/** For a lookup answered from a table that shipped in the bundle. */
export const bundled = (dataAsOf) => ({ kind: 'bundled', dataAsOf, source: null });
/** For a value that came off the network. The source is not optional — it is
    the whole difference between a web answer and a made-up one. */
export const web = (source) => ({ kind: 'web', dataAsOf: null, source });

/* §4.2 — the harness wraps the model's `input`. The model never writes ctx;
   §2.5 says now/timezone/locale/units come from the device. mergeCtx enforces
   that direction: ctx fields overwrite anything the model put in input. */
export const CTX_OWNED_FIELDS = Object.freeze(['now', 'timezone', 'locale', 'units', 'webEnabled']);

export function envelope (input, ctx) {
  return { input: { ...input }, ctx: { ...ctx } };
}

/* §4.4 plan grammar. A ref is "$<stepId>.<path>" for this turn, or
   "$prev.<stepId>.<path>" for the previous turn's results. */
export const REF_RE = /^\$(prev\.)?([A-Za-z][A-Za-z0-9_]*)((?:\.[A-Za-z0-9_]+)*)$/;

/* The same shape, unanchored, for a ref that sits INSIDE a larger string.
   `REF_RE` above is anchored on purpose and stays that way: a whole-value ref
   substitutes the value with its TYPE intact, so a number stays a number and a
   schema expecting one is satisfied. This second form is for the other case —
   "$s1.result * 10", an expression built around an earlier result — where the
   only possible outcome is text. Both are needed and they are not the same
   operation, which is why there are two regexes and not one loose one. */
export const REF_IN_TEXT_RE = /\$(prev\.)?([A-Za-z][A-Za-z0-9_]*)((?:\.[A-Za-z0-9_]+)*)/g;

/** Every `$ref` appearing inside a string, in order. Empty for a whole ref. */
export function refsInText (v) {
  if (typeof v !== 'string' || isRef(v)) return [];
  return [...v.matchAll(REF_IN_TEXT_RE)].map(m => m[0]);
}

export function isRef (v) {
  return typeof v === 'string' && REF_RE.test(v);
}

export function parseRef (v) {
  const m = REF_RE.exec(v);
  if (!m) return null;
  return {
    prev: Boolean(m[1]),
    stepId: m[2],
    path: m[3] ? m[3].slice(1).split('.') : []
  };
}

export const PLAN_LIMITS = Object.freeze({
  /* §10 open decision 5 says 8 is a guess. It is exported rather than inlined
     so changing the guess is a one-line change with a test behind it. */
  MAX_STEPS: 8,
  /* §3.3 budget. Per-skill wall clock, desktop tier. */
  SKILL_TIMEOUT_MS: 2000
});
