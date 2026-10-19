#!/usr/bin/env node
/* calibrate.mjs — §3.1: "t_skill is calibrated per model, not shared."
 *
 * Prints the two score distributions the threshold sits between: the score the
 * CORRECT skill gets on messages that should route, and the top score anything
 * gets on messages that should not. Run it after adding skills; if the bands
 * overlap, the registry needs better examples, not a nudged constant. */

import entries from '../skills/index.js';
import { buildRegistry } from '../src/registry.js';
import { LexicalRouter } from '../src/router.js';
import { NO_SKILL_MESSAGES } from './no-skill-set.mjs';

const registry = buildRegistry(entries);
const router = new LexicalRouter(registry);

const hits = [];
for (const s of registry.routable()) {
  for (const ex of s.examples || []) {
    const c = router.route(ex.text).candidates.find(x => x.name === s.name);
    hits.push({ score: c ? c.score : 0, skill: s.name, text: ex.text });
  }
}
const misses = NO_SKILL_MESSAGES.map(m => {
  const top = router.route(m).candidates[0];
  return { score: top ? top.score : 0, skill: top ? top.name : '—', text: m };
});

const pct = (arr, p) => {
  const v = arr.map(x => x.score).sort((a, b) => a - b);
  return v[Math.min(v.length - 1, Math.floor(p * v.length))] ?? 0;
};

console.log(`\n  backend: ${router.name}`);
console.log(`  current t_skill: ${router.threshold}\n`);
console.log(`  SHOULD route (${hits.length} registry examples)`);
console.log(`    p05 ${pct(hits, 0.05).toFixed(3)}   p25 ${pct(hits, 0.25).toFixed(3)}   median ${pct(hits, 0.5).toFixed(3)}`);
console.log(`    lowest: ${hits.slice().sort((a, b) => a.score - b.score).slice(0, 3).map(h => `${h.score.toFixed(3)} ${h.skill}`).join(' · ')}`);
console.log(`\n  SHOULD NOT route (${misses.length} hand-written no-skill messages)`);
console.log(`    median ${pct(misses, 0.5).toFixed(3)}   p75 ${pct(misses, 0.75).toFixed(3)}   max ${pct(misses, 1).toFixed(3)}`);
console.log(`    highest: ${misses.slice().sort((a, b) => b.score - a.score).slice(0, 5).map(h => `${h.score.toFixed(3)} ${h.skill} "${h.text.slice(0, 28)}"`).join('\n              ')}`);

let best = null;
for (let t = 0.05; t <= 0.95; t += 0.005) {
  const recall = hits.filter(h => h.score >= t).length / hits.length;
  const precision = misses.filter(m => m.score < t).length / misses.length;
  if (recall >= 0.95 && precision >= 0.90) {
    const f = 2 * recall * precision / (recall + precision);
    if (!best || f > best.f) best = { t: Number(t.toFixed(3)), recall, precision, f };
  }
}
console.log(best
  ? `\n  §8 targets met (recall ≥ .95, no-skill precision ≥ .90) at t_skill = ${best.t}\n    recall ${(best.recall * 100).toFixed(1)}%  ·  precision ${(best.precision * 100).toFixed(1)}%\n`
  : '\n  NO threshold satisfies both §8 targets. The bands overlap — fix the examples, not the constant.\n');
