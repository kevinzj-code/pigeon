#!/usr/bin/env node
/* routerbench.mjs — Patch's router alone: what it puts in front of the planner.
 *
 * No planner runs. Each message is asked of the router Pigeon once (through
 * pigeon-serve), and every router configuration below is scored from the same
 * answers, so the configurations differ only in the shortlist rule:
 *
 *   gates            the app's confidence gate and word floor, nothing widened
 *   +A twins         gates, and a listed skill's twin listed beside it
 *   +B keep category gates, and no small-score drop inside the category
 *   +A+B uncapped    both, as first measured
 *   +A+B cap 24 unscored first   cut to 24, unscored non-twins first
 *   +A+B cap 24 (app)            cut to 24, never cutting what today's rule lists
 *
 * Measured, per configuration:
 *   right listed     the wanted skill is on the planner's shortlist (of 308)
 *   mean shortlist   over the 308
 *   leak exposure    no-skill messages (of 100) given any shortlist, and its mean size
 *   co-listed        bench/twin-colist.json messages with BOTH twins listed
 *
 *   node scripts/routerbench.mjs --pigeon pack/patch.pigeon --engine http://127.0.0.1:8150 [--record out.json]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { buildRegistry } from '../src/registry.js';
import { categoryRouter, CATEGORY_CONFIDENCE, FALLBACK_FLOOR, WIDENING } from '../src/category-router.js';
import { HOLDOUT } from './holdout.mjs';
import { NO_SKILL_MESSAGES } from './no-skill-set.mjs';
import { loadPigeon } from './lib/pigeon-load.mjs';
import { pigeonServer } from './lib/pigeon-serve.mjs';

const argv = process.argv.slice(2);
const opt = (n, d = null) => { const i = argv.indexOf(n); return i > -1 && argv[i + 1] ? argv[i + 1] : d; };
const ENGINE = opt('--engine');
if (!ENGINE) { console.error('--engine <pigeon-serve url> is required'); process.exit(2); }
const PIGEON = opt('--pigeon');
const pack = PIGEON ? await loadPigeon(PIGEON) : null;
const registry = buildRegistry(pack ? pack.entries : (await import('../skills/index.js')).default);
const twinSet = JSON.parse(readFileSync(new URL('../bench/twin-colist.json', import.meta.url), 'utf8'));

/* One router answer per message, whatever the configuration. */
const served = pigeonServer({ base: ENGINE });
if (!(await served.health())) { console.error(`no pigeon-serve on ${ENGINE}`); process.exit(1); }
const answers = new Map();
const complete = async (req) => {
  const key = req.pigeon ? req.pigeon.input : JSON.stringify(req.messages);
  if (!answers.has(key)) answers.set(key, await served(req));
  return answers.get(key);
};

const base = { registry, complete, trained: true, maxCandidates: 20, minConfidence: CATEGORY_CONFIDENCE, fallbackFloor: FALLBACK_FLOOR, ...(pack ? pack.routerOptions : {}) };
const CONFIGS = {
  gates: categoryRouter(base),
  '+A twins': categoryRouter({ ...base, twins: WIDENING.twins }),
  '+B keep category': categoryRouter({ ...base, keepCategory: true }),
  '+A+B uncapped': categoryRouter({ ...base, ...WIDENING, maxListed: Infinity }),
  '+A+B cap 24 unscored first': categoryRouter({ ...base, ...WIDENING, capKeepsToday: false }),
  '+A+B cap 24 (app)': categoryRouter({ ...base, ...WIDENING })
};

const listed = async (router, message) => (await router.route(message)).forPlanner.map(c => c.name);
const mean = (xs) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length * 10) / 10 : 0);

const out = {};
const rows = { holdout: [], noSkill: [], twins: [] };
for (const [name, router] of Object.entries(CONFIGS)) {
  const h = [];
  for (const [message, want] of HOLDOUT) {
    const l = await listed(router, message);
    h.push({ message, want, listed: l.includes(want), size: l.length });
  }
  const n = [];
  for (const m of NO_SKILL_MESSAGES) { const l = await listed(router, m); n.push({ message: m, size: l.length, shortlist: l }); }
  const t = [];
  for (const p of twinSet.pairs) {
    for (const [i, m] of p.messages.entries()) {
      const l = await listed(router, m);
      t.push({ message: m, want: p.twins[i], other: p.twins[1 - i], wantListed: l.includes(p.twins[i]), coListed: p.twins.every(x => l.includes(x)), size: l.length });
    }
  }
  out[name] = {
    rightListed: h.filter(x => x.listed).length, of: h.length,
    meanShortlist: mean(h.map(x => x.size)),
    leakExposure: n.filter(x => x.size > 0).length, ofNoSkill: n.length,
    meanNoSkillShortlist: mean(n.map(x => x.size)),
    twinWantListed: t.filter(x => x.wantListed).length,
    twinCoListed: t.filter(x => x.coListed).length, ofTwin: t.length,
    meanTwinShortlist: mean(t.map(x => x.size))
  };
  rows.holdout.push({ config: name, misses: h.filter(x => !x.listed).map(x => `${x.message} → ${x.want}`) });
  rows.noSkill.push({ config: name, exposed: n.filter(x => x.size > 0).map(x => `${x.message} (${x.size})`) });
  rows.twins.push({ config: name, notCoListed: t.filter(x => !x.coListed).map(x => `${x.message} → ${x.want} / ${x.other}${x.wantListed ? '' : ' (wanted one missing)'}`) });
}

console.log('\n  router alone, gates on (confidence ' + CATEGORY_CONFIDENCE + ', word floor ' + FALLBACK_FLOOR + ')\n');
console.log('  config              right listed   mean list   no-skill given a list   mean   twin wanted listed   twin co-listed   mean');
for (const [k, v] of Object.entries(out)) {
  console.log(`  ${k.padEnd(18)}  ${String(v.rightListed).padStart(3)} / ${v.of}     ${String(v.meanShortlist).padStart(5)}       ${String(v.leakExposure).padStart(3)} / ${v.ofNoSkill}            ${String(v.meanNoSkillShortlist).padStart(4)}       ${String(v.twinWantListed).padStart(3)} / ${v.ofTwin}           ${String(v.twinCoListed).padStart(3)} / ${v.ofTwin}      ${v.meanTwinShortlist}`);
}
const REC = opt('--record');
if (REC) writeFileSync(REC, JSON.stringify({ date: new Date().toISOString(), engine: ENGINE, pigeon: PIGEON, summary: out, rows }, null, 1) + '\n');
if (pack) await pack.cleanup();
