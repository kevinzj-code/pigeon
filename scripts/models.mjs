/* models.mjs — start the two optional local servers and wait until they answer.
 *
 * Pigeon runs with neither of these. They are independent: the planner writes
 * plans, the category adapter names the neighbourhood a request belongs to, and
 * each is useful without the other. This script exists because starting them by
 * hand means retyping two long llama-server lines and getting the --lora flag
 * right, which is exactly the sort of thing that quietly ends up wrong.
 *
 * Every path can be overridden by environment variable; the defaults are where
 * the fleet already keeps its binaries and weights.
 */
import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureApiKey } from './lib/apikey.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const home = homedir();
const mac = process.platform === 'darwin';

/* Where the app keeps weights and adapters: the platform's per-user data
   directory, which is what the desktop app's app_data_dir resolves to. */
const SHARE = mac
  ? join(home, 'Library/Application Support/mode.airoplane.pigeon')
  : join(home, '.local/share/mode.airoplane.pigeon');

const env = (name, fallback) => process.env[name] ?? fallback;

/* On macOS the server is whatever `llama-server` is on PATH — `brew install
   llama.cpp` puts a Metal build there, and -ngl 99 below offloads to the GPU
   the same way it does for Vulkan on Linux. It is optional: when the binary
   is absent this script says so and exits, and the app runs router-only. */
/* A bare command name is resolved through PATH, so existsSync cannot check it;
   a path is checked directly. */
const onPath = (name) => (process.env.PATH || '').split(':')
  .some(d => d && existsSync(join(d, name)));

/* This repo carries a Metal build of llama-server as the app's sidecar. When
   nothing is on PATH that is the one to use, so a checkout needs no further
   setup. On Linux there is no sidecar to fall back to: it is `llama-server`
   on PATH, or the LLAMA_SERVER env var naming a Vulkan build — never a path
   into someone's home folder. */
const BUNDLED_MAC = join(ROOT, 'src-tauri/binaries/llama-server-aarch64-apple-darwin');
const BIN = env('LLAMA_SERVER', mac
  ? (onPath('llama-server') ? 'llama-server' : BUNDLED_MAC)
  : 'llama-server');
const haveBin = BIN.includes('/') ? existsSync(BIN) : onPath(BIN);

/* The category adapter is committed to this repo (model/) — that is the copy
   the app is built against, so it is the default. The app's own adapters
   directory is only a fallback for a checkout that has stripped model/. */
const REPO_LORA = join(ROOT, 'model/pigeon-category.lora.gguf');
const DEFAULT_LORA = existsSync(REPO_LORA)
  ? REPO_LORA
  : join(SHARE, 'adapters/pigeon-category.lora.gguf');

/* Lane B's personas, from the app's own adapters directory — the same folder
   the shell reads. Without them the category server has no voice to wear and
   `npm run serve` can only show the lane refusing to be a persona, which is
   the half of it that was already provable.

   Loaded INERT, at scale 0.0, and this is not a stylistic choice. The measured
   behaviour of this build: /v1/chat/completions honours a per-request `lora`
   array, and /completion — the endpoint the category ROUTER uses, and the only
   one that takes a grammar — ignores it entirely. A persona loaded at 1.0
   would therefore be silently applied to every routing decision Lane A makes.
   The chat path names every adapter with its scale on every request, so an
   inert launch costs it nothing. */
const PIGEON_SHARE = mac
  ? join(home, 'Library/Application Support/mode.airoplane.pigeon')
  : join(home, '.local/share/mode.airoplane.pigeon');
const personas = () => {
  try {
    return readdirSync(join(PIGEON_SHARE, 'adapters'))
      .filter(f => f.endsWith('.lora.gguf') && !f.includes(','))   // a comma would break the separator below
      .sort()
      .map(f => join(PIGEON_SHARE, 'adapters', f));
  } catch { return []; }
};

/* Task adapters, named one at a time and deliberately not globbed. model/ also
   holds superseded category adapters, the planner adapter that lost to the
   untrained model, and the sibling ones — every LoRA this project has trained
   lives there, and loading all nine would cost memory to no purpose. A task
   adapter is a decision, so it gets a line.

   They are NOT personas: a transcript repairer is not a voice and must never
   turn up in Lane B's persona list. They load the same way, inert at 0.0, and
   are named per request by whatever asks for them. The shell keeps the same
   distinction on Adapter.persona. */
const TASK_ADAPTERS = ['transcript-clean.lora.gguf'];
const taskAdapters = () => TASK_ADAPTERS
  .map(f => join(ROOT, 'model', f))
  .filter(p => existsSync(p) && p !== DEFAULT_LORA);

