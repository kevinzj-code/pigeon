#!/usr/bin/env node
/* siblingdata.mjs — a training set for the SIBLING-DISCRIMINATION adapter.
 *
 * The task is the one verify.js already asks: a MESSAGE, two to four full skill
 * cards of which the first is a draft choice, name the one that does what the
 * message asks. The prompted 2B could not do it — measured on the holdout it
 * broke 8 correct picks to fix 6, and kept the wrong draft 13 times with the
 * right card in view — so the question goes to an adapter instead, and this
 * is its data.
 *
 * Every row is built from a skill's own hand-written example: the example's
 * text is the message and the skill is the answer, which makes the label
 * ground truth rather than a guess. The cards are exactly what
 * `siblingAlternatives` in verify.js would put beside that skill at inference —
 * name siblings, the lexical router's pick for the message, vector siblings —
 * so the adapter trains on the shortlists it will actually be shown.
 *
 * TWO ROWS PER EXAMPLE, DRAFT POSITION RANDOMISED. In one the draft (card 1)
 * is the right skill and the answer is to keep it; in the other the draft is
 * a sibling and the answer is to switch. Without both, the adapter learns
 * "say card 1" or "never say card 1" — a position, not a reading.
 *
 * THE BENCH IS NEVER TRAINED ON. Every message is checked against
 * scripts/holdout.mjs and scripts/no-skill-set.mjs with the category set's
 * four collision rules, and the split is by message.
 *
 * Usage:
 *   node scripts/siblingdata.mjs            # write model/sibling-data/
 *   node scripts/siblingdata.mjs --dry      # count and sample, write nothing
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import entries from '../skills/index.js';
import { buildRegistry } from '../src/registry.js';
import { LexicalRouter } from '../src/router.js';
import { siblingAlternatives, siblingUserTurn, SIBLING_SYSTEM_TRAINED } from '../src/verify.js';
import { HOLDOUT } from './holdout.mjs';
import { NO_SKILL_MESSAGES } from './no-skill-set.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const DRY = argv.includes('--dry');
const OUT_DIR = (() => { const i = argv.indexOf('--out'); return i >= 0 ? argv[i + 1] : join(ROOT, 'model/sibling-data'); })();
/* --bank <json>: skill-labelled paraphrases, {skill: [[kind, text], ...]}, exported
   from Flight School's category banks. Round 2 trained on the skills' own
   examples alone and learnt to match words against the cards' example text —
   the holdout is paraphrased so that fails. The banks are paraphrases written
   in six kinds, one of which ("i", indirect) shares no content word with its
   seed; they are the distribution the adapter is graded on. */
const BANK_PATH = (() => { const i = argv.indexOf('--bank'); return i >= 0 ? argv[i + 1] : null; })();
const BANK = BANK_PATH ? JSON.parse(await (await import('node:fs/promises')).readFile(BANK_PATH, 'utf8')) : {};
/* --pairs <json>: contrastive sibling pairs, {pairs: [{a, b, a_messages, b_messages}]}.
   Round 3 left twelve kept-wrong cases and they were the same pairs every
   round — parseMarkdownTable/toMarkdownTable, applyDiscount/stackDiscounts.
   A pair row shows exactly the two confusable cards, in both orders, with a
   message that unambiguously wants one of them: the discrimination the
   paraphrase banks never ask for directly. */
const PAIRS_PATH = (() => { const i = argv.indexOf('--pairs'); return i >= 0 ? argv[i + 1] : null; })();
const PAIRS = PAIRS_PATH ? JSON.parse(await (await import('node:fs/promises')).readFile(PAIRS_PATH, 'utf8')).pairs : [];

const registry = buildRegistry(entries);
const router = new LexicalRouter(registry);

