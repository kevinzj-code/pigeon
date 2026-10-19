#!/usr/bin/env node
/* pigeon-copycheck.mjs — does a packed Patch ask the models exactly what this
 * checkout asks them, before a single model is started?
 *
 * The bench proof (plannerbench --pigeon, then benchdiff) takes three quarters
 * of an hour of real inference. This is the gate in front of it, and it needs no
 * model at all:
 *
 *   1. The code in the pack is byte-for-byte the code at the commit it records,
 *      and skills/, src/ and model/ have not moved since that commit.
 *   2. The prompts and tunables are the constants the app runs on, and the
 *      category line is the one the adapter was trained on.
 *   3. The registry built from the pack is the registry built from this
 *      checkout — every routable skill, every card, every category.
 *   4. All 408 bench questions go through the shipped bench wiring twice — once
 *      from this checkout, once from the pack — against recording stubs that
 *      answer deterministically. Every request sent and every turn produced
 *      must be identical.
 *   5. The same 408 through the APP's wiring (stack.js assembleStack) twice:
 *      once as the app ran before the locked room — this checkout's skills
 *      imported directly, no options — and once as it runs now: the pack's
 *      extracted code loaded by src/patch-pack.js into src/skill-worker.js
 *      (in a worker_threads thread), with the pack's prompts and tunables as
 *      options. Requests and turns must again be identical.
 *
 * If this passes, a difference in the real runs is the models', not the pack's.
 *
 * Usage: node scripts/pigeon-copycheck.mjs dist/patch.pigeon
 */

import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

import { loadPigeon } from './lib/pigeon-load.mjs';
import { patchData, importClosure } from './export-pigeon-stage.mjs';
import { HOLDOUT } from './holdout.mjs';
import { NO_SKILL_MESSAGES } from './no-skill-set.mjs';
import { plannerOptions, declineOptions } from './prompt-variants.mjs';
import codeEntries from '../skills/index.js';
import { buildRegistry } from '../src/registry.js';
import { categoryRouter } from '../src/category-router.js';
import { llmPlanner } from '../src/planner.js';
import { declineCheck } from '../src/verify.js';
import { jsExtractor } from '../src/extractor.js';
import { runTurn } from '../src/turn.js';
import { assembleStack } from '../src/stack.js';
import { loadPatch } from '../src/patch-pack.js';
import { nodeSkillWorker } from './lib/node-skill-worker.mjs';
import './lib/apikey.mjs'; // the model servers' key → PIGEON_API_KEY

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
/* The bench's frozen context (plannerbench.mjs), so a turn cannot differ by clock. */
const CTX = { now: '2026-09-01T09:00:00Z', timezone: 'UTC', locale: 'en-GB', units: 'metric', webEnabled: false, confirmBeforeNetwork: true };

/* A deterministic stand-in for llama-server that records every request. It
   answers each shape acceptably so the pipeline walks its normal path: a
   constrained choice gets its first option, a plan names the first skill the
   grammar allows, anything else gets YES. */
function recorder () {
  const calls = [];
  const complete = async (req) => {
    calls.push(JSON.parse(JSON.stringify(req)));
    const g = req.grammar;
    if (typeof g !== 'string') return { text: 'YES', ms: 1, tokens: 1, confidence: null };
    if (g.includes('looking_for')) return { text: '{"looking_for":"x","sentence":1}', ms: 1, tokens: 1, confidence: 0.9 };
    if (g.includes('steps')) {
      const skill = (g.match(/\\"([A-Za-z][A-Za-z0-9]*)\\"/) || [])[1] || 'none';
      return { text: JSON.stringify({ steps: [{ id: 's1', skill, input: {} }] }), ms: 1, tokens: 1, confidence: 0.9 };
    }
    const first = (g.match(/^root ::= "([^"]*)"/) || [])[1];
    return { text: first ?? 'YES', ms: 1, tokens: 1, confidence: 0.9 };
  };
  complete.health = async () => true;
  complete.model = async () => 'stub';
  return { calls, complete };
}

/* A turn without the fields that measure time: `ms`, anything ending Ms or At,
   and `stages`, runTurn's per-stage timings in milliseconds. */
const TIMING = /^(ms|at|stages|.*Ms|.*At)$/;
const timeless = (value) => JSON.parse(JSON.stringify(value, (k, v) => (TIMING.test(k) ? undefined : v)));

