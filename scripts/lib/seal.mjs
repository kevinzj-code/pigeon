/* seal.mjs — the pigeon-seal-ed25519-v1 check, in Node.
 *
 * A sealed .pigeon carries `seal.json` as its last entry: an Ed25519
 * signature, by a key Pigeon trusts, over the sha256 of every other entry.
 * The Rust and Python implementations follow the same shared spec; the
 * fixture in src-tauri/tests/fixtures/ is how the three agree byte for byte.
 *
 * Node-only. Nothing under src/ may import this (src/lint-imports.js).
 */

import { createHash, createPublicKey, createPrivateKey, sign, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { get, listEntries, buildStoreZip } from './zip-store.mjs';

export const SCHEME = 'pigeon-seal-ed25519-v1';
export const SEAL_NAME = 'seal.json';
export const MESSAGE_HEADER = 'PIGEON-SEAL-V1\n';
export const SKILLPACK = 'skillpack';
export const DEFAULT_KEYS_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src-tauri', 'keys', 'seal-keys.json');

const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

const sha256 = (b) => createHash('sha256').update(b).digest();
const refuse = (reason) => { throw new Error(`seal refused: ${reason}`); };

/** First 16 hex chars of sha256(raw 32-byte public key). */
export function keyId (pub32) {
  if (!Buffer.isBuffer(pub32) || pub32.length !== 32) throw new Error('keyId needs a 32-byte public key');
  return sha256(pub32).toString('hex').slice(0, 16);
}

/** The exact bytes that are signed: every entry but seal.json, sorted by name bytes. */
export function sealMessage (entries, buf) {
  const lines = entries
    .filter(e => e.name !== SEAL_NAME)
    .map(e => ({ name: Buffer.from(e.name, 'latin1'), e }))
    .sort((a, b) => Buffer.compare(a.name, b.name))
    .map(({ name, e }) => Buffer.concat([
      Buffer.from(sha256(buf.subarray(e.dataStart, e.dataStart + e.size)).toString('hex') + '  ', 'latin1'),
      name,
      Buffer.from('\n')
    ]));
  return Buffer.concat([Buffer.from(MESSAGE_HEADER, 'latin1'), ...lines]);
}

export function publicKeyObject (pub32) {
  return createPublicKey({ key: Buffer.concat([SPKI_PREFIX, pub32]), format: 'der', type: 'spki' });
}

/** Ed25519 key pair from a 32-byte seed: { privateKey, pub } with pub as 32 raw bytes. */
export function keyFromSeed (seed32) {
  const seed = Buffer.isBuffer(seed32) ? seed32 : Buffer.from(seed32, 'hex');
  if (seed.length !== 32) throw new Error('seed must be 32 bytes');
  const privateKey = createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, seed]), format: 'der', type: 'pkcs8' });
  const spki = createPublicKey(privateKey).export({ format: 'der', type: 'spki' });
  return { privateKey, pub: Buffer.from(spki.subarray(SPKI_PREFIX.length)) };
}

/**
 * The trusted keys: [{ id, ed25519_pub_hex, revoked }]. Refuses a malformed
 * file, a duplicate id, and an id that is not the key's own id.
 */
export function loadTrustedKeys (path = DEFAULT_KEYS_PATH) {
  return validateTrustedKeys(JSON.parse(readFileSync(path, 'utf8')));
}

export function validateTrustedKeys (list) {
  if (!Array.isArray(list)) throw new Error('trusted keys: not an array');
  const ids = new Set();
  return list.map((k, i) => {
    if (!k || typeof k !== 'object') throw new Error(`trusted keys[${i}]: not an object`);
    if (typeof k.id !== 'string' || !/^[0-9a-f]{16}$/.test(k.id)) throw new Error(`trusted keys[${i}]: bad id`);
    if (typeof k.ed25519_pub_hex !== 'string' || !/^[0-9a-f]{64}$/.test(k.ed25519_pub_hex)) throw new Error(`trusted keys[${i}]: bad ed25519_pub_hex`);
    if (typeof k.revoked !== 'boolean') throw new Error(`trusted keys[${i}]: revoked must be a boolean`);
    if (ids.has(k.id)) throw new Error(`trusted keys: duplicate id ${k.id}`);
    ids.add(k.id);
    const pub = Buffer.from(k.ed25519_pub_hex, 'hex');
    if (keyId(pub) !== k.id) throw new Error(`trusted keys[${i}]: id ${k.id} is not the id of its key`);
    return { id: k.id, ed25519_pub_hex: k.ed25519_pub_hex, revoked: k.revoked };
  });
}

