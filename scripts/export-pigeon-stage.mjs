#!/usr/bin/env node
/* export-pigeon-stage.mjs — today's Patch, as the folder a skill pack is packed from.
 *
 * Patch is his skills' JavaScript, a handful of numbers that were measured
 * rather than chosen, and `needs`: the ids of the Pigeons that carry his router,
 * his planner's prompts and the app's other asks, which travel beside him in
 * his nest (pack-patch.mjs). This writes all of it into one folder, laid out
 * exactly as it will sit inside `patch.pigeon`, so Flight School's packer only
 * has to zip it and seal it — it never needs to know what a planner prompt is.
 *
 * Up to version 5 the prompts were written here as data; from version 6 they
 * are the Pigeons' own, and `patchData` still returns them so the tests can
 * hold the app's constants to what those Pigeons were packed from.
 *
 * Usage: node scripts/export-pigeon-stage.mjs --out <empty dir> [--allow-dirty]
 * --allow-dirty is for tests only: a stage records the commit it came from, and
 * a dirty tree would make that record a lie.
 */

import { readFile, writeFile, mkdir, readdir, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

import { importsIn } from '../src/lint-imports.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY = 'skills/index.js';
/* Patch's version. The app loads the higher of the bundled and an imported pack,
   so this goes up whenever what he packs changes. 2: 2026-09-16, the engine
   passes E1–E9 (titles, labels, carry marks) and the turn/router tunables. 3: 2026-09-16, a label on every field a
   person can give and titles where the code name read badly. 4: 2026-09-16,
   eleven skill bugs the label review found (money words, currency codes, dates,
   palindromes, fences, random ranges). 5: 2026-09-16, four labels reworded
   at the user's call (rate per 1 unit, character or code, weights, repeatable seed).
   6: 2026-10-06, his models leave the pack (D84): the router, the planner's
   asks, the tidier, Pen and Peek are Pigeons beside him in his nest, named in
   `needs`, and the pack carries no adapter, model pins or prompts.
   7: 2026-10-10, one trained planner (patch-planner-trained, Qwen3-VL 2B)
   replaces the four prompted ones: 286 of 308 and 5 of 100 leaks against
   their 289 and 18 on the app-shape bench under D92.
   8: 2026-10-12, the trained planner's round 3 (289 of 308, 4 of 100 leaks on
   today's code under D92), its plan capped at 8 steps (`maxItems` on steps).
   9: 2026-10-13, the asks check trained on Qwen3-VL 2B (patch-asks) in place of
   the prompted Qwen3.5 one: alone 302 of 308 let through and 98 of 100
   stopped (prompted: 305 and 62); the planner bench 290 of 308 and 1 of 100
   leaks (v8: 293 and 4). `needs` unchanged.
   10: 2026-10-14, every Pigeon in his nest on Qwen3-VL 2B, so the app needs
   one model: the asks check's second pass (alone 305 of 308 let through, 95 of
   100 stopped), the focus pass trained (161 of 166 against the prompted 160),
   the OCR clean-up trained (111 / 111 / 104 exact of 120 at light, medium and
   heavy damage against 84 / 65 / 54), and the decline second look retired, so
   `needs` is 10. The planner bench 293 of 308 and 2 of 100 leaks (v9: 290 and 1). */
export const PATCH_VERSION = 10;
/* Every Pigeon the app asks on Patch's behalf, by id (D84). The pack is not
   run while one is missing from his nest. `patch-second-look` left with the
   retirement of the decline second look (2026-10-13, v10). */
export const PATCH_NEEDS = [
  'patch-router',
  'patch-planner-trained',
  'patch-asks', 'patch-focus',
  'tidier', 'ocr-tidy',
  'pen', 'pen-no-figures', 'peek', 'peek-words'
];
/* `import './x.js'` has no `from`, so importsIn does not see it. */
const SIDE_EFFECT = /(?:^|[\s;}])import\s*['"]([^'"]+)['"]/g;

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const json = (value) => JSON.stringify(value, null, 2) + '\n';

/** Every module `entry` reaches, as repo-relative paths, sorted. */
export async function importClosure (root = ROOT, entry = ENTRY) {
  const seen = new Set();
  const queue = [entry];
  while (queue.length) {
    const rel = queue.shift();
    if (seen.has(rel)) continue;
    const source = await readFile(join(root, rel), 'utf8');
    seen.add(rel);
    const specs = [...importsIn(source), ...[...source.matchAll(SIDE_EFFECT)].map(m => m[1])];
    for (const spec of specs) {
      if (!spec.startsWith('./') && !spec.startsWith('../')) {
        throw new Error(`${rel} imports "${spec}" — a skill pack can only carry files it brings with it`);
      }
      const next = posix.normalize(posix.join(posix.dirname(rel), spec));
      if (next.startsWith('../')) throw new Error(`${rel} imports "${spec}", which is outside the repo`);
      queue.push(next);
    }
  }
  return [...seen].sort();
}

