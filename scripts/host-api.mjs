/* host-api.mjs — the modules a sealed Patch and this app build must agree on.
 *
 * Patch's skills run in their worker from the pack's own copy of their code.
 * The windows run THIS build's copy of the few modules they share with that
 * code — contracts, the schema validator, dates, units — and hand values across
 * between the two. If the two copies differ, the extractor, validator and
 * planner here quietly disagree with the skills there. So a release carries
 * the hash of every shared module (`host-api.json`), and Rust refuses a pack
 * whose copies are not byte-identical: "made for a different Pigeon build".
 *
 * "Shared" is computed, never listed by hand: the files both in the import
 * closure of skills/index.js and in the import closure of the three windows.
 */

import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

import { importClosure } from './export-pigeon-stage.mjs';

/** The three pages a webview loads; everything the app runs is reached from them. */
export const WINDOWS = ['src/app.js', 'src/popover.js', 'src/bar.js', 'src/hud.js'];

/**
 * `{ map: { 'src/contracts.js': '<sha256>', … }, mainClosure: [...] }` for the
 * checkout at `root`. Keys are repo paths; Rust compares each with the pack's
 * `code/<key>`.
 */
export async function hostApiFor (root) {
  const pack = new Set(await importClosure(root, 'skills/index.js'));
  const main = new Set();
  for (const w of WINDOWS) for (const p of await importClosure(root, w)) main.add(p);
  const map = {};
  for (const p of [...main].filter(p => pack.has(p)).sort()) {
    map[p] = createHash('sha256').update(await readFile(join(root, p))).digest('hex');
  }
  return { map, mainClosure: [...main].sort() };
}
