#!/usr/bin/env node
/* planner-pigeon-rows.mjs — the training rows for ONE trained planner Pigeon.
 *
 * Today the planner is four prompted Pigeons (patch-planner, -runway, -carry,
 * -runway-carry): one base, four system prompts. A trained planner is one
 * Pigeon with one contract, so the runway and the carry stop being prompt
 * versions and become what the rows teach:
 *
 *   in   the user turn the app already builds (plannerUserMessage): TODAY,
 *        the SKILLS cards, an EARLIER ANSWER block when the message replies
 *        to a worked-out answer, then the MESSAGE. No system prompt.
 *   out  {"about": "<what is wanted, in a few words>", "steps": [...]}, always
 *        with `about` first (the runway), declines included.
 *
 * Rows come from two places, and every one is checked by RUNNING it:
 *   1. scripts/plannerdata.mjs's output (--from <dir>): its single-step,
 *      chained and decline rows, the system turn dropped, and a decline's
 *      missing `about` written as a fixed phrase.
 *   2. Carry rows made here: an earlier answer (a skill's own first example,
 *      run), then a follow-up that refers to it ("take 15% off that"), planned
 *      as "$prev.s1.<field>"; and controls, the same follow-ups with their own
 *      number, which must not reach into the earlier answer. Each plan is run
 *      against the earlier results and kept only if it succeeds and the
 *      carried value is the earlier one.
 *
 * Never trained on: scripts/holdout.mjs, scripts/no-skill-set.mjs and every
 * phrase in scripts/followups.mjs (its graded and practice sets alike).
 *
 * Usage:
 *   node scripts/planner-pigeon-rows.mjs --from <plannerdata out dir> --out <dir>
 *        [--category-base http://127.0.0.1:8101]   (the real shortlist for carry rows)
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

import entries from '../skills/index.js';
import { buildRegistry } from '../src/registry.js';
import { LexicalRouter } from '../src/router.js';
import { categoryRouter, CATEGORY_CONFIDENCE } from '../src/category-router.js';
import { llamaServer } from '../src/llm.js';
import { plannerUserMessage } from '../src/planner.js';
import { validatePlan } from '../src/plan.js';
import { runPlan } from '../src/executor.js';
import { HOLDOUT } from './holdout.mjs';
import { NO_SKILL_MESSAGES } from './no-skill-set.mjs';
import './lib/apikey.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const FROM = opt('--from', null);
const OUT = opt('--out', null);
if (!FROM || !OUT) { console.error('\n  --from <plannerdata dir> and --out <dir> are required\n'); process.exit(1); }

const registry = buildRegistry(entries);
const ctx = { now: '2026-09-01T09:00:00Z', timezone: 'UTC', locale: 'en-GB', units: 'metric', webEnabled: false, confirmBeforeNetwork: true };
const CATEGORY_BASE = opt('--category-base', null);
const router = CATEGORY_BASE
  ? categoryRouter({ registry, complete: llamaServer({ base: CATEGORY_BASE }), trained: true, minConfidence: CATEGORY_CONFIDENCE })
  : new LexicalRouter(registry);

/* A decline's `about`. plannerdata's declines have none (they are taught in
   the plain format); the trained contract always has one, and inventing a
   per-message phrase here would be a model's words in the training set. */
export const DECLINE_ABOUT = 'nothing on this list does what was asked';

const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9%]+/g, ' ').trim();
/* Every quoted phrase in followups.mjs, read from its source: its sets are
   not exported, and over-excluding a phrase costs one row at most. */
const followupsSource = await readFile(join(ROOT, 'scripts/followups.mjs'), 'utf8');
const heldOut = new Set([
  ...HOLDOUT.map(([m]) => norm(m)), ...NO_SKILL_MESSAGES.map(norm),
  ...[...followupsSource.matchAll(/'([^'\n]{4,})'/g)].map(m => norm(m[1]))
]);

const aboutFor = (name) => {
  const d = String(registry.skill(name).description || '').replace(/\.$/, '');
  const first = d.split(/[—.]/)[0].trim();
  return first.charAt(0).toLowerCase() + first.slice(1);
};

/* ── 1. plannerdata's rows, in the one contract ──────────────────────────── */
async function converted (file) {
  const out = [];
  for (const line of (await readFile(join(FROM, file), 'utf8')).split('\n')) {
    if (!line.trim()) continue;
    const { messages } = JSON.parse(line);
    const user = messages.find(m => m.role === 'user').content;
    const plan = JSON.parse(messages.find(m => m.role === 'assistant').content);
    const about = plan.about ?? (plan.steps.length ? aboutFor(plan.steps[0].skill) : DECLINE_ABOUT);
    out.push(row(user, { about, steps: plan.steps }));
  }
  return out;
}

const row = (user, plan) => ({ messages: [{ role: 'user', content: user }, { role: 'assistant', content: JSON.stringify(plan) }] });

/* ── 2. carry rows ───────────────────────────────────────────────────────── */
/* Earlier answers: each skill's own first example, run. The field a reply
   reaches for is the answer's headline figure. */
const FROM_SKILLS = ['percentOf', 'splitBill', 'applyTax', 'applyDiscount', 'convertLength', 'compoundInterest',
  'unitPrice', 'simpleInterest', 'hourlyToSalary', 'amortizeLoan'];
const HEADLINE = ['result', 'total', 'gross', 'perPerson', 'annual', 'monthlyPayment', 'perUnit', 'interest', 'amount'];

