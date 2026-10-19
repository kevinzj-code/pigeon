#!/usr/bin/env node
/* lanebbench.mjs — the adversarial check the spec asks for (§6, "Lane B
 * leak-into-Lane-A"): Lane-A-shaped questions asked INSIDE the chat lane,
 * where the correct behaviour is handing off rather than answering.
 *
 * The bar is zero tolerance: a Lane B message that states a computed number is
 * a shipped bug. So the assertion this script makes is about what a person
 * would actually SEE — no shown reply may contain a figure the person did not
 * supply. The handoff guard is what makes that true, and this is where it is
 * measured rather than assumed.
 *
 * Three numbers come out of a run, and only the first is pass/fail:
 *
 *   leaks         shown replies carrying an untraceable figure. Must be 0.
 *   caught        the model tried to answer with a number and the guard
 *                 dropped it. Safe, but each one is a near miss: a high
 *                 count means the prompt is doing little and the guard is
 *                 doing everything.
 *   declined      the model said the figure was not its to work out. This is
 *                 the behaviour the system prompt asks for, and the number
 *                 worth watching go up.
 *
 * It also reports the hole the guard knows it has: figures written as WORDS
 * ("a hundred and ninety-four"), which the shipped guard only catches in a
 * phrase carrying a scale word. That is measured here rather than guessed at,
 * so the decision to close it or leave it has a number behind it.
 *
 * A second pass asks conversational questions — the things this lane exists
 * for — and reports how often a good answer is dropped by mistake. A guard
 * that eats ordinary chat is one that gets turned off.
 *
 *   npm run bench:laneb                 40 quantitative + every conversational one
 *   npm run bench:laneb -- --all        every quantitative question in the holdout
 *   npm run bench:laneb -- --n 10
 *   npm run bench:laneb -- --shape A    also the multi-turn cases, earlier turns sent
 *   npm run bench:laneb -- --shape B    also the multi-turn cases, no history sent
 *
 * THE SHAPES. A voice is trained on single question-and-answer pairs, so what
 * it does with earlier turns is not known until it is measured. Shape A sends
 * the first turn and its reply as history (what the app does today); shape B
 * sends the follow-up alone. Same bar for both: no leaks, and no conversational
 * follow-up eaten. "Picked up" is a rough read of memory — the follow-up's
 * reply names a word from the first message — reported, not a bar.
 *
 * Needs the category server up (`npm run models`), because it asks a real
 * model real questions. Never part of `npm test`, which runs offline.
 */

import { HOLDOUT } from './holdout.mjs';
import { CONVERSATIONAL, MULTI_TURN } from './conversational.mjs';
import { runChat } from '../src/lane-b/chat.js';
import { wantsANumber, numeralsIn, spelledNumbersIn } from '../src/lane-b/handoff.js';
import { chatBridge } from '../src/lane-b/bridge.js';
import './lib/apikey.mjs'; // the model servers' key → PIGEON_API_KEY

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const ALL = process.argv.includes('--all');
const N = Number(arg('n', 40));
/* A persona changes what the model writes, so it changes every number below.
   Run it both ways and compare: the figure worth watching is `declined`, which
   is the lane behaving because it was asked to rather than because the guard
   caught it. */
const PERSONA = arg('persona', null);
const SHAPE = arg('shape', null);
if (SHAPE && !['A', 'B'].includes(SHAPE)) { console.error('--shape is A (earlier turns sent) or B (no history)'); process.exit(2); }

/* The questions this lane must NOT answer: every holdout phrasing whose answer
   would be a figure. They were written as Lane A questions, which is exactly
   what makes them adversarial here. */
const QUANTITATIVE = HOLDOUT.map(x => x[0]).filter(wantsANumber);

/* The questions this lane is FOR. If the guard fires on these it is broken in
   the other direction, and that is just as much a failure. They are kept in
   their own file because the persona generator has to exclude them: a persona
   trained on this set would pass here by memory. */

/* The hole, measured: numbers written as words, including the small ones the
   shipped guard deliberately ignores. Lives here rather than in the lane so
   the lane's own rule stays the one thing being tested. */
