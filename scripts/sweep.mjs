#!/usr/bin/env node
/* sweep.mjs — set the router's two constants by measurement.
 *
 * The registry's own examples cannot tune a threshold: they ARE the index, so
 * they score 0.65–0.97 and every constant looks excellent. scripts/holdout.mjs
 * holds phrasings that appear in no skill's examples, and this sweeps
 * (coverageFloor, t_skill) against the TUNING half of those plus the no-skill
 * set. The grading half is not imported here on purpose — gate.mjs measures
 * against phrasings these constants have never seen.
 *
 * The objective weights the three outcomes by how much they actually cost:
 *   routed correctly   +1   the user gets a checked answer
 *   declined a valid Q  −1   annoying, but honest and recoverable
 *   ROUTED WRONGLY      −3   a confident answer from the wrong skill
 *   accepted a no-skill −3   a computed answer to "I had a rough day"
 * The two −3s are the failures §3 exists to prevent, so they cost three times
 * what a shrug costs. */

import entries from '../skills/index.js';
import { buildRegistry } from '../src/registry.js';
import { LexicalRouter } from '../src/router.js';
import { HOLDOUT_TUNE } from './holdout.mjs';
import { NO_SKILL_MESSAGES } from './no-skill-set.mjs';

const router = new LexicalRouter(buildRegistry(entries));
const rows = [];

for (let floor = 0.30; floor <= 1.0001; floor += 0.10) {
  router.coverageFloor = Number(floor.toFixed(2));
  const holdout = HOLDOUT_TUNE.map(([msg, want]) => {
    const c = router.route(msg).candidates;
    return { want, top: c[0]?.name, score: c[0]?.score ?? 0, rank: c.findIndex(x => x.name === want) };
  });
  const noSkill = NO_SKILL_MESSAGES.map(m => router.route(m).candidates[0]?.score ?? 0);

  for (let t = 0.10; t <= 0.75; t += 0.025) {
    const right = holdout.filter(h => h.top === h.want && h.score >= t).length;
    const wrong = holdout.filter(h => h.top !== h.want && h.score >= t).length;
    const declined = holdout.length - right - wrong;
    const accepted = noSkill.filter(s => s >= t).length;
    rows.push({
      floor: router.coverageFloor, t: Number(t.toFixed(3)),
      right, wrong, declined, accepted,
      objective: right - declined - 3 * wrong - 3 * accepted,
      recall5: holdout.filter(h => h.rank >= 0 && h.rank < 5).length
    });
  }
}

rows.sort((a, b) => b.objective - a.objective || b.right - a.right);
console.log('\n  floor  t_skill  right  wrong  declined  no-skill-accepted  score');
for (const r of rows.slice(0, 10)) {
  console.log(`  ${r.floor.toFixed(2)}   ${r.t.toFixed(3)}    ${String(r.right).padStart(2)}     ${String(r.wrong).padStart(2)}      ${String(r.declined).padStart(2)}          ${String(r.accepted).padStart(2)}            ${r.objective}`);
}
const b = rows[0];
console.log(`\n  best: coverageFloor ${b.floor}, t_skill ${b.t}`);
console.log(`  of ${HOLDOUT_TUNE.length} unseen phrasings: ${b.right} answered by the right skill, ${b.wrong} by the wrong one, ${b.declined} declined`);
console.log(`  of ${NO_SKILL_MESSAGES.length} no-skill messages: ${b.accepted} wrongly accepted`);
console.log(`  recall@5 ${b.recall5}/${HOLDOUT_TUNE.length} (${(b.recall5 / HOLDOUT_TUNE.length * 100).toFixed(0)}%) — what a planner would see\n`);
