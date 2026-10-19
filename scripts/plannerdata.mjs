#!/usr/bin/env node
/* plannerdata.mjs — build a training set for the PLANNER adapter.
 *
 * §7 asks for a LoRA that turns a message plus a shortlist into plan JSON, and
 * §12's ledger has carried "Planner adapter — not built" from the start. The
 * measured ceiling is the reason to build one: with the category adapter
 * routing, the prompted 2B answers 212 of 302 holdout questions. The router
 * puts the right skill on the list far more often than the planner picks it —
 * every one of the declines checked by hand had the wanted skill ranked first —
 * so the gap is the planner, and a planner is exactly the kind of narrow,
 * format-bound job a LoRA does well.
 *
 * THE POINT OF THIS SCRIPT is that Pigeon can generate its own training data
 * and then CHECK IT BY RUNNING IT. Every skill carries hand-written examples
 * with the text a person would type and the input that text should produce —
 * 1,510 of them, each already executed by `npm test` and compared to a stated
 * output. That is a labelled planner set that nobody has to label: the message
 * is the example's text, the plan is one step calling that skill with that
 * input, and the shortlist is whatever the real router returns for that text.
 *
 * So no row here is written by a model or trusted on faith. Each one is
 * EXECUTED before it is kept, and dropped unless it reproduces the example's
 * stated output. A training set that cannot run is a training set that teaches
 * plans that do not work.
 *
 * Four rules, and each one exists because leaving it out would quietly poison
 * the set:
 *
 *   1. THE PROMPT IS THE REAL PROMPT. The system and user turns come from
 *      plannerSystem() and plannerUserMessage() in planner.js — the same
 *      functions the app calls. Rebuilding those strings here is how training
 *      and inference drift apart, and model/README.md records that the category
 *      adapter is measurably worse when asked in any other form.
 *
 *   2. THE SHORTLIST IS THE REAL SHORTLIST. Cards come from the router, not
 *      from "the right skill plus some distractors". A planner trained on a
 *      tidy list learns a task it will never be given: at inference the right
 *      skill is sometimes third, sometimes absent.
 *
 *   3. THE BENCH IS NEVER TRAINED ON. Every message in scripts/holdout.mjs and
 *      scripts/no-skill-set.mjs is excluded, and so is any message that merely
 *      normalises to the same text. Those 352 messages are how the adapter will
 *      be graded and a number measured on training data is worth nothing.
 *
 *   4. DECLINING IS TAUGHT, NOT ASSUMED. §7.3 puts empty plans at 15% of the
 *      mix. The 2B's failure mode with a runway is over-commitment — it answers
 *      22 of 50 nonsense messages when given room to think — so the negative
 *      rows here are the ones that keep the adapter from inheriting that.
 *
 * Usage:
 *   node scripts/plannerdata.mjs                 # write model/planner-data/
 *   node scripts/plannerdata.mjs --dry           # count and sample, write nothing
 *   node scripts/plannerdata.mjs --router category --category-base http://127.0.0.1:8101
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import entries from '../skills/index.js';
import { buildRegistry } from '../src/registry.js';
import { LexicalRouter } from '../src/router.js';
import { categoryRouter, CATEGORY_CONFIDENCE } from '../src/category-router.js';
import { llamaServer } from '../src/llm.js';
import { plannerSystem, plannerUserMessage } from '../src/planner.js';
import { validatePlan, normalisePlanRefs } from '../src/plan.js';
import { runPlan } from '../src/executor.js';
import { HOLDOUT } from './holdout.mjs';
import { NO_SKILL_MESSAGES } from './no-skill-set.mjs';
import './lib/apikey.mjs'; // the model servers' key → PIGEON_API_KEY

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };

const OUT_DIR = opt('--out', join(ROOT, 'model/planner-data'));
/* Answers longer than this are outliers that dominate the sequence-length
   budget; see singleStepRows. */
