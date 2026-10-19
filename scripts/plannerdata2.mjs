#!/usr/bin/env node
/* plannerdata2.mjs — round 2 of the trained planner's rows.
 *
 * Round 1 (plannerdata.mjs → planner-pigeon-rows.mjs) took every single-step
 * row from a skill's own examples. The planner trained on it scored 238 and
 * 244 of 308 on the app-shape bench; patch-planner-misses.md (a write-up outside this repo) says
 * why: median 4 rows per skill, 15 skills with none, no row setting a twin
 * pair against each other, and nothing phrased the way people phrase. Round 2
 * changes exactly that and keeps the contract (no system prompt, `about`
 * first, the carry as the EARLIER ANSWER block, the real router's shortlist,
 * the bench never trained on):
 *
 *   1. Every routable skill gets new rows, written for it (model/planner-data-2/
 *      authored/b*.json), each checked by running it (lib/planner-rows-2.mjs).
 *      A floor of FLOOR rows per skill in train; the six carry-heavy skills are
 *      capped at CAP rows besides their carry rows.
 *   2. Minimal pairs for every twin pair (the bench's misses and the pairs the
 *      cards suggest): one message shape, the deciding detail changed, both
 *      directions.
 *   3. No row is a skill's example: round 1's example rows are gone. Its
 *      chained rows (within the cap), carry rows (all) and declines are kept as they
 *      were; new declines (authored, and the category set's `none` messages
 *      round 1 did not use) keep the decline share round 1 had.
 *
 * Usage:
 *   node scripts/plannerdata2.mjs --engine http://127.0.0.1:8150 \
 *        --round1 <dir>/patch-planner-training --out <dir>/patch-planner-training-2
 */

import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

import entries from '../skills/index.js';
import { buildRegistry } from '../src/registry.js';
import { categoryRouter, CATEGORY_CONFIDENCE } from '../src/category-router.js';
import { plannerUserMessage } from '../src/planner.js';
import { pigeonServer } from './lib/pigeon-serve.mjs';
import { CTX, checkRow, heldOutMessages, closeToHeldOut, shortlistFor, norm } from './lib/planner-rows-2.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const ENGINE = opt('--engine', 'http://127.0.0.1:8150');
const ROUND1 = opt('--round1', null);
const OUT = opt('--out', null);
if (!ROUND1 || !OUT) { console.error('\n  --round1 <dir> and --out <dir> are required\n'); process.exit(1); }

export const FLOOR = 20;
export const CAP = 40;
export const CARRY_HEAVY = ['applyDiscount', 'percentOf', 'applyTax', 'roundTo', 'splitEvenly', 'evaluateExpression'];
/* Round 1's decline share (246 of 1,947 train rows). */
const DECLINE_SHARE = 0.126;
/* The fixed `about` of a decline (planner-pigeon-rows.mjs). */
const DECLINE_ABOUT = 'nothing on this list does what was asked';
const MAX_ROW_CHARS = 7000;

const registry = buildRegistry(entries);
const router = categoryRouter({ registry, complete: pigeonServer({ base: ENGINE }), trained: true, minConfidence: CATEGORY_CONFIDENCE });
const heldOut = await heldOutMessages(ROOT);
const hash = (s) => parseInt(createHash('sha256').update(s).digest('hex').slice(0, 8), 16) / 0xffffffff;

const aboutFor = (name) => {
  const d = String(registry.skill(name).description || '').replace(/\.$/, '');
  const first = d.split(/[—.]/)[0].trim();
  return first.charAt(0).toLowerCase() + first.slice(1);
};
const row = (user, plan) => ({ messages: [{ role: 'user', content: user }, { role: 'assistant', content: JSON.stringify(plan) }] });
const tooLong = (r) => r.messages.reduce((n, m) => n + m.content.length, 0) > MAX_ROW_CHARS;

/* ── 1 and 2: the authored rows and minimal pairs ─────────────────────────── */
const dir = join(ROOT, 'model/planner-data-2/authored');
const files = (await readdir(dir)).filter(f => /^b\d+\.json$/.test(f)).sort();
const authored = [];
const pairRows = [];
const dropped = { failed: 0, duplicate: 0, tooLong: 0, pairBroken: 0 };
const seen = new Set();

async function built (r, kind, pair = null) {
  const key = norm(r.message);
  if (seen.has(key)) { dropped.duplicate++; return null; }
  const cacheFile = join(dir, r.__file.replace(/\.json$/, '.checked.json'));
  const cache = (built.caches[cacheFile] ??= JSON.parse(await readFile(cacheFile, 'utf8').catch(() => '{}')));
  const k = createHash('sha256').update(JSON.stringify([r.skill, r.message, r.input, r.mode])).digest('hex').slice(0, 24);
  let c = cache[k];
  /* Checked again unless the checker kept its shortlist; a row the checker
     passed without one is routed here. */
  if (!c?.ok || !shortlistOk(c.cards, r.skill)) {
    const fresh = await checkRow(r, { registry, router, heldOut });
    c = fresh.ok ? { ok: true, cards: fresh.cards.map(x => x.name) } : fresh;
  }
  if (!c.ok) { dropped.failed++; return null; }
  seen.add(key);
  const cards = c.cards.map(n => registry.compactCard(n)).filter(Boolean);
  const out = row(plannerUserMessage({ message: r.message, cards, ctx: CTX }), { about: aboutFor(r.skill), steps: [{ id: 's1', skill: r.skill, input: r.input }] });
  if (tooLong(out)) { dropped.tooLong++; return null; }
  return { skills: [r.skill], kind, mode: r.mode, message: r.message, pair, row: out };
}
built.caches = {};

