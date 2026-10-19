/* pigeon-load.mjs — Patch out of a sealed skill pack, for Node.
 *
 * The bench-side loader for `patch.pigeon`. It never trusts a file it has not
 * checked, and it checks the bytes it goes on to use: the file is read ONCE,
 * the strict zip rules and the seal are checked on that buffer, and the
 * extraction writes out of the same buffer — never a second read of a path that
 * could have changed in between.
 *
 * What comes back is the pieces the pipeline factories take as options, built
 * from the pack's prompts and tunables. The code that turns them into requests
 * is this checkout's; `scripts/pigeon-copycheck.mjs` is what proves the two
 * produce the same bytes.
 *
 * Node-only. `src/lint-imports.js` keeps the webview from importing this folder.
 */

import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

import { listEntries, get } from './zip-store.mjs';
import { pigeonRules, loadTrustedKeys, SEAL_NAME, SKILLPACK } from './seal.mjs';
import { buildRegistry } from '../../src/registry.js';
import { optionsFrom, checkTrainedSystem } from '../../src/patch-options.js';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const ROLES = ['planner', 'category', 'decline', 'asks', 'sibling', 'focus'];

function fail (why) {
  throw new Error(`patch.pigeon refused: ${why}`);
}

function entryJson (entries, buf, name) {
  const raw = get(entries, buf, name);
  if (!raw) fail(`${name} is missing`);
  try { return JSON.parse(raw.toString('utf8')); } catch (e) { fail(`${name} is not JSON — ${e.message}`); }
}

/**
 * Load a sealed skill pack. Returns
 * `{ manifest, keyId, fileSha256, dir, entries, registry, prompts, tunables,
 *    adapterPath, adapterSha256, plannerOptions, routerOptions, declineOptions,
 *    asksOptions, siblingOptions, focusOptions, cleanup }`.
 */
export async function loadPigeon (path, { trustedKeys = loadTrustedKeys(), into = tmpdir() } = {}) {
  const buf = await readFile(path);
  const zip = listEntries(buf);
  const rules = pigeonRules(zip, buf, trustedKeys);
  if (rules.kind !== SKILLPACK) fail(`this is a "${rules.kind}" Pigeon, not a skill pack`);
  if (!rules.sealed) fail('a skill pack must be sealed by a trusted key');

  const manifest = entryJson(zip, buf, 'pigeon.json');
  const has = (name) => zip.some(e => e.name === name);
  if (typeof manifest.code?.entry !== 'string' || !manifest.code.entry.startsWith('code/') || !has(manifest.code.entry)) {
    fail('code.entry must name a code/ file the pack carries');
  }
  /* From version 6 (D84) a pack carries no adapter and no prompts: they are
     the Pigeons it `needs`, asked from its nest (plannerbench --engine). */
  const pigeonsCarry = Number(manifest.version) >= 6 && Array.isArray(manifest.needs);
  const adapterName = manifest.models?.category?.adapter;
  if (!pigeonsCarry) {
    if (typeof adapterName !== 'string' || !has(adapterName)) fail('models.category.adapter must name a file the pack carries');
    for (const role of ROLES) {
      if (typeof manifest.prompts?.[role] !== 'string' || !has(manifest.prompts[role])) fail(`prompts.${role} must name a file the pack carries`);
    }
  }
  if (typeof manifest.tunables !== 'string' || !has(manifest.tunables)) fail('tunables must name a file the pack carries');

  const adapterSha256 = pigeonsCarry ? null : sha256(get(zip, buf, adapterName));
  if (!pigeonsCarry && adapterSha256 !== manifest.models.category.adapter_sha256) fail(`${adapterName} does not match the sha256 its manifest records`);

  /* Extraction: every entry but the seal, out of the checked buffer, into a
     directory only this user can read. Names already passed the strict name
     rule; the containment check is kept anyway, because it is one line. */
  const dir = await mkdtemp(join(into, 'patch-pigeon-'));
  const cleanup = () => rm(dir, { recursive: true, force: true });
  try {
    for (const e of zip) {
      if (e.name === SEAL_NAME) continue;
      const dest = resolve(dir, e.name);
      if (!dest.startsWith(dir + sep)) fail(`${e.name} would land outside the pack's folder`);
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, get(zip, buf, e.name));
    }

    const { default: entries } = await import(pathToFileURL(join(dir, manifest.code.entry)).href);
    if (!Array.isArray(entries)) fail(`${manifest.code.entry} must export an array of skills`);
    const registry = buildRegistry(entries);

    const prompts = pigeonsCarry ? {} : Object.fromEntries(ROLES.map(role => [role, entryJson(zip, buf, manifest.prompts[role])]));
    const tunables = entryJson(zip, buf, manifest.tunables);

    /* The one prompt that is a function of the skills: the category line the
       adapter was trained on. The pack must say exactly what this app would
       build from the pack's own skills, or its router is being asked a
       question it never learnt. */
    try { checkTrainedSystem(registry, prompts); } catch (e) { fail(e.message); }

    return {
      manifest,
      keyId: rules.keyId,
      fileSha256: sha256(buf),
      dir,
      entries,
      registry,
      prompts,
      tunables,
      adapterPath: pigeonsCarry ? null : join(dir, adapterName),
      adapterSha256,
      ...optionsFrom({ prompts, tunables }),
      cleanup
    };
  } catch (e) {
    await cleanup();
    throw e;
  }
}
