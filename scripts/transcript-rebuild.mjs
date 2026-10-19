#!/usr/bin/env node
/* transcript-rebuild.mjs — re-damage the corpus without asking the teacher again.
 *
 * The clean passages are already in the corpus: every row's TARGET is one. So
 * when the corruption recipe changes — and it did, once, for a reason worth
 * not repeating — the corpus can be rebuilt from its own targets in a second
 * instead of an hour, and the passages stay exactly the ones the split was
 * made on.
 *
 *   node scripts/transcript-rebuild.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { corrupt, mulberry, LEVELS } from './transcript-corrupt.mjs';
import { mechanicalClean } from '../src/captions.js';

const DIR = process.argv[2] || 'model/transcript-data';
const rng = mulberry(11);
const levels = Object.keys(LEVELS);

const readJsonl = (f) => readFileSync(join(DIR, f), 'utf8').split('\n').filter(Boolean).map(JSON.parse);
const INSTRUCTION = readFileSync(join(DIR, 'INSTRUCTION.txt'), 'utf8').trim();

/* The old targets carry the fillers of the OLD recipe, which is to say none.
   Stripping to written prose is therefore a no-op today, and is not attempted:
   guessing which words were fillers is exactly the deletion this whole change
   exists to stop doing. */
const cleanOf = (row) => row.messages[row.messages.length - 1].content;

const trainClean = [...readJsonl('train.jsonl'), ...readJsonl('valid.jsonl')].map(cleanOf);
const heldClean = [...new Set(JSON.parse(readFileSync(join(DIR, 'holdout.json'), 'utf8')).map(r => r.target))];

const rowOf = (clean, level) => {
  const c = corrupt(clean, { rng, level });
  return { input: mechanicalClean(c.text).text, target: c.truth, level, applied: c.applied };
};

const trainRows = trainClean.map(c => rowOf(c, levels[Math.floor(rng() * levels.length)]));
const heldRows = heldClean.flatMap(c => levels.map(l => rowOf(c, l)));

const jsonl = (rows) => rows.map(r => JSON.stringify({
  messages: [
    { role: 'system', content: INSTRUCTION },
    { role: 'user', content: r.input },
    { role: 'assistant', content: r.target }
  ]
})).join('\n') + '\n';

/* CHECK FIRST, WRITE SECOND. This used to write the three files and then
   validate, so a failed run left a half-changed corpus on disk — and because
   each run adds fillers to the targets it reads, four failed runs stacked four
   layers of fillers and grew the holdout from 120 rows to 3,240. Restored from
   git. A rebuild is only safe if it is all-or-nothing and idempotent, and the
   only way to be sure of the second is to run it on the committed corpus. */
const letters = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, '');
const drift = [...trainRows, ...heldRows]
  .filter(r => !r.applied.mangled && letters(r.input) !== letters(r.target));
if (drift.length) {
  console.error(`${drift.length} rows change letters with no name mangled — the recipe is editing words.`);
  console.error('Nothing was written. Fix the recipe, then run this again on a clean checkout of the corpus.');
  process.exit(1);
}
if (heldRows.length !== heldClean.length * levels.length) {
  console.error(`holdout came out ${heldRows.length} rows from ${heldClean.length} passages — expected ${heldClean.length * levels.length}.`);
  console.error('That means the corpus on disk was already rebuilt. Restore it with git first.');
  process.exit(1);
}

const nValid = Math.min(20, Math.max(1, Math.floor(trainRows.length * 0.1)));
writeFileSync(join(DIR, 'train.jsonl'), jsonl(trainRows.slice(0, -nValid)));
writeFileSync(join(DIR, 'valid.jsonl'), jsonl(trainRows.slice(-nValid)));
writeFileSync(join(DIR, 'holdout.json'), JSON.stringify(heldRows, null, 2));

const card = readFileSync(join(DIR, 'DATASET.txt'), 'utf8')
  .replace(/^\d+ train.*$/m, `${trainRows.length - nValid} train / ${nValid} valid / ${heldRows.length} holdout (${heldClean.length} passages x ${levels.length} levels)`);
writeFileSync(join(DIR, 'DATASET.txt'),
  card.trimEnd() + `\nrebuilt ${new Date().toISOString().slice(0, 10)}: fillers now appear in the TARGET too, so the model repunctuates and never deletes\n`);

console.log(`rebuilt ${DIR}`);
console.log(`  train ${trainRows.length - nValid}   valid ${nValid}   holdout ${heldRows.length}`);
console.log(`  letters preserved on every row without a mangled name: yes`);
