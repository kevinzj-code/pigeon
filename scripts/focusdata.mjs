#!/usr/bin/env node
/* focusdata.mjs — training rows for `patch-focus` on Qwen3-VL 2B.
 *
 *   node scripts/focusdata.mjs [--out <dir>/patch-focus-training]
 *
 * The contract is exactly what src/focus.js sends: FOCUS_SYSTEM, the four
 * FOCUS_SHOTS as user/assistant turns, then
 *   QUESTION\n<question>\n\nPASSAGE\n1. <sentence>\n2. …
 * (the passage split by the app's own splitSentences), answered with the
 * compact JSON {"looking_for":"…","sentence":n}, as the shots answer.
 *
 * Sources: the authored cases in bench/focus-rows/authored/f*.json, each
 * passed by scripts/focusdata-check.mjs, and the 72 constitution questions not
 * held out (labels from constitution-labels.json, runways from
 * constitution-lookingfor.json). The held-out set (bench/focus-heldout.json)
 * is never trained on; every row is checked against it again here.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { FOCUS_SYSTEM, FOCUS_SHOTS, splitSentences } from '../src/focus.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (n, d = null) => { const i = argv.indexOf(n); return i > -1 && argv[i + 1] ? argv[i + 1] : d; };
const HOME = process.env.HOME;
const OUT = opt('--out', join(HOME, 'Downloads/patch-focus-training')).replace(/^~/, HOME);
const F = join(ROOT, 'bench/focus-rows');
const hash = (s) => createHash('sha256').update(s).digest('hex');
const frac = (s) => parseInt(hash(s).slice(0, 8), 16) / 0x100000000;

const STOP = new Set('a an the of to in on for and or is was what who when where how which did does do it its by with at from as'.split(' '));
const W = (t) => new Set(String(t).toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter(w => w && !STOP.has(w)));
const J = (a, b) => { let n = 0; for (const w of a) if (b.has(w)) n++; return a.size && b.size ? n / (a.size + b.size - n) : 0; };

export function userTurn (question, sentences) {
  return `QUESTION\n${question}\n\nPASSAGE\n${sentences.map((s, i) => `${i + 1}. ${s}`).join('\n')}`;
}
export function focusRow (question, sentences, lookingFor, sentence) {
  return {
    messages: [
      { role: 'system', content: FOCUS_SYSTEM },
      ...FOCUS_SHOTS.flatMap(([u, a]) => [{ role: 'user', content: u }, { role: 'assistant', content: a }]),
      { role: 'user', content: userTurn(question, sentences) },
      { role: 'assistant', content: JSON.stringify({ looking_for: lookingFor, sentence }) }
    ]
  };
}

/* Cases a reviewer struck as arguable (both labels defensible) are left out. */
const struck = new Set(JSON.parse(readFileSync(join(F, 'review.json'), 'utf8')).strike.map(s => `${s.batch}|${s.question}`));
let struckCount = 0;
const cases = [];
for (const f of readdirSync(join(F, 'authored')).filter(f => /^f\d+\.json$/.test(f)).sort()) {
  const d = JSON.parse(readFileSync(join(F, 'authored', f), 'utf8'));
  for (const c of d.cases) if (struck.has(`${d.batch}|${c.question}`)) struckCount++; else cases.push({ source: d.batch, question: c.question.trim(), sentences: splitSentences(c.passage), sentence: c.sentence, lookingFor: c.looking_for.trim() });
}
const items = new Map(JSON.parse(readFileSync(join(F, 'constitution-items.json'), 'utf8')).map(i => [i.id, i]));
const labels = JSON.parse(readFileSync(join(F, 'constitution-labels.json'), 'utf8')).labels;
const runways = JSON.parse(readFileSync(join(F, 'constitution-lookingfor.json'), 'utf8'));
for (const l of labels) {
  const it = items.get(l.id);
  if (it.heldOut) continue;
  cases.push({ source: 'constitution', question: it.question, sentences: it.sentences, sentence: l.sentence, lookingFor: runways[l.id] });
}

/* Hold-out, again, over every row; and no question twice. */
const held = JSON.parse(readFileSync(join(ROOT, 'bench/focus-heldout.json'), 'utf8')).cases;
const heldQ = held.map(h => W(h.question)), heldS = held.map(h => W(splitSentences(h.passage)[0] || ''));
const shotQ = FOCUS_SHOTS.map(([u]) => W(u.split('\n')[1]));
const dropped = { heldOut: 0, duplicate: 0, shot: 0, malformed: 0 };
const struckInReview = () => struckCount;
const seen = [];
const kept = [];
for (const c of cases) {
  if (!c.lookingFor || !Number.isInteger(c.sentence) || c.sentence < 0 || c.sentence > c.sentences.length) { dropped.malformed++; continue; }
  const q = W(c.question), first = W(c.sentences[0] || '');
  if (heldQ.some(h => J(q, h) >= 0.6) || heldS.some(h => J(first, h) >= 0.6)) { dropped.heldOut++; continue; }
  if (shotQ.some(h => J(q, h) >= 0.6)) { dropped.shot++; continue; }
  /* A duplicate is the same question again. Several questions on one passage
     are the point (the model has to read the question), so the passage is not
     part of the key. */
  const key = W(c.question);
  if (seen.some(s => J(key, s) >= 0.8)) { dropped.duplicate++; continue; }
  seen.push(key);
  kept.push(c);
}

const out = { train: [], valid: [], grade: [] };
for (const c of kept) {
  /* By passage, so every question on one passage is in the same split. */
  const f = frac('focus-split:' + c.sentences.join(' '));
  out[f < 0.08 ? 'grade' : f < 0.15 ? 'valid' : 'train'].push(c);
}
for (const k of Object.keys(out)) out[k].sort((a, b) => hash('order:' + a.question).localeCompare(hash('order:' + b.question)));
mkdirSync(OUT, { recursive: true });
for (const [k, rows] of Object.entries(out)) writeFileSync(join(OUT, `${k}.jsonl`), rows.map(c => JSON.stringify(focusRow(c.question, c.sentences, c.lookingFor, c.sentence))).join('\n') + '\n');

const pos = (rows) => { const p = {}; for (const c of rows) p[c.sentence] = (p[c.sentence] || 0) + 1; return p; };
const counts = {
  rows: Object.fromEntries(Object.entries(out).map(([k, r]) => [k, { all: r.length, zero: r.filter(c => c.sentence === 0).length }])),
  total: kept.length, zeroShare: Math.round(kept.filter(c => c.sentence === 0).length / kept.length * 1000) / 10,
  answerPositions: pos(kept),
  sentencesPerPassage: pos(kept.map(c => ({ sentence: c.sentences.length }))),
  bySource: Object.fromEntries([...new Set(kept.map(c => c.source))].map(s => [s, kept.filter(c => c.source === s).length])),
  dropped, struckInReview: struckInReview(), heldOutSetSize: held.length
};
writeFileSync(join(OUT, 'counts.json'), JSON.stringify(counts, null, 1) + '\n');
console.log(JSON.stringify(counts, null, 1));
