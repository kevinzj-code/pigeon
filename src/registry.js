/* registry.js — §4.1, §5.
 *
 * The registry is the single source of truth for what Pigeon can do. Three
 * consumers read it and they read DIFFERENT views of it, which is the whole
 * point of this file:
 *
 *   routerIndex()  — built ONLY from unbuilt:false entries. §5's stub policy
 *                    is enforced here and nowhere else: a stub that cannot be
 *                    indexed cannot be selected, so it cannot appear as a fake
 *                    capability no matter what any other layer does.
 *   compactCard()  — what the planner sees. Name, one line, required fields
 *                    with types, one example. Full schemas stay in JS (§3.2)
 *                    because five of them would eat a 1–2B model's context.
 *   skill()        — what the executor runs. The whole entry.
 */

import { lintSchema } from './schema.js';
import { FILTER_NAMES } from './template.js';

const REQUIRED_KEYS = ['name', 'description', 'category', 'tier', 'unbuilt', 'needsNetwork', 'labels'];
const TIERS = ['core', 'standard', 'extended', 'web'];
/* 'unverified' means the skill read something it could not check the
   authenticity of — jwtDecode can show you a token's claims but cannot tell you
   whether the token is genuine. Same treatment as 'formula-only' (§10 decision
   4): the label renders as a badge AND the limitation is stated in the reply
   text, so the caveat travels with the answer instead of living only in chrome
   the reader might not look at. */
const KNOWN_LABELS = ['lexicon', 'formula-only', 'estimate', 'toy', 'unverified'];

export class Registry {
  constructor (entries) {
    this.entries = entries;
    this.byName = new Map(entries.map(e => [e.name, e]));
  }

  /** Every entry, stubs included. Only the Skills screen and the linter use this. */
  all () { return this.entries; }

  /** §5 stub policy. The ONLY list the router is allowed to see. */
  routable () { return this.entries.filter(e => !e.unbuilt); }

  skill (name) { return this.byName.get(name) || null; }

  has (name) { return this.byName.has(name); }

  categories () {
    return [...new Set(this.entries.map(e => e.category))].sort();
  }

  /** §3.2 — the planner's view. Types only, one example, no full schema. */
  compactCard (name) {
    const s = this.skill(name);
    if (!s || s.unbuilt) return null;
    const props = (s.inputSchema && s.inputSchema.properties) || {};
    const req = (s.inputSchema && s.inputSchema.required) || [];
    return {
      name: s.name,
      description: s.description,
      required: req.map(f => `${f}: ${props[f] ? props[f].type : 'string'}`),
      optional: Object.keys(props).filter(f => !req.includes(f)).map(f => `${f}: ${props[f].type}`),
      example: s.examples && s.examples[0]
        ? { text: s.examples[0].text, input: s.examples[0].input }
        : null
    };
  }
}

/** Author-time validation. Run by `npm test` over every entry, so a malformed
 *  registry fails in seconds rather than three turns into a real conversation. */
