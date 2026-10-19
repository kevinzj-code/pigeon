#!/usr/bin/env node
/* transcriptdata.mjs — training pairs for the transcript cleaner.
 *
 * The teacher's job here is NOT to clean anything. It writes clean spoken
 * prose, which is a thing a model is genuinely good at, and the damage is then
 * applied mechanically by transcript-corrupt.mjs. So the target is the text we
 * started from, exactly, and nothing in the corpus depends on the teacher
 * having a good opinion about punctuation.
 *
 * That is the whole difference from a persona corpus. A persona is scored by
 * judgement. This is scored by string comparison.
 *
 * The held-out passages are corrupted at every damage level, so the score can
 * be broken down by how bad the transcript was rather than averaged into one
 * uninformative number. They are also drawn before any damage is applied, so
 * no clean passage appears on both sides of the split.
 *
 *   node scripts/transcriptdata.mjs --base http://127.0.0.1:8110 --passages 300
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { corrupt, mulberry, LEVELS } from './transcript-corrupt.mjs';
import { mechanicalClean } from '../src/captions.js';

const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
const BASE = arg('base', 'http://127.0.0.1:8110');
const PASSAGES = Number(arg('passages', 300));
const HOLDOUT = Number(arg('holdout', 40));
const OUT = arg('out', 'model/transcript-data');

/* Register matters more than topic. A conference talk, a kitchen demo and a
   stand-up meeting break in different places, and a model trained on one
   register punctuates the others like that one. */
const REGISTERS = [
  'a conference talk, one speaker, explaining a technical idea to a room',
  'a cooking video, one presenter, describing what they are doing as they do it',
  'a stand-up meeting update, one person reporting progress to colleagues',
  'a podcast monologue, conversational, thinking out loud',
  'a product demo, walking through a feature on screen',
  'a university lecture, structured, building an argument',
  'a news readout, formal, delivering facts',
  'a personal vlog, informal, telling a story about the day',
  'a tutorial, patient, giving steps in order',
  'an investor update, business language, numbers and outlook'
];

const TOPICS = [
  'semiconductors and tariffs', 'a slow database query', 'making bread',
  'renting versus buying', 'how vaccines are tested', 'a football transfer window',
  'learning a language as an adult', 'the cost of running a small cafe',
  'why bridges fail', 'a hiring process that went wrong', 'sleep and shift work',
  'migrating a service to a new provider', 'a museum exhibition',
  'insurance claims after a storm', 'training for a first marathon',
  'how a film gets funded', 'soil health on a small farm', 'a warehouse stocktake',
  'choosing a school', 'recycling that does not work', 'a power grid in winter',
  'restoring an old car', 'a supply chain delay', 'coral reef monitoring',
  'a local election campaign', 'why a startup ran out of money',
  'bird migration', 'a hospital waiting list', 'building regulations',
  'a music festival that lost money'
];