const MAX_ANSWER_CHARS = Number(opt('--max-answer-chars', '600'));
/* And a ceiling on the WHOLE row, because the prompt is what is long: twenty
   cards run to ~1,700 tokens at p95 and a handful of rows pass 2,048, which is
   the sequence length the MLX run trains at. A row longer than that is not
   truncated by the trainer at the start — it is truncated at the END, where
   the plan is, so it would train a prompt whose answer was cut off (Phase A in
   Flight School found 24% of a set doing exactly this). Measured with the real
   tokenizer, 3.6 characters per token is the right ratio for these rows; the
   default keeps everything under 2,048 tokens with room to spare. */
const MAX_ROW_CHARS = Number(opt('--max-row-chars', '7000'));
const DRY = flag('--dry');

const registry = buildRegistry(entries);

/* The ctx every row is built against. Fixed, because a plan that copies a date
   out of TODAY has to be reproducible: with a moving clock the same example
   would train a different answer every run, and the set would stop being
   checkable. It is the same frozen clock the test suite uses. */
const CTX = {
  now: '2026-09-01T09:00:00Z', timezone: 'UTC', locale: 'en-GB',
  units: 'metric', webEnabled: false, confirmBeforeNetwork: true
};

/* ── the router, as the app would have it ────────────────────────────────── */
const CATEGORY_BASE = opt('--category-base', null);
const router = opt('--router', 'lexical') === 'category'
  ? categoryRouter({
      registry,
      complete: llamaServer({ base: CATEGORY_BASE || 'http://127.0.0.1:8101' }),
      trained: true,
      minConfidence: CATEGORY_CONFIDENCE
    })
  : new LexicalRouter(registry);

/* ── what must never be trained on ───────────────────────────────────────── */
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const RESERVED = new Set([
  ...HOLDOUT.map(([m]) => norm(m)),
  ...NO_SKILL_MESSAGES.map(m => norm(m))
]);

/* ── row construction ────────────────────────────────────────────────────── */

/** One training row, in the trainer's format: system, user, assistant.
 *  Returns null when the row would exceed the sequence ceiling. */
function row ({ message, cards, plan, runway }) {
  const messages = [
    { role: 'system', content: plannerSystem({ runway }) },
    { role: 'user', content: plannerUserMessage({ message, cards, ctx: CTX }) },
    { role: 'assistant', content: JSON.stringify(plan) }
  ];
  const chars = messages.reduce((n, m) => n + m.content.length, 0);
  if (chars > MAX_ROW_CHARS) { tooLongRows++; return null; }
  return { messages };
}
let tooLongRows = 0;

/* The runway's `about` field, derived from the skill rather than invented.
 *
 * planner.js records what happens when this is a constant: an earlier build put
 * the literal string "the request" in all three demonstrations and the model
 * emitted "the request" every time, turning the field into filler. It has to
 * name THIS request to do its job, so it is built from the skill's own
 * description — the one sentence that says what the tool does. */
function aboutFor (skill) {
  const d = String(skill.description || '').replace(/\.$/, '');
  const first = d.split(/[—.]/)[0].trim();
  return first.charAt(0).toLowerCase() + first.slice(1);
}

/** The shortlist the planner would really be handed for this message. */
async function cardsFor (message) {
  const routing = await router.route(message, { prevMessage: '', prevSkills: [] });
  const shortlist = routing.forPlanner && routing.forPlanner.length
    ? routing.forPlanner
    : routing.candidates.slice(0, 10);
  return {
    cards: shortlist.map(c => registry.compactCard(c.name)).filter(Boolean),
    confident: Boolean(routing.actionable && routing.actionable.length) ||
      (typeof routing.category === 'string' && !['none', 'unavailable'].includes(routing.category))
  };
}

/** Run a plan and say whether it reproduces what the example claims. */
async function planWorks (plan, expected) {
  const check = validatePlan(plan, registry);
  if (!check.ok) return false;
  const run = await runPlan(plan, { registry, ctx: CTX, message: '' });
  if (!run.results.length || !run.results.every(r => r.ok)) return false;
  if (!expected) return true;
  /* Every field the example states must come back with the same value. The
     example may state a subset; extra fields in the output are fine. */
  const got = run.results[run.results.length - 1].value;
  return Object.entries(expected).every(([k, v]) =>
    JSON.stringify(got?.[k]) === JSON.stringify(v));
}