const WORD_NUMBERS = /\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million)\b/g;
const wordNumbersIn = (text) => new Set(String(text ?? '').toLowerCase().match(WORD_NUMBERS) || []);

function sample (list, n) {
  if (ALL || n >= list.length) return list;
  const out = [];
  const step = list.length / n;
  for (let i = 0; i < n; i++) out.push(list[Math.floor(i * step)]);
  return out;
}

const complete = chatBridge();
if (!complete) {
  console.error('no chat model reachable — start one with `npm run models`');
  process.exit(1);
}

let persona = null;
if (PERSONA) {
  const listed = await complete.personas();
  if (!listed.some(p => p.id === PERSONA)) {
    console.error(`"${PERSONA}" is not loaded. Loaded: ${listed.map(p => p.id).join(', ') || '(none)'}`);
    console.error('The category server takes its adapters at launch — restart it.');
    process.exit(1);
  }
  persona = { id: PERSONA, name: PERSONA.replace(/[-_]/g, ' ') };
}

const short = (s, n = 58) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

console.log(`\n  Lane B — the adversarial set (§6)${persona ? `, wearing ${persona.name}` : ', in the base voice'}`);
console.log(`  ${QUANTITATIVE.length} quantitative questions in the holdout; asking ${ALL ? 'all' : Math.min(N, QUANTITATIVE.length)}`);
console.log(`  ${CONVERSATIONAL.length} conversational questions, which must survive\n`);

let leaks = 0, caught = 0, declined = 0, wordHoles = 0, failed = 0;
const leaked = [];
const holes = [];

for (const q of sample(QUANTITATIVE, N)) {
  const turn = await runChat(q, { complete, persona });
  if (!turn.reply) { failed++; console.log(`  ERR   ${short(q)} — ${turn.error}`); continue; }

  /* What a person would see. The assertion is about this and nothing else. */
  const shown = turn.reply.text;
  const stray = [...numeralsIn(shown)].filter(n => !numeralsIn(q).has(n));
  if (stray.length) { leaks++; leaked.push({ q, shown, stray }); }

  if (turn.handoff) {
    caught++;
    /* The model's dropped attempt is where the word-form hole shows: if it
       wrote the figure in words as well, the guard would not have caught it. */
    const words = [...wordNumbersIn(turn.handoff.dropped)].filter(w => !wordNumbersIn(q).has(w));
    if (words.length) { wordHoles++; holes.push({ q, words }); }
  } else {
    declined++;
    const words = [...wordNumbersIn(shown)].filter(w => !wordNumbersIn(q).has(w));
    if (words.length) {
      wordHoles++;
      /* Shown means the guard let it through. Either the word is a turn of
         speech the guard excludes by name ("one of", "no one"), or it is a
         real figure the guard missed — the sentence is kept so a person can
         tell which, and `real` counts the second kind by the guard's own rule. */
      const real = [...spelledNumbersIn(shown)].filter(w => !spelledNumbersIn(q).has(w));
      const sentence = (shown.split(/(?<=[.!?])\s+/).find(x => words.some(w => new RegExp(`\\b${w}\\b`, 'i').test(x))) || shown).trim();
      holes.push({ q, words, shown: true, real, sentence });
    }
  }
  process.stdout.write(turn.handoff ? '·' : '+');
}

console.log('\n');
let eaten = 0;
for (const q of CONVERSATIONAL) {
  const turn = await runChat(q, { complete, persona });
  if (!turn.reply) { failed++; continue; }
  if (turn.handoff) { eaten++; console.log(`  EATEN ${short(q)} — dropped over ${turn.handoff.numbers.join(', ')}`); }
  process.stdout.write(turn.handoff ? '!' : '·');
}

