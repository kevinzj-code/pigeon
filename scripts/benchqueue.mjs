#!/usr/bin/env node
/* benchqueue.mjs — hypotheses in, numbers out, git in between.
 *
 * A bench is 350-odd short, grammar-constrained model calls: twelve minutes on
 * the Mac, and while it runs both model servers are busy and nothing else can
 * be measured. Training, on the other hand, only runs on the Mac (MLX). So the
 * Mac writes hypotheses as JOBS, any machine with the two llama-servers runs
 * them — the Linux box, overnight — and the results come back as files that a
 * report reads. Nothing is hand-copied into a README.
 *
 *   bench/queue/<id>.json          a job: one change from control, and the
 *                                  rule that decides it, written BEFORE the run
 *   bench/results/<host>/<id>.json what plannerbench --record wrote, plus job
 *   (a job is done ON A HOST when that host has a result for it; the queue
 *    itself is shared by every host and never consumed)
 *   model/BENCH.md                 every result against its host's control
 *
 * THE ONE RULE ABOUT HOSTS. Metal and Vulkan do not produce identical logits,
 * so a number from one machine is not comparable to a number from the other.
 * Every batch carries a `control` job; a result is read against the most
 * recent control ON THE SAME HOST, never across. Linux decides keep/drop; the
 * Mac re-measures what is kept before anything ships.
 *
 *   node scripts/benchqueue.mjs --add --id k12 --flags "--k 12" \
 *        --hypothesis "…" --rule "correct >= control-4 and siblings < control"
 *   node scripts/benchqueue.mjs --status
 *   node scripts/benchqueue.mjs --run [--limit N] [--only-job id] [--keep-servers] [--again]
 *   node scripts/benchqueue.mjs --report
 *
 * Bash-safe: flags are passed to plannerbench as an ARRAY, never re-split by
 * a shell — a zsh word-split once ran a whole bench against the wrong router. */

import { spawn, execSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { arch, hostname, platform } from 'node:os';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BENCH = join(ROOT, 'bench');
const QUEUE = join(BENCH, 'queue');
const RESULTS = join(BENCH, 'results');
const TABLE = join(ROOT, 'model/BENCH.md');

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };

/* A host id that is stable, filesystem-safe, and says which GPU stack ran. */
/* One machine, one label — platform, architecture and six characters of the
   hostname's hash. Enough to tell two machines' results apart, without the
   machine's name (which is usually the owner's) going into a committed file. */
export const HOST = `${platform()}-${arch()}-${createHash('sha256').update(hostname()).digest('hex').slice(0, 6)}`;

/* The shipped configuration. Every job is this plus its own flags. */
export const BASE_FLAGS = [
  '--router', 'category', '--category-base', 'http://127.0.0.1:8101',
  '--trained', '--min-confidence', '0.80', '--only', 'llm+ex',
  '--runway-auto', '--second-look'
];

/* What a job may need beyond the two shipped servers. A need that cannot be
   met on this machine skips the job with a reason, rather than running it
   against the wrong thing. */
const NEEDS = {
  planner: () => true,
  category: () => existsSync(join(ROOT, 'model/pigeon-category.lora.gguf')),
  'sibling-v3': () => existsSync(join(ROOT, 'model/pigeon-sibling-v3.lora.gguf'))
};

/* Noise band on this bench, measured between identical runs. A delta inside
   it is reported as NOISE whatever the rule says. */
export const NOISE = { correct: 4, leaks: 2 };

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const listJobs = (dir) => existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith('.json')).sort().map(f => readJson(join(dir, f))) : [];

/* ── --add ──────────────────────────────────────────────────────────────── */
export function addJob ({ id, hypothesis, flags = [], prompt = null, needs = ['planner', 'category'], rule, reads = null }) {
  if (!id || !/^[a-z0-9][a-z0-9-]*$/.test(id)) throw new Error('a job needs a kebab-case --id');
  if (!hypothesis) throw new Error(`job ${id}: --hypothesis is what the result will be read against; write it`);
  if (!rule && id !== 'control') throw new Error(`job ${id}: --rule decides keep/drop and is written before the run, not after`);
  mkdirSync(QUEUE, { recursive: true });
  const job = { id, hypothesis, flags, prompt, needs, rule: rule || null, reads, added: new Date().toISOString().slice(0, 10) };
  const path = join(QUEUE, `${id}.json`);
  if (existsSync(path)) throw new Error(`job ${id} already exists`);
  writeFileSync(path, JSON.stringify(job, null, 2) + '\n');
  return job;
}

/* ── --run ──────────────────────────────────────────────────────────────── */
const up = async (port) => {
  try { const r = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1000) }); return r.ok; } catch { return false; }
};

