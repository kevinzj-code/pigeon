#!/usr/bin/env node
/* lintcards.mjs — run src/lint-cards.js over the registry and print the
 * worklist. The suite runs the same check as a regression floor; this is the
 * version a person reads while rewriting.
 *
 *   node scripts/lintcards.mjs            every finding
 *   node scripts/lintcards.mjs --same     same-category pairs only
 *   node scripts/lintcards.mjs --count    just the number
 */
import entries from '../skills/index.js';
import { buildRegistry } from '../src/registry.js';
import { confusablePairs, formatPairs } from '../src/lint-cards.js';

const argv = process.argv.slice(2);
const registry = buildRegistry(entries);
const built = registry.routable();
const desc = (n) => registry.skill(n)?.description ?? '';

let pairs = confusablePairs(built);
if (argv.includes('--same')) pairs = pairs.filter(p => p.sameCategory);

if (argv.includes('--count')) { console.log(pairs.length); process.exit(0); }

const total = built.length * (built.length - 1) / 2;
console.log(`\n  ${built.length} skills · ${total.toLocaleString('en-GB')} pairs · ${pairs.length} read alike without saying which way they run\n`);
console.log(formatPairs(pairs, desc));
console.log(`  Rewrite rules: give a skill the words its OWN users would type and never its twin's;`);
console.log(`  stay verb-led (the failure renderer says "Couldn't {description}"); say which way it runs.\n`);
