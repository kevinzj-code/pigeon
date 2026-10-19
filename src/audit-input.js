/* audit-input.js — §3.2 rule 3, enforced rather than requested.
 *
 *   "Copy values out of the message. Never invent a number, date, name or
 *    unit that is not there."
 *
 * The planner is told this and, measured, does not always do it: on the
 * 302-question holdout, 26.5% of the shipped 2B's plans carried a number the
 * message never contained, and the first trained adapter pushed that to 40%.
 * The shape of the failure is specific. Asked "read this csv into columns"
 * with no CSV attached, the planner does not leave `text` out so the executor
 * can ask — it writes one: "name,age\nAna,34\nBo,28". The skill parses it,
 * the reply marks the values as computed, and `fabrication.js` licenses every
 * number in it on the stated assumption that a step's input "either came from
 * the user's message or from an earlier result". That assumption is what this
 * file makes true.
 *
 * WHAT IS AUDITED, AND WHAT IS NOT. The rule is narrow on purpose, because
 * the planner legitimately normalises: "christmas" becomes 2026-12-25, "km"
 * becomes a unit code, "double it" becomes 2, "18 months" becomes 1.5 years.
 * None of those appear in the message and all of them are correct. So:
 *
 *   · PAYLOADS are audited. A content-bearing string (long, multi-line, or
 *     structured), or an object or array with several leaves, must be
 *     findable in the message or in an earlier result. A CSV, a JSON body, a
 *     table, a paragraph — if the user did not give it, the planner made it
 *     up, and the field is dropped.
 *   · NUMBERS are audited only when the message contains NO quantity at all.
 *     A message with a number in it may legitimately produce a different
 *     number (a derivation); a message with none cannot produce any.
 *   · Short strings, booleans, enum values, schema defaults, `$refs` and
 *     ctx-owned fields are never touched.
 *
 * A dropped field is not an error. The input goes on to schema validation
 * exactly as if the planner had left the field out — which is what it should
 * have done — and the executor's existing path takes over: the Extractor
 * tries to find the value in the message, and if it cannot, ASK_USER asks.
 * "What CSV should I read?" is the correct reply to a request that carried
 * none. A fabricated answer never is.
 *
 * Hand-written plans (the Run a plan screen) carry no message and are not
 * audited: the person wrote the values, and there is nothing to trace them
 * against. */

import { isRef, refsInText, CTX_OWNED_FIELDS } from './contracts.js';
import { numbersIn } from './fabrication.js';
import { derivedNumbers } from './derive.js';
import { validate } from './schema.js';

/* Whitespace is the one thing a planner reformats freely — a CSV with spaces
   after commas, JSON pretty-printed or not — so containment is tested with
   all of it removed from both sides. Case too. */
/* "this document", "these rows", "that list": a message naming the thing to
   work on without containing it. Shared shape with extractor.js's rule. */
