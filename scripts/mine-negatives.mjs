#!/usr/bin/env node
/* mine-negatives.mjs — keep only the negatives the adapter actually gets wrong.
 *
 * Measured before this existed: of 120 generated negatives, the shipped adapter
 * already refuses 73 and confidently mis-categorises 47. Training on all of
 * them would spend three rows in five teaching something already known, while
 * shifting the refusal share of the set from 13% toward 20% — which is how a
 * fix for leaks turns into a model that refuses real questions. That is the
 * ground check's failure rebuilt in data instead of code.
 *
 * So this keeps the hard ones: the sentences the adapter names a category for,
 * above its own confidence bar. Those are the leak, exactly. Everything else is
 * written out too, so the decision is inspectable rather than implied.
 *
 *   node scripts/mine-negatives.mjs --in model/negatives --base http://127.0.0.1:8101
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import entries from '../skills/index.js';
import { buildRegistry } from '../src/registry.js';
import { llamaServer } from '../src/llm.js';
import { categoryRouter } from '../src/category-router.js';
import './lib/apikey.mjs'; // the model servers' key → PIGEON_API_KEY

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const DIR = arg('in', 'model/negatives');
const BASE = arg('base', 'http://127.0.0.1:8101');
const BAR = Number(arg('min-confidence', 0.80));

const registry = buildRegistry(entries);
const complete = llamaServer({ base: BASE });
if (!(await complete.health())) { console.error(`no category server on ${BASE}`); process.exit(1); }
const router = categoryRouter({ registry, complete, maxCandidates: 20, trained: true, minConfidence: BAR });

const all = JSON.parse(readFileSync(join(DIR, 'negatives.json'), 'utf8'));
const hard = [];
const easy = [];
for (let i = 0; i < all.length; i++) {
  const n = all[i];
  let r;
  try { r = await router.route(n.text); } catch { easy.push({ ...n, why: 'router error' }); continue; }
  const cat = r.category || 'none';
  const conf = typeof r.confidence === 'number' ? r.confidence : 0;
  if (cat !== 'none' && conf >= BAR) hard.push({ ...n, wrongly: cat, confidence: Number(conf.toFixed(3)) });
  else easy.push({ ...n, wrongly: cat, confidence: Number(conf.toFixed(3)) });
  if ((i + 1) % 100 === 0) process.stderr.write(`  ${i + 1}/${all.length} — ${hard.length} hard\n`);
}

writeFileSync(join(DIR, 'hard.json'), JSON.stringify(hard, null, 1));
writeFileSync(join(DIR, 'easy.json'), JSON.stringify(easy, null, 1));

const byCat = {};
for (const h of hard) byCat[h.wrongly] = (byCat[h.wrongly] || 0) + 1;
process.stderr.write(
  `\n${hard.length} hard of ${all.length} — the adapter names a category for these above ${BAR}\n` +
  `${easy.length} it already refuses, and they are not worth a training row\n` +
  `wrongly called: ${Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ')}\n`);