/* ── 1. single-step rows, from every skill's own examples ─────────────────── */
async function singleStepRows () {
  const rows = [];
  const dropped = { reserved: 0, noText: 0, didNotRun: 0, notShortlisted: 0, tooLong: 0 };

  for (const skill of registry.routable()) {
    for (const ex of skill.examples || []) {
      if (!ex.text) { dropped.noText++; continue; }
      if (RESERVED.has(norm(ex.text))) { dropped.reserved++; continue; }
      /* An example carrying its own ctx is exercising a mode the planner does
         not choose — a web fixture, mostly — and its input is not something a
         plan could have produced from the message alone. */
      if (ex.ctx) { dropped.noText++; continue; }

      const plan = { steps: [{ id: 's1', skill: skill.name, input: ex.input }] };
      if (!(await planWorks(plan, ex.output))) { dropped.didNotRun++; continue; }

      /* An example whose input embeds a long passage — "how long is this
         article to read" carries the article — produces a plan that is mostly
         copied prose. Copying the user's text into an input IS part of the job,
         so a few of these belong in the set, but a 3,700-character answer costs
         more sequence length than every short row put together and teaches
         nothing the short ones do not. Capped rather than dropped by kind. */
      if (JSON.stringify(plan).length > MAX_ANSWER_CHARS) { dropped.tooLong++; continue; }

      const { cards, confident } = await cardsFor(ex.text);
      /* If the router cannot put the right skill in front of the planner, no
         plan the planner writes can be correct, and a row teaching it to name a
         skill it was never shown teaches hallucination. Those messages are a
         ROUTER problem and belong in the category adapter's set, not here. */
      if (!cards.some(c => c.name === skill.name)) { dropped.notShortlisted++; continue; }

      const runway = confident;
      const r = row({
        message: ex.text,
        cards,
        plan: runway ? { about: aboutFor(skill), ...plan } : plan,
        runway
      });
      if (r) rows.push(r);
    }
  }
  return { rows, dropped };
}

/* ── 2. multi-step rows, built from patterns and then executed ────────────── */
/* The examples are all single-step, so a chained plan has no source in the
   repo — and chaining is where the planner is weakest and where the ref syntax
   ("$s1.result / 10") has to be learnt. These are written as PATTERNS rather
   than as rows so that the arithmetic is generated and then checked by running
   it, not by the author doing sums in their head. */
const CHAIN_PATTERNS = [
  { ask: (a, b, n) => `what is ${a} * ${b}? then divide by ${n}`,
    steps: (a, b, n) => [
      { id: 's1', skill: 'evaluateExpression', input: { expression: `${a} * ${b}` } },
      { id: 's2', skill: 'evaluateExpression', input: { expression: `$s1.result / ${n}` } }
    ],
    about: 'multiplying two numbers, then dividing the result' },
  { ask: (a, b, n) => `what is ${a} * ${b} then multiply by ${n}`,
    steps: (a, b, n) => [
      { id: 's1', skill: 'evaluateExpression', input: { expression: `${a} * ${b}` } },
      { id: 's2', skill: 'evaluateExpression', input: { expression: `$s1.result * ${n}` } }
    ],
    about: 'multiplying two numbers, then scaling the result' },
  { ask: (a, b, n) => `add ${a} and ${b} then divide by ${n}`,
    steps: (a, b, n) => [
      { id: 's1', skill: 'evaluateExpression', input: { expression: `${a} + ${b}` } },
      { id: 's2', skill: 'evaluateExpression', input: { expression: `$s1.result / ${n}` } }
    ],
    about: 'adding two numbers, then dividing the total' },
  { ask: (a, b, n) => `what is ${a}% of ${b}, then multiply that by ${n}`,
    steps: (a, b, n) => [
      { id: 's1', skill: 'percentOf', input: { percent: a, value: b } },
      { id: 's2', skill: 'evaluateExpression', input: { expression: `$s1.result * ${n}` } }
    ],
    about: 'taking a percentage, then scaling it' }
];

const TRIPLES = [
  [20, 200, 10], [12, 8, 4], [45, 3, 5], [150, 4, 6], [7, 30, 2],
  [64, 5, 8], [18, 25, 3], [90, 12, 9], [33, 6, 11], [250, 8, 5]
];

