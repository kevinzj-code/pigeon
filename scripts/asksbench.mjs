#!/usr/bin/env node
/* asksbench.mjs — Patch's asks check alone, as the app asks it.
 *
 *   node scripts/asksbench.mjs --engine http://127.0.0.1:8150 [--record out.json]
 *
 * The app's own `asksCheck` (src/verify.js) with its shipped prompt, so the
 * request names the `patch-asks` Pigeon and the engine answers with whatever
 * file the nest carries (prompted on Qwen3.5, or trained on Qwen3-VL). Two
 * numbers, both higher-is-better:
 *
 *   real asks let through   the planner bench's 308 holdout questions answered YES
 *   no-skill stopped        its 100 no-skill messages answered NO
 *
 * Anything that is not a clear NO counts as YES, as in the app.
 */
import { writeFileSync } from 'node:fs';
import { asksCheck } from '../src/verify.js';
import { HOLDOUT } from './holdout.mjs';
import { NO_SKILL_MESSAGES } from './no-skill-set.mjs';
import { pigeonServer } from './lib/pigeon-serve.mjs';

const argv = process.argv.slice(2);
const opt = (n, d = null) => { const i = argv.indexOf(n); return i > -1 && argv[i + 1] ? argv[i + 1] : d; };
const ENGINE = opt('--engine');
if (!ENGINE) { console.error('--engine <pigeon-serve url> is required'); process.exit(2); }
const complete = pigeonServer({ base: ENGINE });
if (!(await complete.health())) { console.error(`no pigeon-serve on ${ENGINE}`); process.exit(1); }
const asks = asksCheck({ complete });

const rows = [];
for (const [message, want] of HOLDOUT) { const r = await asks(message); rows.push({ message, set: 'holdout', want, said: r.said, asks: r.asks, clear: r.clear, ms: r.ms }); }
for (const message of NO_SKILL_MESSAGES) { const r = await asks(message); rows.push({ message, set: 'no-skill', said: r.said, asks: r.asks, clear: r.clear, ms: r.ms }); }

const h = rows.filter(r => r.set === 'holdout'), n = rows.filter(r => r.set === 'no-skill');
const out = {
  date: new Date().toISOString(), engine: ENGINE,
  letThrough: h.filter(r => r.asks).length, ofHoldout: h.length,
  stopped: n.filter(r => !r.asks).length, ofNoSkill: n.length,
  unclear: rows.filter(r => !r.clear).length,
  meanMs: Math.round(rows.reduce((a, r) => a + r.ms, 0) / rows.length),
  rows
};
console.log(`\n  real asks let through  ${out.letThrough} / ${out.ofHoldout}   (higher is better)`);
console.log(`  no-skill stopped       ${out.stopped} / ${out.ofNoSkill}   (higher is better)`);
console.log(`  answers neither YES nor NO  ${out.unclear}   ·   mean ${out.meanMs} ms\n`);
const REC = opt('--record');
if (REC) writeFileSync(REC, JSON.stringify(out, null, 1) + '\n');
