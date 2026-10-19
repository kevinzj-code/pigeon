#!/usr/bin/env node
/* asksdata-check.mjs <authored file> — checks one batch of lure pairs.
 *
 *   node scripts/asksdata-check.mjs bench/asks-rows/authored/l01.json
 *
 * Fails (exit 1) on: a malformed pair, a skill not in the batch's brief, fewer
 * than 2 pairs for a skill, a duplicate message, a message within the hold-out
 * rule (bench 308 + 100, the 152 twin messages, followups) or equal to a shot,
 * and a NO lure within reach of a real ask in the planner rows (it would teach
 * the opposite label for the same words). Prints flags for review on top.
 */
import { readFileSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { norm, words, jaccard, HELD_OUT_REACH } from './lib/planner-rows-2.mjs';
import { heldOut, closeTo, SHOT_MESSAGES, lureFlags } from './lib/asks-rows.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const file = process.argv[2];
if (!file) { console.error('usage: node scripts/asksdata-check.mjs <authored file>'); process.exit(2); }
const doc = JSON.parse(readFileSync(file, 'utf8'));
const brief = JSON.parse(readFileSync(join(ROOT, 'bench/asks-rows/brief', basename(file)), 'utf8'));
const want = new Set(brief.skills.map(s => s.skill));
const held = heldOut(ROOT);

/* The real asks the rows already have, so a NO lure cannot sit on top of one. */
const asks = [];
const H = join(process.env.HOME, 'Downloads/patch-planner-training-3');
for (const f of ['train', 'valid', 'grade']) for (const l of readFileSync(join(H, `${f}.jsonl`), 'utf8').split('\n')) {
  if (!l.trim()) continue;
  const r = JSON.parse(l);
  const u = r.messages[0].content;
  if ((JSON.parse(r.messages[1].content).steps || []).length) asks.push(words(u.slice(u.lastIndexOf('\nMESSAGE\n') + 9)));
}

const errors = [], flags = [], per = {}, seen = new Set();
for (const [i, p] of (doc.pairs || []).entries()) {
  const at = `pair ${i + 1} (${p.skill})`;
  if (!p || typeof p.no !== 'string' || typeof p.yes !== 'string' || !p.no.trim() || !p.yes.trim()) { errors.push(`${at}: needs skill, no and yes`); continue; }
  if (!want.has(p.skill)) errors.push(`${at}: ${p.skill} is not in this batch`);
  per[p.skill] = (per[p.skill] || 0) + 1;
  for (const [side, m] of [['no', p.no], ['yes', p.yes]]) {
    if (seen.has(norm(m))) errors.push(`${at}: duplicate ${side} "${m}"`);
    seen.add(norm(m));
    if (closeTo(m, held)) errors.push(`${at}: ${side} is within the hold-out rule: "${m}"`);
    if (SHOT_MESSAGES.has(norm(m))) errors.push(`${at}: ${side} is one of ASKS_SHOTS`);
  }
  const w = words(p.no);
  if (asks.some(a => jaccard(w, a) >= HELD_OUT_REACH)) errors.push(`${at}: NO is within reach of a real ask in the planner rows: "${p.no}"`);
  for (const f of lureFlags(p)) flags.push(`${at}: ${f} — NO "${p.no}" / YES "${p.yes}"`);
}
for (const s of want) if ((per[s] || 0) < 2) errors.push(`${s}: ${per[s] || 0} pairs (needs 2)`);

for (const f of flags) console.log(`  flag   ${f}`);
for (const e of errors) console.log(`  ERROR  ${e}`);
console.log(`\n  ${file}: ${(doc.pairs || []).length} pairs, ${Object.keys(per).length} of ${want.size} skills · ${errors.length} errors · ${flags.length} flags`);
process.exit(errors.length ? 1 : 0);
