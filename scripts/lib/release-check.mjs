/* release-check.mjs — may this checkout be built into a release?
 *
 * A release ships Patch as `pack/patch.nest` (his sealed `pack/patch.pigeon`
 * beside the Pigeons it needs) and no skills of its own. That
 * is only honest if the pack IS this checkout: sealed by a trusted key, made
 * from the commit whose skills/, src/ and model/ are the ones being built, and
 * carrying the same shared modules the windows run (host-api.mjs). Anything
 * else would ship an app whose Patch is some other build's.
 *
 * `releaseProblems` is pure so the suite can check every refusal; the readers
 * beside it do the file and git work. Node-only.
 */

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

import { listEntries, get } from './zip-store.mjs';
import { pigeonRules, loadTrustedKeys, SKILLPACK } from './seal.mjs';

export const PACK_PATH = 'pack/patch.pigeon';
/* What a release bundles from v6: the sealed pack and the Pigeons it needs. */
export const NEST_PATH = 'pack/patch.nest';
export const HOST_API_PATH = 'pack/host-api.json';
/* What a pack must have been made from. models.json pins the category base. */
export const PACKED_PATHS = ['skills', 'src', 'model', 'src-tauri/models.json'];

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/**
 * Every reason not to release, from what was measured. Empty means go.
 * `pack` is readPack's answer (null when there is no file); `sameCode` whether
 * PACKED_PATHS are unchanged since the pack's commit; `hostApi` this build's
 * shared-module hashes; `mainClosure` every file the windows import.
 */
export function releaseProblems ({ pack, sameCode, hostApi = {}, mainClosure = [], nest = undefined }) {
  if (!pack) return [`${PACK_PATH} is missing — run \`npm run pack:patch\` first`];
  if (pack.error) return [`${PACK_PATH} cannot be used: ${pack.error}`];
  const out = [];
  /* D84: from v6 Patch ships as his nest, the sealed pack beside every Pigeon
     it needs. `nest` undefined skips this (a caller that has not read one). */
  if (nest !== undefined) {
    if (!nest) out.push(`${NEST_PATH} is missing — run \`npm run pack:patch\` first`);
    else if (nest.error) out.push(`${NEST_PATH} cannot be used: ${nest.error}`);
    else {
      if (nest.packSha256 !== pack.sha256) out.push(`${NEST_PATH} does not carry ${PACK_PATH} as it is now`);
      for (const id of pack.needs || []) if (!nest.ids.includes(id)) out.push(`${NEST_PATH} has no Pigeon "${id}", which Patch needs`);
      for (const id of nest.unsealed || []) out.push(`${NEST_PATH}'s "${id}" is not sealed by a key this app trusts`);
    }
  }
  if (pack.kind !== SKILLPACK || !pack.sealed) out.push(`${PACK_PATH} is not a sealed skill pack`);
  if (!sameCode) {
    out.push(`skills/, src/ or model/ differ from ${String(pack.head || '?').slice(0, 7)}, the commit the pack was made from — run \`npm run pack:patch\` again`);
  }
  for (const [path, sha] of Object.entries(hostApi)) {
    if (pack.codeHashes?.[`code/${path}`] !== sha) out.push(`the pack's ${path} is not this build's copy`);
  }
  const loose = mainClosure.filter(p => p.startsWith('skills/'));
  if (loose.length) out.push(`the app still imports skills/ itself (${loose[0]}) — a release takes skills only from the pack`);
  return out;
}

/** The pack at `root`, checked with the same strict reader and seal rules the app uses. */
export async function readPack (root, trustedKeys = loadTrustedKeys()) {
  const file = join(root, PACK_PATH);
  if (!existsSync(file)) return null;
  try {
    const buf = await readFile(file);
    const entries = listEntries(buf);
    const rules = pigeonRules(entries, buf, trustedKeys);
    const raw = get(entries, buf, 'pigeon.json');
    if (!raw) return { error: 'it has no pigeon.json' };
    const manifest = JSON.parse(raw.toString('utf8'));
    const codeHashes = Object.fromEntries(entries
      .filter(e => e.name.startsWith('code/'))
      .map(e => [e.name, sha256(get(entries, buf, e.name))]));
    return { kind: rules.kind, sealed: rules.sealed, keyId: rules.keyId ?? null, head: manifest.source?.head ?? null, version: manifest.version ?? null,
             needs: manifest.needs ?? [], codeHashes, bytes: buf.length, sha256: sha256(buf) };
  } catch (e) {
    return { error: e.message };
  }
}

