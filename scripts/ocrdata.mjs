#!/usr/bin/env node
/* ocrdata.mjs — training rows for `ocr-tidy` on Qwen3-VL 2B.
 *
 *   node scripts/ocrdata.mjs [--out <dir>/ocr-tidy-training]
 *
 * The contract is exactly what src/ocr.js sends (`cleanupOcr`): CLEANUP_SYSTEM,
 * the three CLEANUP_SHOTS, then the raw reading as the user turn, answered with
 * the clean text. Each clean text in bench/ocr-rows/authored/o*.json (passed by
 * scripts/ocrdata-check.mjs) becomes one row: damaged by scripts/ocr-corrupt.mjs
 * at a level chosen by hash (light, medium or heavy, a third each of the
 * damaged rows) or, for about one in ten, left undamaged, which the model must
 * hand back unchanged. The damage never touches a number, so the answer's
 * numbers are the reading's. The held-out texts (bench/ocr-rows/heldout-clean.json)
 * are never trained on; every row is checked against them again here.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { CLEANUP_SYSTEM, CLEANUP_SHOTS } from '../src/ocr.js';
import { corrupt, mulberry, numberTokens } from './ocr-corrupt.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (n, d = null) => { const i = argv.indexOf(n); return i > -1 && argv[i + 1] ? argv[i + 1] : d; };
const HOME = process.env.HOME;
const OUT = opt('--out', join(HOME, 'Downloads/ocr-tidy-training')).replace(/^~/, HOME);
const hash = (s) => createHash('sha256').update(s).digest('hex');
const frac = (s) => parseInt(hash(s).slice(0, 8), 16) / 0x100000000;
const seed = (s) => parseInt(hash(s).slice(0, 8), 16);

const STOP = new Set('a an the of to in on for and or is are was be at by with from as it this that your our you we'.split(' '));
const W = (t) => new Set(String(t).toLowerCase().replace(/[^a-z0-9£$€]+/g, ' ').split(' ').filter(w => w && !STOP.has(w)));
const J = (a, b) => { let n = 0; for (const w of a) if (b.has(w)) n++; return a.size && b.size ? n / (a.size + b.size - n) : 0; };

export function ocrRow (raw, truth) {
  return { messages: [{ role: 'system', content: CLEANUP_SYSTEM }, ...CLEANUP_SHOTS, { role: 'user', content: raw }, { role: 'assistant', content: truth }] };
}

const held = JSON.parse(readFileSync(join(ROOT, 'bench/ocr-rows/heldout-clean.json'), 'utf8')).texts.map(t => W(t.text));
const shotW = CLEANUP_SHOTS.filter(m => m.role === 'assistant').map(m => W(m.content));
const texts = [];
for (const f of readdirSync(join(ROOT, 'bench/ocr-rows/authored')).filter(f => /^o\d+\.json$/.test(f)).sort()) {
  const d = JSON.parse(readFileSync(join(ROOT, 'bench/ocr-rows/authored', f), 'utf8'));
  for (const t of d.texts) texts.push({ batch: d.batch, kind: t.kind, text: t.text });
}

const dropped = { heldOut: 0, shot: 0, duplicate: 0, numbersMoved: 0 };
const seen = [];
const rows = [];
for (const t of texts) {
  const w = W(t.text);
  if (held.some(h => J(w, h) >= 0.6)) { dropped.heldOut++; continue; }
  if (shotW.some(h => J(w, h) >= 0.6)) { dropped.shot++; continue; }
  if (seen.some(s => J(w, s) >= 0.6)) { dropped.duplicate++; continue; }
  seen.push(w);
  const f = frac('ocr-level:' + t.text);
  const level = f < 0.10 ? 'none' : f < 0.40 ? 'light' : f < 0.70 ? 'medium' : 'heavy';
  /* A damaged row must be damaged: a short text at the light level can come
     through untouched, so the dice are rolled again (up to 8 times). The
     undamaged rows are the 10% chosen above, not accidents. */
  let r = corrupt(t.text, { level: { wrap: 0, punctSpace: 0, runTogether: 0, splitWord: 0, letter: 0 } });
  if (level !== 'none') {
    for (let k = 0; k < 8; k++) {
      r = corrupt(t.text, { rng: mulberry(seed(`${level}:${k}:${t.text}`)), level });
      if (r.text !== r.truth) break;
    }
  }
  if (JSON.stringify(numberTokens(r.text)) !== JSON.stringify(numberTokens(r.truth))) { dropped.numbersMoved++; continue; }
  rows.push({ ...t, level, raw: r.text, truth: r.truth, unchanged: r.text === r.truth });
}

const out = { train: [], valid: [], grade: [] };
for (const r of rows) { const f = frac('ocr-split:' + r.truth); out[f < 0.08 ? 'grade' : f < 0.15 ? 'valid' : 'train'].push(r); }
for (const k of Object.keys(out)) out[k].sort((a, b) => hash('order:' + a.truth).localeCompare(hash('order:' + b.truth)));
mkdirSync(OUT, { recursive: true });
for (const [k, rs] of Object.entries(out)) writeFileSync(join(OUT, `${k}.jsonl`), rs.map(r => JSON.stringify(ocrRow(r.raw, r.truth))).join('\n') + '\n');

const tally = (rs, f) => { const o = {}; for (const r of rs) o[f(r)] = (o[f(r)] || 0) + 1; return o; };
const counts = {
  rows: Object.fromEntries(Object.entries(out).map(([k, r]) => [k, r.length])),
  total: rows.length, byLevel: tally(rows, r => r.level), byKind: tally(rows, r => r.kind), byBatch: tally(rows, r => r.batch),
  unchangedByDamage: rows.filter(r => r.unchanged).length,
  maxChars: Math.max(...rows.map(r => r.truth.length)),
  dropped, heldOutSetSize: held.length
};
writeFileSync(join(OUT, 'counts.json'), JSON.stringify(counts, null, 1) + '\n');
console.log(JSON.stringify(counts, null, 1));
