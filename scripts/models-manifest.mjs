#!/usr/bin/env node
/* models-manifest.mjs — is what we pinned still what Hugging Face publishes?
 *
 * `src-tauri/models.json` names two GGUF files by URL, size and SHA-256, and
 * the app can only ever fetch those. This script asks the Hugging Face tree
 * API (which reports each LFS file's size and sha256 oid) whether the pinned
 * entries still match. It is the early warning for a repository that moved,
 * re-uploaded or renamed a file — the app itself would refuse a mismatched
 * download at verify time, but a person should hear about it before a user
 * does.
 *
 *   node scripts/models-manifest.mjs --check
 *
 * Network, read-only, manual. Never part of `npm test`, which runs offline. */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(ROOT, 'src-tauri', 'models.json'), 'utf8'));

function repoOf (url) {
  const m = url.match(/^https:\/\/huggingface\.co\/([^/]+\/[^/]+)\/resolve\/([^/]+)\/(.+)$/);
  if (!m) throw new Error(`not a huggingface resolve URL: ${url}`);
  return { repo: m[1], rev: m[2], file: m[3] };
}

let bad = 0;
for (const spec of manifest.models) {
  const { repo, rev, file } = repoOf(spec.url);
  const res = await fetch(`https://huggingface.co/api/models/${repo}/tree/${rev}`);
  if (!res.ok) { console.error(`${spec.id}: ${repo} answered ${res.status}`); bad++; continue; }
  const entry = (await res.json()).find(e => e.path === file);
  if (!entry) { console.error(`${spec.id}: ${file} is no longer in ${repo}`); bad++; continue; }
  const size = entry.size, oid = entry.lfs && entry.lfs.oid;
  const ok = size === spec.bytes && oid === spec.sha256;
  console.log(`${ok ? 'ok ' : 'BAD'} ${spec.id.padEnd(9)} ${repo}/${file}  ${size} B  ${oid}`);
  if (!ok) { bad++; console.error(`     pinned: ${spec.bytes} B  ${spec.sha256}`); }
}
process.exit(bad ? 1 : 0);
