#!/usr/bin/env node
/* transcriptbench.mjs — how well is the transcript repaired, as a number.
 *
 * Four measures, because one would hide the thing that matters:
 *
 *   boundaries F1   did the full stops land where they belong. The actual task.
 *   paragraphs F1   did the blank lines land where they belong.
 *   fabrication     words in the reply that are in NEITHER the input nor the
 *                   truth. Must be 0. This is the Pigeon measure: a repair
 *                   that invents a word is not a repair, and unlike the OCR
 *                   case it is detectable here, because a transcript's words
 *                   are mostly right to begin with.
 *   figures kept    every numeral in the input survives unchanged.
 *
 * Scored per damage level, because an average over light and heavy says
 * nothing about either.
 *
 *   node scripts/transcriptbench.mjs --base http://127.0.0.1:8101 --persona transcript-clean
 *
 * Through the engine, the way the app asks (the `tidier` Pigeon in Patch's
 * nest behind pigeon-serve), each row cut into pieces as captions-tidy.js
 * cuts a transcript and the pieces asked together, which is what the app
 * does since 2026-10-15; `--chunk` sets the piece size the app would use,
 * so a smaller one can be measured before it ships:
 *
 *   node scripts/transcriptbench.mjs --engine http://127.0.0.1:8150 [--chunk 3000] [--record out.json]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { auditRepair, changedWords } from '../src/captions.js';
import { chunk, repairBudget, CHUNK_CHARS } from '../src/captions-tidy.js';

const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
const BASE = arg('base', 'http://127.0.0.1:8101');
const ADAPTER = arg('adapter', null);
const DATA = arg('data', 'model/transcript-data');
const N = Number(arg('n', 0));
const ENGINE = arg('engine', null);
const CHUNK = Number(arg('chunk', CHUNK_CHARS));
const RECORD = arg('record', null);
/* --join N: every N consecutive rows of a level joined into one transcript
   (inputs and targets alike, a blank line between), so the cut into pieces
   is exercised the way a real transcript exercises it. The holdout's rows
   are single passages of 1,100 to 2,500 characters, which no piece size the
   app would use ever cuts. */
const JOIN = Number(arg('join', 1));

const holdout = JSON.parse(readFileSync(`${DATA}/holdout.json`, 'utf8'));
const INSTRUCTION = readFileSync(`${DATA}/INSTRUCTION.txt`, 'utf8').trim();

let loras = null;
async function adapters () {
  if (loras) return loras;
  const r = await fetch(`${BASE}/lora-adapters`);
  loras = r.ok ? await r.json() : [];
  return loras;
}
const stem = (p) => String(p || '').split('/').pop().replace(/\.lora\.gguf$/, '');

/* One piece through pigeon-serve: the tidier Pigeon, greedy by its file,
   the app's own budget for the piece. */
async function repairPiece (piece) {
  const res = await fetch(`${ENGINE}/ask`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: 'tidier', input: piece, max_tokens: repairBudget(piece) })
  });
  const j = await res.json();
  if (j.error) throw new Error(typeof j.error === 'string' ? j.error : JSON.stringify(j.error));
  return { text: String(j.text ?? '').trim(), truncated: j.stopped === 'max_tokens' };
}