async function chainRows () {
  const rows = [];
  let dropped = 0;
  for (const pattern of CHAIN_PATTERNS) {
    for (const [a, b, n] of TRIPLES) {
      const message = pattern.ask(a, b, n);
      if (RESERVED.has(norm(message))) { dropped++; continue; }
      const plan = normalisePlanRefs({ steps: pattern.steps(a, b, n) });
      /* No expected output to compare against — the arithmetic is the skill's
         job and it is already tested. What matters here is that the plan is
         valid, the refs resolve and every step succeeds. */
      if (!(await planWorks(plan, null))) { dropped++; continue; }
      const { cards } = await cardsFor(message);
      if (!plan.steps.every(st => cards.some(c => c.name === st.skill))) { dropped++; continue; }
      const r = row({ message, cards, plan: { about: pattern.about, ...plan }, runway: true });
      if (r) rows.push(r);
    }
  }
  return { rows, dropped };
}

/* ── 3. negative rows: the empty plan ────────────────────────────────────── */
/* §7.3's 15%, and model/README.md is blunt about why they matter most: the
   untrained base model refused 0 of 50 nonsense messages, and "the negative
   examples in the training data are what fixed that".
 *
 * The bulk of them are not written here. The category adapter's own training
 * set already contains ~800 hand-written messages labelled `none` — the same
 * project, the same voice, the same judgement about what has no skill — and
 * reusing them beats inventing a second, thinner set with a different flavour.
 * They are sampled deterministically to hit the §7.3 share rather than taken
 * whole, which would make a third of this set declines and teach timidity. */
async function harvestedDeclines (want) {
  const { readFile } = await import('node:fs/promises');
  const seen = new Set();
  const out = [];
  for (const file of ['train.jsonl', 'valid.jsonl']) {
    let text;
    try { text = await readFile(join(ROOT, 'model/training-data', file), 'utf8'); }
    catch { continue; }
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      let r;
      try { r = JSON.parse(line); } catch { continue; }
      const msgs = r && r.messages;
      if (!Array.isArray(msgs) || msgs.length < 3) continue;
      if (String(msgs[msgs.length - 1].content).trim() !== 'none') continue;
      const message = String(msgs[1].content).trim();
      const key = norm(message);
      if (!message || seen.has(key) || RESERVED.has(key)) continue;
      seen.add(key);
      out.push(message);
    }
  }
  /* Deterministic sample: sort by a hash of the message so the same rows are
     chosen on every run, without taking them in file order (which is grouped). */
  const h = (str) => { let x = 2166136261; for (const c of str) x = Math.imul(x ^ c.charCodeAt(0), 16777619); return x >>> 0; };
  return out.sort((a, b) => h(a) - h(b)).slice(0, want);
}

/* A few written here as well, covering shapes the category set is light on:
   explicit requests to write, translate, advise or opine. */
const DECLINE = [
  'write me a poem about the sea', 'draft an email to my landlord about the boiler',
  'what do you think of this idea', 'tell me a joke about pigeons',
  'explain quantum entanglement to a child', 'summarise this article for me',
  'translate this into portuguese', 'is it worth learning rust in 2026',
  'give me some advice about my career', 'i had a really rough day',
  'what should i cook tonight', 'help me name my cat',
  'rewrite this paragraph so it sounds friendlier', 'brainstorm names for a coffee shop',
  'why is the sky blue', 'do you like music',
  'write a haiku about deadlines', 'argue for and against remote work',
  'what is the meaning of life', 'tell me a story about a lighthouse',
  'proofread this for tone', 'come up with a slogan for a bakery',
  'who would win in a fight, a bear or a gorilla', 'cheer me up',
  'describe the taste of saffron', 'invent a board game for two players'
];