/** Parse seal.json strictly. */
function parseSeal (bytes) {
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { refuse('seal.json is not UTF-8'); }
  let obj;
  try { obj = JSON.parse(text); } catch { refuse('seal.json is not JSON'); }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) refuse('seal.json is not an object');
  const keys = Object.keys(obj).sort();
  if (keys.join(',') !== 'key,scheme,signature') refuse('seal.json must have exactly scheme, key, signature');
  // JSON.parse keeps the last of a duplicated key; refuse duplicates instead.
  for (const k of keys) {
    if (text.split(`"${k}"`).length !== 2) refuse(`seal.json repeats "${k}"`);
  }
  if (obj.scheme !== SCHEME) refuse(`unknown scheme ${JSON.stringify(obj.scheme)}`);
  if (typeof obj.key !== 'string' || !/^[0-9a-f]{16}$/.test(obj.key)) refuse('key is not 16 lowercase hex');
  if (typeof obj.signature !== 'string' || !/^[0-9a-f]{128}$/.test(obj.signature)) refuse('signature is not 128 lowercase hex');
  return obj;
}

/**
 * { sealed: false } when there is no seal.json; { sealed: true, keyId } when
 * it verifies against a trusted, unrevoked key. Throws on anything else.
 * `entries` must come from listEntries (strict rules already applied).
 */
export function checkSeal (entries, buf, trustedKeys) {
  const at = entries.map((e, i) => e.name === SEAL_NAME ? i : -1).filter(i => i >= 0);
  if (at.length === 0) return { sealed: false };
  if (at.length > 1) refuse('seal.json appears more than once');
  if (at[0] !== entries.length - 1) refuse('seal.json is not the last entry');
  const seal = parseSeal(get(entries, buf, SEAL_NAME));
  const trusted = (trustedKeys || []).find(k => k.id === seal.key);
  if (!trusted) refuse(`key ${seal.key} is not trusted`);
  if (trusted.revoked) refuse(`key ${seal.key} is revoked`);
  const pub = Buffer.from(trusted.ed25519_pub_hex, 'hex');
  const ok = verify(null, sealMessage(entries, buf), publicKeyObject(pub), Buffer.from(seal.signature, 'hex'));
  if (!ok) refuse('signature does not verify');
  return { sealed: true, keyId: seal.key };
}

/**
 * The kind rules on top of the seal: a skillpack must be sealed by a trusted
 * key; code/ entries are refused in every other kind; a data-only Pigeon may
 * be unsealed; a present seal must verify (checkSeal throws).
 */
export function pigeonRules (entries, buf, trustedKeys) {
  const raw = get(entries, buf, 'pigeon.json');
  if (!raw) throw new Error('not a valid .pigeon file — no pigeon.json at the root');
  let manifest;
  try { manifest = JSON.parse(raw.toString('utf8')); } catch { throw new Error('pigeon.json could not be read'); }
  const kind = manifest && typeof manifest.kind === 'string' ? manifest.kind : null;
  if (!kind) throw new Error('pigeon.json has no kind');
  const { sealed, keyId: id } = checkSeal(entries, buf, trustedKeys);
  if (kind === SKILLPACK && !sealed) throw new Error('a skillpack must carry a seal by a trusted key');
  if (kind !== SKILLPACK && entries.some(e => e.name.startsWith('code/'))) {
    throw new Error(`code/ entries are only allowed in a skillpack, not in a ${kind}`);
  }
  return { kind, sealed, keyId: sealed ? id : null };
}

/**
 * TEST ONLY. A sealed stored zip: `files` then seal.json, signed with the
 * key derived from `seed32` (Buffer or hex).
 */
export function sealZip (files, seed32) {
  const { privateKey, pub } = keyFromSeed(seed32);
  // The message depends only on names and data, so read it off the unsealed build.
  const body = buildStoreZip(files);
  const msg = sealMessage(listEntries(body), body);
  const signature = sign(null, msg, privateKey).toString('hex');
  const seal = JSON.stringify({ scheme: SCHEME, key: keyId(pub), signature });
  return buildStoreZip([...files, [SEAL_NAME, seal]]);
}
