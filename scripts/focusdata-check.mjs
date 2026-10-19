#!/usr/bin/env node
/* focusdata-check.mjs <file> — checks focus-pass labels and authored passages.
 *
 *   node scripts/focusdata-check.mjs bench/focus-rows/constitution-labels.json
 *   node scripts/focusdata-check.mjs bench/focus-rows/heldout-authored.json
 *
 * A label is the number of the sentence that answers the question, in
 * `splitSentences`' split (src/focus.js), with `quote`: the answering words,
 * copied exactly. The check: the quote is inside that sentence and inside no
 * other. 0 means no sentence answers; its quote is null.
 *
 * constitution-labels.json: { "labels": [ { "id": "c001", "sentence": 2, "quote": "…" } ] }
 *   (questions and sentences from constitution-items.json)
 * *-authored.json: { "cases": [ { "question": "…", "passage": "…", "sentence": 3, "quote": "…" } ] }
 */
import { readFileSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { splitSentences } from '../src/focus.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const file = process.argv[2];
if (!file) { console.error('usage: node scripts/focusdata-check.mjs <file>'); process.exit(2); }
const doc = JSON.parse(readFileSync(file, 'utf8'));
const errors = [];
const flat = (s) => String(s).toLowerCase().replace(/\s+/g, ' ').trim();

function checkOne (at, sentences, label, quote) {
  if (!Number.isInteger(label) || label < 0 || label > sentences.length) { errors.push(`${at}: sentence ${label} is not 0..${sentences.length}`); return; }
  if (label === 0) { if (quote) errors.push(`${at}: a 0 label carries no quote`); return; }
  if (typeof quote !== 'string' || quote.trim().length < 3) { errors.push(`${at}: needs the answering words as "quote"`); return; }
  const q = flat(quote);
  const hits = sentences.map((s, i) => (flat(s).includes(q) ? i + 1 : 0)).filter(Boolean);
  if (!hits.includes(label)) errors.push(`${at}: the quote is not in sentence ${label}`);
  else if (hits.length > 1) errors.push(`${at}: the quote is in sentences ${hits.join(', ')}; quote more of it`);
}

let n = 0, zeros = 0;
const positions = {};
if (Array.isArray(doc.labels)) {
  const items = new Map(JSON.parse(readFileSync(join(ROOT, 'bench/focus-rows/constitution-items.json'), 'utf8')).map(i => [i.id, i]));
  const seen = new Set();
  for (const l of doc.labels) {
    const it = items.get(l.id);
    if (!it) { errors.push(`${l.id}: no such item`); continue; }
    seen.add(l.id);
    checkOne(l.id, it.sentences, l.sentence, l.quote);
    n++; if (l.sentence === 0) zeros++;
  }
  for (const id of items.keys()) if (!seen.has(id)) errors.push(`${id}: not labelled`);
} else if (Array.isArray(doc.cases)) {
  /* Training files (bench/focus-rows/authored/) carry the runway and must stay
     clear of the held-out set: a question within the round-3 Jaccard rule of a
     held-out question, or a passage opening on a held-out passage's first
     sentence, is refused. */
  const training = /\/authored\//.test(file);
  const held = training ? JSON.parse(readFileSync(join(ROOT, 'bench/focus-heldout.json'), 'utf8')).cases : [];
  const STOP = new Set('a an the of to in on for and or is was what who when where how which did does do it its by with at from as'.split(' '));
  const W = (t) => new Set(String(t).toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter(w => w && !STOP.has(w)));
  const J = (a, b) => { let n = 0; for (const w of a) if (b.has(w)) n++; return a.size && b.size ? n / (a.size + b.size - n) : 0; };
  const heldQ = held.map(h => W(h.question)), heldS = held.map(h => W(splitSentences(h.passage)[0] || ''));
  const seenQ = new Set();
  for (const [i, c] of doc.cases.entries()) {
    const at = `case ${i + 1}`;
    if (typeof c.question !== 'string' || typeof c.passage !== 'string') { errors.push(`${at}: needs question and passage`); continue; }
    const s = splitSentences(c.passage);
    if (s.length < 3 || s.length > 7) errors.push(`${at}: the passage splits into ${s.length} sentences (3 to 7)`);
    if (seenQ.has(flat(c.question))) errors.push(`${at}: duplicate question`);
    seenQ.add(flat(c.question));
    checkOne(at, s, c.sentence, c.quote);
    if (training) {
      const lf = typeof c.looking_for === 'string' ? c.looking_for.trim() : '';
      const words = lf.split(/\s+/).filter(Boolean).length;
      if (words < 2 || words > 12) errors.push(`${at}: looking_for must be 2 to 12 words`);
      const q = W(c.question), first = W(s[0] || '');
      if (heldQ.some(h => J(q, h) >= 0.6)) errors.push(`${at}: the question is within the hold-out rule`);
      if (heldS.some(h => J(first, h) >= 0.6)) errors.push(`${at}: the passage opens like a held-out passage`);
    }
    n++; if (c.sentence === 0) zeros++;
    positions[c.sentence] = (positions[c.sentence] || 0) + 1;
  }
} else errors.push('expected "labels" or "cases"');

for (const e of errors) console.log(`  ERROR  ${e}`);
console.log(`\n  ${basename(file)}: ${n} labelled, ${zeros} labelled 0${Object.keys(positions).length ? ` · answer positions ${JSON.stringify(positions)}` : ''} · ${errors.length} errors`);
process.exit(errors.length ? 1 : 0);
