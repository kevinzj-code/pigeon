/* node-skill-worker-thread.mjs — the inside of node-skill-worker.mjs's thread.
 *
 * Gives the thread the few names a dedicated worker's global has and
 * src/skill-worker.js uses — self, postMessage, addEventListener — then loads
 * that file. The import is dynamic so it runs after these are in place (a
 * static import would be evaluated first).
 */

import { parentPort, workerData } from 'node:worker_threads';

globalThis.self = globalThis;
globalThis.postMessage = (m) => parentPort.postMessage(m);
globalThis.addEventListener = (type, fn) => {
  if (type === 'message') parentPort.on('message', (data) => fn({ data }));
};
globalThis.removeEventListener = () => {};
globalThis.__pigeonNodeCodeRoot = workerData.codeRoot;

await import('../../src/skill-worker.js');
