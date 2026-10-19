#!/usr/bin/env node
/* ocrdata-check.mjs <file> — checks a batch of clean texts for the OCR clean-up's rows.
 *
 *   node scripts/ocrdata-check.mjs bench/ocr-rows/authored/o01.json
 *
 * { "batch": "o01", "texts": [ { "kind": "receipt", "text": "…" } ] }
 *
 * Each text must be clean, because it is the exact answer the model learns:
 * 2 to 12 lines, 15 to 120 words, no doubled spaces, no space before a comma or
 * full stop, no blank lines, no hard wrap inside a sentence (a line that ends
 * mid-sentence with the next starting in lower case), at least one number in
 * most texts (checked over the batch), and nothing within content-word Jaccard
 * 0.6 of a held-out clean text (bench/ocr-rows/heldout-clean.json) or of
 * another text in the batch.
 */
import { readFileSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const file = process.argv[2];
if (!file) { console.error('usage: node scripts/ocrdata-check.mjs <file>'); process.exit(2); }
const doc = JSON.parse(readFileSync(file, 'utf8'));
const held = JSON.parse(readFileSync(join(ROOT, 'bench/ocr-rows/heldout-clean.json'), 'utf8')).texts.map(t => t.text);
const KINDS = ['receipt', 'notice', 'letter', 'menu', 'timetable', 'recipe', 'label', 'flyer', 'form', 'page'];
const STOP = new Set('a an the of to in on for and or is are was be at by with from as it this that your our you we'.split(' '));
const W = (t) => new Set(String(t).toLowerCase().replace(/[^a-z0-9£$€]+/g, ' ').split(' ').filter(w => w && !STOP.has(w)));
const J = (a, b) => { let n = 0; for (const w of a) if (b.has(w)) n++; return a.size && b.size ? n / (a.size + b.size - n) : 0; };
const heldW = held.map(W);

const errors = [];
const seen = [];
const perKind = {};
let withNumber = 0;
for (const [i, t] of (doc.texts || []).entries()) {
  const at = `text ${i + 1}`;
  if (!t || typeof t.text !== 'string' || !t.text.trim()) { errors.push(`${at}: empty`); continue; }
  if (!KINDS.includes(t.kind)) errors.push(`${at}: kind "${t.kind}" is not one of ${KINDS.join(', ')}`);
  perKind[t.kind] = (perKind[t.kind] || 0) + 1;
  const lines = t.text.split('\n');
  const words = t.text.split(/\s+/).filter(Boolean).length;
  if (lines.length < 2 || lines.length > 12) errors.push(`${at}: ${lines.length} lines (2 to 12)`);
  if (words < 15 || words > 120) errors.push(`${at}: ${words} words (15 to 120)`);
  if (/ {2,}/.test(t.text)) errors.push(`${at}: doubled space`);
  if (/ [,.;:!?](\s|$)/.test(t.text)) errors.push(`${at}: a space before punctuation`);
  if (lines.some(l => !l.trim() || l !== l.trim())) errors.push(`${at}: a blank line or a line with spaces at either end`);
  for (let k = 0; k < lines.length - 1; k++) {
    if (/[a-z,]$/.test(lines[k]) && /^[a-z]/.test(lines[k + 1]) && lines[k].split(' ').length >= 5) { errors.push(`${at}: line ${k + 1} looks hard-wrapped mid-sentence`); break; }
  }
  if (/\d/.test(t.text)) withNumber++;
  const w = W(t.text);
  if (heldW.some(h => J(w, h) >= 0.6)) errors.push(`${at}: within reach of a held-out text`);
  if (seen.some(s => J(w, s) >= 0.6)) errors.push(`${at}: within reach of another text in this batch`);
  seen.push(w);
}
const n = (doc.texts || []).length;
if (n && withNumber / n < 0.7) errors.push(`only ${withNumber} of ${n} texts carry a number; most should`);
for (const e of errors) console.log(`  ERROR  ${e}`);
console.log(`\n  ${basename(file)}: ${n} texts · ${JSON.stringify(perKind)} · ${withNumber} with numbers · ${errors.length} errors`);
process.exit(errors.length ? 1 : 0);