async function ensureServers () {
  if (await up(8099) && await up(8101)) return null;
  console.log('  starting the model servers (scripts/models.mjs)…');
  /* Detached and unreferenced: the launcher is long-lived (it holds the two
     llama-servers), and with --keep-servers this process must be able to exit
     while it stays up. Killing it with SIGINT is what takes the servers down. */
  const child = spawn(process.execPath, [join(ROOT, 'scripts/models.mjs')], { stdio: 'ignore', detached: true });
  child.unref();
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline && !(await up(8099) && await up(8101))) await new Promise(r => setTimeout(r, 1000));
  if (!(await up(8099) && await up(8101))) {
    child.kill('SIGINT');
    throw new Error('the model servers did not come up — see scripts/models.mjs for the paths it expects on this machine');
  }
  return child;
}

function runBench (args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [join(ROOT, 'scripts/plannerbench.mjs'), ...args], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', d => { out += d; process.stdout.write(d); });
    child.stderr.on('data', d => { out += d; process.stderr.write(d); });
    child.on('close', code => resolve({ code, out }));
  });
}

export async function runQueue ({ limit = null, onlyJob = null, keepServers = false, again = false } = {}) {
  const outDir = join(RESULTS, HOST); mkdirSync(outDir, { recursive: true });
  /* Two machines share one queue. A job is done HERE when this host has a
     result for it; the other host still has it to run. --again re-runs. */
  const jobs = listJobs(QUEUE).filter(j => !onlyJob || j.id === onlyJob).filter(j => again || onlyJob || !existsSync(join(outDir, `${j.id}.json`)));
  if (!jobs.length) { console.log('  queue is empty'); return []; }
  /* control first, always: everything else is read against it. */
  jobs.sort((a, b) => (a.id === 'control' ? -1 : b.id === 'control' ? 1 : a.id.localeCompare(b.id)));
  let head = null; try { head = execSync('git rev-parse --short HEAD', { cwd: ROOT, encoding: 'utf8' }).trim(); } catch { /* not a checkout */ }
  const dirty = (() => { try { return execSync('git status --porcelain -- src skills scripts', { cwd: ROOT, encoding: 'utf8' }).trim().length > 0; } catch { return false; } })();
  if (dirty) console.log('  NOTE: src/, skills/ or scripts/ have uncommitted changes — results will be marked dirty');

  const servers = await ensureServers();
  const done = [];
  try {
    for (const job of jobs) {
      const unmet = (job.needs || []).filter(n => !(NEEDS[n] ? NEEDS[n]() : false));
      const resultPath = join(outDir, `${job.id}.json`);
      if (unmet.length) {
        console.log(`\n  ${job.id}: SKIPPED on ${HOST} — needs ${unmet.join(', ')}`);
        continue;
      }
      const args = [...BASE_FLAGS, ...(job.flags || []), ...(job.prompt ? ['--prompt', job.prompt] : []), ...(limit ? ['--limit', String(limit)] : []), '--record', resultPath];
      console.log(`\n  ── ${job.id} ── ${job.hypothesis}\n  plannerbench ${args.join(' ')}`);
      const t0 = Date.now();
      const { code, out } = await runBench(args);
      let record = null;
      if (code === 0 && existsSync(resultPath)) record = readJson(resultPath);
      const result = {
        job, host: HOST, head, dirty, limit, ran: new Date().toISOString(), wallMs: Date.now() - t0,
        ...(record ? { record } : { error: `plannerbench exited ${code}`, tail: out.split('\n').slice(-12).join('\n') })
      };
      writeFileSync(resultPath, JSON.stringify(result, null, 2) + '\n');
      done.push(result);
    }
  } finally {
    if (servers && !keepServers) servers.kill('SIGINT');
  }
  return done;
}

/* ── --report ───────────────────────────────────────────────────────────── */
const cfgOf = (r) => r.record && (r.record.configs['llm+ex'] || Object.values(r.record.configs)[0]);

/* The rule is a small expression over these names, evaluated with `control`
   bound to the control's numbers: "correct >= control.correct + 4 and leaks <=
   control.leaks". Written by a person, read by a person; this only turns the
   verdict into a word. */
export function verdict (rule, me, control) {
  if (!me) return 'ERROR';
  if (!control) return 'NO CONTROL';
  const dc = me.correct - control.correct;
  const dl = me.leaks - control.leaks;
  if (!rule) return Math.abs(dc) <= NOISE.correct && Math.abs(dl) <= NOISE.leaks ? 'NOISE' : (dc > 0 && dl <= NOISE.leaks ? 'BETTER' : 'WORSE');
  let ok;
  try {
    const expr = rule.replace(/\band\b/g, '&&').replace(/\bor\b/g, '||').replace(/\bnot\b/g, '!');
    /* eslint-disable-next-line no-new-func */
    ok = Function('m', 'control', `with (m) { return (${expr}); }`)(me, control);
  } catch (e) { return `RULE? (${e.message})`; }
  if (!ok) return 'DROP';
  return Math.abs(dc) <= NOISE.correct && Math.abs(dl) <= NOISE.leaks && !/latency|avgMs|siblings|declined/.test(rule) ? 'NOISE' : 'KEEP';
}