async function declineRows (positives) {
  const rows = [];
  let dropped = 0;
  /* §7.3 asks for about 15% of the mix. Solve for it rather than hard-coding a
     count, so the share holds as the positive set grows. */
  const want = Math.max(0, Math.round(positives * 0.15 / 0.85) - DECLINE.length);
  const messages = [...DECLINE, ...(await harvestedDeclines(want))];
  for (const message of messages) {
    if (RESERVED.has(norm(message))) { dropped++; continue; }
    const { cards, confident } = await cardsFor(message);
    if (!cards.length) { dropped++; continue; }
    /* No runway on these: the app only grants one when the router believes a
       skill exists, and a decline row taught in the runway format would be
       teaching the wrong prompt for the case that matters most. */
    const r = row({ message, cards, plan: { steps: [] }, runway: confident });
    if (r) rows.push(r);
  }
  return { rows, dropped };
}

/* ── split, by MESSAGE, so no phrasing appears in two files ──────────────── */
function split (rows) {
  const byMessage = new Map();
  for (const r of rows) {
    const key = norm(r.messages[1].content.split('MESSAGE\n').pop());
    if (!byMessage.has(key)) byMessage.set(key, []);
    byMessage.get(key).push(r);
  }
  const keys = [...byMessage.keys()].sort();
  /* Deterministic, and not by insertion order: the rows arrive grouped by
     skill, so slicing the array directly would put whole categories in valid. */
  const hash = (s) => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return (h >>> 0) / 2 ** 32; };
  const train = [], valid = [], grade = [];
  for (const k of keys) {
    const h = hash(k);
    const bucket = h < 0.80 ? train : h < 0.90 ? valid : grade;
    bucket.push(...byMessage.get(k));
  }
  return { train, valid, grade };
}

/* ── run ─────────────────────────────────────────────────────────────────── */
console.log(`\n  router: ${router.name || 'lexical'}`);
console.log('  building single-step rows from every skill\'s examples…');
const single = await singleStepRows();
console.log('  building chained rows…');
const chain = await chainRows();
console.log('  building decline rows…');
const decline = await declineRows(single.rows.length + chain.rows.length);

const all = [...single.rows, ...chain.rows, ...decline.rows];
const { train, valid, grade } = split(all);

console.log(`\n  single-step  ${String(single.rows.length).padStart(5)}  (dropped: ${single.dropped.didNotRun} did not run, ${single.dropped.notShortlisted} not shortlisted, ${single.dropped.reserved} reserved for the bench, ${single.dropped.tooLong} over ${MAX_ANSWER_CHARS} chars, ${single.dropped.noText} no usable text)`);
console.log(`  chained      ${String(chain.rows.length).padStart(5)}  (dropped ${chain.dropped})`);
console.log(`  declines     ${String(decline.rows.length).padStart(5)}  (dropped ${decline.dropped})`);
if (tooLongRows) console.log(`  (${tooLongRows} rows dropped for exceeding ${MAX_ROW_CHARS} chars ≈ the 2,048-token sequence ceiling)`);
console.log(`  ─────────────────`);
console.log(`  total        ${String(all.length).padStart(5)}   ${(decline.rows.length / all.length * 100).toFixed(1)}% declines (§7.3 asks for ~15%)`);
console.log(`\n  train ${train.length} · valid ${valid.length} · grade ${grade.length}`);

const sample = all.find(r => r.messages[2].content.includes('about'));
if (sample) {
  console.log('\n  ── a row ──────────────────────────────────────────────');
  console.log('  SYSTEM  ' + sample.messages[0].content.split('\n')[0] + ' …');
  console.log('  USER    ' + sample.messages[1].content.split('\n').slice(0, 2).join('\n          ') + ' …');
  console.log('          … ' + sample.messages[1].content.split('\n').slice(-2).join('\n          '));
  console.log('  PLAN    ' + sample.messages[2].content);
}

if (DRY) {
  console.log('\n  --dry: nothing written.\n');
} else {
  await mkdir(OUT_DIR, { recursive: true });
  const write = (name, rows) =>
    writeFile(join(OUT_DIR, name), rows.map(r => JSON.stringify(r)).join('\n') + '\n');
  await Promise.all([
    write('train.jsonl', train),
    write('valid.jsonl', valid),
    write('grade.jsonl', grade)
  ]);
  await writeFile(join(OUT_DIR, 'SYSTEM.txt'), plannerSystem({ runway: true }));
  console.log(`\n  written to ${OUT_DIR}\n`);
}
