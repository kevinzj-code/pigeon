#!/usr/bin/env node
/* plannerdata2-check.mjs — check authored round-2 planner rows before they go
 * into the set (the rules are in scripts/lib/planner-rows-2.mjs).
 *
 * An authored file is JSON:
 *   { "rows":  [{ "skill", "message", "input", "mode": "full" | "pointed" }, …],
 *     "pairs": [{ "twins": [A, B], "rows": [<row for A>, <row for B>] }, …] }
 * A pair is a minimal pair: the same message shape, one detail deciding
 * between the twins; its two rows must name A and B in that order.
 * `"declines": ["<message>", …]` are messages no skill answers; they are
 * checked only for distance from the bench (their plan is the empty one).
 *
 *   node scripts/plannerdata2-check.mjs <file.json> [--engine http://127.0.0.1:8150]
 *
 * --engine checks each row's shortlist with the real router asked through
 * pigeon-serve (Patch's nest). A row already checked, unchanged, is not
 * checked again (`<file>.checked.json` beside it). Prints every failing row
 * with why, then a count per skill. Exits 1 when any row fails.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import entries from '../skills/index.js';
import { buildRegistry } from '../src/registry.js';
import { categoryRouter, CATEGORY_CONFIDENCE } from '../src/category-router.js';
import { pigeonServer } from './lib/pigeon-serve.mjs';
import { checkRow, heldOutMessages, closeToHeldOut, norm, words, jaccard } from './lib/planner-rows-2.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const file = argv.find(a => a.endsWith('.json'));
if (!file) { console.error('usage: plannerdata2-check.mjs <file.json> [--engine <url>]'); process.exit(2); }

const registry = buildRegistry(entries);
const ENGINE = opt('--engine', null);
const router = ENGINE ? categoryRouter({ registry, complete: pigeonServer({ base: ENGINE }), trained: true, minConfidence: CATEGORY_CONFIDENCE }) : null;
const heldOut = await heldOutMessages(ROOT);
const doc = JSON.parse(await readFile(file, 'utf8'));
/* --colist (round 3): a minimal pair passes only when the router lists BOTH
   twins for BOTH its messages — a pair the planner never sees side by side
   teaches nothing. Enum synonyms: the reviewed table, then the file's own. */
const COLIST = argv.includes('--colist');
/* --fresh: trust no cached pass (after a rule changes). */
const FRESH = argv.includes('--fresh');
const reviewed = JSON.parse(await readFile(join(ROOT, 'bench/planner-rows-3/enum-synonyms.json'), 'utf8').catch(() => '{}'));
const synonyms = { ...reviewed };
for (const [k, v] of Object.entries(doc.synonyms || {})) synonyms[k] = { ...(synonyms[k] || {}), ...v };
const cachePath = file.replace(/\.json$/, '.checked.json');
const cache = ENGINE ? JSON.parse(await readFile(cachePath, 'utf8').catch(() => '{}')) : {};
const keyOf = (r) => createHash('sha256').update(JSON.stringify([r?.skill, r?.message, r?.input, r?.mode, r?.derive ?? null])).digest('hex').slice(0, 24);

/* A minimal pair is two messages of one shape: they share most of their words. */
export const PAIR_SHAPE = 0.35;

let failed = 0;
const seen = new Set();
const counts = {};
const report = (where, r, why) => { failed++; console.log(`  ✗ ${where} [${r?.skill}] "${r?.message}": ${why}`); };
async function one (where, r) {
  const key = norm(r?.message ?? '');
  if (seen.has(key)) return report(where, r, 'the same message appears twice');
  seen.add(key);
  const k = keyOf(r);
  /* Only a pass is trusted from the cache, with its shortlist as names: a
     failure is checked again, since the rules may have changed since. */
  const hit = !FRESH && cache[k]?.ok && Array.isArray(cache[k].cards) && cache[k].cards.includes(r.skill) && cache[k].cards.every(n => typeof n === 'string' && registry.compactCard(n)) ? cache[k] : null;
  const c = hit ?? await checkRow(r, { registry, router, heldOut, synonyms });
  if (ENGINE && !hit) cache[k] = { ok: c.ok, why: c.why, cards: c.cards ? c.cards.map(x => x.name) : null, confident: c.confident };
  if (!c.ok) { report(where, r, c.why); return null; }
  counts[r.skill] = (counts[r.skill] ?? 0) + 1;
  return ENGINE ? cache[k].cards ?? (c.cards || []).map(x => x.name ?? x) : [];
}
for (const [i, r] of (doc.rows || []).entries()) await one(`rows[${i}]`, r);
for (const [i, p] of (doc.pairs || []).entries()) {
  const [a, b] = p.twins || [];
  if (p.rows?.length !== 2 || p.rows[0].skill !== a || p.rows[1].skill !== b) { report(`pairs[${i}]`, p.rows?.[0], 'a pair is two rows naming its twins in order'); continue; }
  const shape = jaccard(words(p.rows[0].message), words(p.rows[1].message));
  if (shape < PAIR_SHAPE) { report(`pairs[${i}]`, p.rows[0], `not a minimal pair: the two messages share too few words (${shape.toFixed(2)}) — keep the shape, change the deciding detail`); continue; }
  const ca = await one(`pairs[${i}].a`, p.rows[0]);
  const cb = await one(`pairs[${i}].b`, p.rows[1]);
  if (COLIST && ENGINE && ca && cb && !(ca.includes(a) && ca.includes(b) && cb.includes(a) && cb.includes(b))) {
    report(`pairs[${i}]`, p.rows[0], `the router does not list both ${a} and ${b} for both messages (${ca.includes(b) ? '' : `first lacks ${b}; `}${cb.includes(a) ? '' : `second lacks ${a}`}) — word them so both are recognisable`);
    counts[a]--; counts[b]--;
  }
}
for (const [i, m] of (doc.declines || []).entries()) {
  const r = { skill: '(none)', message: m };
  if (typeof m !== 'string' || !m.trim()) { report(`declines[${i}]`, r, 'not a message'); continue; }
  if (seen.has(norm(m))) { report(`declines[${i}]`, r, 'the same message appears twice'); continue; }
  seen.add(norm(m));
  if (closeToHeldOut(m, heldOut)) { report(`declines[${i}]`, r, 'too close to a message the bench grades on — write a different one'); continue; }
  counts['(declines)'] = (counts['(declines)'] ?? 0) + 1;
}
if (ENGINE) await writeFile(cachePath, JSON.stringify(cache));
const total = Object.values(counts).reduce((n, x) => n + x, 0);
console.log(`\n  ${total} rows pass, ${failed} fail${router ? '' : ' (shortlist not checked: no --engine)'}`);
console.log('  ' + Object.entries(counts).sort().map(([k, v]) => `${k} ${v}`).join(' · '));
process.exit(failed ? 1 : 0);
