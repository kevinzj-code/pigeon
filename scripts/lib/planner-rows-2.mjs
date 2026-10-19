/* planner-rows-2.mjs — the checks every round-2 planner row passes.
 *
 * Round 1 (plannerdata.mjs) took its single-step rows from the skills' own
 * examples, so every message was a skill's example and the trained planner
 * met the bench's phrasings for the first time on the bench (238 and 244 of
 * 308; patch-planner-misses.md (a write-up outside this repo)). Round 2's messages are written
 * new, per skill and per twin pair, and nothing is trusted on faith: a row is
 * kept only when
 *
 *   - its plan validates against the registry;
 *   - every number in the plan is one the message states (or one of them in
 *     another unit), and every string of the person's own text is in it
 *     (`untraced`);
 *   - "full": the plan runs without an ask, or a web skill stops at the web
 *     switch;
 *   - "pointed": the message points at what it does not include ("count the
 *     words in this"), the plan leaves that argument out, and running it asks
 *     for exactly that argument;
 *   - the real router puts its skill on the shortlist it would hand the
 *     planner (a row naming a skill the planner was not shown teaches
 *     hallucination: plannerdata's rule);
 *   - it is not within reach of any message the bench grades on, nor of the
 *     skill's own examples (its card's `e.g.` included).
 *
 * Node-only.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { validatePlan } from '../../src/plan.js';
import { runPlan } from '../../src/executor.js';
import { HOLDOUT } from '../holdout.mjs';
import { NO_SKILL_MESSAGES } from '../no-skill-set.mjs';
import { checkDerivation, valueAt, without, RULES } from './derive.mjs';

/* The frozen clock every planner row is built against (plannerdata's). */
export const CTX = {
  now: '2026-09-01T09:00:00Z', timezone: 'UTC', locale: 'en-GB',
  units: 'metric', webEnabled: false, confirmBeforeNetwork: true
};

export const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9%]+/g, ' ').trim();
const STOP = new Set('a an the of to or and in on by for from with into as is it its be are was me my i you your we our us this that these those what which how can could would please just do does'.split(' '));
export const words = (s) => new Set(norm(s).split(' ').filter(w => w && !STOP.has(w)));
export function jaccard (a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  return inter / (a.size + b.size - inter);
}

/* How close is too close. A held-out message shares its content words with
   the row at this Jaccard or more (or normalises to the same text); an
   example, at the lower bar, since a paraphrase of one changes more words. */
export const HELD_OUT_REACH = 0.6;
export const EXAMPLE_REACH = 0.5;

/** Every message the bench grades on: the planner bench's holdout and
 *  no-skill set, and every quoted phrase in followups.mjs. */
export async function heldOutMessages (root) {
  const followups = await readFile(join(root, 'scripts/followups.mjs'), 'utf8');
  const all = [...HOLDOUT.map(([m]) => m), ...NO_SKILL_MESSAGES, ...[...followups.matchAll(/'([^'\n]{4,})'/g)].map(m => m[1])];
  return { exact: new Set(all.map(norm)), sets: all.map(words).filter(s => s.size >= 3) };
}

export function closeToHeldOut (message, heldOut) {
  if (heldOut.exact.has(norm(message))) return true;
  const w = words(message);
  return heldOut.sets.some(s => jaccard(w, s) >= HELD_OUT_REACH);
}

export function closeToExamples (message, skill) {
  const w = words(message);
  return (skill.examples || []).some(e => e.text && jaccard(w, words(e.text)) >= EXAMPLE_REACH);
}

/* Numbers a person writes as words, so "split it two ways" can say 2, and
   the words that name a number ("hex" is base 16, "a fortnight" 14 days). */
const NUMBER_WORDS = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50, hundred: 100, thousand: 1000,
  half: 0.5, quarter: 0.25, dozen: 12, double: 2, triple: 3, twice: 2, once: 1, first: 1, second: 2, third: 3,
  hex: 16, hexadecimal: 16, binary: 2, octal: 8, decimal: 10, fortnight: 14, week: 7, million: 1000000,
  free: 0, nothing: 0, nil: 0 };