/* A cached shortlist is used only when it is what the checker writes: skill
   names this registry knows, its own skill among them. Entries an authoring
   run rewrote as {name} objects or nulls rendered an EMPTY SKILLS block for
   958 rows of the first delivery (2026-10-09); anything else is routed again. */
function shortlistOk (cards, skill) {
  return Array.isArray(cards) && cards.length > 0 && cards.includes(skill)
    && cards.every(n => typeof n === 'string' && registry.compactCard(n));
}

for (const f of files) {
  const doc = JSON.parse(await readFile(join(dir, f), 'utf8'));
  for (const r of doc.rows || []) {
    const b = await built({ ...r, __file: f }, 'authored');
    if (b) authored.push(b);
  }
  for (const p of doc.pairs || []) {
    const left = await built({ ...p.rows[0], __file: f }, 'pair', p.twins.join('/'));
    const right = left && await built({ ...p.rows[1], __file: f }, 'pair', p.twins.join('/'));
    /* A pair is kept whole or not at all: half of one teaches one direction. */
    if (left && right) pairRows.push(left, right);
    else { dropped.pairBroken++; if (left) seen.delete(norm(left.message)); }
  }
}

/* ── 3: what round 1 keeps — chains, carries, declines — and its split ─────── */
const round1 = [];
for (const split of ['train', 'valid', 'grade']) {
  for (const line of (await readFile(join(ROUND1, `${split}.jsonl`), 'utf8')).split('\n')) {
    if (!line.trim()) continue;
    const r = JSON.parse(line);
    const user = r.messages[0].content;
    const plan = JSON.parse(r.messages[1].content);
    const message = user.split('MESSAGE\n').pop();
    const kind = !plan.steps.length ? 'decline' : user.includes('\n\nEARLIER ANSWER\n') ? 'carry' : plan.steps.length > 1 ? 'chain' : 'example';
    if (kind === 'example') continue; // rule 3: no row is a skill's own example
    if (closeToHeldOut(message, heldOut)) continue;
    round1.push({ skills: [...new Set(plan.steps.map(s => s.skill))], kind, message, split, row: r });
  }
}

/* The cap: authored and pair rows first, then round 1's chains, in a fixed
   order, until a carry-heavy skill has CAP rows. Round 1's carry rows are
   kept whole and outside the cap (Kevin, 2026-10-09: 72 carry rows were not
   enough to keep the reply flow round 1 learned). */
const count = {};
const bump = (rr) => rr.skills.forEach(s => { count[s] = (count[s] ?? 0) + 1; });
[...authored, ...pairRows].forEach(bump);
const kept1 = [];
for (const r of round1.filter(r => r.kind !== 'decline').sort((a, b) => hash(a.message) - hash(b.message))) {
  if (r.kind !== 'carry' && r.skills.some(s => CARRY_HEAVY.includes(s) && (count[s] ?? 0) >= CAP)) continue;
  bump(r);
  kept1.push(r);
}

/* Declines: round 1's, the authored ones, then the category set's `none`
   messages round 1 did not take, until the share is round 1's. */
const positives = authored.length + pairRows.length + kept1.length;
const wantDeclines = Math.round(positives * DECLINE_SHARE / (1 - DECLINE_SHARE));
const declines = round1.filter(r => r.kind === 'decline');
const declineSeen = new Set(declines.map(d => norm(d.message)));
async function addDecline (message, source) {
  if (declines.length >= wantDeclines) return;
  const key = norm(message);
  if (!message.trim() || declineSeen.has(key) || seen.has(key) || closeToHeldOut(message, heldOut)) return;
  const { cards } = await shortlistFor(router, registry, message);
  if (!cards.length) return;
  const r = row(plannerUserMessage({ message, cards, ctx: CTX }), { about: DECLINE_ABOUT, steps: [] });
  if (tooLong(r)) return;
  declineSeen.add(key);
  declines.push({ skills: [], kind: 'decline', source, message, row: r });
}
const authoredDeclines = JSON.parse(await readFile(join(dir, 'declines.json'), 'utf8').catch(() => '{"declines":[]}')).declines;
for (const m of authoredDeclines) await addDecline(m, 'authored');
const none = new Set();
for (const f of ['train.jsonl', 'valid.jsonl']) {
  for (const line of (await readFile(join(ROOT, 'model/training-data', f), 'utf8')).split('\n')) {
    if (!line.trim()) continue;
    const m = JSON.parse(line).messages;
    if (String(m[m.length - 1].content).trim() === 'none') none.add(String(m[1].content).trim());
  }
}
for (const m of [...none].sort((a, b) => hash(a) - hash(b))) await addDecline(m, 'category set');