/* ── the bench's four collision rules ────────────────────────────────────── */
const STOP = new Set('a an the this that these those my me i to of in on for from with and or is are it as at by be into out up down what how which give show tell make turn'.split(' '));
const toks = (s) => String(s).toLowerCase().replace(/[^a-z0-9%$.:/-]+/g, ' ').trim().split(/\s+/).filter(Boolean);
const content = (s) => toks(s).filter(t => !STOP.has(t));
const edit = (a, b) => {
  const m = a.length, n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[m][n];
};
const BENCH = [...HOLDOUT.map(x => x[0]), ...NO_SKILL_MESSAGES].map(b => ({ b, t: toks(b), c: content(b), cs: new Set(content(b)) }));
function collides (text) {
  const t = toks(text), c = content(text), cs = new Set(c);
  for (const { b, t: bt, c: bc, cs: bcs } of BENCH) {
    if (t.join(' ') === bt.join(' ')) return `identical: "${b}"`;
    if (c.length && [...c].sort().join(' ') === [...bc].sort().join(' ')) return `same content words: "${b}"`;
    if (edit(t, bt) <= 1) return `edit≤1: "${b}"`;
    const inter = [...cs].filter(x => bcs.has(x)).length, uni = new Set([...cs, ...bcs]).size;
    if (uni && inter / uni >= 0.75) return `jaccard ${(inter / uni).toFixed(2)}: "${b}"`;
  }
  return null;
}

/* ── deterministic shuffle, so a rebuild is the same set ──────────────────── */
const hash = (s) => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return (h >>> 0) / 2 ** 32; };

const row = (message, cards, answer) => ({
  messages: [
    { role: 'system', content: SIBLING_SYSTEM_TRAINED },
    { role: 'user', content: siblingUserTurn({ message, cards }) },
    { role: 'assistant', content: answer }
  ]
});

const rows = [];
const dropped = { collides: 0, noAlternatives: 0, noText: 0 };
let keep = 0, swap = 0;
const byKind = {};

for (const skill of registry.routable()) {
  /* Messages for this skill: its examples (kind "e") and, when a bank is
     given, its paraphrases with their kinds. */
  const messages = (skill.examples || []).filter(e => e.text).map(e => ({ text: e.text, kind: 'e' }));
  for (const [kind, text] of BANK[skill.name] || []) messages.push({ text, kind });
  const seenText = new Set();
  for (const ex of messages) {
    if (seenText.has(ex.text)) continue;
    seenText.add(ex.text);
    if (!ex.text) { dropped.noText++; continue; }
    const why = collides(ex.text);
    if (why) { dropped.collides++; continue; }
    byKind[ex.kind] = (byKind[ex.kind] || 0) + 1;

    const routing = router.route(ex.text, {});
    const alternatives = siblingAlternatives({ registry, router, skill: skill.name, routing });
    if (!alternatives.length) { dropped.noAlternatives++; continue; }

    /* The answer's card must not carry the example this row was built from:
       a card whose "e.g." equals the message is a giveaway, and an adapter
       that learns to match text verbatim has learnt nothing it can use on a
       message it has never seen. Another of the skill's examples stands in;
       a skill with only the one loses the line. */
    const base = registry.compactCard(skill.name);
    const other = (skill.examples || []).find(e => e.text && e.text !== ex.text);
    const right = base && { ...base, example: other ? { text: other.text, input: other.input } : null };
    const others = alternatives.map(n => registry.compactCard(n)).filter(Boolean);
    if (!right || !others.length) { dropped.noAlternatives++; continue; }

    /* Row 1: the draft is right. The remaining cards keep offer order. */
    rows.push(row(ex.text, [right, ...others], skill.name)); keep++;

    /* Row 2: the draft is a sibling, chosen by hash so the choice is stable;
       the right card lands somewhere after it, also by hash, so "the answer is
       always card 2" is not learnable either. */
    const draftIdx = Math.floor(hash(ex.text) * others.length);
    const draft = others[draftIdx];
    const rest = others.filter((_, i) => i !== draftIdx);
    const at = Math.floor(hash(ex.text + '#') * (rest.length + 1));
    const cards = [draft, ...rest.slice(0, at), right, ...rest.slice(at)];
    rows.push(row(ex.text, cards, skill.name)); swap++;
  }
}

