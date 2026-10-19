#!/usr/bin/env node
/* asksdata.mjs — training rows for `patch-asks` on Qwen3-VL 2B
 * (HANDOFF-PIGEON-DEV-3, Task 1).
 *
 *   node scripts/asksdata.mjs --engine http://127.0.0.1:8150 [--out <dir>/patch-asks-training] [--no-share 0.35]
 *
 * The contract is what src/verify.js sends (scripts/lib/asks-rows.mjs): system
 * line, the ten shots, the filled template, YES or NO. Sources:
 *
 *   YES  round 2 and 3's checked plans (round 3's delivered rows), sampled per
 *        skill with pointed rows, minimal-pair rows and carry replies first;
 *        and the YES half of every kept lure pair.
 *   NO   the same rows' declines; category set v5's `none` messages not
 *        already used; the NO half of every kept lure pair.
 *
 * A lure pair is kept when its batch passes asksdata-check, Kevin's reviewer
 * has not struck it (bench/asks-rows/review.json), and the app's router lists
 * the pair's skill for its YES half (the router pass, which needs --engine;
 * answers are cached in bench/asks-rows/router.json so a re-run is offline).
 * Every row is checked against the hold-out rule; the README says the count
 * is 0.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { norm, words, jaccard, HELD_OUT_REACH } from './lib/planner-rows-2.mjs';
import { asksRow, heldOut, closeTo, SHOT_MESSAGES } from './lib/asks-rows.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (n, d = null) => { const i = argv.indexOf(n); return i > -1 && argv[i + 1] ? argv[i + 1] : d; };
const HOME = process.env.HOME;
const OUT = (opt('--out', join(HOME, 'Downloads/patch-asks-training'))).replace(/^~/, HOME);
const NO_SHARE = Number(opt('--no-share', 0.35));
const ENGINE = opt('--engine');
const PLANNER_ROWS = join(HOME, 'Downloads/patch-planner-training-3');
const A = join(ROOT, 'bench/asks-rows');

const hash = (s) => createHash('sha256').update(s).digest('hex');
const frac = (s) => parseInt(hash(s).slice(0, 8), 16) / 0x100000000;
const held = heldOut(ROOT);

/* ── the planner rows: real asks and their declines ─────────────────────── */
const asks = [], declines = [];
for (const f of ['train', 'valid', 'grade']) for (const l of readFileSync(join(PLANNER_ROWS, `${f}.jsonl`), 'utf8').split('\n')) {
  if (!l.trim()) continue;
  const r = JSON.parse(l);
  const u = r.messages[0].content;
  const message = u.slice(u.lastIndexOf('\nMESSAGE\n') + 9).trim();
  const plan = JSON.parse(r.messages[1].content);
  if ((plan.steps || []).length) asks.push({ message, skill: plan.steps[0].skill, carry: u.includes('\nEARLIER ANSWER\n') });
  else declines.push({ message });
}
/* Which asks were pointed ("grab the bullets from this") or half of a minimal
   pair, from the authored files of rounds 2 and 3. */
const pointed = new Set(), paired = new Set();
for (const dir of ['bench/planner-rows-3/authored', 'model/planner-data-2/authored']) {
  for (const f of readdirSync(join(ROOT, dir)).filter(f => /^[a-z]\d+\.json$/.test(f))) {
    const d = JSON.parse(readFileSync(join(ROOT, dir, f), 'utf8'));
    for (const r of d.rows || []) if (r.mode === 'pointed') pointed.add(norm(r.message));
    for (const p of d.pairs || []) for (const r of p.rows || []) paired.add(norm(r.message));
  }
}

/* ── category set v5's `none` messages ──────────────────────────────────── */
const catNone = [];
for (const f of ['train', 'valid']) for (const l of readFileSync(join(ROOT, 'model/training-data-v5', `${f}.jsonl`), 'utf8').split('\n')) {
  if (!l.trim()) continue;
  const r = JSON.parse(l);
  if (r.messages.at(-1).content.trim() === 'none') catNone.push({ message: r.messages.find(m => m.role === 'user').content.trim() });
}

/* ── the lure pairs ─────────────────────────────────────────────────────── */
const review = existsSync(join(A, 'review.json')) ? JSON.parse(readFileSync(join(A, 'review.json'), 'utf8')) : { strike: [] };
const struck = new Map(review.strike.map(s => [norm(s.no), s.why]));
const lures = [];
for (const f of argv.includes('--no-lures') ? [] : readdirSync(join(A, 'authored')).filter(f => /^l\d+\.json$/.test(f)).sort()) {
  for (const p of JSON.parse(readFileSync(join(A, 'authored', f), 'utf8')).pairs) lures.push({ ...p, batch: f.replace('.json', '') });
}

