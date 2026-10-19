#!/usr/bin/env node
/* modelbench.mjs — race two local models at the two jobs the router needs doing.
 *
 * Stage 1 of the routing plan. The question is not "which model is smarter" but
 * "which model can pick from a list quickly", and those turn out to be very
 * different questions:
 *
 *   Qwen3.5-2B is a THINKING model. Constrain it to answer with a category name
 *   as its first token and it collapses — measured at 4-6%, which was the
 *   constraint's fault and not the model's. Given room to reason it is correct,
 *   and takes about six seconds. Across a three-step pipeline that is a
 *   different product.
 *
 * So both modes are measured, per model:
 *   --mode constrained   grammar-locked, answer immediately. Fast, and fatal to
 *                        a thinking model.
 *   --mode free          reason first, answer on a final line. Slow but honest
 *                        about what the model actually knows.
 *
 * A model is only usable for this job if it is good in CONSTRAINED mode, or good
 * enough in free mode to be worth the seconds. Report both and let the numbers
 * decide.
 *
 *   node scripts/modelbench.mjs --base http://127.0.0.1:8100 --label qwen2.5-1.5b
 */

import entries from '../skills/index.js';
import { buildRegistry } from '../src/registry.js';
import { LexicalRouter } from '../src/router.js';
import { llamaServer } from '../src/llm.js';
import { HOLDOUT_GRADE } from './holdout.mjs';
import { NO_SKILL_MESSAGES } from './no-skill-set.mjs';
import './lib/apikey.mjs'; // the model servers' key → PIGEON_API_KEY

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const BASE = opt('--base', 'http://127.0.0.1:8099');
const LABEL = opt('--label', BASE);
const MODE = opt('--mode', 'both');
const LIMIT = Number(opt('--limit', '0')) || Infinity;
const K = Number(opt('--k', '20'));

const registry = buildRegistry(entries);
const router = new LexicalRouter(registry, { k: K });
const complete = llamaServer({ base: BASE, timeoutMs: 120000 });

const built = registry.routable();
const byCat = {};
for (const s of built) (byCat[s.category] ??= []).push(s);
const CATS = Object.keys(byCat).sort();
const catOf = Object.fromEntries(built.map(s => [s.name, s.category]));

/* One line per category, naming a few of its skills. A bare list of category
   names is not enough — "encoding" and "conversion" are not self-explanatory. */
const menu = CATS.map(c => `- ${c}: ${byCat[c].slice(0, 5).map(s => s.name).join(', ')}${byCat[c].length > 5 ? ', …' : ''}`).join('\n');

const CAT_SYS = `Route the user's request to ONE category of tools.\n\nCategories:\n${menu}`;
/* This model returns an empty answer without few-shot examples — measured, and
   the reason the planner carries its own shots. */
const CAT_SHOTS = [
  ['how many days until christmas', 'dates'],
  ['convert 5 miles to km', 'conversion'],
  ['sha256 of hello', 'encoding'],
  ['what is the median of these numbers', 'statistics'],
  ['count the words in this paragraph', 'text']
].flatMap(([q, a]) => [{ role: 'user', content: q }, { role: 'assistant', content: a }]);

const catGrammar = `root ::= ${[...CATS, 'none'].map(c => `"${c}"`).join(' | ')}`;

const strip = (t) => t.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

async function askCategory (message, mode) {
  if (mode === 'constrained') {
    const out = await complete({
      messages: [{ role: 'system', content: CAT_SYS }, ...CAT_SHOTS, { role: 'user', content: message }],
      grammar: catGrammar, maxTokens: 12, temperature: 0
    });
    return { answer: strip(out.text), ms: out.ms };
  }
  const out = await complete({
    messages: [
      { role: 'system', content: `${CAT_SYS}\n\nThink briefly, then end with a final line exactly:\nCATEGORY: <name>` },
      { role: 'user', content: message }
    ],
    maxTokens: 600, temperature: 0
  });
  const m = /CATEGORY:\s*([a-z]+)/i.exec(out.text);
  return { answer: m ? m[1].toLowerCase() : null, ms: out.ms };
}

async function askSkill (message, mode) {
  const cands = router.route(message).candidates;
  if (!cands.length) return { answer: null, ms: 0, offered: [] };
  const list = cands.map(c => `- ${c.name}: ${registry.skill(c.name).description}`).join('\n');
  const sys = `Pick the ONE tool that answers the request, or "none".\n\nTools:\n${list}`;
  const names = cands.map(c => c.name);

  if (mode === 'constrained') {
    const out = await complete({
      messages: [{ role: 'system', content: sys }, { role: 'user', content: message }],
      grammar: `root ::= ${[...names, 'none'].map(n => `"${n}"`).join(' | ')}`,
      maxTokens: 24, temperature: 0
    });
    return { answer: strip(out.text), ms: out.ms, offered: names };
  }
  const out = await complete({
    messages: [
      { role: 'system', content: `${sys}\n\nThink briefly, then end with a final line exactly:\nTOOL: <name>` },
      { role: 'user', content: message }
    ],
    maxTokens: 600, temperature: 0
  });
  const m = /TOOL:\s*([A-Za-z0-9]+)/.exec(out.text);
  return { answer: m ? m[1] : null, ms: out.ms, offered: names };
}

const cases = HOLDOUT_GRADE.slice(0, LIMIT);
const negatives = NO_SKILL_MESSAGES.slice(0, LIMIT);

console.log(`\n  model: ${LABEL}   base: ${BASE}   shortlist: ${K}`);
console.log(`  ${cases.length} graded questions + ${negatives.length} that must be refused\n`);

for (const mode of MODE === 'both' ? ['constrained', 'free'] : [MODE]) {
  for (const [job, ask, correct] of [
    ['category', askCategory, (want, got) => got === catOf[want]],
    ['skill', askSkill, (want, got) => got === want]
  ]) {
    let right = 0; let unparsed = 0; let ms = 0; let reachable = 0;
    for (const [msg, want] of cases) {
      const r = await ask(msg, mode);
      ms += r.ms;
      if (r.answer === null) unparsed++;
      if (correct(want, r.answer)) right++;
      /* For the skill job, only count questions where the right answer was
         actually on the list — otherwise this measures the router, not the model. */
      if (job === 'skill' && (!r.offered || r.offered.includes(want))) reachable++;
    }
    let refused = 0;
    for (const msg of negatives) {
      const r = await ask(msg, mode);
      ms += r.ms;
      if (r.answer === null || r.answer === 'none') refused++;
    }
    const total = cases.length + negatives.length;
    const line = `${right}/${cases.length} (${(100 * right / cases.length).toFixed(0)}%)`;
    console.log(`  ${mode.padEnd(12)} ${job.padEnd(9)} right ${line.padEnd(16)} refused ${refused}/${negatives.length}   unparsed ${String(unparsed).padStart(3)}   ${Math.round(ms / total)}ms avg`);
    if (job === 'skill') console.log(`  ${' '.repeat(12)} ${' '.repeat(9)} (right answer was on the shortlist for ${reachable}/${cases.length})`);
  }
  console.log('');
}