/* ── split ──────────────────────────────────────────────────────────────── */
/* Authored rows: per skill, two to valid and two to grade by a hash of the
   message, the rest to train, so the floor holds in train. Pairs go to train
   whole. Round 1's rows keep their split; new declines go 80/10/10. */
const sets = { train: [], valid: [], grade: [] };
const bySkill = {};
for (const r of authored) (bySkill[r.skills[0]] ??= []).push(r);
for (const rows of Object.values(bySkill)) {
  rows.sort((a, b) => hash(a.message) - hash(b.message));
  rows.forEach((r, i) => { r.split = i < 2 ? 'valid' : i < 4 ? 'grade' : 'train'; });
}
for (const r of pairRows) r.split = 'train';
for (const d of declines) if (!d.split) { const h = hash(d.message); d.split = h < 0.8 ? 'train' : h < 0.9 ? 'valid' : 'grade'; }
const all = [...authored, ...pairRows, ...kept1, ...declines];
for (const r of all) sets[r.split].push(r);
for (const s of Object.values(sets)) s.sort((a, b) => hash(a.message + a.kind) - hash(b.message + b.kind));

/* ── counts, and the floor ──────────────────────────────────────────────── */
const per = {};
for (const s of registry.routable()) per[s.name] = { train: 0, valid: 0, grade: 0, authored: 0, pointed: 0, pair: 0, carry: 0, chain: 0 };
for (const r of all) {
  for (const s of r.skills) {
    const p = per[s];
    if (!p) continue;
    p[r.split]++;
    if (r.kind === 'authored') { p.authored++; if (r.mode === 'pointed') p.pointed++; }
    if (r.kind === 'pair') p.pair++;
    if (r.kind === 'carry') p.carry++;
    if (r.kind === 'chain') p.chain++;
  }
}
const under = Object.entries(per).filter(([, p]) => p.train < FLOOR).map(([n, p]) => `${n} ${p.train}`);
const over = CARRY_HEAVY.map(n => [n, per[n].train + per[n].valid + per[n].grade - per[n].carry]).filter(([, t]) => t > CAP);

/* Nothing is written unless every row shows the planner a shortlist, and
   every skill its plan names is on it. */
const skillsIn = (user) => [...user.split('\n\nSKILLS\n')[1].split('\n\n')[0].matchAll(/^(\w+) — /gm)].map(m => m[1]);
const broken = all.filter(r => {
  const user = r.row.messages[0].content;
  const listed = skillsIn(user);
  const plan = JSON.parse(r.row.messages[1].content);
  return !listed.length || plan.steps.some(st => !listed.includes(st.skill));
});
if (broken.length) {
  console.error(`\n  ${broken.length} rows show no shortlist or name a skill not on it, e.g. ${broken[0].kind} "${broken[0].message}"; nothing written.\n`);
  process.exit(1);
}
await mkdir(OUT, { recursive: true });
for (const [k, v] of Object.entries(sets)) await writeFile(join(OUT, `${k}.jsonl`), v.map(r => JSON.stringify(r.row)).join('\n') + '\n');
await writeFile(join(OUT, 'counts.json'), JSON.stringify({ per_skill: per, twin_pairs: [...new Set(pairRows.map(r => r.pair))].length, minimal_pairs: pairRows.length / 2 }, null, 1) + '\n');

const kinds = (k) => all.filter(r => r.kind === k).length;
console.log(`\n  authored ${kinds('authored')} (pointed ${authored.filter(r => r.mode === 'pointed').length}) · minimal-pair rows ${pairRows.length} (${pairRows.length / 2} pairs, ${new Set(pairRows.map(r => r.pair)).size} twin pairs)`);
console.log(`  round 1 kept: carry ${kinds('carry')} · chain ${kinds('chain')} · declines ${declines.filter(d => !d.source).length}; new declines: authored ${declines.filter(d => d.source === 'authored').length} · category set ${declines.filter(d => d.source === 'category set').length}`);
console.log(`  dropped: ${dropped.failed} failed a check · ${dropped.duplicate} duplicates · ${dropped.tooLong} too long · ${dropped.pairBroken} broken pairs`);
console.log(`  train ${sets.train.length} · valid ${sets.valid.length} · grade ${sets.grade.length} · declines ${(declines.length / all.length * 100).toFixed(1)}%`);
console.log(`  under the floor of ${FLOOR} in train: ${under.length ? under.join(', ') : 'none'}`);
console.log(`  carry-heavy over ${CAP}: ${over.length ? over.map(o => o.join(' ')).join(', ') : 'none'}\n`);
