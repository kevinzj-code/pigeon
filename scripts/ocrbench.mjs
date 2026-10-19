#!/usr/bin/env node
/* ocrbench.mjs — Patch's OCR clean-up alone, as the app asks it.
 *
 *   node scripts/ocrbench.mjs --engine http://127.0.0.1:8150 [--set bench/ocr-rows/heldout-clean.json] [--record out.json]
 *
 * The app's own `cleanupOcr` (src/ocr.js): the request names the `ocr-tidy`
 * Pigeon, and `auditCleanup` decides whether the repair is used or the raw
 * reading stands. Each held-out clean text is damaged at three levels by
 * scripts/ocr-corrupt.mjs (seeded per text), and every third is also given
 * undamaged, which the repair should hand back unchanged.
 *
 *   exact          the text the app would use equals the clean text (higher is better)
 *   used           repairs the audit accepted
 *   word errors    words wrong against the clean text, before and after (lower is better)
 *   words changed  words in an accepted repair that are in neither the reading
 *                  nor the clean text: changes nobody asked for (lower is better)
 *   numbers        repairs refused for introducing a number (lower is better)
 *   no-op kept     undamaged texts handed back unchanged
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { relative } from 'node:path';
import { createHash } from 'node:crypto';
import { cleanupOcr } from '../src/ocr.js';
import { corrupt, mulberry } from './ocr-corrupt.mjs';
import { pigeonServer } from './lib/pigeon-serve.mjs';

const argv = process.argv.slice(2);
const opt = (n, d = null) => { const i = argv.indexOf(n); return i > -1 && argv[i + 1] ? argv[i + 1] : d; };
const ENGINE = opt('--engine');
if (!ENGINE) { console.error('--engine <pigeon-serve url> is required'); process.exit(2); }
const SET = opt('--set', new URL('../bench/ocr-rows/heldout-clean.json', import.meta.url).pathname);
const texts = JSON.parse(readFileSync(SET, 'utf8')).texts;

const seed = (s) => parseInt(createHash('sha256').update(s).digest('hex').slice(0, 8), 16);
const cases = [];
for (const [i, t] of texts.entries()) {
  for (const level of ['light', 'medium', 'heavy']) {
    const r = corrupt(t.text, { rng: mulberry(seed(`${level}:${t.text}`)), level });
    cases.push({ i, kind: t.kind, level, raw: r.text, truth: r.truth });
  }
  if (i % 3 === 0) { const r = corrupt(t.text, { level: { wrap: 0, punctSpace: 0, runTogether: 0, splitWord: 0, letter: 0 } }); cases.push({ i, kind: t.kind, level: 'none', raw: r.truth, truth: r.truth }); }
}

const served = pigeonServer({ base: ENGINE });
if (!(await served.health())) { console.error(`no pigeon-serve on ${ENGINE}`); process.exit(1); }

const norm = (s) => String(s ?? '').replace(/[^\S\n]+/g, ' ').replace(/ *\n */g, '\n').trim();
const toks = (s) => norm(s).split(/\s+/).filter(Boolean);
function wordErrors (a, b) {
  /* Word-level edit distance: substitutions, insertions, deletions. */
  const x = toks(a), y = toks(b);
  let prev = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    const cur = [i];
    for (let j = 1; j <= y.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[y.length];
}

const rows = [];
for (const c of cases) {
  const out = await cleanupOcr({ raw: c.raw, complete: served });
  const used = out.used === 'cleaned' ? out.cleaned : c.raw;
  const allowed = new Set([...toks(c.raw), ...toks(c.truth)].map(w => w.toLowerCase()));
  const changed = out.used === 'cleaned' ? toks(out.cleaned).filter(w => !allowed.has(w.toLowerCase())) : [];
  rows.push({ ...c, used: out.used, reason: out.reason, cleaned: out.cleaned,
    exact: norm(used) === norm(c.truth), before: wordErrors(c.raw, c.truth), after: wordErrors(used, c.truth), changed });
}

const sum = (xs, f) => xs.reduce((a, r) => a + f(r), 0);
const byLevel = {};
for (const lv of ['light', 'medium', 'heavy', 'none']) {
  const rs = rows.filter(r => r.level === lv);
  byLevel[lv] = { cases: rs.length, exact: rs.filter(r => r.exact).length, used: rs.filter(r => r.used === 'cleaned').length,
    wordErrorsBefore: sum(rs, r => r.before), wordErrorsAfter: sum(rs, r => r.after), wordsChanged: sum(rs, r => r.changed.length) };
}
const reasons = {};
for (const r of rows) if (r.reason) { const k = r.reason.replace(/\d[\d.,]*/g, 'N'); reasons[k] = (reasons[k] || 0) + 1; }
const out = { date: new Date().toISOString(), engine: ENGINE, set: relative(new URL('..', import.meta.url).pathname, SET), cases: rows.length, byLevel, refused: reasons,
  numbersIntroduced: rows.filter(r => /^introduced/.test(r.reason || '')).length, rows };
console.log('\n  level    cases  exact  used  word errors before → after  words changed');
for (const [lv, v] of Object.entries(byLevel)) console.log(`  ${lv.padEnd(7)} ${String(v.cases).padStart(5)}  ${String(v.exact).padStart(5)}  ${String(v.used).padStart(4)}  ${String(v.wordErrorsBefore).padStart(11)} → ${String(v.wordErrorsAfter).padEnd(5)}  ${String(v.wordsChanged).padStart(13)}`);
console.log(`  refused by the audit: ${JSON.stringify(reasons)}`);
console.log(`  repairs refused for introducing a number: ${out.numbersIntroduced}\n`);
const REC = opt('--record');
if (REC) writeFileSync(REC, JSON.stringify(out, null, 1) + '\n');
