#!/usr/bin/env node
/* focusbench.mjs — Patch's focus pass alone, as the app asks it.
 *
 *   node scripts/focusbench.mjs --engine http://127.0.0.1:8150 [--set bench/focus-heldout.json] [--record out.json]
 *
 * The app's own `sentenceFocus` (src/focus.js) with its shipped prompt, so the
 * request names the `patch-focus` Pigeon and the engine answers with whatever
 * file the nest carries. Each case is a question, a passage, and the number of
 * the sentence that answers it in `splitSentences`' split (0: none does).
 *
 *   right       the sentence picked is the labelled one (higher is better)
 *   zero right  of the cases labelled 0, how many it left whole
 *   off         answers that were not the contract's JSON (lower is better)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { relative } from 'node:path';
import { sentenceFocus, splitSentences } from '../src/focus.js';
import { pigeonServer } from './lib/pigeon-serve.mjs';

const argv = process.argv.slice(2);
const opt = (n, d = null) => { const i = argv.indexOf(n); return i > -1 && argv[i + 1] ? argv[i + 1] : d; };
const ENGINE = opt('--engine');
if (!ENGINE) { console.error('--engine <pigeon-serve url> is required'); process.exit(2); }
const SET = opt('--set', new URL('../bench/focus-heldout.json', import.meta.url).pathname);
const cases = JSON.parse(readFileSync(SET, 'utf8')).cases;

const served = pigeonServer({ base: ENGINE });
if (!(await served.health())) { console.error(`no pigeon-serve on ${ENGINE}`); process.exit(1); }
let last = null;
const complete = async (req) => { const out = await served(req); last = out.text; return out; };
const focus = sentenceFocus({ complete });

const rows = [];
for (const c of cases) {
  const n = splitSentences(c.passage).length;
  last = null;
  const r = await focus({ message: c.question, answer: c.passage });
  let off = false;
  try { const j = JSON.parse(last); off = !(typeof j.looking_for === 'string' && Number.isInteger(Number(j.sentence))); } catch { off = last !== null; }
  const picked = r ? r.kept[0] : 0;
  rows.push({ ...c, sentences: n, picked, right: picked === c.sentence || (c.also || []).includes(picked), off, said: last });
}
const zero = rows.filter(r => r.sentence === 0);
const bySource = {};
for (const r of rows) { const s = (bySource[r.source] ??= { right: 0, of: 0 }); s.of++; if (r.right) s.right++; }
const out = {
  date: new Date().toISOString(), engine: ENGINE, set: relative(new URL('..', import.meta.url).pathname, SET),
  right: rows.filter(r => r.right).length, of: rows.length,
  zeroRight: zero.filter(r => r.right).length, zeroOf: zero.length,
  off: rows.filter(r => r.off).length, bySource, rows
};
console.log(`\n  right sentence     ${out.right} / ${out.of}   (higher is better)`);
console.log(`  none, left whole   ${out.zeroRight} / ${out.zeroOf}`);
console.log(`  off contract       ${out.off}   (lower is better)`);
for (const [s, v] of Object.entries(bySource)) console.log(`    ${s.padEnd(14)} ${v.right} / ${v.of}`);
console.log('');
const REC = opt('--record');
if (REC) writeFileSync(REC, JSON.stringify(out, null, 1) + '\n');
