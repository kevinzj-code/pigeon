#!/usr/bin/env node
/* personacheck.mjs — is the persona actually worn?
 *
 * A LoRA that fails to apply does not error. The server loads it, the request
 * names it, the reply comes back, and it is the base model's reply. The only
 * honest test is a paired one: the same question, the same seed, once with the
 * adapter at 1.0 and once at 0.0. If the two replies are identical the adapter
 * did nothing, whatever the logs say.
 *
 * It also asks a question whose answer is a figure, because the persona is not
 * allowed to compute one either — being in character is not a licence the
 * wall recognises.
 *
 *   node scripts/personacheck.mjs socratic-tutor [--shape A|B]
 *
 * With --shape, one more pair: a follow-up asked after a first turn, with that
 * turn sent as history (A) or not (B), worn and bare under one seed.
 */
import { runChat } from '../src/lane-b/chat.js';
import { chatBridge } from '../src/lane-b/bridge.js';
import { numeralsIn } from '../src/lane-b/handoff.js';
import './lib/apikey.mjs'; // the model servers' key → PIGEON_API_KEY

const id = process.argv[2];
const shapeAt = process.argv.indexOf('--shape');
const SHAPE = shapeAt > -1 ? process.argv[shapeAt + 1] : null;
if (SHAPE && !['A', 'B'].includes(SHAPE)) { console.error('--shape is A or B'); process.exit(2); }
if (!id) { console.error('usage: node scripts/personacheck.mjs <persona-id>'); process.exit(2); }

const complete = chatBridge();
if (!complete) { console.error('no chat model reachable — start one with `npm run models`'); process.exit(1); }

const listed = await complete.personas();
if (!listed.some(p => p.id === id)) {
  console.error(`"${id}" is not loaded. Loaded: ${listed.map(p => p.id).join(', ') || '(none)'}`);
  console.error('The category server takes its adapters at launch — restart it.');
  process.exit(1);
}

const QUESTIONS = [
  'my binary search returns -1 for a value I can see in the array',
  'I keep hearing about closures and nodding along without understanding',
  'I open this file every morning and close it again without touching it',
  'what is 20% off 150'   // must not be answered by anyone, in any voice
];

console.log(`\n  ${id} — paired against the same model with the adapter off`);
console.log(`  transport: ${complete.transport}\n`);

let identical = 0, leaked = 0;
for (const q of QUESTIONS) {
  /* Same seed both times. Without that, two different replies prove nothing —
     sampling alone would produce them. */
  const seed = 11;
  const on = await runChat(q, { complete, persona: { id, name: id.replace(/[-_]/g, ' ') }, seed });
  const off = await runChat(q, { complete, seed });
  const a = on.reply?.text ?? `(error: ${on.error})`;
  const b = off.reply?.text ?? `(error: ${off.error})`;

  /* When the handoff guard fires it replaces the reply with one fixed
     sentence, so both sides come back word for word the same. That is the
     guard working, not the adapter failing, and counting it as "identical"
     would report a healthy adapter as dead. The comparison is made on what the
     model actually wrote in that case. */
  const guarded = Boolean(on.handoff || off.handoff);
  const wroteA = on.handoff ? on.handoff.dropped : a;
  const wroteB = off.handoff ? off.handoff.dropped : b;
  const same = wroteA === wroteB;
  if (same) identical++;

  const stray = [...numeralsIn(a)].filter(n => !numeralsIn(q).has(n));
  if (stray.length) leaked++;

  console.log(`  ${q}`);
  console.log(`    worn  ${a.replace(/\n+/g, ' ')}`);
  console.log(`    base  ${b.replace(/\n+/g, ' ')}`);
  if (guarded) {
    console.log(`    the guard dropped both; comparing what was written instead`);
    console.log(`      worn  ${String(wroteA).replace(/\n+/g, ' ')}`);
    console.log(`      base  ${String(wroteB).replace(/\n+/g, ' ')}`);
  }
  console.log(`    ${same ? 'IDENTICAL — the adapter did nothing' : 'different'}${stray.length ? `   LEAK ${stray.join(' ')}` : ''}\n`);
}

if (SHAPE) {
  const [first, second] = ['explain what a direct debit is', 'and how is that different from a standing order'];
  const persona = { id, name: id.replace(/[-_]/g, ' ') };
  const one = await runChat(first, { complete, persona, seed: 11 });
  const history = SHAPE === 'A' && one.reply ? [{ lane: 'B', message: first, reply: one.reply }] : [];
  const on = await runChat(second, { complete, persona, seed: 11, history });
  const off = await runChat(second, { complete, seed: 11, history });
  const a = on.reply?.text ?? `(error: ${on.error})`;
  const b = off.reply?.text ?? `(error: ${off.error})`;
  console.log(`  shape ${SHAPE}: ${first} → ${second}`);
  console.log(`    worn  ${a.replace(/\n+/g, ' ')}`);
  console.log(`    base  ${b.replace(/\n+/g, ' ')}`);
  console.log(`    ${a === b ? 'IDENTICAL' : 'different'}\n`);
}

console.log(`  ${QUESTIONS.length - identical}/${QUESTIONS.length} replies changed when the adapter went on`);
console.log(`  ${leaked} leaked a figure (must be 0)\n`);
process.exit(identical === QUESTIONS.length || leaked > 0 ? 1 : 0);
