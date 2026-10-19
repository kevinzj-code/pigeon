#!/usr/bin/env node
/* negativesdata.mjs — targeted negatives for the category adapter.
 *
 * The leak is upstream of every downstream rule, and turn.js says so in a long
 * comment written after the ground check was measured and rejected: it stopped
 * six leaks and cost nine correct answers, because no rule after the router can
 * tell "he made a hash of the presentation" from a real request. The adapter
 * names a category at 0.9 to 1.00 for that sentence. The lever named there is
 * this one: targeted negatives in the category set.
 *
 * Measured shape of the 21 leaks, all of them the same:
 *
 *   "the whole project is an anagram of chaos"     -> checkAnagram
 *   "he made a hash of the presentation"           -> hashText
 *   "it was a coin toss who would get the job"     -> flipCoin
 *   "binary thinking is what got us into this"     -> binaryDecode
 *   "keep the streak alive, whatever it takes"     -> streakCount
 *
 * A skill's own vocabulary, used as ordinary English. So the teacher is shown
 * the card the ROUTER sees and asked for sentences that borrow its words
 * without asking for it. Every row is labelled `none`.
 *
 * Two holdouts are enforced, not hoped for: the 100 no-skill messages the
 * bench grades on, and the 308 real questions. A generated "negative" that is
 * really a request would teach the adapter to refuse the thing it is for.
 *
 *   node scripts/negativesdata.mjs --base http://127.0.0.1:8110 --per-skill 2
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import entries from '../skills/index.js';
import { buildRegistry } from '../src/registry.js';
import { NO_SKILL_MESSAGES } from './no-skill-set.mjs';
import { HOLDOUT } from './holdout.mjs';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const BASE = arg('base', 'http://127.0.0.1:8110');
const PER_SKILL = Number(arg('per-skill', 2));
const BATCH = Number(arg('batch', 5));
const OUT = arg('out', 'model/negatives');

const registry = buildRegistry(entries);
const skills = (registry.all ? registry.all() : entries).filter(s => !s.unbuilt);

function mulberry (seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const rng = mulberry(11);

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const HELD = new Set([...NO_SKILL_MESSAGES, ...HOLDOUT.map(h => h[0])].map(norm));
const contentWords = (s) => new Set(norm(s).split(' ').filter(w => w.length > 3));
const HELD_WORDS = [...NO_SKILL_MESSAGES, ...HOLDOUT.map(h => h[0])].map(contentWords);

/* Near-duplicate as well as exact. A negative that is a paraphrase of a bench
   question is contamination whichever set it came from, and contamination does
   not announce itself. */
function tooClose (s) {
  if (HELD.has(norm(s))) return true;
  const a = contentWords(s);
  if (a.size < 3) return false;
  return HELD_WORDS.some(b => {
    if (b.size < 3) return false;
    const inter = [...a].filter(w => b.has(w)).length;
    return inter / Math.max(a.size, b.size) >= 0.7;
  });
}