export function lintEntry (e) {
  const p = [];
  const at = (msg) => p.push(`${e && e.name ? e.name : '<unnamed>'}: ${msg}`);

  if (!e || typeof e !== 'object') return ['<entry>: not an object'];
  for (const k of REQUIRED_KEYS) if (!(k in e)) at(`missing "${k}"`);
  if (typeof e.name !== 'string' || !/^[a-z][A-Za-z0-9]*$/.test(e.name || '')) at('name must be lowerCamelCase');
  if (!TIERS.includes(e.tier)) at(`tier must be one of ${TIERS.join('|')}`);
  if (!Array.isArray(e.labels)) at('labels must be an array');
  else for (const l of e.labels) if (!KNOWN_LABELS.includes(l)) at(`unknown label "${l}"`);

  if (e.unbuilt) {
    /* §2.4/§5: a stub is a registry entry and nothing else. If it has a `run`,
       somebody is one flag away from shipping an unfinished skill. */
    if (typeof e.run === 'function') at('unbuilt entries must not carry an implementation');
    /* Extended entries are unbuilt because nobody has written them. A
       non-Extended entry may only be unbuilt if it states WHY it cannot be
       written — the §21 image skills need a canvas, which §3.3 forbids. That
       reason has to be recorded, or "unbuilt" quietly becomes a way to park
       anything inconvenient at any tier. */
    if (e.tier !== 'extended' && !e.blockedBy) {
      at('only extended-tier entries may be unbuilt, unless they say what blocks them via blockedBy');
    }
    return p;
  }

  if (typeof e.run !== 'function') at('run must be a function');
  if (!e.inputSchema) at('missing inputSchema');
  else p.push(...lintSchema(e.inputSchema, `${e.name}.inputSchema`));
  if (!e.outputSchema) at('missing outputSchema');
  else p.push(...lintSchema(e.outputSchema, `${e.name}.outputSchema`));

  /* A skill whose whole purpose is unpredictability cannot have fixed example
     outputs. §15 specifies CSPRNG for generateRandomString, and a seeded
     password generator is a security hole — so the exception is real, narrow,
     and has to be declared: `nondeterministic: true` plus a `verify` function
     the test suite runs INSTEAD of comparing outputs. Declaring one without
     the other would silently stop checking the skill at all. */
  if (e.nondeterministic && typeof e.verify !== 'function') {
    at('nondeterministic entries need a verify(value, input) function — otherwise nothing checks them');
  }
  if (!e.nondeterministic && typeof e.verify === 'function') {
    at('verify() is only for nondeterministic entries; a deterministic skill is checked against its examples');
  }

  /* §5 tier policy: Core ships with ≥5 examples and ≥3 error cases. */
  const n = (e.examples || []).length;
  if (e.tier === 'core' && n < 5) at(`core skills need ≥5 examples, has ${n}`);
  /* Every built skill, not just Core. This checked `tier === 'core'` while the
     README and the §12 ledger both claimed "≥3 error cases each" for the whole
     registry — so 203 Standard skills were making that claim with nothing
     enforcing it, and two of them had quietly fallen below it. A linter that
     covers less than the claim it backs is worse than no linter, because the
     claim reads as checked. */
  if (!e.unbuilt && (e.errorCases || []).length < 3) at(`built skills need ≥3 error cases, has ${(e.errorCases || []).length}`);
  for (const [i, ex] of (e.examples || []).entries()) {
    if (typeof ex.text !== 'string' || !ex.text) at(`examples[${i}] needs a "text"`);
    if (!ex.input || typeof ex.input !== 'object') at(`examples[${i}] needs an "input" object`);
    if (!('output' in ex)) at(`examples[${i}] needs an "output"`);
  }

  const lintTemplate = (tpl, where) => {
    for (const m of tpl.matchAll(/\{\{\s*([^}]+?)\s*\}\}/g)) {
      const parts = m[1].split('|').map(s => s.trim());
      const path = parts.shift().split('.')[0];
      const outProps = (e.outputSchema && e.outputSchema.properties) || {};
      if (Object.keys(outProps).length && !(path in outProps)) {
        at(`${where} references "${path}", which is not in outputSchema`);
      }
      for (const f of parts) {
        const fname = f.split(':')[0].trim();
        if (!FILTER_NAMES.includes(fname)) at(`${where} uses unknown filter "${fname}"`);
      }
    }
  };
  if (e.replyTemplate) lintTemplate(e.replyTemplate, 'replyTemplate');

  /* Wording for when a value was never given. Each variant names fields that
     really have a default — a variant keyed on a field that cannot default
     would never be chosen, and nobody would notice. */
  if (e.replyWhenDefault !== undefined) {
    const inProps = (e.inputSchema && e.inputSchema.properties) || {};
    if (!Array.isArray(e.replyWhenDefault)) at('replyWhenDefault must be an array');
    else if (!e.replyTemplate) at('replyWhenDefault needs a replyTemplate to fall back to');
    else {
      for (const [i, v] of e.replyWhenDefault.entries()) {
        if (!v || !Array.isArray(v.defaults) || !v.defaults.length || typeof v.template !== 'string') { at(`replyWhenDefault[${i}] needs "defaults" and "template"`); continue; }
        for (const f of v.defaults) if (!inProps[f] || inProps[f].default === undefined) at(`replyWhenDefault[${i}] names "${f}", which has no default`);
        lintTemplate(v.template, `replyWhenDefault[${i}]`);
      }
    }
  }

  /* The names a person reads: a skill's title and a field's label, both short
     enough to sit in one line above an answer. Optional; humanise() stands in. */
  /* `carry: true` marks the one field an earlier answer fills when a Reply says
     "that" (carry.js). A number, and only one per skill — two would make
     "split that" ambiguous by construction. */
  const carried = Object.entries((e.inputSchema && e.inputSchema.properties) || {}).filter(([, p]) => p && p.carry !== undefined);
  for (const [k, p] of carried) {
    if (p.carry !== true) at(`inputSchema.${k}.carry must be true when present`);
    if (p.type !== 'number' && p.type !== 'integer') at(`inputSchema.${k}.carry marks a ${p.type}; only a number can be carried`);
  }
  if (carried.length > 1) at(`only one field may be marked carry, found ${carried.map(([k]) => k).join(', ')}`);
  if (e.title !== undefined && (typeof e.title !== 'string' || !e.title.trim() || e.title.length > 24)) at('title must be a string of at most 24 characters');
  for (const [k, prop] of Object.entries((e.inputSchema && e.inputSchema.properties) || {})) {
    if (prop && prop.label !== undefined && (typeof prop.label !== 'string' || !prop.label.trim() || prop.label.length > 24)) at(`inputSchema.${k}.label must be a string of at most 24 characters`);
  }

  if (e.needsNetwork && e.tier !== 'web') at('needsNetwork entries belong in the web tier');
  if (e.dataAsOf && !/^\d{4}-\d{2}-\d{2}$/.test(e.dataAsOf)) at('dataAsOf must be YYYY-MM-DD');
  return p;
}

export function buildRegistry (entries) {
  const seen = new Set();
  for (const e of entries) {
    if (seen.has(e.name)) throw new Error(`duplicate skill name "${e.name}"`);
    seen.add(e.name);
  }
  return new Registry(entries);
}
