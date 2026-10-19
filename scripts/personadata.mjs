#!/usr/bin/env node
/* Build a persona corpus for Lane B.
 *
 * Two stages against one teacher server, both of them shaped by things the
 * earlier adapter work measured rather than assumed:
 *
 *   questions — sampled, with the questions already accepted fed back as an
 *   avoid-list. Without that a teacher asked for forty questions returns the
 *   same eight in a different order.
 *
 *   answers — temperature 0.9 and a FRESH SEED PER ROW. Drafting a persona
 *   greedily is the documented failure: 52 of 180 poet answers opened with the
 *   same six words, and the student then memorises the skeleton instead of the
 *   voice, repeating itself verbatim at inference even at 0.8. A label job
 *   needs greedy — the answer is the answer. A voice job does not.
 *
 * The seeds are drawn up front, in order, from one seeded Random, so a rerun
 * of the same plan produces the same corpus.
 *
 * Usage: node scripts/personadata.mjs model/persona-data/socratic-tutor.plan.json
 *          --base http://127.0.0.1:8110 --per-group 45 --holdout 20
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { isHeldOut } from './conversational.mjs';

const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
/* The plan is positional and comes first. Nothing clever: a --flag's value
   would otherwise be mistaken for it. */
const planPath = argv[0];
if (!planPath || planPath.startsWith('--')) {
  console.error('usage: node scripts/personadata.mjs <plan.json> [--base URL] [--per-group N] [--holdout N]');
  process.exit(2);
}
const BASE = arg('base', 'http://127.0.0.1:8110');
const PER_GROUP = Number(arg('per-group', 45));
const HOLDOUT = Number(arg('holdout', 20));
const OUT_DIR = arg('out', 'model/persona-data');

const plan = JSON.parse(readFileSync(planPath, 'utf8'));

/* A tiny deterministic PRNG. Seeding is the whole point; Math.random cannot be
   seeded, and the corpus has to be reproducible from the plan alone. */