async function chat (messages, { maxTokens = 700, temperature = 0.95, seed = 11 } = {}) {
  const r = await fetch(`${BASE}/v1/chat/completions`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ messages, max_tokens: maxTokens, temperature, seed, top_p: 0.95,
      chat_template_kwargs: { enable_thinking: false } })
  });
  if (!r.ok) throw new Error(`teacher ${r.status}`);
  const j = await r.json();
  return String(j.choices?.[0]?.message?.content ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

const SYSTEM =
`You write realistic messages a person types into a chat assistant.
You output nothing but the messages, one per line, no numbering, no commentary, no blank lines, no quotes.`;

const promptFor = (group) => {
  const cards = group.map((s, i) => {
    const ex = (s.examples || []).slice(0, 2).map(e => e.text).filter(Boolean);
    return `${i + 1}. ${s.name} — ${s.description}${ex.length ? `\n   asked for like: ${ex.join(' / ')}` : ''}`;
  }).join('\n');
  return `Here are ${group.length} tools:\n\n${cards}\n\n` +
    `For EACH tool, write ${PER_SKILL} short messages that BORROW its words but are NOT asking for it.\n\n` +
    `Use the words the way ordinary English does: as an idiom, a metaphor, a figure of speech, ` +
    `small talk, or someone narrating something that already happened to them.\n\n` +
    `Rules:\n` +
    `- NEVER an instruction. No imperatives. If the message could be obeyed, it is wrong.\n` +
    `- NEVER a question that wants a figure, a date, a conversion, a lookup or a transformation.\n` +
    `- Past tense, or an observation, or a complaint, or a story. Not a task.\n` +
    `- Do not mention tools, categories or assistants.\n` +
    `- One per line, lowercase-casual, all different from each other.\n\n` +
    `Write exactly ${group.length * PER_SKILL} lines.`;
};

/* The second pass, and the reason the first one cannot be trusted on its own.
 *
 * Asked for idioms, the teacher also produced "i need to make a hash of the
 * data before sending it" and "zip the list of names and scores" — real
 * requests wearing the right vocabulary. Training the adapter to refuse those
 * would rebuild, in data, the exact failure the ground check had in code: nine
 * correct answers lost to catch six leaks.
 *
 * So every candidate is put back to the teacher on its own, greedily, and
 * asked the one question that matters. A drafting job wants sampling; a
 * labelling job wants the answer, so this runs at temperature 0. */
async function isARequest (line) {
  const reply = await chat([
    { role: 'system', content: 'You answer with one word: YES or NO. Nothing else.' },
    { role: 'user', content:
      `Message: "${line}"\n\n` +
      `Is this person ASKING for something to be done — something computed, converted, ` +
      `generated, looked up, checked, formatted or transformed?\n\n` +
      `Answer NO if they are describing, complaining, reminiscing, joking, or using a ` +
      `phrase figuratively. Answer YES if a tool could carry the message out.\n\n` +
      `YES or NO:` }
  ], { maxTokens: 4, temperature: 0, seed: 11 });
  return /^\s*yes/i.test(reply);
}

/* Near-duplicates among the negatives themselves. Given one example the
   teacher will reuse its shape all night: "he made a hash of the presentation"
   came back three ways in one run, and exact-match dedup let all three in. */
function tooSimilar (line, keptWords) {
  const a = contentWords(line);
  if (a.size < 3) return false;
  return keptWords.some(b => {
    const inter = [...a].filter(w => b.has(w)).length;
    return inter / Math.max(a.size, b.size) >= 0.6;
  });
}

const splitLines = (t) => t.split('\n')
  .map(l => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim().replace(/^["']|["']$/g, ''))
  .filter(l => l.length > 8 && !l.endsWith(':'));

async function main () {
  const groups = [];
  for (let i = 0; i < skills.length; i += BATCH) groups.push(skills.slice(i, i + BATCH));
  process.stderr.write(`teacher: ${BASE}\n${skills.length} skills in ${groups.length} batches, ${PER_SKILL} each\n\n`);

  const kept = [];
  const keptWords = [];
  const seen = new Set();
  const dropped = { held: 0, duplicate: 0, similar: 0, empty: 0, request: 0 };
  const rejected = [];

  for (let g = 0; g < groups.length; g++) {
    let text = '';
    try {
      text = await chat([{ role: 'system', content: SYSTEM }, { role: 'user', content: promptFor(groups[g]) }],
        { maxTokens: 80 * groups[g].length * PER_SKILL + 160, seed: Math.floor(rng() * 1e6) + 1 });
    } catch (e) { process.stderr.write(`  ! batch ${g}: ${e.message}\n`); continue; }

    for (const line of splitLines(text)) {
      const k = norm(line);
      if (!k) { dropped.empty++; continue; }
      if (seen.has(k)) { dropped.duplicate++; continue; }
      seen.add(k);
      if (tooClose(line)) { dropped.held++; continue; }
      if (tooSimilar(line, keptWords)) { dropped.similar++; continue; }
      let asks = true;
      try { asks = await isARequest(line); } catch { asks = true; }
      if (asks) { dropped.request++; rejected.push(line); continue; }
      kept.push({ text: line, from: groups[g].map(s => s.name) });
      keptWords.push(contentWords(line));
    }
    if ((g + 1) % 10 === 0) process.stderr.write(`  batch ${g + 1}/${groups.length} — ${kept.length} kept\n`);
  }

  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, 'negatives.json'), JSON.stringify(kept, null, 1));
  writeFileSync(join(OUT, 'NEGATIVES.txt'),
    `targeted negatives for the category adapter — a skill's vocabulary used as ordinary English\n` +
    `teacher ${BASE}, ${PER_SKILL} per skill over ${skills.length} skills\n` +
    `${kept.length} kept\n` +
    `dropped: ${dropped.request} were real requests, ${dropped.similar} too alike, ` +
    `${dropped.held} too close to a holdout, ${dropped.duplicate} duplicates\n` +
    `holdouts enforced: the 100 no-skill bench messages AND the 308 real questions\n` +
    `built ${new Date().toISOString().slice(0, 10)} by scripts/negativesdata.mjs\n`);

  writeFileSync(join(OUT, 'rejected.json'), JSON.stringify(rejected, null, 1));
  process.stderr.write(`\nwrote ${OUT}\n  kept ${kept.length}\n` +
    `  dropped ${dropped.request} real requests, ${dropped.similar} too alike, ` +
    `${dropped.held} too close to a holdout, ${dropped.duplicate} duplicates\n`);
}

main().catch(e => { console.error(e); process.exit(1); });