/* The category base, looked for the way the app looks: Pigeon's own models
   folder first, then the fleet's. Qwen3-VL-2B is fetched by Pigeon, so on most
   Macs only the first has it. */
const CATEGORY_FILE = 'Qwen3VL-2B-Instruct-Q4_K_M.gguf';
const CATEGORY_MODEL = [join(PIGEON_SHARE, 'models', CATEGORY_FILE), join(SHARE, 'models', CATEGORY_FILE)]
  .find(existsSync) ?? join(PIGEON_SHARE, 'models', CATEGORY_FILE);

/* PIGEON_BENCH_PINNED=1: the category server wears its adapter and nothing
   else. Two bench runs are only comparable when the servers were started the
   same way, and the persona folder is outside the repo — an adapter imported
   between runs would change the command line without anyone noticing. */
const PINNED = env('PIGEON_BENCH_PINNED', '') === '1';

const SERVERS = [
  {
    role: 'planner',
    port: Number(env('PIGEON_LLM_PORT', 8099)),
    model: env('PIGEON_PLANNER_MODEL', join(SHARE, 'models/Qwen3.5-2B-Q4_K_M.gguf')),
    lora: null
  },
  {
    role: 'category',
    port: Number(env('PIGEON_CATEGORY_PORT', 8101)),
    model: env('PIGEON_CATEGORY_MODEL', CATEGORY_MODEL),
    lora: env('PIGEON_CATEGORY_LORA', DEFAULT_LORA),
    personas: PINNED ? [] : personas(),
    tasks: PINNED ? [] : taskAdapters()
  }
];

const up = async (port) => {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1000) });
    return r.ok;
  } catch { return false; }
};

/* Every server takes the shell's key file, so the app can adopt what this
   script started and no other process on the machine can prompt it. */
const KEY_FILE = ensureApiKey().path;

const children = [];
for (const s of SERVERS) {
  if (await up(s.port)) { console.log(`  ${s.role.padEnd(9)} already up on ${s.port}`); continue; }

  /* Missing weights are reported and skipped rather than thrown: one server
     being absent is a supported state, and killing the script would take the
     other down with it. */
  const missing = [s.model, s.lora].filter(p => p && !existsSync(p));
  if (!haveBin) { console.log(`  ${s.role.padEnd(9)} SKIPPED — no llama-server at ${BIN} (set LLAMA_SERVER to a build's path)`); continue; }
  if (missing.length) { console.log(`  ${s.role.padEnd(9)} SKIPPED — missing ${missing.join(', ')}`); continue; }

  /* One flag or the other, never both, and never a repeated --lora: this
     build keeps only the LAST of a repeated --lora, so a second one silently
     replaces the category adapter. --lora-scaled takes the whole list at once,
     comma-separated, each with its scale. Same shape as the shell's. */
  const wear = s.lora ? [s.lora, ...(s.tasks || []), ...(s.personas || [])] : [];
  const args = ['-m', s.model, '--port', String(s.port), '--host', '127.0.0.1',
                '-ngl', '99', '-c', '8192', '--parallel', '1', '--no-warmup',
                '--api-key-file', KEY_FILE,
                ...(wear.length === 0 ? []
                  : wear.length === 1 ? ['--lora', wear[0]]
                  : ['--lora-scaled', wear.map((p, i) => `${p}:${i === 0 ? '1.0' : '0.0'}`).join(',')])];
  const child = spawn(BIN, args, { stdio: 'ignore', detached: false });
  child.on('error', e => console.log(`  ${s.role.padEnd(9)} failed to start: ${e.message}`));
  children.push({ ...s, child });
  const worn = (s.personas || []).length;
  const tasks = (s.tasks || []).length;
  const inert = [tasks && `${tasks} task adapter${tasks === 1 ? '' : 's'}`,
                 worn && `${worn} persona${worn === 1 ? '' : 's'}`].filter(Boolean).join(' and ');
  console.log(`  ${s.role.padEnd(9)} starting on ${s.port}${s.lora ? ' with the category adapter' : ''}` +
              (inert ? `, ${inert} loaded inert` : ''));
}

for (const s of children) {
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline && !(await up(s.port))) await new Promise(r => setTimeout(r, 500));
  console.log(`  ${s.role.padEnd(9)} ${await up(s.port) ? 'ready' : 'DID NOT COME UP'} on ${s.port}`);
}

if (!children.length) { console.log('\n  nothing to start.\n'); process.exit(0); }
console.log('\n  Ctrl-C to stop.\n');
process.on('SIGINT', () => { for (const s of children) s.child.kill(); process.exit(0); });
