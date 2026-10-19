#!/usr/bin/env node
/* record-shape.mjs — measure a voice's memory shape and write it beside the voice.
 *
 * The app reads `shape` from the voice's sidecar (<id>.lora.json): "A" is sent
 * its chat's last turns, "B" only the newest message, and a voice with neither
 * is said to be unmeasured. This is what puts it there.
 *
 * Shape A is tried first, because it keeps the conversation; B only when A fails
 * the bar; neither when both fail, and then the key is removed so nothing claims
 * a measurement that did not pass. The bar is lanebbench's own: no leaked
 * figure and nothing conversational eaten, single questions and follow-ups.
 *
 *   node scripts/record-shape.mjs plain-english-explainer
 *   node scripts/record-shape.mjs plain-english-explainer --measured A
 *
 * --measured writes a shape already measured (with the bench output kept
 * elsewhere) without running the benches again. Needs the category server up
 * with the voice loaded, unless --measured is given.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const id = argv[0];
const opt = (name) => { const i = argv.indexOf(name); return i > -1 ? argv[i + 1] : null; };
if (!id || id.startsWith('--') || !/^[a-z0-9][a-z0-9-_]*$/i.test(id)) {
  console.error('usage: node scripts/record-shape.mjs <voice-id> [--measured A|B] [--adapters DIR]');
  process.exit(2);
}
const ADAPTERS = opt('--adapters') || join(homedir(), 'Library', 'Application Support', 'mode.airoplane.pigeon', 'adapters');
const sidecar = join(ADAPTERS, `${id}.lora.json`);
if (!existsSync(join(ADAPTERS, `${id}.lora.gguf`))) { console.error(`no voice "${id}" in ${ADAPTERS}`); process.exit(1); }

let shape = opt('--measured');
if (shape !== null && !['A', 'B'].includes(shape)) { console.error('--measured is A or B'); process.exit(2); }

if (shape === null) {
  const passes = (s) => {
    console.log(`\n  ── ${id}, shape ${s}`);
    const run = spawnSync(process.execPath, [join(ROOT, 'scripts/lanebbench.mjs'), '--persona', id, '--shape', s], { cwd: ROOT, stdio: 'inherit' });
    return run.status === 0;
  };
  shape = passes('A') ? 'A' : passes('B') ? 'B' : null;
}

const contract = existsSync(sidecar) ? JSON.parse(readFileSync(sidecar, 'utf8')) : {};
if (shape) contract.shape = shape;
else delete contract.shape;
writeFileSync(sidecar, JSON.stringify(contract) + '\n');
console.log(`\n  ${id}: ${shape ? `shape ${shape} recorded` : 'neither shape passed — no shape recorded'} in ${sidecar}\n`);
process.exit(shape ? 0 : 1);
