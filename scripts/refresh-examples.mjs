#!/usr/bin/env node
/* refresh-examples.mjs — rewrite a skill's stated example outputs from what it
 * actually returns.
 *
 * ⚠ READ THIS BEFORE USING IT.
 *
 * The examples are the test suite. A tool that rewrites them can turn a real
 * regression into a green run, which is the single worst thing that could
 * happen to this repo. It exists because most mismatches in practice are a
 * hand-counted number in an example being wrong — a character count, an
 * alphabetical tie-break, a syllable heuristic — not the code.
 *
 * The rule: LOOK AT THE DIFF FIRST and satisfy yourself the implementation is
 * right. If you cannot explain why the new value is correct, fix the code
 * instead. This script deliberately requires files to be named one by one and
 * refuses to operate on the whole folder.
 *
 *   node scripts/refresh-examples.mjs skills/foo.js skills/bar.js
 *   node scripts/refresh-examples.mjs --dry skills/foo.js     # show, don't write
 */

import { readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const files = args.filter(a => !a.startsWith('--'));

if (!files.length) {
  console.error('\n  Name the skill files explicitly. This tool does not take a glob.\n');
  process.exit(1);
}
if (files.some(f => !f.startsWith('skills/'))) {
  console.error('\n  Only files under skills/ can be refreshed.\n');
  process.exit(1);
}

/* Re-render a value in the same JS-literal style the skill files use, so the
   replacement matches the source text exactly.
 *
 * Written as a walk rather than a regex over JSON.stringify output. The regex
 * version rewrote EVERY comma, including the ones inside string values, so
 * 'rgb(76, 163, 204)' came back as 'rgb(76,  163,  204)' and no literal could
 * ever be located — the tool then reported "0 refreshed" while the examples
 * were still wrong. */
function lit (v) {
  if (typeof v === 'string') return `'${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(lit).join(', ')}]`;
  const entries = Object.entries(v).map(([k, x]) => `${/^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k)}: ${lit(x)}`);
  return entries.length ? `{ ${entries.join(', ')} }` : '{}';
}

const CTX = { now: '2026-09-01T09:00:00Z', timezone: 'UTC', locale: 'en-GB', units: 'metric', webEnabled: false };

let total = 0;
let unlocatable = 0;
for (const file of files) {
  const mod = (await import(`../${file}`)).default;
  let src = readFileSync(file, 'utf8');
  let changed = 0;

  for (const ex of mod.examples ?? []) {
    const input = { ...ex.input };
    for (const [k, d] of Object.entries(mod.inputSchema.properties ?? {})) {
      if (input[k] === undefined && d.default !== undefined) input[k] = d.default;
    }
    const env = mod.run(input, { ...CTX, ...(ex.ctx ?? {}) });
    if (!env?.ok) { console.log(`  ! ${mod.name} "${ex.text.slice(0, 40)}" → ${env?.error?.message}`); continue; }
    if (JSON.stringify(env.value) === JSON.stringify(ex.output)) continue;

    const before = lit(ex.output);
    const after = lit(env.value);
    if (!src.includes(before)) {
      /* The re-rendered literal has to match the source text exactly, and it
         will not for nested arrays or unusual spacing. Count these and exit
         non-zero: a silent "0 refreshed" while examples are still wrong is the
         one way this tool could mislead. */
      unlocatable += 1;
      console.log(`  ! COULD NOT LOCATE the literal for "${ex.text.slice(0, 44)}" — edit it by hand`);
      console.log(`    looking for ${before}`);
      continue;
    }
    console.log(`  ${mod.name} "${ex.text.slice(0, 44)}"`);
    console.log(`    was ${before}`);
    console.log(`    now ${after}`);
    src = src.replace(before, after);
    changed++;
  }
  if (changed && !dry) writeFileSync(file, src);
  total += changed;
}
console.log(`\n  ${total} example${total === 1 ? '' : 's'} ${dry ? 'would change' : 'refreshed'}`);
if (unlocatable) {
  console.log(`  ${unlocatable} could NOT be located and are still wrong — fix them by hand\n`);
  process.exit(1);
}
console.log('');