/* Month names and their short forms are months 1–12. */
['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
  .forEach((m, i) => { NUMBER_WORDS[m] = i + 1; NUMBER_WORDS[m.slice(0, 3)] = i + 1; });
NUMBER_WORDS.sept = 9;
/* A number the plan works out from one the person wrote by a unit's factor:
   2 years as 24 months, 1.5 hours as 90 minutes, 15% as 0.15. */
const FACTORS = [1, 7, 12, 24, 60, 100, 1000, 3600];
const flat = (s) => String(s).toLowerCase().replace(/[‘’“”"']/g, '').replace(/\s+/g, ' ').trim();

/** Every number the message states: digits (thousands commas allowed, any
 *  trailing zeros), clock-style times as minutes or seconds, number words. */
function statedNumbers (text) {
  /* "1,250" is one number, and "Q1,900" in a CSV row is two: both readings
     are kept. */
  const plain = text.replace(/(\d),(?=\d{3}\b)/g, '$1');
  const out = [...(plain.match(/\d+(?:\.\d+)?/g) || []), ...(text.match(/\d+(?:\.\d+)?/g) || [])].map(Number);
  for (const [, a, b, c] of plain.matchAll(/\b(\d{1,3}):(\d{2})(?::(\d{2}))?\b/g)) {
    const [x, y, z] = [Number(a), Number(b), c === undefined ? null : Number(c)];
    out.push(z === null ? x * 60 + y : x * 3600 + y * 60 + z, x + y / 60);
  }
  for (const w of text.match(/[a-z]+/g) || []) if (w in NUMBER_WORDS) out.push(NUMBER_WORDS[w]);
  return out;
}
const near = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

/**
 * The values in `input` a person did not write: the executor's own audit
 * lets a changed number through (a plan saying 950 for a message saying
 * 900), so this is checked here.
 *   - A number must be one the message states (see statedNumbers), or one of
 *     them scaled by a unit factor (FACTORS), either way round.
 *   - A string with a space in it must appear in the message: that is the
 *     person's own text, copied.
 *   - A string of 15 characters or more with no space (a URL, a hash, a time
 *     zone name) must appear in the message, or share a run of 3 or more
 *     letters with it, so
 *     "Auckland" can become Pacific/Auckland and an invented token cannot pass.
 * Short strings (units, enum words, ISO dates the planner works out) are not
 * checked; the run checks those.
 */
export function untraced (input, message) {
  const text = flat(message);
  const stated = statedNumbers(text);
  const out = [];
  const visit = (v, path) => {
    if (typeof v === 'number') {
      const shown = stated.some(n => FACTORS.some(f => near(Math.abs(v), n * f) || near(Math.abs(v) * f, n)));
      if (!shown) out.push(`${path} = ${v}`);
    } else if (typeof v === 'string') {
      const s = v.trim();
      if (/\s/.test(s)) {
        if (!text.includes(flat(s))) out.push(`${path} = "${s.slice(0, 40)}"`);
      } else if (s.length >= 15 && !text.includes(flat(s))) {
        const runs = (s.toLowerCase().match(/[a-z]{3,}/g) || []);
        if (!runs.some(r => text.includes(r))) out.push(`${path} = "${s.slice(0, 40)}"`);
      }
    } else if (Array.isArray(v)) {
      v.forEach((x, i) => visit(x, `${path}[${i}]`));
    } else if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) visit(x, `${path}.${k}`);
    }
  };
  for (const [k, v] of Object.entries(input || {})) visit(v, k);
  return out;
}

/** The shortlist the planner would be handed, as plannerdata builds it. */
export async function shortlistFor (router, registry, message) {
  const routing = await router.route(message, { prevMessage: '', prevSkills: [] });
  const list = routing.forPlanner && routing.forPlanner.length ? routing.forPlanner : routing.candidates.slice(0, 10);
  return {
    cards: list.map(c => registry.compactCard(c.name)).filter(Boolean),
    confident: Boolean(routing.actionable && routing.actionable.length) ||
      (typeof routing.category === 'string' && !['none', 'unavailable'].includes(routing.category))
  };
}

/**
 * Check one authored row `{ skill, message, input, mode }`. Returns
 * `{ ok: true, cards }` or `{ ok: false, why }`. `router` may be null (no
 * shortlist check).
 */
export async function checkRow (r, { registry, router, heldOut, synonyms = {} }) {
  const skill = r && registry.skill(r.skill);
  if (!skill || !registry.routable().some(s => s.name === r.skill)) return { ok: false, why: `no routable skill "${r?.skill}"` };
  if (typeof r.message !== 'string' || !r.message.trim()) return { ok: false, why: 'no message' };
  if (!['full', 'pointed'].includes(r.mode)) return { ok: false, why: 'mode must be "full" or "pointed"' };
  if (!r.input || typeof r.input !== 'object' || Array.isArray(r.input)) return { ok: false, why: 'input must be an object' };
  if (closeToHeldOut(r.message, heldOut)) return { ok: false, why: 'too close to a message the bench grades on — write a different one' };
  if (closeToExamples(r.message, skill)) return { ok: false, why: 'a paraphrase of one of the skill\'s own examples — write a new message' };

  /* Top-level values a person leaves implied: the field's schema default,
     and base 10 for a number written in plain digits. */
  const implied = (k, v) => skill.inputSchema?.properties?.[k]?.default === v || (/base$/i.test(k) && v === 10);
  /* Round 3: a value worked out from the message is checked by working it
     out (derive.mjs) and is then exempt from appearing as written. */
  let literal = r.input;
  for (const d of r.derive || []) {
    if (!d || typeof d.field !== 'string' || typeof d.from !== 'string' || !RULES.includes(d.rule)) return { ok: false, why: `a derivation needs a field, one of the rules (${RULES.join(', ')}) and the words it comes from` };
    if (!flat(r.message).includes(flat(d.from))) return { ok: false, why: `"${d.from}" is not in the message` };
    const value = valueAt(r.input, d.field);
    if (value === undefined) return { ok: false, why: `the plan has no ${d.field} to derive` };
    const top = d.field.split('.')[0];
    const prop = skill.inputSchema?.properties?.[top];
    const why = checkDerivation({ rule: d.rule, from: d.from, value, today: CTX.now, enumValues: prop?.enum ?? null, synonyms: synonyms[`${r.skill}.${top}`] || {} });
    if (why) return { ok: false, why: `derivation ${d.field}: ${why}` };
    literal = without(literal, d.field);
  }
  const invented = untraced(Object.fromEntries(Object.entries(literal).filter(([k, v]) => !implied(k, v))), r.message);
  if (invented.length) return { ok: false, why: `not in the message: ${invented.slice(0, 3).join(', ')} — every value must be copied from it` };
  const plan = { steps: [{ id: 's1', skill: r.skill, input: r.input }] };
  const check = validatePlan(plan, registry);
  if (!check.ok) return { ok: false, why: `plan does not validate: ${JSON.stringify(check.errors).slice(0, 200)}` };
  const run = await runPlan(plan, { registry, ctx: CTX, message: r.message });
  if (r.mode === 'full') {
    if (run.outcome === 'ASK_USER') return { ok: false, why: `the executor asked for "${run.ask?.field}" (${run.ask?.why}) — every value must be in the message` };
    const bad = (run.results || []).filter(x => !x.ok && x.error?.code !== 'NETWORK_OFF');
    if (!run.results?.length || bad.length) return { ok: false, why: `did not run: ${bad[0]?.error?.message ?? run.outcome}` };
  } else {
    const required = (skill.inputSchema?.required || []);
    const left = required.filter(f => !(f in r.input));
    if (!left.length) return { ok: false, why: 'pointed, but the plan leaves no required argument out' };
    if (run.outcome !== 'ASK_USER' || !left.includes(run.ask?.field)) return { ok: false, why: `pointed, but running it did not ask for ${left.join('/')} (${run.outcome}${run.ask ? ` asked ${run.ask.field}` : ''})` };
  }
  if (!router) return { ok: true, cards: null };
  const { cards, confident } = await shortlistFor(router, registry, r.message);
  if (!cards.some(c => c.name === r.skill)) return { ok: false, why: `the router does not list ${r.skill} for this message — phrase it so the request is recognisable` };
  return { ok: true, cards, confident };
}