/* [target skill, the field that carries, the other field and its values,
    follow-ups that refer to the answer, the same follow-ups stating a value] */
const FOLLOW = [
  ['applyDiscount', 'price', 'percent', [10, 15, 30], ['knock {n}% off that', 'take {n} percent off it', 'and {n}% off that figure'], ['knock {n}% off {v}', 'take {n} percent off {v}']],
  ['splitEvenly', 'amount', 'parts', [2, 4, 6], ['split that {n} ways', 'share it between {n} of us', 'and divide that by {n} people'], ['split {v} {n} ways', 'share {v} between {n} of us']],
  ['roundTo', 'value', 'places', [0, 1, 2], ['round that off to {n} places', 'and round it to {n} dp'], ['round {v} off to {n} places', 'round {v} to {n} dp']],
  ['percentOf', 'value', 'percent', [5, 12, 40], ['and what is {n}% of that', 'work out {n} percent of it'], ['what is {n}% of {v}', 'work out {n} percent of {v}']],
  ['applyTax', 'amount', 'rate', [5, 17.5, 20], ['stick {n}% vat on that', 'and {n} percent tax on top of it'], ['stick {n}% vat on {v}', 'put {n} percent tax on top of {v}']]
];

async function earlierAnswers () {
  const out = [];
  for (const name of FROM_SKILLS) {
    const ex = (registry.skill(name).examples || [])[0];
    if (!ex) continue;
    const plan = { steps: [{ id: 's1', skill: name, input: ex.input }] };
    const run = await runPlan(plan, { registry, ctx, message: ex.text });
    const r = run.results?.[0];
    if (!r?.ok || !r.value || typeof r.value !== 'object') continue;
    const field = HEADLINE.find(f => typeof r.value[f] === 'number');
    if (field) out.push({ skill: name, message: ex.text, results: run.results, field, figure: r.value[field] });
  }
  return out;
}

async function cardsFor (message) {
  const routing = await router.route(message, { prevMessage: '', prevSkills: [] });
  return { cards: (routing.forPlanner || []).map(c => registry.compactCard(c.name)).filter(Boolean), confident: routing.actionable?.length > 0 || (routing.confidence ?? 0) >= CATEGORY_CONFIDENCE };
}

async function carryRows () {
  const out = [];
  const dropped = { held: 0, offList: 0, failed: 0 };
  for (const first of await earlierAnswers()) {
    const carry = { message: first.message, results: first.results };
    for (const [skill, field, other, values, refers, states] of FOLLOW) {
      for (const n of values) {
        const cases = [
          ...refers.map(t => ({ text: t.replaceAll('{n}', n), input: { [field]: `$prev.s1.${first.field}`, [other]: n }, carries: true })),
          ...states.map(t => {
            const v = Math.round((first.figure + 7.25) * 100) / 100;
            return { text: t.replaceAll('{n}', n).replaceAll('{v}', v), input: { [field]: v, [other]: n }, carries: false };
          })
        ];
        for (const c of cases) {
          if (heldOut.has(norm(c.text))) { dropped.held++; continue; }
          const { cards } = await cardsFor(c.text);
          /* The planner is never shown a list without the skill it is meant
             to write: that teaches hallucination (plannerdata's rule). */
          if (!cards.some(k => k.name === skill)) { dropped.offList++; continue; }
          const plan = { about: aboutFor(skill), steps: [{ id: 's1', skill, input: c.input }] };
          const check = validatePlan({ steps: plan.steps }, registry, { prevResults: first.results });
          const run = check.ok === false ? null : await runPlan({ steps: plan.steps }, { registry, ctx, message: c.text, prevResults: first.results });
          const r = run?.results?.[0];
          const carried = !c.carries || (r && Math.abs(r.input[field] - first.figure) < 1e-9);
          if (!r?.ok || !carried) { dropped.failed++; continue; }
          out.push({ key: c.text, row: row(plannerUserMessage({ message: c.text, cards, ctx, carry }), plan), carries: c.carries });
        }
      }
    }
  }
  return { rows: out, dropped };
}

/* ── split carry rows by message, as plannerdata splits its own ──────────── */
const bucket = (key) => {
  const h = parseInt(createHash('sha256').update(norm(key)).digest('hex').slice(0, 8), 16) / 0xffffffff;
  return h < 0.80 ? 'train' : h < 0.90 ? 'valid' : 'grade';
};

const sets = { train: await converted('train.jsonl'), valid: await converted('valid.jsonl'), grade: await converted('grade.jsonl') };
const base = Object.fromEntries(Object.entries(sets).map(([k, v]) => [k, v.length]));
const carried = await carryRows();
for (const c of carried.rows) sets[bucket(c.key)].push(c.row);
await mkdir(OUT, { recursive: true });
for (const [k, v] of Object.entries(sets)) await writeFile(join(OUT, `${k}.jsonl`), v.map(r => JSON.stringify(r)).join('\n') + '\n');
const n = (f) => carried.rows.filter(f).length;
console.log(`\n  plannerdata rows   train ${base.train} · valid ${base.valid} · grade ${base.grade}`);
console.log(`  carry rows         ${n(r => r.carries)} refer to the earlier answer · ${n(r => !r.carries)} state their own value`);
console.log(`  dropped            ${carried.dropped.held} held-out phrasings · ${carried.dropped.offList} with the skill off the list · ${carried.dropped.failed} that did not run`);
console.log(`  written            train ${sets.train.length} · valid ${sets.valid.length} · grade ${sets.grade.length} → ${OUT}\n`);
