#!/usr/bin/env node
/* dev.mjs — what `npm run dev` runs before the window opens: the static file
 * server AND the two model servers, as one process Tauri can start and stop.
 *
 * The models are on by default because, measured, they are the better app:
 * 212 of 302 holdout questions answered against 142 without, web answers
 * focused to the sentence that answers, chained arithmetic working, at about
 * two seconds a turn. Router-only mode is still one variable away —
 * PIGEON_NO_MODELS=1, or `npm run dev:fast` — for skill work where instant
 * replies matter more than better ones.
 *
 * Nothing waits on the models. `serve` is listening in milliseconds and that is
 * all Tauri waits for (devUrl); the models take 15–30 s to load and the app
 * re-probes for them every few seconds, so the rail flips from router-only to
 * the adapter and planner on its own. Nobody stares at a blank window while
 * weights load.
 *
 * Tauri stops this process on exit. Both children are told, and models.mjs
 * kills its two llama-servers on SIGINT — which is why SIGINT is forwarded,
 * not SIGTERM. If this process is SIGKILLed instead, the servers can outlive
 * it; that is harmless, and the next `npm run dev` reports them "already up"
 * and reuses them. */

import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const noModels = ['1', 'true', 'yes'].includes(String(process.env.PIGEON_NO_MODELS || '').toLowerCase());
/* PIGEON_MODELS=rust (`npm run dev:engine`): start no servers here and let the
   Rust shell spawn its own from the bundled sidecar — the path a built .app
   takes. The default keeps this script's servers, which the shell then finds
   already up on their ports and adopts rather than replaces. */
const rustModels = String(process.env.PIGEON_MODELS || '').toLowerCase() === 'rust';

const start = (script) => spawn(process.execPath, [join(HERE, script)], { stdio: 'inherit' });

const serve = start('serve.mjs');
const models = (noModels || rustModels) ? null : start('models.mjs');
if (noModels) console.log('\n  PIGEON_NO_MODELS is set — router-only mode, no model servers.\n');
if (rustModels) console.log('\n  PIGEON_MODELS=rust — the Rust shell starts the model servers itself.\n');

let stopping = false;
const stop = (why) => {
  if (stopping) return;
  stopping = true;
  /* SIGINT to both: serve exits on it, and models.mjs's SIGINT handler is the
     thing that takes the llama-servers down with it. */
  for (const child of [serve, models]) {
    if (child && child.exitCode === null) child.kill('SIGINT');
  }
  void why;
};
process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));
process.on('exit', () => stop('exit'));

/* The static server is the one Tauri depends on: when it goes, so does this
   process, and the models with it. The models ending on their own — no binary,
   no weights, Ctrl-C reaching them first — must NOT take the app down: the app
   works without them, and this is the case that must keep working. */
serve.on('exit', (code) => {
  stop('serve exited');
  process.exit(code ?? 0);
});
if (models) {
  models.on('exit', (code) => {
    if (!stopping && code) console.log(`\n  model servers exited (${code}) — the app runs router-only until they are back.\n`);
  });
}
