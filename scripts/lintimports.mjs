#!/usr/bin/env node
/* lintimports.mjs — check the wall between the lanes, for a person.
 *
 * The same check `npm test` runs (see src/lint-imports.js for what the rules
 * are and why they are that strict). Exits non-zero when the wall is breached.
 *
 *   node scripts/lintimports.mjs
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { wallViolations, formatViolations } from '../src/lint-imports.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Every .js file under a directory, as { path, source } with repo-relative paths. */
export function readTree (dir, root = ROOT) {
  const out = [];
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const full = join(d, name);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (!name.endsWith('.js')) continue;
      out.push({ path: relative(root, full).split('\\').join('/'), source: readFileSync(full, 'utf8') });
    }
  };
  walk(dir);
  return out;
}

if (process.argv[1] && process.argv[1].endsWith('lintimports.mjs')) {
  const found = wallViolations(readTree(join(ROOT, 'src')));
  console.log(formatViolations(found));
  process.exit(found.length ? 1 : 0);
}