/** Patch's nest at `root`: the ids of its Pigeons and the hash of the pack it carries. */
/* Sealed by a trusted key; the seal check throws for a key not on the list. */
const sealedBy = (entries, buf, trustedKeys) => {
  try { return pigeonRules(entries, buf, trustedKeys).sealed; } catch { return false; }
};

export async function readNest (root, trustedKeys = loadTrustedKeys()) {
  const file = join(root, NEST_PATH);
  if (!existsSync(file)) return null;
  try {
    const buf = await readFile(file);
    const entries = listEntries(buf);
    if (!get(entries, buf, 'nest.json')) return { error: 'it has no nest.json' };
    const ids = [];
    const unsealed = [];
    let packSha256 = null;
    for (const e of entries.filter(e => !e.name.includes('/') && e.name.endsWith('.pigeon'))) {
      const member = get(entries, buf, e.name);
      const inner = listEntries(member);
      const m = JSON.parse(get(inner, member, 'pigeon.json').toString('utf8'));
      if (m.kind === SKILLPACK) packSha256 = sha256(member);
      else ids.push(m.id);
      if (m.kind !== SKILLPACK && !sealedBy(inner, member, trustedKeys)) unsealed.push(m.id);
    }
    return { ids, unsealed, packSha256, bytes: buf.length };
  } catch (e) {
    return { error: e.message };
  }
}

/** Are PACKED_PATHS at `root` — committed, staged and in the working tree — what they were at `head`? */
export function sameCodeAs (root, head) {
  if (!head) return false;
  const quiet = (...args) => {
    try { execFileSync('git', args, { cwd: root, stdio: 'ignore' }); return true; } catch { return false; }
  };
  return quiet('diff', '--quiet', head, '--', ...PACKED_PATHS)
    && quiet('diff', '--quiet', '--cached', '--', ...PACKED_PATHS)
    && quiet('diff', '--quiet', '--', ...PACKED_PATHS);
}

/**
 * How the bundled pack differs from this working tree, by content rather than
 * by commit: packed code files that are missing, extra or changed, prompts or
 * tunables that are not the constants the app runs on, and a host-api.json
 * that is not this build's. Empty when the pack is current; null when there is
 * no pack. Unlike releaseProblems it needs no commit, so the test suite can run
 * it on every edit — the dev app loads its skills from this file too, and a
 * pack left behind by a change is otherwise invisible until a release refuses it.
 */
export async function packDrift (root) {
  const file = join(root, PACK_PATH);
  if (!existsSync(file)) return null;
  const { importClosure, patchData } = await import('../export-pigeon-stage.mjs');
  const { hostApiFor } = await import('../host-api.mjs');
  const { isDeepStrictEqual } = await import('node:util');
  const buf = await readFile(file);
  const entries = listEntries(buf);
  const out = [];
  const packed = entries.filter(e => e.name.startsWith('code/')).map(e => e.name.slice('code/'.length));
  const closure = await importClosure(root);
  for (const p of closure) {
    const theirs = get(entries, buf, `code/${p}`);
    if (!theirs) out.push(`${p} is not in the pack`);
    else if (sha256(theirs) !== sha256(await readFile(join(root, p)))) out.push(`${p} changed`);
  }
  for (const p of packed) if (!closure.includes(p)) out.push(`${p} is packed but no longer used`);
  const manifest = JSON.parse(get(entries, buf, 'pigeon.json').toString('utf8'));
  const { tunables } = await patchData();
  const { PATCH_VERSION, PATCH_NEEDS } = await import('../export-pigeon-stage.mjs');
  const packedJson = (name) => JSON.parse(get(entries, buf, name).toString('utf8'));
  if (manifest.version !== PATCH_VERSION) out.push(`the pack is Patch v${manifest.version}; this build packs v${PATCH_VERSION}`);
  if (!isDeepStrictEqual(packedJson(manifest.tunables), tunables)) out.push('tunables.json is not the app\'s constants');
  /* From v6 the prompts are the Pigeons' (D84); the pack names them. */
  if (!isDeepStrictEqual(manifest.needs, PATCH_NEEDS)) out.push('needs is not the list of Pigeons this build asks');
  const hostFile = join(root, HOST_API_PATH);
  const { map } = await hostApiFor(root);
  if (!existsSync(hostFile) || !isDeepStrictEqual(JSON.parse(await readFile(hostFile, 'utf8')), map)) out.push(`${HOST_API_PATH} is not this build's`);
  return out;
}
