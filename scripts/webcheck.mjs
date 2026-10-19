#!/usr/bin/env node
/* webcheck.mjs — the live half of the web tier's tests.
 *
 * `npm test` runs the web skills against recorded provider replies, so it is
 * fast, offline and deterministic — and it therefore cannot tell you that the
 * providers still work. This can, and is deliberately NOT part of `npm test`:
 * a suite that fails because a public API is having a bad afternoon is a suite
 * people learn to ignore.
 *
 * It checks the two things fixtures cannot: that the endpoints still answer,
 * and that they still answer in the shape the skills parse.
 */
import { proxySearch } from '../src/search.js';
import entries from '../skills/index.js';

const BASE = process.env.PIGEON_SERVE || 'http://127.0.0.1:4173';
const search = proxySearch({ base: BASE });

const QUERIES = ['governor of Maryland', 'Ada Lovelace', 'capital of Mongolia'];
const skills = Object.fromEntries(entries.filter(e => e.needsNetwork).map(e => [e.name, e]));

let fail = 0;
const say = (ok, msg) => { if (!ok) fail++; console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${msg}`); };

if (!(await search.health())) {
  console.error(`\n  No dev server on ${BASE}. Start one with \`npm run serve\`.\n`);
  process.exit(1);
}
console.log(`\n  live provider check via ${BASE}\n`);

for (const q of QUERIES) {
  let reply;
  try { reply = await search(q); }
  catch (e) { say(false, `${q} — request failed: ${e.message}`); continue; }

  say(Boolean(reply.answer), `${q} — provider returned a direct answer`);
  say(Boolean(reply.source), `${q} — the answer carries a source`);
  say(reply.results.length > 0, `${q} — ${reply.results.length} pages returned`);

  /* The shape check that matters: run the real skills over the live reply and
     require a valid envelope. A provider that renames a field breaks here
     rather than in front of a user. */
  const ctx = { webEnabled: true, search: async () => reply };
  for (const name of ['webAnswer', 'webSearch']) {
    const skill = skills[name];
    if (!skill) { say(false, `${name} is not in the registry`); continue; }
    const field = name === 'webAnswer' ? 'question' : 'query';
    const env = await skill.run({ [field]: q }, ctx);
    say(env && env.ok === true, `${q} — ${name} accepted the live reply${env && !env.ok ? ` (${env.error.code}: ${env.error.message})` : ''}`);
    if (env && env.ok) {
      say(env.provenance.kind === 'web' && Boolean(env.provenance.source),
        `${q} — ${name} marked it as a web value with a source`);
    }
  }
  console.log('');
}

console.log(fail ? `  ${fail} check(s) failed\n` : '  all live checks passed\n');
process.exit(fail ? 1 : 0);