export function report ({ results = null } = {}) {
  const hosts = results ? Object.keys(results) : (existsSync(RESULTS) ? readdirSync(RESULTS).filter(h => !h.startsWith('.')).sort() : []);
  const lines = [];
  for (const host of hosts) {
    const rows = results ? results[host] : listJobs(join(RESULTS, host));
    const controls = rows.filter(r => r.job.id === 'control' && cfgOf(r)).sort((a, b) => b.ran.localeCompare(a.ran));
    const control = controls[0] ? { ...cfgOf(controls[0]), declined: cfgOf(controls[0]).tally.declined } : null;
    lines.push(`\n### ${host}${controls[0] ? ` — control ${control.correct}/${controls[0].record.holdout} · ${control.leaks}/${controls[0].record.noSkill} leaks · ${control.siblings} siblings · ${control.avgMs} ms (${controls[0].ran.slice(0, 10)}, ${controls[0].head}${controls[0].dirty ? ' dirty' : ''})` : ' — no control run'}\n`);
    lines.push('| job | correct | Δ | leaks | Δ | siblings | declined | ms | verdict | hypothesis |');
    lines.push('|---|---|---|---|---|---|---|---|---|---|');
    for (const r of rows.sort((a, b) => a.job.id.localeCompare(b.job.id))) {
      const c = cfgOf(r);
      if (!c) { lines.push(`| ${r.job.id} | — | | — | | | | | ERROR | ${r.error || ''} |`); continue; }
      const me = { ...c, declined: c.tally.declined };
      const v = r.job.id === 'control' ? 'control' : verdict(r.job.rule, me, control);
      const d = (a, b) => control ? (a - b >= 0 ? `+${a - b}` : `${a - b}`) : '';
      lines.push(`| ${r.job.id}${r.limit ? ` (limit ${r.limit})` : ''} | ${c.correct}/${r.record.holdout} | ${d(c.correct, control?.correct ?? c.correct)} | ${c.leaks}/${r.record.noSkill} | ${d(c.leaks, control?.leaks ?? c.leaks)} | ${c.siblings} | ${c.tally.declined} | ${c.avgMs} | ${v} | ${r.job.hypothesis} |`);
    }
  }
  return lines.join('\n');
}

/* ── main ───────────────────────────────────────────────────────────────── */
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (flag('--add')) {
    const job = addJob({
      id: opt('--id'), hypothesis: opt('--hypothesis'), rule: opt('--rule', null), prompt: opt('--prompt', null),
      flags: (opt('--flags', '') || '').split(/\s+/).filter(Boolean),
      needs: (opt('--needs', 'planner,category')).split(',').filter(Boolean)
    });
    console.log(`  queued ${job.id}: ${job.hypothesis}`);
  } else if (flag('--status')) {
    const q = listJobs(QUEUE); const mine = join(RESULTS, HOST);
    const done = q.filter(j => existsSync(join(mine, `${j.id}.json`)));
    console.log(`\n  host ${HOST}\n  queue  ${q.length}: ${q.map(j => j.id).join(', ') || '—'}\n  done here ${done.length}: ${done.map(j => j.id).join(', ') || '—'}\n  to run ${q.length - done.length}\n`);
    /* .gitkeep holds the directory in git and is not a host. */
    for (const h of (existsSync(RESULTS) ? readdirSync(RESULTS, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name) : [])) console.log(`  results/${h}: ${readdirSync(join(RESULTS, h)).length}`);
  } else if (flag('--run')) {
    const done = await runQueue({ limit: Number(opt('--limit', 0)) || null, onlyJob: opt('--only-job', null), keepServers: flag('--keep-servers'), again: flag('--again') });
    console.log(`\n  ${done.length} job(s) ran on ${HOST}`);
    if (done.length && !opt('--limit', null)) { const md = report(); writeTable(md); console.log(md); }
  } else if (flag('--report')) {
    const md = report(); if (flag('--write')) writeTable(md); console.log(md);
  } else {
    console.log('  usage: benchqueue --add --id <id> --hypothesis "…" [--flags "…"] [--prompt <variant>] [--rule "…"] | --status | --run [--limit N] | --report [--write]');
  }
}

function writeTable (md) {
  const head = existsSync(TABLE) ? readFileSync(TABLE, 'utf8').split('\n<!-- generated below -->')[0] : '# Bench results\n';
  writeFileSync(TABLE, `${head}\n<!-- generated below -->\n${md}\n`);
}
