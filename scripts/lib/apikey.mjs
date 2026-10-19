/* apikey.mjs — the key the model servers require, shared with the shell.
 *
 * The Rust shell writes `app_data_dir/engine/api-key` (engine.rs, `api_key`)
 * and starts every llama-server with `--api-key-file` pointing at it. A server
 * `npm run dev` starts must answer to the SAME key or the shell will not
 * adopt it — it cannot tell it from a stranger's — so this reads that file,
 * and makes it the same way when it is not there yet. 32 random bytes as hex,
 * readable by this user alone. */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const IDENTIFIER = 'mode.airoplane.pigeon';

/** Where Tauri's app_data_dir puts this app's engine folder. */
export function apiKeyPath () {
  if (process.env.PIGEON_API_KEY_FILE) return process.env.PIGEON_API_KEY_FILE;
  const home = homedir();
  const data = process.platform === 'darwin'
    ? join(home, 'Library/Application Support', IDENTIFIER)
    : join(process.env.XDG_DATA_HOME || join(home, '.local/share'), IDENTIFIER);
  return join(data, 'engine', 'api-key');
}

const looksRight = (k) => /^[0-9a-f]{64}$/.test(k);

/** The key, made if it is not there. Returns `{ path, key }`. */
export function ensureApiKey () {
  const path = apiKeyPath();
  try {
    const k = readFileSync(path, 'utf8').trim();
    if (looksRight(k)) return { path, key: k };
  } catch {}
  const key = randomBytes(32).toString('hex');
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, key, { mode: 0o600 });
  return { path, key };
}

/* Importing this module from a script is enough: the key lands in the
   environment, where `src/llm.js` and `src/lane-b/bridge.js` read it — they
   ship in the sealed pack and in the lane, and neither may import node:fs. */
try {
  if (!process.env.PIGEON_API_KEY) process.env.PIGEON_API_KEY = ensureApiKey().key;
} catch {}

/** The header the JS dev paths send. `X-Api-Key`, because a wildcard CORS
 *  allow-list covers a custom header and not `Authorization`. */
export function keyHeaders () {
  try { return { 'x-api-key': ensureApiKey().key }; } catch { return {}; }
}