/** The shipped bench wiring (benchqueue BASE_FLAGS) around one registry. */
function wiring (registry, pack) {
  const category = recorder();
  const planner = recorder();
  const router = categoryRouter({
    registry, complete: category.complete, maxCandidates: 20, trained: true, minConfidence: 0.80, fallbackFloor: 0,
    ...(pack ? pack.routerOptions : {})
  });
  const plan = llmPlanner({
    complete: planner.complete, registry, fewShot: true, runway: 'auto', ranked: false,
    ...(pack ? pack.plannerOptions : plannerOptions(null))
  });
  const secondLook = declineCheck({ complete: planner.complete, registry, ...(pack ? pack.declineOptions : declineOptions(null)) });
  const deps = { planner: plan, extractor: jsExtractor(registry), trustRouter: false, fallbackOnEmpty: false, verify: null, secondLook, groundCheck: false, asksCheck: null };
  return { router, deps, category, planner };
}

async function main () {
  const file = process.argv[2];
  if (!file) { console.error('usage: node scripts/pigeon-copycheck.mjs <patch.pigeon>'); process.exit(2); }
  const failures = [];
  const fail = (what) => { failures.push(what); console.log(`  ✗ ${what}`); };
  const pass = (what) => console.log(`  ✓ ${what}`);

  const pack = await loadPigeon(file);
  const head = pack.manifest.source?.head;
  console.log(`\n  ${file}  sealed by ${pack.keyId} · version ${pack.manifest.version} · packed from ${head?.slice(0, 7)}\n`);
  try {
    /* 1. Code, against the commit it came from. */
    const git = (...args) => execFileSync('git', args, { cwd: ROOT });
    try {
      git('diff', '--quiet', head, '--', 'skills', 'src', 'model', 'src-tauri/models.json');
      git('diff', '--quiet', '--', 'skills', 'src', 'model', 'src-tauri/models.json');
      pass(`skills/, src/ and model/ are unchanged since ${head.slice(0, 7)}`);
    } catch {
      fail(`skills/, src/ or model/ differ from ${head?.slice(0, 7)} — this checkout is not what was packed`);
    }
    const packed = (await importClosure(pack.dir, 'code/skills/index.js')).map(p => p.replace(/^code\//, ''));
    const closure = await importClosure(ROOT);
    if (!isDeepStrictEqual(packed, closure)) fail(`the packed code is not this checkout's import closure (${packed.length} against ${closure.length})`);
    const differs = closure.filter(rel => !git('show', `${head}:${rel}`).equals(readFileSync(join(pack.dir, 'code', rel))));
    if (differs.length) fail(`${differs.length} packed code files differ from ${head.slice(0, 7)}, e.g. ${differs[0]}`);
    else pass(`${closure.length} code files are byte-for-byte ${head.slice(0, 7)}`);

    /* 2. Prompts and tunables. */
    const data = await patchData();
    const promptDiff = Object.keys(data.prompts).filter(r => !isDeepStrictEqual(pack.prompts[r], JSON.parse(JSON.stringify(data.prompts[r]))));
    if (promptDiff.length) fail(`packed prompts differ from the app's constants: ${promptDiff.join(', ')}`);
    else if (!isDeepStrictEqual(pack.tunables, data.tunables)) fail('packed tunables differ from the app\'s');
    else pass('prompts and tunables are the app\'s constants');
    const trainingRows = join(ROOT, 'model/training-data-v4/train.jsonl');
    if (existsSync(trainingRows)) {
      const row = JSON.parse(readFileSync(trainingRows, 'utf8').split('\n')[0]);
      const sys = (row.messages || []).find(m => m.role === 'system')?.content;
      if (sys !== pack.prompts.category.trained_system) fail('the packed category line is not the one the adapter trained on');
      else pass('the category line is the one the adapter trained on');
    }

    /* 3. Registries. */
    const codeRegistry = buildRegistry(codeEntries);
    const card = (reg, name) => (typeof reg.compactCard === 'function' ? reg.compactCard(name) : null);
    const names = (reg) => reg.routable().map(s => s.name);
    if (!isDeepStrictEqual(names(codeRegistry), names(pack.registry))) fail('the routable skills differ');
    else {
      const cards = names(codeRegistry).filter(n => !isDeepStrictEqual(timeless(card(codeRegistry, n)), timeless(card(pack.registry, n))));
      if (cards.length) fail(`${cards.length} skill cards differ, e.g. ${cards[0]}`);
      else pass(`${names(codeRegistry).length} routable skills and their cards are identical`);
    }

    /* 4. The whole pipeline, twice, on every bench question. */
    const cases = [...HOLDOUT.map(([m]) => m), ...NO_SKILL_MESSAGES];
    const a = wiring(codeRegistry, null);
    const b = wiring(pack.registry, pack);
    let turnDiffs = 0;
    let firstTurnDiff = null;
    for (const message of cases) {
      const ta = timeless(await runTurn(message, { registry: codeRegistry, router: a.router, ctx: CTX, tieBreak: null, ...a.deps }).catch(e => ({ error: e.message })));
      const tb = timeless(await runTurn(message, { registry: pack.registry, router: b.router, ctx: CTX, tieBreak: null, ...b.deps }).catch(e => ({ error: e.message })));
      if (!isDeepStrictEqual(ta, tb)) { turnDiffs++; firstTurnDiff ??= message; }
    }
    const streams = [['category server', a.category.calls, b.category.calls], ['planner server', a.planner.calls, b.planner.calls]];
    for (const [role, ca, cb] of streams) {
      if (!isDeepStrictEqual(ca, cb)) {
        const i = ca.findIndex((c, j) => !isDeepStrictEqual(c, cb[j]));
        fail(`${role}: request ${i} of ${ca.length} differs`);
      } else {
        pass(`${role}: ${ca.length} requests identical`);
      }
    }
    if (turnDiffs) fail(`${turnDiffs} of ${cases.length} turns differ, first "${String(firstTurnDiff).slice(0, 50)}"`);
    else pass(`${cases.length} turns identical`);

    /* 5. The app's stack, before and through the locked room. */
    const viaApp = async (registry, packOptions) => {
      const category = recorder();
      const planner = recorder();
      const st = assembleStack({ registry, complete: planner.complete, categoryComplete: category.complete, packOptions });
      const extractor = jsExtractor(registry);
      const turns = [];
      for (const message of cases) {
        turns.push(timeless(await runTurn(message, {
          registry, router: st.router, ctx: CTX, planner: st.planner, extractor, assembler: null,
          focus: st.focus, secondLook: st.secondLook, asksCheck: st.asksCheck
        }).catch(e => ({ error: e.message }))));
      }
      return { turns, category: category.calls, planner: planner.calls };
    };
    const before = await viaApp(codeRegistry, undefined);
    const room = await loadPatch({
      codeBase: '/', makeWorker: nodeSkillWorker({ codeRoot: join(pack.dir, 'code') }),
      pack: { prompts: pack.prompts, tunables: pack.tunables, version: pack.manifest.version, source: file }
    });
    if (room.state !== 'ready') {
      fail(`through the locked room: ${room.reason}`);
    } else {
      try {
        const now = await viaApp(room.registry, room.options);
        const problems = [];
        for (const [role, ca, cb] of [['category server', before.category, now.category], ['planner server', before.planner, now.planner]]) {
          if (!isDeepStrictEqual(ca, cb)) problems.push(`${role} request ${ca.findIndex((c, j) => !isDeepStrictEqual(c, cb[j]))} of ${ca.length} differs`);
        }
        const differ = cases.filter((_, i) => !isDeepStrictEqual(before.turns[i], now.turns[i]));
        if (differ.length) problems.push(`${differ.length} of ${cases.length} turns differ, first "${String(differ[0]).slice(0, 50)}"`);
        if (problems.length) fail(`through the locked room: ${problems.join('; ')}`);
        else pass(`through the locked room: ${before.category.length} category and ${before.planner.length} planner requests and ${cases.length} turns identical to the app's stack before it`);
      } finally {
        room.close();
      }
    }
  } finally {
    await pack.cleanup();
  }

  console.log(failures.length ? `\n  ${failures.length} problem(s) — do not start the model runs.\n` : '\n  the pack asks exactly what this checkout asks. Clear to run the models.\n');
  process.exit(failures.length ? 1 : 0);
}

await main();
