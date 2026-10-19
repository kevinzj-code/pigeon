#!/usr/bin/env node
/* forbidden.mjs — the bench, as the list no training row may paraphrase.
 *
 * Flight School's category builder and bank linter take a `forbidden.json`:
 * every question the planner bench grades on, so that a paraphrase of one can
 * never be written into a category bank, a hard-negative list or a sibling
 * row. That file used to be produced by hand and it went stale the moment the
 * holdout grew — six new entries and two rewrites reached the bench without
 * reaching the gate, which is exactly the contamination the gate exists for.
 *
 * So the list is derived, here, from the two sources the bench itself imports.
 * Run it after any change to holdout.mjs or no-skill-set.mjs:
 *
 *   node scripts/forbidden.mjs --out <dir>/forbidden.json
 *
 * With no --out it prints the JSON. --check <path> compares an existing file
 * and lists what it is missing, which is the question to ask before trusting
 * any dataset built against it.
 *
 * THE OTHER DIRECTION MATTERS TOO. A new bench message can be a paraphrase of
 * a row the shipped adapter was already trained on — six of the second fifty
 * no-skill messages were, first time round ("write a limerick about my
 * dishwasher" against the bank's "…about my commute"). That grades the model
 * on its own homework. After regenerating this file, run Flight School's Gate
 * over its banks with the new list and rewrite any BENCH message that newly
 * blocks a bank row; the bank stays, the bench moves. */

import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { HOLDOUT } from './holdout.mjs';
import { NO_SKILL_MESSAGES } from './no-skill-set.mjs';

export const FORBIDDEN = [...HOLDOUT.map(([m]) => m), ...NO_SKILL_MESSAGES];

const argv = process.argv.slice(2);
const opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };

if (process.argv[1] && process.argv[1].endsWith('forbidden.mjs')) {
  const out = opt('--out'); const check = opt('--check');
  if (check) {
    const have = new Set(existsSync(check) ? JSON.parse(readFileSync(check, 'utf8')) : []);
    const missing = FORBIDDEN.filter(m => !have.has(m));
    const extra = [...have].filter(m => !FORBIDDEN.includes(m));
    console.log(`  ${check}: ${have.size} entries · bench has ${FORBIDDEN.length} · missing ${missing.length} · stale ${extra.length}`);
    for (const m of missing) console.log(`    missing  ${JSON.stringify(m)}`);
    for (const m of extra) console.log(`    stale    ${JSON.stringify(m)}`);
    process.exit(missing.length ? 1 : 0);
  }
  const json = JSON.stringify(FORBIDDEN, null, 1) + '\n';
  if (out) { writeFileSync(out, json); console.log(`  ${FORBIDDEN.length} bench messages written to ${out} (${HOLDOUT.length} holdout + ${NO_SKILL_MESSAGES.length} no-skill)`); }
  else process.stdout.write(json);
}