/* The router pass: the YES half must reach its skill on the app's router. */
const routerPath = join(A, 'router.json');
const routed = existsSync(routerPath) ? JSON.parse(readFileSync(routerPath, 'utf8')) : {};
const toRoute = lures.filter(p => !struck.has(norm(p.no)) && !(p.yes in routed));
if (toRoute.length) {
  if (!ENGINE) { console.error(`\n  ${toRoute.length} lure YES messages have not been through the router: pass --engine <pigeon-serve url>.\n`); process.exit(1); }
  const { loadPigeon } = await import('./lib/pigeon-load.mjs');
  const { pigeonServer } = await import('./lib/pigeon-serve.mjs');
  const { buildRegistry } = await import('../src/registry.js');
  const { categoryRouter, CATEGORY_CONFIDENCE, FALLBACK_FLOOR, WIDENING } = await import('../src/category-router.js');
  const pack = await loadPigeon(join(ROOT, 'pack/patch.pigeon'));
  const router = categoryRouter({ registry: buildRegistry(pack.entries), complete: pigeonServer({ base: ENGINE }), trained: true, maxCandidates: 20,
    minConfidence: CATEGORY_CONFIDENCE, fallbackFloor: FALLBACK_FLOOR, ...pack.routerOptions, ...WIDENING });
  for (const [i, p] of toRoute.entries()) {
    routed[p.yes] = (await router.route(p.yes)).forPlanner.map(c => c.name);
    if (i % 50 === 49) writeFileSync(routerPath, JSON.stringify(routed, null, 0) + '\n');
  }
  writeFileSync(routerPath, JSON.stringify(routed, null, 0) + '\n');
  await pack.cleanup();
}

/* ── filter ─────────────────────────────────────────────────────────────── */
const dropped = { heldOut: 0, shot: 0, struck: 0, notRouted: 0, duplicate: 0, conflict: 0 };
const ok = (m) => {
  if (closeTo(m, held)) { dropped.heldOut++; return false; }
  if (SHOT_MESSAGES.has(norm(m))) { dropped.shot++; return false; }
  return true;
};
const keptLures = [], notRouted = [];
for (const p of lures) {
  if (struck.has(norm(p.no))) { dropped.struck++; continue; }
  if (!(routed[p.yes] || []).includes(p.skill)) { dropped.notRouted++; notRouted.push(p); continue; }
  if (!ok(p.no) || !ok(p.yes)) continue;
  keptLures.push(p);
}
const yesPool = asks.filter(a => ok(a.message));
const noPool = [...declines.map(d => ({ ...d, source: 'decline' })), ...catNone.map(d => ({ ...d, source: 'category none' }))].filter(d => ok(d.message));

/* One label per message: a message on both sides is dropped from both. */
const yesNorms = new Set([...yesPool.map(a => norm(a.message)), ...keptLures.map(p => norm(p.yes))]);
const noNorms = new Set([...noPool.map(d => norm(d.message)), ...keptLures.map(p => norm(p.no))]);
const both = new Set([...yesNorms].filter(n => noNorms.has(n)));
dropped.conflict = both.size;

/* ── balance: NO at NO_SHARE, the YES side sampled per skill ────────────── */
const seenNo = new Set();
const noRows = [];
for (const d of noPool) { const n = norm(d.message); if (both.has(n) || seenNo.has(n)) { dropped.duplicate++; continue; } seenNo.add(n); noRows.push(d); }
const lureRows = keptLures.filter(p => !both.has(norm(p.no)) && !both.has(norm(p.yes)) && !seenNo.has(norm(p.no)));
for (const p of lureRows) seenNo.add(norm(p.no));
const noTotal = noRows.length + lureRows.length;
const yesTarget = Math.round(noTotal * (1 - NO_SHARE) / NO_SHARE);
const fromPlans = Math.max(0, yesTarget - lureRows.length);

