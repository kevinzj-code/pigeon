/* node-skill-worker.mjs — src/skill-worker.js in a worker_threads thread.
 *
 * The browser runs the skill worker as a module Web Worker. Node has no such
 * thing, so this gives src/patch-pack.js a `makeWorker` whose workers have the
 * same surface it uses — postMessage, terminate, onmessage, onerror — backed by
 * worker_threads, running the real src/skill-worker.js unchanged.
 *
 * `codeRoot` is the directory holding skills/index.js: the repo for the
 * checkout, or a pack's extracted code/ folder. patch-pack is told codeBase '/'
 * (the only non-pack base the browser accepts) and the thread says what '/'
 * means here. The browser's check on a code base is untouched by this.
 *
 * Node-only; src/lint-imports.js keeps the webview from importing scripts/lib/.
 */

import { Worker } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';
import { resolve, sep } from 'node:path';

export function nodeSkillWorker ({ codeRoot }) {
  const root = pathToFileURL(resolve(codeRoot) + sep).href;
  return () => {
    const thread = new Worker(new URL('./node-skill-worker-thread.mjs', import.meta.url), { workerData: { codeRoot: root } });
    const adapter = {
      onmessage: null,
      onerror: null,
      postMessage: (m) => thread.postMessage(m),
      terminate: () => { thread.terminate(); }
    };
    thread.on('message', (data) => { if (adapter.onmessage) adapter.onmessage({ data }); });
    thread.on('error', (error) => { if (adapter.onerror) adapter.onerror({ error, message: error && error.message }); });
    return adapter;
  };
}
