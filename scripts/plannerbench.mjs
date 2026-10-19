#!/usr/bin/env node
/* plannerbench.mjs — does a small model, prompted well, beat the JS baseline?
 *
 * §11 calls the adapter "the weak link, and the part that doesn't exist", and
 * §9 Phase 5 is where it gets trained. Before any of that is worth doing, one
 * question needs answering: can a 1–4B model do this job from a PROMPT alone?
 * If it can, the adapter is an optimisation — less context, fewer tokens,
 * faster — rather than the thing the architecture stands or falls on.
 *
 * This measures exactly that, on the same holdout the router is graded against
 * (scripts/holdout.mjs, 101 phrasings that appear in no skill's examples) plus
 * the 25 no-skill messages. It compares three configurations end to end:
 *
 *   js       router top-1 + the JS extractor        — what ships today
 *   llm      router top-5 → LLM planner             — §3.2 as specified
 *   llm+ex   the same, with the JS extractor still repairing missing args
 *
 * "Answered" means the whole pipeline produced a correct-skill reply with
 * valid arguments — not that the model emitted plausible JSON. A plan that
 * names the right skill and then fails validation is not a success, and
 * counting it as one is how these numbers get flattering.
 *
 * Usage: node scripts/plannerbench.mjs [--model NAME] [--no-fewshot] [--limit N]
 */