const bySkill = {};
const seenYes = new Set(lureRows.map(p => norm(p.yes)));
for (const a of yesPool) { const n = norm(a.message); if (both.has(n) || seenYes.has(n)) continue; seenYes.add(n); (bySkill[a.skill] ??= []).push(a); }
const skills = Object.keys(bySkill).sort();
const base = Math.floor(fromPlans / skills.length);
const extra = new Set([...skills].sort((a, b) => hash('extra:' + a).localeCompare(hash('extra:' + b))).slice(0, fromPlans - base * skills.length));
const yesRows = [];
const kinds = { pointed: 0, pair: 0, carry: 0, plain: 0 };
for (const s of skills) {
  const k = base + (extra.has(s) ? 1 : 0);
  const pool = [...bySkill[s]].sort((a, b) => hash(a.message).localeCompare(hash(b.message)));
  const kind = (a) => (a.carry ? 'carry' : pointed.has(norm(a.message)) ? 'pointed' : paired.has(norm(a.message)) ? 'pair' : 'plain');
  /* First up to 2 of each special kind, then the rest in hash order. */
  const pick = [];
  for (const want of ['pointed', 'pair', 'carry']) pick.push(...pool.filter(a => kind(a) === want).slice(0, 2));
  for (const a of pool) if (pick.length < k && !pick.includes(a)) pick.push(a);
  for (const a of pick.slice(0, k)) { kinds[kind(a)]++; yesRows.push({ ...a, source: 'plan' }); }
}

/* ── splits: grade ~8%, valid ~7%; a lure pair stays together ───────────── */
const items = [
  ...yesRows.map(a => ({ key: a.message, rows: [[a.message, 'YES']], source: a.source, skill: a.skill })),
  ...noRows.map(d => ({ key: d.message, rows: [[d.message, 'NO']], source: d.source })),
  ...lureRows.map(p => ({ key: 'lure:' + p.no, rows: [[p.no, 'NO'], [p.yes, 'YES']], source: 'lure', skill: p.skill }))
];
const split = (it) => { const f = frac('split:' + it.key); return f < 0.08 ? 'grade' : f < 0.15 ? 'valid' : 'train'; };
const out = { train: [], valid: [], grade: [] };
for (const it of items) for (const [m, label] of it.rows) out[split(it)].push({ m, label, source: it.source, skill: it.skill, key: it.key });
for (const k of Object.keys(out)) out[k].sort((a, b) => hash('order:' + a.m).localeCompare(hash('order:' + b.m)));

/* ── the final check over every row ─────────────────────────────────────── */
const all = Object.values(out).flat();
const heldOutCount = all.filter(r => closeTo(r.m, held)).length;
const labelClash = (() => { const seen = new Map(); let c = 0; for (const r of all) { const n = norm(r.m); if (seen.has(n) && seen.get(n) !== r.label) c++; seen.set(n, r.label); } return c; })();
if (heldOutCount || labelClash) { console.error(`hold-out ${heldOutCount}, label clashes ${labelClash}: refusing to write`); process.exit(1); }

mkdirSync(OUT, { recursive: true });
for (const [k, rows] of Object.entries(out)) writeFileSync(join(OUT, `${k}.jsonl`), rows.map(r => JSON.stringify(asksRow(r.m, r.label))).join('\n') + '\n');

const count = (rows, f) => rows.filter(f).length;
const perLure = {};
for (const p of lureRows) perLure[p.skill] = (perLure[p.skill] || 0) + 1;
const counts = {
  rows: Object.fromEntries(Object.entries(out).map(([k, r]) => [k, { all: r.length, yes: count(r, x => x.label === 'YES'), no: count(r, x => x.label === 'NO') }])),
  total: all.length, yes: count(all, r => r.label === 'YES'), no: count(all, r => r.label === 'NO'),
  noShare: Math.round(count(all, r => r.label === 'NO') / all.length * 1000) / 10,
  sources: {
    yesFromPlans: yesRows.length, yesFromPlansByKind: kinds, yesFromLures: lureRows.length,
    noDeclines: count(noRows, d => d.source === 'decline'), noCategoryNone: count(noRows, d => d.source === 'category none'), noLures: lureRows.length
  },
  perSkillFromPlans: { base, plusOne: extra.size, skills: skills.length },
  lurePairs: { written: lures.length, kept: lureRows.length, struckInReview: dropped.struck, notRouted: dropped.notRouted },
  lureCountPerSkill: perLure,
  dropped, heldOutCount, labelClash, heldOutSetSize: held.size
};
writeFileSync(join(OUT, 'counts.json'), JSON.stringify(counts, null, 1) + '\n');
writeFileSync(join(A, 'not-routed.json'), JSON.stringify(notRouted.map(p => ({ batch: p.batch, skill: p.skill, yes: p.yes, listed: routed[p.yes] })), null, 1) + '\n');
console.log(JSON.stringify({ ...counts, lureCountPerSkill: undefined }, null, 1));
