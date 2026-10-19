#!/usr/bin/env node
/* pack-patch.mjs — build `pack/patch.pigeon`, `pack/patch.nest` and `pack/host-api.json` from this checkout.
 *
 * The release's Patch, made the way every Patch is made: this checkout stages
 * his files (export-pigeon-stage.mjs), Flight School zips and seals them with
 * the signing key, and the result is read back with the app's own strict
 * reader and checked against this checkout before anything is left in pack/.
 *
 *   FLIGHT_SCHOOL_DIR  Flight School's checkout (default: a sibling folder
 *                      named "flight-school")
 *   PIGEON_SEAL_KEY    the signing key file (default: ~/.airoplane-mode/seal.key)
 *   PYTHON             the Python that runs Flight School's CLI (default: python3)
 *   PATCH_PIGEONS_DIR  the Pigeons Patch needs, as <id>.pigeon, each sealed by
 *                      a key this app trusts (default: ../patch-pigeons,
 *                      Flight School's sealed ones)
 *
 * The key never passes through this script — only its path, to Flight School.
 * Refuses a dirty skills/, src/ or model/ (the stage records a real commit).
 *
 * Usage: npm run pack:patch
 */

import { mkdtemp, rm, mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createHash } from 'node:crypto';
import { stagePatch, PATCH_NEEDS } from './export-pigeon-stage.mjs';
import { hostApiFor } from './host-api.mjs';
import { readPack, readNest, releaseProblems, sameCodeAs, PACK_PATH, HOST_API_PATH, NEST_PATH } from './lib/release-check.mjs';
import { storeZip, listEntries, get } from './lib/zip-store.mjs';
import { pigeonRules, loadTrustedKeys } from './lib/seal.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FLIGHT_SCHOOL = process.env.FLIGHT_SCHOOL_DIR || join(ROOT, '..', 'flight-school');
const KEY = process.env.PIGEON_SEAL_KEY || join(homedir(), '.airoplane-mode', 'seal.key');
const PYTHON = process.env.PYTHON || 'python3';
/* Where the Pigeons Patch needs are read from: Flight School's sealed ones. */
const PIGEONS = process.env.PATCH_PIGEONS_DIR || join(ROOT, '..', 'patch-pigeons');

/**
 * `pack/patch.nest`: the pack, then every Pigeon in PATCH_NEEDS, each
 * `<id>.pigeon` from `dir`, refused unless its own id says so and it is
 * sealed by a key this app trusts, and `nest.json` listing them (§14). Read
 * back with the strict reader.
 */
export async function buildNest (root, dir = PIGEONS, trustedKeys = loadTrustedKeys()) {
  const sha = (b) => createHash('sha256').update(b).digest('hex');
  const pack = await readFile(join(root, PACK_PATH));
  const files = [['patch.pigeon', pack]];
  const listed = [{ file: 'patch.pigeon', id: 'patch', name: 'Patch', kind: 'skillpack', bytes: pack.length, sha256: sha(pack) }];
  const have = new Set((await readdir(dir)).filter(f => f.endsWith('.pigeon')));
  for (const id of PATCH_NEEDS) {
    if (!have.has(`${id}.pigeon`)) throw new Error(`${dir} has no ${id}.pigeon, which Patch needs`);
    const bytes = await readFile(join(dir, `${id}.pigeon`));
    const entries = listEntries(bytes);
    const m = JSON.parse(get(entries, bytes, 'pigeon.json').toString('utf8'));
    if (m.id !== id) throw new Error(`${id}.pigeon says it is "${m.id}"`);
    /* Unsealed, or sealed by a key not on the list (which the seal check
       refuses outright): either way it does not go in. */
    let why = 'it carries no seal';
    try { if (pigeonRules(entries, bytes, trustedKeys).sealed) why = null; } catch (e) { why = e.message; }
    if (why) throw new Error(`${id}.pigeon is not sealed by a key this app trusts (${why})`);
    files.push([`${id}.pigeon`, bytes]);
    listed.push({ file: `${id}.pigeon`, id, name: m.name, kind: m.kind, base_file: m.base_model?.file ?? null, bytes: bytes.length, sha256: sha(bytes) });
  }
  const listing = { format_version: 1, name: 'Patch', created: new Date().toISOString().slice(0, 10), pigeons: listed };
  const nest = storeZip([...files, ['nest.json', JSON.stringify(listing, null, 2) + '\n']]);
  listEntries(nest);
  await writeFile(join(root, NEST_PATH), nest);
  return { members: listed.length, bytes: nest.length };
}

function packWithFlightSchool (stage, out) {
  const cli = join(FLIGHT_SCHOOL, 'src-tauri', 'python', 'pigeon', 'cli.py');
  let text;
  try {
    text = execFileSync(PYTHON, [cli, 'pack-skillpack', '--stage', stage, '--key', KEY, '--out', out], { encoding: 'utf8' });
  } catch (e) {
    text = String(e.stdout || '') || String(e.message);
  }
  const last = text.trim().split('\n').pop();
  let reply;
  try { reply = JSON.parse(last); } catch { throw new Error(`Flight School did not answer: ${last}`); }
  if (reply.error) throw new Error(`Flight School refused: ${reply.error}`);
  return reply;
}

async function main () {
  /* --nest-only: wrap the pack already in pack/ with the Pigeons it needs,
     for a dev build before the new pack is sealed. */
  if (process.argv.includes('--nest-only')) {
    const n = await buildNest(ROOT);
    console.log(`\n  ${NEST_PATH}  ${n.members} members · ${(n.bytes / 1e6).toFixed(1)} MB (from the pack already in pack/)\n`);
    return;
  }
  const work = await mkdtemp(join(tmpdir(), 'patch-pack-'));
  try {
    const stage = join(work, 'stage');
    const staged = await stagePatch({ root: ROOT, out: stage });
    await mkdir(join(ROOT, 'pack'), { recursive: true });
    packWithFlightSchool(stage, join(ROOT, PACK_PATH));

    const { map, mainClosure } = await hostApiFor(ROOT);
    await writeFile(join(ROOT, HOST_API_PATH), JSON.stringify(map, null, 2) + '\n');

    const built = await buildNest(ROOT);
    const pack = await readPack(ROOT);
    const problems = releaseProblems({ pack, sameCode: sameCodeAs(ROOT, pack?.head), hostApi: map, mainClosure, nest: await readNest(ROOT) });
    if (problems.length) throw new Error(problems.join('\n  '));
    console.log(`\n  ${PACK_PATH}  v${pack.version} · sealed by ${pack.keyId} · from ${staged.head.slice(0, 7)} · ${(pack.bytes / 1e6).toFixed(1)} MB`);
    console.log(`  ${NEST_PATH}  ${built.members} members · ${(built.bytes / 1e6).toFixed(1)} MB`);
    console.log(`  ${HOST_API_PATH}  ${Object.keys(map).length} shared modules\n`);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((e) => {
    console.error(`\n  ${e.message}\n`);
    process.exit(1);
  });
}