async function chat (messages, { maxTokens = 700, temperature = 0.9, seed = 11 } = {}) {
  const r = await fetch(`${BASE}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      messages, max_tokens: maxTokens, temperature, seed, top_p: 0.95,
      chat_template_kwargs: { enable_thinking: false }
    })
  });
  if (!r.ok) throw new Error(`teacher ${r.status}`);
  const j = await r.json();
  return String(j.choices?.[0]?.message?.content ?? '')
    .replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

const SYSTEM =
`You write passages of spoken language exactly as a perfect transcript would record them.
Rules:
- Write what a person SAYS, not an essay. Contractions, plain words, first person.
- Punctuate and capitalise perfectly. Every sentence ends in a full stop, question mark or exclamation mark.
- Use two to four paragraphs, separated by a blank line, breaking where the speaker changes subject.
- No headings, no bullet points, no markdown, no stage directions, no speaker labels.
- Do not write filler words. This is the clean version.
Reply with the passage and nothing else.`;

/* A passage the corrupter cannot use is worse than no passage: it quietly
   makes the target something the model can never be right about. */
function usable (text) {
  const t = String(text).trim();
  if (t.length < 400 || t.length > 2200) return 'wrong length';
  if (!t.includes('\n\n')) return 'no paragraphs';
  if (/^\s*[-*#>|]/m.test(t)) return 'markdown';
  if (/^[A-Z][a-z]+:/m.test(t)) return 'speaker label';
  const sentences = t.split(/[.!?]+\s/).filter(s => s.trim().length > 12);
  if (sentences.length < 5) return 'too few sentences';
  /* Every paragraph must actually end a sentence, or "restore the paragraph"
     becomes ambiguous. */
  for (const p of t.split(/\n\s*\n/)) if (!/[.!?]["')\]]?$/.test(p.trim())) return 'paragraph does not end a sentence';
  return null;
}

async function main () {
  const rng = mulberry(11);
  const rejected = {};
  const passages = [];
  const seen = new Set();

  process.stderr.write(`teacher: ${BASE}\nwanted:  ${PASSAGES} passages\n\n`);

  let attempts = 0;
  while (passages.length < PASSAGES && attempts < PASSAGES * 3) {
    attempts++;
    const register = REGISTERS[Math.floor(rng() * REGISTERS.length)];
    const topic = TOPICS[Math.floor(rng() * TOPICS.length)];
    let text = '';
    try {
      text = await chat([
        { role: 'system', content: SYSTEM },
        { role: 'user', content: `Register: ${register}\nSubject: ${topic}\n\nWrite the passage. Around 150 to 220 words.` }
      ], { seed: Math.floor(rng() * 1e6) + 1 });
    } catch (e) { rejected[e.message] = (rejected[e.message] || 0) + 1; continue; }

    const why = usable(text);
    if (why) { rejected[why] = (rejected[why] || 0) + 1; continue; }
    const key = text.slice(0, 80).toLowerCase();
    if (seen.has(key)) { rejected.duplicate = (rejected.duplicate || 0) + 1; continue; }
    seen.add(key);
    passages.push({ text: text.trim(), register, topic });
    if (passages.length % 10 === 0) process.stderr.write(`  ${passages.length}/${PASSAGES}\n`);
  }

  /* Split on the CLEAN passages, before any damage. Splitting afterwards would
     let the same passage appear on both sides wearing different damage. */
  const order = passages.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const held = order.slice(0, HOLDOUT).map(i => passages[i]);
  const train = order.slice(HOLDOUT).map(i => passages[i]);

  const levels = Object.keys(LEVELS);
  const rowOf = (p, level) => {
    const c = corrupt(p.text, { rng, level });
    /* Through the deterministic pass, exactly as production will hand it over.
       Training on the raw damage would train the model to redo work that has
       already been done by the time it is asked. */
    const input = mechanicalClean(c.text).text;
    return { input, target: c.truth, level, register: p.register, topic: p.topic, applied: c.applied };
  };

  const trainRows = train.map(p => rowOf(p, levels[Math.floor(rng() * levels.length)]));
  /* Every held-out passage at every level, so the score breaks down by how bad
     the transcript was instead of averaging into one number. */
  const heldRows = held.flatMap(p => levels.map(l => rowOf(p, l)));

  const INSTRUCTION =
    'Repair this transcript. Put the sentence boundaries and capitals where they belong, ' +
    'restore the paragraph breaks, and repair a name the transcriber split. ' +
    'Change nothing else: do not add, remove, reorder or summarise any word, and leave every number exactly as it is. ' +
    'Reply with the repaired transcript and nothing else.';

  const jsonl = (rows) => rows.map(r => JSON.stringify({
    messages: [
      { role: 'system', content: INSTRUCTION },
      { role: 'user', content: r.input },
      { role: 'assistant', content: r.target }
    ]
  })).join('\n') + '\n';

  /* A tenth, capped at twenty and floored at one. A fixed twenty went negative
     on a small probe run and wrote an empty training file without complaining,
     which is exactly the kind of silence that wastes an hour of GPU. */
  const nValid = Math.min(20, Math.max(1, Math.floor(trainRows.length * 0.1)));
  if (trainRows.length <= nValid) throw new Error(`only ${trainRows.length} training rows — not enough to split`);
  const fit = trainRows.slice(0, -nValid);
  const val = trainRows.slice(-nValid);

  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, 'train.jsonl'), jsonl(fit));
  writeFileSync(join(OUT, 'valid.jsonl'), jsonl(val));
  writeFileSync(join(OUT, 'holdout.json'), JSON.stringify(heldRows, null, 2));
  writeFileSync(join(OUT, 'INSTRUCTION.txt'), INSTRUCTION + '\n');
  writeFileSync(join(OUT, 'DATASET.txt'),
    `transcript repair — boundaries, capitals, paragraphs, split names\n` +
    `teacher ${BASE} wrote ${passages.length} clean passages; damage is mechanical, so the target is exact\n` +
    `${fit.length} train / ${val.length} valid / ${heldRows.length} holdout (${held.length} passages x ${levels.length} levels)\n` +
    `rejected: ${Object.entries(rejected).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}\n` +
    `built ${new Date().toISOString().slice(0, 10)} by scripts/transcriptdata.mjs\n`);

  const tokens = (s) => Math.ceil(s.length / 4);
  const longest = Math.max(...[...trainRows, ...heldRows].map(r => tokens(r.input) + tokens(r.target)));
  process.stderr.write(
    `\nwrote ${OUT}\n  train ${fit.length}   valid ${val.length}   holdout ${heldRows.length}\n` +
    `  longest row about ${longest} tokens\n` +
    `  rejected: ${Object.entries(rejected).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}\n`);
}

main().catch(e => { console.error(e); process.exit(1); });
