#!/usr/bin/env node
/* benchdiff.mjs — are two planner-bench runs the same run, row for row?
 *
 * A tally can hold still while turns trade places underneath it: one question
 * moves from answered to asked and another the other way, and 292 stays 292.
 * So two runs are compared case by case — the message, what it wanted, the
 * outcome, and the skill picked — and latency is ignored, because it is the one
 * field that differs between two identical runs.
 *
 * Usage: node scripts/benchdiff.mjs a.json b.json [--config llm+ex]
 * Exits 1 when any row or any tally differs, 2 when the records cannot be
 * compared at all.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const ROW_FIELDS = ['message', 'want', 'outcome', 'got'];

export const unwrap = (doc) => (doc && doc.record && doc.record.configs ? doc.record : doc);

/**
 * Compare two `plannerbench --record` documents for one configuration.
 * Returns `{ comparable, reason?, rows: [{index, a, b}], tallies: [{key, a, b}] }`.
 */
export function diffRecords (a, b, config = 'llm+ex') {
  /* benchqueue wraps a run as {job, host, head, …, record}; a bare
     plannerbench --record is the record itself. */
  a = unwrap(a);
  b = unwrap(b);
  const ca = a?.configs?.[config];
  const cb = b?.configs?.[config];
  if (!ca || !cb) return { comparable: false, reason: `both records need the "${config}" configuration`, rows: [], tallies: [] };
  if (a.holdout !== b.holdout || a.noSkill !== b.noSkill) {
    return { comparable: false, reason: `different question sets: ${a.holdout}+${a.noSkill} against ${b.holdout}+${b.noSkill}`, rows: [], tallies: [] };
  }
  const ra = ca.outcomes || [];
  const rb = cb.outcomes || [];
  if (!ra.length || ra.length !== rb.length) {
    return { comparable: false, reason: `per-row outcomes missing or of different length (${ra.length} against ${rb.length})`, rows: [], tallies: [] };
  }
  for (let i = 0; i < ra.length; i++) {
    if (ra[i].message !== rb[i].message || ra[i].want !== rb[i].want) {
      return { comparable: false, reason: `row ${i} asks a different question — the runs are not in the same order`, rows: [], tallies: [] };
    }
  }
  const rows = [];
  for (let i = 0; i < ra.length; i++) {
    if (ROW_FIELDS.some(f => (ra[i][f] ?? null) !== (rb[i][f] ?? null))) rows.push({ index: i, a: ra[i], b: rb[i] });
  }
  const keys = [...new Set([...Object.keys(ca.tally || {}), ...Object.keys(cb.tally || {})])];
  const tallies = keys
    .filter(k => (ca.tally?.[k] ?? 0) !== (cb.tally?.[k] ?? 0))
    .map(k => ({ key: k, a: ca.tally?.[k] ?? 0, b: cb.tally?.[k] ?? 0 }));
  return { comparable: true, rows, tallies };
}

async function main () {
  const argv = process.argv.slice(2);
  const i = argv.indexOf('--config');
  const config = i >= 0 ? argv[i + 1] : 'llm+ex';
  const files = argv.filter((x, j) => !x.startsWith('--') && (i < 0 || j !== i + 1));
  if (files.length !== 2) {
    console.error('usage: node scripts/benchdiff.mjs a.json b.json [--config llm+ex]');
    process.exit(2);
  }
  const [a, b] = await Promise.all(files.map(async f => unwrap(JSON.parse(await readFile(f, 'utf8')))));
  const d = diffRecords(a, b, config);
  if (!d.comparable) {
    console.error(`\n  not comparable: ${d.reason}\n`);
    process.exit(2);
  }
  const n = a.configs[config].outcomes.length;
  console.log(`\n  ${files[0]}  (${a.head ?? '?'}${a.pigeon ? ` · pigeon ${a.pigeon.keyId}` : ''})`);
  console.log(`  ${files[1]}  (${b.head ?? '?'}${b.pigeon ? ` · pigeon ${b.pigeon.keyId}` : ''})`);
  console.log(`  ${config}: ${n} rows, ${d.rows.length} differ\n`);
  for (const r of d.rows) {
    console.log(`  #${String(r.index).padStart(3)}  "${r.a.message.slice(0, 50)}"  want ${r.a.want}`);
    console.log(`        ${String(r.a.outcome).padEnd(16)} ${r.a.got ?? '—'}`);
    console.log(`     →  ${String(r.b.outcome).padEnd(16)} ${r.b.got ?? '—'}`);
  }
  for (const t of d.tallies) console.log(`  tally ${t.key}: ${t.a} → ${t.b}`);
  if (d.rows.length || d.tallies.length) process.exit(1);
  console.log('  identical.\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
