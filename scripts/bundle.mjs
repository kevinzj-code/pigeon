#!/usr/bin/env node
/* bundle.mjs — assemble `dist/` for a Tauri RELEASE build.
 *
 * This is not a build step in the usual sense: nothing is compiled, bundled,
 * minified or transformed. It copies the four things the webview actually
 * loads into one folder, because `frontendDist` has to point at a directory
 * and pointing it at the repo root would ship node_modules and
 * src-tauri/target inside the .deb.
 *
 * `npm run dev` never calls this — dev serves the real files straight from the
 * working tree, so an edit to a skill is live on reload with no step in
 * between. That is the property worth protecting; this script exists only so
 * that `tauri build` has somewhere tidy to point. */

import { cp, rm, mkdir, readdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { hostApiFor } from './host-api.mjs';
import { readPack, readNest, releaseProblems, sameCodeAs, HOST_API_PATH } from './lib/release-check.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');

/* Everything the page reaches for, and nothing else. index.html pulls
   src/app.js, which pulls the rest of src/; styles/ holds the stylesheets,
   which pull fonts/. popover.html is the menu bar's window and pulls
   src/popover.js; bar.html is the summon bar's and pulls src/bar.js; hud.html is
   the play overlay's and pulls src/hud.js. If you
   add a top-level file or folder a webview loads, add it here — the check
   below will not catch it for you.

   NOT skills/: a release's Patch is the sealed pack (pack/patch.pigeon,
   bundled as a resource by tauri.release.conf.json), and his skills reach the
   locked worker only from it. A skills/ folder in the app would be a second,
   unsealed Patch. */
export const SHIP = ['index.html', 'popover.html', 'bar.html', 'hud.html', 'styles', 'src', 'fonts', 'assets'];

/* Before anything is copied: the pack must be this checkout, sealed. */
const { map: hostApi, mainClosure } = await hostApiFor(ROOT);
const pack = await readPack(ROOT);
const nest = await readNest(ROOT);
const problems = releaseProblems({ pack, sameCode: sameCodeAs(ROOT, pack?.head), hostApi, mainClosure, nest });
/* `npm run app` builds a DEBUG app to try things that need a real bundle
   (screen and key permissions). A debug build loads Patch from this checkout,
   not the sealed pack, so the pack being older is said, not refused. It is
   never a release: that goes through `npm run build`, which checks. */
const debugApp = process.env.PIGEON_DEBUG_APP === '1';
if (problems.length && !debugApp) {
  console.error(`\n  Not building a release:\n  ${problems.join('\n  ')}\n`);
  process.exit(1);
}
if (problems.length) console.error(`\n  Debug app — not a release, so these are only said:\n  ${problems.join('\n  ')}\n`);
await writeFile(join(ROOT, HOST_API_PATH), JSON.stringify(hostApi, null, 2) + '\n');

await rm(DIST, { recursive: true, force: true });
await mkdir(DIST, { recursive: true });

/* `src/` is copied file by file: what the three windows import, plus what
   they load by URL rather than by import. The rest of the folder — the word
   lists and tables only the sealed pack's skills use, the lint and audit
   tools — is not the app and does not ship. */
const LOADED_BY_URL = ['src/skill-worker.js'];
const keep = new Set([...mainClosure, ...LOADED_BY_URL]);
for (const entry of SHIP) {
  if (entry !== 'src') {
    await cp(join(ROOT, entry), join(DIST, entry), { recursive: true });
    continue;
  }
  for (const rel of [...keep].filter(p => p.startsWith('src/')).sort()) {
    await mkdir(dirname(join(DIST, rel)), { recursive: true });
    await cp(join(ROOT, rel), join(DIST, rel));
  }
}

const shipped = await readdir(DIST);
console.log(`  dist/ ← ${shipped.join(', ')}`);
console.log(`  Patch ← pack/patch.nest: v${pack.version} sealed by ${pack.keyId} (from ${String(pack.head).slice(0, 7)}) and ${nest.ids.length} Pigeons`);
