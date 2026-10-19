/* asks-rows.mjs — what the trained asks check's rows share: the contract the
 * app sends, the hold-out rule, and the checks a lure pair must pass.
 *
 * The contract is exactly what src/verify.js sends today (HANDOFF-PIGEON-DEV-3):
 * the system line, the ten ASKS_SHOTS as user/assistant turns, then the user
 * turn ASKS_USER_TURN_TEMPLATE fills with the message, answered YES or NO. The
 * message alone; no chosen skill is part of the turn. A Runner trims the input
 * (§8.2), so the message is trimmed before it is filled in.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ASKS_SYSTEM, ASKS_SHOTS, ASKS_USER_TURN_TEMPLATE } from '../../src/verify.js';
import { norm, words, jaccard, HELD_OUT_REACH } from './planner-rows-2.mjs';
import { HOLDOUT } from '../holdout.mjs';
import { NO_SKILL_MESSAGES } from '../no-skill-set.mjs';

export const fill = (message) => ASKS_USER_TURN_TEMPLATE.split('{message}').join(String(message).trim());

/** One training row, as Flight School packs `patch-asks` (system and shots trained with, D85–D87). */
export function asksRow (message, label) {
  if (label !== 'YES' && label !== 'NO') throw new Error(`label must be YES or NO, not ${label}`);
  return {
    messages: [
      { role: 'system', content: ASKS_SYSTEM },
      ...ASKS_SHOTS.flatMap(([m, a]) => [{ role: 'user', content: fill(m) }, { role: 'assistant', content: a }]),
      { role: 'user', content: fill(message) },
      { role: 'assistant', content: label }
    ]
  };
}

/** Everything the benches grade on: the planner bench's 308 and 100, the 152
 *  twin messages, and followups.mjs's quoted phrases. */
export function heldOut (root) {
  const followups = readFileSync(join(root, 'scripts/followups.mjs'), 'utf8');
  const twin = JSON.parse(readFileSync(join(root, 'bench/twin-colist.json'), 'utf8')).pairs.flatMap(p => p.messages);
  const all = [...HOLDOUT.map(([m]) => m), ...NO_SKILL_MESSAGES, ...twin, ...[...followups.matchAll(/'([^'\n]{4,})'/g)].map(m => m[1])];
  return { exact: new Set(all.map(norm)), sets: all.map(words).filter(s => s.size >= 3), size: all.length };
}

export function closeTo (message, held) {
  if (held.exact.has(norm(message))) return true;
  const w = words(message);
  return held.sets.some(s => jaccard(w, s) >= HELD_OUT_REACH);
}

export const SHOT_MESSAGES = new Set(ASKS_SHOTS.map(([m]) => norm(m)));

/* A NO lure that reads like a request is the failure that matters: it would
   teach the check to refuse real asks. These shapes are flagged for review,
   not dropped — "can't believe how many hours I lost" is a fine lure. */
const REQUESTISH = /^(please|pls|can you|could you|would you|will you|can i|could i|i need|i want|i'd like|give me|show me|tell me|make|convert|calculate|work out|figure out|find|list|check|count|sort|turn|write|generate|format|what('s| is| are| was)|how (many|much|long|far|old)|which|when (is|was|does)|is (it|this|there)|does|do)\b/i;
export function lureFlags ({ no, yes }) {
  const flags = [];
  if (REQUESTISH.test(String(no).trim())) flags.push('NO reads like a request');
  if (/\?\s*$/.test(String(no).trim())) flags.push('NO is a question');
  if (String(no).split(/\s+/).length > 25 || String(yes).split(/\s+/).length > 25) flags.push('over 25 words');
  if (jaccard(words(no), words(yes)) < 0.15) flags.push('YES and NO share few words');
  return flags;
}