/* ── contrastive pairs: two cards, both orders, the message decides ──────── */
let pairRows = 0; const pairDropped = { unknown: [], collides: 0 };
for (const pair of PAIRS) {
  const sides = [[pair.a, pair.b, pair.a_messages || []], [pair.b, pair.a, pair.b_messages || []]];
  for (const [want, other, messages] of sides) {
    const w = registry.skill(want), o = registry.skill(other);
    if (!w || !o) { pairDropped.unknown.push(!w ? want : other); continue; }
    for (const text of messages) {
      const why = collides(text);
      if (why) { pairDropped.collides++; continue; }
      const wantCard = registry.compactCard(want), otherCard = registry.compactCard(other);
      if (!wantCard || !otherCard) continue;
      const right = wantCard.example && wantCard.example.text === text
        ? { ...wantCard, example: (w.examples || []).filter(e => e.text && e.text !== text).map(e => ({ text: e.text, input: e.input }))[0] || null }
        : wantCard;
      rows.push(row(text, [right, otherCard], want)); keep++;
      rows.push(row(text, [otherCard, right], want)); swap++;
      pairRows += 2; byKind.p = (byKind.p || 0) + 1;
    }
  }
}
if (PAIRS.length) console.log(`  pairs: ${PAIRS.length} pairs → ${pairRows} rows · dropped ${pairDropped.collides} colliding messages${pairDropped.unknown.length ? ' · UNKNOWN SKILLS: ' + [...new Set(pairDropped.unknown)].join(', ') : ''}`);

/* ── split by message ────────────────────────────────────────────────────── */
const byMessage = new Map();
for (const r of rows) {
  const key = r.messages[1].content.split('\n')[1];
  if (!byMessage.has(key)) byMessage.set(key, []);
  byMessage.get(key).push(r);
}
const train = [], valid = [];
for (const [k, rs] of [...byMessage].sort(([a], [b]) => a.localeCompare(b))) (hash(k) < 0.92 ? train : valid).push(...rs);

/* Shuffle the training rows so keep/switch and categories interleave. */
train.sort((a, b) => hash(a.messages[1].content) - hash(b.messages[1].content));

const sizes = rows.map(r => r.messages[1].content.length + r.messages[0].content.length).sort((a, b) => a - b);
console.log(`\n  rows ${rows.length} (keep ${keep} · switch ${swap}) from ${byMessage.size} messages`);
console.log(`  dropped: ${dropped.collides} collide with the bench · ${dropped.noAlternatives} had no sibling to offer · ${dropped.noText} no text`);
console.log(`  messages by kind: ${Object.entries(byKind).map(([k, n]) => `${k}=${n}`).join(' ')}  (e = skill example; i s a c b t = Flight School paraphrase kinds)`);
console.log(`  cards per row: ${(rows.reduce((n, r) => n + (r.messages[1].content.match(/^\d+\. /gm) || []).length, 0) / rows.length).toFixed(2)} avg`);
console.log(`  prompt chars: median ${sizes[sizes.length >> 1]} · p95 ${sizes[Math.floor(sizes.length * 0.95)]} · max ${sizes[sizes.length - 1]}  (~${Math.round(sizes[sizes.length >> 1] / 3.6)} tokens median)`);
console.log(`  train ${train.length} · valid ${valid.length}`);
if (rows.length) {
  const sample = rows.find(r => r.messages[1].content.split('\n')[1] !== r.messages[2].content);
  console.log('\n  ── a switch row ───────────────────────────────────────');
  console.log('  ' + rows[1].messages[1].content.split('\n').join('\n  '));
  console.log('  → ' + rows[1].messages[2].content);
  void sample;
}
if (DRY) { console.log('\n  --dry: nothing written.\n'); }
else {
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(join(OUT_DIR, 'train.jsonl'), train.map(r => JSON.stringify(r)).join('\n') + '\n');
  await writeFile(join(OUT_DIR, 'valid.jsonl'), valid.map(r => JSON.stringify(r)).join('\n') + '\n');
  await writeFile(join(OUT_DIR, 'SYSTEM.txt'), SIBLING_SYSTEM_TRAINED);
  console.log(`\n  written to ${OUT_DIR}\n`);
}