const POINTS_AT_ABSENT = /\bth(?:is|ese|at|ose)\b|\bmy\b|\bfrom this\b|\bin (?:this|here)\b/i;
const squash = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, '');
const unquote = (s) => String(s).replace(/^[\s"'`]+|[\s"'`]+$/g, '');

/* How many times a figure was typed: as digits, plus once more if it is also
   written in words ("twelve people and a 12% tip"). */
function timesTyped (n, text) {
  let c = 0;
  for (const m of text.matchAll(/\d[\d,]*(?:\.\d+)?/g)) if (Math.abs(Number(m[0].replace(/,/g, '')) - n) < 1e-9) c++;
  if (numbersIn(text.replace(/\d[\d,]*(?:\.\d+)?/g, ' ')).has(n)) c++;
  return c;
}

/**
 * ONE FIGURE, ONE FIELD, for what the extractor fills in. The audit holds the
 * planner to it; the extractor, filling a required field the plan left out,
 * reads the message afresh and can take a figure the plan has already used.
 * "take 10% off that" was planned, correctly, as {percent: 10} with no price;
 * the extractor then read price 10 from the same "10", and Patch answered
 * "10 less 10% is 9" to a question that never gave a price (click-through 6,
 * 2026-10-12). Returns the filled fields to discard: a number typed n times
 * fills at most n fields counting the ones already held, and when the fill
 * would go past that, its fields with that figure are dropped and asked for.
 */
export function spentFigures (held, fill, { message = '', known = [] } = {}) {
  if (!fill || typeof fill !== 'object') return [];
  const text = [message, ...known].join('\n');
  const numberFields = (o) => Object.entries(o || {}).filter(([f, v]) => typeof v === 'number' && !CTX_OWNED_FIELDS.includes(f));
  const added = numberFields(fill).filter(([f]) => !Object.prototype.hasOwnProperty.call(held || {}, f) || held[f] === undefined);
  const out = [];
  for (const n of new Set(added.map(([, v]) => v))) {
    const typed = timesTyped(n, text);
    if (typed === 0) continue;
    const already = numberFields(held).filter(([, v]) => Math.abs(v - n) < 1e-9).length;
    const mine = added.filter(([, v]) => v === n).map(([f]) => f);
    if (already + mine.length > typed) out.push(...mine);
  }
  return out;
}

const OFF_LIST = Symbol('not one of the skill\'s choices');

/** A string that carries content rather than naming something. */
export function isPayloadString (s) {
  if (typeof s !== 'string') return false;
  if (s.length >= 40) return true;
  if (/\n/.test(s)) return true;
  if (/[{}[\]|]/.test(s)) return true;
  return (s.match(/,/g) || []).length >= 2;
}

/** Every scalar inside a value, with a flag for whether it looks like data. */
function leaves (v, out = []) {
  if (v === null || v === undefined) return out;
  if (Array.isArray(v)) { v.forEach(x => leaves(x, out)); return out; }
  if (typeof v === 'object') { Object.values(v).forEach(x => leaves(x, out)); return out; }
  out.push(v);
  return out;
}

const deepEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Audit a step's input against what the user actually said.
 *
 * @param {object} input        the step's input, refs already resolved
 * @param {object} opts
 * @param {string} opts.message the user's message this turn
 * @param {object} opts.skill   the registry entry (for its inputSchema)
 * @param {Array}  opts.results earlier results this turn
 * @param {Array}  opts.prevResults
 * @param {Array<string>} opts.known  other text that counts as the user's —
 *        an answer they gave to an ASK_USER, for instance
 * @param {Array<string>} opts.fromRefs fields the plan filled from an earlier
 *        result ($s1.x, $prev.s1.x): figures already worked out, not typed
 * @returns {{input: object, dropped: Array<{field:string, value:any, why:string}>}}
 */
export function auditInput (input, { message = '', skill, results = [], prevResults = [], known = [], fromRefs = [] } = {}) {
  /* Nothing to trace against: a hand-written plan. The values are the
     person's own. */
  if (!message && !known.length) return { input, dropped: [] };

  const props = (skill && skill.inputSchema && skill.inputSchema.properties) || {};
  const required = (skill && skill.inputSchema && skill.inputSchema.required) || [];

  /* The corpus a value may come from: the message, anything the user typed
     in answer to a question, and every earlier result — a later step may
     legitimately quote what an earlier one produced. */
  const sources = [message, ...known];
  for (const r of [...results, ...prevResults]) if (r && r.ok) sources.push(JSON.stringify(r.value));
  const corpus = squash(sources.join('\n'));
  const corpusNumbers = new Set();
  for (const s of sources) for (const n of numbersIn(s)) corpusNumbers.add(n);
  /* A hex colour is not a quantity. "#556B2F" reads as 556 to the numeral
     scan and would license any number the planner invents beside it — which
     is how `count: 1` got through for "tints and shades of #556B2F". */
  /* D94 (2026-10-11): a number the derivation rules work out from the
     person's words ("a fifth" → 0.2, "a marathon" → 42.195) counts as stated,
     in a payload and in a message with no digits. */
  const derived = derivedNumbers([message, ...known].join('\n'));
  for (const n of derived) corpusNumbers.add(n);
  const userGaveAQuantity = derived.size > 0 || numbersIn([message, ...known].join('\n').replace(/#[0-9a-f]{3,8}\b/gi, ' ')).size > 0;
  /* The request itself, handed back as the text to work on. "grab the bullets
     from this" → extractListItems({text: "grab the bullets from this"}) is
     found in the message by construction, and is still not what the person
     meant: the message points at a document it does not contain. */
  const requestIsThePayload = (s) => squash(unquote(s)) === squash(message) && POINTS_AT_ABSENT.test(message) && !/\n|:\s*\S|["“”']([^"“”']{2,})["“”']/.test(message);

  const found = (s) => {
    const q = squash(unquote(s));
    return q.length === 0 || corpus.includes(q);
  };
  const foundNumber = (n) => [...corpusNumbers].some(a => Math.abs(a - n) < 1e-9);

  /* ONE FIGURE, ONE FIELD. "split the bill 3 ways with a 10% tip" was planned
     as {bill: 3, people: 3}: the 3 is in the message, so the rule above lets
     it through, and a bill of 3 was worked out as if it had been given. A
     figure typed once can fill one number field of a step, not two. When it
     fills more, none of them keeps it — the extractor puts it back where the
     message's own wording says ("3 ways" is people), and whatever is left is
     asked. A value the message does not contain is a derivation and is not
     counted here. */
  const typedTimes = (n) => timesTyped(n, [message, ...known].join('\n'));
  const byValue = new Map();
  for (const [field, value] of Object.entries(input || {})) {
    if (typeof value !== 'number' || CTX_OWNED_FIELDS.includes(field) || fromRefs.includes(field)) continue;
    if (props[field]?.default !== undefined && deepEqual(props[field].default, value)) continue;
    byValue.set(value, [...(byValue.get(value) || []), field]);
  }
  const reused = new Set();
  for (const [value, fields] of byValue) {
    const times = typedTimes(value);
    if (fields.length > 1 && times > 0 && times < fields.length) fields.forEach(f => reused.add(f));
  }

  const out = {};
  const dropped = [];
  for (const [field, value] of Object.entries(input || {})) {
    const prop = props[field] || {};
    const why = reused.has(field) ? `your message has ${value} once, and the plan used it for more than one thing` : untraceable(field, value, prop);
    if (why === OFF_LIST) dropped.push({ field, value, why: `${JSON.stringify(value)} is not one of its choices (${prop.enum.join(', ')})`, offList: true });
    else if (why) dropped.push({ field, value, why });
    else out[field] = value;
  }
  return { input: out, dropped };

  function untraceable (field, value, prop) {
    if (CTX_OWNED_FIELDS.includes(field)) return null;
    if (value === null || value === undefined || typeof value === 'boolean') return null;
    if (isRef(value) || (typeof value === 'string' && refsInText(value).length)) return null;
    if (Array.isArray(prop.enum) && prop.enum.some(e => deepEqual(e, value))) return null;
    /* A value the skill does not offer ("fibonacci up to the 12th" planned as
       mode: "up" when the modes are nth and sequence). Dropped, and the
       executor ASKS for it: 49 of the 58 enum fields have a default, and
       falling back to it would answer a different question without saying so
       (nth gives the 12th number, not the sequence up to it). The schema's own
       case-and-punctuation match counts as on the list ("sha512" is SHA-512). */
    if (Array.isArray(prop.enum) && !validate({ enum: prop.enum }, value).ok) return OFF_LIST;
    if (prop.default !== undefined && deepEqual(prop.default, value)) return null;

    /* `first: []` for "which entries appear on both lists" is the planner
       leaving the argument out while pretending not to. An empty list is an
       absent list; dropping it turns the skill's INVALID_INPUT into the
       field's own question. Skills keep rejecting [] in hand-written plans,
       which the audit never sees. */
    if (Array.isArray(value) && value.length === 0 && required.includes(field)) return 'the plan left this list empty';

    if (typeof value === 'string') {
      /* A name, a unit, a date, a word: the planner's to normalise. */
      if (requestIsThePayload(value)) return 'the plan used your request as the text to work on';
      if (!isPayloadString(value)) return null;
      return found(value) ? null : 'this text is not in your message';
    }

    if (typeof value === 'number') {
      if (userGaveAQuantity) return null;
      if (foundNumber(value)) return null;
      return 'your message has no number to take this from';
    }

    if (typeof value === 'object') {
      const ls = leaves(value);
      /* A small option object — {style: 'title'} — is configuration, not data. */
      const payload = ls.length >= 3 || ls.some(isPayloadString);
      if (!payload) return null;
      for (const leaf of ls) {
        if (typeof leaf === 'string' && leaf.length && !found(leaf)) return `"${leaf.slice(0, 30)}" is not in your message`;
        if (typeof leaf === 'number' && !foundNumber(leaf)) return `the number ${leaf} is not in your message`;
      }
      return null;
    }
    return null;
  }
}