function mulberry (seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry(11);
const randInt = () => Math.floor(rand() * 1e6) + 1;
const sample = (arr, n) => {
  const c = [...arr];
  const out = [];
  while (out.length < Math.min(n, c.length)) out.push(...c.splice(Math.floor(rand() * c.length), 1));
  return out;
};

async function chat (messages, { maxTokens = 512, temperature = 0, seed = 11 } = {}) {
  const r = await fetch(`${BASE}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      messages, max_tokens: maxTokens, temperature, seed,
      /* Qwen3.5 reasons by default. A persona corpus wants the reply, not the
         deliberation that precedes it. */
      chat_template_kwargs: { enable_thinking: false }
    })
  });
  if (!r.ok) throw new Error(`teacher ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  return String(j.choices?.[0]?.message?.content ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

const styleSystem = () =>
  `You are ${plan.label}. ${plan.voice}\n\nHow you write:\n` +
  plan.style.map(s => `- ${s}`).join('\n');

const splitLines = (text) => text.split('\n')
  .map(l => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim().replace(/^["']|["']$/g, ''))
  .filter(l => l.length > 6 && !l.endsWith(':'));

async function questionsFor (group) {
  const accepted = [];
  const seen = new Set();
  /* The seeds are questions too, and they are the ones that define the group's
     shape. Start from them rather than throwing them away. */
  let dropped = 0;
  for (const s of group.seeds) { accepted.push(s); seen.add(s.toLowerCase()); }
  for (let round = 0; round < 10 && accepted.length < PER_GROUP; round++) {
    const want = Math.min(14, PER_GROUP - accepted.length);
    const avoid = sample(accepted, Math.min(14, accepted.length));
    const text = await chat([
      { role: 'system', content: 'You write realistic user messages for a training set. You output nothing but the messages, one per line, no numbering, no commentary, no blank lines.' },
      { role: 'user', content:
        `A person is talking to ${plan.label}: ${plan.voice}\n\n` +
        `Write ${want} things ${group.ask} might say.\n\n` +
        `In the same shape and register as these:\n${group.seeds.slice(0, 6).map(s => `- ${s}`).join('\n')}\n\n` +
        `Each one is a single line, lowercase-casual, specific, and different from the others.\n\n` +
        `Do NOT repeat any of these, or anything close to them:\n${avoid.map(s => `- ${s}`).join('\n')}` }
    ], { maxTokens: 64 * want + 128, temperature: 0.95, seed: randInt() });
    for (const q of splitLines(text)) {
      const k = q.toLowerCase();
      /* The Lane B bench's own questions, kept out. A persona trained on them
         would score well there by memory, which measures nothing. */
      if (isHeldOut(q)) { dropped++; continue; }
      if (!seen.has(k) && accepted.length < PER_GROUP) { seen.add(k); accepted.push(q); }
    }
    process.stderr.write(`  ${group.name}: ${accepted.length}/${PER_GROUP}\n`);
  }
  if (dropped) process.stderr.write(`  ${group.name}: dropped ${dropped} that were the bench's own\n`);
  return accepted.map(q => ({ q, group: group.name }));
}

async function main () {
  process.stderr.write(`teacher: ${BASE}\npersona: ${plan.label}\n\nquestions\n`);
  let questions = [];
  for (const g of plan.groups) questions = questions.concat(await questionsFor(g));

  process.stderr.write(`\nanswers (${questions.length}, temperature 0.9, fresh seed per row)\n`);
  const system = styleSystem() +
    '\n\nEach reply must be STRUCTURALLY different from a typical one: vary your ' +
    'opening words, sentence shapes and length. Engage with the specific things ' +
    'this exact message mentions — name them. Never reuse a stock phrase.';

  const rows = [];
  let empty = 0;
  for (let i = 0; i < questions.length; i++) {
    const { q, group } = questions[i];
    let a = '';
    try {
      a = await chat([{ role: 'system', content: system }, { role: 'user', content: q }],
        { maxTokens: 220, temperature: 0.9, seed: randInt() });
    } catch (e) { process.stderr.write(`  ! ${e.message}\n`); }
    if (!a) { empty++; } else { rows.push({ q, a, group }); }
    if ((i + 1) % 10 === 0) process.stderr.write(`  ${i + 1}/${questions.length}\n`);
  }

  /* Held out before any shuffle so the split is by row, not by group: a
     holdout drawn from one group measures that group, not the persona. */
  const order = rows.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const shuffled = order.map(i => rows[i]);
  const valid = shuffled.slice(0, HOLDOUT);
  const train = shuffled.slice(HOLDOUT);

  const jsonl = (rs) => rs.map(r => JSON.stringify({
    messages: [{ role: 'user', content: r.q }, { role: 'assistant', content: r.a }]
  })).join('\n') + '\n';

  const dir = join(OUT_DIR, plan.id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'train.jsonl'), jsonl(train));
  writeFileSync(join(dir, 'valid.jsonl'), jsonl(valid));
  writeFileSync(join(dir, 'rows.json'), JSON.stringify(rows, null, 2));

  const opener = (s) => s.split(/\s+/).slice(0, 6).join(' ').toLowerCase();
  const openers = new Map();
  for (const r of rows) openers.set(opener(r.a), (openers.get(opener(r.a)) || 0) + 1);
  const dupes = [...openers.values()].filter(n => n > 1).reduce((a, b) => a + b, 0);

  /* train.command prints this before it spends an hour. Naming the set is the
     cheapest guard there is against a clean run on the wrong rows. */
  writeFileSync(join(dir, 'DATASET.txt'),
    `${plan.label} (${plan.id}) — Lane B persona\n` +
    `teacher ${BASE}, sampled at 0.9 with a fresh seed per row\n` +
    `${train.length} train / ${valid.length} valid, from ${plan.groups.length} question groups\n` +
    plan.groups.map(g => `  ${g.name}: ${rows.filter(r => r.group === g.name).length}`).join('\n') +
    `\nrepeated openings ${dupes}/${rows.length}\n` +
    `built ${new Date().toISOString().slice(0, 10)} by scripts/personadata.mjs from ${planPath}\n`);

  process.stderr.write(
    `\nwrote ${dir}\n  train ${train.length}   valid ${valid.length}   empty ${empty}\n` +
    `  repeated openings: ${dupes}/${rows.length} (the number the creative recipe exists to hold down)\n` +
    plan.groups.map(g => `  ${g.name}: ${rows.filter(r => r.group === g.name).length}`).join('\n') + '\n');
}

main().catch(e => { console.error(e); process.exit(1); });