/** Patch's prompts and tunables, from the constants the app runs on today. */
export async function patchData () {
  const [planner, category, verify, focus, router, reg, skills, turn] = await Promise.all([
    import('../src/planner.js'), import('../src/category-router.js'), import('../src/verify.js'),
    import('../src/focus.js'), import('../src/router.js'), import('../src/registry.js'), import('../skills/index.js'), import('../src/turn.js')
  ]);
  const registry = reg.buildRegistry(skills.default);
  const categories = [...new Set(registry.routable().map(s => s.category))].sort();
  const prompts = {
    planner: { system: planner.SYSTEM, shots: planner.SHOTS, runway_rule: planner.RUNWAY_RULE },
    category: {
      trained_system: category.trainedSystemFor(categories),
      prompted_system_template: category.CATEGORY_SYSTEM('{menu}'),
      shots: category.CATEGORY_SHOTS
    },
    decline: { system: verify.DECLINE_SYSTEM, shots: verify.DECLINE_SHOTS },
    asks: { system: verify.ASKS_SYSTEM, user_turn_template: verify.ASKS_USER_TURN_TEMPLATE, shots: verify.ASKS_SHOTS },
    sibling: { system: verify.SIBLING_SYSTEM, system_trained: verify.SIBLING_SYSTEM_TRAINED, shots: verify.SIBLING_SHOTS },
    focus: { system: focus.FOCUS_SYSTEM, shots: focus.FOCUS_SHOTS }
  };
  for (const [role, p] of Object.entries(prompts)) {
    for (const [k, v] of Object.entries(p)) {
      if (v === undefined) throw new Error(`prompts/${role}.json: "${k}" is not exported by the app — nothing to pack`);
    }
  }
  const tunables = {
    category: { min_confidence: category.CATEGORY_CONFIDENCE, fallback_floor: category.FALLBACK_FLOOR, max_candidates: 20 },
    router: { threshold: 0.375, margin_floor: 0.12, k: router.ROUTER_K, number_weight: router.NUMBER_WEIGHT },
    /* How a turn behaves once routed. fallback_on_empty: when the planner writes
       no plan, run the router's first actionable skill anyway. Off: measured at
       78c1d69 it answers 14 more of the holdout and leaks 5 more no-skill
       messages ("my morse code is rusty" → morseEncode). */
    turn: { fallback_on_empty: turn.FALLBACK_ON_EMPTY },
    planner: { max_tokens: 200, runway: 'auto' }
  };
  return { prompts, tunables, categories };
}

function gitState (root) {
  const run = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  return { head: run('rev-parse', 'HEAD'), clean: run('status', '--porcelain', '--', 'skills', 'src', 'model', 'src-tauri/models.json') === '' };
}

/** Write the stage. Returns what was written. */
export async function stagePatch ({ root = ROOT, out, allowDirty = false } = {}) {
  if (!out) throw new Error('--out <dir> is required');
  if (existsSync(out) && (await readdir(out)).length) throw new Error(`${out} is not empty`);
  const git = gitState(root);
  if (!git.clean && !allowDirty) throw new Error('skills/, src/ or model/ has uncommitted changes — commit first, so the stage records a real commit');

  const files = {};
  const put = async (name, bytes) => {
    const dest = join(out, name);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, bytes);
    files[name] = sha256(bytes);
  };

  const closure = await importClosure(root);
  for (const rel of closure) {
    const dest = join(out, 'code', rel);
    await mkdir(dirname(dest), { recursive: true });
    await copyFile(join(root, rel), dest);
    files[`code/${rel}`] = sha256(await readFile(dest));
  }
  const { tunables, categories } = await patchData();
  await put('tunables.json', json(tunables));
  /* his face: the app's own icon, so his file looks like him wherever it is shown */
  await put('icon.png', await readFile(join(root, 'assets/app-icon.png')));

  const manifest = {
    format_version: 1,
    name: 'Patch',
    id: 'patch',
    kind: 'skillpack',
    version: PATCH_VERSION,
    signature: '',
    needs: PATCH_NEEDS,
    code: { entry: `code/${ENTRY}`, module: 'esm', files: closure.length },
    tunables: 'tunables.json',
    categories,
    source: { repo: 'Airoplane_Mode_Pigeon', head: git.head, clean: git.clean }
  };
  await put('pigeon.json', json(manifest));
  await writeFile(join(out, 'stage.json'), json({ head: git.head, clean: git.clean, files }));
  return { out, head: git.head, clean: git.clean, codeFiles: closure.length, entries: Object.keys(files).length };
}

async function main () {
  const argv = process.argv.slice(2);
  const i = argv.indexOf('--out');
  try {
    const r = await stagePatch({ out: i >= 0 ? resolve(argv[i + 1]) : null, allowDirty: argv.includes('--allow-dirty') });
    console.log(`\n  staged Patch at ${r.out}`);
    console.log(`  ${r.codeFiles} code files · ${r.entries} entries · ${r.head.slice(0, 7)}${r.clean ? '' : ' (DIRTY — not for packing)'}\n`);
  } catch (e) {
    console.error(`\n  ${e.message}\n`);
    process.exit(1);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