import { buildRegistry } from '../src/registry.js';
import { LexicalRouter } from '../src/router.js';
import { jsExtractor } from '../src/extractor.js';
import { llamaServer, devKeyHeaders } from '../src/llm.js';
import { pigeonServer } from './lib/pigeon-serve.mjs';
import { llmPlanner } from '../src/planner.js';
import { runTurn, MODES } from '../src/turn.js';
import { messageCarriesData } from '../src/executor.js';
import { HOLDOUT } from './holdout.mjs';
import { NO_SKILL_MESSAGES } from './no-skill-set.mjs';
import { VARIANTS, plannerOptions, declineOptions, asksOptions } from './prompt-variants.mjs';
import { categoryRouter, CATEGORY_CONFIDENCE, FALLBACK_FLOOR, WIDENING } from '../src/category-router.js';
import { siblingCheck, declineCheck, asksCheck } from '../src/verify.js';
import { llmTieBreak } from '../src/tiebreak.js';
import { writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { loadPigeon } from './lib/pigeon-load.mjs';
import './lib/apikey.mjs'; // the model servers' key → PIGEON_API_KEY

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const LIMIT = Number(opt('--limit', '0')) || Infinity;
/* --messages <file.json>: only these messages (a JSON array), for replaying a
   run's misses; --trace keeps each turn's plan, ask and errors in the record.
   A diagnostic, not a bench run: its counts are of the subset. */
const ONLY_MESSAGES = opt('--messages', null) ? new Set(JSON.parse((await import('node:fs')).readFileSync(opt('--messages', null), 'utf8'))) : null;
const TRACE = flag('--trace');

/* --pigeon <file>: Patch as a sealed skill pack — his skills, prompts and
   tunables all come out of the file instead of this checkout. A --prompt
   variant may override his prompts on top of it (the planner's base
   experiment); --tiebreak may not be combined with it. */
const PIGEON = opt('--pigeon', null);
if (PIGEON && flag('--tiebreak')) {
  console.error('--pigeon cannot be combined with --tiebreak');
  process.exit(1);
}
const pack = PIGEON ? await loadPigeon(PIGEON) : null;
const entries = pack ? pack.entries : (await import('../skills/index.js')).default;
const registry = buildRegistry(entries);
/* --k sets how many candidates the router hands the planner. It is the ceiling
   on the whole run: a skill outside this list cannot be chosen by anything. */
const K = Number(opt('--k', '0')) || undefined;
/* --prompt <name> swaps the planner's system prompt and few-shot examples for
   one of the variants, so the prompt can be measured rather than argued about. */
const VARIANT = opt('--prompt', null);
if (VARIANT && !VARIANTS[VARIANT]) { console.error(`unknown prompt variant "${VARIANT}" — have: ${Object.keys(VARIANTS).join(', ')}`); process.exit(1); }
/* --router category swaps the lexical router for the model-first one, so both
   are graded by the same harness against the same questions. */
const ROUTER = opt('--router', 'lexical');
const extractor = jsExtractor(registry);
/* Declared before the router: the category router consults the model to choose
   a category, so it needs `complete` at construction. */
/* --engine <url>: every ask goes to Patch's Pigeons through pigeon-serve,
   the way the app asks them with the switch on (D84). --as-app: the server
   is asked as the app asks it, which passes no `think` (so a Qwen3.5 server
   thinks for every ask, the asks check included). */
const ENGINE = opt('--engine', null);
const AS_APP = flag('--as-app');
const serverComplete = (base) => {
  const c = llamaServer({ base });
  if (!AS_APP) return c;
  const asApp = ({ think, ...rest }) => { void think; return c(rest); };
  return Object.assign(asApp, { base: c.base, transport: c.transport, health: c.health, model: c.model });
};
/* --planner-pigeon <id>: with --engine, every planner ask goes to this one
   Pigeon in the nest instead of the four prompted ones. */
const PLANNER_PIGEON = opt('--planner-pigeon', null);
if (PLANNER_PIGEON && !ENGINE) {
  console.error('--planner-pigeon needs --engine');
  process.exit(1);
}
const complete = ENGINE ? pigeonServer({ base: ENGINE, planner: PLANNER_PIGEON }) : serverComplete(opt('--base', 'http://127.0.0.1:8099'));
/* --category-base points the category step at its own server, so a small trained
   adapter can pick the neighbourhood while a larger model still writes the plan.
   Defaults to the planner's server, which is the single-model arrangement. */
const CATEGORY_BASE = opt('--category-base', null);
const categoryComplete = ENGINE ? complete : CATEGORY_BASE ? serverComplete(CATEGORY_BASE) : complete;
const GATES = { minConfidence: Number(opt('--min-confidence', CATEGORY_CONFIDENCE)), fallbackFloor: Number(opt('--fallback-floor', FALLBACK_FLOOR)) };
const router = ROUTER === 'category'
  ? categoryRouter({ registry, complete: categoryComplete, maxCandidates: K ?? 20,
                     trained: flag('--trained'),
                     /* Both gates default to the app's own (src/stack.js), so a
                        run without flags is the app. Until 2026-10-12 they
                        defaulted to 0, and every engine-era number of record
                        before then was benched with both off (NOTES). */
                     minConfidence: GATES.minConfidence,
                     /* --fallback-floor: when the adapter refuses AND word
                        matching scores below this, decline instead of handing
                        the planner a shortlist. Measured, not assumed. */
                     fallbackFloor: GATES.fallbackFloor,
                     /* Widening A and B, on as in the app unless switched off. */
                     twins: flag('--no-twins') ? null : WIDENING.twins,
                     keepCategory: flag('--no-keep-category') ? false : WIDENING.keepCategory,
                     maxListed: flag('--no-cap') ? Infinity : WIDENING.maxListed,
                     capKeepsToday: flag('--cap-unscored-first') ? false : WIDENING.capKeepsToday,
                     ...(pack ? pack.routerOptions : {}) })
  : new LexicalRouter(registry, { ...(pack ? pack.routerOptions.lexicalOptions : {}), ...(K ? { k: K } : {}) });

if (CATEGORY_BASE && !(await categoryComplete.health())) {
  console.error('\n  No llama-server on ' + categoryComplete.base + ' for the category step.\n');
  process.exit(1);
}
if (!(await complete.health())) {
  console.error('\n  No llama-server on ' + complete.base + '. Start one first.\n');
  process.exit(1);
}
const modelName = await complete.model();
/* The packed adapter must be the one the category server is actually wearing —
   otherwise the "from the file" run measures this checkout's adapter. */
if (pack && CATEGORY_BASE && !ENGINE) {
  const loaded = await fetch(`${CATEGORY_BASE}/lora-adapters`, { headers: await devKeyHeaders() }).then(r => r.json()).catch(() => null);
  const worn = Array.isArray(loaded) ? loaded.find(a => Number(a.scale) === 1) ?? loaded[0] : null;
  const wornSha = worn?.path ? createHash('sha256').update(await readFile(worn.path)).digest('hex') : null;
  if (wornSha !== pack.adapterSha256) {
    console.error(`\n  The category server is not wearing the packed adapter (${worn?.path ?? 'none reported'}). Restart it with the file's adapter: ${pack.adapterPath}\n`);
    process.exit(1);
  }
}
const planner = llmPlanner({ complete, registry, fewShot: !flag('--no-fewshot'), runway: flag('--runway-auto') ? 'auto' : flag('--runway'), ranked: flag('--ranked'), ...(pack ? pack.plannerOptions : {}), ...plannerOptions(VARIANT ? VARIANTS[VARIANT] : null) });
/* --trust-router hands a confident router's single pick to the planner instead
   of the whole shortlist; --only <key> scores one configuration rather than all
   three, which is a third of the wall-clock when only the shipped path matters. */
const TRUST = flag('--trust-router');
/* --fallback-empty: an empty plan from the planner falls back to the router's
   actionable pick (§11 single-skill mode) instead of a decline. A pack's own
   tunables.turn.fallback_on_empty is used when the flag is absent. */
const FALLBACK = flag('--fallback-empty') || Boolean(pack?.turnOptions?.fallbackOnEmpty);
/* --verify: the sibling check after a single-step plan. --second-look: the
   selection question after a decline. Both use the planner's own server. */
const VERIFY = flag('--verify');
const SECOND = flag('--second-look');
/* --ground-check: suppress a single-step plan that takes nothing from the
   message when the adapter was under full confidence. See turn.js. */
const GROUND = flag('--ground-check');
/* --verify-base: a separate server for the sibling check — the 1.5B carrying
   the sibling adapter — asked in the trained (bare, name-only) form. */
const VERIFY_BASE = opt('--verify-base', null);
const ONLY = opt('--only', null);
/* --tiebreak asks one extra constrained question when the planner's pick has a
   close same-category twin. Measured on main and left off; the seam stays. */
const tieBreak = flag('--tiebreak') ? llmTieBreak({ complete, registry }) : null;

const ctx = {
  now: '2026-09-01T09:00:00Z', timezone: 'UTC', locale: 'en-GB',
  units: 'metric', webEnabled: false, confirmBeforeNetwork: true
};

const verifyComplete = VERIFY_BASE ? llamaServer({ base: VERIFY_BASE }) : complete;
if (VERIFY_BASE && !(await verifyComplete.health())) { console.error(`\n  No llama-server on ${VERIFY_BASE} for the sibling check.\n`); process.exit(1); }
const verify = VERIFY ? siblingCheck({ complete: verifyComplete, registry, router, trained: Boolean(VERIFY_BASE), ...(pack ? pack.siblingOptions : {}) }) : null;
const secondLook = SECOND ? declineCheck({ complete, registry, ...(pack ? pack.declineOptions : {}), ...declineOptions(VARIANT ? VARIANTS[VARIANT] : null) }) : null;
/* --asks: veto a plan for a message that was not asking for anything. Asked
   alongside the planner, so it costs no wall-clock. */
const asks = flag('--asks') ? asksCheck({ complete, ...(pack ? pack.asksOptions : {}), ...asksOptions(VARIANT ? VARIANTS[VARIANT] : null) }) : null;
const CONFIGS = [
  { key: 'js', label: 'router top-1 + JS extractor', deps: { extractor } },
  { key: 'llm', label: 'router top-5 → LLM planner', deps: { planner, trustRouter: TRUST, fallbackOnEmpty: FALLBACK, verify, secondLook, groundCheck: GROUND, asksCheck: asks } },
  { key: 'llm+ex', label: 'LLM planner + JS extractor', deps: { planner, extractor, trustRouter: TRUST, fallbackOnEmpty: FALLBACK, verify, secondLook, groundCheck: GROUND, asksCheck: asks } }
].filter(c => !ONLY || c.key === ONLY);

/* One message through one configuration. `want` is null for a no-skill
   message, where the correct outcome is declining rather than answering. */
const TRACED = new Map();
async function trial (message, want, deps) {
  const t0 = Date.now();
  let turn;
  if (TRACE) planner.lastCall = null;
  try {
    turn = await runTurn(message, { registry, router, ctx, tieBreak, ...deps });
  } catch (e) {
    return { outcome: 'error', detail: e.message, ms: Date.now() - t0 };
  }
  const ms = Date.now() - t0;
  const picked = turn.results?.[0]?.skill ?? turn.plan?.steps?.[0]?.skill ?? null;
  /* The verifier's own ledger: fired, switched, and whether a switch landed on
     the wanted skill — so its help and its harm are both counted. */
  if (turn.verified) {
    const v = turn.verified;
    VLOG.push({ message, want, draft: v.draft, chosen: v.chosen, lexicalTop: v.lexicalTop ?? null, alternatives: v.alternatives, secondLook: Boolean(v.secondLook), replanned: v.replanned });
    VSTATS.fired++;
    if (v.secondLook) { VSTATS.rescued++; if (want && v.chosen === want) VSTATS.rescuedRight++; else if (want) VSTATS.rescuedWrong++; else VSTATS.rescuedLeak++; }
    else if (v.chosen !== v.draft) { VSTATS.switched++; if (want && v.chosen === want) VSTATS.switchedRight++; else if (want && v.draft === want) VSTATS.switchedWrong++; }
  }

  if (TRACE) {
    const failed = (turn.results || []).filter(r => !r.ok).map(r => ({ skill: r.skill, error: r.error }));
    TRACED.set(message, { plannerTokens: planner.lastCall?.tokens ?? null, plannerChars: planner.lastCall?.raw?.length ?? null, plan: turn.plan ?? null, ask: turn.ask ? { field: turn.ask.field, untraceable: turn.ask.untraceable, why: turn.ask.why, dropped: turn.ask.dropped } : null, failed });
  }
  if (want === null) {
    return { outcome: picked ? 'wrongly-answered' : 'declined', picked, ms };
  }
  if (turn.mode === MODES.NO_SKILL) return { outcome: 'declined', picked: null, ms };
  if (picked !== want) return { outcome: 'wrong-skill', picked, ms };
  /* The right skill asked for a field the message did not contain: the input
     audit dropped a value the planner had invented. That is the correct
     outcome — the alternative was answering from made-up data — and it is
     scored as such, separately, so the number can be read either way. */
  /* D92 (bench rule, 2026-10-10): an ask is also honest when the message
     carries no data at all, whatever the field is called — the app's own test
     for a payload field, applied to every field. Before D92 only payload-named
     fields counted, so leaving a value out of "does this card number pass the
     checksum" scored a miss while inventing one scored a pass. Digits count
     as data (Kevin, 2026-10-11): "seed 9" or "4.5 by 3.2 m" is something the
     plan could have used. */
  if (turn.ask && (turn.ask.untraceable || (!messageCarriesData(message) && !/\d/.test(message)))) return { outcome: 'asked-honest', picked, ms };
  if (turn.ask) return { outcome: 'asked', picked, ms };
  /* The bench runs with the web OFF, so a web skill cannot succeed here. The
     planner choosing it for a question of fact IS the correct plan, and the
     executor refusing to send the request is the correct outcome for a switch
     that is off. Scored as its own kind, counted as correct, so the two web
     skills stop being charged to the planner as failures. */
  if (turn.results.length === 1 && !turn.results[0].ok && turn.results[0].error?.code === 'NETWORK_OFF') {
    return { outcome: 'network-off', picked, ms };
  }
  if (!turn.results.length || !turn.results.every(r => r.ok)) {
    return { outcome: 'failed', picked, detail: turn.results[0]?.error?.message, ms };
  }
  return { outcome: 'answered', picked, ms };
}

/* --set <file>: a twin set (bench/twin-colist.json shape) in place of the
   holdout and the no-skill messages, scored the same way. */
const SET = opt('--set', null);
const cases = SET
  ? JSON.parse((await import('node:fs')).readFileSync(SET, 'utf8')).pairs.flatMap(p => p.messages.map((m, i) => [m, p.twins[i]]))
  : [
    ...HOLDOUT.slice(0, LIMIT).map(([m, w]) => [m, w]),
    ...NO_SKILL_MESSAGES.slice(0, LIMIT).map(m => [m, null])
  ].filter(([m]) => !ONLY_MESSAGES || ONLY_MESSAGES.has(m));

console.log(`\n  model: ${modelName}   few-shot: ${!flag('--no-fewshot')}   shortlist: ${router.k ?? K ?? 20}   prompt: ${VARIANT ?? 'shipped'}${flag('--runway') ? '+runway' : ''}${flag('--runway-auto') ? '+runway-auto' : ''}${flag('--ranked') ? '+ranked' : ''}   router: ${ROUTER}${TRUST ? '+trusted' : ''}${FALLBACK ? '+fallback-empty' : ''}${VERIFY ? (VERIFY_BASE ? '+verify(adapter)' : '+verify') : ''}${SECOND ? '+second-look' : ''}${GROUND ? '+ground-check' : ''}`);
console.log(`  cases: ${cases.filter(c => c[1]).length} holdout + ${cases.filter(c => !c[1]).length} no-skill\n`);

const VLOG = [];
const VSTATS = { fired: 0, switched: 0, switchedRight: 0, switchedWrong: 0, rescued: 0, rescuedRight: 0, rescuedWrong: 0, rescuedLeak: 0 };
const results = {};
for (const cfg of CONFIGS) {
  const tally = { answered: 0, 'wrong-skill': 0, declined: 0, asked: 0, 'asked-honest': 0, 'network-off': 0, failed: 0, 'wrongly-answered': 0, error: 0 };
  const misses = [];
  const outcomes = [];
  let total = 0;
  for (const [message, want] of cases) {
    const r = await trial(message, want, cfg.deps);
    outcomes.push({ message, want: want ?? '(none)', outcome: r.outcome, got: r.picked ?? null, ms: r.ms, ...(TRACE ? { trace: TRACED.get(message) } : {}) });
    tally[r.outcome] = (tally[r.outcome] ?? 0) + 1;
    total += r.ms;
    if (want && !['answered', 'asked-honest', 'network-off'].includes(r.outcome)) misses.push({ message, want, ...r });
    if (!want && r.outcome === 'wrongly-answered') misses.push({ message, want: '(none)', ...r });
  }
  results[cfg.key] = { tally, misses, outcomes, avgMs: Math.round(total / cases.length) };
  const n = cases.filter(c => c[1]).length;
  console.log(`  ${cfg.label}`);
  console.log(`    answered right  ${String(tally.answered).padStart(3)} / ${n}   (${(tally.answered / n * 100).toFixed(0)}%)`);
  console.log(`    wrong skill     ${String(tally['wrong-skill']).padStart(3)}`);
  console.log(`    asked for a arg ${String(tally.asked).padStart(3)}`);
  console.log(`    asked, honest   ${String(tally['asked-honest']).padStart(3)}   (right skill; the message lacked the value the planner had invented)`);
  console.log(`    web, switch off ${String(tally['network-off']).padStart(3)}   (right web skill; the bench keeps the web off)`);
  const correct = tally.answered + tally['asked-honest'] + tally['network-off'];
  console.log(`    correct incl. honest asks ${String(correct).padStart(3)} / ${n}   (${(correct / n * 100).toFixed(0)}%)`);
  console.log(`    skill failed    ${String(tally.failed).padStart(3)}`);
  console.log(`    declined        ${String(tally.declined - tally['wrongly-answered'] >= 0 ? tally.declined : tally.declined).padStart(3)}`);
  console.log(`    no-skill leaks  ${String(tally['wrongly-answered']).padStart(3)} / ${NO_SKILL_MESSAGES.slice(0, LIMIT).length}`);
  console.log(`    avg latency     ${results[cfg.key].avgMs}ms`);
  if (VERIFY || SECOND) {
    console.log(`    verifier        fired ${VSTATS.fired} · switched ${VSTATS.switched} (→right ${VSTATS.switchedRight}, →wrong ${VSTATS.switchedWrong}) · rescued declines ${VSTATS.rescued} (right ${VSTATS.rescuedRight}, wrong ${VSTATS.rescuedWrong}, leaked ${VSTATS.rescuedLeak})`);
  }
  console.log('');
}

const worst = results['llm+ex'] ?? results.llm;
if (worst?.misses.length) {
  console.log('  where the LLM+extractor path still misses:');
  for (const m of worst.misses.slice(0, 14)) {
    console.log(`    ${m.outcome.padEnd(16)} want ${String(m.want).padEnd(22)} got ${String(m.picked ?? '—').padEnd(22)} "${m.message.slice(0, 40)}"`);
  }
  if (worst.misses.length > 14) console.log(`    … and ${worst.misses.length - 14} more — pass --misses <path> to write them all out`);
  console.log('');
}

/* The printed list is deliberately short, but choosing a routing architecture
   needs every miss, not the first fourteen. --misses writes the lot as JSON,
   each tagged with the category of the skill that was wanted and the one that
   was picked — the question being whether confusions are between neighbours in
   one category (which a category filter cannot help with) or across them. */
const vlogPath = opt('--verifier-log', null);
if (vlogPath && VLOG.length) { await writeFile(vlogPath, JSON.stringify(VLOG, null, 2)); console.log(`  ${VLOG.length} verifier events written to ${vlogPath}`); }
/* --record <path> writes the whole run as one JSON document — tally, misses,
   latency, verifier stats, and enough provenance (HEAD, host, model, flags) to
   attribute the number later. scripts/benchqueue.mjs reads these to build the
   comparison table; nothing is hand-copied. */
const recordPath = opt('--record', null);
if (recordPath) {
  const { execSync } = await import('node:child_process');
  const { hostname, platform, arch } = await import('node:os');
  let head = null;
  try { head = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim(); } catch { /* not a checkout */ }
  const categoryOf = (name) => registry.skill(name)?.category ?? null;
  const record = {
    date: new Date().toISOString(), head, host: `${platform()}-${arch()}-${createHash('sha256').update(hostname()).digest('hex').slice(0, 6)}`, platform: `${platform()}-${arch()}`,
    model: modelName, prompt: VARIANT ?? 'shipped', flags: argv.filter(a => a !== '--record' && a !== recordPath),
    ...(ROUTER === 'category' ? { routerGates: GATES, widening: { twins: !flag('--no-twins'), keepCategory: !flag('--no-keep-category'), maxListed: flag('--no-cap') ? null : WIDENING.maxListed, capKeepsToday: !flag('--cap-unscored-first') } } : {}),
    holdout: HOLDOUT.slice(0, LIMIT).length, noSkill: NO_SKILL_MESSAGES.slice(0, LIMIT).length,
    configs: Object.fromEntries(Object.entries(results).map(([k, r]) => [k, {
      tally: r.tally,
      correct: r.tally.answered + r.tally['asked-honest'] + (r.tally['network-off'] || 0),
      leaks: r.tally['wrongly-answered'],
      siblings: r.misses.filter(m => m.outcome === 'wrong-skill' && m.want !== '(none)' && categoryOf(m.want) === categoryOf(m.picked)).length,
      avgMs: r.avgMs,
      misses: r.misses.map(m => ({ outcome: m.outcome, message: m.message, want: m.want, got: m.picked ?? null })),
      /* Every case, not only the misses: two runs are compared case by case,
         and a turn that moved from answered to asked is invisible in a tally. */
      outcomes: r.outcomes
    }])),
    verifier: (VERIFY || SECOND) ? VSTATS : null,
    pigeon: pack ? { path: PIGEON, fileSha256: pack.fileSha256, keyId: pack.keyId, version: pack.manifest.version, adapterSha256: pack.adapterSha256, head: pack.manifest.source?.head ?? null } : null
  };
  await writeFile(recordPath, JSON.stringify(record, null, 2));
  console.log(`  run recorded to ${recordPath}`);
}
const missesPath = opt('--misses', null);
if (missesPath && worst) {
  const categoryOf = (name) => registry.skill(name)?.category ?? null;
  const rows = worst.misses.map((m) => ({
    outcome: m.outcome,
    message: m.message,
    want: m.want,
    got: m.picked ?? null,
    wantCategory: categoryOf(m.want),
    gotCategory: m.picked ? categoryOf(m.picked) : null,
    sameCategory: Boolean(m.picked) && categoryOf(m.want) !== null && categoryOf(m.want) === categoryOf(m.picked)
  }));
  await writeFile(missesPath, JSON.stringify(rows, null, 2));
  console.log(`  ${rows.length} misses written to ${missesPath}\n`);
}
if (pack) await pack.cleanup();