async function repair (input) {
  if (ENGINE) {
    /* Cut as the app cuts, asked together as the app asks, joined in order. */
    const pieces = chunk(input, CHUNK);
    const outs = await Promise.all(pieces.map(repairPiece));
    return { text: outs.map(o => o.text).join('\n\n'), truncated: outs.some(o => o.truncated), pieces: pieces.length };
  }
  const all = await adapters();
  const res = await fetch(`${BASE}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'system', content: INSTRUCTION }, { role: 'user', content: input }],
      /* Greedy. This is a repair, not a voice: the same transcript must come
         back the same way twice, and sampling would make the score noise. */
      temperature: 0, seed: 11, top_p: 1,
      max_tokens: Math.min(2048, Math.ceil(input.length / 4 * 1.6) + 64),
      lora: all.map((a, i) => ({ id: typeof a.id === 'number' ? a.id : i,
                                 scale: ADAPTER && stem(a.path) === ADAPTER ? 1 : 0 }))
    })
  });
  const j = await res.json();
  if (j.error) throw new Error(j.error.message || 'refused');
  const c = (j.choices || [])[0] || {};
  return { text: String(c.message?.content ?? '').trim(), truncated: c.finish_reason === 'length' };
}

/* A boundary is identified by the WORD it follows, counted by position among
   the words, so a reply that keeps the words can be compared to the truth
   even when it puts the stops elsewhere. */
const words = (t) => String(t).toLowerCase().match(/[a-z0-9']+/g) || [];
function boundaryIndices (text) {
  const out = new Set();
  const toks = String(text).split(/\s+/).filter(Boolean);
  let w = -1;
  for (const tok of toks) {
    if (/[a-z0-9']/i.test(tok)) w++;
    if (/[.!?]["')\]]?$/.test(tok)) out.add(w);
  }
  return out;
}
function paragraphIndices (text) {
  const out = new Set();
  let w = -1;
  for (const para of String(text).split(/\n\s*\n/)) {
    const n = words(para).length;
    if (n === 0) continue;
    w += n;
    out.add(w);
  }
  out.delete(w);   // the end of the last paragraph is not a break
  return out;
}
function f1 (got, want) {
  if (!want.size && !got.size) return 1;
  const hit = [...got].filter(x => want.has(x)).length;
  const precision = got.size ? hit / got.size : 0;
  const recall = want.size ? hit / want.size : 0;
  return precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
}
const numerals = (t) => (String(t).match(/\d[\d.,]*\d|\d/g) || []).map(s => s.replace(/[.,]$/, ''));

function joined (rows, n) {
  if (n <= 1) return rows;
  const out = [];
  for (const level of [...new Set(rows.map(r => r.level))]) {
    const of = rows.filter(r => r.level === level);
    for (let i = 0; i + n <= of.length; i += n) {
      const group = of.slice(i, i + n);
      out.push({ level, input: group.map(r => r.input).join('\n\n'), target: group.map(r => r.target).join('\n\n') });
    }
  }
  return out;
}
const rows = joined(N ? holdout.filter((_, i) => i % Math.ceil(holdout.length / N) === 0) : holdout, JOIN);
const byLevel = {};
const escapes = [];

console.log(`\n  transcript repair — ${rows.length} of ${holdout.length} holdout rows`);
console.log(ENGINE ? `  the tidier Pigeon on ${ENGINE}, pieces of ${CHUNK} characters${JOIN > 1 ? `, ${JOIN} rows joined per transcript` : ''}\n` : `  model on ${BASE}${ADAPTER ? `, wearing ${ADAPTER}` : ', with no adapter'}\n`);

let failed = 0;
let piecesTotal = 0;
const t0 = Date.now();
for (const row of rows) {
  const L = (byLevel[row.level] ||= { n: 0, exact: 0, bF1: 0, pF1: 0, fabricated: 0, figuresLost: 0,
                                      truncated: 0, vetoed: 0, escaped: 0 });
  let out;
  try { out = await repair(row.input); }
  catch (e) { failed++; console.log(`  ERR ${e.message}`); continue; }
  piecesTotal += out.pieces || 1;

  L.n++;
  if (out.truncated) L.truncated++;
  if (out.text.trim() === row.target.trim()) L.exact++;
  L.bF1 += f1(boundaryIndices(out.text), boundaryIndices(row.target));
  L.pF1 += f1(paragraphIndices(out.text), paragraphIndices(row.target));

  /* The one that must be zero. A word is fabricated only if it is in neither
     what it was given nor what it should have said. */
  const allowed = new Set([...words(row.input), ...words(row.target)]);
  if (words(out.text).some(w => !allowed.has(w))) L.fabricated++;

  const before = numerals(row.input).join(' ');
  if (numerals(out.text).join(' ') !== before) L.figuresLost++;

  /* What the shipped guard would DO with this reply. The two measures are not
     the same question and both matter: `fabricated` is whether the model erred,
     `escaped` is whether a person would ever see it. A fabrication the audit
     rejects costs the person nothing but the deterministic text, which they
     were going to get anyway. One that passes is a bug in the guard. */
  const verdict = auditRepair(row.input, out.text, { truncated: out.truncated });
  const rejected = Boolean(verdict && verdict.reason);
  if (rejected) L.vetoed++;

  /* The measure that matters is not whether the model changed a word — a name
     the transcriber split cannot be repaired without changing one — but
     whether a change could happen WITHOUT the person being told. So: every
     word that actually moved, against every word the audit would have named. */
  const moved = changedWords(row.input, out.text);
  const disclosed = new Set((verdict && verdict.changed ? verdict.changed.added : []));
  const undisclosed = rejected ? [] : moved.added.filter(w => !disclosed.has(w));
  if (undisclosed.length) {
    L.escaped++;
    if (escapes.length < 6) escapes.push({ level: row.level, words: undisclosed.slice(0, 8) });
  }
  const fabricated = words(out.text).some(w => !allowed.has(w));
  if (fabricated && !rejected) L.changedSilently = (L.changedSilently || 0) + (undisclosed.length ? 1 : 0);
}

const pct = (x, n) => `${(100 * x / (n || 1)).toFixed(0)}%`;
console.log('  level     n   exact   boundaries   paragraphs   fabricated   audit vetoed   changed UNDISCLOSED');
let fabTotal = 0, nTotal = 0, vetoTotal = 0, escTotal = 0;
for (const level of ['light', 'medium', 'heavy']) {
  const L = byLevel[level];
  if (!L) continue;
  fabTotal += L.fabricated; nTotal += L.n; vetoTotal += L.vetoed; escTotal += L.escaped;
  console.log(`  ${level.padEnd(8)} ${String(L.n).padStart(2)}   ${pct(L.exact, L.n).padStart(5)}` +
    `   ${(L.bF1 / L.n).toFixed(3).padStart(10)}   ${(L.pF1 / L.n).toFixed(3).padStart(10)}` +
    `   ${String(L.fabricated).padStart(10)}   ${String(L.vetoed).padStart(12)}   ${String(L.escaped).padStart(18)}`);
}
console.log(`\n  the model fabricated a word in       ${fabTotal} of ${nTotal}`);
console.log(`  the audit threw the repair out in    ${vetoTotal} of ${nTotal}   (those fall back to the deterministic text)`);
console.log(`  a word changed WITHOUT saying so:    ${escTotal} of ${nTotal}   must be 0`);
for (const e of escapes) console.log(`    undisclosed (${e.level}): ${e.words.join(', ')}`);
if (failed) console.log(`  ${failed} rows failed outright`);
const wallMs = Date.now() - t0;
console.log(`  ${piecesTotal} pieces in ${(wallMs / 1000).toFixed(0)} s\n`);
if (RECORD) {
  writeFileSync(RECORD, JSON.stringify({
    date: new Date().toISOString(), engine: ENGINE, base: ENGINE ? null : BASE, chunk: ENGINE ? CHUNK : null, join: JOIN,
    rows: rows.length, pieces: piecesTotal, wallMs, failed, byLevel,
    totals: { fabricated: fabTotal, vetoed: vetoTotal, escaped: escTotal, n: nTotal }, escapes
  }, null, 2));
  console.log(`  run recorded to ${RECORD}\n`);
}