/* The multi-turn cases, in the shape asked for. */
let multiLeaks = 0, multiEaten = 0, pickedUp = 0;
const multiLeaked = [];
const STOP = new Set(['what', 'does', 'that', 'this', 'with', 'from', 'about', 'explain', 'mean', 'would', 'there', 'their', 'which']);
const keyWords = (text) => String(text).toLowerCase().match(/[a-z]{5,}/g)?.filter(w => !STOP.has(w)) || [];
if (SHAPE) {
  console.log(`\n\n  multi-turn, shape ${SHAPE} (${SHAPE === 'A' ? 'the first turn sent as history' : 'the follow-up alone'})`);
  for (const [kind, cases] of [['conversational', MULTI_TURN.conversational], ['adversarial', MULTI_TURN.adversarial]]) {
    for (const [first, second] of cases) {
      const one = await runChat(first, { complete, persona });
      const history = SHAPE === 'A' && one.reply ? [{ lane: 'B', message: first, reply: one.reply, ...(one.handoff ? { handoff: one.handoff } : {}) }] : [];
      const two = await runChat(second, { complete, persona, history });
      if (!two.reply) { failed++; continue; }
      const shown = two.reply.text;
      /* Licensed: what the person typed in either turn, and nothing else. */
      const typed = new Set([...numeralsIn(first), ...numeralsIn(second)]);
      const stray = [...numeralsIn(shown)].filter(n => !typed.has(n));
      if (stray.length) { multiLeaks++; multiLeaked.push({ q: `${first} → ${second}`, shown, stray }); }
      if (kind === 'conversational') {
        if (two.handoff) { multiEaten++; console.log(`  EATEN ${short(second)} — dropped over ${two.handoff.numbers.join(', ')}`); }
        else if (keyWords(first).some(w => shown.toLowerCase().includes(w))) pickedUp++;
      }
      process.stdout.write(stray.length ? 'x' : two.handoff ? '·' : '+');
    }
  }
}

console.log('\n\n  ── the bar ────────────────────────────────────────────────');
console.log(`  leaks (a shown reply stating a figure)   ${leaks}   must be 0`);
console.log('\n  ── how it was kept ────────────────────────────────────────');
console.log(`  the model declined, as asked             ${declined}`);
console.log(`  the guard caught it                      ${caught}`);
console.log(`  the model or the server failed           ${failed}`);
console.log('\n  ── the known hole, measured ───────────────────────────────');
console.log(`  replies carrying a figure in WORDS       ${wordHoles}`);
console.log('\n  ── the other direction ────────────────────────────────────');
console.log(`  conversational answers eaten by mistake  ${eaten} of ${CONVERSATIONAL.length}   must be 0`);
if (SHAPE) {
  console.log(`\n  ── shape ${SHAPE}, multi-turn ────────────────────────────────`);
  console.log(`  leaks in a follow-up                     ${multiLeaks} of ${MULTI_TURN.adversarial.length + MULTI_TURN.conversational.length}   must be 0`);
  console.log(`  conversational follow-ups eaten          ${multiEaten} of ${MULTI_TURN.conversational.length}   must be 0`);
  console.log(`  follow-ups that picked up the first turn ${pickedUp} of ${MULTI_TURN.conversational.length}   (rough)`);
  for (const l of multiLeaked) console.log(`    LEAK ${short(l.q, 90)}\n      ${l.stray.join(', ')} in: ${short(l.shown, 120)}`);
}

if (leaked.length) {
  console.log('\n  LEAKS\n');
  for (const l of leaked) console.log(`    ${short(l.q)}\n      ${l.stray.join(', ')} in: ${short(l.shown, 120)}\n`);
}
if (holes.length) {
  console.log('\n  figures in words (not caught by the shipped guard)\n');
  for (const h of holes.filter(x => !x.shown).slice(0, 8)) console.log(`    ${short(h.q)} → ${h.words.join(', ')}  [in the dropped attempt]`);
  const shownHoles = holes.filter(x => x.shown);
  if (shownHoles.length) {
    console.log(`\n  number words SHOWN: ${shownHoles.length}, of which a figure by the guard's own rule: ${shownHoles.filter(x => x.real.length).length}`);
    for (const h of shownHoles) console.log(`    ${short(h.q)} → ${h.words.join(', ')}${h.real.length ? '  [FIGURE]' : '  [turn of speech]'}\n      "${short(h.sentence, 140)}"`);
  }
}
console.log('');
process.exit(leaks || eaten || multiLeaks || multiEaten ? 1 : 0);
