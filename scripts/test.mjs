#!/usr/bin/env node
/* test.mjs — §9's gates, as a script.
 *
 * "Registry drift. 300 skills with schemas and examples is a maintenance
 *  surface. Tests that execute every example are the only thing that keeps it
 *  honest." (§11)
 *
 * So: every registry entry is linted, every example is EXECUTED and compared
 * to its stated output, every error case is executed and compared to its
 * stated error code, every replyTemplate is rendered, and every rendered reply
 * is run through the fabrication auditor. A skill that cannot do all five is
 * not a Core skill. */

import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import entries from '../skills/index.js';
import { buildRegistry, lintEntry } from '../src/registry.js';
import { validate } from '../src/schema.js';
import { render, toPlainText } from '../src/template.js';
import { auditSegments } from '../src/fabrication.js';
import { deviceCtx, mergeInput } from '../src/ctx.js';
import { validatePlan, normalisePlanRefs } from '../src/plan.js';
import { runPlan, resolveRefs } from '../src/executor.js';
import { LexicalRouter } from '../src/router.js';
import { categoryRouter, FALLBACK_FLOOR, CATEGORY_SHOTS, CATEGORY_SYSTEM, trainedSystemFor, WIDENING } from '../src/category-router.js';
import { isDeepStrictEqual } from 'node:util';
import { copyOf, answerOf, NO_SKILL } from '../src/transcript.js';
import { parseBlob, titleFrom, canPersist, saveState, loadState, flush, STATE_VERSION, forDisk, blobVersion, READ_INTERRUPTED } from '../src/store.js';
import { pathOf, siblingsOf, siblingIndex, linkTurn, switchTo, replaceTurn, migrateChat, pendingAsk } from '../src/thread.js';
import { byActivity, isEmpty, hasDraft, lastCompletedIn, startInflight, fileReply, settleInterrupted, INTERRUPTED, togglePin, toggleMute, markUnread, searchAll, markRead, setReaction, forwardTarget, forwardedFrom } from '../src/chats.js';
import { turnHtml, inflightHtml, queuedHtml, emptyChatHtml, needsStamp, laneBFlow, tookAsHtml, hoverHtml } from '../src/ui/bubbles.js';
import { OUTCOME } from '../src/contracts.js';
import { messageInfoHtml } from '../src/ui/info.js';
import { bannerHtml } from '../src/ui/banner.js';
import { esc as escHtml, rowTime, dayName } from '../src/ui/html.js';
import { pigeonOf, pigeonList, factLine, pickForChat, chatFieldsFor, avatarHtml, toListHtml, jobFields, declaresImage, setPeekModel, pictureLine, isPeek } from '../src/ui/pigeons.js';
import { chatDetailsHtml, profileHtml, removedHtml } from '../src/ui/details.js';
import { deriveCard } from '../src/ui/card.js';
import { settingsHtml, SETTINGS_TABS, KEPT_HERE } from '../src/ui/settings.js';
import { sameOrigin } from './lib/same-origin.mjs';
import { chatMenuItems, menuHtml, messageMenuItems, forwardMenuItems, pigeonMenuItems } from '../src/ui/menu.js';
import { previewOf, rowHtml, chatListHtml, searchHtml, pigeonsTabHtml, replyText } from '../src/ui/sidebar.js';
import { runTurn, MODES, stackReport, answerFor } from '../src/turn.js';
import { splitSentences, sentenceFocus, FOCUS_SYSTEM, FOCUS_SHOTS } from '../src/focus.js';
import { replyFor, REPLY_SOURCES, answeringStep, templateFor } from '../src/reply.js';
import { auditInput, spentFigures } from '../src/audit-input.js';
import { jsExtractor } from '../src/extractor.js';
import { siblingCheck, declineCheck, siblingUserTurn, asksCheck, ASKS_SHOTS,
         ASKS_SYSTEM, ASKS_USER_TURN_TEMPLATE, asksUserTurn, DECLINE_SYSTEM, DECLINE_SHOTS,
         SIBLING_SYSTEM, SIBLING_SYSTEM_TRAINED, SIBLING_SHOTS } from '../src/verify.js';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { HOLDOUT } from './holdout.mjs';
import { NO_SKILL_MESSAGES } from './no-skill-set.mjs';
import { VARIANTS, plannerOptions, declineOptions } from './prompt-variants.mjs';
import { plannerUserMessage, plannerSystem, renderCard, SHOTS, RUNWAY_RULE } from '../src/planner.js';
import { verdict, report, BASE_FLAGS } from './benchqueue.mjs';
import { FORBIDDEN } from './forbidden.mjs';
import { confusablePairs, overlap } from '../src/lint-cards.js';
import { cleanupOcr, auditCleanup, stripThinking, cleanupBudget, composeMessage, capAttached, describeAttachment, ATTACH_CAP } from '../src/ocr.js';
import { fmtBytes, fmtRam, fitLine, engineRows, progressLine, needsFirstRun, firstRunHtml, progressHtml, CANCELLED, wakeCategory, laneDownText } from '../src/engine.js';
import { wallViolations, importsIn, formatViolations, LANE_B_CALLERS, lockedRoomViolations } from '../src/lint-imports.js';
import { segmentsHtml, provenanceLine } from '../src/segments.js';
import { stateLine } from '../src/popover.js';
import { barState, receiptLine } from '../src/bar.js';
import { readTree } from './lintimports.mjs';
import { numeralsIn, needsHandoff, wantsANumber, HANDOFF_TEXT } from '../src/lane-b/handoff.js';
import { runChat, messagesFor, CHAT_SYSTEM, HISTORY_TURNS } from '../src/lane-b/chat.js';
import { CONVERSATIONAL, isHeldOut, normalise } from './conversational.mjs';
import { detectFormat, parseCues, isTranscript, joinRun, midSentenceJoins,
         stripStutters, stripFillers, mechanicalClean, FILLERS,
         auditRepair, boundedEdits, changedWords,
         worthTidying, OFFER_MIN_CHARS } from '../src/captions.js';
import { corrupt, mulberry, LEVELS } from './transcript-corrupt.mjs';
import { tidyTranscript, chunk, repairBudget, REPAIR_SYSTEM, tidyBridge } from '../src/captions-tidy.js';
import { defaultSettings, WEB_LOG_CAP, normaliseSettings } from '../src/store.js';
import { slotFor, groupFor, dayWords, GROUPS, ago, fullStamp } from '../src/ui/time.js';
import { statusLine, wakeEta, restartEta, TAKING_LONGER } from '../src/ui/status.js';
import { enqueue, next as nextQueued, take as takeQueued, drop as dropQueued, skipAsk, askOpen } from '../src/queue.js';
import { patchFollowUpNote, oneShotNote, lengthNote, noteHtml, NOTE_SKIP_LIMIT, testedLengthNote } from '../src/ui/notes.js';
import { quoteBarHtml, memoryEdgeIndex, memoryEdgeHtml } from '../src/ui/replybar.js';
import { markFor, markLabel, copyText, copyWithSource, humanise, webSource, tookAs, MARKS } from '../src/ui/marks.js';
import { citationFor, citationHtml, computedPassage, webPassage, spanOf } from '../src/ui/cite.js';
import * as fsSeal from 'node:fs';
import * as osSeal from 'node:os';
import { sealChecks } from './lib/seal.checks.mjs';
import { sealZip, keyId as sealKeyId } from './lib/seal.mjs';
import { buildStoreZip } from './lib/zip-store.mjs';
import { loadPigeon } from './lib/pigeon-load.mjs';
import { diffRecords } from './benchdiff.mjs';
import { patchData, importClosure } from './export-pigeon-stage.mjs';
import { optionsFrom, checkTrainedSystem } from '../src/patch-options.js';
import { stripForWorker, ctxForWorker, proxyEntry, runRequest, runReply, errorReply, isValidCodeBase, absoluteCodeBase, createCaller } from '../src/skill-protocol.js';
import { loadPatch, patchSource } from '../src/patch-pack.js';
import { nodeSkillWorker } from './lib/node-skill-worker.mjs';
import { assembleStack } from '../src/stack.js';
import { SYSTEM as PLANNER_SYSTEM } from '../src/planner.js';
const HOLDOUT_MESSAGES = HOLDOUT.map(x => x[0]);

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

let pass = 0, fail = 0;
const failures = [];

/* Assertions may be async (anything touching the executor is). They are
   collected and awaited together at the end rather than awaited inline, so one
   slow check never serialises the suite. */
const pending = [];
function check (name, fn) {
  let r;
  try { r = fn(); }
  catch (e) { return record(name, `threw: ${e && e.message}\n${(e && e.stack || '').split('\n').slice(1, 3).join('\n')}`); }
  if (r && typeof r.then === 'function') {
    pending.push(r.then(v => record(name, v), e => record(name, `threw: ${e && e.message}`)));
    return;
  }
  record(name, r);
}
function record (name, r) {
  if (r === true || r === undefined) { pass++; return; }
  fail++; failures.push(`${name}\n    ${r}`);
}

const FIXED_CTX = {
  now: '2026-09-01T09:00:00Z', timezone: 'UTC', locale: 'en-GB',
  units: 'metric', webEnabled: false, confirmBeforeNetwork: true
};

const registry = buildRegistry(entries);

const kebab = (s) => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

/* ── 1. the manifest matches the folder ─────────────────────────────────── */
check('manifest lists every skill file', () => {
  const files = readdirSync(join(ROOT, 'skills'))
    /* "_"-prefixed modules export SEVERAL entries (the stub list), so their
       filename can't be derived from any one skill name. They are checked by
       the stub-policy test below instead. */
    .filter(f => f.endsWith('.js') && f !== 'index.js' && !f.startsWith('_'))
    .map(f => f.replace(/\.js$/, ''));
  const listed = new Set(entries.map(e => kebab(e.name)));
  const missing = files.filter(f => !listed.has(f));
  return missing.length === 0 || `not exported from skills/index.js: ${missing.join(', ')} — run \`npm run manifest\``;
});

/* ── 1b. the UI parses ──────────────────────────────────────────────────
   app.js is the one module the suite cannot exercise (it needs a DOM), which
   made it the one module a syntax error could reach the browser through — and
   did, once, as a blank page. Importing it here fails on SyntaxError and
   tolerates the ReferenceError that DOM access correctly raises in Node. */
check('src/app.js parses', async () => {
  try {
    await import('../src/app.js');
    return true;
  } catch (e) {
    if (e instanceof SyntaxError) return `SyntaxError: ${e.message}`;
    /* Only the DOM's absence is forgiven; any other ReferenceError at module
       scope is a real bug. Be clear about the limit, though: this catches one
       ONLY if it is raised before the first DOM access, and app.js touches the
       DOM almost immediately. A function deleted by a bad refactor and still
       called from inside a handler will not be caught here — it was not, once,
       and the app went blank in the browser while this test stayed green.
       Executing app.js properly needs a DOM the suite does not have, which is
       the standing argument for keeping logic OUT of this file: thread.js,
       store.js and transcript.js are all testable precisely because they are
       not app.js. */
    if (e instanceof ReferenceError) {
      const absent = /\b(document|window|navigator|localStorage|performance|requestAnimationFrame)\b is not defined/.test(e.message);
      return absent ? true : `ReferenceError that is not the missing DOM: ${e.message}`;
    }
    return true;
  }
});

/* ── 2. every entry lints ───────────────────────────────────────────────── */
for (const e of registry.all()) {
  check(`lint ${e.name}`, () => {
    const p = lintEntry(e);
    return p.length === 0 || p.join('\n    ');
  });
}

/* ── 3. §5 stub policy: no unbuilt entry is reachable by the router ──────── */
check('router index excludes unbuilt entries (§5 stub policy)', () => {
  const leaked = registry.routable().filter(e => e.unbuilt);
  return leaked.length === 0 || `unbuilt entries in routable(): ${leaked.map(e => e.name).join(', ')}`;
});

/* ── 4. every example executes to its stated output ─────────────────────── */
for (const e of registry.routable()) {
  for (const [i, ex] of (e.examples || []).entries()) {
    const ctx = { ...FIXED_CTX, ...(ex.ctx || {}) };
    check(`${e.name} example[${i}] "${ex.text.slice(0, 52)}"`, async () => {
      const v = validate(e.inputSchema, ex.input);
      if (!v.ok) return `input fails its own schema: ${v.errors.map(x => `${x.field}: ${x.message}`).join('; ')}`;
      /* run() may be async — §4.1's contract is `fn(input, ctx) → Promise<Envelope>`,
         and anything touching crypto.subtle genuinely is. */
      const env = await e.run(mergeInput(v.value, ctx), ctx);
      if (!env || typeof env !== 'object') return 'run() returned nothing';
      if (!env.ok) return `run() failed: ${env.error.code} ${env.error.message}`;

      if (e.nondeterministic) {
        /* No fixed output to compare against — the skill's own verify() states
           what must hold every time (length, alphabet, format, uniqueness). */
        const verdict = e.verify(env.value, v.value);
        if (verdict !== true) return `verify() rejected its own output: ${verdict}`;
      } else {
        const got = JSON.stringify(env.value);
        const want = JSON.stringify(ex.output);
        if (got !== want) return `output differs\n      got  ${got}\n      want ${want}`;
      }
      const ov = validate(e.outputSchema, env.value);
      if (!ov.ok) return `output fails outputSchema: ${ov.errors.map(x => `${x.field}: ${x.message}`).join('; ')}`;
      return true;
    });

    /* ── 5. the template renders, and the rendered reply fabricates nothing ── */
    if (e.replyTemplate) {
      check(`${e.name} example[${i}] template + fabrication check`, async () => {
        const env = await e.run(mergeInput(validate(e.inputSchema, ex.input).value, ctx), ctx);
        if (!env.ok) return true;
        const segs = render(e.replyTemplate, env.value, {
          skill: e.name, input: ex.input, provenance: env.provenance, locale: ctx.locale
        });
        const text = toPlainText(segs);
        if (/\{\{|\}\}/.test(text)) return `unsubstituted token in reply: ${text}`;
        if (/undefined|\[object/.test(text)) return `reply reads wrong: ${text}`;
        /* The whole envelope is passed, not just the substituted spans. A
           `|prose` token like "50 words over" is a sentence the SKILL composed
           from its own verified output — every number in it is in `value`, so
           it traces exactly as a marked span does. Auditing the prose against
           only the marked spans would flag the skill's own arithmetic. */
        const audit = auditSegments(segs, {
          message: ex.text,
          results: [{ ok: true, value: env.value, input: ex.input }]
        });
        return audit.ok || `fabricated: ${audit.violations.map(v => v.token).join(', ')} in "${text}"`;
      });
    }
  }

  /* ── 6. every error case fails the way it says it does ──────────────────── */
  for (const [i, ec] of (e.errorCases || []).entries()) {
    check(`${e.name} errorCase[${i}] → ${ec.code}`, async () => {
      const ctx = { ...FIXED_CTX, ...(ec.ctx || {}) };
      const v = validate(e.inputSchema, ec.input);
      if (!v.ok) {
        const codes = v.errors.map(x => x.code);
        if (!codes.includes(ec.code)) return `schema gave ${codes.join(',')}, expected ${ec.code}`;
        if (ec.code === 'MISSING_FIELD') {
          const m = v.errors.find(x => x.code === 'MISSING_FIELD');
          if (!m.prompt) return 'MISSING_FIELD carries no prompt, so ASK_USER would have nothing to say';
        }
        return true;
      }
      let env;
      try { env = await e.run(mergeInput(v.value, ctx), ctx); }
      catch (err) { return `run() threw instead of returning a failure envelope: ${err.message}`; }
      if (!env || env.ok) return `expected ${ec.code}, got a success envelope`;
      return env.error.code === ec.code || `expected ${ec.code}, got ${env.error.code} (${env.error.message})`;
    });
  }
}

/* ── 6b. a declared-nondeterministic skill must really be nondeterministic ── */
for (const e of registry.routable().filter(s => s.nondeterministic)) {
  check(`${e.name} is genuinely nondeterministic`, async () => {
    const ex = e.examples[0];
    const input = mergeInput(validate(e.inputSchema, ex.input).value, FIXED_CTX);
    /* If every call agrees, the skill is deterministic and should be declared
       so, with real example outputs — the flag would be silently disabling a
       check. Eight calls, not two: a draw from 20 answers repeats itself
       one time in twenty, which failed this check for a skill that was fine. */
    const seen = new Set();
    for (let i = 0; i < 8; i++) {
      const r = await e.run(input, FIXED_CTX);
      if (!r.ok) return 'run() failed';
      seen.add(JSON.stringify(r.value));
    }
    return seen.size > 1 || 'eight runs produced identical output — drop the flag and use real examples';
  });
}

/* ── 6a2. the clipboard says what the screen says ───────────────────────────
   `copyOf` mirrors paintTurn's four branches by hand, because reading the
   rendered DOM would copy the markup's concatenations rather than the reply.
   A hand-written mirror drifts unless something holds the two together; this
   is that something. Run over a real turn per skill, so the pipeline that
   produces a reply is the same one that produces the copy. */
{
  const lex = new LexicalRouter(registry);
  const ctx = { ...FIXED_CTX };

  check('a typing slip is read as the word it missed, and a different word is left alone', () => {
    const typo = lex.route('Who is the current govenor of Virginia?').forPlanner.map(c => c.name);
    const right = lex.route('Who is the current governor of Virginia?').forPlanner.map(c => c.name);
    if (typo[0] !== right[0]) return `"govenor" leads with ${typo[0]}, "governor" with ${right[0]}`;
    const read = (w) => lex.repair([w])[0];
    for (const [slip, word] of [['govenor', 'governor'], ['untill', 'until'], ['captial', 'capital']]) {
      if (read(slip) !== word) return `"${slip}" was read as "${read(slip)}"`;
    }
    for (const w of ['party', 'flight', 'pavement', 'smell', 'storey']) if (read(w) !== w) return `"${w}" was changed to "${read(w)}"`;
    return true;
  });

  check('NO_SKILL in transcript.js matches MODES.NO_SKILL', () =>
    NO_SKILL === MODES.NO_SKILL || `transcript says "${NO_SKILL}", turn.js says "${MODES.NO_SKILL}"`);

  /* A sample, not all 301: each case runs a full turn through the executor. */
  for (const e of registry.routable().filter(x => x.replyTemplate).slice(0, 40)) {
    const ex = e.examples[0];
    check(`${e.name} copyOf() matches the rendered reply`, async () => {
      const turn = await runTurn(ex.text, {
        registry, router: lex, ctx: { ...ctx, ...(ex.ctx || {}) },
        plan: { steps: [{ id: 's1', skill: e.name, input: ex.input }] }
      });
      if (!turn.reply) return true;
      const want = toPlainText(turn.reply.segments);
      const got = answerOf(turn);
      if (got !== want) return `copy says ${JSON.stringify(got)}, screen says ${JSON.stringify(want)}`;
      return copyOf(turn).includes(want) || 'copyOf() dropped the answer';
    });

    /* ── the step id every value segment must carry ───────────────────────
       The value-detail view resolves a marked span back to the step that
       produced it. A plan may run one skill twice, so the skill name cannot
       do it; without a step id the view would have to guess. */
    check(`${e.name} value segments carry a resolvable step id`, async () => {
      const turn = await runTurn(ex.text, {
        registry, router: lex, ctx: { ...ctx, ...(ex.ctx || {}) },
        plan: { steps: [{ id: 's1', skill: e.name, input: ex.input }] }
      });
      if (!turn.reply) return true;
      const ids = new Set((turn.results || []).map(r => r.id));
      const orphan = turn.reply.segments
        .filter(sg => sg.type === 'value')
        .find(sg => !sg.step || !ids.has(sg.step));
      return !orphan || `value "${orphan.text}" has step ${JSON.stringify(orphan.step)}, not among ${[...ids].join(',')}`;
    });
  }
}

/* ── 6b2. the chat log: what survives a round trip ─────────────────────────
   A saved turn is JSON. If a skill ever returns a Date, a Map, an undefined or
   a NaN, JSON.stringify drops or mangles it and the saved history quietly stops
   matching what was on screen — with nothing anywhere to notice. This is the
   thing that notices. */
{
  const lex = new LexicalRouter(registry);

  for (const e of registry.routable().slice(0, 80)) {
    const ex = e.examples[0];
    check(`${e.name} turn survives being saved and read back`, async () => {
      const turn = await runTurn(ex.text, {
        registry, router: lex, ctx: { ...FIXED_CTX, ...(ex.ctx || {}) },
        plan: { steps: [{ id: 's1', skill: e.name, input: ex.input }] }
      });
      const back = JSON.parse(JSON.stringify(turn));
      /* Compare the fields the UI actually reads. A whole-object deep-equal
         would fail on `undefined` keys that JSON legitimately drops and that
         nothing renders. */
      const lens = (t) => ({
        message: t.message, mode: t.mode,
        plan: t.plan,
        results: (t.results || []).map(r => ({
          id: r.id, skill: r.skill, input: r.input, ok: r.ok,
          value: r.value, error: r.error, provenance: r.provenance
        })),
        segments: t.reply ? t.reply.segments : null,
        source: t.reply ? t.reply.source : null
      });
      const a = JSON.stringify(lens(turn));
      const b = JSON.stringify(lens(back));
      return a === b || `saved history differs from what was rendered\n      was  ${a.slice(0, 220)}\n      back ${b.slice(0, 220)}`;
    });
  }

  /* ── the saved-file rules ──────────────────────────────────────────────── */
  const v1 = JSON.stringify({ version: 1, activeChatId: 'a', chats: [{ id: 'a', title: 'Hi', turns: [] }] });

  check('parseBlob accepts a file it wrote', () => {
    const out = parseBlob(v1);
    return (out && out.chats.length === 1 && out.activeChatId === 'a') || `got ${JSON.stringify(out)}`;
  });

  /* A file from a NEWER build must not be downgraded. Silently rewriting it in
     an older shape would delete chats the user still has. */
  check('parseBlob refuses a file from a newer build', () =>
    parseBlob(JSON.stringify({ version: 99, chats: [] })) === null || 'accepted a version it cannot know');

  check('parseBlob refuses junk rather than throwing', () => {
    for (const bad of ['', '   ', 'not json', '[]', 'null', '{}', JSON.stringify({ chats: [] })]) {
      let got;
      try { got = parseBlob(bad); }
      catch (err) { return `threw on ${JSON.stringify(bad)}: ${err.message}`; }
      if (got !== null) return `accepted ${JSON.stringify(bad)}`;
    }
    return true;
  });

  check('parseBlob drops chat records it cannot use', () => {
    const out = parseBlob(JSON.stringify({
      version: 1, activeChatId: 'gone',
      chats: [{ id: 'a', turns: [] }, { id: 'b' }, null, { turns: [] }]
    }));
    return (out && out.chats.length === 1 && out.activeChatId === 'a')
      || `got ${JSON.stringify(out)}`;
  });

  /* Version 2 adds a settings block. A version-1 file is upgraded, not
     refused, and a version-2 file's first-run record survives the round trip. */
  check('parseBlob upgrades a v1 file to the current version with default settings', () => {
    const out = parseBlob(v1);
    return (out && out.version === STATE_VERSION && JSON.stringify(out.settings) === JSON.stringify(defaultSettings()))
      || `got ${JSON.stringify(out && out.settings)}`;
  });
  check('parseBlob keeps a v2 first-run record and drops what it does not know', () => {
    const out = parseBlob(JSON.stringify({
      version: 2, activeChatId: 'a', chats: [{ id: 'a', nodes: {} }],
      settings: { firstRun: { seenAt: 1757400000000, choice: 'declined', extra: 1 }, unknown: true }
    }));
    return (out && out.settings.firstRun.choice === 'declined' && out.settings.firstRun.seenAt === 1757400000000
      && !('extra' in out.settings.firstRun) && !('unknown' in out.settings))
      || `got ${JSON.stringify(out && out.settings)}`;
  });
  check('parseBlob repairs a junk settings block instead of refusing the file', () => {
    const out = parseBlob(JSON.stringify({ version: 2, chats: [{ id: 'a', nodes: {} }], settings: 'nope' }));
    return (out && out.settings.firstRun.choice === null) || `got ${JSON.stringify(out && out.settings)}`;
  });

  check('a browser with no bridge saves nothing and does not throw', async () => {
    if (canPersist()) return 'canPersist() is true under Node, where there is no Tauri';
    saveState({ version: 1, chats: [] });
    await flush();
    return (await loadState()) === null || 'loadState invented something';
  });

  check('titleFrom names a chat from its first message', () => {
    const cases = [
      ['', 'New chat'], ['   ', 'New chat'],
      ['how many days till 14 nov', 'how many days till 14 nov'],
      ['a  b\n c', 'a b c'],
      ['x'.repeat(42), 'x'.repeat(42)],
      ['y'.repeat(43), `${'y'.repeat(42)}…`]
    ];
    for (const [input, want] of cases) {
      const got = titleFrom(input);
      if (got !== want) return `titleFrom(${JSON.stringify(input)}) = ${JSON.stringify(got)}, want ${JSON.stringify(want)}`;
    }
    return true;
  });

  /* ── version 3: what a messaging app keeps about a conversation ──────────
     Pins, alerts, unread counts, where a chat came from, when something last
     happened in it, a question in flight, and a draft with its attachments.
     Every one has a safe default, so no older file loses anything. */
  const v2 = JSON.stringify({
    version: 2, activeChatId: 'a',
    settings: { firstRun: { seenAt: null, choice: 'accepted' }, lastPick: 'patch' },
    chats: [{ id: 'a', title: 'Dinner split', renamed: true, lane: 'A', createdAt: 5, updatedAt: 9,
      nodes: { t1: { id: 't1', message: 'split 84.50 4 ways', at: 7, parentId: null, activeChildId: null } }, activeRootId: 't1' }]
  });

  check('a v2 file upgrades to v3 with safe defaults for every new field', () => {
    const out = parseBlob(v2);
    const c = out && out.chats[0];
    return (out && out.version === STATE_VERSION && c.renamed === true && c.pinnedAt === null && c.muted === false && c.unread === 0
      && c.source === null && c.lastActivityAt === 7 && c.inflight === null && c.draft === null
      && out.settings.theme === 'system' && out.settings.bannersOff === false && out.settings.lastPick === 'patch'
      && out.settings.firstRun.choice === 'accepted') || `got ${JSON.stringify(out)}`;
  });

  check('a flat v1 chat takes its last activity from its newest turn', () => {
    const out = parseBlob(JSON.stringify({ version: 1, chats: [{ id: 'f', createdAt: 3,
      turns: [{ id: 'a', message: 'one', at: 11 }, { id: 'b', message: 'two', at: 12 }] }] }));
    return (out && out.version === STATE_VERSION && out.chats[0].lastActivityAt === 12) || `got ${JSON.stringify(out && out.chats[0])}`;
  });

  check('a v3 file round-trips unchanged', () => {
    const first = parseBlob(v2);
    const again = parseBlob(JSON.stringify(first));
    return JSON.stringify(again) === JSON.stringify(first) || `changed on the second load:\n      ${JSON.stringify(again).slice(0, 240)}`;
  });

  check('junk in the new fields is repaired, not trusted', () => {
    const out = parseBlob(JSON.stringify({ version: 3,
      chats: [{ id: 'a', nodes: {}, pinnedAt: 'yes', muted: 'true', unread: -4, source: 'email', inflight: { message: 7 }, draft: { text: 5 } }],
      settings: { theme: 'neon', bannersOff: 'yes', webDefault: 1, webPolicy: 'always', lastWakeMs: 50, sleepAfter: 5, saveMenuBar: 'no', tips: [] } }));
    const c = out && out.chats[0];
    return (c && c.pinnedAt === null && c.muted === false && c.unread === 0 && c.source === null && c.inflight === null
      && c.draft === null && out.settings.theme === 'system' && out.settings.bannersOff === false
      && out.settings.webPolicy === 'press' && !('webDefault' in out.settings) && out.settings.lastWakeMs === null
      && out.settings.sleepAfter === 600 && out.settings.saveMenuBar === true && JSON.stringify(out.settings.tips) === '{}')
      || `got ${JSON.stringify(out)}`;
  });

  /* An older build refusing a newer file used to go on to overwrite it with its
     own empty state. The file is now recognised as NEWER, so nothing writes. */
  check('a file from a newer build is recognised as newer rather than as junk', () => {
    const raw = JSON.stringify({ version: STATE_VERSION + 1, chats: [] });
    return (parseBlob(raw) === null && blobVersion(raw) === STATE_VERSION + 1 && blobVersion('not json') === null)
      || 'a newer file was not recognised as newer';
  });

  /* The pixels have never touched disk, and a saved draft is no reason to
     start: the chip keeps what the engine READ, not the picture. */
  check('a saved draft keeps what its image chip read and never the pixels', () => {
    const c = { id: 'a', nodes: {}, draft: { text: 'split this', height: '48px', transcript: null, attachment: {
      name: 'receipt.jpg', mime: 'image/jpeg', width: 800, height: 1200, thumb: 'data:image/png;base64,AAAA',
      status: 'ready', raw: 'TOTAL 84.50', cleaned: 'Total 84.50', used: 'cleaned', text: 'Total 84.50',
      edited: false, engine: 'tesseract', seq: 3, editing: true } } };
    const disk = JSON.stringify(forDisk([c]));
    if (/data:image|"thumb"/.test(disk)) return 'the thumbnail reached the file';
    if (!c.draft.attachment.thumb) return 'forDisk changed the chip that is on screen';
    const back = parseBlob(JSON.stringify({ version: 3, chats: JSON.parse(disk) })).chats[0].draft;
    return (back.text === 'split this' && back.attachment.text === 'Total 84.50' && back.attachment.used === 'cleaned'
      && back.attachment.thumb === null && back.attachment.editing === false) || `got ${JSON.stringify(back)}`;
  });

  /* A picture waiting to be SEEN is nothing but its pixels, so none of it is
     saved: the draft comes back with its words and without the chip. A file
     written before this rule is read the same way. A picture already SENT is
     different: its small preview is history, and goes with the question so
     the chat still shows it after a relaunch. */
  check('a picture waiting on the composer is never written, and an old file that has one drops it', () => {
    const pic = { name: 'cat.jpg', mime: 'image/jpeg', width: 800, height: 600, thumb: 'data:image/jpeg;base64,BBBB',
      status: 'ready', error: null, picture: 'data:image/jpeg;base64,' + 'A'.repeat(4000), text: '', forName: 'Peek', chatId: 'a' };
    const c = { id: 'a', nodes: {}, inflight: { message: 'what is it', image: { name: 'cat.jpg', picture: true, thumb: 'data:image/jpeg;base64,CCCC' } }, draft: { text: 'what breed', height: '', transcript: null, attachment: pic } };
    const disk = JSON.stringify(forDisk([c]));
    if (/BBBB|AAAA/.test(disk)) return 'the picture on the composer reached the file';
    if (!/data:image\/jpeg;base64,CCCC/.test(disk)) return 'the sent picture’s preview was dropped from the file';
    if (!c.draft.attachment.picture) return 'forDisk changed the chip that is on screen';
    const back = parseBlob(JSON.stringify({ version: 3, chats: [{ ...c, inflight: null }] })).chats[0].draft;
    return (back && back.text === 'what breed' && !back.attachment) || `got ${JSON.stringify(back)}`;
  });

  check('a reading cut short by quitting says so, and a cut-short tidy keeps the raw reading', () => {
    const load = (a) => parseBlob(JSON.stringify({ version: 3, chats: [{ id: 'a', nodes: {}, draft: { text: 'what is this', attachment: a } }] })).chats[0].draft;
    const reading = load({ name: 'x.png', status: 'reading', raw: null });
    const tidying = load({ name: 'y.png', status: 'tidying', raw: 'TOTAL 12', cleaned: null });
    return (reading.text === 'what is this' && reading.attachment.status === 'failed' && reading.attachment.error === READ_INTERRUPTED
      && tidying.attachment.status === 'ready' && tidying.attachment.used === 'raw' && tidying.attachment.text === 'TOTAL 12')
      || `reading ${JSON.stringify(reading.attachment)} · tidying ${JSON.stringify(tidying.attachment)}`;
  });

  check('a transcript offer cut short mid-tidy comes back offered, with the paste kept', () => {
    const d = parseBlob(JSON.stringify({ version: 3, chats: [{ id: 'a', nodes: {}, draft: { text: 'raw paste',
      transcript: { raw: '00:01 hi', status: 'tidying', seq: 2, chatId: 'a' } } }] })).chats[0].draft;
    return (d.text === 'raw paste' && d.transcript.status === 'offered' && d.transcript.raw === '00:01 hi' && !('seq' in d.transcript))
      || `got ${JSON.stringify(d)}`;
  });

  /* ── filing a reply into the chat it was asked in ────────────────────────
     A reply used to go into whichever chat was open when it LANDED. Switch
     while one is coming and it went into the wrong chat — and, because that
     chat had no turn to hang it off, it became the root and hid that chat's
     history. */
  let r = 0;
  const rid = () => `r${++r}`;
  const mkChat = (id) => ({ id, title: 'New chat', nodes: {}, activeRootId: null, createdAt: 1 });

  check('a reply lands in the chat it was asked in, not the one on screen', () => {
    const a = mkChat('A'), b = mkChat('B');
    fileReply([a, b], 'A', { id: 'a1', message: 'how many km is 26.2 miles', at: 1, results: [{ ok: true }] }, { uid: rid });
    startInflight(a, { message: 'and in feet', parentId: 'a1', sentAt: 50 });
    startInflight(b, { message: 'split 84.50 4 ways', parentId: null, sentAt: 60 });
    fileReply([a, b], 'B', { message: 'split 84.50 4 ways', results: [] }, { uid: rid, now: 70 });
    const inA = fileReply([a, b], 'A', { message: 'and in feet', results: [] }, { uid: rid, now: 80 });
    const pa = pathOf(a).map(t => t.message).join(',');
    const pb = pathOf(b).map(t => t.message).join(',');
    return (pa === 'how many km is 26.2 miles,and in feet' && pb === 'split 84.50 4 ways' && a.activeRootId === 'a1'
      && a.inflight === null && b.inflight === null && inA.turn.at === 50 && a.title === 'how many km is 26.2 miles')
      || `A: ${pa} · B: ${pb} · root ${a.activeRootId} · at ${inA.turn.at} · title ${a.title}`;
  });

  check('a parent that has vanished never makes the reply the root', () => {
    const a = mkChat('A');
    fileReply([a], 'A', { message: 'one', results: [] }, { uid: rid });
    startInflight(a, { message: 'two', parentId: 'gone' });
    fileReply([a], 'A', { message: 'two', results: [] }, { uid: rid });
    const said = pathOf(a).map(t => t.message).join(',');
    return said === 'one,two' || `got ${said}`;
  });

  check('an answered question replaces the turn that asked, by id', () => {
    const a = mkChat('A');
    const asked = fileReply([a], 'A', { message: 'split 62.40 with a 10% tip', ask: { field: 'people' }, results: [] }, { uid: rid }).turn;
    startInflight(a, { message: 'split 62.40 with a 10% tip', parentId: asked.id, pendingAskId: asked.id });
    const done = fileReply([a], 'A', { message: 'split 62.40 with a 10% tip', results: [{ ok: true }] }, { uid: rid }).turn;
    const path = pathOf(a);
    return (path.length === 1 && done.id === asked.id && !path[0].ask) || `path ${JSON.stringify(path)}`;
  });

  check('a reply for a chat deleted meanwhile is filed nowhere', () => {
    const b = mkChat('B');
    const out = fileReply([b], 'A', { message: 'x', results: [] }, { uid: rid });
    return (out.filed === false && pathOf(b).length === 0) || 'it was filed into another chat';
  });

  check('a question in flight when Pigeon closed comes back kept and marked unanswered', () => {
    const a = mkChat('A');
    const first = fileReply([a], 'A', { message: 'one', results: [] }, { uid: rid }).turn;
    startInflight(a, { message: 'what is 15% of 240', parentId: first.id, lane: 'A', sentAt: 99 });
    settleInterrupted(a, { uid: rid });
    const last = pathOf(a).at(-1);
    return (a.inflight === null && last.message === 'what is 15% of 240' && last.interrupted === true
      && last.error === INTERRUPTED && last.at === 99 && lastCompletedIn(a) === null) || `got ${JSON.stringify(last)}`;
  });

  check('a chat whose first question is in flight is not blank', () => {
    const a = mkChat('A');
    if (!isEmpty(a)) return 'a brand-new chat should be empty';
    startInflight(a, { message: 'hi' });
    return !isEmpty(a) || 'a chat with a question in flight was treated as blank, and could be reused';
  });

  check('opening a chat does not reorder the list, and asking does', () => {
    const a = { ...mkChat('A'), lastActivityAt: 10 };
    const b = { ...mkChat('B'), lastActivityAt: 20 };
    if (byActivity([a, b])[0].id !== 'B') return 'the newest activity is not first';
    startInflight(a, { message: 'x', sentAt: 30 });
    return byActivity([a, b])[0].id === 'A' || 'asking did not move the chat up';
  });

  check('a chat a person renamed keeps its name', () => {
    const a = { ...mkChat('A'), title: 'Dinner', renamed: true };
    fileReply([a], 'A', { message: 'split 84.50', results: [] }, { uid: rid });
    return a.title === 'Dinner' || `it was renamed to ${a.title}`;
  });

  /* ── the conversation list ───────────────────────────────────────────────
     Several chats with the same Pigeon, each saying who it is with, what last
     happened in it, and whether anything is still coming. */
  const personas = [
    { id: 'socratic-tutor', name: 'Socratic Tutor', kind: 'persona', loaded: true, bytes: 21118528, shape: 'A' },
    { id: 'note-to-title', name: 'note-to-title', kind: 'text-to-text', loaded: true },
    { id: 'meeting-minutes', name: 'Meeting Minutes', kind: 'persona', loaded: false }
  ];

  check('every chat names its Pigeon and what kind of thing it is', () => {
    const want = [
      [{ lane: 'A' }, 'Patch', 'verified'],
      [{ lane: 'B', personaId: null }, 'Pen', 'base'],
      [{ lane: 'B', personaId: 'socratic-tutor' }, 'Socratic Tutor', 'voice'],
      [{ lane: 'B', personaId: 'note-to-title' }, 'note-to-title', 'job'],
      [{ lane: 'B', personaId: 'deleted-one' }, 'deleted-one', 'missing']
    ];
    for (const [c, name, kind] of want) {
      const d = pigeonOf(pickForChat(c), personas);
      if (d.name !== name || d.kind !== kind) return `${JSON.stringify(c)} → ${d.name} (${d.kind}), want ${name} (${kind})`;
      const back = chatFieldsFor(d.pick);
      if (back.lane !== (c.lane === 'B' ? 'B' : 'A') || (back.personaId ?? null) !== (c.personaId ?? null)) return `${d.pick} does not map back to its chat`;
    }
    return true;
  });

  check('To: pins Patch above the rule, then Recent, then everyone else A–Z, and numbers the first nine that can be messaged', () => {
    const { sections, flat } = pigeonList(personas, { recent: ['pigeon:note-to-title'] });
    const labels = sections.map(s => s.label).join(',');
    if (labels !== ',Recent,Everyone else') return `sections ${labels}`;
    if (!sections[0].pinned || sections[0].items.length !== 1 || sections[0].items[0].pick !== 'patch') return 'Patch is not the pinned section';
    if (flat[0].pick !== 'patch' || flat[1].pick !== 'pigeon:note-to-title') return `flat starts ${flat.slice(0, 2).map(d => d.pick)}`;
    /* The whole point of the pin: he is not a P among the Pigeons you added. */
    const everyone = sections[2].items.map(d => d.name).join(',');
    if (everyone !== 'Meeting Minutes,note-to-title,Pen,Socratic Tutor') return `everyone else ${everyone}`;
    const keys = flat.filter(d => d.key).map(d => d.key).join(',');
    if (keys !== '1,2,3,4,5,6') return `keys ${keys}`;
    /* Recent is drawn from the rest alone, so chatting to Patch never doubles him. */
    const twice = pigeonList(personas, { recent: ['patch'] }).flat.filter(d => d.pick === 'patch');
    if (twice.length !== 1) return `Patch appeared ${twice.length} times`;
    /* Typing a name is a search, so he is a match like anyone else. */
    const named = pigeonList(personas, { q: 'pat' });
    if (named.sections.map(s => s.label).join(',') !== 'Matches' || named.flat[0].pick !== 'patch') return 'a typed name does not find Patch among the matches';
    const typed = pigeonList(personas, { q: 'soc' }).flat;
    return (typed.map(d => d.name).join(',') === 'Socratic Tutor' && !typed[0].key)
      || `typing "soc" found ${JSON.stringify(typed.map(d => [d.name, d.key]))}`;
  });

  check('every Pigeon says what it does and how it answers, never what kind it is', () => {
    const lines = [pigeonOf('patch'), pigeonOf('chat'), pigeonOf('pigeon:socratic-tutor', personas), pigeonOf('pigeon:note-to-title', personas)]
      .map(d => `${d.does} | ${factLine(d)}`);
    const want = [
      'Works out sums, dates, units, money and look-ups | Works it out · starts fresh',
      'Writes anything you ask | Writes · remembers the chat',
      'Talks in its own voice | Writes · remembers the chat',
      'Turns one message into one answer | Writes · starts fresh'
    ];
    if (lines.join('\n') !== want.join('\n')) return lines.join('\n');
    /* A voice remembers only what its measured shape says: B starts fresh, and
       one nobody measured claims neither. */
    const fresh = pigeonOf('pigeon:v', [{ id: 'v', name: 'V', kind: 'persona', loaded: true, shape: 'B' }]);
    const unmeasured = pigeonOf('pigeon:v', [{ id: 'v', name: 'V', kind: 'persona', loaded: true }]);
    if (factLine(fresh) !== 'Writes · starts fresh' || factLine(unmeasured) !== 'Writes' || unmeasured.memory !== 'unmeasured') return `shape: ${factLine(fresh)} / ${factLine(unmeasured)}`;
    /* With no contracts to read, whether it remembers would be a guess. */
    const bare = pigeonOf('pigeon:x', [{ id: 'x', name: 'Mystery', loaded: true }]);
    /* D83: a base voice is a voice, but not a trained one. */
    const based = pigeonOf('pigeon:b', [{ id: 'b', name: 'Plain', kind: 'persona', loaded: true, base_only: true }]);
    if (based.kind !== 'voice' || /trained Pigeon/.test(based.line) || !/no training of its own/.test(based.line)) return `base: ${based.kind} · ${based.line}`;
    if (/no training/.test(fresh.line)) return 'a trained voice is called untrained';
    return (bare.does === 'A Pigeon on this Mac' && factLine(bare) === 'Writes' && !('kindLabel' in bare)) || `claimed ${bare.does} · ${factLine(bare)}`;
  });

  check('an avatar says the kind by its class, and Patch wears the app icon', () => {
    const p = avatarHtml(pigeonOf('patch'), 40);
    const v = avatarHtml(pigeonOf('pigeon:socratic-tutor', personas), 40);
    try { readFileSync(join(ROOT, 'assets/app-icon.png')); } catch { return 'assets/app-icon.png is missing'; }
    return (/av-patch/.test(p) && /src="assets\/app-icon\.png"/.test(p) && /av-voice/.test(v) && />ST</.test(v)) || `${p.slice(0, 80)} · ${v}`;
  });

  check('a Pigeon that carried an icon wears it, and only a base64 png gets through', () => {
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
    const withIcon = [{ ...personas[0], icon: png }, { ...personas[1], icon: png }];
    const voice = avatarHtml(pigeonOf('pigeon:socratic-tutor', withIcon), 40);
    const job = avatarHtml(pigeonOf('pigeon:note-to-title', withIcon), 40);
    if (!/av-img/.test(voice) || !voice.includes(`src="${png}"`) || !/av-img/.test(job)) return `${voice} · ${job}`;
    for (const bad of ['javascript:alert(1)', 'data:image/svg+xml;base64,PHN2Zy8+', 'data:image/png;base64,AAA" onerror="x', 42]) {
      const a = avatarHtml(pigeonOf('pigeon:socratic-tutor', [{ ...personas[0], icon: bad }]), 40);
      if (/av-img|<img/.test(a) || !/>ST</.test(a)) return `let through ${bad}: ${a}`;
    }
    return !/av-img/.test(avatarHtml(pigeonOf('patch'), 40)) || 'Patch keeps his own drawing';
  });

  check('a row shows Draft: only when you are not in that chat', () => {
    const c = { ...mkChat('D'), title: 'Promises', lane: 'B', personaId: 'socratic-tutor', draft: { text: 'ask me questions until I understand', height: '' } };
    const away = previewOf(c, { personas, activeId: 'other' });
    const here = previewOf(c, { personas, activeId: 'D' });
    return (/Draft:/.test(away) && !/Draft:/.test(here)) || `away ${away} · here ${here}`;
  });

  check('a row with a question in flight says so, and a written reply shows its words', () => {
    const busy = { ...mkChat('B1'), lane: 'B', personaId: 'socratic-tutor' };
    startInflight(busy, { message: 'hi', lane: 'B', stage: 'Socratic Tutor is writing' });
    const done = { ...mkChat('B2'), lane: 'B', personaId: 'socratic-tutor' };
    fileReply([done], 'B2', { lane: 'B', message: 'what is a closure', reply: { source: 'generated', text: 'What do you think happens to a variable?' } }, { uid: rid });
    const a = previewOf(busy, { personas });
    const b = previewOf(done, { personas });
    return (/Socratic Tutor is writing…/.test(a) && /Socratic Tutor: What do you think/.test(b)) || `${a} · ${b}`;
  });

  check('a row marks unread and muted chats', () => {
    const c = { ...mkChat('U'), title: 'x', unread: 2, muted: true, lastActivityAt: Date.now() };
    const html = rowHtml(c, { personas });
    return (/udot/.test(html) && /Alerts hidden/.test(html) && /unread/.test(html)) || html;
  });

  check('pinned chats sit above the list in the order they were pinned', () => {
    const a = { ...mkChat('P1'), title: 'first pinned', lastActivityAt: 5 };
    const b = { ...mkChat('P2'), title: 'second pinned', lastActivityAt: 9 };
    const c = { ...mkChat('P3'), title: 'not pinned', lastActivityAt: 7 };
    for (const x of [a, b, c]) fileReply([x], x.id, { message: x.title, results: [] }, { uid: rid, now: x.lastActivityAt });
    togglePin(a, 100); togglePin(b, 200);
    const html = chatListHtml({ chats: [c, b, a], activeId: 'P3', personas });
    const pins = html.slice(0, html.indexOf('crow-wrap'));
    const order = [...pins.matchAll(/data-pin="(P\d)"/g)].map(m => m[1]).join(',');
    if (order !== 'P1,P2') return `pins in order ${order}`;
    togglePin(a);
    return a.pinnedAt === null || 'unpinning did not clear it';
  });

  check('mute and unread flip and stay sane', () => {
    const c = mkChat('M');
    toggleMute(c); if (!c.muted) return 'did not mute';
    toggleMute(c); if (c.muted) return 'did not unmute';
    markUnread(c); if (c.unread !== 1) return `unread ${c.unread}`;
    markUnread(c, false);
    return c.unread === 0 || `unread ${c.unread}`;
  });

  check('search finds a Pigeon, a chat title, and words inside a reply', () => {
    const c = { ...mkChat('S'), title: 'Dinner split' };
    fileReply([c], 'S', { message: 'how many km is 26.2 miles', results: [], lane: 'B', reply: { source: 'generated', text: 'It is about forty-two kilometres' } }, { uid: rid });
    const pigeons = [pigeonOf('patch'), pigeonOf('chat')];
    const byTitle = searchAll([c], pigeons, 'dinner', { textOf: replyText });
    const byReply = searchAll([c], pigeons, 'kilometres', { textOf: replyText });
    const byName = searchAll([c], pigeons, 'pat', { textOf: replyText });
    return (byTitle.chats.length === 1 && byReply.messages.length === 1 && byReply.messages[0].who === 'pigeon'
      && byName.pigeons.length === 1 && /<mark>kilometres<\/mark>/.test(searchHtml('kilometres', { chats: [c], personas })))
      || JSON.stringify({ byTitle, byReply, byName });
  });

  check('the Pigeons tab leads with Patch, says what each one does, loaded or not, and adds a Pigeon from the top button, not a row', () => {
    const html = pigeonsTabHtml({ personas });
    if (!(!/Not loaded yet/.test(html) && /data-profile="patch"/.test(html)
      && /Writes anything you ask/.test(html) && !/class="kind/.test(html))) return html.slice(0, 300);
    /* Adding is the + button beside the search box (index.html), so the list
       holds Pigeons only. */
    if (/import-pigeon|Add a Pigeon/.test(html)) return 'Add a Pigeon is still a row in the list';
    const index = readFileSync(join(ROOT, 'index.html'), 'utf8');
    if (!/id="addPigeonBtn"[^>]*aria-label="Add a Pigeon"/.test(index)) return 'there is no Add a Pigeon button at the top of the list';
    const app = readFileSync(join(ROOT, 'src/app.js'), 'utf8');
    if (!/\$\('addPigeonBtn'\)\.hidden = !pigeons/.test(app) || !/\$\('composeBtn'\)\.hidden = pigeons/.test(app)) return 'the top button does not swap with the tab';
    /* Patch is above the letters: he came with the app rather than being one
       you added, so he is not a P. Pen comes with the app too, under Patch. */
    if (!(html.indexOf('data-profile="patch"') < html.indexOf('data-profile="chat"') && html.indexOf('data-profile="chat"') < html.indexOf('<div class="sec">'))) return 'Pen is not under Patch above the letters';
    const letters = [...html.matchAll(/<div class="sec">(.)<\/div>/g)].map(m => m[1]).join('');
    if (letters !== 'MNS') return `letters ${letters}`;
    /* Peek joins them once an engine has answered for its model — greyed and
       saying what it needs when the model is not on this Mac. */
    try {
      setPeekModel(null);
      const withPeek = pigeonsTabHtml({ personas });
      const at = withPeek.indexOf('data-profile="peek"');
      if (at < 0 || at < withPeek.indexOf('data-profile="chat"') || at > withPeek.indexOf('<div class="sec">')) return 'Peek is not under Pen';
      if (!/class="crow dim" data-profile="peek"/.test(withPeek) || !/Download it from Peek’s page/.test(withPeek)) return 'Peek without its model does not say what it needs';
      /* Nothing to message, so no compose button on Peek’s row. */
      if (/data-start="peek"/.test(withPeek)) return 'Peek without its model still offers a new chat';
    } finally { setPeekModel(undefined); }
    const under = html.slice(html.indexOf('<div class="sec">P</div>'));
    if (/data-profile="patch"/.test(under)) return 'Patch is still alphabetised under P';
    /* Searching is looking for a name, so it drops him back among the matches. */
    const found = pigeonsTabHtml({ personas, q: 'pat' });
    if (/<div class="pins">/.test(found) || /data-profile="pigeon:socratic-tutor"/.test(found)) return `searching: ${found.slice(0, 300)}`;
    return /No Pigeon is called “zzz”/.test(pigeonsTabHtml({ personas, q: 'zzz' })) || 'a search with no match says nothing';
  });

  /* A row opens the Pigeon’s page; messaging it is the compose button that
     shows on hover, set apart from the row, with ⋯ beside it. */
  check('a Pigeon’s row opens its page, and the compose button on hover starts a chat', () => {
    const html = pigeonsTabHtml({ personas });
    const row = html.slice(html.indexOf('<div class="crow-wrap prow" data-row="chat"'), html.indexOf('<div class="crow-wrap prow" data-row="pigeon:'));
    if (!/<button class="crow" data-profile="chat" title="About Pen">/.test(row)) return 'the row does not open the page';
    if (!/<button class="crow-go" data-start="chat" aria-label="New chat with Pen"/.test(row)) return 'no compose button on the row';
    if (!/data-pigeon-menu="chat"/.test(row)) return 'no ⋯ on the row';
    const css = readFileSync(join(ROOT, 'styles/app.css'), 'utf8');
    if (!/\.prow:hover \.crow-side,\.prow:focus-within \.crow-side\{opacity:1\}/.test(css)) return 'the compose button does not show on hover';
    if (!/\.crow-go\{[^}]*background:var\(--solid\)/.test(css)) return 'the compose button does not stand out from the row';
    const app = readFileSync(join(ROOT, 'src/app.js'), 'utf8');
    return (/t\.dataset\.pigeonMenu\) \{ e\.stopPropagation\(\); openPigeonMenu\(t, t\.dataset\.pigeonMenu\)/.test(app)
      && /openPigeonMenu\(\{ x: e\.clientX, y: e\.clientY \}, p\.dataset\.profile\)/.test(app)) || 'the ⋯ and right-click do not open the Pigeon’s menu';
  });

  /* Pinned Pigeons sit in a grid at the top of the tab, in the order pinned,
     the way pinned chats do; the pin lives in settings and survives a relaunch. */
  check('a Pigeon pins to the top of the Pigeons tab the way a chat does, from its ⋯, its page or a right-click', () => {
    const pinned = { 'pigeon:socratic-tutor': 2, chat: 1 };
    const html = pigeonsTabHtml({ personas, pinned });
    const grid = html.slice(0, html.indexOf('</div>'));
    if (!/^<div class="pins">/.test(html)) return 'no pinned grid at the top';
    if (!(grid.indexOf('data-pinned-pigeon="chat"') < grid.indexOf('data-pinned-pigeon="pigeon:socratic-tutor"'))) return 'pins are not in the order they were pinned';
    if (!/class="pin" data-profile="chat"/.test(grid)) return 'a pinned tile does not open the page';
    const rest = html.slice(html.indexOf('</div>'));
    if (/data-profile="chat"|data-profile="pigeon:socratic-tutor"/.test(rest)) return 'a pinned Pigeon is still listed below';
    if (!/data-row="patch"/.test(rest) || !/<div class="sec">M<\/div>/.test(rest)) return 'the rest of the list is gone';
    if (/<div class="pins">/.test(pigeonsTabHtml({ personas }))) return 'an empty pin grid is drawn';
    const items = pigeonMenuItems(pigeonOf('chat'), { pinned: false }).map(i => i.id);
    const un = pigeonMenuItems(pigeonOf('chat'), { pinned: true }).find(i => i.id === 'pin-pigeon');
    const mine = pigeonMenuItems(pigeonOf('pigeon:socratic-tutor', personas)).map(i => i.id);
    if (!(items.join() === 'pin-pigeon,new-with,page' && un.label === 'Unpin' && mine.includes('remove-pigeon'))) return `menu ${items} / ${mine}`;
    const page = profileHtml(pigeonOf('chat'), { pinned: true });
    if (!/data-do="pin-pigeon" data-pick="chat" aria-pressed="true">[\s\S]*?Unpin</.test(page) || !/>Pin</.test(profileHtml(pigeonOf('chat'), {}))) return 'the page has no Pin';
    const kept = normaliseSettings({ pinnedPigeons: { chat: 5, 'pigeon:x': 7, nope: 3, patch: 'soon' } }).pinnedPigeons;
    if (JSON.stringify(kept) !== JSON.stringify({ chat: 5, 'pigeon:x': 7 })) return `settings keep ${JSON.stringify(kept)}`;
    return JSON.stringify(defaultSettings().pinnedPigeons) === '{}' || 'a fresh file does not start with no pins';
  });

  check('a row time reads as a messaging app reads it', () => {
    const now = new Date('2026-09-11T15:00:00').getTime();
    const today = new Date('2026-09-11T09:05:00').getTime();
    const yesterday = new Date('2026-09-10T20:00:00').getTime();
    return (rowTime(today, now) === '09:05' && rowTime(yesterday, now) === 'Yesterday' && dayName(today, now) === 'Today'
      && escHtml('<b>') === '&lt;b&gt;') || `${rowTime(today, now)} · ${rowTime(yesterday, now)}`;
  });

  check('everything under src/ui imports in Node with no DOM', async () => {
    const dir = join(ROOT, 'src/ui');
    const files = readdirSync(dir).filter(f => f.endsWith('.js'));
    for (const f of files) {
      try { await import(`../src/ui/${f}`); }
      catch (e) { return `src/ui/${f}: ${e.message}`; }
    }
    return files.length > 0 || 'src/ui has no modules';
  });

  check('a blank chat holding a draft stays in the list, and the chat being composed does not', () => {
    const drafted = { ...mkChat('DR'), draft: { text: 'half a question', height: '' } };
    const composing = mkChat('CO');
    const html = chatListHtml({ chats: [drafted, composing], activeId: 'CO', compose: { chatId: 'CO', to: 'patch' }, personas });
    return (/data-chat="DR"/.test(html) && !/data-chat="CO"/.test(html) && /data-compose-row/.test(html) && /with Patch/.test(html)
      && hasDraft(drafted) && !hasDraft(composing)) || html;
  });

  check('To: greys nothing that can be messaged, says how many chats and when, and always offers Add a Pigeon', () => {
    const drawn = toListHtml({ personas, q: '', hi: 99, counts: { patch: 2 }, lastAt: { patch: Date.now() } });
    if (drawn.hi !== drawn.flat.length - 1) return `hi ${drawn.hi} was not clamped`;
    if (/aria-disabled/.test(drawn.html)) return 'a Pigeon that sending would load is greyed';
    if (!/2 chats · \d\d:\d\d/.test(drawn.html)) return 'the chat count or its time is missing';
    if (!/Add a Pigeon/.test(drawn.html) || !/1–9 when empty/.test(drawn.html)) return 'the import row or the keys hint is missing';
    /* Patch is drawn above the first label, under a rule of his own — no
       header over him, since one row under a heading reads as a category. */
    const firstLabel = drawn.html.indexOf('<div class="sg-label">');
    const patchAt = drawn.html.indexOf('data-to="patch"');
    if (patchAt < 0 || patchAt > firstLabel) return 'Patch is not pinned above the first section label';
    if (!/data-to="patch"[\s\S]*?<\/button><div class="sg-rule">/.test(drawn.html)) return 'no rule between Patch and the rest';
    const suggested = toListHtml({ personas, suggest: true });
    if (!suggested.flat[0].suggested || suggested.flat[0].pick !== 'patch' || !/Patch can work this out/.test(suggested.html)) return 'no Suggested row';
    /* The Suggested row is Patch under a better heading, so the pin below it
       would be him twice over — it stands in for the pin, key and all. */
    if (suggested.flat.filter(d => d.pick === 'patch').length !== 1) return 'Patch is both suggested and pinned';
    if (suggested.flat[0].key !== 1) return 'the Suggested row did not take the pinned row’s number key';
    if ((suggested.html.match(/data-to="patch"/g) || []).length !== 1) return 'Patch is drawn twice';
    if (toListHtml({ personas, q: 'pen', suggest: true }).flat.some(d => d.suggested)) return 'Suggested survived typing a name';
    const none = toListHtml({ personas, q: 'zzz' });
    return /No Pigeon called “zzz”/.test(none.html) || 'empty search';
  });

  check('New chat opens on Patch, and To: offers Someone else… rather than only a way to take him off', () => {
    const app = readFileSync(join(ROOT, 'src/app.js'), 'utf8');
    const fn = app.slice(app.indexOf('function startCompose ('), app.indexOf('/* Who a new chat is for.'));
    if (!/const chosen = pick \|\| 'patch';/.test(fn)) return 'a new chat with nobody named no longer opens on Patch';
    if (!/byDefault = !pick/.test(fn)) return 'a defaulted Patch is indistinguishable from a chosen one';
    /* A default is not a choice, so it must not become the remembered pick. */
    if (!/if \(pick\) state\.settings\.lastPick = pick;/.test(fn)) return 'the default is remembered as though it had been chosen';
    /* With his skills not ready nobody is filled in, and To: opens as it always did. */
    if (!/if \(canMessage\(d\)\) \{/.test(fn)) return 'an unavailable Patch would still be filled in';
    if (!/data-do="clear-to"[^>]*>Someone else…</.test(app)) return 'there is no named way off the default';
    /* Off the default, what was typed goes on suggesting. */
    const clear = app.slice(app.indexOf('function clearTo ('), app.indexOf('function leaveCompose ('));
    if (!/state\.compose\.suggest = box/.test(clear)) return 'what was typed is not carried into the suggestion';
    return /\.to-else\{/.test(readFileSync(join(ROOT, 'styles/app.css'), 'utf8')) || 'Someone else… has no style';
  });

  check('the chat menu flips with the chat, and delete only asks', () => {
    const c = { ...mkChat('CM'), pinnedAt: 5, unread: 1, muted: true };
    const items = chatMenuItems(c, pigeonOf('patch'));
    const label = (id) => (items.find(i => i.id === id) || {}).label;
    if (label('pin') !== 'Unpin' || label('unread') !== 'Mark as read' || label('mute') !== 'Show alerts') return JSON.stringify(items);
    if (label('delete') !== 'Delete…' || !items.find(i => i.id === 'delete').danger) return 'delete is not the asking, dangerous item';
    const unloaded = chatMenuItems(mkChat('CN'), pigeonOf('pigeon:meeting-minutes', personas));
    if (unloaded.find(i => i.id === 'new-with').disabled) return 'refused a new chat with a Pigeon that sending would load';
    const gone = chatMenuItems(mkChat('CG'), pigeonOf('pigeon:deleted-one', personas));
    if (!gone.find(i => i.id === 'new-with').disabled) return 'offered a new chat with a Pigeon that is not on this Mac';
    return /data-item="rename"/.test(menuHtml(items)) || 'menu html';
  });

  check('a profile offers a new chat — with a Pigeon that is not loaded yet too, since sending loads it', () => {
    const patchPage = profileHtml(pigeonOf('patch'), { skills: 307, facts: [['Answers with', '307 tested skills']] });
    const unloaded = profileHtml(pigeonOf('pigeon:meeting-minutes', personas));
    const details = chatDetailsHtml({ ...mkChat('X'), title: 'Dinner' }, pigeonOf('patch'), { facts: [['Started', 'today']] });
    return (/data-do="new-with"/.test(patchPage) && /307 skills/.test(patchPage) && !/Restart the models/.test(unloaded)
      && /data-do="new-with"/.test(unloaded) && /Delete chat…/.test(details) && /Dinner/.test(details)
      && /<dt>Started<\/dt>/.test(details)) || patchPage.slice(0, 200);
  });

  check('Patch loading or unavailable says why, never "restart the models", keeps his avatar and gets no number key', () => {
    const plain = pigeonOf('patch');
    if (!isDeepStrictEqual(pigeonOf('patch', personas), plain) || !plain.loaded || 'unavailable' in plain) return 'no patchState is no longer the plain descriptor';
    const ready = pigeonOf('patch', [], { state: 'ready', info: { source: 'dev checkout', version: null } });
    if (!ready.loaded || ready.source !== 'dev checkout' || 'version' in ready || ready.line !== plain.line) return `ready: ${JSON.stringify(ready)}`;
    const loading = pigeonOf('patch', [], { state: 'loading' });
    if (loading.loaded || loading.kind !== 'verified' || loading.line !== 'Patch is getting his skills ready…') return `loading: ${JSON.stringify(loading)}`;
    const why = 'Patch is unavailable: the seal did not verify';
    const st = { state: 'unavailable', reason: why };
    const off = pigeonOf('patch', personas, st);
    if (off.loaded || !off.unavailable || off.kind !== 'verified' || off.line !== why) return `unavailable: ${JSON.stringify(off)}`;
    if (!/av-patch/.test(avatarHtml(off, 40))) return 'his avatar is not drawn';
    if (pigeonList(personas, { patchState: st }).flat.find(d => d.pick === 'patch').key) return 'an unavailable Patch got a number key';
    const profile = profileHtml(off, { skills: null });
    if (/Restart the models/.test(profile) || !profile.includes(why) || /null skills/.test(profile)) return `profile: ${profile.slice(0, 300)}`;
    const tab = pigeonsTabHtml({ personas, patchState: st });
    const at = tab.indexOf('data-profile="patch"');
    const row = tab.slice(at, tab.indexOf('</button>', at));
    if (!row.includes(why) || /restart the models/i.test(row)) return `Pigeons tab: ${row}`;
    const to = toListHtml({ personas: personas.filter(p => p.loaded), patchState: st });
    if (!/data-to="patch"[^>]*aria-disabled="true"/.test(to.html) || !/>unavailable</.test(to.html)) return 'To: does not grey Patch as unavailable';
    const picker = toListHtml({ personas: [], patchState: { state: 'loading' } }).html;
    return (/data-to="patch"[^>]*aria-disabled="true"/.test(picker) && />loading</.test(picker)) || 'the menu bar picker offers a loading Patch';
  });

  /* ── bubbles: computed and written stay tellable apart ───────────────────
     Real turns from the pipeline for the computed side, so what is checked is
     what the window will actually be handed. */
  const lexB = new LexicalRouter(registry);
  const bubbleTurns = async () => {
    const e = registry.routable().find(x => x.replyTemplate && !x.needsNetwork);
    const ex = e.examples[0];
    const computed = await runTurn(ex.text, { registry, router: lexB, ctx: { ...FIXED_CTX, ...(ex.ctx || {}) }, plan: { steps: [{ id: 's1', skill: e.name, input: ex.input }] } });
    Object.assign(computed, { id: 'A1', lane: 'A', message: ex.text });
    const declined = await runTurn('write me a sonnet about the sea', { registry, router: lexB, ctx: { ...FIXED_CTX } });
    Object.assign(declined, { id: 'A2', lane: 'A', message: 'write me a sonnet about the sea' });
    const failed = { id: 'A3', lane: 'A', message: 'x', results: [{ id: 's1', skill: e.name, ok: false, error: { code: 'BAD_INPUT', message: 'nope' } }], reply: { segments: [{ type: 'failure', code: 'BAD_INPUT', text: 'nope' }] } };
    const written = [
      { id: 'B1', lane: 'B', message: 'hi', reply: { source: 'generated', text: 'Hello there.' } },
      { id: 'B2', lane: 'B', message: 'how far is 26.2 miles', reply: { source: 'generated', text: 'I would rather not guess a figure.' }, offer: true },
      { id: 'B3', lane: 'B', message: 'hi', reply: null, error: 'the chat model is asleep' },
      { id: 'B4', lane: 'B', message: 'meeting notes', reply: { source: 'generated', text: 'Quarterly plan' }, ms: 120 }
    ];
    return { computed, declined, failed, written };
  };

  check('a written reply keeps the dark-yellow rule and says who wrote it under it; a computed one never does', async () => {
    const { computed, declined, failed, written } = await bubbleTurns();
    for (const t of written) {
      const html = turnHtml(t, { pigeon: t.id === 'B4' ? pigeonOf('pigeon:note-to-title', personas) : pigeonOf('chat') });
      if (!/class="bub ai gen/.test(html)) return `${t.id} is missing the written frame`;
      if (t.reply && !/Written by /.test(html)) return `${t.id} does not say who wrote it`;
      if (/data-run=/.test(html)) return `${t.id} drew a computed value`;
      if (/Generated · not computed|Show plan|Delivered|<b>Read<\/b>/.test(html)) return `${t.id} still carries a badge, a plan pill or a receipt`;
    }
    for (const t of [computed, declined, failed]) {
      const html = turnHtml(t, { pigeon: pigeonOf('patch'), canChat: true });
      const bubble = (html.match(/class="bub ai[^"]*"/) || [''])[0];
      if (/\bgen\b/.test(bubble) || /Written by/.test(html)) return `${t.id} looks written`;
    }
    return true;
  });

  check('a computed reply marks its values and says what ran; a failure is drawn as one', async () => {
    const { computed, failed, declined } = await bubbleTurns();
    const a = turnHtml(computed, { pigeon: pigeonOf('patch') });
    if ((computed.reply?.segments || []).some(s => s.type === 'value') && !/data-run="A1\|/.test(a)) return 'no marked value';
    if (!/class="mark worked"/.test(a) || !/Worked out/.test(a) || !/class="took"/.test(a)) return 'no mark saying Patch worked it out, or no took-as line';
    const f = turnHtml(failed, { pigeon: pigeonOf('patch') });
    if (!/class="fail"/.test(f) || !/Couldn’t answer/.test(f)) return 'the failure is not drawn as one';
    const dHtml = turnHtml(declined, { pigeon: pigeonOf('patch'), canChat: true });
    if (declined.mode === MODES.NO_SKILL && (!/data-fwd="A2\|chat"/.test(dHtml) || /ROUTER DECLINED|threshold/.test(dHtml))) {
      return 'a decline does not offer Pen, or still shows the router’s scores';
    }
    const guarded = turnHtml({ id: 'B2', lane: 'B', message: 'q', reply: { text: 'no' }, offer: true }, { pigeon: pigeonOf('chat') });
    return /data-fwd="B2\|patch"/.test(guarded) || 'a guarded reply does not offer Forward to Patch';
  });

  check('a grounded or skill job keeps what it was shown and what it drew — and a drawing is only ever an image', () => {
    const job = pigeonOf('pigeon:note-to-title', personas);
    const f = jobFields({ sections: [{ ordinal: 4, title: 'Memory <b>', file: 'manual.md', text: 'It needs 3.8 GB.', support: [0, 16] }], main: 4, unsupported_citations: [9], rendered: '<svg><script>x()</script></svg>', matched_label: null });
    if (f.sections[0].text !== 'It needs 3.8 GB.' || f.sections[0].file !== 'manual.md' || f.main !== 4 || f.unsupportedCitations[0] !== 9 || f.unmatchedLabel) return `fields: ${JSON.stringify(f)}`;
    /* Only the section the answer came from is kept whole. */
    const many = jobFields({ sections: [1, 2, 3].map(n => ({ ordinal: n, title: `S${n}`, text: 'long' })), main: 2 });
    if (many.sections.filter(s => 'text' in s).map(s => s.ordinal).join() !== '2') return 'the whole material was copied into the turn';
    if ('text' in jobFields({ sections: [{ ordinal: 1, title: 'S', text: 'long' }] }).sections[0]) return 'a section nothing came from was kept';
    /* The answer is underlined to its section, its [§n] taken out of the words,
       and the line under it says where: the section, then the file as named. */
    const grounded = turnHtml({ id: 'G1', lane: 'B', message: 'q', reply: { text: 'About 3.8 GB [§4] [§9].' }, ...f, rendered: undefined }, { pigeon: job });
    if (!/<span class="val doc" data-cite="G1"[^>]*>About 3\.8 GB\.<\/span>/.test(grounded)) return `not underlined: ${grounded}`;
    if (!/Found in · §4 Memory &lt;b&gt; · manual\.md/.test(grounded) || !/class="mark found"/.test(grounded)) return `no Found in: ${grounded}`;
    if (/job-src|Shown \[§/.test(grounded) || !/It cites §9, which it was not shown/.test(grounded)) return grounded;
    /* No section behind it: the same set, nothing to click, and the written line. */
    const plain = turnHtml({ id: 'G3', lane: 'B', message: 'q', reply: { text: 'x [§4].' }, ...jobFields({ sections: [{ ordinal: 4, title: 'Memory', text: 'short' }] }) }, { pigeon: job });
    if (/data-cite|<mark/.test(plain) || !/job-out doc/.test(plain) || !/Written by /.test(plain)) return `plain: ${plain}`;
    /* A turn saved before `main`: the section carrying a mark is the one. */
    const older = turnHtml({ id: 'G4', lane: 'B', message: 'q', reply: { text: 'It needs 3.8 GB.' }, sections: [{ ordinal: 4, title: 'Memory', text: 'It needs 3.8 GB.', support: [0, 16] }] }, { pigeon: job });
    if (!/data-cite="G4"/.test(older)) return 'an older grounded turn lost its underline';
    const drawn = turnHtml({ id: 'S1', lane: 'B', message: 'q', reply: { text: '{"eyes":"happy"}' }, rendered: f.rendered }, { pigeon: job });
    if (drawn.includes('<script') || drawn.includes('<svg><') ||!/<img class="skill-art"[^>]+src="data:image\/svg\+xml/.test(drawn)) return 'the drawing reached the page as markup';
    const none = turnHtml({ id: 'N1', lane: 'B', message: 'q', reply: { text: '' }, ...jobFields({ no_material: true }) }, { pigeon: job });
    if (!/material, so it was not asked/.test(none) || !/Couldn’t answer/.test(none)) return none;
    const lines = [pigeonOf('pigeon:x', [{ id: 'x', name: 'x', kind: 'freeform', skill: 'face-grammar' }]), pigeonOf('pigeon:y', [{ id: 'y', name: 'y', kind: 'grounded', retrieval: 'whole' }])];
    return (/face-grammar skill draws it/.test(lines[0].line) && /material it carries/.test(lines[1].line) && lines.every(d => d.kind === 'job')) || JSON.stringify(lines);
  });

  check('every underline opens one window: the source, with what the answer came from marked', () => {
    /* A web answer the focus pass trimmed: the whole passage, its sentence marked. */
    const raw = 'Maryland is a state.  The governor is the head.\nThe current governor is Wes Moore.';
    const web = { reply: { focus: { kept: [3], of: 3 } } };
    const wp = webPassage(web, { raw, text: 'The current governor is Wes Moore.' });
    if (wp.text.slice(wp.spans[0][0], wp.spans[0][1]) !== 'The current governor is Wes Moore.') return `web span: ${JSON.stringify(wp)}`;
    const whole = webPassage({ reply: {} }, { raw: 'All of it.' });
    if (whole.spans[0][1] !== 10) return 'an unfocused answer is not all marked';
    const wc = citationFor({ kind: 'web', turn: web, seg: { raw, text: 'The current governor is Wes Moore.', field: 'answer' }, r: { provenance: { kind: 'web', source: 'https://en.wikipedia.org/wiki/Maryland' } }, source: 'Wikipedia' });
    if (wc.title !== 'From Wikipedia' || !/<mark class="from-here">The current governor is Wes Moore\.<\/mark>/.test(wc.passage) || wc.link !== 'https://en.wikipedia.org/wiki/Maryland') return JSON.stringify(wc);
    /* A figure: your words, the values it used marked as you typed them, and
       one line of working; a value from an earlier step says which. */
    const turn = { message: 'split £84.50 4 ways', plan: { steps: [{ id: 's1', skill: 'addNumbers', input: {} }, { id: 's2', skill: 'splitBill', input: { bill: '$s1.result', people: 4 } }] } };
    const r = { id: 's2', skill: 'splitBill', input: { bill: 84.5, people: 4, currency: '£' }, sources: { bill: 'given', people: 'given', currency: 'given' }, fieldLabels: { bill: 'bill', people: 'people' } };
    const cp = computedPassage(turn, r, { text: '£21.13', field: 'perPerson' }, { titleOf: () => 'Split a bill' });
    const marked = cp.spans.map(([a, b]) => cp.text.slice(a, b));
    if (marked.join('|') !== '4') return `spans: ${marked.join('|')}`;
    if (cp.working !== 'Split a bill: bill 84.5 (from step 1, add numbers), people 4, currency £ → per person £21.13') return cp.working;
    if (!spanOf('split £84.50 4 ways', 84.5) || 'split £84.50 4 ways'.slice(...spanOf('split £84.50 4 ways', 84.5)) !== '£84.50') return 'a typed amount was not found with its sign';
    /* A table row, its field marked, its date said. */
    const bc = citationFor({ kind: 'bundled', r: { value: { code: 'LHR', name: 'Heathrow <x>', dataAsOf: '2026-01-01' } }, seg: { text: 'Heathrow', field: 'name' }, date: '1 Jan 2026' });
    if (!/<mark class="from-here">name: Heathrow &lt;x&gt;<\/mark>/.test(bc.passage) || !/dated 1 Jan 2026/.test(bc.sub)) return bc.passage;
    /* A Pigeon's file: its section, its file, the sentence marked, and the answer copied without its [§n]. */
    const dc = citationFor({ kind: 'doc', turn: { lane: 'B', reply: { text: 'Thirty years [§4].' }, main: 4, sections: [{ ordinal: 4, title: 'Article I, Section 3', file: 'constitution.md', text: 'No Person shall be a Senator who shall not have attained to the Age of thirty Years.', support: [0, 84] }] }, name: 'Pat' });
    if (dc.title !== '§4 Article I, Section 3' || dc.sub !== 'constitution.md' || dc.copy !== 'Thirty years.' || !/<mark/.test(dc.passage)) return JSON.stringify(dc);
    /* An answer that joins two clauses: both are marked, and the note says so.
       A malformed second span is dropped, never drawn. */
    const two = jobFields({ sections: [{ ordinal: 4, title: 'A', file: 'c.md', text: 'One clause; two clause.', support: [12, 23], also: [0, 11] }], main: 4 });
    if (String(two.sections[0].also) !== '0,11') return `also: ${JSON.stringify(two.sections[0])}`;
    if ('also' in jobFields({ sections: [{ ordinal: 4, title: 'A', text: 'x y', support: [0, 1], also: [2, 1] }], main: 4 }).sections[0]) return 'a backwards second span was kept';
    const dc2 = citationFor({ kind: 'doc', turn: { lane: 'B', reply: { text: 'Both.' }, ...two }, name: 'Pat' });
    if ((dc2.passage.match(/<mark/g) || []).length !== 2 || !/marked sentences share/.test(dc2.note)) return JSON.stringify(dc2);
    if (!/marked sentence shares/.test(dc.note)) return dc.note;
    const html = citationHtml(dc);
    return (/class="modal cite doc"/.test(html) && /cite-passage/.test(html) && /id="cite-copy"/.test(html) && !/cite-link/.test(html)) || html;
  });

  check('a grounded answer copies and reads back with where it was found', () => {
    const t = { lane: 'B', message: 'q', reply: { text: 'Thirty years [§4].' }, main: 4, sections: [{ ordinal: 4, title: 'Article I', file: 'c.md', text: 'thirty years', support: [0, 12] }] };
    if (markFor(t) !== MARKS.FOUND) return markFor(t);
    if (copyText(t) !== 'Thirty years.') return copyText(t);
    if (copyWithSource(t, 'Pat') !== 'Thirty years. (written by Pat in Pigeon from §4 Article I · c.md)') return copyWithSource(t, 'Pat');
    if (!/Found in · §4 Article I · c\.md/.test(receiptLine(t))) return receiptLine(t);
    return markLabel(MARKS.FOUND, { name: 'Pat' }) === 'Found in · Pat’s material' || markLabel(MARKS.FOUND, { name: 'Pat' });
  });

  check('versions say n/m, nothing under a question says Read, and a quiet gap earns a time stamp', () => {
    const at = new Date('2026-09-11T09:00:00').getTime();
    const t = { id: 'R1', lane: 'A', message: 'q', at, readAt: at + 1000, results: [], reply: { segments: [] } };
    const html = turnHtml(t, { pigeon: pigeonOf('patch'), last: true, versions: { index: 1, count: 2 }, prevAt: new Date('2026-09-10T20:00:00').getTime() });
    return (!/<b>Read<\/b>|Delivered/.test(html) && />2\/2</.test(html) && /class="stamp"/.test(html)
      && !needsStamp(at, at - 60000) && needsStamp(at, at - 46 * 60000)) || html.slice(0, 400);
  });

  check('when Pigeon started is still recorded for Message info, with no receipt on screen', () => {
    const c = mkChat('RD');
    startInflight(c, { message: 'q', sentAt: 1000 });
    if (c.inflight.readAt) return 'read before anything started';
    if (/Delivered|<b>Read/.test(inflightHtml(c.inflight, pigeonOf('patch')))) return 'the typing turn still says Delivered or Read';
    if (!markRead(c, 1500) || markRead(c, 1600)) return 'markRead did not fire exactly once';
    const { turn } = fileReply([c], 'RD', { message: 'q', results: [] }, { uid: rid, now: 2000 });
    const laneB = mkChat('RB');
    startInflight(laneB, { message: 'hi', lane: 'B', stage: 'writing', sentAt: 10 });
    return (turn.readAt === 1500 && turn.repliedAt === 2000 && laneB.inflight.readAt === 10) || JSON.stringify(turn);
  });

  check('a reaction toggles, survives saving, and is never shown to a model', () => {
    const c = mkChat('RX');
    fileReply([c], 'RX', { lane: 'B', message: 'hello', reply: { source: 'generated', text: 'hi' } }, { uid: rid });
    const t = Object.values(c.nodes)[0];
    const before = JSON.stringify(messagesFor('and then?', Object.values(c.nodes)));
    setReaction(c, t.id, 'a', '👍');
    setReaction(c, t.id, 'q', '❓');
    if (JSON.stringify(messagesFor('and then?', Object.values(c.nodes))) !== before) return 'a reaction changed what a model is sent';
    setReaction(c, t.id, 'a', '👍');
    if (t.reactions.a || t.reactions.q !== '❓') return `toggling gave ${JSON.stringify(t.reactions)}`;
    const saved = { ...c, nodes: { ...c.nodes, junk: { id: 'junk', reactions: { q: '🦄', a: 5 } } } };
    const back = parseBlob(JSON.stringify({ version: 3, chats: forDisk([saved]) })).chats[0];
    return (back.nodes[t.id].reactions.q === '❓' && !('reactions' in back.nodes.junk)) || JSON.stringify(back.nodes);
  });

  check('a forwarded question goes to a chat of its own, never back into the one it came from', () => {
    const source = { ...mkChat('SRC'), title: 'Promises' };
    let made = 0;
    const make = () => mkChat(`NEW${++made}`);
    const a = forwardTarget([source], 'SRC', { lane: 'A' }, make);
    if (a.id === 'SRC' || a.lane !== 'A') return `landed in ${a.id}`;
    const b = forwardTarget([source, mkChat('SPARE')], 'SRC', { lane: 'B', personaId: 'socratic-tutor' }, make);
    if (b.id !== 'SPARE' || b.personaId !== 'socratic-tutor') return 'did not reuse the untouched blank';
    const drafted = { ...mkChat('DRAFTED'), draft: { text: 'mine', height: '' } };
    if (forwardTarget([source, drafted], 'SRC', { lane: 'A' }, make).id === 'DRAFTED') return 'took a blank holding a draft';
    const from = forwardedFrom(source, { id: 't1' }, 'Chat', 5);
    const html = turnHtml({ id: 'F1', lane: 'A', message: 'q', handedFrom: from, results: [], reply: { segments: [] } }, { pigeon: pigeonOf('patch') });
    return /Forwarded from “Promises” with Chat/.test(html) || html.slice(0, 300);
  });

  check('a message menu forwards only the question, and offers Try again only where the answer can differ', () => {
    const q = messageMenuItems({ id: 'x', lane: 'B' }, 'q').map(i => i.id);
    const b = messageMenuItems({ id: 'x', lane: 'B', reply: { text: 'hi' } }, 'a');
    const job = messageMenuItems({ id: 'x', lane: 'B', reply: { text: 'hi' } }, 'a', { job: true });
    const a = messageMenuItems({ id: 'x', lane: 'A' }, 'a', { canChat: false });
    const fw = forwardMenuItems([pigeonOf('patch'), pigeonOf('chat'), pigeonOf('pigeon:meeting-minutes', personas)], 'chat').map(i => i.id);
    const retry = (items) => items.find(i => i.id === 'retry');
    return (q.includes('forward') && q.includes('edit') && q.includes('info') && b.some(i => i.id === 'fwd:patch')
      && !retry(b).disabled && retry(job).disabled && retry(a).disabled && /Same message, same answer/.test(retry(a).title)
      && a.some(i => i.id === 'copy-where') && !a.some(i => i.id === 'plan') && a.find(i => i.id === 'fwd:chat').disabled
      && fw.join() === 'fwd:patch,fwd:pigeon:meeting-minutes') || JSON.stringify({ q, b, a, fw });
  });

  check('an empty chat shows Patch himself with his starters, and a Pigeon its own face', () => {
    const p = emptyChatHtml(pigeonOf('patch'), { intro: 'i', starters: ['how many km is 26.2 miles'], foot: 'f' });
    const v = emptyChatHtml(pigeonOf('pigeon:socratic-tutor', personas), { intro: 'i' });
    return (/id="patchEmpty"/.test(p) && /data-say=/.test(p) && /av-voice/.test(v) && !/patchEmpty/.test(v)) || v;
  });
}

/* ── the colours: nothing pale on pale, nothing dark on dark ───────────────
   Measured with WCAG's contrast ratio, read straight out of tokens.css, for
   light, dark, and the light bubble a Pigeon keeps in dark mode. */
{
  const css = readFileSync(join(ROOT, 'styles/tokens.css'), 'utf8');
  const hexes = (body) => Object.fromEntries([...body.matchAll(/--([a-z-]+):\s*(#[0-9A-Fa-f]{6})\b/g)].map(m => [m[1], m[2]]));
  const blockOf = (sel) => { const at = css.indexOf(`${sel}{`); return at < 0 ? null : hexes(css.slice(at, css.indexOf('}', at))); };
  const light = blockOf(':root');
  const darkOnly = blockOf(':root[data-theme="dark"]');
  const systemOnly = blockOf(':root[data-theme="system"]');
  const at = css.indexOf('--surface:#F2F7FA');
  const bubbleOnly = at < 0 ? null : hexes(css.slice(css.lastIndexOf('{', at), css.indexOf('}', at)));
  const lum = (hex) => {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
  const below = (t, pairs, min) => pairs
    .map(([fg, bg]) => [fg, bg, t[fg] && t[bg] ? ratio(t[fg], t[bg]) : 0])
    .filter(([, , r]) => r < min)
    .map(([fg, bg, r]) => `${fg} on ${bg} is ${r.toFixed(2)}:1`);
  const TEXT = [['ink', 'surface'], ['ink', 'paper'], ['ink', 'panel'], ['ink-soft', 'surface'], ['ink-soft', 'panel'],
    ['ink-faint', 'surface'], ['ink-faint', 'paper'], ['on-user', 'user'], ['aqua', 'surface'], ['warn-ink', 'warn-bg'],
    ['danger', 'surface'], ['on-danger', 'danger'], ['on-solid', 'solid'], ['patch-fg', 'patch-bg'], ['on-accent', 'aqua']];
  const IN_BUBBLE = [['ink', 'surface'], ['ink-soft', 'surface'], ['ink-faint', 'surface'], ['aqua', 'surface'],
    ['danger', 'surface'], ['warn-ink', 'surface']];

  check('text at the contrast floor is never dimmed again with opacity, and every token a rule names exists', () => {
    const app = readFileSync(join(ROOT, 'styles/app.css'), 'utf8');
    const pop = readFileSync(join(ROOT, 'popover.html'), 'utf8');
    const tokens = readFileSync(join(ROOT, 'styles/tokens.css'), 'utf8');
    const defined = new Set([...tokens.matchAll(/--([a-z0-9-]+):/g)].map(m => m[1]));
    const used = new Set([...(app + pop).matchAll(/var\(--([a-z0-9-]+)/g)].map(m => m[1]));
    const local = new Set([...(app + pop).matchAll(/--([a-z0-9-]+):/g)].map(m => m[1]));
    const missing = [...used].filter(t => !defined.has(t) && !local.has(t));
    if (missing.length) return `rules name tokens that do not exist: ${missing.join(', ')}`;
    /* A rule that sets opacity on an element whose text is already the faint
       ink multiplies a colour measured at the floor. Only whole non-text
       elements (an avatar) may fade. */
    const dimmed = [...app.matchAll(/^([^{\n]*(?:chev|\.mono|\.stub|\.sg\.off|kbd)[^{\n]*)\{[^}]*opacity:\.\d+/gm)].map(m => m[1].trim()).filter(sel => !/\.av\b/.test(sel));
    if (dimmed.length) return `faint text dimmed again: ${dimmed.join(' | ')}`;
    for (const t of ['amber', 'gold', 'glint', 'fail-bg', 'ok-tint', 'bad-tint']) {
      if ((tokens.match(new RegExp(`--${t}:`, 'g')) || []).length < 3) return `--${t} has no dark value`;
    }
    return true;
  });

  check('focus is visible on menu items, the tools stay reachable when narrow, long names clip, one segmented control reads its ARIA state, scroll bodies can shrink', () => {
    const app = readFileSync(join(ROOT, 'styles/app.css'), 'utf8');
    if (!/\.ctx button:focus-visible\{[^}]*outline:2px solid var\(--aqua\)/.test(app)) return 'context-menu items have no focus ring';
    if (!/\.msg:focus-within \.hov,\.msg:focus-within \.markrow\{opacity:1\}/.test(app)) return 'the hover row is unreachable by keyboard on a narrow window';
    for (const [sel, need] of [['.profile h3{', 'overflow-wrap:anywhere'], ['.p-continue span{', 'text-overflow:ellipsis'], ['.st-pigeon b,.st-pigeon small{', 'text-overflow:ellipsis'], ['.st-log span{', 'overflow-wrap:anywhere'], ['.job-out{', 'overflow-wrap:anywhere']]) {
      const i = app.indexOf(sel); if (i < 0 || !app.slice(i, app.indexOf('}', i)).includes(need)) return `${sel} does not ${need}`;
    }
    if (/\.st-tabs button\.on\{|\.st-seg button\.on\{/.test(app)) return 'a segmented control still selects by class';
    if (!/\.st-tabs button\[aria-selected="true"\]\{background:var\(--surface\)/.test(app) || !/\.st-seg button\[aria-checked="true"\]\{background:var\(--surface\)/.test(app)) return 'settings tabs and segments do not match the list\'s tabs';
    for (const sel of ['.modal-body{', '.st-body{']) { const i = app.indexOf(sel); if (!app.slice(i, app.indexOf('}', i)).includes('min-height:0')) return `${sel} cannot shrink`; }
    return true;
  });

  check('tokens.css has light, dark, dark-by-system, and the bubble that stays light', () =>
    Boolean(light && darkOnly && systemOnly && bubbleOnly) || 'a block is missing');

  check('dark chosen and dark by system are the same colours', () =>
    JSON.stringify(darkOnly) === JSON.stringify(systemOnly) || 'the two dark blocks have drifted apart');

  check('light: every text colour clears 4.5:1 on its ground, and the written rule 3:1', () => {
    const bad = [...below(light, TEXT, 4.5), ...below(light, [['gen-rule', 'surface']], 3)];
    return !bad.length || bad.join('; ');
  });

  check('dark: every text colour clears 4.5:1 on its ground, and the written rule 3:1', () => {
    const dark = { ...light, ...darkOnly };
    const bad = [...below(dark, TEXT, 4.5), ...below(dark, [['gen-rule', 'surface']], 3)];
    return !bad.length || bad.join('; ');
  });

  check('dark: a Pigeon\'s bubble stays light and readable, and yours is the darker of the two', () => {
    const dark = { ...light, ...darkOnly };
    const bubble = { ...dark, ...bubbleOnly };
    const bad = [...below(bubble, IN_BUBBLE, 4.5), ...below(bubble, [['gen-rule', 'surface']], 3)];
    if (lum(bubble.surface) <= lum(dark.user)) bad.push('the Pigeon bubble is not lighter than yours');
    return !bad.length || bad.join('; ');
  });

  check('every window draws from tokens.css, and the stylesheet paints no white of its own', () => {
    const app = readFileSync(join(ROOT, 'styles/app.css'), 'utf8');
    const pop = readFileSync(join(ROOT, 'popover.html'), 'utf8');
    const index = readFileSync(join(ROOT, 'index.html'), 'utf8');
    if (!/styles\/tokens\.css/.test(pop) || !/styles\/tokens\.css/.test(index)) return 'a window does not link tokens.css';
    if (/:root\s*\{/.test(app) || /--ink:/.test(pop)) return 'colour tokens are defined outside tokens.css';
    const white = app.match(/#f{3}(?:f{3})?\b/i);
    return !white || `app.css still paints ${white[0]}`;
  });
}

/* ── 6b3. branching: nothing you asked is destroyed ────────────────────────
   The property that matters is not "an edit makes a new version" — it is that
   the OLD branch, and everything that followed from it, is still there. */
{
  let n = 0;
  const mk = (message) => ({ id: `t${++n}`, message, at: n, results: [], reply: null });
  const chat = () => ({ id: 'c', title: 'x', nodes: {}, activeRootId: null });

  check('a conversation is the path from the root down', () => {
    const c = chat();
    const a1 = linkTurn(c, mk('one'));
    const b1 = linkTurn(c, mk('two'), a1.id);
    linkTurn(c, mk('three'), b1.id);
    const said = pathOf(c).map(t => t.message).join(',');
    return said === 'one,two,three' || `got ${said}`;
  });

  check('editing keeps the old branch and everything under it', () => {
    const c = chat();
    const first = linkTurn(c, mk('convert 5 miles'));
    linkTurn(c, mk('and in feet'), first.id);
    /* Edit the first question: a sibling, not a replacement. */
    const edited = linkTurn(c, mk('convert 12 miles'), null);

    if (pathOf(c).map(t => t.message).join(',') !== 'convert 12 miles') {
      return `after editing, the path is ${pathOf(c).map(t => t.message).join(',')}`;
    }
    /* Go back. The follow-up must come back with it — that is the whole point. */
    switchTo(c, edited.id, -1);
    const back = pathOf(c).map(t => t.message).join(',');
    return back === 'convert 5 miles,and in feet'
      || `switching back gave ${back} — the branch was lost`;
  });

  /* The real saveEdit, sliced out of app.js and run against stubs: an edit
     once threw "Cannot access 'image' before initialization" before anything
     was sent, and the backstop blamed Patch whichever Pigeon was asked. */
  check('an edit is sent, and a failed one gives the box back with what was typed', async () => {
    const app = readFileSync(join(ROOT, 'src/app.js'), 'utf8');
    const at = app.indexOf('async function saveEdit (');
    const body = app.slice(at, app.indexOf('\n}\n', at) + 3);
    const run = async ({ throws = false, image = null } = {}) => {
      const turn = { id: 't1', parentId: null, message: 'old', ...(image ? { image } : {}) };
      const chat = { id: 'c1', inflight: false };
      const state = { activeChatId: 'c1', editing: 't1' };
      const box = { value: 'old', setSelectionRange () {} };
      const out = { said: null, toasts: [] };
      const say = async (text, o) => { if (throws) throw new Error('boom'); out.said = { text, o }; return { id: 't2' }; };
      const fn = new Function('state', 'chatNodes', 'activeChat', 'say', 'afterReply', 'paint', 'toast', 'sentPictures', 'friendly', '$', 'scrollToTurn',
        `${body}\nreturn saveEdit;`);
      const saveEdit = fn(state, () => ({ t1: turn }), () => chat, say, () => {}, () => {}, (m) => out.toasts.push(m), new WeakMap(), (e) => `friendly: ${e.message}`, () => box, null);
      await saveEdit('t1', '  new words  ');
      return { ...out, state, box };
    };
    const sent = await run();
    if (!sent.said || sent.said.text !== 'new words' || sent.said.o.fromComposer !== false) return `not sent: ${JSON.stringify(sent.said)}`;
    const pictured = await run({ image: { text: 'read', picture: true } });
    if (!pictured.said || !pictured.said.o.image || pictured.said.o.image.edited !== true) return `a picture turn's edit lost its record: ${JSON.stringify(pictured.said)}`;
    const failed = await run({ throws: true });
    if (failed.state.editing !== 't1' || failed.box.value !== 'new words') return `the edit was lost: editing ${failed.state.editing}, box "${failed.box.value}"`;
    if (failed.toasts.join() !== 'friendly: boom') return `toast: ${failed.toasts}`;
    /* The backstop catches every chat, so it does not name Patch. */
    const back = app.slice(app.indexOf("addEventListener('unhandledrejection'"), app.indexOf("addEventListener('unhandledrejection'") + 300);
    return (/toast\(friendly\(e && e\.reason\)/.test(back) && !/toast\(askFailed/.test(back)) || 'the backstop still blames Patch';
  });

  check('the version arrows walk siblings and stop at the ends', () => {
    const c = chat();
    const a1 = linkTurn(c, mk('v1'));
    linkTurn(c, mk('v2'), null);
    const v3 = linkTurn(c, mk('v3'), null);
    if (siblingsOf(c, v3).length !== 3) return `expected 3 versions, got ${siblingsOf(c, v3).length}`;
    if (switchTo(c, v3.id, 1) !== null) return 'walked off the end';
    if (switchTo(c, a1.id, -1) !== null) return 'walked off the start';
    return switchTo(c, v3.id, -1) !== null || 'could not step back a version';
  });

  check('the sibling index gives every turn the same versions, in the same order, as the scan', () => {
    const c = chat();
    const r1 = linkTurn(c, mk('root one'));
    const a = linkTurn(c, mk('a'), r1.id);
    linkTurn(c, mk('a deeper'), a.id);
    const b = linkTurn(c, mk('b'), r1.id);
    linkTurn(c, mk('b deeper one'), b.id);
    linkTurn(c, mk('b deeper two'), b.id);
    linkTurn(c, mk('root two'));
    /* Out of insertion order and with a tie, so the sort is what decides. */
    const late = linkTurn(c, mk('c'), r1.id);
    late.at = 0;
    const tie = linkTurn(c, mk('d'), r1.id);
    tie.at = a.at;
    const index = siblingIndex(c);
    const ids = (list) => list.map(t => t.id).join(',');
    for (const t of Object.values(c.nodes)) {
      const scan = ids(siblingsOf(c, t));
      const fast = ids(siblingsOf(c, t, index));
      if (scan !== fast) return `${t.message}: scan ${scan}, index ${fast}`;
    }
    return ids(index.get(r1.id)) === ids(siblingsOf(c, a)) && index.get(null).length === 2
      || `r1's children ${ids(index.get(r1.id))}, roots ${ids(index.get(null) || [])}`;
  });

  check('answering a question keeps its place and its children', () => {
    const c = chat();
    const asked = linkTurn(c, mk('how many days'));
    linkTurn(c, mk('and in weeks'), asked.id);
    replaceTurn(c, asked.id, { ...mk('how many days'), id: 'replacement' });
    const said = pathOf(c).map(t => t.message).join(',');
    return said === 'how many days,and in weeks'
      || `replacing the answered turn orphaned its children: ${said}`;
  });

  /* A file written by an earlier build. Refusing or mangling these would lose
     every conversation someone had before branching existed. */
  check('a flat chat from an older build becomes a tree', () => {
    const old = { id: 'c', title: 'x', createdAt: 5, turns: [
      { id: 'a', message: 'one' }, { id: 'b', message: 'two' }
    ] };
    const c = migrateChat(old);
    if (c.turns) return 'the flat list was left behind alongside the tree';
    const said = pathOf(c).map(t => t.message).join(',');
    return said === 'one,two' || `got ${said}`;
  });

  /* Written to disk, so a corrupt or hand-edited file must not hang the app. */
  check('a cycle in a saved conversation cannot hang the app', () => {
    const c = chat();
    c.nodes = {
      a: { id: 'a', message: 'one', activeChildId: 'b' },
      b: { id: 'b', message: 'two', activeChildId: 'a' }
    };
    c.activeRootId = 'a';
    const said = pathOf(c).map(t => t.message).join(',');
    return said === 'one,two' || `got ${said}`;
  });
}

/* ── 6c. the category router, on a stub model ───────────────────────────────
   It is the app's router whenever the adapter is reachable, so its failure
   modes are load-bearing and none of them need a live model to check: what it
   does when the model is DOWN, when it is UNSURE, and when it is WRONG. Each
   of these has already been a real bug. */
{
  const stub = (text, confidence = 1) => async () => ({ text, confidence, ms: 0, tokens: 1, promptTokens: 1 });
  const dead = async () => { throw new Error('no server'); };
  const lexical = new LexicalRouter(registry);
  const q = 'shade #FFAA00 down 30 percent';

  check('category router falls back to the lexical router when no model answers', async () => {
    const r = await categoryRouter({ registry, complete: dead, trained: true }).route(q, {});
    const want = lexical.route(q, {});
    return r.forPlanner.map(c => c.name).join() === want.forPlanner.map(c => c.name).join()
      || 'a model outage changed the candidates — the app must be usable without one';
  });

  /* The bug this pins: the fallback used a lexical router built at FULL width
     for ordering inside a category, so declining a category handed the planner
     roughly twice the candidates the shipped router would. More candidates in
     front of a planner is more nonsense answered, which is the opposite of
     falling back. */
  check('falling back never widens the shortlist beyond the shipped router', async () => {
    const wide = [];
    for (const [text] of [['i had a really rough day'], ['what a day it has been'], [q]]) {
      const r = await categoryRouter({ registry, complete: dead, trained: true }).route(text, {});
      const want = lexical.route(text, {});
      if (r.forPlanner.length > want.forPlanner.length) {
        wide.push(`${text}: ${r.forPlanner.length} vs ${want.forPlanner.length}`);
      }
    }
    return wide.length === 0 || `wider than lexical on — ${wide.join('; ')}`;
  });

  check('an unsure category is discarded rather than acted on', async () => {
    const unsure = await categoryRouter({
      registry, complete: stub('design', 0.4), trained: true, minConfidence: 0.8
    }).route(q, {});
    const sure = await categoryRouter({
      registry, complete: stub('design', 0.99), trained: true, minConfidence: 0.8
    }).route(q, {});
    if (unsure.category !== null && unsure.category !== 'unavailable') return `kept a 0.4-confidence category: ${unsure.category}`;
    return sure.category === 'design' || `discarded a 0.99-confidence category: ${sure.category}`;
  });

  check('widening: a listed skill brings its twin, and the list is cut to 24 with twins kept last', async () => {
    const msg = 'how many lines are in this text';
    const plain = await categoryRouter({ registry, complete: stub('text', 0.99), trained: true, minConfidence: 0.8 }).route(msg, {});
    const wide = await categoryRouter({ registry, complete: stub('text', 0.99), trained: true, minConfidence: 0.8, ...WIDENING, maxListed: Infinity }).route(msg, {});
    const capped = await categoryRouter({ registry, complete: stub('text', 0.99), trained: true, minConfidence: 0.8, ...WIDENING }).route(msg, {});
    const names = (r) => r.forPlanner.map(c => c.name);
    if (!(names(wide).length > 24)) return `uncapped list only ${names(wide).length} long — the case no longer tests the cap`;
    if (names(capped).length !== 24) return `capped list is ${names(capped).length}`;
    const twinsOfLines = WIDENING.twins.get('countLines');
    if (!twinsOfLines.every(t => names(capped).includes(t))) return `a twin of countLines was cut: ${twinsOfLines.filter(t => !names(capped).includes(t))}`;
    const cut = names(wide).filter(n => !names(capped).includes(n));
    const twinned = (c, list) => c.via === 'twin' || (WIDENING.twins.get(c.name) || []).some(t => list.includes(t));
    const cutScored = wide.forPlanner.filter(c => cut.includes(c.name) && c.score > 0 && !twinned(c, names(wide)));
    const keptUnscored = capped.forPlanner.filter(c => !(c.score > 0) && !twinned(c, names(wide)));
    if (cutScored.length && keptUnscored.length) return `cut a scored skill (${cutScored[0].name}) while keeping an unscored one (${keptUnscored[0].name})`;
    return names(plain).length <= names(capped).length || 'widening shortened the list';
  });

  check('a chosen category surfaces skills that share no words with the question', async () => {
    const r = await categoryRouter({ registry, complete: stub('design'), trained: true }).route(q, {});
    const viaCategory = r.forPlanner.filter(c => c.via === 'category');
    return viaCategory.length > 0
      || 'no zero-scoring skill was offered — the whole point is reaching those';
  });

  /* "none" is a category name the adapter is trained to emit, and it is not a
     category of skills. Treating it as one would index into nothing. */
  check('the model answering "none" is treated as no category, not a category', async () => {
    const r = await categoryRouter({ registry, complete: stub('none'), trained: true }).route(q, {});
    return r.forPlanner.map(c => c.name).join() === lexical.route(q, {}).forPlanner.map(c => c.name).join()
      || '"none" did not fall back to lexical';
  });

  check('a WRONG category still cannot drop the lexical top pick', async () => {
    const r = await categoryRouter({ registry, complete: stub('finance'), trained: true, blend: true }).route(q, {});
    const top = lexical.route(q, {}).candidates[0];
    return !top || r.candidates.some(c => c.name === top.name)
      || `lost the lexical top pick ${top.name} to a wrong category`;
  });
}

/* ── 6a. refs: whole-value, embedded, and the planner's missing "$" ──────────
   The bug this section pins down: the planner answered "what is 20 * 200, then
   multiply by 10" with the right two steps and wrote the ref as "s1.result * 10"
   — no "$", and embedded in an expression, neither of which resolved. The turn
   printed 4,000 and then an error. Three things had to be true for that to be
   fixed and each is checked below: the repair is narrow, an embedded ref
   resolves, and a whole-value ref still keeps its type. */
{
  const stubRegistry = {
    skill: (n) => ({ name: n, unbuilt: false, description: 'a test skill', inputSchema: { type: 'object' } })
  };
  const CHAIN = {
    steps: [
      { id: 's1', skill: 'product', input: { values: [20, 200] } },
      { id: 's2', skill: 'evaluateExpression', input: { expression: 's1.result * 10' } }
    ]
  };
  const RAN = [{ id: 's1', ok: true, value: { result: 4000, count: 2 } }];

  check('normalisePlanRefs repairs a ref the model wrote without its "$"', () => {
    const got = normalisePlanRefs(CHAIN).steps[1].input.expression;
    return got === '$s1.result * 10' || `got ${JSON.stringify(got)}`;
  });
  check('normalisePlanRefs leaves a plan that needs nothing alone (same object)', () => {
    const fine = { steps: [{ id: 's1', skill: 'slugify', input: { text: 'hello there' } }] };
    return normalisePlanRefs(fine) === fine || 'an untouched plan should not be rebuilt';
  });
  check('the repair only fires for a step id that is actually in the plan', () => {
    const got = normalisePlanRefs({ steps: [{ id: 's1', skill: 'slugify', input: { text: 's9.result * 10' } }] });
    return got.steps[0].input.text === 's9.result * 10' || 'rewrote a token that names no step';
  });
  check('the repair cannot make a step refer to itself', () => {
    const got = normalisePlanRefs({ steps: [{ id: 's1', skill: 'x', input: { a: 's1.result' } }] });
    return got.steps[0].input.a === 's1.result' || 'repaired a self-reference';
  });
  check('the repair leaves ordinary prose containing a dot alone', () => {
    const got = normalisePlanRefs({ steps: [{ id: 's1', skill: 'slugify', input: { text: 'read main.js first' } }] });
    return got.steps[0].input.text === 'read main.js first' || 'rewrote ordinary prose';
  });
  check('an already-correct ref survives the repair unchanged', () => {
    const got = normalisePlanRefs({ steps: [
      { id: 's1', skill: 'a', input: {} },
      { id: 's2', skill: 'b', input: { code: '$s1.currency' } }
    ] });
    return got.steps[1].input.code === '$s1.currency' || `got ${got.steps[1].input.code}`;
  });

  check('an embedded ref resolves into the string around it', () => {
    const got = resolveRefs({ expression: '$s1.result * 10' }, RAN, []);
    return got.expression === '4000 * 10' || `got ${JSON.stringify(got.expression)}`;
  });
  check('a whole-value ref keeps its type', () => {
    const got = resolveRefs({ amount: '$s1.result' }, RAN, []);
    return (got.amount === 4000 && typeof got.amount === 'number') || `got ${JSON.stringify(got.amount)}`;
  });
  check('two refs in one string both resolve', () => {
    const got = resolveRefs({ e: '$s1.result / $s1.count' }, RAN, []);
    return got.e === '4000 / 2' || `got ${JSON.stringify(got.e)}`;
  });
  check('an embedded ref to a failed step throws rather than half-substituting', () => {
    const failed = [{ id: 's1', ok: false, error: { code: 'INVALID_INPUT' } }];
    try { resolveRefs({ e: '$s1.result * 10' }, failed, []); return 'should have thrown'; }
    catch (e) { return /step s1 failed/.test(e.message) || `wrong message: ${e.message}`; }
  });
  check('an embedded ref to a missing field throws', () => {
    try { resolveRefs({ e: '$s1.nope * 10' }, RAN, []); return 'should have thrown'; }
    catch (e) { return /has no "nope"/.test(e.message) || `wrong message: ${e.message}`; }
  });
  check('a string with no ref in it is returned untouched', () =>
    resolveRefs({ t: 'costs $5 and change' }, RAN, []).t === 'costs $5 and change' || 'mangled a dollar sign');

  check('validatePlan now sees an embedded forward ref', () => {
    const fwd = { steps: [
      { id: 's1', skill: 'a', input: { e: '$s2.result * 2' } },
      { id: 's2', skill: 'b', input: {} }
    ] };
    const v = validatePlan(fwd, stubRegistry);
    return (!v.ok && /hasn't run yet/.test(v.errors[0].message)) || 'an embedded forward ref must be rejected';
  });
  check('validatePlan now sees an embedded ref to a missing step', () => {
    const v = validatePlan({ steps: [{ id: 's1', skill: 'a', input: { e: '$s7.result + 1' } }] }, stubRegistry);
    return (!v.ok && /doesn't exist/.test(v.errors[0].message)) || 'an embedded missing ref must be rejected';
  });
  check('the repaired chain passes validation end to end', () => {
    const v = validatePlan(normalisePlanRefs(CHAIN), stubRegistry);
    return v.ok || `rejected: ${v.errors.map(e => e.message).join('; ')}`;
  });

  /* And the whole point: the chain now produces an answer. Run for real
     through the executor with the actual skills, no model involved. */
  check('the chained arithmetic turn answers instead of failing', async () => {
    const run = await runPlan(normalisePlanRefs(CHAIN), { registry, ctx: FIXED_CTX, message: 'what is 20 * 200? then multiply by 10' });
    if (run.results.length !== 2) return `expected 2 results, got ${run.results.length}`;
    if (!run.results.every(r => r.ok)) return `a step failed: ${JSON.stringify(run.results.find(r => !r.ok).error)}`;
    return run.results[1].value.result === 40000 || `got ${JSON.stringify(run.results[1].value)}`;
  });
}

/* ── 6a2. the input audit: the planner copies, it does not invent ────────────
   Measured: 26.5% of the shipped planner's plans carried a number the message
   never had, and the failure that matters is a whole payload — a CSV, a JSON
   body — written where the user gave none. The rule is narrow (payloads, and
   numbers only when the message has none) so that legitimate normalisation
   is never touched; each check below pins one side of that line. */
{
  const parseCsv = registry.skill('parseCsv');
  const A = (input, message, skill = parseCsv, extra = {}) => auditInput(input, { message, skill, ...extra });

  check('audit drops a CSV the message never contained', () => {
    const r = A({ text: 'name,age\nAna,34\nBo,28' }, 'read this csv into columns');
    return (r.dropped.length === 1 && r.dropped[0].field === 'text' && !('text' in r.input)) || JSON.stringify(r);
  });
  check('audit keeps a CSV the message did contain, however it was spaced', () => {
    const r = A({ text: 'name,age\nAna,34' }, 'read this csv:\nname, age\nAna, 34');
    return r.dropped.length === 0 || JSON.stringify(r.dropped);
  });
  check('audit keeps a short string — a name, a unit — regardless', () => {
    const r = A({ from: 'km', to: 'miles', amount: 5 }, 'how many miles is 5 km', registry.skill('convertLength'));
    return r.dropped.length === 0 || JSON.stringify(r.dropped);
  });
  check('audit keeps a normalised date the message only implied', () => {
    const r = A({ to: '2026-12-25' }, 'how many days until christmas', registry.skill('countdownTo'));
    return r.dropped.length === 0 || JSON.stringify(r.dropped);
  });
  check('audit keeps a derived number when the message had a quantity', () => {
    /* "double it" → 2 is a derivation; the message had 80, so numbers are not audited. */
    const r = A({ values: [12, 2] }, 'what is 15% of 80 then double it', registry.skill('product'));
    return r.dropped.length === 0 || JSON.stringify(r.dropped);
  });
  check('audit drops a number when the message had no quantity at all', () => {
    const r = A({ amount: 1, from: 'cup', to: 'tbsp' }, 'what should i cook tonight', registry.skill('convertCookingMeasure'));
    return (r.dropped.some(d => d.field === 'amount') && 'from' in r.input) || JSON.stringify(r);
  });
  check('audit drops a table whose rows the message never gave', () => {
    const r = A({ table: { headers: ['name', 'price'], rows: [{ name: 'Ana', price: 100 }, { name: 'Bo', price: 80 }] }, column: 'price' },
      'order the table by price descending', registry.skill('sortRows'));
    return (r.dropped.length === 1 && r.dropped[0].field === 'table' && r.input.column === 'price') || JSON.stringify(r);
  });
  check('audit keeps a small option object', () => {
    const r = A({ text: 'hello', style: 'title' }, 'title case hello', registry.skill('convertCase'));
    return r.dropped.length === 0 || JSON.stringify(r.dropped);
  });
  check('audit keeps a $ref and a ref inside a string', () => {
    const r = A({ expression: '$s1.result / 10', other: '$s1.result' }, 'then divide by 10', registry.skill('evaluateExpression'));
    return r.dropped.length === 0 || JSON.stringify(r.dropped);
  });
  check('audit keeps an enum value and a schema default', () => {
    const r = A({ text: 'x'.repeat(50), style: 'compact' }, 'write it compactly ' + 'x'.repeat(50), registry.skill('formatNumber'));
    return !r.dropped.some(d => d.field === 'style') || JSON.stringify(r.dropped);
  });
  check('audit keeps a payload that came from an earlier result', () => {
    const r = A({ text: 'alpha,beta,gamma' }, 'now parse that',
      parseCsv, { results: [{ id: 's1', ok: true, value: { csv: 'alpha,beta,gamma' } }] });
    return r.dropped.length === 0 || JSON.stringify(r.dropped);
  });
  check('audit keeps a payload the user typed in answer to a question', () => {
    const r = A({ text: 'a,b,c\n1,2,3' }, 'read this csv', parseCsv, { known: ['a,b,c\n1,2,3'] });
    return r.dropped.length === 0 || JSON.stringify(r.dropped);
  });
  check('audit is skipped for a hand-written plan (no message)', () => {
    const r = A({ text: 'name,age\nAna,34' }, '');
    return (r.dropped.length === 0 && Boolean(r.input.text)) || JSON.stringify(r);
  });
  check('ctx-owned fields are never audited', () => {
    const r = A({ text: 'a,b,c,d,e', locale: 'zz-ZZ', timezone: 'Mars/Olympus' }, 'parse a,b,c,d,e');
    return r.dropped.length === 0 || JSON.stringify(r.dropped);
  });

  /* End to end: the fabricated CSV becomes a question, and the ask says why. */
  /* D93 (2026-10-10): a payload the plan left out of a message that carries
     no data is asked for; the extractor does not fill it from the message.
     Measured on the planner bench: "smooth this over a 5 point window" put the
     5 in as the only value and failed. */
  /* D94 (2026-10-11): the audit keeps a value the derivation rules work out
     from the person's words. Before, "a fifth" planned as 0.2 inside
     expectedValue's outcomes was dropped as not in the message, and a
     marathon's 42.195 was dropped from a message with no digits. */
  check('D94: the audit keeps values worked out from the words, and still drops invented ones', async () => {
    const run = (message, skill, input) => runPlan({ steps: [{ id: 's1', skill, input }] }, { registry, ctx: FIXED_CTX, message });
    const ev = { outcomes: [{ value: 500, probability: 0.2 }, { value: 50, probability: 0.8 }] };
    const a = await run('I win 500 a fifth of the time and 50 four fifths of the time, what do I expect?', 'expectedValue', ev);
    if (a.outcome !== 'OK' || a.results[0].value.expectedValue !== 140) return `fifths: ${a.outcome} ${a.ask?.field ?? ''}`;
    const b = await run('in 3 out of 8 tries I win 40 and in 5 out of 8 I win 8, what is the average', 'expectedValue', { outcomes: [{ value: 40, probability: 0.375 }, { value: 8, probability: 0.625 }] });
    if (b.outcome !== 'OK') return `eighths: ${b.outcome} ${b.ask?.field ?? ''}`;
    const c = await run('how far is a marathon in miles', 'convertLength', { amount: 42.195, from: 'km', to: 'miles' });
    if (c.outcome !== 'OK' || c.results[0].input.amount !== 42.195) return `marathon: ${c.outcome} ${c.ask?.field ?? ''}`;
    // Invented values are still dropped and asked for.
    const d = await run('what do I expect on average', 'expectedValue', ev);
    if (d.outcome !== 'ASK_USER' || d.ask.field !== 'outcomes') return `invented outcomes kept: ${d.outcome}`;
    const e = await run('how far is it in miles', 'convertLength', { amount: 42.195, from: 'km', to: 'miles' });
    return (e.outcome === 'ASK_USER' && e.ask.field === 'amount') || `invented amount kept: ${e.outcome}`;
  });

  check('D93: the extractor does not fill a left-out payload from a message with no data', async () => {
    const extractor = jsExtractor(registry);
    const cases = [['smooth this over a 5 point window', 'movingAverage', { window: 5 }, 'values'],
      ['grab the bullets from this', 'extractListItems', { type: 'bulleted' }, 'text'],
      ['split that comma list onto separate lines', 'splitLines', {}, 'text']];
    for (const [message, skill, input, field] of cases) {
      const run = await runPlan({ steps: [{ id: 's1', skill, input }] }, { registry, ctx: FIXED_CTX, message, extractor });
      if (run.outcome !== 'ASK_USER' || run.ask.field !== field || !run.ask.untraceable) return `${message}: ${run.outcome} ${run.ask?.field ?? run.results?.[0]?.error?.message}`;
    }
    // A message that carries its data is still read.
    const run = await runPlan({ steps: [{ id: 's1', skill: 'splitLines', input: {} }] }, { registry, ctx: FIXED_CTX, message: 'split these onto lines: apples, pears, plums', extractor });
    return run.outcome !== 'ASK_USER' || `with data it asked for ${run.ask.field}`;
  });

  check('an invented CSV becomes ASK_USER, marked untraceable', async () => {
    const plan = { steps: [{ id: 's1', skill: 'parseCsv', input: { text: 'name,age\nAna,34\nBo,28' } }] };
    const run = await runPlan(plan, { registry, ctx: FIXED_CTX, message: 'read this csv into columns' });
    return (run.outcome === 'ASK_USER' && run.ask.field === 'text' && run.ask.untraceable === true)
      || JSON.stringify({ outcome: run.outcome, ask: run.ask, results: run.results.map(r => r.error) });
  });
  check('with the extractor in the loop, a data-less csv request still asks', async () => {
    const plan = { steps: [{ id: 's1', skill: 'parseCsv', input: { text: 'name,age\nAna,34\nBo,28' } }] };
    const run = await runPlan(plan, { registry, ctx: FIXED_CTX, message: 'read this csv into columns', extractor: jsExtractor(registry) });
    return (run.outcome === 'ASK_USER' && run.ask.field === 'text' && run.ask.untraceable === true)
      || JSON.stringify({ outcome: run.outcome, ask: run.ask, results: run.results.map(r => ({ input: r.input, err: r.error })) });
  });
  check('the extractor still takes the message as the text when the message IS the text', async () => {
    const ex = jsExtractor(registry);
    const patch = await ex({ message: 'count the words in this sentence please', skill: registry.skill('countWords'), input: {}, ctx: FIXED_CTX });
    return (patch && typeof patch.text === 'string' && patch.text.length > 0) || JSON.stringify(patch);
  });
  check('the extractor asks when the message only points at a payload', async () => {
    const ex = jsExtractor(registry);
    const patch = await ex({ message: 'tidy this json so it is readable', skill: registry.skill('formatJson'), input: {}, ctx: FIXED_CTX });
    return (!patch || patch.text === undefined) || JSON.stringify(patch);
  });
  check('the extractor still takes text after a colon even when the message points at it', async () => {
    const ex = jsExtractor(registry);
    const patch = await ex({ message: 'tidy this json: {"b":1,"a":2}', skill: registry.skill('formatJson'), input: {}, ctx: FIXED_CTX });
    return (patch && patch.text === '{"b":1,"a":2}') || JSON.stringify(patch);
  });
  check('an empty-input plan on a data-less message asks, and the ask is honest', async () => {
    const plan = { steps: [{ id: 's1', skill: 'formatJson', input: {} }] };
    const run = await runPlan(plan, { registry, ctx: FIXED_CTX, message: 'tidy this json so it is readable', extractor: jsExtractor(registry) });
    return (run.outcome === 'ASK_USER' && run.ask.field === 'text' && run.ask.untraceable === true && /did not include/.test(run.ask.why))
      || JSON.stringify({ outcome: run.outcome, ask: run.ask, results: run.results.map(r => r.error) });
  });
  check('an ask for a missing NUMBER on a data-less message is not marked honest', async () => {
    const plan = { steps: [{ id: 's1', skill: 'roundTo', input: {} }] };
    const run = await runPlan(plan, { registry, ctx: FIXED_CTX, message: 'round it please' });
    return (run.outcome === 'ASK_USER' && run.ask.untraceable === false) || JSON.stringify({ outcome: run.outcome, ask: run.ask });
  });
  check('a CSV the user actually gave still parses', async () => {
    const msg = 'read this csv into columns: name,age\nAna,34\nBo,28';
    const plan = { steps: [{ id: 's1', skill: 'parseCsv', input: { text: 'name,age\nAna,34\nBo,28' } }] };
    const run = await runPlan(plan, { registry, ctx: FIXED_CTX, message: msg });
    return (run.outcome === 'OK' && run.results[0].ok) || JSON.stringify({ outcome: run.outcome, ask: run.ask });
  });
  check('a dropped field is recorded on the result', async () => {
    const plan = { steps: [{ id: 's1', skill: 'convertCookingMeasure', input: { amount: 1, from: 'cup', to: 'tbsp' } }] };
    const run = await runPlan(plan, { registry, ctx: FIXED_CTX, message: 'what should i cook tonight' });
    const rec = run.results[0] || run.ask;
    return (rec && Array.isArray(rec.dropped) && rec.dropped.some(d => d.field === 'amount')) || JSON.stringify({ outcome: run.outcome, ask: run.ask, results: run.results });
  });
}

/* ── 6a3. the sibling check and the decline second look (verify.js) ────────
   Selection, not writing: JS chooses the alternatives, the model picks a name
   under a grammar, and a switch sends the planner back with ONE card. The
   checks below pin the JS half — who gets offered, what a stub answer does,
   and that a switch re-plans rather than rewrites. */
{
  const lexical = new LexicalRouter(registry);
  check('similarSkills stays in the category and is deterministic', () => {
    const a = lexical.similarSkills('applyDiscount', 3), b = lexical.similarSkills('applyDiscount', 3);
    const cat = registry.skill('applyDiscount').category;
    return (a.length > 0 && JSON.stringify(a) === JSON.stringify(b) && a.every(x => registry.skill(x.name).category === cat && x.name !== 'applyDiscount'))
      || JSON.stringify(a);
  });
  check('similarSkills ranks the obvious sibling near the top', () => {
    const names = lexical.similarSkills('parseMarkdownTable', 3).map(x => x.name);
    return names.includes('toMarkdownTable') || JSON.stringify(names);
  });
  const answer = (skill) => async () => ({ text: JSON.stringify({ asked_for: 'x', skill }), ms: 1 });
  const routing = lexical.route('take 20 percent off 150', {});
  check('siblingCheck keeps the draft when the model says so', async () => {
    const v = await siblingCheck({ complete: answer('applyDiscount'), registry, router: lexical })({ message: 'take 20 percent off 150', skill: 'applyDiscount', routing });
    return (v && v.chosen === 'applyDiscount' && v.draft === 'applyDiscount' && v.alternatives.length >= 1) || JSON.stringify(v);
  });
  check('siblingCheck switches when the model names an offered sibling', async () => {
    const check1 = siblingCheck({ complete: answer('stackDiscounts'), registry, router: lexical });
    const v = await check1({ message: 'stack 10 then 5 off 80', skill: 'applyDiscount', routing });
    return (v && v.chosen === 'stackDiscounts' && v.alternatives.includes('stackDiscounts')) || JSON.stringify(v);
  });
  check('siblingCheck ignores a name that was not offered', async () => {
    const v = await siblingCheck({ complete: answer('countWords'), registry, router: lexical })({ message: 'take 20 percent off 150', skill: 'applyDiscount', routing });
    return v === null || JSON.stringify(v);
  });
  check('siblingCheck is skipped when nothing plausible is nearby', async () => {
    let asked = false;
    /* evaluateExpression shares no name word with any other math skill, so
       with the vector floor out of reach nothing is left to offer. */
    const v = await siblingCheck({ complete: async () => { asked = true; return { text: '{}', ms: 1 }; }, registry, router: lexical, floor: 0.99 })({ message: 'x', skill: 'evaluateExpression', routing: { candidates: [] } });
    return (v === null && !asked) || JSON.stringify({ v, asked });
  });
  check('siblingCheck declines quietly when the model is unreachable', async () => {
    const v = await siblingCheck({ complete: async () => { throw new Error('down'); }, registry, router: lexical })({ message: 'take 20 percent off 150', skill: 'applyDiscount', routing });
    return v === null || JSON.stringify(v);
  });
  const cards = ['formatJson', 'flattenJson', 'sortObjectKeys'].map(n => registry.compactCard(n));
  check('declineCheck returns the chosen skill', async () => {
    const v = await declineCheck({ complete: answer('formatJson'), registry })({ message: 'tidy this json', cards });
    return (v && v.chosen === 'formatJson') || JSON.stringify(v);
  });
  check('declineCheck returns null on "none"', async () => {
    const v = await declineCheck({ complete: answer('none'), registry })({ message: 'write me a poem', cards });
    return v === null || JSON.stringify(v);
  });

  /* Through the turn: a switch re-plans with one card; the second look
     turns an empty plan into a step. Each test gets its own stub planner and
     its own record of what it was shown — the harness runs async checks
     concurrently, so a shared array would interleave. */
  const stub = () => {
    const shown = [];
    const planner = async ({ cards }) => {
      shown.push(cards.map(c => c.name));
      if (cards.length === 1) return { steps: [{ id: 's1', skill: cards[0].name, input: { price: 80, discounts: [10, 5] } }] };
      return { steps: [{ id: 's1', skill: 'applyDiscount', input: { price: 80, percent: 10 } }] };
    };
    return { shown, planner };
  };
  check('a verifier switch makes the planner re-plan with exactly one card', async () => {
    const { shown, planner: stubPlanner } = stub();
    const turn = await runTurn('stack 10 then 5 off 80', {
      registry, router: lexical, ctx: FIXED_CTX, planner: stubPlanner,
      verify: siblingCheck({ complete: answer('stackDiscounts'), registry, router: lexical })
    });
    const last = shown[shown.length - 1];
    return (turn.plan.steps[0].skill === 'stackDiscounts' && last && last.length === 1 && last[0] === 'stackDiscounts' && turn.verified && turn.verified.draft === 'applyDiscount')
      || JSON.stringify({ plan: turn.plan, shown, verified: turn.verified });
  });
  check('a second look rescues an empty plan into a one-card re-plan', async () => {
    const shown = [];
    const emptyThenOne = async ({ cards }) => { shown.push(cards.map(c => c.name)); return cards.length === 1 ? { steps: [{ id: 's1', skill: cards[0].name, input: {} }] } : { steps: [] }; };
    /* A router that names a category, as the adapter would. */
    const named = { route: async (m, o) => ({ ...lexical.route(m, o), category: 'data' }), similarSkills: (n, k) => lexical.similarSkills(n, k) };
    const turn = await runTurn('tidy this json so I can read it', {
      registry, router: named, ctx: FIXED_CTX, planner: emptyThenOne,
      secondLook: declineCheck({ complete: answer('formatJson'), registry })
    });
    return Boolean(turn.plan && turn.plan.steps.length === 1 && turn.plan.steps[0].skill === 'formatJson' && turn.verified && turn.verified.secondLook === true && (turn.ask || turn.results.length))
      || JSON.stringify({ mode: turn.mode, plan: turn.plan, verified: turn.verified, ask: turn.ask });
  });
  check('without the flags nothing changes', async () => {
    const { shown, planner: stubPlanner } = stub();
    const turn = await runTurn('take 20 percent off 150', { registry, router: lexical, ctx: FIXED_CTX, planner: stubPlanner });
    return (turn.plan.steps[0].skill === 'applyDiscount' && !turn.verified && shown.length === 1) || JSON.stringify({ plan: turn.plan, shown });
  });
}

/* ── 6a4. the sibling adapter's shape: trained mode and its data ──────────── */
{
  const lexical = new LexicalRouter(registry);
  const routing = lexical.route('take 20 percent off 150', {});
  check('siblingCheck in trained mode sends no shots and a name-only grammar', async () => {
    let seen = null;
    const c = siblingCheck({ complete: async (req) => { seen = req; return { text: 'applyDiscount', ms: 1 }; }, registry, router: lexical, trained: true });
    const v = await c({ message: 'take 20 percent off 150', skill: 'applyDiscount', routing });
    return (v && v.chosen === 'applyDiscount' && seen.messages.length === 2 && /^root ::= "applyDiscount"/.test(seen.grammar) && !/asked_for/.test(seen.grammar))
      || JSON.stringify({ v, n: seen && seen.messages.length, grammar: seen && seen.grammar.slice(0, 60) });
  });
  check('the trained user turn is the shared builder, byte for byte', () => {
    const cards = ['applyDiscount', 'stackDiscounts'].map(n => registry.compactCard(n));
    const turn = siblingUserTurn({ message: 'm', cards });
    return (turn.startsWith('MESSAGE\nm\n\nSKILLS (1 is the draft)\n1. applyDiscount') && turn.includes('\n2. stackDiscounts')) || turn.slice(0, 80);
  });
  /* The written set, when it exists: every answer is among its cards, no card
     carries the message's own example, keep and switch are balanced, and no
     message is a bench message. */
  let sib = [];
  try { sib = readdirSync(join(ROOT, 'model/sibling-data')).filter(f => f.endsWith('.jsonl')).flatMap(f => readFileSync(join(ROOT, 'model/sibling-data', f), 'utf8').trim().split('\n').map(l => JSON.parse(l))); } catch { sib = []; }
  if (sib.length) {
    const msgOf = (r) => r.messages[1].content.split('\n')[1];
    check('sibling set: every answer is one of the offered cards', () =>
      sib.every(r => r.messages[1].content.includes(`. ${r.messages[2].content} — `)) || 'an answer is not among its cards');
    check('sibling set: no card carries the message\'s own example', () =>
      sib.every(r => !r.messages[1].content.includes(`e.g. "${msgOf(r)}"`)) || 'a giveaway row exists');
    check('sibling set: keep and switch are balanced', () => {
      const keep = sib.filter(r => r.messages[1].content.split('\n')[4].startsWith(`1. ${r.messages[2].content} `)).length;
      return Math.abs(keep - (sib.length - keep)) <= 2 || `keep ${keep} of ${sib.length}`;
    });
    check('sibling set: no bench message was trained on', () => {
      const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      const bench = new Set([...HOLDOUT_MESSAGES, ...NO_SKILL_MESSAGES].map(norm));
      const leaks = sib.filter(r => bench.has(norm(msgOf(r))));
      return leaks.length === 0 || `${leaks.length} rows use a bench message`;
    });
  }
}

/* ── 6b. the focus pass (§8's seam) ──────────────────────────────────────────
   The claim this section defends: a focused reply is the SOURCE'S OWN words.
   The model chooses a sentence number and JS renders that sentence, so every
   check below is about the JS half — the splitter is lossless, an out-of-range
   or refusing model changes nothing, and what comes out is always a sentence
   that went in. A stub `complete` stands in for the model, because what must
   not break is the behaviour when the model answers oddly. */
{
  const PASSAGE = "The governor of the State of Maryland is the head of government of Maryland, and is the commander-in-chief of the state's National Guard units. The governor is the highest-ranking official in the state and has a broad range of appointive powers in both the state and local governments, as specified by the Maryland Constitution (1867, and revisions/amendments). The current governor is Wes Moore, who has been in office since 2023.";

  check('splitSentences is lossless — the pieces rejoin to the source', () => {
    const parts = splitSentences(PASSAGE);
    return parts.length === 3 || `split into ${parts.length}: ${JSON.stringify(parts)}`;
  });
  check('splitSentences rejoins exactly, so a quote is verifiable', () => {
    const norm = PASSAGE.replace(/\s+/g, ' ').trim();
    return splitSentences(PASSAGE).join(' ') === norm || 'rejoined text differs from the source';
  });
  check('splitSentences keeps an abbreviation whole', () => {
    const parts = splitSentences('She joined the U.S. Senate in 1999. It was her second term.');
    return parts.length === 2 || `split into ${parts.length}: ${JSON.stringify(parts)}`;
  });
  check('splitSentences on one sentence is one sentence', () =>
    splitSentences('Ulaanbaatar is the capital of Mongolia.').length === 1 || 'expected 1');
  check('splitSentences on nothing is nothing', () =>
    splitSentences('').length === 0 && splitSentences(null).length === 0 || 'expected []');

  /* A model that names a sentence: the reply must be that sentence, verbatim. */
  const picks = (n) => sentenceFocus({ complete: async () => ({ text: JSON.stringify({ looking_for: 'x', sentence: n }), ms: 1 }) });
  check('focus returns the chosen sentence, character for character', async () => {
    const got = await picks(3)({ message: 'who is the governor of Maryland', answer: PASSAGE });
    return (got && got.text === 'The current governor is Wes Moore, who has been in office since 2023.')
      || `got ${JSON.stringify(got && got.text)}`;
  });
  check('a focused sentence is always a substring of the answer', async () => {
    const got = await picks(2)({ message: 'q', answer: PASSAGE });
    return (got && PASSAGE.replace(/\s+/g, ' ').includes(got.text)) || 'focused text is not in the source';
  });
  /* Everything below must leave the passage whole — the reply the app shipped
     before this pass existed. */
  check('focus declines when the model says 0', async () =>
    (await picks(0)({ message: 'q', answer: PASSAGE })) === null || 'expected null');
  check('focus declines an out-of-range sentence number', async () =>
    (await picks(99)({ message: 'q', answer: PASSAGE })) === null || 'expected null');
  check('focus declines a one-sentence answer without asking a model', async () => {
    let asked = false;
    const f = sentenceFocus({ complete: async () => { asked = true; return { text: '{"looking_for":"x","sentence":1}', ms: 1 } } });
    const got = await f({ message: 'q', answer: 'Ulaanbaatar is the capital of Mongolia.' });
    return (got === null && !asked) || `got ${JSON.stringify(got)}, asked=${asked}`;
  });
  check('focus declines when the model is unreachable', async () => {
    const f = sentenceFocus({ complete: async () => { throw new Error('no model'); } });
    return (await f({ message: 'q', answer: PASSAGE })) === null || 'expected null';
  });
  check('focus declines on unparseable output', async () => {
    const f = sentenceFocus({ complete: async () => ({ text: 'sentence three', ms: 1 }) });
    return (await f({ message: 'q', answer: PASSAGE })) === null || 'expected null';
  });

  /* And the seam itself: replyFor must mark a focused answer as a web value
     carrying the untrimmed answer, so the detail view still shows everything. */
  const webResult = [{
    id: 's1', skill: 'webAnswer', ok: true,
    value: { answer: PASSAGE, source: 'https://en.wikipedia.org/wiki/Governor_of_Maryland' },
    input: { question: 'governor of Maryland' },
    provenance: { kind: 'web', source: 'https://en.wikipedia.org/wiki/Governor_of_Maryland' },
    labels: [], ms: 1
  }];
  check('replyFor uses the focus pass for a web answer', async () => {
    const reply = await replyFor(webResult, { registry, message: 'who is the governor of Maryland', ctx: FIXED_CTX, focus: picks(3) });
    return (reply.source === REPLY_SOURCES.FOCUSED &&
      reply.segments.length === 1 &&
      reply.segments[0].text === 'The current governor is Wes Moore, who has been in office since 2023.')
      || `got ${reply.source}: ${JSON.stringify(toPlainText(reply.segments))}`;
  });
  check('a focused segment keeps the whole answer as its raw value', async () => {
    const reply = await replyFor(webResult, { registry, message: 'q', ctx: FIXED_CTX, focus: picks(3) });
    const seg = reply.segments[0];
    return (seg.raw === PASSAGE && seg.provenance.kind === 'web' && seg.type === 'value')
      || 'a focused segment must stay a web value carrying the full answer';
  });
  check('replyFor falls back to the template when focus declines', async () => {
    const reply = await replyFor(webResult, { registry, message: 'q', ctx: FIXED_CTX, focus: picks(0) });
    return (reply.source === REPLY_SOURCES.TEMPLATE && toPlainText(reply.segments) === PASSAGE)
      || `got ${reply.source}`;
  });
  check('with no focus installed the reply is unchanged', async () => {
    const reply = await replyFor(webResult, { registry, message: 'q', ctx: FIXED_CTX });
    return (reply.source === REPLY_SOURCES.TEMPLATE && toPlainText(reply.segments) === PASSAGE)
      || `got ${reply.source}`;
  });
  /* ── which step is the answer: derived from the plan, no model ─────────── */
  const CHAIN_PLAN = {
    steps: [
      { id: 's1', skill: 'evaluateExpression', input: { expression: '20 * 200' } },
      { id: 's2', skill: 'evaluateExpression', input: { expression: '$s1.result / 10' } }
    ]
  };
  const twoSteps = [
    { id: 's1', skill: 'evaluateExpression', ok: true, value: { result: 4000, expression: '20 * 200', exact: true },
      input: { expression: '20 * 200' }, provenance: { kind: 'computed' }, labels: [], ms: 1 },
    { id: 's2', skill: 'evaluateExpression', ok: true, value: { result: 400, expression: '4000 / 10', exact: true },
      input: { expression: '4000 / 10' }, provenance: { kind: 'computed' }, labels: [], ms: 1 }
  ];

  check('answeringStep picks the step nothing else consumes', () =>
    answeringStep(CHAIN_PLAN, twoSteps) === 's2' || `got ${answeringStep(CHAIN_PLAN, twoSteps)}`);
  check('answeringStep sees a ref embedded in an expression', () => {
    /* The whole reason this works: "$s1.result / 10" is not a whole-value ref,
       and a version of refsIn that missed it would call s1 terminal too. */
    const plan = { steps: [
      { id: 's1', skill: 'a', input: {} },
      { id: 's2', skill: 'b', input: { e: 'the total is $s1.result exactly' } }
    ] };
    return answeringStep(plan, [
      { id: 's1', ok: true }, { id: 's2', ok: true }
    ]) === 's2' || 'an embedded ref must mark s1 as working';
  });
  check('answeringStep declines when steps are independent', () => {
    const plan = { steps: [
      { id: 's1', skill: 'describeNumbers', input: { values: [1, 2] } },
      { id: 's2', skill: 'median', input: { values: [1, 2] } }
    ] };
    return answeringStep(plan, [{ id: 's1', ok: true }, { id: 's2', ok: true }]) === null
      || 'two things were asked for; both must be shown';
  });
  check('answeringStep declines when two steps are both terminal', () => {
    const plan = { steps: [
      { id: 's1', skill: 'a', input: {} },
      { id: 's2', skill: 'b', input: { x: '$s1.result' } },
      { id: 's3', skill: 'c', input: { y: '$s1.result' } }
    ] };
    return answeringStep(plan, [{ id: 's1', ok: true }, { id: 's2', ok: true }, { id: 's3', ok: true }]) === null
      || 'a fork has no single answer';
  });
  check('answeringStep ignores a $prev ref from an earlier turn', () => {
    const plan = { steps: [
      { id: 's1', skill: 'a', input: { x: '$prev.s1.result' } },
      { id: 's2', skill: 'b', input: { y: 2 } }
    ] };
    return answeringStep(plan, [{ id: 's1', ok: true }, { id: 's2', ok: true }]) === null
      || 'a previous-turn ref says nothing about this plan';
  });
  check('answeringStep is null for a single-step plan', () =>
    answeringStep({ steps: [CHAIN_PLAN.steps[0]] }, [twoSteps[0]]) === null || 'expected null');

  check('a chained reply shows only the answering step', async () => {
    const reply = await replyFor(twoSteps, { registry, message: 'what is 20 * 200? then divide by 10', ctx: FIXED_CTX, plan: CHAIN_PLAN });
    return (reply.source === REPLY_SOURCES.FOCUSED_STEP && toPlainText(reply.segments) === '4000 / 10 = 400')
      || `got ${reply.source}: ${JSON.stringify(toPlainText(reply.segments))}`;
  });
  check('the answering step keeps its own marked values and provenance', async () => {
    const reply = await replyFor(twoSteps, { registry, message: 'q', ctx: FIXED_CTX, plan: CHAIN_PLAN });
    const marked = reply.segments.filter(sg => sg.type === 'value');
    return (marked.length > 0 && marked.every(sg => sg.step === 's2' && sg.provenance))
      || 'the focused step must keep value marks pointing at that step';
  });
  check('a failed step is never hidden', async () => {
    const withFailure = [twoSteps[0], {
      id: 's2', skill: 'evaluateExpression', ok: false,
      error: { code: 'INVALID_INPUT', field: 'expression', message: 'nope' },
      input: { expression: 'x' }, provenance: null, labels: [], ms: 1
    }];
    const reply = await replyFor(withFailure, { registry, message: 'q', ctx: FIXED_CTX, plan: CHAIN_PLAN });
    return (reply.source === REPLY_SOURCES.TEMPLATES_CONCATENATED &&
      reply.segments.some(sg => sg.type === 'failure'))
      || `a plan with a failed step must still show it, got ${reply.source}`;
  });
  check('with no plan passed a multi-step reply is unchanged', async () => {
    const reply = await replyFor(twoSteps, { registry, message: 'q', ctx: FIXED_CTX });
    return (reply.source === REPLY_SOURCES.TEMPLATES_CONCATENATED &&
      toPlainText(reply.segments) === '20 * 200 = 4000 4000 / 10 = 400')
      || `got ${reply.source}: ${JSON.stringify(toPlainText(reply.segments))}`;
  });
  check('a focused step still passes the fabrication auditor', async () => {
    const msg = 'what is 20 * 200? then divide by 10';
    const reply = await replyFor(twoSteps, { registry, message: msg, ctx: FIXED_CTX, plan: CHAIN_PLAN });
    const audit = auditSegments(reply.segments, { message: msg, results: twoSteps });
    return audit.ok || `violations: ${JSON.stringify(audit.violations)}`;
  });

  /* A computed (non-web) result must never go through this path. */
  check('focus does not touch a computed answer', async () => {
    const computed = [{
      id: 's1', skill: 'convertLength', ok: true,
      value: { result: '3.107 mi', amount: 5, from: 'km', to: 'miles' },
      input: { amount: 5, from: 'km', to: 'miles' },
      provenance: { kind: 'computed' }, labels: [], ms: 1
    }];
    const reply = await replyFor(computed, { registry, message: 'q', ctx: FIXED_CTX, focus: picks(1) });
    return reply.source === REPLY_SOURCES.TEMPLATE || `got ${reply.source}`;
  });
}

/* ── 6d. reading an image: the tidy pass is audited (ocr.js) ────────────────
   A model is asked to repair OCR damage and its answer is checked with the
   same number extractor §8 uses on replies. Every branch below is one the
   app takes without a live model: the stub says what the model said. */
{
  /* `tokens` matters now: spending the whole budget is how a truncated repair
     is recognised, so a test has to be able to say it did. */
  const stub = (text, tokens = 1) => async () => ({ text, confidence: 1, ms: 0, tokens, promptTokens: 1 });
  const dead = async () => { throw new Error('no server'); };
  const recording = (text) => {
    const calls = [];
    const f = async (opts) => { calls.push(opts); return { text, confidence: 1, ms: 0, tokens: 1, promptTokens: 1 }; };
    f.calls = calls;
    return f;
  };
  const raw = 'The meeting has been moved to\nThursday , and the room is the\nsame as last time.';
  const tidy = 'The meeting has been moved to Thursday, and the room is the same as last time.';

  check('a faithful tidy is accepted', async () => {
    const r = await cleanupOcr({ raw, complete: stub(tidy), model: 'qwen' });
    return (r.used === 'cleaned' && r.cleaned === tidy && r.reason === null && r.model === 'qwen')
      || `got ${JSON.stringify(r)}`;
  });

  check('a tidy that turns 1O into 10 is thrown out — 10 is a number the engine never read', async () => {
    const r = await cleanupOcr({ raw: 'I have 1O apples', complete: stub('I have 10 apples') });
    return (r.used === 'raw' && /10/.test(r.reason || '') && r.cleaned === 'I have 10 apples')
      || `got ${JSON.stringify(r)}`;
  });

  check('the guard is on values, not glyphs: "ten" to "10" is the same number', async () => {
    const r = await cleanupOcr({ raw: 'I have ten apples', complete: stub('I have 10 apples') });
    return r.used === 'cleaned' || `got ${JSON.stringify(r)}`;
  });

  check('a tidy that balloons is thrown out', async () => {
    const r = await cleanupOcr({ raw: 'Total 7.75', complete: stub('Total 7.75. ' + 'Thank you for shopping with us today. '.repeat(3)) });
    return (r.used === 'raw' && /length/.test(r.reason || '')) || `got ${JSON.stringify(r)}`;
  });

  check('a tidy that shrinks by half is thrown out', async () => {
    const r = await cleanupOcr({ raw, complete: stub('The meeting has moved.') });
    return (r.used === 'raw' && /length/.test(r.reason || '')) || `got ${JSON.stringify(r)}`;
  });

  check('an empty reply keeps the raw reading, with a reason', async () => {
    const r = await cleanupOcr({ raw, complete: stub('   ') });
    return (r.used === 'raw' && r.reason && r.cleaned === null) || `got ${JSON.stringify(r)}`;
  });

  check('no model → raw, and the image is not lost', async () => {
    const a = await cleanupOcr({ raw, complete: dead });
    const b = await cleanupOcr({ raw, complete: null });
    return (a.used === 'raw' && a.reason === 'no model' && /no server/.test(a.error || '')
      && b.used === 'raw' && b.reason === 'no model')
      || `got ${JSON.stringify([a, b])}`;
  });

  /* The failure that prompted these: a model handed back its own instructions
     under a plain "Thinking Process:" heading, with no tag to strip, cut off
     mid-sentence — and it reached the composer as if it were the reading. */
  const preamble = 'Thinking Process:\n\n1.  **Analyze the Request:**\n    *   Task: Repair the OCR damage.\n'
    + '    *   Rules:\n        1. Join a line that was broken in the middle.\n'
    + '        2. two words run together, one word split in two.\n        5. Add nothing, remove nothing,';

  check('a tagless reasoning preamble never reaches the composer', async () => {
    const r = await cleanupOcr({ raw: 'Wise\nmodel 292 correct\n269 MB', complete: stub(preamble) });
    return (r.used === 'raw' && /instructions/.test(r.reason || '')) || `got ${JSON.stringify(r)}`;
  });

  /* The number guard would have caught this one only if the reading happened
     not to contain 1–5. The instruction check does not depend on luck. */
  check('the instructions coming back are refused whatever the reading contained', () => {
    const withDigits = auditCleanup('one two three four five 1 2 3 4 5', preamble);
    return /instructions/.test(withDigits || '') || `got ${JSON.stringify(withDigits)}`;
  });

  check('but a reading that is genuinely about repairing OCR is still tidied', () => {
    /* The check only fires on a phrase the READING does not have. */
    const raw = 'Rule 2 : two words run together , one word split in two';
    const tidy = 'Rule 2: two words run together, one word split in two';
    return auditCleanup(raw, tidy) === null || `got ${JSON.stringify(auditCleanup(raw, tidy))}`;
  });

  check('a tidy that ran out of room is refused, however faithful it looks', async () => {
    const raw = 'The meeting has been moved to\nThursday , and the room is the\nsame as last time.';
    const tidy = 'The meeting has been moved to Thursday, and the room is the same as last time.';
    const spent = await cleanupOcr({ raw, complete: stub(tidy, cleanupBudget(raw)) });
    const roomy = await cleanupOcr({ raw, complete: stub(tidy, cleanupBudget(raw) - 1) });
    return (spent.used === 'raw' && /ran out of room/.test(spent.reason || '') && roomy.used === 'cleaned')
      || `got ${JSON.stringify([spent.reason, roomy.used])}`;
  });

  check('a model that reasons and then answers keeps its answer', async () => {
    const raw = 'The meeting has been moved to\nThursday , and the room is the\nsame as last time.';
    const tidy = 'The meeting has been moved to Thursday, and the room is the same as last time.';
    const r = await cleanupOcr({ raw, complete: stub(`Thinking Process:\n\n1. Join the broken line.\n\n${tidy}`) });
    return (r.used === 'cleaned' && r.cleaned === tidy) || `got ${JSON.stringify(r)}`;
  });

  check('a preamble is only a preamble at the top', () => {
    /* A receipt with the word "Analysis" partway down is a receipt. */
    const body = 'Lab report\nAnalysis: complete\nTotal 7.75';
    return stripThinking(body) === body || `mangled: ${JSON.stringify(stripThinking(body))}`;
  });

  check('a tidy that fixes every misread word is still accepted', async () => {
    const r = await cleanupOcr({ raw: 'Ihe rneeting is on Ihursday rnorning', complete: stub('The meeting is on Thursday morning') });
    return r.used === 'cleaned' || `got ${JSON.stringify(r)}`;
  });

  check('a thinking model\'s think block is stripped, and an unterminated one audits as empty', async () => {
    const a = await cleanupOcr({ raw, complete: stub(`<think>fix the line breaks</think>\n${tidy}`) });
    const b = await cleanupOcr({ raw, complete: stub('<think>hmm, the text says') });
    return (a.used === 'cleaned' && a.cleaned === tidy && b.used === 'raw' && /nothing/.test(b.reason || ''))
      || `got ${JSON.stringify([a, b])}`;
  });

  check('stripThinking leaves ordinary text alone', () =>
    stripThinking('  Total 7.75 ') === 'Total 7.75' || 'trimmed wrongly');

  check('the tidy is greedy, budgeted, and carries the raw text last', async () => {
    const rec = recording(tidy);
    await cleanupOcr({ raw, complete: rec });
    const o = rec.calls[0];
    const last = o.messages[o.messages.length - 1];
    return (o.temperature === 0 && o.maxTokens >= 64 && o.maxTokens <= 1024 && !o.grammar
      && last.role === 'user' && last.content === raw && o.messages[0].role === 'system')
      || `got ${JSON.stringify({ t: o.temperature, max: o.maxTokens, last })}`;
  });

  check('cleanupBudget is clamped to [64, 1024]', () =>
    (cleanupBudget('') === 64 && cleanupBudget('x'.repeat(10000)) === 1024
      && cleanupBudget('x'.repeat(400)) === Math.ceil(Math.ceil(400 / 3) * 1.25) + 32)
    || `${cleanupBudget('')} ${cleanupBudget('x'.repeat(400))} ${cleanupBudget('x'.repeat(10000))}`);

  check('cleanupBudget counts digits and punctuation as tokens, so a receipt is not cut off (prose keeps the budget it had)', () => {
    /* The receipt the OCR bench cut off at 127 tokens: about 140 were needed. */
    const receipt = 'Harbour Lane Grocers\n14 Harbour Lane , Fenwick FN3 2QT\nTel 01632 960412\n2 x Semi-skimmed milk 1L £2.30\nWholemeal loaf £1.45\nFree range eggs x6 £2.10\nCheddar 400g £3.75\nBananas 0.82kg £0.94\nTOTAL £10.54\nCard ending 4417 approved\n12/03/2026 09:42 Till 2';
    const prose = 'Please remember that the library will be closed on Monday while we install the new shelving and lighting in the children\'s wing. Normal opening hours resume on Tuesday.';
    const old = (r) => Math.min(1024, Math.max(64, Math.ceil(r.length / 4 * 1.5) + 32));
    const digits = (receipt.match(/\d/g) || []).length;
    if (!(cleanupBudget(receipt) >= 180 && cleanupBudget(receipt) > digits * 2)) return `receipt budget ${cleanupBudget(receipt)}`;
    return Math.abs(cleanupBudget(prose) - old(prose)) <= 10 || `prose budget moved: ${old(prose)} → ${cleanupBudget(prose)}`;
  });

  check('auditCleanup names the first invented number, up to three', () => {
    const one = auditCleanup('a', 'a 7');
    const many = auditCleanup('a', 'a 1 2 3 4');
    return (/introduced the number 7$/.test(one) && /numbers 1, 2, 3$/.test(many)) || `${one} | ${many}`;
  });

  check('composeMessage: question, text, both, neither', () =>
    (composeMessage('add these', 'a 1\nb 2') === 'add these\n\na 1\nb 2'
      && composeMessage('add these', '') === 'add these'
      && composeMessage('  ', 'a 1') === 'a 1'
      && composeMessage('', '') === '')
    || 'a shape came out wrong');

  check('capAttached cuts at a line boundary and says so', () => {
    const lines = Array.from({ length: 400 }, (_, i) => `line ${i} of the receipt`).join('\n');
    const r = capAttached(lines);
    const short = capAttached('short');
    return (r.truncated && r.text.length <= ATTACH_CAP + 1 && r.text.endsWith('…')
      && /receipt…$/.test(r.text) && !short.truncated && short.text === 'short')
      || `got ${r.text.length} truncated=${r.truncated} tail=${JSON.stringify(r.text.slice(-30))}`;
  });

  check('describeAttachment says what happened, tidied or raw', () => {
    const base = { name: 'receipt.png', text: 'Coffee 4.50\nTotal 7.75', engine: 'tesseract 5.5.0' };
    const t = describeAttachment({ ...base, used: 'cleaned', model: 'qwen' });
    const r = describeAttachment({ ...base, used: 'raw', reason: 'introduced the number 10', edited: true });
    return (t === 'receipt.png · 4 words · read by tesseract 5.5.0, tidied by qwen'
      && r === 'receipt.png · 4 words · read by tesseract 5.5.0 · raw — introduced the number 10 · edited before sending')
      || `${t}\n    ${r}`;
  });

  /* The clipboard mirrors the bubble: the question as typed, then the text
     read from the image, labelled — not the composed message the router saw. */
  check('copyOf carries the image\'s text and the typed question, and answerOf is unchanged', async () => {
    const lex = new LexicalRouter(registry);
    const image = {
      name: 'note.png', mime: 'image/png', engine: 'tesseract 5.5.0', model: null,
      raw: 'the quick brown fox', cleaned: null, used: 'raw', reason: 'no model',
      text: 'the quick brown fox', typed: 'how many words', edited: false, truncated: false,
      ocrMs: 120, cleanupMs: 0
    };
    const turn = await runTurn(composeMessage(image.typed, image.text), {
      registry, router: lex, ctx: { ...FIXED_CTX },
      plan: { steps: [{ id: 's1', skill: 'countWords', input: { text: image.text } }] }
    });
    turn.image = image;
    const copy = copyOf(turn);
    const want = toPlainText(turn.reply.segments);
    return (copy.startsWith('You: how many words\n\n[from an image — note.png · 4 words · read by tesseract 5.5.0 · raw — no model]\nthe quick brown fox\n\nPigeon: ')
      && answerOf(turn) === want && copy.endsWith(want))
      || `got ${JSON.stringify(copy)}`;
  });

  check('a turn with an image survives being saved and read back', async () => {
    const lex = new LexicalRouter(registry);
    const image = { name: 'n.png', raw: 'a 1', cleaned: 'a 1', used: 'cleaned', reason: null, text: 'a 1', typed: '', edited: false, ocrMs: 1, cleanupMs: 2 };
    const turn = await runTurn('a 1', {
      registry, router: lex, ctx: { ...FIXED_CTX },
      plan: { steps: [{ id: 's1', skill: 'countWords', input: { text: 'a 1' } }] }
    });
    turn.image = image;
    const back = JSON.parse(JSON.stringify(turn));
    return JSON.stringify(back.image) === JSON.stringify(image) || 'the image record changed on the way to disk';
  });

  check('the rail has a vision row: a stand-in with an engine, off without', () => {
    const on = stackReport({ router: { name: 'lexical' }, planner: null, extractor: null, assembler: null, ocr: { engine: 'tesseract 5.5.0' } });
    const off = stackReport({ router: { name: 'lexical' }, planner: null, extractor: null, assembler: null });
    const a = on.find(r => r.pass === 'vision'), b = off.find(r => r.pass === 'vision');
    return (a && a.state === 'sub' && /tesseract 5\.5\.0/.test(a.detail) && /raw/.test(a.detail)
      && b && b.state === 'off')
      || `got ${JSON.stringify([a, b])}`;
  });

  check('the vision row names the tidy model when there is one', () => {
    const on = stackReport({ router: { name: 'lexical' }, planner: {}, extractor: null, assembler: null, model: 'qwen', ocr: { engine: 'tesseract' } });
    const a = on.find(r => r.pass === 'vision');
    return /tidied by qwen/.test(a.detail) || a.detail;
  });
}

/* ── the engine, as the page reads it ────────────────────────────────────── */
{
  const esc = (x) => String(x).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const MODELS = {
    /* One model from Patch v10 (2026-10-14): Qwen3.5 2B left the app. */
    models: [
      { id: 'category', role: 'category', name: 'Qwen3-VL 2B Instruct', quant: 'Q4_K_M', file: 'Qwen3VL-2B-Instruct-Q4_K_M.gguf', bytes: 1107409952, resident_mb: 2150, licence: { spdx: 'Apache-2.0', holder: 'Qwen team, Alibaba Cloud' }, state: 'missing', adapter: { file: 'pigeon-category.lora.gguf', present: true } }
    ],
    download_bytes: 1107409952, remaining_bytes: 1107409952, downloading: false,
    hardware: { total_mb: 16384, budget_mb: 12288, share_mb: 10444, need_mb: 2183, fit: 'fits', spare: true },
    notices: []
  };
  const BUNDLED = { disabled: false, binary: { source: 'bundled', version: '961e4b2' }, idle_unload_s: 0,
    category: { phase: 'asleep', owned: false, port: 8101 } };

  check('fmtBytes is decimal and matches the sheet', () =>
    (fmtBytes(1280835840) === '1.3 GB' && fmtBytes(986048768) === '1.0 GB' && fmtBytes(2266884608) === '2.3 GB'
      && fmtBytes(546000000) === '546 MB' && fmtRam(16384) === '16 GB')
    || `${fmtBytes(1280835840)} ${fmtBytes(986048768)} ${fmtBytes(2266884608)} ${fmtBytes(546000000)}`);

  check('the fit line says whether the one model fits, and the unreadable case', () => {
    const fits = fitLine(MODELS.hardware).text;
    const tight = fitLine({ ...MODELS.hardware, total_mb: 4096, spare: false }).text;
    const none = fitLine({ ...MODELS.hardware, total_mb: 2048, fit: 'none' }).text;
    const unknown = fitLine(null);
    return (fits === 'This Mac has 16 GB — plenty' && tight === 'This Mac has 4 GB — enough'
      && /2 GB — the model does not fit/.test(none) && unknown.tone === 'warn' && !/both/.test(unknown.text))
      || [fits, tight, none, unknown.text].join(' | ');
  });

  check('the rail says own, a stand-in or none for the engine', () => {
    const own = engineRows(BUNDLED, MODELS)[0];
    const standin = engineRows({ ...BUNDLED, binary: { source: 'path', version: null } }, MODELS)[0];
    const none = engineRows(null, null)[0];
    const off = engineRows({ ...BUNDLED, disabled: true }, MODELS)[0];
    return (own.state === 'on' && own.detail === 'own · bundled · asleep'
      && standin.state === 'sub' && /from PATH/.test(standin.detail)
      && none.state === 'off' && /browser/.test(none.detail)
      && off.state === 'off' && /PIGEON_NO_MODELS/.test(off.detail))
      || JSON.stringify([own, standin, none, off]);
  });

  check('the engine row says whether the model is awake, waking, or broken', () => {
    const awake = engineRows({ ...BUNDLED, category: { phase: 'ready' } }, MODELS)[0].detail;
    const waking = engineRows({ ...BUNDLED, category: { phase: 'waking' } }, MODELS)[0].detail;
    const broken = engineRows({ ...BUNDLED, category: { phase: 'error', detail: 'the engine would not start' } }, MODELS)[0].detail;
    /* A status from before v10 still carries a planner row: it is not counted. */
    const old = engineRows({ ...BUNDLED, planner: { phase: 'ready' }, category: { phase: 'ready' } }, MODELS)[0].detail;
    return (/1 awake$/.test(awake) && /waking$/.test(waking) && /error — the engine would not start/.test(broken) && /1 awake$/.test(old))
      || [awake, waking, broken, old].join(' | ');
  });

  check('the models row counts, sizes and says what is still to fetch', () => {
    const missing = engineRows(BUNDLED, MODELS)[1];
    const present = engineRows(BUNDLED, { ...MODELS, download_bytes: 0, remaining_bytes: 0, models: MODELS.models.map(m => ({ ...m, state: 'present', verified: true })) })[1];
    const half = engineRows(BUNDLED, { ...MODELS, remaining_bytes: 561409952, models: [{ ...MODELS.models[0], state: 'partial', have_bytes: 546000000 }] })[1];
    const running = engineRows(BUNDLED, { ...MODELS, downloading: true, models: [{ ...MODELS.models[0], state: 'partial', have_bytes: 546000000 }] })[1];
    return (missing.state === 'off' && missing.detail === 'not downloaded · 1.1 GB'
      && present.state === 'on' && present.detail === '1 · 1.1 GB'
      && half.state === 'sub' && half.detail === '0 of 1 · 561 MB to fetch'
      && running.state === 'sub' && running.detail === 'downloading 49%')
      || JSON.stringify([missing, present, half, running]);
  });

  check('progressLine renders 49% · 546 MB of 1.1 GB', () => {
    const p = progressLine({ id: 'category', stage: 'download', received: 546000000, total: 1107409952, overall_received: 546000000, overall_total: 1107409952, resumed: true });
    const v = progressLine({ id: 'category', stage: 'verify', received: 1107409952, total: 1107409952, overall_received: 1107409952, overall_total: 1107409952 });
    return (p.title === 'Getting the model' && p.pct === 49 && p.line === '49% · 546 MB of 1.1 GB' && p.overall === '546 MB of 1.1 GB' && p.resumed
      && /checksum/.test(v.title) && v.pct === 100)
      || JSON.stringify([p, v]);
  });

  check('needsFirstRun is false after a decline, when nothing is missing, and while downloading', () => {
    const fresh = needsFirstRun({ models: MODELS, settings: defaultSettings() });
    const declined = needsFirstRun({ models: MODELS, settings: { firstRun: { seenAt: 1, choice: 'declined' } } });
    const accepted = needsFirstRun({ models: MODELS, settings: { firstRun: { seenAt: 1, choice: 'accepted' } } });
    const nothing = needsFirstRun({ models: { ...MODELS, download_bytes: 0 }, settings: defaultSettings() });
    const busy = needsFirstRun({ models: { ...MODELS, downloading: true }, settings: defaultSettings() });
    const none = needsFirstRun({ models: null, settings: defaultSettings() });
    return (fresh && !declined && accepted && !nothing && !busy && !none)
      || JSON.stringify({ fresh, declined, accepted, nothing, busy, none });
  });

  check('the first-run sheet reads as the mockup does', () => {
    const html = firstRunHtml(MODELS, esc);
    const want = ['Download Pigeon’s model?', 'One small model', 'Qwen3-VL 2B', 'understands what you ask and picks the right skill', '1.1 GB',
      'This Mac has 16 GB — plenty', 'The model is Apache 2.0.', 'before a single byte downloads',
      'about one question in six', 'data-fr="notnow"', 'Not now', 'data-fr="go"', 'Download 1.1 GB'];
    const missing = want.filter(w => !html.includes(w));
    const gone = ['Model 2 of 2', 'Qwen3.5', 'Both models'].filter(w => html.includes(w));
    return (missing.length === 0 && gone.length === 0) || `missing: ${missing.join(' | ')}; still there: ${gone.join(' | ')}`;
  });

  check('a half-finished download is offered as a resume', () => {
    const html = firstRunHtml({ ...MODELS, remaining_bytes: 561409952 }, esc);
    return /Resume 561 MB/.test(html) || html.match(/data-fr="go">[^<]*/)[0];
  });

  check('the progress card says the app stays usable, can be paused, and can be left', () => {
    const html = progressHtml({ id: 'category', stage: 'download', received: 546000000, total: 1107409952, overall_received: 546000000, overall_total: 1107409952, resumed: false }, esc);
    const want = ['546 MB of 1.1 GB', 'keep using Pigeon while this finishes', 'picks up where it left off', 'width:49%', '49% · 546 MB of 1.1 GB', 'resumable', 'quick answers', 'data-fr="cancel"', 'data-fr="close"', '>Pause<', 'Keep using Pigeon'];
    const missing = want.filter(w => !html.includes(w));
    const failed = progressHtml({ id: 'category', stage: 'failed', received: 1, total: 2, overall_received: 1, overall_total: 2, error: 'checksum mismatch: x' }, esc);
    return (missing.length === 0 && /checksum mismatch: x/.test(failed) && /data-fr="retry"/.test(failed))
      || `missing: ${missing.join(' | ')}`;
  });

  check('the cancel contract is the word Rust returns', () => CANCELLED === 'cancelled');

  check('stackReport carries engine and models rows, and says browser without a bridge', () => {
    const rows = stackReport({ router: { name: 'lexical' }, planner: null, extractor: null, assembler: null });
    const withEngine = stackReport({ router: { name: 'lexical' }, planner: null, extractor: null, assembler: null, engine: { status: BUNDLED, models: MODELS } });
    const e = rows.find(r => r.pass === 'engine'), m = rows.find(r => r.pass === 'models');
    const e2 = withEngine.find(r => r.pass === 'engine');
    return (e && e.state === 'off' && /browser/.test(e.detail) && m && m.state === 'off'
      && rows[0].pass === 'router' && rows[1].pass === 'engine' && rows[2].pass === 'models'
      && e2.state === 'on' && e2.detail === 'own · bundled · asleep')
      || JSON.stringify([e, m, e2]);
  });
}

/* ── answering a question (§3 stage 0) ───────────────────────────────────
   Three faults lived here at once and none was covered: the answer was written
   into the field as raw text, the question could be silently forgotten, and
   nothing checked either. */
{
  const ask = (skill, field) => ({ id: 's1', skill });
  const lex = new LexicalRouter(registry);
  const extract = jsExtractor(registry);

  check('an answer becomes the type the field asked for', () => {
    const cases = [
      ['sum', 'values', '5 10 15 20', [5, 10, 15, 20]],
      ['sum', 'values', 'the numbers are 5, 10, 15 and 20', [5, 10, 15, 20]],
      ['describeNumbers', 'values', '-3 4.5 12', [-3, 4.5, 12]]
    ];
    for (const [skill, field, typed, want] of cases) {
      const got = answerFor(registry, ask(skill, field), field, typed);
      if (JSON.stringify(got) !== JSON.stringify(want)) return `${typed} → ${JSON.stringify(got)}`;
    }
    return true;
  });

  check('an answer a field cannot use is left exactly as typed', () => {
    /* The skill's own validation gets the last word: a guess here would be a
       value nobody typed, which is the thing the audit exists to prevent. */
    const got = answerFor(registry, ask('sum'), 'values', 'quite a lot of them');
    const unknown = answerFor(registry, { id: 's1', skill: 'noSuchSkill' }, 'values', '5 10');
    return (got === 'quite a lot of them' && unknown === '5 10') || `${JSON.stringify([got, unknown])}`;
  });

  check('a text field keeps the answer whole, commas and all', () => {
    const csv = 'name,price\nchair,40';
    const got = answerFor(registry, ask('toMarkdownTable'), 'csv', csv);
    return got === csv || JSON.stringify(got);
  });

  /* The bug as the user met it: "Add up the numbers" asked which, and
     answering "5 10 15 20" came back with mean and median from another skill,
     because the string never became an array. */
  check('answering "which numbers" adds them up, rather than describing them', async () => {
    const first = await runTurn('Add up the numbers', { registry, router: lex, ctx: FIXED_CTX, extractor: extract });
    if (!first.ask || first.ask.skill !== 'sum') return `did not ask for sum: ${JSON.stringify(first.ask)}`;
    const done = await runTurn('5 10 15 20', {
      registry, router: lex, ctx: FIXED_CTX, extractor: extract, pending: { ...first, ask: first.ask }
    });
    const r = done.results[0];
    return (r.ok && r.value.total === 50 && done.answered.value === '5 10 15 20'
      && JSON.stringify(r.input.values) === '[5,10,15,20]')
      || `got ${JSON.stringify({ ok: r.ok, error: r.error, value: r.value })}`;
  });

  check('an answer with nowhere to go says so instead of asking again', async () => {
    const first = await runTurn('Add up the numbers', { registry, router: lex, ctx: FIXED_CTX, extractor: extract });
    const broken = { ...first, ask: { ...first.ask, step: 'sNope' } };
    const done = await runTurn('5 10 15 20', { registry, router: lex, ctx: FIXED_CTX, extractor: extract, pending: broken });
    return (done.invalid && /nowhere to go/.test(done.invalid[0].message) && !done.ask)
      || `got ${JSON.stringify({ invalid: done.invalid, ask: done.ask })}`;
  });

  /* ── the question is read off the thread, never remembered beside it ──── */
  const asked = (msg) => ({ message: msg, ask: { step: 's1', skill: 'sum', field: 'values', question: 'Which numbers?' } });

  check('the pending question is the last turn, and only while it is unanswered', () => {
    const c = { id: 'c', nodes: {}, activeRootId: null };
    if (pendingAsk(c) !== null) return 'an empty chat is waiting on nothing';
    const q = linkTurn(c, { id: 'q', ...asked('add up the numbers') });
    if (!pendingAsk(c) || pendingAsk(c).id !== 'q') return 'did not find the question';
    /* Answering replaces it in place, and the replacement carries no ask. */
    replaceTurn(c, 'q', { id: 'q', message: 'add up the numbers', ask: null });
    if (pendingAsk(c) !== null) return 'still waiting after it was answered';
    /* A question followed by another turn is no longer the live one. */
    const q2 = linkTurn(c, { id: 'q2', ...asked('paste the csv') }, 'q');
    linkTurn(c, { id: 't3', message: 'never mind', ask: null }, q2.id);
    return pendingAsk(c) === null || 'a stale question was still offered as live';
  });

  check('walking versions follows the question rather than forgetting it', () => {
    const c = { id: 'c', nodes: {}, activeRootId: null };
    const a = linkTurn(c, { id: 'a', ...asked('add up the numbers') });
    const b = linkTurn(c, { id: 'b', message: 'what is 2 + 2', ask: null }, null);
    if (pendingAsk(c) !== null) return 'the sibling without a question should not be pending';
    switchTo(c, b.id, -1);
    return (pendingAsk(c) && pendingAsk(c).id === a.id)
      || `after walking back: ${JSON.stringify(pendingAsk(c) && pendingAsk(c).id)}`;
  });

  check('a question survives being saved and loaded', () => {
    const c = { id: 'c', title: 'x', nodes: {}, activeRootId: null };
    linkTurn(c, { id: 'q', ...asked('add up the numbers') });
    const back = parseBlob(JSON.stringify({ version: 2, activeChatId: 'c', chats: [c] }));
    const landed = back && back.chats[0];
    return (landed && pendingAsk(landed) && pendingAsk(landed).ask.field === 'values')
      || `got ${JSON.stringify(landed && landed.nodes)}`;
  });
}

/* ── the menu bar says what it is holding (§2.3) ─────────────────────────── */
{
  const asleep = { disabled: false, category: { phase: 'asleep' } };
  check('the popover states its own condition, and "resident and empty" is the default', () => {
    const cases = [
      [null, /quick answers only/],
      [asleep, /^models asleep · quick answers$/],
      [{ ...asleep, disabled: true }, /models off/],
      [{ ...asleep, category: { phase: 'waking', waking_ms: 4000 } }, /waking the model · about 10 s/],
      [{ ...asleep, category: { phase: 'ready', resident_mb: 2150 } }, /^awake · 2\.1 GB in memory$/],
      /* A status from before v10 still carries a planner row: not counted. */
      [{ ...asleep, planner: { phase: 'ready', resident_mb: 1600 }, category: { phase: 'ready', resident_mb: 2150 } }, /^awake · 2\.1 GB in memory$/],
      [{ ...asleep, category: { phase: 'error', detail: 'the engine would not start' } }, /models asleep · the engine would not start/]
    ];
    for (const [status, want] of cases) {
      const got = stateLine(status).text;
      if (!want.test(got)) return `${JSON.stringify(status && status.category)} → ${JSON.stringify(got)}`;
    }
    return true;
  });

  check('a waking popover counts down from the last wake, stops at about 2 s, then says it is taking longer', () => {
    const waking = (ms) => ({ category: { phase: 'waking', waking_ms: ms } });
    const recorded = stateLine(waking(4000), 30000).text;
    if (!/about 26 s/.test(recorded)) return `the last wake on this Mac was ignored: ${recorded}`;
    const end = stateLine(waking(16000), null).text;
    if (!/about 2 s/.test(end)) return `just past the estimate: ${end}`;
    const long = stateLine(waking(999000), null).text;
    return /Taking longer than usual/.test(long) || `long past the estimate: ${long}`;
  });

  check('the popover draws a value exactly as the window does', () => {
    const segments = [
      { type: 'text', text: '88 kg is ' },
      { type: 'value', text: '194.0 lb', field: 'result', skill: 'convertMass', step: 's1', provenance: { kind: 'computed' } },
      { type: 'text', text: '.' }
    ];
    const html = segmentsHtml(segments, { esc: (x) => String(x), turnId: 't1' });
    return (html.includes('<span class="val "') && html.includes('194.0 lb') && html.includes('data-run="t1|s1"'))
      || html;
  });

  check('a bundled value keeps its date and a web value keeps its source, in both windows', () => {
    const bundled = segmentsHtml([{ type: 'value', text: 'CH', field: 'code', skill: 'countryLookup', provenance: { kind: 'bundled', dataAsOf: '2026-01-01' } }], { esc: (x) => String(x) });
    const web = segmentsHtml([{ type: 'value', text: 'Youngkin', field: 'answer', skill: 'webAnswer', provenance: { kind: 'web', source: 'https://en.wikipedia.org/x' } }], { esc: (x) => String(x) });
    return (/val bundled/.test(bundled) && /data as of 2026-01-01/.test(bundled)
      && /val web/.test(web) && /source: https/.test(web))
      || `${bundled}\n${web}`;
  });

  check('the line under an answer names the skill and says whether a model was involved', () => {
    const routerOnly = provenanceLine({ mode: 'single-skill', ms: 4, results: [{ ok: true, skill: 'convertMass', provenance: { kind: 'computed' } }] });
    const planned = provenanceLine({ mode: 'planned', ms: 1900, results: [{ ok: true, skill: 'daysUntil', provenance: { kind: 'computed' } }] });
    return (/convertMass · computed · router only, no model · 4 ms/.test(routerOnly)
      && /daysUntil · computed · 1900 ms/.test(planned) && !/no model/.test(planned))
      || `${routerOnly} | ${planned}`;
  });

  /* ── the menu bar picks a Pigeon, and reads a screenshot ────────────────
     Two things the window could do and this one could not: talk to anyone but
     Patch and the base model, and take an image by any route but a drag on a
     thumbnail of the whole display. app.js and popover.js are the two files
     the suite cannot execute, so what can be checked from here is the drawing
     (pure, below) and the wiring (by reading the source, as §12 does for the
     window's own send path). */
  const cast = [
    { id: 'socratic-tutor', name: 'Socratic Tutor', kind: 'persona', loaded: true },
    { id: 'meeting-minutes', name: 'Meeting Minutes', kind: 'text-to-text', loaded: false }
  ];
  const popoverJs = readFileSync(join(ROOT, 'src/popover.js'), 'utf8');
  const popoverHtml = readFileSync(join(ROOT, 'popover.html'), 'utf8');

  check('the menu bar offers the window\'s own To: rows, still opens on Patch, and hands adding and opening to the window', () => {
    if (!/toListHtml\(\{ personas, patchState, hi/.test(popoverJs) || /pickerListHtml/.test(popoverJs)) return 'the menu bar draws its own list';
    const { html, flat } = toListHtml({ personas: cast, patchState: { state: 'ready' }, hi: 2 });
    if (!flat.some(d => d.pick === 'patch') || !flat.some(d => d.pick === 'chat')) return 'Patch or Pen is missing from the menu bar list';
    if (!/data-to="pigeon:meeting-minutes"/.test(html) || /data-to="pigeon:meeting-minutes"[^>]*aria-disabled="true"/.test(html)) return 'a Pigeon the server has not loaded is not offered as the window offers it';
    if (!/if \(d\.kind !== 'verified' && !d\.loaded\)/.test(popoverJs) || !/Open in Pigeon/.test(popoverJs)) return 'asking an unloaded Pigeon from the menu bar does not hand over to the window';
    if (!/tellWindowTo\(\{ action: 'add-pigeon' \}\)/.test(popoverJs)) return 'Add a Pigeon… does nothing in the menu bar';
    const app = readFileSync(join(ROOT, 'src/app.js'), 'utf8');
    if ((app.match(/listen\('menubar-open'/g) || []).length !== 1 || !/function openFromMenuBar \(/.test(app)) return 'the window does not carry out the menu bar\'s requests';
    /* §5.7: it opens on the one whose answers can be checked, and that is not
       a setting — nothing here may read a remembered pick. */
    return (/let pick = 'patch'/.test(popoverJs) && !/lastPick/.test(popoverJs)) || 'the menu bar remembers a pick';
  });

  check('both windows draw avatars and To: rows from one shared sheet, and the menu bar reuses no class name of the window\'s', () => {
    const cast = readFileSync(join(ROOT, 'styles/cast.css'), 'utf8');
    const app = readFileSync(join(ROOT, 'styles/app.css'), 'utf8');
    const index = readFileSync(join(ROOT, 'index.html'), 'utf8');
    const kinds = [...new Set((readFileSync(join(ROOT, 'src/ui/pigeons.js'), 'utf8').match(/class="av (av-[a-z]+)/g) || []).map(m => m.split(' ')[1]))];
    const missing = kinds.filter(k => !new RegExp(`\\.${k}[{ .,]`).test(cast));
    if (missing.length) return `cast.css has no style for ${missing.join(', ')}`;
    if (/^\.av\{|^\.av-img\{|^\.sg\{/m.test(app) || /^\.av\{|^\.av-img\{|^\.sg\{/m.test(popoverHtml)) return 'a window still carries its own copy of the shared rules';
    if (!/styles\/cast\.css/.test(index) || !/styles\/cast\.css/.test(popoverHtml)) return 'a window does not link cast.css';
    /* The window's names for other things must not appear as the menu bar's own. */
    const popCss = popoverHtml.slice(popoverHtml.indexOf('<style>'), popoverHtml.indexOf('</style>'));
    const clash = ['.act{', '.acts{', '.chip{', '.mark{', '.note{', '.sheet-note{'].filter(c => popCss.includes(c));
    if (clash.length) return `the menu bar defines the window's ${clash.join(' ')}`;
    if (!/body\.picking \.body\{overflow:hidden\}/.test(popoverHtml) || /max-height:1[12]0px;overflow-y:auto/.test(popoverHtml)) return 'the menu bar still nests scrollers';
    return (/document\.body\.classList\.add\('picking'\)/.test(popoverJs) && /list\.style\.maxHeight/.test(popoverJs)) || 'the list is not fitted above the footer';
  });

  check('opened again with nothing unsent, the menu bar folds the last answer to "Last: … · Copy · Open"', () => {
    const fold = popoverJs.slice(popoverJs.indexOf('function foldLast ('), popoverJs.indexOf("window.addEventListener('focus', foldLast)"));
    if (!fold) return 'no fold';
    if (!/if \(!last \|\| busy \|\| shot \|\| \$\('ask'\)\.value\.trim\(\)\) return;/.test(fold)) return 'the fold would replace something unsent';
    if (!/Last:/.test(fold) || !/lastCopy/.test(fold) || !/tellWindowTo\(\{ action: 'open', pick: last\.pick \}\)/.test(fold)) return 'the fold is missing Copy or Open';
    const startAt = popoverJs.search(/^function start \(/m);
    if (!/^let last = null;$/m.test(popoverJs) || (startAt >= 0 && popoverJs.indexOf('let last = null;') > startAt)) return 'the fold\'s state is not at module level, where tellWindow can reach it';
    return /last = \{ turn, pick: pickUsed \};/.test(popoverJs) || 'a finished exchange is not remembered for the fold';
  });

  check('the menu bar runs a voice through runChat and a job through pigeon_run', () =>
    (/\? await runJob\(text, persona, picture\)/.test(popoverJs)
      && /invoke\('pigeon_run'/.test(popoverJs)
      && /await runChat\(text, \{ complete: chat, persona \}\)/.test(popoverJs))
    || 'the menu bar does not have both paths');

  check('a written reply in the menu bar keeps the badge and the dark-yellow rule', () =>
    (/markLabel\(MARKS\.WRITTEN, \{ name: d\.name \}\)/.test(popoverJs) && /gen-badge/.test(popoverJs)
      && /\.answer\.gen\{border-left:3px solid var\(--gen-rule\)\}/.test(popoverHtml))
    || 'a generated answer is not marked as one');

  check('a screenshot is taken without this window in the picture, and arrives as text for the next question', () => {
    if (!/withoutThisWindow\(\(\) => captureFrom\(invoke\)\)/.test(popoverJs) || !/invoke\('screen_capture'\)/.test(popoverJs)) return 'the popover is still in its own screenshot';
    if (!/invoke\('popover_hide'\)/.test(popoverJs) || !/invoke\('popover_show'\)/.test(popoverJs)) return 'it hides for the capture and never comes back';
    /* core:window's default set is getters only: the window API's hide() is
       refused in silence, which is how Escape and this both came to do nothing. */
    if (/getCurrentWindow|win\.hide\(\)|win\.show\(\)/.test(popoverJs)) return 'the popover still reaches for a window verb core:default does not grant';
    const routes = [['pasted', /addEventListener\('paste'/], ['dropped', /addEventListener\('drop'/], ['read whole', /shotAll/]];
    for (const [what, re] of routes) if (!re.test(popoverJs)) return `a screenshot cannot be ${what}`;
    if (!/composeMessage\(typed, shot && !shot\.picture \? capAttached\(shot\.text\)\.text : ''\)/.test(popoverJs)) return 'a reading does not travel with the question';
    if (!/id="chip"/.test(popoverHtml)) return 'there is nowhere to show what was read';
    /* The text, never the picture (§5.8). */
    return /shot = \{ name, text, engine/.test(popoverJs) || 'the reading keeps more than the text';
  });

  check('a screenshot is attempted even when macOS says the permission is off', () => {
    /* macOS answers the preflight NO for processes that then capture the
       screen perfectly well, so the picture is asked for first and judged on
       what comes back. Gating on the answer is what told somebody to switch on
       a switch that was already on. */
    const rust = readFileSync(join(ROOT, 'src-tauri/src/capture.rs'), 'utf8');
    const asked = rust.indexOf('let image = CGDisplayCreateImage');
    const claims = rust.indexOf('let granted = CGPreflightScreenCaptureAccess()');
    if (asked < 0 || claims < 0) return 'the capture no longer reads as expected';
    if (/return Err/.test(rust.slice(claims, asked))) return 'the capture is still refused before it is tried';
    if (!/granted \}\)/.test(rust) || !/screen_capture_status/.test(popoverJs)) return 'the page is never told what macOS claims';
    /* And when macOS does claim it is off, the picture says so over itself:
       what comes back then is the desktop with no windows in it. */
    return /cap\.granted === false/.test(popoverJs) || 'the picture carries no caveat';
  });

  check('the menu bar never writes the chats file: it tells the window, and the window files it', () => {
    if (/save_state|saveState|from '\.\/store\.js'/.test(popoverJs)) return 'the popover writes state itself';
    if (!/emitTo\('main', 'menubar-exchange'/.test(popoverJs)) return 'the popover does not hand its exchange to the window';
    const app = readFileSync(join(ROOT, 'src/app.js'), 'utf8');
    if (!/listen\('menubar-exchange'/.test(app)) return 'the window does not listen for menu bar exchanges';
    if ((app.match(/listen\('menubar-exchange'/g) || []).length !== 1) return 'the window listens for menu bar exchanges more than once';
    const menuFn = app.slice(app.indexOf('function menuAction ('), app.indexOf('function fileMenuBarExchange ('));
    if (/listen\(/.test(menuFn)) return 'a listener is registered inside menuAction, so it is added again on every menu use';
    return /if \(!state\.settings\.saveMenuBar\) return;/.test(app) || 'filing ignores Save menu bar exchanges';
  });

  check('the menu bar keeps a refused question in its box and keeps the pick you chose', () => {
    if (/box\.value = '';\s*paintWakeNote/.test(popoverJs)) return 'Enter still empties the box before the question is taken';
    if (/setPick\('patch'\);\s*paintWho\(\);\s*paintState\(\);/.test(popoverJs) || /\.loaded\)\) setPick\('patch'\)/.test(popoverJs)) return 'a sleeping model still flips the pick to Patch';
    return !/WAKE_SECONDS/.test(popoverJs) || 'the wake countdown is still a fixed guess';
  });

  check('a screenshot refusal becomes steps, one for each thing macOS can mean', async () => {
    const { captureRefusal } = await import('../src/popover.js');
    const rust = readFileSync(join(ROOT, 'src-tauri/src/capture.rs'), 'utf8');
    const noPerm = (rust.match(/const NO_PERMISSION: &str = "([^;]+)";/) || [])[1];
    const refused = (rust.match(/const REFUSED: &str = "([^;]+)";/) || [])[1];
    if (!noPerm || !refused) return 'capture.rs refusals no longer read as expected';
    const a = captureRefusal(noPerm.replace(/\\\n/g, '')), b = captureRefusal(refused.replace(/\\\n/g, ''));
    if (!a || a.retry || !/Quit Pigeon/.test(a.steps.join(' '))) return 'no-permission is not told to restart';
    if (!b || !b.retry || !/remove it/.test(b.steps.join(' '))) return 'a stale permission is not told to remove the old copy';
    return captureRefusal('disk on fire') === null || 'an unknown error was dressed up as a permission problem';
  });

  check('an image can be read in every chat, and a one-shot Pigeon takes its text as the input', () => {
    const app = readFileSync(join(ROOT, 'src/app.js'), 'utf8');
    if (/laneB \|\| choosing \? '' : paintChip\(\)/.test(app) || /!laneB && !choosing && ocr/.test(app)) return 'the image chip is still Patch-only';
    if (/activeLane\(\) === 'A';/.test(app)) return 'drop and paste are still Patch-only';
    if (!/function settleOneShot/.test(app) || !/a\.choose = /.test(app)) return 'a one-shot Pigeon would overwrite what you typed, or ignore the picture';
    return /data-attach-keep/.test(app) || 'there is no Keep mine';
  });

  /* The Boxer. Someone opens a breed sorter, pastes a photograph of a dog, and
     every part of this works exactly as built: tesseract reads whatever text
     the picture happens to carry — a caption, a watermark, the chrome of the
     page it was screenshotted from — and a one-shot Pigeon's box IS its input,
     so those words used to become the question, silently, and the next Send
     returned a breed in two tokens. Nothing failed. That is the problem.

     So the rule this guards: a Pigeon that cannot be handed a picture never has
     its box filled from one without being asked, and the asking says why. */
  check('a Pigeon that cannot see a picture says so before its box is filled from one', () => {
    const app = readFileSync(join(ROOT, 'src/app.js'), 'utf8');
    const fn = app.slice(app.indexOf('function settleOneShot'), app.indexOf('function putReadingInBox'));
    if (!fn) return 'settleOneShot is gone';
    if (!/canBeSentAPicture\(persona\)/.test(fn)) return 'settleOneShot never asks whether the picture can be sent at all';
    /* The reading goes in the box on exactly one path, and it is the one below
       the check. A second unguarded putReadingInBox would put the silence back. */
    if ((fn.match(/putReadingInBox\(/g) || []).length !== 1) return 'the reading reaches the box by more than one path';
    if (fn.indexOf('canBeSentAPicture') > fn.indexOf('putReadingInBox(')) return 'the box is filled before the question is asked';
    /* The picture lane is one named constant, and a file asking for pictures
       is believed only when Rust says its base can see — the Boxer's own file
       asked for pictures on a text base. */
    if (!/const SEES_PICTURES = true;/.test(app)) return 'SEES_PICTURES is no longer the single place that says so';
    if (!/const canBeSentAPicture = \(p\) => SEES_PICTURES && declaresImage\(p\) && Boolean\(p && p\.vision\) && !isVoice\(p\);/.test(app)) return 'a file that asks for pictures is handed one without a base that can see';
    if (!/cannot see a picture\.<\/b> It will read only these words/.test(app)) return 'the chip does not say this Pigeon cannot see a picture';
    if (!/attach-quote/.test(app)) return 'the words that would be sent are not shown';
    /* And a send while the question is open is refused, not guessed at. */
    if (!/img\.choose/.test(app)) return 'a send no longer waits for the question to be answered';
    return /cannot see the picture — choose Use this text or Discard first/.test(app)
      || 'the refusal does not say what to choose';
  });

  check('a Pigeon says what can be put in it, and claims no more than this build can honour', () => {
    /* Absent on every file written before the field existed, and absent means
       text — the narrow claim. Read the other way round and every Pigeon ever
       made would start saying it could be handed a photograph. */
    const old = pigeonOf('pigeon:note-to-title', [{ id: 'note-to-title', name: 'Note to title', kind: 'classifier', loaded: true }]);
    if (old.takes.join(',') !== 'text' || declaresImage(old)) return `an older Pigeon claims ${old.takes.join(',')}`;
    if (pigeonOf('patch').takes.join(',') !== 'text' || pigeonOf('chat').takes.join(',') !== 'text') return 'Patch or Pen claims something other than text';
    /* Rust normalises the list on import, so what arrives here is already
       clean; what this side must not do is lose it. */
    const seer = pigeonOf('pigeon:s', [{ id: 's', name: 'S', kind: 'classifier', loaded: true, inputs: ['text', 'image'] }]);
    if (!declaresImage(seer)) return 'a file that declares a picture is not believed';
    /* Declaring it is not the same as being able to be handed one: the app's
       own constant has the last word, and the facts row says both. */
    const app = readFileSync(join(ROOT, 'src/app.js'), 'utf8');
    if (!/function readsLine/.test(app)) return 'the facts panel has no Reads row';
    if (!/text only · a picture reaches it as the words read off it, never as the picture/.test(app)) return 'the Reads row does not say a picture cannot be seen';
    return /trained on a model that reads text only/.test(app)
      || 'a file asking for pictures on a text base is not told it cannot have any';
  });

  check('Peek is its own contact: a chat with it survives a save, and it is offered only once an engine has said whether its model is here', () => {
    const fields = chatFieldsFor('peek');
    if (pickForChat(fields) !== 'peek' || !isPeek(fields)) return `peek round-trips as ${pickForChat(fields)}`;
    /* The id cannot be an installed Pigeon's: plain_id refuses the '@'. */
    if (!/^@/.test(fields.personaId)) return `Peek's chats carry ${fields.personaId}`;
    const listed = () => pigeonList([]).flat.map(d => d.pick);
    try {
      setPeekModel(undefined);
      if (listed().includes('peek')) return 'Peek is offered with no engine to run it';
      setPeekModel(null);
      const missing = pigeonOf('peek');
      if (!listed().includes('peek') || missing.loaded || !/Download it from Peek’s page/.test(missing.line)) return 'Peek without its model is not greyed with what it needs';
      if (!/aria-disabled/.test(toListHtml({ personas: [] }).html)) return 'Peek without its model can be picked';
      setPeekModel('Qwen3VL-2B-Instruct-Q4_K_M.gguf');
      const peek = pigeonOf('peek');
      if (!peek.loaded || !peek.sees || factLine(peek) !== 'Writes · sees pictures · remembers the chat') return `Peek reads "${factLine(peek)}"`;
      if (!/av-peek/.test(avatarHtml(peek))) return 'Peek has no avatar of its own';
      /* Without its model, Peek's page offers the download — size first, and
         the licence's terms before the click, not after. */
      setPeekModel(null);
      const page = profileHtml(pigeonOf('peek'), { getModel: { size: '1.1 GB', name: 'Qwen3 VL 2B Instruct', running: null } });
      if (!/data-do="download-picture"/.test(page) || !/1\.1 GB/.test(page) || !/Apache License 2\.0/.test(page)) return 'Peek’s page does not offer its model with its size and terms';
      if (/data-do="new-with"/.test(page)) return 'Peek without its model offers a chat';
    } finally { setPeekModel(undefined); }
    return true;
  });

  check('Peek answers as the picture model does: no instruction of ours, and a figure it reads is not dropped', async () => {
    const { runPlain } = await import('../src/lane-b/chat.js');
    let sent = null;
    const complete = async (req) => { sent = req; return { text: 'There are 3 dogs and the sign says £4.50.', tokens: 12 }; };
    const history = [{ lane: 'B', message: '', asked: 'What is in this picture?', reply: { text: 'Dogs in a park.' } }];
    const turn = await runPlain('How many dogs?', { history, complete, seed: 1 });
    if (!turn.reply || turn.reply.text !== 'There are 3 dogs and the sign says £4.50.' || turn.handoff) return `the figures were dropped: ${JSON.stringify(turn)}`;
    if (sent.messages.some(m => m.role === 'system')) return 'Peek was given the chat lane’s instruction';
    return (sent.messages.length === 3 && sent.messages[0].content === 'What is in this picture?') || `history ${JSON.stringify(sent.messages)}`;
  });

  check('a picture is one of two things to every contact, and says which: the picture itself, or the words read off it', () => {
    const seer = pigeonOf('pigeon:s', [{ id: 's', name: 'Seed Run', kind: 'classifier', loaded: true, inputs: ['image', 'text'], vision: true }]);
    /* The dog-breed sorter: a file asking for pictures, on a base that cannot see. */
    const blind = pigeonOf('pigeon:d', [{ id: 'd', name: 'Dogs', kind: 'classifier', loaded: true, inputs: ['image', 'text'], vision: false }]);
    if (!seer.sees || blind.sees || pigeonOf('chat').sees || pigeonOf('patch').sees) return 'sees is claimed for the wrong contact';
    if (!/Seed Run sees the picture itself/.test(pictureLine(seer))) return pictureLine(seer);
    for (const d of [blind, pigeonOf('chat'), pigeonOf('patch')]) {
      if (!/reads text only/.test(pictureLine(d)) || !/never sent/.test(pictureLine(d))) return pictureLine(d);
    }
    if (!/sees pictures/.test(factLine(seer)) || /sees pictures/.test(factLine(blind))) return 'the fact line claims sight for the wrong one';
    /* The Model row named the chat model for every Pigeon, a picture one included. */
    const app = readFileSync(join(ROOT, 'src/app.js'), 'utf8');
    return /sees \? \['Model', p\.base \?/.test(app) || 'a picture Pigeon\'s Model row does not name its own base';
  });

  /* A retrained Pigeon does not overwrite the one it retrains: it is asked its
     own examples, and a miss puts the old one back and ASKS (decided
     2026-09-21). The page's half: every replacing import is checked, and the
     way back to the new one is the person's choice, never automatic. */
  check('a re-imported Pigeon is checked before the old one is let go', () => {
    const app = readFileSync(join(ROOT, 'src/app.js'), 'utf8');
    if (!/o\.status === 'added' && o\.replaced\)\) checkRide\(o\)/.test(app)) return 'a replacing import is never checked';
    const fn = app.slice(app.indexOf('async function checkRide'), app.indexOf('async function refreshPersonas'));
    if (!/'pigeon_check_ride'/.test(fn)) return 'the check ride is not asked of Rust';
    const useNew = fn.indexOf("'pigeon_use_new_revision'");
    if (useNew < 0 || useNew < fn.indexOf('#rideNew')) return 'the new revision is chosen without the person choosing it';
    return /Keep the old one/.test(fn) || 'there is no way to say keep the old one';
  });

  /* A picture Pigeon is handed the picture, not its text: no OCR, no box
     filled, and the pixels go to pigeon_run — while the turn keeps only a
     thumbnail, so a conversation file never holds a photograph. */
  check('a Pigeon that sees is handed the picture itself, and the turn keeps only a thumbnail', () => {
    const app = readFileSync(join(ROOT, 'src/app.js'), 'utf8');
    const attach = app.slice(app.indexOf('async function attachImage'));
    const seen = attach.indexOf('attachPicture(');
    if (seen < 0 || seen > attach.indexOf('await ocr(')) return 'a picture is read for text before it is handed to a Pigeon that sees';
    if (!/image: picture/.test(app)) return 'the picture never reaches pigeon_run';
    const rec = app.slice(app.indexOf('picture = img.picture;'), app.indexOf('picture = img.picture;') + 300);
    if (/picture: img\.picture/.test(rec) || !/picture: true, thumb: img\.thumb/.test(rec)) return 'the turn record carries the whole picture';
    const bub = readFileSync(join(ROOT, 'src/ui/bubbles.js'), 'utf8');
    return /image\.thumb\.startsWith\('data:image\/'\)/.test(bub) || 'the bubble shows a thumbnail it has not checked is a picture';
  });
}

/* ── play: a picture Pigeon pressing keys (docs/PLAY-LOOP.md) ─────────────
   What is pressed is decided in Rust; what the page must get right is never
   offering Play before both permissions, naming only the Pigeon's own keys,
   and saying plainly what a watch-only run did. */
{
  const { playSheetHtml, playCardHtml, hudHtml, canPlay, keyWords } = await import('../src/ui/play.js');
  const p = { id: 'pocket-quest', name: 'Pocket Quest', vision: true, presses: { keys: [{ answer: 'KEY(Confirm)', key: 'X', hold_ms: 90 }, { answer: 'KEY(Up)', key: 'Up', hold_ms: null }] } };
  const base = { perm: null, windows: [], window: null, thumbs: {}, watchOnly: false, status: null, test: null, busy: false, error: null };
  const win = { windows: [{ id: 7, app: 'mGBA', title: 'Pocket Quest' }], window: 7 };
  const startOn = (h) => /data-play="start"(?![^>]*disabled)/.test(h);
  check('Play is never pressable before macOS allows both seeing and pressing, and a game is chosen', () => {
    for (const perm of [null, { screen: false, keys: true }, { screen: true, keys: false }]) {
      if (startOn(playSheetHtml(p, { ...base, ...win, perm }))) return `Play offered with ${JSON.stringify(perm)}`;
    }
    if (startOn(playSheetHtml(p, { ...base, perm: { screen: true, keys: true } }))) return 'Play offered with no game chosen';
    if (!startOn(playSheetHtml(p, { ...base, ...win, perm: { screen: true, keys: true } }))) return 'Play is not offered once both are allowed';
    /* Watching presses nothing, so it needs only to see. */
    if (!startOn(playSheetHtml(p, { ...base, ...win, watchOnly: true, perm: { screen: true, keys: false } }))) return 'Watch only still asks for Accessibility';
    const missing = playSheetHtml(p, { ...base, perm: { screen: true, keys: false } });
    return (/Press keys/.test(missing) && /data-play="ask" data-which="keys"/.test(missing) && !/data-which="screen"/.test(missing)) || 'the missing permission is not the one with a button';
  });
  check('the Play sheet names only the Pigeon’s own keys and the stop chord, and asks nothing technical up front', () => {
    const h = playSheetHtml(p, { ...base, ...win, perm: { screen: true, keys: true } });
    if (!/X, ↑ Up/.test(h)) return 'its keys are not listed';
    if (!/⌘⇧\./.test(h)) return 'the stop chord is not said';
    /* The one choice under More is how long to play; how keys are sent is never asked. */
    if (/<select(?![^>]*data-play="limit")/.test(h)) return 'the sheet still asks for a key method up front';
    if (!/<details class="ps-more">[\s\S]*data-play="limit"[\s\S]*<\/details>/.test(h)) return 'the time limit is not under More';
    return /<details class="ps-more">/.test(h) || 'the key test is not tucked under More';
  });
  check('a watch-only run says what it would have pressed, not that it pressed — on the page and over the game', () => {
    const status = { state: 'playing', pigeon: 'pocket-quest', name: 'Pocket Quest', turns: 3, pressed: 2, last_answer: 'KEY(Up)', last_pressed: 'Up', watch_only: true };
    const card = playCardHtml(p, status);
    const hud = hudHtml(status);
    return (/Would press ↑ Up/.test(card) && /it would press/.test(hud) && /watching/.test(hud) && !/>pressed</.test(hud)) || 'a watch-only run reads as if it pressed';
  });
  check('the overlay shows only a picture it was sent, and offers Stop while live and Close after', () => {
    const live = hudHtml({ state: 'playing', name: 'Pocket Quest', turns: 1, pressed: 1, last_pressed: 'X', frame: 'data:image/jpeg;base64,AAAA' });
    if (!/<img src="data:image\/jpeg;base64,AAAA"/.test(live) || !/data-hud="stop"/.test(live)) return 'the live card lacks its picture or Stop';
    const odd = hudHtml({ state: 'playing', name: 'x', frame: 'javascript:alert(1)' });
    if (/<img/.test(odd)) return 'a frame that is not a JPEG data URL was drawn';
    const done = hudHtml({ state: 'stopped', name: 'Pocket Quest', reason: 'stopped with ⌘⇧.', turns: 9, pressed: 7 });
    return (/data-hud="close"/.test(done) && !/data-hud="stop"/.test(done) && /stopped with ⌘⇧\./.test(done)) || 'the stopped card is wrong';
  });
  check('Play from a small window starts only in the game played last, with both permissions — anything else goes to the sheet', async () => {
    const { quickPlay } = await import('../src/ui/play.js');
    const stub = (perm, wins) => { const calls = []; const call = async (cmd, args) => { calls.push([cmd, args]); return cmd === 'play_permission' ? perm : cmd === 'play_windows' ? wins : null; }; call.calls = calls; return call; };
    const both = { screen: true, keys: true };
    const game = [{ id: 3, app: 'Safari' }, { id: 9, app: 'mGBA' }];
    let c = stub({ screen: true, keys: false }, game);
    if ((await quickPlay(c, p, { playLastApp: 'mGBA' })).sheet !== 'permissions') return 'started without Accessibility';
    c = stub(both, game);
    if ((await quickPlay(c, p, {})).sheet !== 'no game yet') return 'guessed a game it has never played';
    c = stub(both, [{ id: 3, app: 'Safari' }]);
    if ((await quickPlay(c, p, { playLastApp: 'mGBA' })).sheet !== 'game not open') return 'started with the game closed';
    c = stub(both, game);
    const out = await quickPlay(c, p, { playLastApp: 'mGBA', playHow: { mGBA: 'pid' } });
    const start = c.calls.find(x => x[0] === 'play_start');
    return (out.started === 'mGBA' && start && start[1].window === 9 && start[1].how === 'pid' && start[1].watchOnly === false) || `started ${JSON.stringify(start)}`;
  });
  check('the menu bar and the summon bar offer Play beside the picture and the screenshot, and hand over to the sheet', () => {
    const pop = readFileSync(join(ROOT, 'popover.html'), 'utf8');
    const bar = readFileSync(join(ROOT, 'bar.html'), 'utf8');
    const popJs = readFileSync(join(ROOT, 'src/popover.js'), 'utf8');
    const barJs = readFileSync(join(ROOT, 'src/bar.js'), 'utf8');
    const app = readFileSync(join(ROOT, 'src/app.js'), 'utf8');
    if (pop.indexOf('id="play"') < pop.indexOf('id="pickImg"')) return 'the popover’s Play is not beside Picture…';
    if (!/id="bubPlay" hidden/.test(bar) || !/body\.open \.bub\[data-n="4"\]/.test(bar) || !/var\(--n\) \* \(var\(--bubble\)/.test(bar)) return 'the bar has no fourth bubble laid by --n';
    for (const [name, js] of [['popover', popJs], ['bar', barJs]]) {
      if (!/quickPlay\(invoke, p, peek\)/.test(js) || !/action: 'play', pick:/.test(js) || !/listen\('play-event'/.test(js)) return `the ${name} does not quick-start, hand over, or follow the play`;
    }
    return /x\.action === 'play'[^\n]*openPlaySheet/.test(app) || 'the window does not open the Play sheet when handed a play';
  });
  check('in the two small windows, nothing outside start() calls a helper that only exists inside it', () => {
    /* The menu bar's Play did nothing at all: its handler lived outside start()
       and called openWindow and say, which live inside — the hand-over threw,
       and so did the error message. */
    for (const file of ['src/popover.js', 'src/bar.js']) {
      const src = readFileSync(join(ROOT, file), 'utf8');
      const i = src.indexOf('function start () {');
      let d = 0, k = src.indexOf('{', i);
      for (; k < src.length; k++) { if (src[k] === '{') d++; else if (src[k] === '}') { d--; if (!d) break; } }
      const inner = src.slice(i, k), outer = src.slice(0, i) + src.slice(k);
      const inside = [...new Set([...inner.matchAll(/\n {2}(?:async )?function (\w+) \(|\n {2}const (\w+) = /g)].map(m => m[1] || m[2]))];
      const outerDefs = new Set([...outer.matchAll(/(?:async )?function (\w+) \(|const (\w+) = |let (\w+) = /g)].map(m => m[1] || m[2] || m[3]));
      const leaks = inside.filter(n => !outerDefs.has(n) && new RegExp(`\\b${n}\\(`).test(outer));
      if (leaks.length) return `${file}: ${leaks.join(', ')} used outside start()`;
    }
    return true;
  });
  check('Peek is offered in the menu bar and the summon bar, sees the picture itself there, and is filed like any exchange', () => {
    for (const file of ['src/popover.js', 'src/bar.js']) {
      const src = readFileSync(join(ROOT, file), 'utf8');
      if (!/setPeekModel\(status\.peek \|\| null\)/.test(src)) return `${file} never tells the list whether Peek can run`;
      if (!/\.sees\)[\s\S]{0,200}pictureOf\(file\)/.test(src)) return `${file} reads a picture's text for Peek or a picture Pigeon instead of handing it the picture`;
      if (!/invoke\('pigeon_run', \{ req: \{ pigeon: persona\.id, text, \.\.\.\(image \? \{ image \} : \{\}\) \} \}\)/.test(src)) return `${file} does not hand a picture Pigeon the picture`;
      if (!/peek: true, image: picture \? picture\.url : null/.test(src) || !/runPlain\(asked/.test(src)) return `${file} does not ask Peek on the picture server`;
      if (!/picture: true, thumb: picture\.thumb/.test(src)) return `${file} files the whole picture, or none`;
    }
    const app = readFileSync(join(ROOT, 'src/app.js'), 'utf8');
    return /pictureOnly = Boolean\(x && x\.image && x\.image\.picture === true\)/.test(app) || 'a picture sent to Peek with nothing typed is not filed';
  });
  check('only a picture Pigeon that says which key each answer is can play', () => {
    return (canPlay(p) && !canPlay({ ...p, vision: false }) && !canPlay({ ...p, presses: null }) && keyWords('Left') === '← Left' && keyWords('X') === 'X') || 'canPlay or keyWords is wrong';
  });
}

/* ── the summon bar: ⌘⇧P, a bar of glass, Patch on top ──────────────────────
   Three files have to agree for this to work at all — bar.rs lays a native
   glass view, bar.html draws on top of it, bar.js tells Rust how tall to make
   it — and the window can only be looked at in the running app. So what CAN be
   read is read here: the numbers they share, what the bar is allowed to reach,
   and every string a person sees. */
{
  const barJs = readFileSync(join(ROOT, 'src/bar.js'), 'utf8');
  const barHtml = readFileSync(join(ROOT, 'bar.html'), 'utf8');
  const barRs = readFileSync(join(ROOT, 'src-tauri/src/bar.rs'), 'utf8');
  const lib = readFileSync(join(ROOT, 'src-tauri/src/lib.rs'), 'utf8');
  const asleep = { disabled: false, category: { phase: 'asleep' } };

  check('the bar says what Pigeon is holding, in fewer words than the popover and no less truthfully', () => {
    const cases = [
      [null, /^quick answers$/],
      [asleep, /^models asleep · quick answers$/],
      [{ ...asleep, disabled: true }, /^models off · quick answers$/],
      [{ ...asleep, category: { phase: 'waking', waking_ms: 4000 } }, /^waking · about 10 s$/],
      [{ ...asleep, category: { phase: 'ready' } }, /^models awake$/],
      [{ ...asleep, category: { phase: 'error', detail: 'the engine would not start' } }, /would not wake · quick answers$/]
    ];
    for (const [status, want] of cases) {
      const got = barState(status, 14000, 100000).text;
      if (!want.test(got)) return `${JSON.stringify(status && status.category)} → ${JSON.stringify(got)}`;
    }
    return barState({ ...asleep, category: { phase: 'waking', waking_ms: 1 } }).tone === 'waking' || 'a wake is not drawn as one';
  });

  check('the line under a bar answer is the window\'s mark, with the skill that earned it', () => {
    const worked = { mode: 'routed', reply: { segments: [] }, results: [{ ok: true, skill: 'convertMass', provenance: { kind: 'computed' } }] };
    const planned = { ...worked, mode: 'planned' };
    const looked = { mode: 'planned', reply: { segments: [] }, results: [{ ok: true, skill: 'webLookup', provenance: { kind: 'web', source: 'https://en.wikipedia.org/wiki/X' } }] };
    const none = { mode: MODES.NO_SKILL, reply: null, results: [] };
    const got = [receiptLine(worked), receiptLine(planned), receiptLine(looked), receiptLine(none), receiptLine(null)];
    return (got[0] === 'Worked out · Convert mass · no model' && got[1] === 'Worked out · Convert mass'
      && /^Looked up · /.test(got[2]) && got[3] === 'Couldn’t answer' && got[4] === '') || JSON.stringify(got);
  });

  check('the glass Rust lays and the glass the page draws are the same rectangle', () => {
    const rs = (name) => Number((barRs.match(new RegExp(`const ${name}: f64 = ([0-9.]+);`)) || [])[1]);
    const css = (name) => Number((barHtml.match(new RegExp(`--${name}:([0-9.]+)px`)) || [])[1]);
    const pairs = [['TOP', 'top'], ['MARGIN', 'margin'], ['RADIUS', 'radius'], ['GLASS_MIN', 'row'], ['BUBBLE', 'bubble'], ['GAP', 'gap']];
    for (const [r, c] of pairs) if (!(rs(r) > 0) || rs(r) !== css(c)) return `bar.rs ${r} is ${rs(r)} and bar.html --${c} is ${css(c)}`;
    if (rs('PART_S') !== Number((barHtml.match(/--part:([0-9.]+)s/) || [])[1])) return 'the glass and the page part the bubbles over different times';
    if ((barHtml.match(/class="bub"/g) || []).length !== Number((barRs.match(/const BUBBLES: usize = (\d+);/) || [])[1])) return 'the page draws a different number of bubbles than Rust lays glass for';
    if (!/\.glass\{position:absolute;top:var\(--top\);left:var\(--margin\);right:var\(--margin\);bottom:var\(--margin\)/.test(barHtml)) return '.glass is not laid out from the shared numbers';
    /* The browser stand-in clamps the way bar.rs does. */
    if (!barJs.includes(`Math.min(${rs('GLASS_MAX')}, Math.max(${rs('GLASS_MIN')}, want))`)) return 'the stand-in clamps to different limits than bar.rs';
    return /html,body\{[^}]*background:transparent/.test(barHtml) || 'the page paints a background over the glass';
  });

  check('the words on the glass clear 4.5:1 whatever is behind the window', () => {
    /* The material under the page is the system's and cannot be asked how
       light it came out, so the page's own fill has to be enough: dark ink
       over a black desktop in light mode, light ink over a white one in dark. */
    const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    const ratio = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
    const hex = (h) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
    const over = ([r, g, b, a], back) => [r, g, b].map(v => v * a + back * (1 - a));
    const dark = barHtml.slice(barHtml.indexOf('@media(prefers-color-scheme:dark)'));
    const light = barHtml.slice(0, barHtml.indexOf('@media(prefers-color-scheme:dark)'));
    const read = (css, name) => {
      const ink = (css.match(/--g-ink:(#[0-9A-Fa-f]{6})/) || [])[1];
      const fill = (css.match(new RegExp(`--g-fill-${name}:rgba\\(([0-9., ]+)\\)`)) || [])[1];
      return ink && fill ? [hex(ink), fill.split(',').map(Number)] : null;
    };
    for (const [css, back, what] of [[light, 0, 'light mode over black'], [dark, 255, 'dark mode over white']]) {
      for (const name of ['a', 'b']) {
        const got = read(css, name);
        if (!got) return `--g-ink or --g-fill-${name} could not be read (${what})`;
        const r = ratio(got[0], over(got[1], back));
        if (r < 4.5) return `${what}: ink on fill-${name} is ${r.toFixed(2)}:1`;
      }
    }
    return true;
  });

  check('the bar opens on Patch every time, offers the window\'s cast, and is not a second writer of anything', () => {
    if (!/let pick = 'patch';/.test(barJs) || !/pick = 'patch';\s*picking = false;\s*paintWho\(\);/.test(barJs) || /lastPick|localStorage/.test(barJs)) return 'the bar remembers a pick, or does not come up on Patch';
    if (!/toListHtml\(\{ personas, patchState, hi/.test(barJs) || !/canMessage\(d\)/.test(barJs)) return 'the bar draws its own cast';
    if (!/markLabel\(MARKS\.WRITTEN, \{ name: d\.name \}\)/.test(barJs) || !/await runChat\(text, \{ complete: chat, persona \}\)/.test(barJs) || !/invoke\('pigeon_run'/.test(barJs)) return 'a Pigeon that writes is not run, or not badged, as the other windows do';
    if (/save_state|saveState|from '\.\/store\.js'/.test(barJs)) return 'the bar writes state itself';
    if (!/emitTo\('main', 'menubar-exchange'/.test(barJs) || !/pick: pickUsed/.test(barJs)) return 'a finished exchange is not handed to the window under who answered it';
    if (!/assembler: null/.test(barJs)) return 'the bar can send something off this Mac';
    if (!/pending: answering/.test(barJs) || !/if \(turn\.ask\) pending = turn;/.test(barJs)) return 'a question of Patch\'s cannot be answered from the bar';
    if (!/if \(!turn\.ask\) tellWindow\(/.test(barJs)) return 'a question still waiting on its answer is filed as an exchange';
    /* Waking is the person's choice, made once, for the question they asked. */
    return (/data-do="wake-ask"/.test(barJs) && /retryOnceAwake = lastAsked/.test(barJs) && /retryOnceAwake = null;\s*ask\(again\)/.test(barJs))
      || 'waking for a question does not ask it again exactly once';
  });

  check('the bar cannot hide, move or size itself: it asks Rust, and Rust clamps', () => {
    if (/getCurrentWindow|\.setSize\(|\.setPosition\(|\.hide\(\)/.test(barJs)) return 'bar.js reaches for a window verb core:default does not grant';
    for (const c of ["'bar_fit', { height: want }", "'bar_hide'", "'bar_show'", "'bar_bubbles', { open, count: bubbleCount }"]) if (!barJs.includes(`invoke(${c}`)) return `bar.js does not call ${c}`;
    if (/fetch\(/.test(barJs)) return 'bar.js fetches, which its CSP refuses';
    if (!/shot = \{ name, text, engine/.test(barJs) || !/composeMessage\(typed, shot && !shot\.picture \? capAttached\(shot\.text\)\.text : ''\)/.test(barJs)) return 'a reading keeps more than its text, or does not travel with the question';
    if (!/glass\.clamp\(GLASS_MIN, GLASS_MAX\)/.test(barRs) || !/is_finite\(\)/.test(barRs)) return 'bar_fit takes the page\'s word for the height';
    const caps = JSON.parse(readFileSync(join(ROOT, 'src-tauri/capabilities/default.json'), 'utf8'));
    if (caps.permissions.some(perm => /global-shortcut/.test(JSON.stringify(perm)))) return 'a page has been granted the shortcut plugin';
    return (/Modifiers::SUPER \| Modifiers::SHIFT\), Code::KeyP\)/.test(lib) && /bar::toggle\(app\)/.test(lib)
      && /window\.label\(\) == tray::POPOVER \|\| window\.label\(\) == bar::BAR/.test(lib))
      || 'lib.rs does not register ⌘⇧P, or the bar does not go away when you look elsewhere';
  });

  check('the bar\'s window is see-through, takes keys without taking the Mac, and ships', async () => {
    if (!/\.transparent\(true\)/.test(barRs) || !/\.shadow\(false\)/.test(barRs)) return 'the window is not see-through, or macOS still draws its shadow';
    if (!/NonactivatingPanel/.test(barRs) || !/setHidesOnDeactivate\(false\)/.test(barRs)) return 'the bar would activate Pigeon, or hide itself because Pigeon is not active';
    if (!/AnyClass::get\(c"NSGlassEffectContainerView"\)/.test(barRs)) return 'the bubbles slide like tiles: no glass container';
    if (!/AnyClass::get\(c"NSGlassEffectView"\)/.test(barRs) || !/NSVisualEffectView/.test(barRs)) return 'no glass, or no fallback where the Mac has none';
    const conf = JSON.parse(readFileSync(join(ROOT, 'src-tauri/tauri.conf.json'), 'utf8'));
    if (conf.app.macOSPrivateApi !== true) return 'tauri.conf.json does not allow a see-through webview';
    if (!/^<!DOCTYPE html>/i.test(barHtml) || !/<html lang="en">/.test(barHtml)) return 'bar.html is in quirks mode or has no language';
    if (!/prefers-reduced-motion:reduce/.test(barHtml)) return 'the bar moves for someone who asked it not to';
    const { SHIP } = { SHIP: (readFileSync(join(ROOT, 'scripts/bundle.mjs'), 'utf8').match(/export const SHIP = (\[[^\]]+\])/) || [])[1] };
    const { WINDOWS } = await import('./host-api.mjs');
    return (/'bar\.html'/.test(SHIP || '') && WINDOWS.includes('src/bar.js')) || 'bar.html is not shipped, or bar.js is not counted as a window';
  });
}

/* ── the wall between the lanes (§5.1) ───────────────────────────────────── */
{
  const found = wallViolations(readTree(join(ROOT, 'src')));
  check('Lane B imports nothing from the verified path, and only app.js reaches in', () =>
    found.length === 0 || `${found.length} violation(s) — run: node scripts/lintimports.mjs\n${formatViolations(found)}`);

  /* The lint has to be able to FAIL, or a green build proves nothing. These
     are the breaches it exists to catch, put to it directly. */
  check('the lint catches a Lane B module reaching for the audit or a skill', () => {
    const breaches = [
      { path: 'src/lane-b/chat.js', source: "import { auditSegments } from '../fabrication.js';" },
      { path: 'src/lane-b/chat.js', source: "import { runPlan } from '../executor.js';" },
      { path: 'src/lane-b/chat.js', source: "const x = await import('../registry.js');" },
      { path: 'src/lane-b/deep/x.js', source: "export { render } from '../../template.js';" },
      { path: 'src/lane-b/chat.js', source: "import skills from '../../skills/index.js';" }
    ];
    for (const b of breaches) {
      const v = wallViolations([b]);
      if (!v.length) return `let through: ${b.source}`;
      if (v[0].rule !== 'lane-b-imports-out') return `wrong rule for ${b.source}: ${v[0].rule}`;
    }
    return true;
  });

  check('the lint catches the pipeline reaching into Lane B', () => {
    const v = wallViolations([{ path: 'src/turn.js', source: "import { runChat } from './lane-b/chat.js';" }]);
    return (v.length === 1 && v[0].rule === 'reaches-into-lane-b') || JSON.stringify(v);
  });

  check('the lint keeps pack code in the locked worker', () => {
    const breaches = [
      [{ path: 'src/app.js', source: "const m = await import(base + 'skills/index.js');" }, 'computed-import-outside-worker'],
      [{ path: 'src/popover.js', source: 'const m = await import(`./${name}.js`);' }, 'computed-import-outside-worker'],
      [{ path: 'src/ui/x.js', source: "const u = 'pigeon-pack://localhost/v1-deadbeef/code/';" }, 'pack-scheme-outside-worker'],
      [{ path: 'src/patch-pack.js', source: "const w = await import('./skill-worker.js');" }, 'patch-pack-loads-code'],
      [{ path: 'src/patch-pack.js', source: "/* even import('./x.js') in a comment */" }, 'patch-pack-loads-code']
    ];
    for (const [file, rule] of breaches) {
      if (!lockedRoomViolations([file]).some(v => v.rule === rule)) return `let through (${rule}): ${file.source}`;
      if (!wallViolations([file]).some(v => v.rule === rule)) return `wallViolations does not run the rule: ${file.source}`;
    }
    const allowed = [
      { path: 'src/skill-worker.js', source: "const m = await import(codeBase + 'skills/index.js'); const p = 'pigeon-pack://';" },
      { path: 'src/skill-protocol.js', source: 'const CODE_BASE = /^pigeon-pack:\\/\\//;' },
      { path: 'src/app.js', source: "const m = await import('./lane-b/chat.js'); const u = new URL('./x.js', import.meta.url); /* pigeon-pack:// in a comment */" },
      { path: 'scripts/x.mjs', source: "await import(anything); const s = 'pigeon-pack';" }
    ];
    const wrong = allowed.flatMap(f => lockedRoomViolations([f]));
    return wrong.length ? JSON.stringify(wrong) : true;
  });

  check('nothing asks Patch before his skills are ready: say, Run a plan and the menu bar refuse first', () => {
    const app = readFileSync(join(ROOT, 'src/app.js'), 'utf8');
    const pop = readFileSync(join(ROOT, 'src/popover.js'), 'utf8');
    const GUARD = "if (patchState.state !== 'ready')";
    const body = (src, head) => { const i = src.indexOf(head); return i < 0 ? '' : src.slice(i, src.indexOf('\n}\n', i)); };
    const say = body(app, 'async function say (');
    const laneA = say.slice(say.indexOf('return sayInLaneB('));
    const g = laneA.indexOf(GUARD);
    if (!say || g < 0) return 'say() has no guard after the lane split';
    if (say.indexOf(GUARD) < say.indexOf('return sayInLaneB(')) return 'say() guards before the lane split, so a Lane B chat would wait on Patch';
    for (const spent of ["setDraft(chatId, '')", 'dropAttachment()', 'dropTranscript()', 'startInflight(', 'runTurn(']) {
      const k = laneA.indexOf(spent);
      if (k >= 0 && k < g) return `say() does ${spent} before refusing`;
    }
    const plan = body(app, 'async function executeHandWrittenPlan (');
    if (plan.indexOf(GUARD) < 0 || plan.indexOf(GUARD) > plan.indexOf('runTurn(')) return 'Run a plan is not guarded';
    const ask = body(pop, 'async function ask (');
    if (ask.indexOf("patchState.state !== 'ready'") < 0 || ask.indexOf("patchState.state !== 'ready'") > ask.indexOf('busy = true')) return 'the menu bar asks Patch before he is ready';
    if (/\.loaded\)\) setPick\('patch'\)/.test(pop)) return 'the menu bar still swaps your pick for Patch when a model sleeps';
    if (/from '\.\.\/skills\//.test(app) || /from '\.\.\/skills\//.test(pop)) return 'a window still imports skills/ directly';
    return (/buildPlanner\(registry, packOptions\)/.test(app) && /buildCategoryRouter\(registry, packOptions\)/.test(app) && /await patchSettled/.test(app))
      || 'the model probes do not wait for Patch or do not pass his options';
  });

  check('the lint allows what it must: the two windows reaching in, and the lane importing itself', () =>
    wallViolations([
      { path: 'src/app.js', source: "import { runChat } from './lane-b/chat.js';" },
      { path: 'src/popover.js', source: "import { runChat } from './lane-b/chat.js';" },
      { path: 'src/lane-b/chat.js', source: "import { needsHandoff } from './handoff.js';" }
    ]).length === 0 || 'a legitimate import was refused');

  /* The list of windows is short on purpose. A third file quietly joining it
     is the way this rule stops meaning anything. */
  check('only the two windows may reach into Lane B', () =>
    (LANE_B_CALLERS.length === 3 && LANE_B_CALLERS.includes('src/app.js') && LANE_B_CALLERS.includes('src/popover.js') && LANE_B_CALLERS.includes('src/bar.js'))
      || `callers are now ${JSON.stringify(LANE_B_CALLERS)}`);

  /* A specifier quoted in a comment is not an import. This file's own header
     names the modules it must not touch, and a lint that read those would
     fail on the very file that describes the rule. */
  check('the lint reads code, not comments', () => {
    const src = "/* never import ../fabrication.js */\n// nor ../executor.js\nimport { a } from './b.js';";
    const specs = importsIn(src);
    return (specs.length === 1 && specs[0] === './b.js') || JSON.stringify(specs);
  });

  check('the rail tells the chat lane apart from a browser and from asleep', () => {
    const row = (laneB) => stackReport({ router: { name: 'lexical' }, planner: null, extractor: null, assembler: null, laneB })
      .find(r => r.pass === 'lane b');
    const browser = row(null);
    const asleep = row({ ready: false, personas: 0 });
    const base = row({ ready: true, personas: 0 });
    const worn = row({ ready: true, personas: 1 });
    return (browser.state === 'off' && /browser/.test(browser.detail)
      && asleep.state === 'off' && /asleep/.test(asleep.detail)
      && base.state === 'sub' && /base weights/.test(base.detail)
      && worn.state === 'on' && /1 persona loaded/.test(worn.detail))
      || JSON.stringify([browser, asleep, base, worn]);
  });

  check('a chat carries its lane across a save, and an old chat is the verified one', () => {
    const out = parseBlob(JSON.stringify({
      version: 2, activeChatId: 'b',
      chats: [
        { id: 'a', nodes: {} },
        { id: 'b', nodes: {}, lane: 'B', personaId: 'socratic-tutor' },
        { id: 'c', nodes: {}, lane: 'nonsense', personaId: 42 }
      ]
    }));
    const [a, b, c] = out.chats;
    return (a.lane === 'A' && a.personaId === null
      && b.lane === 'B' && b.personaId === 'socratic-tutor'
      && c.lane === 'A' && c.personaId === null)
      || JSON.stringify(out.chats);
  });

  check('the shipped Lane B files really are checked, not an empty list', () => {
    const laneFiles = readTree(join(ROOT, 'src')).filter(f => f.path.startsWith('src/lane-b/'));
    return laneFiles.length >= 3 || `only ${laneFiles.length} Lane B files were read`;
  });
}

/* ── transcripts: what can be fixed without guessing ─────────────────────── */
{
  const VTT = `WEBVTT

1
00:00:02.440 --> 00:00:22.199
Ana Ruiz: So the the plan is simple. we ship on Friday

2
00:00:22.550 --> 00:00:42.309
and then, you know, we watch the logs. um that is it`;

  const BRACKETED = `[0:00:00 --> 0:00:05] Today we look at the recent tariffs and how they

[0:00:05 --> 0:00:10] impact the industry. Let us jump in.`;

  check('each transcript layout is recognised for what it is', () => {
    const got = {
      vtt: detectFormat(VTT),
      bracketed: detectFormat(BRACKETED),
      srt: detectFormat('1\n00:00:01,000 --> 00:00:02,000\nhello there'),
      plain: detectFormat('Just an ordinary paragraph of writing, with nothing timed about it.')
    };
    return JSON.stringify(got) === JSON.stringify({ vtt: 'webvtt', bracketed: 'bracketed', srt: 'srt', plain: 'plain' })
      || JSON.stringify(got);
  });

  check('cue numbers and timestamps are carried off the text, not left in it', () => {
    const { cues } = parseCues(VTT);
    const joined = cues.map(c => c.text).join(' ');
    return (!/\d{2}:\d{2}/.test(joined) && !/WEBVTT/.test(joined) && cues.length === 2)
      || JSON.stringify(cues);
  });

  check('an unlabelled cue keeps speaking as whoever spoke last', () => {
    const { cues } = parseCues(VTT);
    return (cues[0].speaker === 'Ana Ruiz' && cues[1].speaker === 'Ana Ruiz'
      && cues[0].labelled === true && cues[1].labelled === false)
      || JSON.stringify(cues.map(c => [c.speaker, c.labelled]));
  });

  check('a colon inside an ordinary sentence is not read as a speaker', () => {
    const prose = ['There is one rule that matters here: never guess at a figure.',
                   'My conclusion is this: we should wait.',
                   'One thing to remember: check the logs.'];
    const wrong = prose.filter(p => parseCues(p).cues[0].speaker !== null);
    return wrong.length === 0 || `read a speaker in: ${wrong.join(' | ')}`;
  });

  check('a real speaker label is still read as one', () => {
    const names = { 'Dana Holloway: hi': 'Dana Holloway', 'Speaker 1: hi': 'Speaker 1',
                    'Dr. Jane Smith: hi': 'Dr. Jane Smith', 'Me: hi': 'Me' };
    const wrong = Object.entries(names)
      .filter(([line, want]) => parseCues(line).cues[0].speaker !== want);
    return wrong.length === 0 || `missed: ${wrong.map(([l]) => l).join(' | ')}`;
  });

  check('a sentence the chunker cut in half is counted and rejoined', () => {
    const { cues } = parseCues(BRACKETED);
    const joined = joinRun(cues);
    return (midSentenceJoins(cues) === 1 && /how they impact the industry/.test(joined))
      || `${midSentenceJoins(cues)} | ${joined}`;
  });

  check('a stutter goes and a real doubled word stays', () => {
    const gone = stripStutters('So the the plan is simple');
    const kept = stripStutters('He had had enough, and it was very very late');
    return (gone.text === 'So the plan is simple' && gone.removed.length === 1
      && kept.text === 'He had had enough, and it was very very late' && kept.removed.length === 0)
      || `${gone.text} | ${kept.text}`;
  });

  check('a doubled word split by punctuation is not a stutter', () => {
    const r = stripStutters('It was over. Over everything.');
    return r.removed.length === 0 || `removed ${JSON.stringify(r.removed)}`;
  });

  check('"um" always goes; "kind of person" keeps its kind of', () => {
    const a = stripFillers('um that is it');
    const b = stripFillers('he is the kind of person who checks');
    return (a.text === 'that is it' && b.text === 'he is the kind of person who checks')
      || `${a.text} | ${b.text}`;
  });

  check('a filler between commas goes and takes one comma with it', () => {
    const r = stripFillers('and then, you know, we watch the logs');
    return r.text === 'and then, we watch the logs' || r.text;
  });

  check('the words this list refuses to touch are named, not silently eaten', () => {
    const risky = FILLERS.left_alone;
    const eaten = risky.filter(w => stripFillers(`it was ${w} fine`).text !== `it was ${w} fine`);
    return (risky.includes('like') && risky.includes('right') && eaten.length === 0)
      || `eaten: ${eaten.join(', ')}`;
  });

  /* The safety property. Everything in captions.js deletes or reassembles; if a
     word appears in the output that was never spoken, the verified lane has
     started writing prose and the whole argument is gone. */
  check('the deterministic pass never introduces a word that was not said', () => {
    const bag = (t) => String(t).toLowerCase().match(/[a-z0-9']+/g) || [];
    for (const raw of [VTT, BRACKETED]) {
      const said = new Set(bag(raw));
      const novel = [...new Set(bag(mechanicalClean(raw).text))].filter(w => !said.has(w));
      if (novel.length) return `invented ${novel.join(', ')}`;
    }
    return true;
  });

  check('every figure survives the deterministic pass unchanged', () => {
    const raw = '[0:00:00 --> 0:00:05] um the 2.6 trillion figure and the the 200% jump';
    const nums = (t) => (String(t).match(/\d[\d.,]*/g) || []).join(' ');
    const out = mechanicalClean(raw).text;
    return nums(out) === '2.6 200' || `${nums(out)} | ${out}`;
  });

  check('an ordinary paragraph is not mistaken for a transcript', () => {
    const prose = 'This is a normal paragraph. It has several sentences in it. None of them are timed.';
    return (isTranscript(VTT) && isTranscript(BRACKETED) && !isTranscript(prose))
      || `${isTranscript(VTT)} ${isTranscript(BRACKETED)} ${isTranscript(prose)}`;
  });

  /* ── auditing the model's half ─────────────────────────────────────────── */

  const DAMAGED = 'staring. Down the barrel of migrating this entire service the old Platform is Just bleeding money';

  check('a repair that only moves punctuation leaves the letters untouched', () => {
    const good = [
      'Staring down the barrel of migrating this entire service. The old platform is just bleeding money.',
      'Staring down the barrel of migrating this entire service.\n\nThe old platform is just bleeding money.'
    ];
    const wrong = good.map(g => auditRepair(DAMAGED, g)).filter(r => r && r.reason);
    return wrong.length === 0 || JSON.stringify(wrong);
  });

  check('a name the transcriber split may be repaired, and the move is reported', () => {
    const r = auditRepair('the team at pail. Wave com met about the onb. Oarding campaign today',
                          'The team at Palewave.com met about the onboarding campaign today.');
    return (r && r.reason === null && r.edits > 0 && r.edits <= 24)
      || JSON.stringify(r);
  });

  check('rewriting the transcript instead of repunctuating it is thrown out', () => {
    const r = auditRepair(DAMAGED,
      'The team is considering whether to move their infrastructure to a different hosting provider this quarter.');
    return (r && /rewrote the words/.test(r.reason)) || JSON.stringify(r);
  });

  check('a figure the model invented or altered is thrown out', () => {
    const added = auditRepair(DAMAGED, 'Staring down the barrel of migrating this entire service. The old platform is just bleeding 500 money.');
    const changed = auditRepair('we saw 2.6 trillion and 200 percent', 'We saw 2.7 trillion and 200 percent.');
    return (added && /figure changed/.test(added.reason) && changed && /figure changed/.test(changed.reason))
      || JSON.stringify([added, changed]);
  });

  check('an empty reply and a truncated one are both thrown out', () => {
    const empty = auditRepair(DAMAGED, '   ');
    const cut = auditRepair(DAMAGED, 'Staring down the barrel of migrating this entire service.', { truncated: true });
    return (empty && /returned nothing/.test(empty.reason) && cut && /ran out of room/.test(cut.reason))
      || JSON.stringify([empty, cut]);
  });

  check('handing the instructions back instead of the transcript is thrown out', () => {
    const r = auditRepair(DAMAGED, 'Repair this transcript. Reply with the repaired transcript and nothing else.');
    return (r && /handed back the instructions/.test(r.reason)) || JSON.stringify(r);
  });

  check('a transcript that is genuinely about repairing transcripts still passes', () => {
    /* The "and not in the input" qualifier, which is what stops the echo check
       eating a real recording of somebody explaining this very feature. */
    const said = 'so the rule is repair this transcript and reply with the repaired transcript and nothing else';
    const r = auditRepair(said, 'So the rule is: repair this transcript, and reply with the repaired transcript and nothing else.');
    return (r === null || r.reason === null) || JSON.stringify(r);
  });

  check('the edit distance is real, and gives up rather than grinding', () => {
    const far = boundedEdits('a'.repeat(400), 'b'.repeat(400), 24);
    return (boundedEdits('kitten', 'sitting', 24) === 3 && boundedEdits('abc', 'abc', 24) === 0 && far === 25)
      || `${boundedEdits('kitten', 'sitting', 24)} ${far}`;
  });

  check('a repair that changes a word never does so silently', () => {
    /* The distinction the whole audit rests on. A name the transcriber split
       cannot be repaired without changing a word, so the audit cannot forbid
       that and stay useful — what it must never do is let one happen with
       nothing to show the person. */
    const cases = [
      ['the team at pail. Wave com met', 'The team at Palewave.com met.'],
      ['the plan and its working now', "The plan, and it's working now."],
      ['we remembers the plan', 'We remember the plan.']
    ];
    const silent = [];
    for (const [before, after] of cases) {
      const r = auditRepair(before, after);
      const moved = changedWords(before, after);
      if (moved.added.length && !(r && r.changed && r.changed.added.length)) silent.push(after);
    }
    return silent.length === 0 || `changed a word and said nothing: ${silent.join(' | ')}`;
  });

  check('an apostrophe is a letter, not punctuation', () => {
    /* "its" and "it's" are different words. A letter check that folds them
       together lets the model swap one for the other and report no change,
       which is exactly what escaped the bench once. */
    const r = auditRepair('the plan and its working', "The plan, and it's working.");
    return (r && r.edits > 0 && r.changed.added.includes("it's") && r.changed.removed.includes('its'))
      || JSON.stringify(r);
  });

  check('a repair that only moves punctuation reports no changed words', () => {
    const r = auditRepair('staring. Down the barrel of it', 'Staring down the barrel of it.');
    return r === null || `expected nothing to report, got ${JSON.stringify(r)}`;
  });

  check('rejoining a word the transcriber split is disclosed, though no letter moves', () => {
    /* "americ an" -> "american" changes not one letter, so a letter-only check
       calls it faithful and says nothing. It is faithful. It is also a
       word-level repair, and it went undisclosed three times in a 120-row
       bench before this was fixed. */
    const r = auditRepair('the americ an market is open', 'The American market is open.');
    return (r && r.reason === null && r.edits === 0
      && r.changed.added.includes('american') && r.changed.removed.includes('americ'))
      || JSON.stringify(r);
  });

  check('the tidy path carries every changed word up to its caller', async () => {
    const raw = '[0:00:00 --> 0:00:05] the team at pail. Wave com met today';
    const r = await tidyTranscript({ raw,
      complete: async () => ({ text: 'The team at Palewave.com met today.', finishReason: 'stop', tokens: 9 }) });
    return (r.used === 'repaired' && r.changed.added.includes('palewave') && r.changed.removed.includes('pail'))
      || JSON.stringify({ used: r.used, changed: r.changed });
  });

  check('a pasted transcript is worth offering to tidy; ordinary prose is not', () => {
    const cues = (n) => Array.from({ length: n }, (_, i) =>
      `[0:00:${String(i * 5).padStart(2, '0')} --> 0:00:${String(i * 5 + 5).padStart(2, '0')}] ` +
      'some spoken words that go on for a while here').join('\n\n');
    const prose = 'I have been thinking about whether to rewrite this module or patch it. '.repeat(9);
    const cases = [
      [cues(12), true, 'a real caption file'],
      [prose, false, 'ordinary prose, long enough but not timed'],
      [cues(2), false, 'a two-cue snippet — a transcript, but not worth interrupting for'],
      ['', false, 'nothing at all'],
      ['[0:00:00 --> 0:00:05] short', false, 'one short cue']
    ];
    const wrong = cases.filter(([t, want]) => worthTidying(t) !== want).map(([, , why]) => why);
    return wrong.length === 0 || `wrong on: ${wrong.join(' | ')}`;
  });

  check('the offer threshold is stricter than merely being a transcript', () => {
    /* If these ever became the same test, every two-line snippet would raise a
       chip somebody has to dismiss. */
    const twoCues = '[0:00:00 --> 0:00:05] a line here\n\n[0:00:05 --> 0:00:10] another line';
    return (isTranscript(twoCues) && !worthTidying(twoCues) && OFFER_MIN_CHARS > 0)
      || `isTranscript ${isTranscript(twoCues)}, worthTidying ${worthTidying(twoCues)}`;
  });

  /* ── the asks check ────────────────────────────────────────────────────── */

  check('an unclear answer is reported as unclear, not passed off as agreement', async () => {
    /* The bug this exists for, twice over. A thinking model asked a yes/no
       question with a six-token budget returns "Thinking Process:\n\n1." and
       nothing else. Read leniently that is a YES, so the check runs, costs
       time, and vetoes nothing — which on the bench looks exactly like a real
       null result. `clear` is what tells the two apart. */
    const rambling = asksCheck({ complete: async () => ({ text: 'Thinking Process:\n\n1.' }) });
    const r = await rambling('he made a hash of the presentation');
    return (r.asks === true && r.clear === false)
      || `asks ${r.asks}, clear ${r.clear} — an unparseable answer must not read as clear`;
  });

  check('a clear yes and a clear no are both read correctly', async () => {
    const yes = await asksCheck({ complete: async () => ({ text: 'YES' }) })('round 12.7');
    const no = await asksCheck({ complete: async () => ({ text: 'NO' }) })('he rounded on me');
    return (yes.asks === true && yes.clear && no.asks === false && no.clear)
      || JSON.stringify([yes, no]);
  });

  check('a check that cannot be reached never turns into a refusal', async () => {
    const broken = asksCheck({ complete: async () => { throw new Error('asleep'); } });
    const r = await broken('3 miles in metres');
    return r.asks === true || 'a failed check refused a real question';
  });

  check('a message the asks check says is not a request is not rescued by the second look, the router or the web', async () => {
    const lexical = new LexicalRouter(registry);
    const router = { route: async (m, o) => ({ ...lexical.route(m, o), category: 'encoding' }) };
    let looked = 0, planned = 0;
    const deps = {
      registry, router, extractor: jsExtractor(registry),
      ctx: { ...FIXED_CTX, webEnabled: true },
      planner: async () => { planned++; return planned === 1 ? { steps: [] } : { steps: [{ id: 's1', skill: 'morseEncode', input: { text: 'rusty' } }] }; },
      secondLook: async () => { looked++; return { chosen: 'morseEncode' }; },
      fallbackOnEmpty: true
    };
    for (const [label, planFirst] of [['declined by the planner too', false], ['planned by the planner', true]]) {
      looked = 0; planned = planFirst ? 1 : 0;
      const t = await runTurn('my morse code is rusty', { ...deps, asksCheck: async () => ({ asks: false, said: 'NO', ms: 1 }) });
      if (t.mode !== MODES.NO_SKILL || (t.results || []).length || looked || !t.asked) return `${label}: ${t.mode}, second look ${looked}`;
    }
    /* Without the verdict the rescue still runs — the guard is the check, not a new gate. */
    planned = 0; looked = 0;
    const real = await runTurn('my morse code is rusty', { ...deps, asksCheck: async () => ({ asks: true, said: 'YES', ms: 1 }) });
    return (looked === 1 && real.mode !== MODES.NO_SKILL) || `a real request lost its second look: ${real.mode}`;
  });

  check('the asks check asks with thinking OFF', () => {
    /* It is asked through llm.js, whose complete() leaves reasoning ON by
       default. A caller with a six-token budget must turn it off or it gets a
       preamble instead of an answer. */
    const src = readFileSync(join(ROOT, 'src/verify.js'), 'utf8');
    const fn = src.slice(src.indexOf('export function asksCheck'));
    return /think:\s*false/.test(fn) || 'asksCheck does not pass think: false';
  });

  check('every demonstration pairs an ordinary use against a real request', () => {
    const yes = ASKS_SHOTS.filter(([, a]) => a === 'YES').length;
    const no = ASKS_SHOTS.filter(([, a]) => a === 'NO').length;
    const held = ASKS_SHOTS.filter(([m]) => NO_SKILL_MESSAGES.includes(m) || HOLDOUT.some(h => h[0] === m));
    return (yes === no && yes >= 4 && held.length === 0)
      || `${yes} yes / ${no} no, ${held.length} of them are bench messages`;
  });

  check('the app actually asks the asks check, not just the bench', () => {
    /* Two of this session's three wasted bench runs were changes that ran and
       did nothing. A constant nobody passes is a measurement nobody gets, so
       the wiring is asserted rather than assumed: built in the stack, taken out
       of it, and handed to the turn. */
    const stack = readFileSync(join(ROOT, 'src/stack.js'), 'utf8');
    const app = readFileSync(join(ROOT, 'src/app.js'), 'utf8');
    const missing = [];
    if (!/asksCheck:\s*asksCheck\(/.test(stack)) missing.push('stack.js does not build it');
    if (!/asksCheck:\s*asks\b/.test(app)) missing.push('app.js does not pass it to runTurn');
    if (!/secondLook,\s*asksCheck:\s*asks\s*\}\s*=\s*built/.test(app.replace(/\n/g, ' ')))
      missing.push('app.js does not take it out of the stack');
    return missing.length === 0 || missing.join(' | ');
  });

  check('a forced plan is not second-guessed by the asks check', () => {
    /* Picking a skill by name IS the asking. Running the check there would let
       a model overrule a person's explicit choice. */
    const app = readFileSync(join(ROOT, 'src/app.js'), 'utf8');
    const forced = app.slice(app.indexOf('turn.forced = skillName') - 900, app.indexOf('turn.forced = skillName'));
    return !/asksCheck/.test(forced) || 'the forced-plan path passes the asks check';
  });

  /* ── the fallback floor ────────────────────────────────────────────────── */

  check('the shipped fallback floor is the measured one, and the app uses it', () => {
    const stack = readFileSync(join(ROOT, 'src/stack.js'), 'utf8');
    /* A constant nobody passes is a measurement nobody gets. The bench proved
       this exact number; the app has to be the thing that runs it. */
    return (FALLBACK_FLOOR === 0.20 && /fallbackFloor:\s*FALLBACK_FLOOR/.test(stack))
      || `FALLBACK_FLOOR is ${FALLBACK_FLOOR}, stack.js ${/fallbackFloor/.test(stack) ? 'passes something else' : 'does not pass it'}`;
  });

  check('when both the adapter and the words decline, nothing is offered to the planner', () => {
    /* The bug this catches cost a whole bench run: emptying `candidates` alone
       did nothing, because turn.js reads `forPlanner`. All three lists have to
       go or the floor is decoration. */
    const registry = buildRegistry(entries);
    const refusing = async () => ({ text: 'none', confidence: 1 });
    refusing.health = async () => true;
    const router = categoryRouter({ registry, complete: refusing, trained: true,
                                    minConfidence: 0.80, fallbackFloor: 0.99 });
    return router.route('he made a hash of the presentation').then(r => {
      const empty = ['candidates', 'forPlanner', 'actionable', 'suggestions']
        .filter(k => (r[k] || []).length);
      return empty.length === 0 || `still offered: ${empty.join(', ')}`;
    });
  });

  check('a floor of zero leaves the fallback exactly as it was', () => {
    const registry = buildRegistry(entries);
    const refusing = async () => ({ text: 'none', confidence: 1 });
    refusing.health = async () => true;
    const off = categoryRouter({ registry, complete: refusing, trained: true, minConfidence: 0.80 });
    return off.route('he made a hash of the presentation').then(r =>
      (r.candidates || []).length > 0 || 'a floor of 0 should change nothing, and it emptied the list');
  });

  /* ── the tidy path: mechanical, then the model, then the audit ─────────── */

  const RAW_CUES = '[0:00:00 --> 0:00:05] staring. Down the barrel of migrating this\n\n' +
                   '[0:00:05 --> 0:00:10] entire service the old Platform is Just bleeding money';
  const stubTidy = (text, extra = {}) => async () => ({ text, finishReason: 'stop', tokens: 20, ...extra });

  check('a faithful repunctuation is accepted and kept beside the raw reading', async () => {
    const r = await tidyTranscript({ raw: RAW_CUES,
      complete: stubTidy('Staring down the barrel of migrating this entire service.\n\nThe old platform is just bleeding money.') });
    return (r.used === 'repaired' && r.rejected === null && /^Staring down/.test(r.repaired)
      && r.raw === RAW_CUES && r.mechanical.includes('staring. Down'))
      || JSON.stringify({ used: r.used, rejected: r.rejected });
  });

  check('a rewrite is thrown out and the deterministic text is what is left', async () => {
    const r = await tidyTranscript({ raw: RAW_CUES,
      complete: stubTidy('The team plans to move their infrastructure elsewhere because costs are rising fast this quarter.') });
    return (r.used === 'mechanical' && /rewrote the words/.test(r.rejected)
      && r.mechanical.includes('bleeding money') && r.repaired === null)
      || JSON.stringify({ used: r.used, rejected: r.rejected });
  });

  check('a rejected repair is not an error — the mechanical text still stands', async () => {
    const asleep = await tidyTranscript({ raw: RAW_CUES, complete: null });
    return (asleep.used === 'mechanical' && asleep.mechanical.trim().length > 0
      && /no model is awake/.test(asleep.rejected))
      || JSON.stringify(asleep);
  });

  check('a model that throws is reported, not propagated', async () => {
    const r = await tidyTranscript({ raw: RAW_CUES,
      complete: async () => { throw new Error('the chat model is asleep'); } });
    return (r.used === 'mechanical' && r.rejected === 'the chat model is asleep') || JSON.stringify(r);
  });

  check('a repair cut off mid-transcript is thrown out', async () => {
    const r = await tidyTranscript({ raw: RAW_CUES,
      complete: stubTidy('Staring down the barrel of migrating this entire', { finishReason: 'length' }) });
    return (r.used === 'mechanical' && /ran out of room/.test(r.rejected)) || JSON.stringify(r);
  });

  check('the model is handed the tidied text, never the raw file', async () => {
    let saw = null;
    let sentMessages = false;
    await tidyTranscript({ raw: RAW_CUES, complete: async (arg) => {
      saw = arg.text;
      sentMessages = 'messages' in arg;
      return { text: saw, finishReason: 'stop', tokens: 5 };
    } });
    /* Text, not messages: in the app the instruction is Rust's and the page
       cannot supply one, so the caller must not be building prompts here. */
    if (sentMessages) return 'the caller passed messages, which the app path cannot honour';
    return (saw && !/-->/.test(saw) && !/\[0:00/.test(saw)) || `model saw: ${saw}`;
  });

  check('with several speakers the model gets each turn without its label, and the labels are put back', async () => {
    /* The tidier drops "Speaker 1:" when it is shown one, and the figures audit
       then threw the whole repair out (click-through 6). */
    const raw = 'WEBVTT\n\n00:00:00.000 --> 00:00:03.000\nSpeaker 1: we met on tuesday\n\n' +
      '00:00:03.000 --> 00:00:06.000\nSpeaker 2: the venue is not confirmed\n\n00:00:06.000 --> 00:00:09.000\nSpeaker 1: ok i will email sam';
    const seen = [];
    const r = await tidyTranscript({ raw, complete: async ({ text }) => {
      seen.push(text);
      return { text: text.replace(/^\w/, c => c.toUpperCase()).replace(/tuesday/, 'Tuesday') + '.', finishReason: 'stop', tokens: 8 };
    } });
    if (seen.some(t => /Speaker/.test(t))) return `model saw a label: ${JSON.stringify(seen)}`;
    return (r.used === 'repaired' && r.rejected === null
      && r.repaired === 'Speaker 1: We met on Tuesday.\n\nSpeaker 2: The venue is not confirmed.\n\nSpeaker 1: Ok i will email sam.')
      || JSON.stringify({ used: r.used, rejected: r.rejected, repaired: r.repaired });
  });

  /* ── the chat lane as it is written: sentences through the guard ──────── */

  check('a reply is shown a whole sentence at a time, and only sentences past the guard', async () => {
    const { showable, wholeSentences } = await import('../src/lane-b/chat.js');
    if (wholeSentences('Hello there. How are') !== 'Hello there.') return `wholeSentences: ${JSON.stringify(wholeSentences('Hello there. How are'))}`;
    if (wholeSentences('One line\n\nsecond para') !== 'One line') return 'a blank line ends a sentence';
    if (wholeSentences('Still writing') !== '') return 'an unfinished sentence is not shown';
    if (showable('Nothing', {}) !== null) return 'no whole word yet, nothing shown';
    if (showable('Nothing yet', {}) !== 'Nothing') return `words as typed: ${JSON.stringify(showable('Nothing yet', {}))}`;
    if (showable('Nothing yet. More', { asked: 'tell me a story' }) !== 'Nothing yet.') return 'unguarded: whole words';
    /* A question that wants a figure: the sentence that states one the
       person never gave is held back, and nothing after it is shown. */
    const asked = 'how many days until christmas';
    const text = 'That is not mine to work out. It would be about 72 days. Patch can tell you exactly. ';
    const got = showable(text, { asked, said: [] });
    if (got !== 'That is not mine to work out.') return `guarded: ${JSON.stringify(got)}`;
    /* The same reply to a question that wants no figure is shown as typed. */
    const plain = showable(text, { asked: 'tell me a story', said: [] });
    if (plain !== text.trim()) return `unguarded: ${JSON.stringify(plain)}`;
    if (showable('It would be about 72 d', { asked: 'tell me a story' }) !== 'It would be about 72') return 'unguarded, mid-word';
    /* A number the person supplied is theirs to hear back; a spelled one
       they did not ("ten weeks") would be held, as the whole-reply guard
       holds it. */
    const theirs = showable('Sure, 72 days is the figure you gave. ', { asked: 'how long is 72 days in weeks', said: [] });
    if (theirs !== 'Sure, 72 days is the figure you gave.') return `supplied: ${JSON.stringify(theirs)}`;
    const spelled = showable('Sure, 72 days is about ten weeks. ', { asked: 'how long is 72 days in weeks', said: [] });
    return spelled === null || `spelled: ${JSON.stringify(spelled)}`;
  });

  check('runChat hands onText the showable text as pieces arrive, and still reads the reply whole', async () => {
    const { runChat } = await import('../src/lane-b/chat.js');
    const seen = [];
    const reply = 'I would not guess. There are 72 days to go. Ask Patch.';
    const complete = async ({ onPiece }) => {
      for (let i = 1; i <= reply.length; i += 7) onPiece(reply.slice(0, i));
      onPiece(reply);
      return { text: reply, tokens: 12, finishReason: 'stop' };
    };
    const turn = await runChat('how many days until christmas', { complete, onText: (t) => seen.push(t) });
    if (!turn.handoff) return 'the whole reply still goes through the guard';
    return (seen.length === 1 && seen[0] === 'I would not guess.') || JSON.stringify(seen);
  });

  check('the planner names each skill the moment its name is whole in the stream', async () => {
    const { skillsNamedIn } = await import('../src/planner.js');
    const partial = '{"about":"a length","steps":[{"skill":"convertLength","args":{"amount":5},"skill":"';
    if (JSON.stringify(skillsNamedIn(partial)) !== '["convertLength"]') return `partial: ${JSON.stringify(skillsNamedIn(partial))}`;
    const two = '{"steps":[{"skill":"product","args":{}},{"skill":"evaluateExpression"';
    return JSON.stringify(skillsNamedIn(two)) === '["product","evaluateExpression"]' || JSON.stringify(skillsNamedIn(two));
  });

  check('the pieces of a long transcript are asked together, and come back in order', async () => {
    /* The engine batches up to four requests of one Pigeon in one decode, so
       the tidier must not wait for each piece before asking the next. Every
       piece's request is in flight before the first reply comes, and the
       repaired text keeps the pieces' order whatever order the replies take. */
    /* One long paragraph (the mechanical pass joins blank-line blocks), cut
       on sentence ends into four pieces. */
    const raw = ['a', 'b', 'c', 'd'].map(ch => `${ch.repeat(2000)} x.`).join(' ');
    const inFlight = [];
    let resolveAll = null;
    const gate = new Promise(res => { resolveAll = res; });
    const stages = [];
    const asking = tidyTranscript({ raw, complete: async ({ text }) => {
      inFlight.push(text);
      await gate;
      /* The last piece asked answers first. */
      await new Promise(res => setTimeout(res, (4 - inFlight.indexOf(text)) * 3));
      return { text: text.replace(/^\w/, c => c.toUpperCase()), finishReason: 'stop', tokens: 8 };
    }, onStage: (stage, n, of) => stages.push([stage, n, of]) });
    await new Promise(res => setTimeout(res, 10));
    const pieces = chunk(mechanicalClean(raw).text);
    if (pieces.length < 3) { resolveAll(); return `only ${pieces.length} piece(s); the test transcript is too short to prove anything`; }
    if (inFlight.length !== pieces.length) { resolveAll(); return `${inFlight.length} of ${pieces.length} pieces were in flight before any reply`; }
    resolveAll();
    const r = await asking;
    const want = pieces.map(p => p.replace(/^\w/, c => c.toUpperCase())).join('\n\n');
    return (r.used === 'repaired' && r.repaired === want && stages[stages.length - 1].join() === `repairing,${pieces.length},${pieces.length}`)
      || JSON.stringify({ used: r.used, rejected: r.rejected, stages, same: r.repaired === want });
  });

  check('the repair is shown growing, the pieces in their own order', async () => {
    /* Each piece's `onPiece` is called with its text so far, and onStage's
       fourth argument joins the pieces in order, so a page can show the tail. */
    const raw = ['a', 'b', 'c'].map(ch => `${ch.repeat(2000)} x.`).join(' ');
    const seen = [];
    const r = await tidyTranscript({ raw, complete: async ({ text, onPiece }) => {
      if (typeof onPiece !== 'function') throw new Error('no onPiece');
      const whole = text.replace(/^\w/, c => c.toUpperCase());
      /* The second piece speaks first, the first last. */
      await new Promise(res => setTimeout(res, { a: 9, b: 1, c: 5 }[text[0]] || 1));
      onPiece(whole.slice(0, 5));
      onPiece(whole);
      return { text: whole, finishReason: 'stop', tokens: 8 };
    }, onStage: (stage, done, of, live) => seen.push([done, of, live]) });
    const pieces = chunk(mechanicalClean(raw).text).map(p => p.replace(/^\w/, c => c.toUpperCase()));
    const first = seen.find(([, , live]) => live);
    const last = seen[seen.length - 1];
    if (pieces.length !== 3) return `${pieces.length} piece(s), not 3`;
    return (r.used === 'repaired' && first && first[2] === pieces[1].slice(0, 5) && last[0] === 3 && last[1] === 3 && last[2] === pieces.join('\n\n'))
      || JSON.stringify({ used: r.used, first, last: last && [last[0], last[1], last[2].length] });
  });

  check('the transcript is cut on blank lines, never mid-sentence', () => {
    const text = ['A'.repeat(1200), 'B'.repeat(1200), 'C'.repeat(1200)].join('\n\n');
    const pieces = chunk(text, 3000);
    const midSentence = pieces.filter(p => /[a-z],?$/.test(p.trim()) && p.length < 1200);
    return (pieces.length === 2 && midSentence.length === 0) || `${pieces.length} pieces`;
  });

  check('one block too long to cut on a blank line falls back to sentence ends', () => {
    const long = Array.from({ length: 60 }, (_, i) => `This is sentence number ${i} and it runs on for a while.`).join(' ');
    const pieces = chunk(long, 800);
    const allEndSentences = pieces.slice(0, -1).every(p => /[.!?]$/.test(p.trim()));
    return (pieces.length > 1 && allEndSentences) || `${pieces.length} pieces, endings ${allEndSentences}`;
  });

  check('the reply budget tracks the text rather than a fixed ceiling', () => {
    const small = repairBudget('a'.repeat(200));
    const big = repairBudget('a'.repeat(20000));
    return (small < big && big <= 2048 && small >= 64) || `${small} ${big}`;
  });

  /* The instruction lives twice: once in Rust, because the app must not let
     the page write a prompt, and once here for the dev path, which builds its
     own messages against a bare llama-server. Drift between them means the
     adapter is trained for one prompt and asked with another, and the only
     symptom is that it quietly gets worse. */
  check('the repair instruction is the same string in Rust and in JS', () => {
    const rs = readFileSync(join(ROOT, 'src-tauri/src/task.rs'), 'utf8');
    const m = rs.match(/pub const TRANSCRIPT_INSTRUCTION: &str = "([\s\S]*?)";/);
    if (!m) return 'TRANSCRIPT_INSTRUCTION not found in task.rs';
    const fromRust = m[1].replace(/\\"/g, '"');
    return fromRust === REPAIR_SYSTEM
      || `rust:\n${fromRust}\n\njs:\n${REPAIR_SYSTEM}`;
  });

  check('the instruction the adapter was trained on is the one it is asked with', () => {
    const trained = readFileSync(join(ROOT, 'model/transcript-data/INSTRUCTION.txt'), 'utf8').trim();
    return trained === REPAIR_SYSTEM || `trained:\n${trained}\n\nasked:\n${REPAIR_SYSTEM}`;
  });

  check('the task the page may name is a closed set, declared in Rust', () => {
    const rs = readFileSync(join(ROOT, 'src-tauri/src/task.rs'), 'utf8');
    /* The page supplies text and a task name and nothing else. If a `messages`
       field ever appears on TaskRequest this stops being true, and the third
       door becomes a second prose door. */
    const req = rs.match(/pub struct TaskRequest \{[\s\S]*?\n\}/);
    if (!req) return 'TaskRequest not found';
    return !/messages/.test(req[0]) || `TaskRequest accepts messages:\n${req[0]}`;
  });

  check('the pinned hash of every task adapter matches the file on disk', () => {
    /* The adapter is retrained, the file changes, and models.json still names
       the old hash — which the shipped verifier would then reject on a user's
       machine. It happened once; this is the check that would have said so. */
    const models = JSON.parse(readFileSync(join(ROOT, 'src-tauri/models.json'), 'utf8'));
    const tasks = (models.models.find(m => m.role === 'category') || {}).tasks || [];
    const wrong = [];
    for (const t of tasks) {
      const file = join(ROOT, 'model', t.file);
      let bytes;
      try { bytes = readFileSync(file); } catch { wrong.push(`${t.file} is not in model/`); continue; }
      const sum = createHash('sha256').update(bytes).digest('hex');
      if (sum !== t.sha256) wrong.push(`${t.file}: file is ${sum.slice(0, 16)}…, manifest says ${String(t.sha256).slice(0, 16)}…`);
      if (bytes.length !== t.bytes) wrong.push(`${t.file}: file is ${bytes.length} bytes, manifest says ${t.bytes}`);
    }
    return wrong.length === 0 || wrong.join(' | ');
  });

  check('the tidier is a Pigeon in Patch\'s nest, and no model or adapter ships loose (D84)', async () => {
    const conf = JSON.parse(readFileSync(join(ROOT, 'src-tauri/tauri.conf.json'), 'utf8'));
    const { PATCH_NEEDS } = await import('./export-pigeon-stage.mjs');
    const loose = Object.keys(conf.bundle.resources || {}).filter(k => /\.gguf$/.test(k));
    if (loose.length) return `bundled loose: ${loose}`;
    if ((conf.bundle.externalBin || []).some(b => /llama/.test(b))) return 'a llama-server still ships';
    const rust = readFileSync(join(ROOT, 'src-tauri/src/task.rs'), 'utf8');
    return (PATCH_NEEDS.includes('tidier') && /pigeon: "tidier"/.test(rust)) || 'the transcript repair is not the tidier Pigeon';
  });

  /* ── the corruption recipe, which the training data rests on ───────────── */

  const CLEAN = 'Today we look at the recent tariffs. The Nasdaq took a hit last week.\n\nI think the market recovers. Let us jump in.';

  check('corruption is reproducible from its seed', () => {
    const a = corrupt(CLEAN, { rng: mulberry(4), level: 'medium' }).text;
    const b = corrupt(CLEAN, { rng: mulberry(4), level: 'medium' }).text;
    return a === b || `${a}\n${b}`;
  });

  check('the truth keeps its paragraphs and the damaged copy loses them', () => {
    const r = corrupt(CLEAN, { rng: mulberry(4), level: 'medium' });
    return (r.truth.includes('\n\n') && !r.text.includes('\n')) || JSON.stringify([r.truth, r.text]);
  });

  check('damage adds fillers and never drops what was spoken', () => {
    const letters = (t) => (String(t).toLowerCase().match(/[a-z0-9']+/g) || []).join('');
    for (const level of Object.keys(LEVELS)) {
      const r = corrupt(CLEAN, { rng: mulberry(9), level });
      if (letters(r.text).length < letters(r.truth).length) return `${level} lost text: ${r.text}`;
    }
    return true;
  });

  check('a capital that starts a sentence is never mangled as a name', () => {
    const all = { dropBoundary: 0, addBoundary: 0, strayCap: 0, filler: 0, mangleName: 1 };
    const r = corrupt('Today matters. Tomorrow matters too.', { rng: mulberry(3), level: all });
    return (r.applied.mangled === 0 && r.text === 'Today matters. Tomorrow matters too.') || r.text;
  });

  check('a proper noun mid-sentence is mangled the way a real one is', () => {
    const all = { dropBoundary: 0, addBoundary: 0, strayCap: 0, filler: 0, mangleName: 1 };
    const r = corrupt('The team at Nasdaq met today.', { rng: mulberry(3), level: all });
    return (r.applied.mangled === 1 && /nas\. Daq/.test(r.text)) || r.text;
  });

  check('heavier damage really is heavier', () => {
    const count = (level) => {
      const r = corrupt(CLEAN, { rng: mulberry(21), level });
      return Object.values(r.applied).reduce((a, b) => a + b, 0);
    };
    const [l, m, h] = [count('light'), count('medium'), count('heavy')];
    return (l <= m && m <= h && h > l) || `light ${l}, medium ${m}, heavy ${h}`;
  });
}

/* ── Lane B: a persona cannot compute (§5.4) ─────────────────────────────── */
{
  check('numeralsIn finds a number however it is punctuated', () => {
    const got = numeralsIn('194.0 lb, 1,240 miles, 40%, the 14th, at 09:30 on 2026-10-14');
    for (const want of ['194', '1240', '40', '14', '9-30', '2026-10-14']) {
      if (!got.has(want)) return `missing ${want} from ${JSON.stringify([...got])}`;
    }
    /* The same time written two ways is one number, so restating what you were
       told in a different format is not inventing anything. */
    return numeralsIn('09:30').has('9-30') && numeralsIn('9:30').has('9-30')
      ? true : 'a leading zero made two numbers out of one time';
  });

  check('a number in words counts only when it is really a quantity', () => {
    const quantity = numeralsIn('about a hundred and ninety-four pounds');
    const speech = numeralsIn('in one sentence, say the second thing first');
    return (quantity.size > 0 && speech.size === 0)
      || `quantity=${JSON.stringify([...quantity])} speech=${JSON.stringify([...speech])}`;
  });

  /* The hole the bench found and closed: two answers in forty reached the
     reader with the figure spelled out ("there is one edit between them").
     Safe to catch now because the guard only runs on a question that wants a
     figure — and the phrases where "one" is not one are excluded by name. */
  check('a figure spelled out is caught when the question wanted a figure', () => {
    const edits = needsHandoff('There is one edit between them.', { asked: 'how many edits between these two spellings' });
    const shared = needsHandoff('They share two words.', { asked: 'how much vocabulary do these share' });
    const echoed = needsHandoff('You said two spellings, so compare those.', { asked: 'how many edits between these two spellings' });
    const idiom = needsHandoff('Counting is not one of my jobs — hand it over.', { asked: 'how many days until the 14th' });
    const chatty = needsHandoff('Say it in one sentence.', { asked: 'help me word a difficult email' });
    return (edits && edits.numbers.includes('one') && shared && shared.numbers.includes('two')
      && echoed === null && idiom === null && chatty === null)
      || JSON.stringify({ edits, shared, echoed, idiom, chatty });
  });

  /* The guard fires on the question the spec names — one that NEEDS a figure —
     and not on a conversation. The first real question asked in this lane,
     "my recursive flatten keeps blowing the stack", came back as a numbered
     list and the earlier always-on version ate it over the "1.". */
  check('a question is quantitative when its answer would be a figure, and not otherwise', () => {
    const wants = ['how many days until the 14th', 'what is 88 kg in lb', 'split an 84.50 bill 4 ways with 15% tip',
      'convert this csv to json', 'how much is 26.2 miles in km', "what's the median of 3 9 4 12 7",
      'when does the 14 day cooling off period end', 'when will my contract renew'];
    const does_not = ['my recursive flatten keeps blowing the stack', 'explain closures to me like I have not met them',
      'help me think through whether to rewrite this or patch it', 'I am stuck on how to word a difficult email',
      'ask me questions until I understand promises', 'what do you think of this approach',
      'when does it make sense to rewrite this', 'when is the best time to talk to my manager'];
    const wrong = [...wants.filter(q => !wantsANumber(q)), ...does_not.filter(q => wantsANumber(q))];
    return wrong.length === 0 || `misclassified: ${wrong.join(' | ')}`;
  });

  check('a numbered list and a code sample are not figures being claimed', () => {
    const listy = '1. First, find the base case.\n2. Then narrow it.\nUse `arr[0]` and `n - 1` inside.';
    const found = [...numeralsIn(listy)];
    return (found.length === 0 && needsHandoff(listy, { asked: 'my recursive flatten keeps blowing the stack' }) === null)
      || `found ${JSON.stringify(found)}`;
  });

  check('needsHandoff passes a number the person supplied and catches one they did not', () => {
    const echoed = needsHandoff('You said 88 kg, and that is the figure to use.', { asked: 'how much is 88 kg in lb?' });
    const invented = needsHandoff('88 kg is 194.0 lb.', { asked: 'how much is 88 kg in lb?' });
    const earlier = needsHandoff('The 14th, as you said.', { asked: 'how many days until it?', said: ['the exam is on the 14th'] });
    return (echoed === null && earlier === null && invented && invented.numbers.includes('194'))
      || JSON.stringify({ echoed, invented, earlier });
  });

  /* The model's own earlier words must not license a number: one that slipped
     through once cannot become the reason it is allowed again. */
  check('only what the person typed can license a number', () => {
    const out = needsHandoff('Still 12 metres, as I said.', { asked: 'how long is the wall now?', said: [] });
    return (out && out.numbers.includes('12')) || 'the model licensed its own number';
  });

  const stub = (text) => async () => ({ text, ms: 5, tokens: 20, promptTokens: 100, finishReason: 'stop' });

  check('a Lane B turn is marked, carries text rather than segments, and runs no plan', async () => {
    const turn = await runChat('why does my recursion blow the stack?', { complete: stub('Because the base case never narrows.') });
    return (turn.lane === 'B' && turn.mode === 'generated' && turn.reply.source === 'generated'
      && turn.reply.text === 'Because the base case never narrows.'
      && turn.reply.segments === undefined && turn.plan === undefined && turn.results === undefined
      && turn.handoff === null)
      || JSON.stringify(turn);
  });

  check('a Lane B reply that states an invented figure is dropped, not shown', async () => {
    const turn = await runChat('how many days until the 14th of next month?', { complete: stub('That is 35 days away.') });
    return (turn.reply.text === HANDOFF_TEXT && turn.handoff && turn.handoff.numbers.includes('35')
      && turn.handoff.dropped === 'That is 35 days away.' && turn.offer === true)
      || JSON.stringify(turn);
  });

  check('the honest decline is left exactly as the model wrote it, and still offers the way to an answer', async () => {
    const said = 'That is a counting question, and counting is not mine to do — hand it to the verified lane.';
    const turn = await runChat('how many days until the 14th?', { complete: stub(said) });
    return (turn.reply.text === said && turn.handoff === null && turn.offer === true) || JSON.stringify(turn);
  });

  /* The case that made the rule: a chat answer with structure in it survives,
     and is not offered a handoff it has no use for. */
  check('a conversational reply keeps its numbered list', async () => {
    const answer = 'Two things to check:\n1. What the base case receives.\n2. Whether the argument shrinks.';
    const turn = await runChat('my recursive flatten keeps blowing the stack', { complete: stub(answer) });
    return (turn.reply.text === answer && turn.handoff === null && turn.offer === false) || JSON.stringify(turn);
  });

  check('with no model the lane says so rather than throwing', async () => {
    const turn = await runChat('hello', { complete: null });
    return (turn.reply === null && /no model/.test(turn.error)) || JSON.stringify(turn);
  });

  check('a model that fails is a turn, not an exception', async () => {
    const turn = await runChat('hello', { complete: async () => { throw new Error('the chat model is asleep'); } });
    return (turn.reply === null && turn.error === 'the chat model is asleep') || JSON.stringify(turn);
  });

  check('the conversation the model sees is Lane B only, and the system rule leads it', () => {
    const history = [
      { lane: 'B', message: 'hello', reply: { text: 'Hello.' } },
      { lane: 'A', message: '88 kg in lb', reply: { segments: [{ type: 'value', text: '194.0 lb' }] } },
      { lane: 'B', message: 'go on', reply: { text: 'That is 35 days.' }, handoff: { numbers: ['35'] } }
    ];
    const msgs = messagesFor('and then?', history);
    const flat = JSON.stringify(msgs);
    return (msgs[0].role === 'system' && msgs[0].content === CHAT_SYSTEM
      && !flat.includes('194.0 lb') && !flat.includes('88 kg')
      && !flat.includes('That is 35 days')
      && msgs.filter(m => m.role === 'user').map(m => m.content).join('|') === 'hello|go on|and then?')
      || flat.slice(0, 400);
  });

  /* The persona holdout. A corpus built from the bench's own questions would
     score well there by memory, so the exclusion is a correctness property of
     the training pipeline, not a nicety. */
  check('the held-out conversational set is recognised through ordinary paraphrase', () => {
    const same = ['I keep procrastinating on this refactor.',
                  'i keep procrastinating on this refactor',
                  "my recursive flatten keeps blowing the stack and I can't see why"];
    const missed = same.filter(q => !isHeldOut(q));
    return missed.length === 0 || `not recognised: ${missed.join(' | ')}`;
  });

  check('the holdout does not swallow a genuinely different question', () => {
    const different = ['why is my flatten slow',
                       'explain generators to me',
                       'help me name this variable',
                       'what is 20% off 150'];
    const eaten = different.filter(isHeldOut);
    return eaten.length === 0 || `wrongly held out: ${eaten.join(' | ')}`;
  });

  check('no persona plan ships a seed that is in the holdout', () => {
    let plans;
    try { plans = readdirSync(join(ROOT, 'model/persona-data')).filter(f => f.endsWith('.plan.json')); }
    catch { return true; }   // no personas planned yet is not a failure
    const bad = [];
    for (const f of plans) {
      const plan = JSON.parse(readFileSync(join(ROOT, 'model/persona-data', f), 'utf8'));
      for (const g of plan.groups || []) {
        for (const q of g.seeds || []) if (isHeldOut(q)) bad.push(`${f}: ${q}`);
      }
    }
    return bad.length === 0 || bad.join(' | ');
  });

  check('every held-out question normalises to something non-empty and distinct', () => {
    const keys = CONVERSATIONAL.map(normalise);
    if (keys.some(k => !k)) return 'a question normalised away to nothing';
    return new Set(keys).size === keys.length || 'two held-out questions collide';
  });

  check('a persona is named in the system prompt without loosening a rule', () => {
    const msgs = messagesFor('hi', [], { id: 'socratic-tutor', name: 'Socratic Tutor' });
    return (msgs[0].content.startsWith(CHAT_SYSTEM) && /speaking as Socratic Tutor/.test(msgs[0].content))
      || msgs[0].content.slice(-200);
  });

  check('the history handed over is bounded', () => {
    const history = Array.from({ length: 40 }, (_, i) => ({ lane: 'B', message: `q${i}`, reply: { text: `a${i}` } }));
    const msgs = messagesFor('now', history);
    return msgs.filter(m => m.role === 'user').length === HISTORY_TURNS + 1
      || `${msgs.filter(m => m.role === 'user').length} user messages`;
  });
}

/* ── 7. the executor, end to end, on a hand-written plan (§9 Phase 0 gate) ── */
await import('./gate.mjs').then(m => m.run(check, { registry, FIXED_CTX, validatePlan, runPlan, LexicalRouter }))
  .catch(e => { fail++; failures.push(`Phase 0 gate\n    ${e.message}`); });


/* ── bench variants and the queue's arithmetic ──────────────────────────── */
{
  const cards = ['applyDiscount', 'stackDiscounts', 'product'].map(n => registry.compactCard(n));
  const shipped = plannerUserMessage({ message: 'extra 15 off an already 30 off item', cards, ctx: FIXED_CTX });
  check('every prompt variant renders a prompt and changes exactly one thing', () => {
    const problems = [];
    for (const [name, v] of Object.entries(VARIANTS)) {
      const po = plannerOptions(v); const dl = declineOptions(v);
      const keys = [...Object.keys(po), ...Object.keys(dl)].filter(k => k !== 'system' || !('shots' in po));
      if (!keys.length) problems.push(`${name}: changes nothing`);
      const user = plannerUserMessage({ message: 'x', cards, ctx: FIXED_CTX, order: po.order, cardExamples: po.cardExamples });
      if (!user.includes('MESSAGE') || !user.includes('SKILLS')) problems.push(`${name}: user turn lost a section`);
      const sys = plannerSystem({ runway: true, system: po.system, runwayRule: po.runwayRule });
      if (!/8\./.test(sys)) problems.push(`${name}: runway rule missing`);
      for (const sh of (po.shots || SHOTS)) if (!sh.user || !sh.assistant) problems.push(`${name}: malformed shot`);
      for (const sh of (dl.shots || [])) if (sh.length !== 2 || !sh[1].startsWith('{')) problems.push(`${name}: malformed decline shot`);
    }
    return problems.length ? problems.join('; ') : true;
  });
  check('the shipped defaults are byte-identical with no variant', () => {
    const again = plannerUserMessage({ message: 'extra 15 off an already 30 off item', cards, ctx: FIXED_CTX, ...plannerOptions(null) });
    return again === shipped && plannerSystem({ runway: true }) === plannerSystem({ runway: true, runwayRule: RUNWAY_RULE }) ? true : 'defaults drifted';
  });

  /* Prompts-as-data: every factory that will take its prompt from a packed file
     must build the SAME request stream when handed today's constants
     explicitly as when handed nothing. A recording stub answers each request
     acceptably so the code walks its normal path, not just its error path. */
  {
    const PROMPT_MESSAGES = [
      ...HOLDOUT_MESSAGES.filter((_, i) => i % Math.max(1, Math.floor(HOLDOUT_MESSAGES.length / 36)) === 0).slice(0, 36),
      'replace $& with money', "what is $' here", 'the {message} placeholder', '{message}{message}',
      'two\nlines\nof text', '$1 and $$ and $` together', 'sha256 of "quoted" text', '',
      'take 20 percent off 150', 'tidy this json'
    ];
    const recorder = () => {
      const calls = [];
      const complete = async (req) => {
        calls.push(JSON.parse(JSON.stringify(req)));
        const g = req.grammar;
        if (typeof g !== 'string') return { text: 'YES', ms: 1 };
        if (g.includes('looking_for')) return { text: '{"looking_for":"x","sentence":1}', ms: 1 };
        if (g.includes('asked_for')) {
          const name = (g.match(/name ::= "\\"([^"\\]+)\\""/) || [])[1] || 'none';
          return { text: JSON.stringify({ asked_for: 'x', skill: name }), ms: 1 };
        }
        const first = (g.match(/^root ::= "([^"]*)"/) || [])[1];
        return { text: first ?? 'YES', ms: 1, confidence: 0.9 };
      };
      return { calls, complete };
    };
    const sameStream = async (name, build, drive) => {
      const a = recorder(); const b = recorder();
      const fa = build(a.complete, false); const fb = build(b.complete, true);
      const outA = []; const outB = [];
      for (const m of PROMPT_MESSAGES) { outA.push(await drive(fa, m)); outB.push(await drive(fb, m)); }
      if (a.calls.length < 40) return `${name}: only ${a.calls.length} requests recorded`;
      if (!isDeepStrictEqual(a.calls, b.calls)) {
        const i = a.calls.findIndex((c, j) => !isDeepStrictEqual(c, b.calls[j]));
        return `${name}: request ${i} differs`;
      }
      return isDeepStrictEqual(JSON.parse(JSON.stringify(outA)), JSON.parse(JSON.stringify(outB))) || `${name}: results differ`;
    };
    const lex = new LexicalRouter(registry);
    const skillFor = (m) => (lex.route(m, {}).candidates[0] || {}).name || 'applyDiscount';
    const LEX = { threshold: 0.375, marginFloor: 0.12 };

    for (const trained of [false, true]) {
      check(`prompts as data: categoryRouter (${trained ? 'trained' : 'prompted'}) builds identical requests from explicit defaults`, () =>
        sameStream('categoryRouter', (complete, explicit) => {
          const base = { registry, complete, trained, minConfidence: 0.5, fallbackFloor: FALLBACK_FLOOR };
          if (!explicit) return categoryRouter(base);
          const cats = [...new Set(registry.routable().map(s => s.category))].sort();
          return categoryRouter({ ...base, trainedSystem: trainedSystemFor(cats), promptedSystem: CATEGORY_SYSTEM,
                                  shots: CATEGORY_SHOTS, lexicalOptions: LEX });
        }, async (r, m) => { const o = await r.route(m, {}); return { o, cat: r.lastCategory }; }));
      check(`prompts as data: siblingCheck (${trained ? 'trained' : 'prompted'}) builds identical requests from explicit defaults`, () =>
        sameStream('siblingCheck', (complete, explicit) => siblingCheck({ complete, registry, router: lex, trained,
          ...(explicit ? { system: SIBLING_SYSTEM, systemTrained: SIBLING_SYSTEM_TRAINED, shots: SIBLING_SHOTS } : {}) }),
        (f, m) => f({ message: m, skill: skillFor(m), routing: lex.route(m, {}) })));
    }
    check('prompts as data: declineCheck builds identical requests from explicit defaults', () =>
      sameStream('declineCheck', (complete, explicit) => declineCheck({ complete, registry,
        ...(explicit ? { system: DECLINE_SYSTEM, shots: DECLINE_SHOTS } : {}) }),
      (f, m) => {
        const names = lex.route(m, {}).candidates.slice(0, 3).map(c => c.name);
        const cards = (names.length ? names : ['formatJson', 'flattenJson']).map(n => registry.compactCard(n));
        return f({ message: m, cards });
      }));
    check('prompts as data: asksCheck builds identical requests from the template', () =>
      sameStream('asksCheck', (complete, explicit) => asksCheck({ complete,
        ...(explicit ? { system: ASKS_SYSTEM, shots: ASKS_SHOTS, userTurnTemplate: ASKS_USER_TURN_TEMPLATE } : {}) }),
      async (f, m) => { const o = await f(m); return { asks: o.asks, said: o.said, clear: o.clear }; }));
    check('prompts as data: sentenceFocus builds identical requests from explicit defaults', () =>
      sameStream('sentenceFocus', (complete, explicit) => sentenceFocus({ complete,
        ...(explicit ? { system: FOCUS_SYSTEM, shots: FOCUS_SHOTS } : {}) }),
      async (f, m) => { const o = await f({ message: m, answer: `The first sentence sets the scene here. ${m.replace(/\s+/g, ' ')} was asked. The last sentence closes it out.` }); return o && { text: o.text, kept: o.kept, of: o.of }; }));

    check('prompts as data: the asks template fills to asksUserTurn for every message', () => {
      const bad = [...PROMPT_MESSAGES, ...ASKS_SHOTS.map(([m]) => m), ...NO_SKILL_MESSAGES]
        .filter(m => ASKS_USER_TURN_TEMPLATE.split('{message}').join(m) !== asksUserTurn(m));
      return bad.length ? `differs for ${JSON.stringify(bad.slice(0, 3))}` : true;
    });
    check('prompts as data: a template holding $& is filled literally, not as a replacement pattern', async () => {
      const r = recorder();
      await asksCheck({ complete: r.complete, shots: [], userTurnTemplate: 'Q: {message} / {message}' })("a $& b $' c");
      const got = r.calls[0].messages.at(-1).content;
      return got === "Q: a $& b $' c / a $& b $' c" || JSON.stringify(got);
    });
    check('prompts as data: trainedSystemFor(registry categories) is the prompt the category adapter trained on', () => {
      let row;
      try { row = readFileSync(join(ROOT, 'model/training-data-v4/train.jsonl'), 'utf8').split('\n').find(Boolean); }
      catch { return true; }
      if (!row) return true;
      const want = JSON.parse(row).messages.find(x => x.role === 'system').content;
      const cats = [...new Set(registry.routable().map(s => s.category))].sort();
      const got = trainedSystemFor(cats);
      return got === want || `app builds ${JSON.stringify(got.slice(-200))}, training file has ${JSON.stringify(want.slice(-200))}`;
    });
    check('prompts as data: LexicalRouter defaults equal explicit 0.375 / 0.12 on the holdout', () => {
      const d = new LexicalRouter(registry); const e = new LexicalRouter(registry, LEX);
      if (d.threshold !== 0.375 || d.marginFloor !== 0.12) return `defaults are ${d.threshold} / ${d.marginFloor}`;
      const bad = HOLDOUT_MESSAGES.filter(m => !isDeepStrictEqual(d.route(m, {}), e.route(m, {})));
      return bad.length ? `${bad.length} routes differ, e.g. ${JSON.stringify(bad[0])}` : true;
    });

    /* The app's wiring (stack.js) handed a pack's options must ask exactly what
       it asks with none. buildPlanner/buildCategoryRouter probe a live server
       first, so this drives assembleStack, which builds the same pieces through
       the same two helpers those functions call. */
    check('prompts as data: the stack builds identical requests with the pack options as with none', async () => {
      const packOptions = optionsFrom(await patchData());
      const drive = async (st, m) => {
        const routed = await st.router.route(m, {});
        const names = routed.candidates.slice(0, 3).map(c => c.name);
        const cards = (names.length ? names : ['formatJson', 'flattenJson']).map(n => registry.compactCard(n));
        const plan = await st.planner({ message: m, cards, ctx: FIXED_CTX, routerConfident: m.length % 2 === 0 });
        /* The second look is retired (stack.js builds none); nothing to ask. */
        const decline = st.secondLook ? await st.secondLook({ message: m, cards }) : null;
        const asks = await st.asksCheck(m);
        const focus = await st.focus({ message: m, answer: `The first sentence sets the scene here. ${m.replace(/\s+/g, ' ')} was asked. The last sentence closes it out.` });
        return { routed, plan, decline, asks: { asks: asks.asks, said: asks.said, clear: asks.clear }, focus: focus && { text: focus.text, kept: focus.kept, of: focus.of } };
      };
      return sameStream('assembleStack', (complete, explicit) =>
        assembleStack({ registry, complete, categoryComplete: complete, ...(explicit ? { packOptions } : {}) }), drive);
    });
  }

  /* ── the seal, and Patch as a sealed skill pack ─────────────────────── */
  await sealChecks(check);

  check('patch.pigeon: every staged prompt survives JSON and is the constant the app runs on', async () => {
    const { prompts, tunables } = await patchData();
    for (const [role, p] of Object.entries({ ...prompts, tunables })) {
      if (!isDeepStrictEqual(JSON.parse(JSON.stringify(p)), p)) return `${role} changes on its way through JSON`;
    }
    if (!isDeepStrictEqual(prompts.planner.shots, SHOTS) || prompts.planner.runway_rule !== RUNWAY_RULE) return 'planner prompts are not the shipped constants';
    if (!isDeepStrictEqual(prompts.asks.shots, ASKS_SHOTS)) return 'asks shots are not the shipped constants';
    return true;
  });

  check('patch.pigeon: the code closure is every skill and nothing outside skills/ and src/', async () => {
    const closure = await importClosure();
    const skillFiles = readdirSync(new URL('../skills/', import.meta.url)).filter(f => f.endsWith('.js')).map(f => `skills/${f}`);
    const missing = skillFiles.filter(f => !closure.includes(f));
    const outside = closure.filter(f => !f.startsWith('skills/') && !f.startsWith('src/'));
    return (!missing.length && !outside.length) || `missing ${missing.slice(0, 3)}; outside ${outside.slice(0, 3)}`;
  });

  check('patch.pigeon: the loader takes a sealed pack apart, and refuses one unsealed, untrusted or tampered', async () => {
    const seed = Buffer.from('9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60', 'hex');
    const pub = 'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a';
    const trusted = [{ id: sealKeyId(Buffer.from(pub, 'hex')), ed25519_pub_hex: pub, revoked: false }];
    const { prompts, tunables } = await patchData();
    prompts.category.trained_system = trainedSystemFor([]);
    const adapter = Buffer.from('not really an adapter');
    const roles = Object.keys(prompts);
    const manifest = {
      format_version: 1, name: 'Patch', id: 'patch', kind: 'skillpack', version: 1, signature: '',
      models: { planner: { adapter: null }, category: { adapter: 'adapters/category.lora.gguf', adapter_sha256: createHash('sha256').update(adapter).digest('hex') } },
      code: { entry: 'code/skills/index.js', module: 'esm', files: 1 },
      prompts: Object.fromEntries(roles.map(r => [r, `prompts/${r}.json`])), tunables: 'tunables.json'
    };
    const files = [
      ['pigeon.json', JSON.stringify(manifest)],
      ['adapters/category.lora.gguf', adapter],
      ['code/skills/index.js', 'export default [];\n'],
      ...roles.map(r => [`prompts/${r}.json`, JSON.stringify(prompts[r])]),
      ['tunables.json', JSON.stringify(tunables)]
    ];
    const tmp = fsSeal.mkdtempSync(`${osSeal.tmpdir()}/pigeon-loader-check-`);
    const write = (name, bytes) => { const f = `${tmp}/${name}`; fsSeal.writeFileSync(f, bytes); return f; };
    try {
      const sealed = sealZip(files, seed);
      const pack = await loadPigeon(write('patch.pigeon', sealed), { trustedKeys: trusted, into: tmp });
      const ok = pack.keyId === trusted[0].id
        && pack.plannerOptions.system === prompts.planner.system
        && pack.routerOptions.promptedSystem('- x: y') === CATEGORY_SYSTEM('- x: y')
        && pack.asksOptions.userTurnTemplate === ASKS_USER_TURN_TEMPLATE
        && pack.routerOptions.lexicalOptions.threshold === 0.375
        && fsSeal.existsSync(pack.adapterPath);
      const dir = pack.dir;
      await pack.cleanup();
      if (!ok) return 'the loaded options are not the packed prompts';
      if (fsSeal.existsSync(dir)) return 'cleanup left the extracted folder behind';

      const refuses = async (label, bytes, keys = trusted) => {
        try { await loadPigeon(write(`${label}.pigeon`, bytes), { trustedKeys: keys, into: tmp }); return `${label} was loaded`; } catch { return null; }
      };
      const tampered = Buffer.from(sealed);
      const at = tampered.indexOf('not really an adapter');
      tampered[at] ^= 1;
      const why = (await refuses('untrusted', sealed, []))
        ?? (await refuses('unsealed', buildStoreZip(files)))
        ?? (await refuses('tampered', tampered));
      return why ?? true;
    } finally {
      fsSeal.rmSync(tmp, { recursive: true, force: true });
    }
  });

  /* ── Patch from a pack: options, and the skill-worker protocol ─────────── */

  check('patch options: optionsFrom(patchData()) hands every factory the constants it runs on', async () => {
    const o = optionsFrom(await patchData());
    const want = [
      ['planner system', o.plannerOptions.system, PLANNER_SYSTEM], ['planner shots', o.plannerOptions.shots, SHOTS],
      ['runway rule', o.plannerOptions.runwayRule, RUNWAY_RULE], ['category shots', o.routerOptions.shots, CATEGORY_SHOTS],
      ['trained system', o.routerOptions.trainedSystem, trainedSystemFor([...new Set(registry.routable().map(s => s.category))].sort())],
      ['decline system', o.declineOptions.system, DECLINE_SYSTEM], ['decline shots', o.declineOptions.shots, DECLINE_SHOTS],
      ['asks system', o.asksOptions.system, ASKS_SYSTEM], ['asks shots', o.asksOptions.shots, ASKS_SHOTS],
      ['asks template', o.asksOptions.userTurnTemplate, ASKS_USER_TURN_TEMPLATE],
      ['sibling system', o.siblingOptions.system, SIBLING_SYSTEM], ['sibling trained', o.siblingOptions.systemTrained, SIBLING_SYSTEM_TRAINED],
      ['sibling shots', o.siblingOptions.shots, SIBLING_SHOTS], ['focus system', o.focusOptions.system, FOCUS_SYSTEM],
      ['focus shots', o.focusOptions.shots, FOCUS_SHOTS],
      ['lexical', o.routerOptions.lexicalOptions, { threshold: 0.375, marginFloor: 0.12, k: new LexicalRouter(registry).k ?? 10, numberWeight: new LexicalRouter(registry).numberWeight }],
      ['turn', o.turnOptions, { fallbackOnEmpty: false }]
    ];
    const bad = want.filter(([, got, exp]) => !isDeepStrictEqual(got, exp)).map(([n]) => n);
    if (bad.length) return `differs: ${bad.join(', ')}`;
    for (const menu of ['- x', '- a: b, c\n- d: $& $1', '']) {
      if (o.routerOptions.promptedSystem(menu) !== CATEGORY_SYSTEM(menu)) return `promptedSystem(${JSON.stringify(menu)}) differs`;
    }
    return true;
  });

  check('patch options: checkTrainedSystem accepts the packed category line and refuses a tampered one', async () => {
    const { prompts } = await patchData();
    try { checkTrainedSystem(registry, prompts); } catch (e) { return `refused the real one: ${e.message}`; }
    for (const bad of [prompts.category.trained_system + ' ', prompts.category.trained_system.replace(/, /, ',')]) {
      let threw = null;
      try { checkTrainedSystem(registry, { ...prompts, category: { ...prompts.category, trained_system: bad } }); } catch (e) { threw = e; }
      if (!(threw instanceof Error) || !/trained_system/.test(threw.message)) return 'accepted a tampered trained_system';
    }
    return true;
  });

  check('each Lane A ask names its Pigeon, and the Pigeon\'s input is the user turn the server is sent (D84)', async () => {
    const { llmPlanner } = await import('../src/planner.js');
    const { declineCheck, asksCheck, ASKS_USER_TURN_TEMPLATE } = await import('../src/verify.js');
    const seen = [];
    const fake = (text) => async (req) => { seen.push(req); return { text, confidence: 1 }; };
    const cards = ['convertLength', 'convertSpeed'].map(n => registry.compactCard(n));
    const last = (r) => r.messages[r.messages.length - 1].content;
    const plan = llmPlanner({ complete: fake('{"steps":[]}'), registry, runway: 'auto' });
    const carry = { message: 'convert 5 miles to km', results: [{ id: 's1', skill: 'convertLength', ok: true, value: { result: 8.04672 } }] };
    for (const [routerConfident, c, id] of [[false, null, 'patch-planner'], [true, null, 'patch-planner-runway'], [false, carry, 'patch-planner-carry'], [true, carry, 'patch-planner-runway-carry']]) {
      seen.length = 0;
      await plan({ message: 'convert 5 miles to km', cards, ctx: FIXED_CTX, routerConfident, carry: c });
      const [r] = seen;
      if (r.pigeon?.id !== id) return `planner asked ${r.pigeon?.id}, wanted ${id}`;
      if (r.pigeon.input !== last(r)) return `${id}: the input is not the user turn`;
      if (!isDeepStrictEqual(r.pigeon.values, { 'steps[].skill': ['convertLength', 'convertSpeed'] })) return `${id}: values ${JSON.stringify(r.pigeon.values)}`;
    }
    seen.length = 0;
    await llmPlanner({ complete: fake('{"steps":[]}'), registry, ranked: true })({ message: 'x', cards, ctx: FIXED_CTX });
    if (seen[0].pigeon) return 'a prompt that is not a packed Pigeon named one anyway';
    seen.length = 0;
    await asksCheck({ complete: fake('YES') })('round 12.7');
    if (seen[0].pigeon?.id !== 'patch-asks' || ASKS_USER_TURN_TEMPLATE.split('{message}').join(seen[0].pigeon.input) !== last(seen[0])) return 'the asks check';
    seen.length = 0;
    await declineCheck({ complete: fake('{"asked_for":"x","skill":"none"}'), registry })({ message: 'how far is 5 miles', cards });
    if (seen[0].pigeon?.id !== 'patch-second-look' || seen[0].pigeon.input !== last(seen[0]) || !isDeepStrictEqual(seen[0].pigeon.values, { skill: ['convertLength', 'convertSpeed', 'none'] })) return 'the second look';
    seen.length = 0;
    await sentenceFocus({ complete: fake('{"looking_for":"x","sentence":1}') })({ message: 'capital of Mongolia', answer: 'Ulaanbaatar is the capital. It lies on the Tuul.' });
    if (seen[0].pigeon?.id !== 'patch-focus' || seen[0].pigeon.input !== last(seen[0]) || !isDeepStrictEqual(seen[0].pigeon.values, { sentence: [0, 1, 2] })) return 'the focus pass';
    seen.length = 0;
    await cleanupOcr({ raw: 'Tota| 7.75', complete: fake('Total 7.75') });
    if (seen[0].pigeon?.id !== 'ocr-tidy' || seen[0].pigeon.input !== last(seen[0])) return 'the OCR tidy';
    seen.length = 0;
    const router = categoryRouter({ registry, complete: fake('conversion'), trained: true, minConfidence: 0.8 });
    await router.route('convert 5 miles to km');
    if (seen[0].pigeon?.id !== 'patch-router' || seen[0].pigeon.input !== last(seen[0])) return 'the router';
    return true;
  });

  check('the second look is retired: the app builds none, Patch does not need it, and Rust will not ask it', async () => {
    const { PATCH_NEEDS } = await import('./export-pigeon-stage.mjs');
    if (PATCH_NEEDS.includes('patch-second-look') || PATCH_NEEDS.length !== 10) return `needs: ${PATCH_NEEDS.join(', ')}`;
    const st = assembleStack({ registry, complete: async () => ({ text: '' }), categoryComplete: null });
    if (st.secondLook !== null) return 'stack.js still builds a second look';
    const lib = readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');
    const lane = lib.slice(lib.indexOf('LANE_A_PIGEONS'), lib.indexOf('];', lib.indexOf('LANE_A_PIGEONS')));
    return !lane.includes('patch-second-look') || 'LANE_A_PIGEONS still lists patch-second-look';
  });

  check('Patch\'s details name the Pigeons in his nest in words (D84)', async () => {
    const { patchNestLine } = await import('../src/patch-pack.js');
    const { PATCH_NEEDS } = await import('./export-pigeon-stage.mjs');
    const line = patchNestLine(PATCH_NEEDS);
    const want = '10 · his planner, his router, the asks check, the focus pass, the transcript tidier, the OCR clean-up, Pen, Pen without figures, Peek, Peek without a picture';
    if (line !== want) return line;
    // A v6 nest, with its four prompted planners, still reads as one planner.
    const v6 = patchNestLine(['patch-router', 'patch-planner', 'patch-planner-runway', 'patch-planner-carry', 'patch-planner-runway-carry', 'pen']);
    return v6 === '6 · his planner (4 prompts), his router, Pen' || v6;
  });

  /* Patch v7: the trained planner is asked when his nest carries it, and only
     then; a v6 nest's four prompted planners are asked as before. */
  check('v7: the planner asks the trained Pigeon only when his nest carries it', async () => {
    const { llmPlanner, TRAINED_PLANNER } = await import('../src/planner.js');
    const { PATCH_NEEDS } = await import('./export-pigeon-stage.mjs');
    if (!PATCH_NEEDS.includes(TRAINED_PLANNER) || PATCH_NEEDS.some(id => /^patch-planner-(runway|carry)|^patch-planner$/.test(id))) return `needs: ${PATCH_NEEDS.join(', ')}`;
    const src = readFileSync(new URL('../src/patch-pack.js', import.meta.url), 'utf8');
    if (!src.includes(`const TRAINED_PLANNER = '${TRAINED_PLANNER}'`)) return 'patch-pack.js names another trained planner';
    const asked = [];
    const complete = async (req) => { asked.push(req.pigeon?.id); return { text: '{"about":"x","steps":[]}', ms: 1, tokens: 1 }; };
    const cards = [registry.compactCard('convertLength')];
    for (const pigeonId of [TRAINED_PLANNER, null]) {
      await llmPlanner({ complete, registry, runway: 'auto', pigeonId })({ message: '5 miles in km', cards, ctx: FIXED_CTX, routerConfident: true });
    }
    return (asked[0] === TRAINED_PLANNER && asked[1] === 'patch-planner-runway') || JSON.stringify(asked);
  });

  check('patch options: a v6 pack has no prompts, and every factory keeps the app\'s own (D84)', async () => {
    const { tunables } = await patchData();
    const full = optionsFrom(await patchData());
    for (const prompts of [undefined, {}]) {
      const o = optionsFrom({ prompts, tunables });
      for (const k of ['plannerOptions', 'declineOptions', 'asksOptions', 'siblingOptions', 'focusOptions']) {
        if (Object.keys(o[k]).length) return `${k} is not empty, so it would override a constant`;
      }
      if (!isDeepStrictEqual(o.routerOptions.lexicalOptions, full.routerOptions.lexicalOptions)) return 'the tunables were lost';
      if (!isDeepStrictEqual(o.turnOptions, full.turnOptions)) return 'the turn options were lost';
      try { checkTrainedSystem(registry, prompts); } catch (e) { return `checkTrainedSystem refused a pack with no prompts: ${e.message}`; }
    }
    return true;
  });

  check('patch nest: every id Patch v6 needs is a plain Pigeon id, listed once', async () => {
    const { PATCH_NEEDS, PATCH_VERSION } = await import('./export-pigeon-stage.mjs');
    if (PATCH_VERSION < 6) return 'needs arrived in v6';
    if (new Set(PATCH_NEEDS).size !== PATCH_NEEDS.length) return 'an id is listed twice';
    const plain = /^[A-Za-z0-9._ -]{1,128}$/;
    const bad = PATCH_NEEDS.filter(id => !plain.test(id) || id.startsWith('.'));
    return bad.length ? `not plain ids: ${bad.join(', ')}` : true;
  });

  const dropFns = (v) => {
    if (typeof v === 'function') return undefined;
    if (Array.isArray(v)) return v.map(dropFns);
    if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) {
      return Object.fromEntries(Object.entries(v).filter(([, x]) => typeof x !== 'function').map(([k, x]) => [k, dropFns(x)]));
    }
    return v;
  };
  const hasFn = (v) => typeof v === 'function' || (v && typeof v === 'object' && Object.values(v).some(hasFn));

  check('skill protocol: every entry stripped for the worker survives structuredClone and is the entry minus its functions', () => {
    const bad = [];
    for (const e of registry.all()) {
      const d = stripForWorker(e);
      let cloned;
      try { cloned = structuredClone(d); } catch (err) { bad.push(`${e.name}: ${err.message}`); continue; }
      if (hasFn(d)) bad.push(`${e.name}: a function survived`);
      else if (!isDeepStrictEqual(cloned, dropFns(e)) || !isDeepStrictEqual(d, dropFns(e))) bad.push(`${e.name}: data changed`);
    }
    if (!registry.all().some(e => (e.examples || []).some(x => x.ctx && hasFn(x.ctx)))) bad.push('no entry has a function in examples[].ctx — the nested case is untested');
    return bad.length ? bad.slice(0, 4).join(' | ') : true;
  });

  check('skill protocol: ctxForWorker drops search and every other function', () => {
    const ctx = { ...FIXED_CTX, search: async () => [], other: () => 1 };
    const got = ctxForWorker(ctx);
    return (isDeepStrictEqual(got, { ...FIXED_CTX }) && typeof ctx.search === 'function') || JSON.stringify(Object.keys(got));
  });

  check('skill protocol: a proxy registry routes, plans and lints exactly like the real one', async () => {
    const calls = [];
    const fakeCall = async (msg) => { calls.push(msg); return { ok: true, value: null }; };
    const proxy = buildRegistry(entries.map(e => proxyEntry(stripForWorker(e), fakeCall)));
    const names = (r) => r.routable().map(s => s.name);
    if (!isDeepStrictEqual(names(proxy), names(registry))) return 'routable names differ';
    if (!isDeepStrictEqual(proxy.categories(), registry.categories())) return 'categories differ';
    const cards = names(registry).filter(n => !isDeepStrictEqual(proxy.compactCard(n), registry.compactCard(n)));
    if (cards.length) return `${cards.length} cards differ, e.g. ${cards[0]}`;
    const lint = proxy.all().flatMap(lintEntry);
    if (lint.length) return `lint: ${lint.slice(0, 3).join(' | ')}`;
    const s = proxy.skill('countWords');
    const out = s.run({ text: 'a b' }, { ...FIXED_CTX, search: async () => [] });
    if (!(out instanceof Promise)) return 'a proxy run is not async';
    await out;
    return (isDeepStrictEqual(calls, [{ name: 'countWords', input: { text: 'a b' }, ctx: { ...FIXED_CTX } }])) || JSON.stringify(calls);
  });

  check('skill protocol: envelopes, and only a sealed pack path or / as a code base', () => {
    if (!isDeepStrictEqual(runRequest(3, 'sum', { values: [1] }, FIXED_CTX), { type: 'run', id: 3, name: 'sum', input: { values: [1] }, ctx: FIXED_CTX })) return 'runRequest';
    if (!isDeepStrictEqual(runReply(3, { ok: true }), { type: 'result', id: 3, result: { ok: true } })) return 'runReply';
    if (!isDeepStrictEqual(errorReply(3, 'boom'), { type: 'error', id: 3, message: 'boom' })) return 'errorReply';
    const good = ['pigeon-pack://localhost/v1-deadbeef/code/', 'pigeon-pack://localhost/v12-0123abcd/code/', '/'];
    const badBases = ['https://x/', 'pigeon-pack://localhost/../code/', 'pigeon-pack://localhost/v1-deadbeef/code',
      'pigeon-pack://evil/v1-deadbeef/code/', 'pigeon-pack://localhost/v1-DEADBEEF/code/', 'pigeon-pack://localhost/v1-deadbeef/code/../',
      '//', '', null, 'pigeon-pack://localhost/v1-deadbeef/code/\n'];
    const wrong = [...good.filter(b => !isValidCodeBase(b)), ...badBases.filter(b => isValidCodeBase(b))];
    return wrong.length ? `misjudged ${JSON.stringify(wrong)}` : true;
  });

  const fakeTimers = () => {
    const timers = new Map(); let n = 0;
    return {
      setTimer: (fn, ms) => { timers.set(++n, fn); return n; },
      clearTimer: (t) => { timers.delete(t); },
      fire: () => { for (const [t, fn] of [...timers]) { timers.delete(t); fn(); } },
      get count () { return timers.size; }
    };
  };
  const outcome = (p) => p.then(v => ({ ok: v }), e => ({ err: e.message }));

  check('skill caller: a reply settles the call with its id, and only that one', async () => {
    const sent = []; const t = fakeTimers();
    const c = createCaller({ post: (m) => sent.push(m), timeoutMs: 100, setTimer: t.setTimer, clearTimer: t.clearTimer });
    const a = outcome(c.call(runRequest(undefined, 'sum', {}, {})));
    const b = outcome(c.call(runRequest(undefined, 'max', {}, {})));
    if (sent.length !== 2 || sent[0].id === sent[1].id) return `ids ${JSON.stringify(sent.map(m => m.id))}`;
    if (c.receive(runReply(999, 'stray'))) return 'a reply for an unknown id was taken';
    c.receive(runReply(sent[1].id, 'second'));
    c.receive(errorReply(sent[0].id, 'first failed'));
    const [ra, rb] = await Promise.all([a, b]);
    return (isDeepStrictEqual(ra, { err: 'first failed' }) && isDeepStrictEqual(rb, { ok: 'second' }) && t.count === 0 && c.size === 0)
      || JSON.stringify({ ra, rb, timers: t.count });
  });

  check('skill caller: a timeout rejects, tells onTimeout, and a late reply is ignored', async () => {
    const sent = []; const t = fakeTimers(); const timedOut = [];
    const c = createCaller({ post: (m) => sent.push(m), timeoutMs: 100, onTimeout: (id) => timedOut.push(id), setTimer: t.setTimer, clearTimer: t.clearTimer });
    const a = outcome(c.call({ type: 'run', name: 'sum' }));
    t.fire();
    const ra = await a;
    if (!ra.err || !/timed out/.test(ra.err)) return `did not reject: ${JSON.stringify(ra)}`;
    if (!isDeepStrictEqual(timedOut, [sent[0].id])) return `onTimeout got ${JSON.stringify(timedOut)}`;
    return (c.receive(runReply(sent[0].id, 'late')) === false && c.size === 0) || 'a late reply was taken';
  });

  check('skill caller: rejectAll rejects every pending call', async () => {
    const t = fakeTimers();
    const c = createCaller({ post: () => {}, timeoutMs: 100, setTimer: t.setTimer, clearTimer: t.clearTimer });
    const ps = [1, 2, 3].map(() => outcome(c.call({ type: 'run' })));
    c.rejectAll('worker died');
    const rs = await Promise.all(ps);
    return (rs.every(r => r.err === 'worker died') && c.size === 0 && t.count === 0) || JSON.stringify(rs);
  });

  /* ── Patch in a locked room: src/skill-worker.js and src/patch-pack.js ── */
  check('locked room: the dev checkout is sent to the worker as the page root, absolute', () => {
    const got = [absoluteCodeBase('/', 'http://localhost:4173/index.html?x=1'), absoluteCodeBase('/', 'tauri://localhost/popover.html'),
      absoluteCodeBase('/', undefined), absoluteCodeBase('pigeon-pack://localhost/v1-deadbeef/code/', 'http://localhost:4173/')];
    const want = ['http://localhost:4173/', 'tauri://localhost/', '/', 'pigeon-pack://localhost/v1-deadbeef/code/'];
    if (!isDeepStrictEqual(got, want)) return JSON.stringify(got);
    return (got.every(isValidCodeBase) && !isValidCodeBase('http://example.com/') && !isValidCodeBase('http://localhost:4173/skills/')) || 'code base check';
  });

  check('locked room: every example of every built skill run through a worker_threads worker equals its direct run', async () => {
    let currentSearch = null;
    const room = await loadPatch({ codeBase: '/', makeWorker: nodeSkillWorker({ codeRoot: ROOT }), search: (q) => currentSearch(q) });
    if (room.state !== 'ready') return room.reason;
    const bad = []; let n = 0;
    try {
      if (!isDeepStrictEqual(room.entries, entries.map(stripForWorker))) bad.push("the worker's skill list is not stripForWorker of skills/index.js");
      if (room.info.source !== 'dev checkout' || !isDeepStrictEqual(room.options, {})) bad.push(`dev checkout info ${JSON.stringify(room.info)}`);
      for (const e of registry.routable()) {
        const proxy = room.registry.skill(e.name);
        for (const [i, ex] of (e.examples || []).entries()) {
          const ctx = { ...FIXED_CTX, ...(ex.ctx || {}) };
          const v = validate(e.inputSchema, ex.input);
          if (!v.ok) continue;
          currentSearch = ctx.search || null;
          const direct = await e.run(mergeInput(v.value, ctx), ctx);
          const via = await proxy.run(mergeInput(v.value, ctx), ctx);
          n++;
          let cloned;
          try { cloned = structuredClone(direct); } catch (err) { bad.push(`${e.name}[${i}] does not survive structuredClone: ${err.message}`); continue; }
          if (e.nondeterministic) {
            if (!via || via.ok !== direct.ok || (via.ok && e.verify(via.value, v.value) !== true)) bad.push(`${e.name}[${i}] fails its own verify through the worker`);
          } else if (!isDeepStrictEqual(via, direct) || !isDeepStrictEqual(cloned, direct)) {
            bad.push(`${e.name}[${i}]: ${JSON.stringify(via).slice(0, 120)} vs ${JSON.stringify(direct).slice(0, 120)}`);
          }
        }
      }
    } finally { room.close(); }
    if (n < 1000) bad.push(`only ${n} examples ran`);
    return bad.length ? bad.slice(0, 4).join('\n    ') : true;
  });

  check('locked room: the worker takes one init, refuses a name it does not hold and a code base it may not load, and is locked', async () => {
    const tmp = fsSeal.mkdtempSync(`${osSeal.tmpdir()}/pigeon-room-`);
    fsSeal.mkdirSync(`${tmp}/skills`);
    fsSeal.writeFileSync(`${tmp}/skills/index.js`, `export default [{ name: 'probe', run: async () => {
      const out = {};
      for (const n of ['fetch', 'WebSocket', 'XMLHttpRequest', 'importScripts', 'eval', 'postMessage', 'BroadcastChannel']) {
        try { globalThis[n]('x'); out[n] = 'ran'; } catch (e) { out[n] = /not available/.test(e.message) ? 'blocked' : e.message; }
      }
      try { globalThis.fetch = () => 'mine'; } catch { /* frozen */ }
      out.after = (() => { try { return globalThis.fetch('x'); } catch (e) { return 'blocked'; } })();
      try { globalThis.leak = 1; } catch { /* frozen */ }
      out.added = typeof globalThis.leak;
      out.frozen = Object.isFrozen(globalThis);
      return { ok: true, value: out };
    } }];\n`);
    const talk = (w) => {
      const got = [];
      w.onmessage = ({ data }) => got.push(data);
      const until = async (pred) => {
        for (let t = 0; t < 2000 && !got.some(pred); t++) await new Promise(r => setTimeout(r, 5));
        return got.find(pred);
      };
      return { got, until };
    };
    const a = nodeSkillWorker({ codeRoot: ROOT })();
    const b = nodeSkillWorker({ codeRoot: ROOT })();
    const c = nodeSkillWorker({ codeRoot: tmp })();
    try {
      const ta = talk(a); const tb = talk(b); const tc = talk(c);
      a.postMessage({ t: 'init', codeBase: '/' });
      a.postMessage({ t: 'init', codeBase: 'pigeon-pack://localhost/v1-deadbeef/code/' });
      a.postMessage({ t: 'run', id: 1, name: 'noSuchSkill', input: {}, ctx: {} });
      a.postMessage({ t: 'run', id: 2, name: 'constructor', input: {}, ctx: {} });
      a.postMessage({ t: 'run', id: 3, name: 'countWords', input: { text: 'a b' }, ctx: FIXED_CTX });
      a.postMessage({ t: 'init', codeBase: '/' });
      b.postMessage({ t: 'init', codeBase: 'https://example.com/' });
      c.postMessage({ t: 'init', codeBase: '/' });
      c.postMessage({ t: 'run', id: 9, name: 'probe', input: {}, ctx: {} });
      await ta.until(m => m.id === 3); await tb.until(m => m.t === 'failed'); await tc.until(m => m.id === 9);
      await new Promise(r => setTimeout(r, 50));
      if (ta.got.filter(m => m.t === 'ready' || m.t === 'failed').length !== 1) return `a second init was not ignored: ${JSON.stringify(ta.got.map(m => m.t || m.type))}`;
      if (!isDeepStrictEqual(ta.got.find(m => m.id === 1), errorReply(1, 'no such skill: noSuchSkill'))) return `unknown name: ${JSON.stringify(ta.got.find(m => m.id === 1))}`;
      if (!isDeepStrictEqual(ta.got.find(m => m.id === 2), errorReply(2, 'no such skill: constructor'))) return 'a prototype name was treated as a skill';
      const want = runReply(3, registry.skill('countWords').run({ text: 'a b' }, FIXED_CTX));
      if (!isDeepStrictEqual(ta.got.find(m => m.id === 3), want)) return `a real run: ${JSON.stringify(ta.got.find(m => m.id === 3))}`;
      if (tb.got.some(m => m.t === 'ready')) return 'a worker loaded from a code base it may not use';
      const probe = tc.got.find(m => m.id === 9);
      const locked = { fetch: 'blocked', WebSocket: 'blocked', XMLHttpRequest: 'blocked', importScripts: 'blocked', eval: 'blocked', postMessage: 'blocked', BroadcastChannel: 'blocked', after: 'blocked', added: 'undefined', frozen: true };
      return isDeepStrictEqual(probe && probe.result && probe.result.value, locked) || `the room is not locked: ${JSON.stringify(probe)}`;
    } finally {
      a.terminate(); b.terminate(); c.terminate();
      fsSeal.rmSync(tmp, { recursive: true, force: true });
    }
  });

  /* A worker that speaks the protocol and nothing else, for the rules patch-pack owns. */
  const fakeRoom = (onRun) => {
    const spawned = [];
    const makeWorker = async () => {
      const w = {
        onmessage: null, onerror: null, terminated: false, got: [],
        send (data) { if (!w.terminated && w.onmessage) w.onmessage({ data }); },
        terminate () { w.terminated = true; },
        postMessage (m) {
          w.got.push(m);
          Promise.resolve().then(() => {
            if (w.terminated) return;
            if (m.t === 'init') w.send({ t: 'ready', entries: ['countWords', 'webAnswer'].map(nm => stripForWorker(registry.skill(nm))) });
            else if (m.t === 'run') onRun(w, m);
            else if (m.t === 'searchReply') w.send(runReply(m.id, { searchReply: m }));
          });
        }
      };
      spawned.push(w);
      return w;
    };
    return { spawned, makeWorker };
  };

  check('locked room: a hung skill times out, its worker is killed and replaced, waiting calls are rejected, the next call runs', async () => {
    const f = fakeRoom((w, m) => { if (m.input.text !== 'hang' && m.input.text !== 'wait') w.send(runReply(m.id, { ok: true, value: { words: 2 }, provenance: { kind: 'computed', source: null, dataAsOf: null } })); });
    const room = await loadPatch({ codeBase: '/', makeWorker: f.makeWorker, timeoutMs: 60 });
    if (room.state !== 'ready') return room.reason;
    try {
      const skill = room.registry.skill('countWords');
      const hung = runPlan({ steps: [{ id: 's1', skill: 'countWords', input: { text: 'hang' } }] }, { registry: room.registry, ctx: FIXED_CTX, message: 'count the words in hang' });
      await new Promise(r => setTimeout(r, 15));
      const waiting = outcome(skill.run({ text: 'wait' }, FIXED_CTX));
      const run = await hung;
      const w = await waiting;
      if (!run.results[0] || run.results[0].ok || run.results[0].error.code !== 'TIMEOUT') return `the hung step ended ${JSON.stringify(run.results[0])}`;
      if (!w.err || !/restarted/.test(w.err)) return `the waiting call was not rejected by the restart: ${JSON.stringify(w)}`;
      if (f.spawned.length !== 1 || !f.spawned[0].terminated) return `the hung worker was not terminated (${f.spawned.length} spawned)`;
      const next = await skill.run({ text: 'a b' }, FIXED_CTX);
      if (f.spawned.length !== 2 || f.spawned[1].got[0].t !== 'init' || f.spawned[1].got[0].codeBase !== '/') return 'no fresh worker was started and initialised';
      return (next.ok && next.value.words === 2) || JSON.stringify(next);
    } finally { room.close(); }
  });

  check('locked room: a search is answered only for a network skill, in a run with the web on', async () => {
    const asked = [];
    const f = fakeRoom((w, m) => w.send({ t: 'search', id: m.id, sid: 7, query: 'capital of Mongolia' }));
    const room = await loadPatch({ codeBase: '/', makeWorker: f.makeWorker, search: async (q) => { asked.push(q); return { answer: 'Ulaanbaatar' }; } });
    if (room.state !== 'ready') return room.reason;
    try {
      const web = await room.registry.skill('webAnswer').run({ question: 'x' }, { ...FIXED_CTX, webEnabled: true, search: async () => null });
      const webOff = await room.registry.skill('webAnswer').run({ question: 'x' }, { ...FIXED_CTX, webEnabled: false });
      const notNetwork = await room.registry.skill('countWords').run({ text: 'x' }, { ...FIXED_CTX, webEnabled: true });
      const ok = web.searchReply.result && web.searchReply.result.answer === 'Ulaanbaatar' && web.searchReply.sid === 7
        && typeof webOff.searchReply.error === 'string' && typeof notNetwork.searchReply.error === 'string' && isDeepStrictEqual(asked, ['capital of Mongolia']);
      return ok || JSON.stringify({ web, webOff, notNetwork, asked });
    } finally { room.close(); }
  });

  check('locked room: a pack whose skills will not load leaves Patch unavailable with the reason', async () => {
    const failing = async () => {
      const w = { onmessage: null, onerror: null, terminated: false, terminate () { w.terminated = true; },
        postMessage (m) { if (m.t === 'init') Promise.resolve().then(() => w.onmessage({ data: { t: 'failed', reason: 'the skills did not load — boom' } })); } };
      return w;
    };
    const a = await loadPatch({ codeBase: '/', makeWorker: failing });
    const b = await loadPatch({ codeBase: 'https://example.com/', makeWorker: failing });
    const c = await loadPatch({ codeBase: '/', makeWorker: async () => { throw new Error('no Worker here'); } });
    return (a.state === 'unavailable' && /boom/.test(a.reason) && b.state === 'unavailable' && c.state === 'unavailable' && /no Worker here/.test(c.reason))
      || JSON.stringify({ a, b, c });
  });

  check('extractor: skills whose run is async give exactly the patches their sync runs give', async () => {
    const asyncEntries = entries.map(e => (typeof e.run === 'function' ? { ...e, run: async (...a) => e.run(...a) } : e));
    const asyncRegistry = buildRegistry(asyncEntries);
    const syncEx = jsExtractor(registry); const asyncEx = jsExtractor(asyncRegistry);
    const lex = new LexicalRouter(registry);
    const cases = [
      ['count the words in this sentence please', 'countWords', {}], ['tidy this json so it is readable', 'formatJson', {}],
      ['tidy this json: {"b":1,"a":2}', 'formatJson', {}], ['litres in a cylinder 30cm across and 50 tall', 'volumeOf', { solid: 'cylinder', height: 50 }, 'radius'],
      ['smooth this over a 5 point window', 'movingAverage', { window: 5 }, null, ['values']],
      ['how many days between 12 july 2026 and christmas', 'daysBetween', {}], ['what does GBP stand for', 'currencyInfo', {}],
      ['what is the capital of Switzerland', 'countryLookup', { query: 'what is the capital of Switzerland' }],
      ...HOLDOUT_MESSAGES.map(m => [m, (lex.route(m, {}).candidates[0] || {}).name, {}])
    ].filter(([, skill]) => skill && registry.skill(skill) && !registry.skill(skill).unbuilt && !registry.skill(skill).needsNetwork);
    const bad = []; let probed = 0;
    for (const [message, skill, input, needField = null, untraceable = []] of cases) {
      const args = (reg) => ({ message, skill: reg.skill(skill), input, ctx: FIXED_CTX, needField, untraceable });
      const a = await syncEx(args(registry)); const b = await asyncEx(args(asyncRegistry));
      if (!isDeepStrictEqual(a, b)) bad.push(`${skill} "${message.slice(0, 40)}": ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
      if (Object.keys(a).length) probed++;
    }
    if (cases.length < 100 || probed < 20) return `only ${cases.length} cases, ${probed} with a patch`;
    /* A run that throws, and one that rejects, is a probe that failed: skipped. */
    const text = { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] };
    const failing = (run) => ({ name: 'boom', inputSchema: text, run });
    const thrown = await syncEx({ message: 'say "hello there"', skill: failing(() => { throw new Error('x'); }), input: {}, ctx: FIXED_CTX, needField: 'text' });
    const rejected = await syncEx({ message: 'say "hello there"', skill: failing(async () => { throw new Error('x'); }), input: {}, ctx: FIXED_CTX, needField: 'text' });
    if (!isDeepStrictEqual(thrown, rejected)) bad.push(`throw ${JSON.stringify(thrown)} vs reject ${JSON.stringify(rejected)}`);
    const runs = await runPlan({ steps: [{ id: 's1', skill: 'volumeOf', input: { solid: 'cylinder', side: 30, height: 50 } }] }, { registry: asyncRegistry, ctx: FIXED_CTX, message: 'litres in a cylinder 30cm across and 50 tall', extractor: asyncEx });
    const runsSync = await runPlan({ steps: [{ id: 's1', skill: 'volumeOf', input: { solid: 'cylinder', side: 30, height: 50 } }] }, { registry, ctx: FIXED_CTX, message: 'litres in a cylinder 30cm across and 50 tall', extractor: syncEx });
    const timeless = (v) => JSON.parse(JSON.stringify(v, (k, x) => (/^(ms|at|stages|.*Ms|.*At)$/.test(k) ? undefined : x)));
    if (!isDeepStrictEqual(timeless(runs), timeless(runsSync))) bad.push('runPlan with async runs differs');
    return bad.length ? bad.slice(0, 3).join('\n    ') : true;
  });

  check('benchdiff compares row by row, ignores latency, and refuses runs that are not the same questions', () => {
    const row = (message, outcome, got = null, ms = 1) => ({ message, want: 'x', outcome, got, ms });
    const rec = (rows, tally = { answered: 1 }) => ({ holdout: 2, noSkill: 0, configs: { 'llm+ex': { tally, outcomes: rows } } });
    const a = rec([row('one', 'answered', 'x'), row('two', 'declined')]);
    const slower = rec([row('one', 'answered', 'x', 900), row('two', 'declined', null, 5)]);
    const moved = rec([row('one', 'answered', 'x'), row('two', 'wrong-skill', 'y')]);
    const reordered = rec([row('two', 'declined'), row('one', 'answered', 'x')]);
    if (diffRecords(a, slower).rows.length) return 'latency counted as a difference';
    if (diffRecords({ record: a }, moved).rows.length !== 1) return 'a moved row was not found (or the wrapper was not unwrapped)';
    if (diffRecords(a, reordered).comparable) return 'runs in a different order were compared';
    return diffRecords(a, rec(a.configs['llm+ex'].outcomes, { answered: 2 })).tallies.length === 1 || 'a tally difference was missed';
  });

  check('an unavailable Patch does not take Chat down: the browser finds Chat from the category server, not from Patch\'s router', () => {
    const src = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
    const start = src.indexOf('async function detectModel');
    const branch = src.slice(start, src.indexOf("engine.onStatus(applyEngineStatus)", start));
    if (/if \(categoryModel\) await detectChat\(\)/.test(branch) || /if \(categoryModel && !chat\) await detectChat\(\)/.test(branch)) return 'Chat is still gated on the category router';
    if (!/categoryServerUp\(\)\) await detectChat\(\)/.test(branch)) return 'the browser branch does not probe the category server for Chat';
    return /const categoryServerUp = async \(\) => Boolean\(await detectLlm\(\{ base: CATEGORY_BASE, role: 'category' \}\)/.test(src) || 'categoryServerUp is not the category-server probe';
  });

  check('patchSource: Rust\'s sealed pack under Tauri with no checkout fallback, the checkout in a browser', async () => {
    const noSleep = async () => {};
    const dev = await patchSource({ invoke: undefined });
    if (dev.codeBase !== '/' || dev.devAllowed !== true || dev.pack !== null) return `browser: ${JSON.stringify(dev)}`;
    const ready = { state: 'ready', code_base: 'pigeon-pack://localhost/v1-7b9b49a4/code/', prompts: { planner: {} }, tunables: { router: {} }, version: 1, source: 'bundled' };
    const got = await patchSource({ invoke: async () => ready, sleep: noSleep });
    if (got.codeBase !== ready.code_base || got.devAllowed !== false || got.pack.version !== 1 || got.pack.source !== 'bundled') return `ready: ${JSON.stringify(got)}`;
    let calls = 0;
    const later = await patchSource({ invoke: async () => (++calls < 3 ? { state: 'loading' } : ready), sleep: noSleep, pollMs: 1 });
    if (calls !== 3 || later.codeBase !== ready.code_base) return `loading was not waited out (${calls})`;
    const refuses = async (invoke, want, opts = {}) => {
      try { await patchSource({ invoke, sleep: noSleep, ...opts }); return `resolved for ${want}`; } catch (e) { return String(e.message).includes(want) ? null : `wrong reason: ${e.message}`; }
    };
    const why = (await refuses(async () => ({ state: 'unavailable', reason: 'sealed by a key this app does not trust' }), 'does not trust'))
      ?? (await refuses(async () => ({ state: 'ready', code_base: 'tauri://localhost/' }), 'no sealed pack'))
      ?? (await refuses(async () => ({ state: 'loading' }), 'still being unpacked', { pollMs: 10, waitMs: 20 }));
    if (why) return why;
    const locked = await loadPatch({ codeBase: '/', devAllowed: false, makeWorker: () => { throw new Error('must not start'); } });
    if (locked.state !== 'unavailable') return 'the checkout was loaded where only a sealed pack is allowed';
    const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
    const pop = readFileSync(new URL('../src/popover.js', import.meta.url), 'utf8');
    if (!/codeBase, pack, devAllowed \} = await patchSource\(\)/.test(app) || !/codeBase, pack, devAllowed \} = await patchSource\(\)/.test(pop)) return 'a window does not take its source from patchSource';
    return /o\.status === 'upgraded'/.test(app) && /restart Pigeon to use it/.test(app) || 'an upgraded import is not described';
  });

  check('a version 1 pack, which has no number_weight or turn tunables, leaves the constants in charge', async () => {
    const { prompts, tunables } = await patchData();
    const { number_weight: _nw, ...router } = tunables.router;
    const o = optionsFrom({ prompts, tunables: { ...tunables, router, turn: undefined } });
    if ('numberWeight' in o.routerOptions.lexicalOptions || Object.keys(o.turnOptions).length) return 'absent tunables were passed as undefined';
    const src = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
    const calls = src.match(/runTurn\([^{]*\{/g) || [];
    const spread = src.match(/runTurn\([^{]*\{\s*\.\.\.packOptions\.turnOptions/g) || [];
    if (calls.length !== spread.length) return `${calls.length - spread.length} runTurn call(s) in app.js ignore the pack's turn tunables`;
    return !/new LexicalRouter\(registry\)/.test(src) || 'app.js builds a word router without the pack\'s numbers';
  });

  check('the bundled Patch is this checkout — a skill, prompt, tunable or shared module changed since pack/patch.pigeon was made fails here', async () => {
    const { packDrift } = await import('./lib/release-check.mjs');
    const drift = await packDrift(fileURLToPath(new URL('..', import.meta.url)));
    if (drift === null) return true; /* a fresh clone has no pack; release-check refuses that on its own */
    return drift.length === 0 || `commit, then \`npm run pack:patch\` — ${drift.length} difference(s): ${drift.slice(0, 6).join('; ')}`;
  });

  /* Task 2 (HANDOFF-PIGEON-ENGINE-3): Patch's nest takes only Pigeons sealed
     by a key this app trusts, and the release check says so of a nest that
     has one that is not. */
  check('Patch’s nest refuses a member not sealed by a trusted key', async () => {
    const { buildNest } = await import('./pack-patch.mjs');
    const { PATCH_NEEDS } = await import('./export-pigeon-stage.mjs');
    const { readNest, releaseProblems } = await import('./lib/release-check.mjs');
    const { storeZip } = await import('./lib/zip-store.mjs');
    const seed = Buffer.from('9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60', 'hex');
    const pub = 'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a';
    const trusted = [{ id: sealKeyId(Buffer.from(pub, 'hex')), ed25519_pub_hex: pub, revoked: false }];
    const member = (id) => [['pigeon.json', JSON.stringify({ format_version: 1, id, name: id, kind: 'freeform', base_only: true })]];
    const root = fsSeal.mkdtempSync(`${osSeal.tmpdir()}/pigeon-nest-seal-`);
    const dir = `${root}/pigeons`;
    try {
      fsSeal.mkdirSync(`${root}/pack`); fsSeal.mkdirSync(dir);
      fsSeal.writeFileSync(`${root}/pack/patch.pigeon`, sealZip([['pigeon.json', JSON.stringify({ format_version: 1, id: 'patch', kind: 'skillpack' })]], seed));
      for (const id of PATCH_NEEDS) fsSeal.writeFileSync(`${dir}/${id}.pigeon`, sealZip(member(id), seed));
      const built = await buildNest(root, dir, trusted);
      if (built.members !== PATCH_NEEDS.length + 1) return `built ${built.members} members`;
      const read = await readNest(root, trusted);
      if (read.unsealed.length || read.ids.length !== PATCH_NEEDS.length) return `read back: ${JSON.stringify(read)}`;
      // One member packed without a seal: the nest is not built.
      fsSeal.writeFileSync(`${dir}/tidier.pigeon`, storeZip(member('tidier')));
      try { await buildNest(root, dir, trusted); return 'an unsealed tidier went into the nest'; } catch (e) {
        if (!/tidier\.pigeon is not sealed by a key this app trusts/.test(e.message)) return e.message;
      }
      // Sealed by a key this app does not trust: refused the same way.
      fsSeal.writeFileSync(`${dir}/tidier.pigeon`, sealZip(member('tidier'), Buffer.alloc(32, 7)));
      try { await buildNest(root, dir, trusted); return 'a tidier sealed by an untrusted key went into the nest'; } catch (e) {
        if (!/not sealed by a key this app trusts/.test(e.message)) return e.message;
      }
      // A nest made some other way with an unsealed member fails the release check.
      const nest = await readNest(root, []);
      const problems = releaseProblems({ pack: { kind: 'skillpack', sealed: true, head: 'abcdef1', needs: PATCH_NEEDS, sha256: nest.packSha256, codeHashes: {} }, sameCode: true, nest });
      return problems.some(p => /"pen" is not sealed by a key this app trusts/.test(p)) || problems.join('; ');
    } finally {
      fsSeal.rmSync(root, { recursive: true, force: true });
    }
  });

  /* Round 3: a value the planner works out is checked by working it out
     (scripts/lib/derive.mjs). Today is Tuesday 2026-09-01, as in every row. */
  check('derivations: seven rules, each worked out against the frozen today', async () => {
    const { checkDerivation } = await import('./lib/derive.mjs');
    const today = '2026-09-01T09:00:00Z';
    const ok = (rule, from, value, extra = {}) => checkDerivation({ rule, from, value, today, ...extra }) === null;
    const pass = [
      ['date', 'christmas', '2026-12-25'], ['date', 'end of the month', '2026-09-30'], ['date', 'next tuesday', '2026-09-08'],
      ['date', 'this tuesday', '2026-09-01'], ['date', 'friday', '2026-09-04'], ['date', 'tomorrow', '2026-09-02'],
      ['date', 'in 3 weeks', '2026-09-22'], ['date', 'ten days ago', '2026-08-22'], ['date', "new year's day", '2027-01-01'],
      ['date', 'a fortnight from today', '2026-09-15'], ['date', 'last friday', '2026-08-28'], ['date', 'end of the year', '2026-12-31'],
      ['days', 'end of the month', 30], ['days', 'tomorrow', 2],
      ['fraction', 'a fifth', 0.2], ['fraction', '3 out of 8', 0.375], ['fraction', '15 percent', 0.15], ['fraction', 'one in 4', 0.25],
      ['quantity', 'half marathon', 21.0975], ['quantity', 'a couple', 2], ['quantity', 'half a dozen', 6],
      ['arithmetic', '340 divided by 8 plus 12', '340 / 8 + 12'], ['arithmetic', '7 times 6 minus 2', '7*6-2'], ['arithmetic', '12 squared', '12^2'],
      ['dice', 'a couple of dice', '2d6'], ['dice', 'three d20s', '3d20'], ['dice', 'a die', '1d6'], ['dice', '2 10-sided dice', '2d10']
    ];
    for (const [rule, from, value] of pass) if (!ok(rule, from, value)) return `${rule} "${from}" → ${JSON.stringify(value)} refused: ${checkDerivation({ rule, from, value, today })}`;
    const fail = [
      ['date', 'christmas', '2026-12-26'], ['date', 'some time soon', '2026-09-10'], ['days', 'end of the month', 29],
      ['fraction', 'a fifth', 0.5], ['fraction', 'most of the time', 0.8], ['quantity', 'half marathon', 13],
      ['arithmetic', '340 divided by 8 plus 12', '340 divided by 8 plus 12'], ['arithmetic', 'the sum of these', '1+2'], ['dice', 'a couple of dice', '2d20']
    ];
    for (const [rule, from, value] of fail) if (ok(rule, from, value)) return `${rule} "${from}" → ${JSON.stringify(value)} passed`;
    const enumValues = ['ascending', 'descending'];
    if (!ok('enum', 'in descending order', 'descending', { enumValues })) return 'enum by its own word';
    if (ok('enum', 'biggest first', 'descending', { enumValues })) return 'enum without a reviewed synonym';
    if (!ok('enum', 'biggest first', 'descending', { enumValues, synonyms: { 'biggest first': 'descending' } })) return 'enum with a reviewed synonym';
    if (ok('enum', 'biggest first', 'sideways', { enumValues, synonyms: { 'biggest first': 'sideways' } })) return 'a value outside the enum';
    /* Whole words only, and a blank value only by synonym. */
    const freq = ['annually', 'semi-annually', 'monthly'];
    if (ok('enum', 'compounded semi-annually', 'annually', { enumValues: freq })) return '"annually" matched inside "semi-annually"';
    if (!ok('enum', 'compounded semi-annually', 'semi-annually', { enumValues: freq })) return 'semi-annually by its own word';
    if (!ok('enum', 'the maximum', 'max', { enumValues: ['min', 'max'] }) || !ok('enum', 'left-aligned', 'left', { enumValues: ['left', 'right'] })) return 'a word the value starts';
    if (ok('enum', 'with no gaps', '', { enumValues: ['', ' ', ':'] })) return 'a blank separator matched any phrase';
    if (!ok('enum', '$', '$', { enumValues: ['£', '$'] }) || ok('enum', '; between fields', ';', { enumValues: [',', ';'] })) return 'a one-character value is its own phrase exactly, else a synonym';
    return ok('enum', 'no separators', '', { enumValues: ['', ' ', ':'], synonyms: { 'no separators': '' } }) || 'a blank separator by its synonym';
  });

  check('a release is refused unless its Patch is this checkout, sealed, with the same shared modules', async () => {
    const { hostApiFor } = await import('./host-api.mjs');
    const { releaseProblems } = await import('./lib/release-check.mjs');
    const { map, mainClosure } = await hostApiFor(fileURLToPath(new URL('..', import.meta.url)));
    const keys = Object.keys(map);
    if (!keys.includes('src/contracts.js') || keys.some(k => !k.startsWith('src/'))) return `host API: ${keys.join(', ')}`;
    if (mainClosure.some(p => p.startsWith('skills/'))) return 'the windows still import skills/';
    const codeHashes = Object.fromEntries(Object.entries(map).map(([p, h]) => [`code/${p}`, h]));
    const good = { kind: 'skillpack', sealed: true, head: 'abcdef1', version: 1, codeHashes };
    const ok = releaseProblems({ pack: good, sameCode: true, hostApi: map, mainClosure });
    if (ok.length) return `a good pack was refused: ${ok.join('; ')}`;
    const cases = [
      [{ pack: null, sameCode: true, hostApi: map, mainClosure }, 'missing'],
      [{ pack: { error: 'zip refused: gap' }, sameCode: true, hostApi: map, mainClosure }, 'cannot be used'],
      [{ pack: { ...good, sealed: false }, sameCode: true, hostApi: map, mainClosure }, 'not a sealed skill pack'],
      [{ pack: good, sameCode: false, hostApi: map, mainClosure }, 'differ from abcdef1'],
      [{ pack: { ...good, codeHashes: { ...codeHashes, 'code/src/contracts.js': '0'.repeat(64) } }, sameCode: true, hostApi: map, mainClosure }, 'src/contracts.js'],
      [{ pack: good, sameCode: true, hostApi: map, mainClosure: [...mainClosure, 'skills/add-duration.js'] }, 'imports skills/']
    ];
    for (const [input, want] of cases) {
      const got = releaseProblems(input);
      if (!got.some(p => p.includes(want))) return `expected "${want}", got ${JSON.stringify(got)}`;
    }
    const bundle = readFileSync(new URL('./bundle.mjs', import.meta.url), 'utf8');
    const ship = (bundle.match(/export const SHIP = \[([^\]]*)\]/) || [])[1] || '';
    if (!ship || /'skills'/.test(ship)) return `bundle ships: ${ship}`;
    const conf = JSON.parse(readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
    const release = JSON.parse(readFileSync(new URL('../src-tauri/tauri.release.conf.json', import.meta.url), 'utf8'));
    if (Object.keys(conf.bundle.resources).some(k => k.includes('pigeon-category'))) return 'the base config still bundles the loose category adapter';
    if (release.bundle.resources['../pack/patch.nest'] !== 'patch.nest' || release.bundle.resources['../pack/host-api.json'] !== 'host-api.json') return 'the release config does not bundle the nest';
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    return (/--config src-tauri\/tauri\.release\.conf\.json/.test(pkg.scripts.build) && pkg.scripts['pack:patch'] === 'node scripts/pack-patch.mjs') || 'package.json scripts';
  });

  check('imported Pigeons are listed from disk whether or not the models are awake, and an import restarts the models itself', () => {
    const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
    const pop = readFileSync(new URL('../src/popover.js', import.meta.url), 'utf8');
    const side = readFileSync(new URL('../src/ui/sidebar.js', import.meta.url), 'utf8');
    const fn = (src, name) => { const i = src.indexOf(name); return i < 0 ? '' : src.slice(i, src.indexOf('\n}\n', i) + 3); };
    const refresh = fn(app, 'async function refreshPersonas');
    if (!/call\('personas_list'\)/.test(refresh) || /^\s*if \(!chat\) return;/m.test(refresh)) return 'refreshPersonas still depends on the chat server';
    if (/chat = null; personas = \[\];/.test(app)) return 'the list is still emptied when the models sleep';
    const report = fn(app, 'async function reportPigeonOutcomes');
    if (!/restartForPigeonChange\(\)/.test(report)) return 'an import does not restart the models';
    const restart = fn(app, 'function restartForPigeonChange');
    if (!/inflight/.test(restart) || !/engine\.sleep\(\)/.test(restart) || !(/engine\.wake\(\)/.test(restart) || /wakeCategory\(engine/.test(restart)) || !/refreshPersonas\(\)/.test(restart)) return 'the automatic restart does not wait for replies, restart, and relist';
    if (!/refreshPersonas\(\)\.catch/.test(app)) return 'the window does not list installed Pigeons at boot';
    if (!/listInstalled\('personas_list'\)/.test(pop)) return 'the popover does not list installed Pigeons from disk';
    if (/restart the models to (talk to|wear|load) it/.test(app + side)) return 'a message still tells the person to restart the models';
    return true;
  });

  check('removing a Pigeon is confirmed, calls pigeon_remove, restarts if it was loaded, and is never offered for Patch or the base model', () => {
    const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
    const details = readFileSync(new URL('../src/ui/details.js', import.meta.url), 'utf8');
    const fn = (src, name) => { const i = src.indexOf(name); return i < 0 ? '' : src.slice(i, src.indexOf('\n}\n', i) + 3); };
    const ask = fn(app, 'function askRemovePigeon');
    if (!/sheet-title/.test(ask) || !/data-close/.test(ask)) return 'removing a Pigeon skips the are-you-sure sheet';
    const remove = fn(app, 'async function removePigeon');
    if (!/call\('pigeon_remove'/.test(remove)) return 'removePigeon does not call the Rust command';
    if (!/restartForPigeonChange\(/.test(remove)) return 'a removal of a loaded Pigeon does not offer to restart the models';
    const profile = fn(details, 'export function profileHtml');
    if (!/removable\s*=\s*d\.kind === 'voice' \|\| d\.kind === 'job'/.test(profile)) return 'the remove button is not restricted to an actual imported persona';
    return true;
  });

  check('wakeCategory wakes, waits for the bridge, and stops at once on a phase that can never be ready', async () => {
    const run = async ({ phases = [], wake = async () => ({}), up = false, disabled = false, engine = true, limit = 60_000 }) => {
      let bridge = up; let status = null; let clock = 0; let slept = 0; let woke = 0;
      const seq = [...phases];
      const eng = engine ? { wake: async () => { woke++; return wake(); } } : null;
      const out = await wakeCategory(eng, {
        isUp: () => bridge,
        apply: async (s) => { status = { disabled, ...s }; },
        current: () => {
          const phase = seq.length ? seq.shift() : status?.category?.phase;
          if (phase === 'ready') bridge = true;
          return { ...status, category: { ...(status?.category || {}), phase } };
        },
        timeoutMs: limit, every: 300, now: () => clock,
        sleep: async (ms) => { slept++; clock += ms; }
      });
      return { out, slept, woke };
    };
    const already = await run({ up: true });
    if (already.out !== null || already.woke) return 'an awake lane was woken again';
    const noEngine = await run({ engine: false });
    if (!/no engine/.test(noEngine.out || '')) return 'a browser build with no engine did not say so';
    const rejected = await run({ wake: async () => { throw new Error('boom'); } });
    if (!/could not be woken — boom/.test(rejected.out || '')) return 'a failed wake call did not surface its reason';
    const comes = await run({ wake: async () => ({ category: { phase: 'waking' } }), phases: ['waking', 'waking', 'ready'] });
    if (comes.out !== null || comes.woke !== 1) return `a lane that came up was reported as ${comes.out}`;
    const adopted = await run({ wake: async () => ({ category: { phase: 'error', owned: false, port: 8101, detail: 'x' } }) });
    if (!/port 8101/.test(adopted.out || '') || adopted.slept) return 'an adopted server in error was waited on instead of reported with its port';
    const missing = await run({ wake: async () => ({ category: { phase: 'missing', owned: true, detail: 'no weights on this machine yet' } }) });
    if (!/no weights on this machine yet/.test(missing.out || '') || missing.slept) return 'a missing-weights lane was waited on instead of reported';
    const off = await run({ disabled: true, wake: async () => ({ category: { phase: 'asleep' } }) });
    if (!/switched off/.test(off.out || '')) return 'a disabled engine was waited on';
    const slow = await run({ wake: async () => ({ category: { phase: 'waking' } }), limit: 900 });
    if (!/did not finish waking/.test(slow.out || '')) return 'a wake that never finished did not time out';
    return laneDownText({ owned: true, detail: '' }) === 'the chat model could not wake' || 'laneDownText without a detail';
  });

  check('a reply that ran out of tokens says it was cut off, in the bubble and in the plan', () => {
    const d = { pick: 'pigeon:ntt', id: 'ntt', name: 'note-to-title', kind: 'job', kindLabel: 'Job' };
    const cut = { id: 'c1', lane: 'B', persona: 'ntt', message: 'a long build log', reply: { text: 'The error message indicates that' }, tokens: 45, ms: 751, finishReason: 'length', at: 1 };
    const job = turnHtml(cut, { pigeon: d });
    if (!/Cut off at 45 tokens/.test(job) || !/Written by note-to-title · cut short/.test(job)) return 'a job cut off at its budget reads as a whole answer';
    if (/Cut off|cut short/.test(turnHtml({ ...cut, id: 'c2', finishReason: 'stop' }, { pigeon: d }))) return 'a finished reply is marked cut off';
    const voice = turnHtml({ ...cut, id: 'c3', persona: 'v' }, { pigeon: { pick: 'pigeon:v', id: 'v', name: 'Tutor', kind: 'voice', kindLabel: 'Voice' } });
    if (!/Cut off at 45 tokens/.test(voice) || !/Written by Tutor · cut short/.test(voice)) return 'a voice cut off at its budget reads as a whole answer';
    const rows = laneBFlow(cut, { d });
    if (!/cut off at its budget/.test(rows[0].sub)) return 'the writer\'s line in the plan does not say it was cut off';
    if (!rows.some(r => r.who === 'robot' && r.cls === 'bad' && /Stopped the reply at 45 tokens/.test(r.html))) return 'the Robot does not report stopping the reply';
    if (rows.some(r => /Nothing checked what it wrote/.test(r.html) && r.cls !== 'bad')) return 'a cut-off job is also described as a plain run';
    return true;
  });

  check('a job Pigeon\'s plan is told in its own name and reports the drawing, search and label check that actually ran', () => {
    const d = { pick: 'pigeon:emoji', id: 'emoji', name: 'emoji designer', kind: 'job', kindLabel: 'Job' };
    const persona = { id: 'emoji', name: 'emoji designer', kind: 'freeform', skill: 'face-grammar', labels: [], output_type: 'json' };
    const all = (rows) => rows.map(r => r.html).join(' | ');
    const drawn = laneBFlow({ lane: 'B', persona: 'emoji', reply: { text: '{"eyes":"dots","mouth":"smirk","brows":"angry","extras":[]}' }, rendered: '<svg/>', tokens: 20, ms: 269 }, { d, persona });
    if (drawn[0].who !== 'pigeon' || drawn[0].name !== 'emoji designer') return 'the recipe is still credited to Patch';
    if (drawn.some(r => r.who === 'patch')) return 'Patch speaks on a turn he had no part in';
    if (/No skill ran|Nothing ran/.test(all(drawn))) return 'the panel says nothing ran beside a face that was drawn';
    if (!/picked the parts/.test(drawn[0].html) || !/Drew the recipe with <code>face-grammar<\/code>.*3 parts, no extras/.test(all(drawn))) return `the drawing is not reported: ${all(drawn)}`;
    const broken = laneBFlow({ lane: 'B', persona: 'emoji', reply: { text: '{"eyes":"lasers"}' }, renderError: 'no part named lasers' }, { d, persona });
    if (!broken.some(r => r.who === 'robot' && r.cls === 'bad' && /Could not draw it: no part named lasers/.test(r.html))) return 'a render error is not reported';
    const empty = laneBFlow({ lane: 'B', persona: 'docs', reply: { text: '' }, noMaterial: true, ms: 0 }, { d: { ...d, name: 'docs' } });
    if (empty.some(r => r.who === 'pigeon') || !/no section matched/.test(all(empty))) return 'a Pigeon that was never asked is given a line, or the search is not reported';
    const cited = laneBFlow({ lane: 'B', persona: 'docs', reply: { text: 'see §4' }, sections: [{ ordinal: 1, title: 'A' }, { ordinal: 2, title: 'B' }], unsupportedCitations: [4] }, { d: { ...d, name: 'docs' }, persona: { retrieval: 'bm25' } });
    if (!/Found 2 sections/.test(all(cited)) || !cited.some(r => r.cls === 'bad' && /cites §4/.test(r.html))) return 'sections shown or an unsupported citation are not reported';
    const tagger = { output_type: 'label', labels: ['urgent', 'later'] };
    if (!/is not one of them/.test(all(laneBFlow({ lane: 'B', reply: { text: 'maybe' }, unmatchedLabel: true }, { d, persona: tagger })))) return 'an answer outside the labels is not reported';
    if (!/is one of them/.test(all(laneBFlow({ lane: 'B', reply: { text: 'urgent' } }, { d, persona: tagger })))) return 'a label that matched is not reported';
    const chat = laneBFlow({ lane: 'B', reply: { text: 'hello' }, tokens: 5, ms: 100 }, {});
    if (chat[0].who !== 'patch' || !/No skill ran/.test(chat[0].html) || !/Nothing ran/.test(all(chat))) return 'the base model turn lost its honest empty record';
    const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
    return /const hasPlan = turn\.lane !== 'B'/.test(app) || 'a Lane B turn still offers an empty raw plan';
  });

  check('a failed Lane B turn says Wake models only when a wake could actually help', () => {
    const turn = { id: 't1', lane: 'B', message: 'hi', reply: null, error: 'nothing came back', at: 1 };
    const label = (o) => (turnHtml(turn, { pigeon: { name: 'Chat', kind: 'base' }, ...o }).match(/data-wake="t1">([^<]+)</) || [])[1];
    if (label({ canChat: false, canWake: true }) !== 'Wake models') return 'asleep with an engine is not offered a wake';
    if (label({ canChat: true, canWake: true }) !== 'Try again') return 'an awake model that returned nothing is offered a wake';
    if (label({ canChat: false, canWake: false }) !== 'Try again') return 'a browser tab with no engine is offered a wake';
    return true;
  });

  check('Lane B sends wake first without re-stamping the question, a removed Pigeon cannot answer, and both windows share the wake', () => {
    const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
    const pop = readFileSync(new URL('../src/popover.js', import.meta.url), 'utf8');
    const fn = (src, name) => { const i = src.indexOf(name); return i < 0 ? '' : src.slice(i, src.indexOf('\n}\n', i) + 3); };
    const begin = fn(app, 'async function beginLaneBTurn');
    if (!/wakeCategory\(/.test(begin)) return 'beginLaneBTurn does not wake through the shared helper';
    if ((begin.match(/startInflight\(/g) || []).length !== 1 || !/showStage\('writing'/.test(begin)) return 'the stage change after a wake starts the turn over, re-stamping when it was asked';
    for (const name of ['async function sayInLaneB', 'async function runPigeonJob']) {
      const body = fn(app, name);
      if (!/beginLaneBTurn\(/.test(body) || /startInflight\(/.test(body)) return `${name} does not start through beginLaneBTurn`;
    }
    if (!/pigeonGone\(c\)/.test(fn(app, 'async function say ')) || !/pigeonGone\(c\)/.test(fn(app, 'async function sayInLaneB'))) return 'a chat with a removed Pigeon can still be answered';
    if (!/wakeCategory\(/.test(fn(pop, 'async function askPigeon'))) return 'the popover still sends to an asleep server without waking it';
    if (!/sayInLaneB\([^)]*,\s*id\)/.test(fn(app, 'async function wakeAndRetry'))) return 'wakeAndRetry no longer replaces the failed turn in place';
    return true;
  });

  check('a starter finishes typing before a key, a send or a repaint can read the box, and only a landed reply rises', () => {
    const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
    const css = readFileSync(new URL('../styles/app.css', import.meta.url), 'utf8');
    const fn = (src, name) => { const i = src.indexOf(name); return i < 0 ? '' : src.slice(i, src.indexOf('\n}\n', i) + 3); };
    if (!/^function paint \(\) \{\s*(\/\*[\s\S]*?\*\/\s*)?finishTyping\(\);/m.test(app)) return 'paint() can rebuild the composer under a starter still typing';
    if (!/box\.onkeydown = \(e\) => \{[\s\S]*?finishTyping\(\);[\s\S]*?sendFromComposer/.test(app)) return 'Enter can send a half-typed starter';
    if (!/send\.onclick = \(\) => \{[\s\S]{0,200}?finishTyping\(\);\s*sendFromComposer/.test(app)) return 'Send can send a half-typed starter';
    if (!/setDraft\(chatId, text/.test(fn(app, 'function typeIntoComposer'))) return 'a starter writes its draft to whichever chat is open when it ticks';
    if (!/landedTurn = filed && chatId === state\.activeChatId \? turn\.id : null/.test(fn(app, 'function landReply'))) return 'the entrance animation is not keyed to the turn that landed';
    if (/grew && !target && state\.activeChatId === lastAnimatedChat/.test(app)) return 'the entrance animation still guesses from the paint key';
    return /\.sheet:not\(\.settled\) \.sheet-card:not\(\.fr-card\),\.sheet:not\(\.settled\) \.modal\{animation:pop/.test(css) || 'the download card still pops on every progress tick';
  });

  check('a redraw moves scroll or focus only for a send, a chat switch or a new turn — never for a reading, a queue or a reply in flight', () => {
    const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
    const pop = readFileSync(new URL('../src/popover.js', import.meta.url), 'utf8');
    const key = (app.match(/const key = `([^`]*)`;\n  const grew = key !== lastPaintKey \|\| followNext;/) || [])[1];
    if (!key) return 'the paint key is not what decides, with followNext, whether the conversation moved on';
    if (/busy|queue|attachment/.test(key)) return `the paint key still reacts to ${key}`;
    const sends = (app.match(/startInflight\(c, \{/g) || []).length, followed = (app.match(/followIf\(c\); startInflight\(c, \{/g) || []).length;
    if (sends !== followed) return `${sends - followed} send(s) do not ask the next redraw to follow`;
    if (!/const followIf = \(c\) => \{ if \(c && c\.id === state\.activeChatId\) followNext = true; \};/.test(app)) return 'a send in another chat would scroll this one';
    if (!/\} else if \(state\.editing !== editingShown\) \{\n\s*\/\*[\s\S]*?\*\/\n\s*ed\.focus\(\);/.test(app)) return 'an open edit box still takes focus on every redraw';
    return !/\$\('ask'\)\.focus\(\)/.test(pop) || 'the menu bar still scrolls its box into view on focus';
  });

  check('an engine tick, a download tick or a reply in another chat does not redraw the pane', () => {
    const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
    const fn = (name) => { const i = app.indexOf(name); return app.slice(i, app.indexOf('\n}\n', i) + 3); };
    const eng = fn('async function applyEngineStatus');
    if ((eng.match(/\bpaint\(\)/g) || []).length !== 1 || !/if \(after !== before\) paint\(\);\n  else \{ paintHead\(\); paintList\(\); \}/.test(eng)) return 'a status event still redraws the pane unconditionally';
    if (!/detectPlanner\(\{ quiet: true \}\)/.test(eng) || !/detectCategoryAdapter\(\{ quiet: true \}\)/.test(eng) || !/detectChat\(\{ quiet: true \}\)/.test(eng)) return 'a model coming up redraws once inside detection and again after';
    const prog = fn('function applyProgress');
    if (!/strip\.textContent = `Downloading · \$\{p\.line\}`/.test(prog) || /^\s*paintList\(\);$/m.test(prog)) return 'download progress still rebuilds the chat list per event';
    const land = fn('function landReply');
    return /if \(chatId === state\.activeChatId \|\| !filed\) paint\(\); else paintList\(\);/.test(land) || 'a reply landing in another chat redraws this one';
  });

  check('a reply is drawn once and revealed by trimming its text; a starter types at one fixed height', () => {
    const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
    const fn = (name) => { const i = app.indexOf(name); return app.slice(i, app.indexOf('\n}\n', i) + 3); };
    const reveal = fn('function revealReply');
    if (/sliceSegments/.test(reveal) || (reveal.match(/innerHTML/g) || []).length !== 1) return 'the bubble is still re-rendered per frame';
    if (!/revealing\.get\(turnId\) !== token/.test(reveal)) return 'two reveals of one turn can race';
    const type = fn('function typeIntoComposer');
    const step = type.slice(type.indexOf('const step = '));
    return !/showInBox|scrollHeight/.test(step) || 'the composer is re-measured per character';
  });

  check('every word router over one registry shares one index, and the app bounds what it keeps', async () => {
    const { LexicalRouter } = await import('../src/router.js');
    const a = new LexicalRouter(registry), b = new LexicalRouter(registry, { k: 300 });
    if (a.vectors !== b.vectors || a.idf !== b.idf) return 'two routers over one registry built two indexes';
    if (JSON.stringify(a.route('how many km is 26.2 miles').candidates.slice(0, 3)) !== JSON.stringify(b.route('how many km is 26.2 miles').candidates.slice(0, 3))) return 'sharing the index changed a route';
    const other = buildRegistry(entries);
    if (new LexicalRouter(other).vectors === a.vectors) return 'a different registry got the same index';
    const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
    if (!/for \(const m of \[afterReplyTasks, pendingQuotes, chatOptions, pendingImages, pendingPictures\]\) m\.delete\(id\);/.test(app)) return 'deleting a chat leaves its pending work behind';
    if (!/exampleDrawings\.delete\(k\)/.test(app)) return 'a Pigeon\'s older example drawings are kept';
    if (!/wait = Math\.min\(wait \* 2, MODEL_REPROBE_MAX_MS\)/.test(app)) return 'the browser re-probe never backs off';
    const rust = readFileSync(new URL('../src-tauri/src/patch.rs', import.meta.url), 'utf8');
    if (!/"public, max-age=31536000, immutable"/.test(rust) || /"Cache-Control".to_string\(\), "no-store".to_string\(\)\),\n        \("X-Content-Type-Options".to_string\(\), "nosniff".to_string\(\)\),\n    \];\n    if let Some/.test(rust)) return 'pack modules are still served no-store';
    return /std::thread::spawn\(move \|\| \{\n        let state = app\.state::<PatchState>\(\);\n[^}]*?let bundled = open\(&bundled_path\);/.test(rust) || 'the packs are still read and checked on the main thread';
  });

  check('message-first puts the message before the cards; no-example strips e.g.', () => {
    const mf = plannerUserMessage({ message: 'the question', cards, ctx: FIXED_CTX, order: 'message-first' });
    const ne = plannerUserMessage({ message: 'q', cards, ctx: FIXED_CTX, cardExamples: false });
    if (mf.indexOf('MESSAGE') > mf.indexOf('SKILLS')) return 'message not first';
    if (ne.includes('e.g.')) return 'example still rendered';
    if (!shipped.includes('e.g.')) return 'shipped card lost its example';
    return renderCard(cards[0], { example: false }).split('\n').length < renderCard(cards[0]).split('\n').length ? true : 'renderCard ignored the knob';
  });
  check('benchqueue verdicts: rule, noise band, control', () => {
    const control = { correct: 261, leaks: 6, siblings: 32, declined: 48, avgMs: 2100, tally: { declined: 48 } };
    const cases = [
      [verdict('correct >= control.correct + 4 and leaks <= control.leaks', { correct: 266, leaks: 6, siblings: 30, declined: 44, avgMs: 2000, tally: {} }, control), 'KEEP'],
      [verdict('correct >= control.correct + 4 and leaks <= control.leaks', { correct: 263, leaks: 6, siblings: 30, declined: 44, avgMs: 2000, tally: {} }, control), 'DROP'],
      [verdict('avgMs <= control.avgMs * 0.85 and correct >= control.correct - 4', { correct: 259, leaks: 6, siblings: 32, declined: 48, avgMs: 1700, tally: {} }, control), 'KEEP'],
      [verdict(null, { correct: 262, leaks: 7, siblings: 32, declined: 48, avgMs: 2100, tally: {} }, control), 'NOISE'],
      [verdict('correct > 0', null, control), 'ERROR'],
      [verdict('correct > 0', control, null), 'NO CONTROL']
    ];
    const bad = cases.filter(([got, want]) => got !== want);
    return bad.length ? bad.map(([g, w]) => `got ${g} want ${w}`).join('; ') : true;
  });
  check('benchqueue report reads a host against its own control only', () => {
    const rec = (id, correct, leaks, host) => ({ job: { id, hypothesis: 'h', rule: id === 'control' ? null : 'correct >= control.correct + 4' }, host, head: 'abc', dirty: false, limit: null, ran: '2026-09-08T00:00:00Z',
      record: { holdout: 308, noSkill: 50, configs: { 'llm+ex': { correct, leaks, siblings: 1, avgMs: 1, tally: { declined: 0 } } } } });
    const md = report({ results: { mac: [rec('control', 261, 6, 'mac'), rec('k12', 266, 6, 'mac')], linux: [rec('k12', 266, 6, 'linux')] } });
    if (!md.includes('| k12 | 266/308 | +5 |')) return 'delta not against the mac control';
    if (!/### linux — no control run/.test(md)) return 'linux borrowed a control';
    if (!/\| KEEP \|/.test(md)) return 'rule not evaluated';
    return BASE_FLAGS.includes('--second-look') && BASE_FLAGS.includes('--runway-auto') ? true : 'base flags are not the shipped configuration';
  });
}


/* ── the bench's own hygiene ────────────────────────────────────────────── */
{
  const STOP = new Set('a an the this that these those my me i to of in on for from with and or is are it as at by be into out up down what how which give show tell make turn'.split(' '));
  const toks = (x) => String(x).toLowerCase().replace(/[^a-z0-9%$.:/-]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  const content = (x) => toks(x).filter(t => !STOP.has(t));
  check('no no-skill message is a paraphrase of a holdout question (same content words or Jaccard ≥ 0.75)', () => {
    const bad = [];
    const hold = HOLDOUT.map(([m]) => ({ m, c: new Set(content(m)), key: [...content(m)].sort().join(' ') }));
    for (const x of NO_SKILL_MESSAGES) {
      const c = new Set(content(x)); const key = [...c].sort().join(' ');
      for (const h of hold) {
        if (key && key === h.key) { bad.push(`${x} ~ ${h.m}`); break; }
        const inter = [...c].filter(v => h.c.has(v)).length; const uni = new Set([...c, ...h.c]).size;
        if (uni && inter / uni >= 0.75) { bad.push(`${x} ~ ${h.m}`); break; }
      }
    }
    return bad.length ? bad.join('; ') : true;
  });
  check('no-skill messages are unique and there are at least a hundred', () =>
    new Set(NO_SKILL_MESSAGES).size === NO_SKILL_MESSAGES.length && NO_SKILL_MESSAGES.length >= 100 ? true : `${NO_SKILL_MESSAGES.length} messages, ${new Set(NO_SKILL_MESSAGES).size} unique`);
  check('forbidden.mjs is exactly the bench: every holdout and no-skill message, nothing else', () => {
    const want = new Set([...HOLDOUT.map(([m]) => m), ...NO_SKILL_MESSAGES]);
    const have = new Set(FORBIDDEN);
    if (have.size !== want.size) return `forbidden ${have.size} vs bench ${want.size}`;
    for (const m of want) if (!have.has(m)) return `missing ${m}`;
    return true;
  });
}


/* ── workstream 1: the argument-shape failures ──────────────────────────── */
{
  const hashText = registry.skill('hashText');
  check('enum coercion: "sha512" becomes SHA-512, "Tints" becomes tints, ambiguity still fails', () => {
    const v = validate(hashText.inputSchema, { text: 'x', algorithm: 'sha512' });
    if (!v.ok || v.value.algorithm !== 'SHA-512') return `got ${JSON.stringify(v)}`;
    const p = validate(registry.skill('generatePalette').inputSchema, { color: '#556B2F', scheme: 'Tints' });
    if (!p.ok || p.value.scheme !== 'tints') return `palette ${JSON.stringify(p.errors)}`;
    const amb = validate({ type: 'object', properties: { k: { type: 'string', enum: ['a-b', 'AB'] } } }, { k: 'ab' });
    return amb.ok ? 'ambiguous enum was coerced' : true;
  });
  check('audit: a figure typed once fills one number field — "3 ways" is not also a bill of 3', () => {
    const sb = registry.skill('splitBill');
    const once = auditInput({ bill: 3, tipPercent: 10, people: 3 }, { message: 'split the bill 3 ways with a 10% tip', skill: sb });
    if (once.dropped.map(d => d.field).sort().join() !== 'bill,people' || once.input.tipPercent !== 10) return JSON.stringify(once);
    const twice = auditInput({ bill: 3, people: 3 }, { message: 'split £3 between 3 people', skill: sb });
    if (twice.dropped.length) return `typed twice, still dropped: ${JSON.stringify(twice.dropped)}`;
    const answered = auditInput({ bill: 3, people: 3 }, { message: 'split the bill 3 ways', known: ['3'], skill: sb });
    if (answered.dropped.length) return 'an answer that repeats the figure counts as typing it again';
    const derived = auditInput({ bill: 90, tipPercent: 12, people: 12 }, { message: 'split £90 between twelve people with a tip of 12 percent', skill: sb });
    return derived.dropped.length === 0 || `dropped ${JSON.stringify(derived.dropped)}`;
  });
  check('audit: a figure taken from an earlier result is not a typed number — 10% of a profit of 10 still runs', async () => {
    const sb = registry.skill('percentOf');
    const r = auditInput({ percent: 10, value: 10 }, { message: 'what is 10% of the profit', skill: sb, fromRefs: ['value'] });
    if (r.dropped.length) return `dropped: ${JSON.stringify(r.dropped)}`;
    const carry = { results: [{ id: 's1', ok: true, skill: 'markupMargin', input: { cost: 30, markupPercent: 33.3333 }, value: { price: 40, profit: 10 } }] };
    const run = await runPlan({ steps: [{ id: 's1', skill: 'percentOf', input: { percent: 10, value: '$prev.s1.profit' } }] }, { registry, ctx: FIXED_CTX, message: 'what is 10% of the profit', prevResults: carry.results });
    const res = run.results && run.results[0];
    if (!res || !res.ok || res.input.value !== 10 || res.input.percent !== 10) return `ran as ${JSON.stringify(run.ask || res)}`;
    const rounded = await runTurn('round the total to the nearest whole number', { registry, router: new LexicalRouter(registry), extractor: jsExtractor(registry), ctx: FIXED_CTX,
      planner: async () => ({ steps: [{ id: 's1', skill: 'roundTo', input: { value: 97.18 } }] }),
      carry: { results: [{ id: 's1', ok: true, skill: 'splitBill', input: { bill: 84.5 }, value: { total: 97.18 } }] } });
    const rr = rounded.results && rounded.results[0];
    return (rr && rr.ok && rr.input.places === 0 && rr.value.result === 97) || `nearest whole number: ${JSON.stringify(rounded.ask || rr)}`;
  });
  /* ── a decline that teaches, and one tap to the twin ─────────────────── */

  check('a confident category on a declined turn teaches three of its skills, nearest the words first', async () => {
    const { taughtBy, twinListed } = await import('../src/turn.js');
    const routing = { category: 'dates', confidence: 0.91, candidates: [{ name: 'dayOfWeek', score: 0.4 }, { name: 'countdownTo', score: 0.2 }] };
    const t = taughtBy(routing, registry).taught;
    if (!t || t.category !== 'dates' || t.skills.length !== 3) return JSON.stringify(t);
    if (t.skills[0] !== 'dayOfWeek' || t.skills[1] !== 'countdownTo') return `not nearest first: ${t.skills.join(', ')}`;
    if (t.skills.some(n => registry.skill(n).category !== 'dates')) return 'a skill from another category';
    if (Object.keys(taughtBy({ category: 'dates', confidence: 0.5, candidates: [] }, registry)).length) return 'an unsure category taught';
    if (Object.keys(taughtBy({ category: 'unavailable' }, registry)).length) return 'no category taught';
    /* The twin: only a one-step plan, only a twin the router listed. */
    const r2 = { forPlanner: [{ name: 'isWeekend' }, { name: 'dayOfWeek' }] };
    if (twinListed({ steps: [{ skill: 'isWeekend' }] }, r2) !== 'dayOfWeek') return 'the listed twin was not offered';
    if (twinListed({ steps: [{ skill: 'isWeekend' }] }, { forPlanner: [{ name: 'isWeekend' }] }) !== null) return 'an unlisted twin was offered';
    return twinListed({ steps: [{ skill: 'isWeekend' }, { skill: 'dayOfWeek' }] }, r2) === null || 'a two-step plan offered a twin';
  });

  check('a declined turn with a confident category carries taught skills, and the bubble offers their examples as typing chips', async () => {
    const router = new LexicalRouter(registry);
    const route = router.route.bind(router);
    router.route = (m, o) => ({ ...route(m, o), category: 'dates', confidence: 0.9 });
    const deps = { registry, router, extractor: jsExtractor(registry), ctx: FIXED_CTX, planner: async () => ({ steps: [] }) };
    const t = await runTurn('what day of the week was I born on, in 1988', deps);
    if (t.mode !== MODES.NO_SKILL) return `mode ${t.mode}`;
    if (!t.taught || t.taught.category !== 'dates' || t.taught.skills.length !== 3) return `taught: ${JSON.stringify(t.taught)}`;
    const html = turnHtml({ ...t, id: 'D1', at: Date.now() }, { pigeon: pigeonOf('patch'), exampleFor: (n) => registry.skill(n)?.examples?.[0]?.text || null });
    if (!/With <code>dates<\/code> I can:/.test(html)) return 'the bubble does not name the category';
    const chips = (html.match(/data-do="type-chip"/g) || []).length;
    return chips === 3 || `${chips} chips`;
  });

  check('a skill that failed on its input teaches its own example first, under the error', async () => {
    const deps = { registry, router: new LexicalRouter(registry), extractor: jsExtractor(registry), ctx: FIXED_CTX,
      planner: async () => ({ steps: [{ id: 's1', skill: 'dayOfWeek', input: { date: '1988' } }] }) };
    const t = await runTurn('what day of the week was I born on in 1988', deps);
    const r = t.results && t.results[0];
    if (!r || r.ok) return `the skill did not fail: ${JSON.stringify(r && r.value)}`;
    if (!t.taught || t.taught.skills[0] !== 'dayOfWeek' || t.taught.skills.length !== 3) return `taught: ${JSON.stringify(t.taught)}`;
    if (t.taught.skills.some(n => registry.skill(n).category !== registry.skill('dayOfWeek').category)) return 'a neighbour from another category';
    const html = turnHtml({ ...t, id: 'F1', at: Date.now() }, { pigeon: pigeonOf('patch'), exampleFor: (n) => registry.skill(n)?.examples?.[0]?.text || null });
    if (!/Asked like this, I can:/.test(html)) return 'no teaching line under the error';
    const chips = (html.match(/data-do="type-chip"/g) || []).length;
    if (chips !== 3) return `${chips} chips`;
    /* A worked answer teaches nothing. */
    const ok = await runTurn('what day of the week is 2026-07-04', { ...deps, planner: async () => ({ steps: [{ id: 's1', skill: 'dayOfWeek', input: { date: '2026-07-04' } }] }) });
    return (ok.results[0].ok && !ok.taught) || `a worked answer taught: ${JSON.stringify(ok.taught)}`;
  });

  check('a worked answer whose twin the router listed offers it, and the re-ask with that one skill says you chose it', async () => {
    const router = new LexicalRouter(registry);
    const route = router.route.bind(router);
    router.route = (m, o) => { const r = route(m, o); return { ...r, forPlanner: [{ name: 'isWeekend' }, { name: 'dayOfWeek' }], candidates: [{ name: 'isWeekend', score: 0.6 }, { name: 'dayOfWeek', score: 0.5 }] }; };
    const seen = [];
    const planner = async ({ cards }) => { seen.push(cards.map(c => c.name)); return { steps: [{ id: 's1', skill: cards[0].name, input: { date: '2026-07-04' } }] }; };
    const deps = { registry, router, extractor: jsExtractor(registry), ctx: FIXED_CTX, planner };
    const first = await runTurn('is 2026-07-04 a saturday', deps);
    if (first.twin !== 'dayOfWeek') return `twin: ${JSON.stringify(first.twin)} results ${JSON.stringify(first.results && first.results[0] && first.results[0].skill)}`;
    const html = turnHtml({ ...first, id: 'T1', at: Date.now() }, { pigeon: pigeonOf('patch') });
    if (!/data-do="retwin" data-turn="T1" data-skill="dayOfWeek"/.test(html) || !/or dayOfWeek\?/.test(html)) return 'no twin button on the line';
    const again = await runTurn('is 2026-07-04 a saturday', { ...deps, onlySkill: 'dayOfWeek' });
    if (JSON.stringify(seen[seen.length - 1]) !== '["dayOfWeek"]') return `the planner saw ${JSON.stringify(seen[seen.length - 1])}`;
    if (again.chosen !== 'dayOfWeek' || again.twin) return `chosen ${again.chosen}, twin ${again.twin}`;
    const h2 = turnHtml({ ...again, id: 'T2', at: Date.now() }, { pigeon: pigeonOf('patch') });
    return (/you chose this/.test(h2) && !/data-do="retwin"/.test(h2)) || 'the chosen answer does not say so, or offers a twin again';
  });

  check('the sleep setting offers five minutes, and the page warms on focus, chips, the queue and the twin', () => {
    const html = settingsHtml({ tab: 'models', settings: { sleepAfter: 300 }, models: { words: 'asleep', canWake: true } });
    if (!/data-set="sleepAfter" data-value="300">5 minutes unused/.test(html)) return 'no five-minute option';
    const app = readFileSync(join(ROOT, 'src/app.js'), 'utf8');
    for (const must of ['box.onfocus = () => warmSoon()', "case 'send-queued': warmSoon();", 'finishTyping();\n  warmSoon();', 'looking: (d) =>', "showStage('looking', { persona: 'Peek' }, chatId)"]) {
      if (!app.includes(must)) return `app.js lacks: ${must}`;
    }
    const rs = readFileSync(join(ROOT, 'src-tauri/src/engine.rs'), 'utf8');
    return /\[0, 300, 600, 3600\]\.contains\(&secs\)/.test(rs) || 'Rust does not accept 300';
  });

  check('a turn whose plan reused the head count as the bill asks for the bill, and keeps the 3 people', async () => {
    const planner = async () => ({ steps: [{ id: 's1', skill: 'splitBill', input: { bill: 3, tipPercent: 10, people: 3 } }] });
    const deps = { registry, router: new LexicalRouter(registry), extractor: jsExtractor(registry), planner, ctx: FIXED_CTX };
    const t = await runTurn('split the bill 3 ways with a 10% tip', deps);
    if (!t.ask || t.ask.field !== 'bill') return `no ask: ${JSON.stringify(t.results?.[0]?.input)}`;
    const t2 = await runTurn('72', { ...deps, pending: t });
    const r = t2.results?.[0];
    return (r && r.input.bill === 72 && r.input.people === 3 && r.input.tipPercent === 10 && r.sources?.bill === 'asked') || JSON.stringify(r?.input);
  });
  check('a figure the plan already used is not filled into a second field by the extractor ("take 10% off that" asks for the price)', async () => {
    const deps = { registry, router: new LexicalRouter(registry), extractor: jsExtractor(registry), ctx: FIXED_CTX };
    const t = await runTurn('take 10% off that', { ...deps, planner: async () => ({ steps: [{ id: 's1', skill: 'applyDiscount', input: { percent: 10 } }] }) });
    if (!t.ask || t.ask.field !== 'price') return `no ask: ${JSON.stringify(t.ask || t.results?.[0]?.input)}`;
    /* Typed twice, it may fill two fields. */
    const t2 = await runTurn('what is 10% off 10', { ...deps, planner: async () => ({ steps: [{ id: 's1', skill: 'applyDiscount', input: { percent: 10 } }] }) });
    const r = t2.results?.[0];
    if (!r || !r.ok || r.input.price !== 10) return `typed twice: ${JSON.stringify(t2.ask || r)}`;
    return spentFigures({ percent: 10 }, { price: 10 }, { message: 'take 10% off that' }).join() === 'price' || 'spentFigures';
  });
  check('a choice the skill does not offer is asked for, never defaulted ("fibonacci up to the 12th" planned as mode "up")', async () => {
    const deps = { registry, router: new LexicalRouter(registry), extractor: jsExtractor(registry), ctx: FIXED_CTX };
    const t = await runTurn('give me fibonacci up to the 12th', { ...deps, planner: async () => ({ steps: [{ id: 's1', skill: 'fibonacci', input: { n: 12, mode: 'up' } }] }) });
    if (!t.ask || t.ask.field !== 'mode' || t.ask.question !== 'Which mode: nth or sequence?' || !t.ask.untraceable) return `no ask: ${JSON.stringify(t.ask || t.results?.[0])}`;
    const t2 = await runTurn('the whole sequence please', { ...deps, pending: t });
    const r = t2.results?.[0];
    if (!r || !r.ok || r.input.mode !== 'sequence' || r.input.n !== 12) return `answered: ${JSON.stringify(t2.ask || r)}`;
    /* A choice it does offer goes straight through. */
    const ok = await runTurn('first 8 fibonacci numbers', { ...deps, planner: async () => ({ steps: [{ id: 's1', skill: 'fibonacci', input: { n: 8, mode: 'sequence' } }] }) });
    return (ok.results?.[0]?.ok && !ok.ask) || `valid choice: ${JSON.stringify(ok.ask || ok.results?.[0])}`;
  });
  check('a national number with a region drops the trunk 0 (07700 900123 in the UK is +447700900123), and Italy keeps its leading zero', async () => {
    const f = registry.skill('formatPhoneNumber'), v = registry.skill('validatePhoneNumber');
    const uk = await f.run({ number: '07700 900123', region: '44' }, FIXED_CTX);
    if (!uk.ok || uk.value.e164 !== '+447700900123' || uk.value.international !== '+44 7700 900123' || uk.value.national !== '07700900123') return `UK: ${JSON.stringify(uk.value || uk.error)}`;
    const it = await f.run({ number: '06 1234 5678', region: '39' }, FIXED_CTX);
    if (!it.ok || it.value.e164 !== '+390612345678') return `Italy: ${JSON.stringify(it.value || it.error)}`;
    const us = await f.run({ number: '(415) 555-2671', region: '1' }, FIXED_CTX);
    if (!us.ok || us.value.e164 !== '+14155552671') return `US: ${JSON.stringify(us.value || us.error)}`;
    const ok = await v.run({ number: '07700 900123', region: '44' }, FIXED_CTX);
    return (ok.ok && ok.value.e164 === '+447700900123' && ok.value.nationalNumber === '7700900123') || `validate: ${JSON.stringify(ok.value || ok.error)}`;
  });
  check('audit: an empty list for a required field is dropped (the schema still rejects [] in a hand-written plan)', () => {
    const r = auditInput({ first: [], second: ['a'] }, { message: 'which entries appear on both lists', skill: registry.skill('intersectLists') });
    if (r.dropped.length !== 1 || r.dropped[0].field !== 'first') return JSON.stringify(r);
    const v = validate(registry.skill('intersectLists').inputSchema, { first: [], second: ['a'] });
    return !v.ok && v.errors[0].code === 'INVALID_INPUT' ? true : 'schema no longer rejects []';
  });
  check('audit: a hex colour is not a quantity, so an invented count is dropped', () => {
    const r = auditInput({ color: '#556B2F', scheme: 'tints', count: 1 }, { message: 'give me tints and shades of #556B2F', skill: registry.skill('generatePalette') });
    return r.dropped.length === 1 && r.dropped[0].field === 'count' && r.input.color === '#556B2F' ? true : JSON.stringify(r);
  });
  check('audit: the request sentence handed back as the payload is dropped; a real quote is kept', () => {
    const a = auditInput({ text: 'grab the bullets from this' }, { message: 'grab the bullets from this', skill: registry.skill('extractListItems') });
    if (a.dropped.length !== 1) return `not dropped: ${JSON.stringify(a)}`;
    const b = auditInput({ text: 'the quick brown fox' }, { message: 'count the words in "the quick brown fox"', skill: registry.skill('countWords') });
    return b.dropped.length === 0 ? true : `quote dropped: ${JSON.stringify(b)}`;
  });
  check('extractor: radius from "30cm across", and a dropped array is not refilled from the message', async () => {
    const ex = jsExtractor(registry);
    const r = await ex({ message: 'litres in a cylinder 30cm across and 50 tall', skill: registry.skill('volumeOf'), input: { solid: 'cylinder', height: 50 }, ctx: FIXED_CTX, needField: 'radius' });
    if (r.radius !== 15) return `radius ${JSON.stringify(r)}`;
    const m = await ex({ message: 'smooth this over a 5 point window', skill: registry.skill('movingAverage'), input: { window: 5 }, ctx: FIXED_CTX, untraceable: ['values'] });
    return m.values === undefined ? true : `refilled ${JSON.stringify(m)}`;
  });
  check('the nine workstream-1 cases end as answers or honest asks', async () => {
    const ex = jsExtractor(registry);
    const cases = [
      ['give me tints and shades of #556B2F', { skill: 'generatePalette', input: { color: '#556B2F', scheme: 'tints', count: 1 } }, 'answered'],
      ['sha512 digest of this phrase', { skill: 'hashText', input: { text: 'this phrase', algorithm: 'sha512' } }, 'answered'],
      ['litres in a cylinder 30cm across and 50 tall', { skill: 'volumeOf', input: { solid: 'cylinder', side: 30, height: 50 } }, 'answered'],
      ['grab the bullets from this', { skill: 'extractListItems', input: { text: 'grab the bullets from this' } }, 'ask'],
      ['what stands out in this document', { skill: 'keywordsTfidf', input: { text: 'what stands out in this document' } }, 'ask'],
      ['which entries appear on both lists', { skill: 'intersectLists', input: { first: [], second: [], ignoreCase: false } }, 'ask'],
      ['smooth this over a 5 point window', { skill: 'movingAverage', input: { values: [1, 2, 3, 4, 5], window: 5 } }, 'ask'],
      ['these 1s and 0s spell what', { skill: 'binaryDecode', input: {} }, 'ask'],
      ['does this payload conform to my schema', { skill: 'validateJsonSchema', input: {} }, 'ask']
    ];
    const bad = [];
    for (const [message, step, want] of cases) {
      const run = await runPlan({ steps: [{ id: 's1', ...step }] }, { registry, ctx: FIXED_CTX, message, extractor: ex });
      const got = run.outcome === 'ASK_USER' ? (run.ask.untraceable ? 'ask' : 'ask-plain') : (run.results[0] && run.results[0].ok ? 'answered' : `failed: ${run.results[0] && run.results[0].error && run.results[0].error.message}`);
      if (got !== want) bad.push(`${message} → ${got} (want ${want})`);
    }
    return bad.length ? bad.join('\n    ') : true;
  });
}


/* ── loops sized by an untrusted number must stop ───────────────────────── */
{
  check('lzwDecompress refuses a length header the stream cannot hold, and a stream that ends early', async () => {
    const { lzwDecompress, lzwCompress } = await import('../src/lib/lzw.js');
    const liar = new Uint8Array([0xff, 0xff, 0xff, 0xff, 0, 0, 0, 0]);
    let threw = null;
    try { lzwDecompress(liar); } catch (e) { threw = e.message; }
    if (!threw || !/length header/.test(threw)) return `no refusal: ${threw}`;
    /* A plausible small header over an empty stream: must stop at the end of
       the bytes, not run to the declared length. */
    const short = new Uint8Array([0, 0, 0, 200, 0, 0]);
    threw = null;
    try { lzwDecompress(short); } catch (e) { threw = e.message; }
    if (!threw) return 'ran past the end of the stream';
    const real = lzwCompress(new TextEncoder().encode('round trip round trip round trip'));
    return new TextDecoder().decode(lzwDecompress(real)) === 'round trip round trip round trip' ? true : 'round trip broke';
  });
  check('setPath refuses an array index past 10,000 instead of filling it', () => {
    const skill = registry.skill('setPath');
    const r = skill.run(validate(skill.inputSchema, { json: '{"a":[1]}', path: 'a[4000000000]', value: 1 }).value, FIXED_CTX);
    return !r.ok && r.error.code === 'INVALID_INPUT' && /10,000/.test(r.error.message) ? true : JSON.stringify(r);
  });
  check('pickRandom caps count at 1,000 in its schema', () => {
    const v = validate(registry.skill('pickRandom').inputSchema, { items: ['a'], count: 4000000000, allowRepeats: true });
    return !v.ok ? true : 'accepted four billion picks';
  });
}


/* ── cards that read alike ──────────────────────────────────────────────── */
{
  /* A REGRESSION FLOOR, not a target. 3 pairs are flagged today, down from 38; the three
     that remain are genuinely near-identical tasks whose descriptions cannot
     honestly diverge much further. Lower this as any of them is separated,
     and never raise it to make a new description fit. src/lint-cards.js says what it catches and what it misses. */
  const CONFUSABLE_CEILING = 3;
  check(`no more than ${CONFUSABLE_CEILING} skill pairs read alike without saying which way they run`, () => {
    const found = confusablePairs(registry.routable());
    if (found.length <= CONFUSABLE_CEILING) return true;
    const fresh = found.slice(0, 6).map(p => `${p.a}/${p.b} (${p.overlap}: ${p.shared.join(' ')})`);
    return `${found.length} pairs, ceiling ${CONFUSABLE_CEILING} — run: node scripts/lintcards.mjs\n    ${fresh.join('\n    ')}`;
  });
  check('the card lint agrees with the rewrites workstream 3a measured', () => {
    /* Every pair that rewrite separated must now pass, or the lint is not
       measuring the thing that moved the bench from 272 to 289. */
    const flagged = new Set(confusablePairs(registry.routable()).map(p => [p.a, p.b].sort().join('/')));
    const fixed = [['toMarkdownTable', 'parseMarkdownTable'], ['flattenJson', 'unflattenJson'],
      ['groupBy', 'sortRows'], ['shippingTotal', 'stackDiscounts'], ['compressText', 'truncateText'],
      ['unionLists', 'intersectLists'], ['convertCase', 'checkTitleCase'], ['parseDuration', 'durationToText'],
      ['expandRecurrence', 'extractDates'], ['rangeList', 'numberLines']];
    const still = fixed.filter(([a, b]) => flagged.has([a, b].sort().join('/')));
    return still.length ? `still flagged after rewriting: ${still.map(p => p.join('/')).join(', ')}` : true;
  });
  check('the lint separates a mirrored pair only when each side says its own direction', () => {
    if (overlap('Turn rows into a markdown table', 'Turn a markdown table into rows') < 0.6) return 'mirror pair scored low';
    if (overlap('Draw rows out as a markdown table', 'Add up a column of numbers') > 0.2) return 'unrelated pair scored high';
    return true;
  });
}


/* ── the question a third of successful turns end on ────────────────────── */
{
  check('an ask says what it is about to run and what it already read', async () => {
    const ex = jsExtractor(registry);
    const run = await runPlan({ steps: [{ id: 's1', skill: 'sortRows', input: { column: 'price', direction: 'desc' } }] },
      { registry, ctx: FIXED_CTX, message: 'order the table by price descending', extractor: ex });
    if (run.outcome !== 'ASK_USER') return `did not ask: ${run.outcome}`;
    const a = run.ask;
    if (a.does !== registry.skill('sortRows').description) return `does not carry the skill's own description: ${a.does}`;
    const held = Object.fromEntries((a.have || []).map(h => [h.field, h.text]));
    if (held.column !== 'price') return `did not read the column back: ${JSON.stringify(a.have)}`;
    if ('table' in held) return 'the missing field must not be listed as held';
    return true;
  });
  check('held values exclude context, defaults and the field being asked for', async () => {
    const ex = jsExtractor(registry);
    const run = await runPlan({ steps: [{ id: 's1', skill: 'parseCsv', input: {} }] },
      { registry, ctx: FIXED_CTX, message: 'read this csv into columns', extractor: ex });
    if (run.outcome !== 'ASK_USER') return `did not ask: ${run.outcome}`;
    const names = (run.ask.have || []).map(h => h.field);
    const leaked = names.filter(n => ['now', 'timezone', 'locale', 'units', 'webEnabled'].includes(n));
    if (leaked.length) return `context leaked into the question: ${leaked.join(', ')}`;
    return run.ask.untraceable === true ? true : 'a dropped payload should be flagged untraceable';
  });
  check('a long held value is truncated so the question stays readable', async () => {
    const ex = jsExtractor(registry);
    const long = 'x'.repeat(400);
    const run = await runPlan({ steps: [{ id: 's1', skill: 'countOccurrences', input: { text: long } }] },
      { registry, ctx: FIXED_CTX, message: `count how many times a appears in ${long}`, extractor: ex });
    if (run.outcome !== 'ASK_USER') return true;
    const tooLong = (run.ask.have || []).filter(h => h.text.length > 60);
    return tooLong.length ? `held value not truncated: ${tooLong[0].text.length} chars` : true;
  });
}


/* ── the plan view's clock ──────────────────────────────────────────────── */
{
  check('a turn carries how long the router and planner took', async () => {
    const lexical = new LexicalRouter(registry);
    const planner = async () => ({ steps: [{ id: 's1', skill: 'countWords', input: { text: 'one two three' } }] });
    const t = await runTurn('count the words in one two three', { registry, router: lexical, ctx: FIXED_CTX, planner, extractor: jsExtractor(registry) });
    if (!t.stages || typeof t.stages.router !== 'number') return `no router timing: ${JSON.stringify(t.stages)}`;
    if (typeof t.stages.planner !== 'number') return `no planner timing: ${JSON.stringify(t.stages)}`;
    const none = await runTurn('zzqx', { registry, router: lexical, ctx: FIXED_CTX });
    return none.stages && typeof none.stages.router === 'number' ? true : 'a declined turn lost its timings';
  });
}


/* ── the one model pass that happens after the Robot ────────────────────── */
{
  const PAGE = 'Maryland is a state in the Mid-Atlantic region. The office of governor was established in 1777. The current governor is Wes Moore, who has been in office since 2023.';
  const focusing = (n, phrase) => sentenceFocus({
    complete: async () => ({ text: JSON.stringify({ looking_for: phrase, sentence: n }), ms: 7 })
  });
  check('focus keeps the model\'s own words about what it was looking for', async () => {
    const got = await focusing(3, "the governor's name")({ message: 'who governs Maryland', answer: PAGE });
    if (!got) return 'focus declined';
    if (got.lookingFor !== "the governor's name") return `lookingFor was ${JSON.stringify(got.lookingFor)}`;
    return got.kept[0] === 3 && got.of === 3 ? true : `kept ${JSON.stringify(got.kept)} of ${got.of}`;
  });
  check('a focused web reply records that the pass happened', async () => {
    const results = [{
      id: 's1', skill: 'webAnswer', ok: true, ms: 40,
      input: { question: 'who governs Maryland' },
      value: { answer: PAGE, source: 'https://en.wikipedia.org/wiki/Maryland' },
      provenance: { kind: 'web', source: 'https://en.wikipedia.org/wiki/Maryland', dataAsOf: null }
    }];
    const reply = await replyFor(results, {
      registry, message: 'who governs Maryland', ctx: FIXED_CTX,
      focus: focusing(3, "the governor's name")
    });
    if (reply.source !== REPLY_SOURCES.FOCUSED) return `source was ${reply.source}`;
    if (!reply.focus) return 'no focus record on the reply';
    if (reply.focus.lookingFor !== "the governor's name") return `lookingFor ${JSON.stringify(reply.focus.lookingFor)}`;
    if (reply.focus.of !== 3 || reply.focus.kept[0] !== 3) return `kept ${JSON.stringify(reply.focus.kept)} of ${reply.focus.of}`;
    /* The words are still the page's own — the model only chose a number. */
    return PAGE.includes(reply.segments[0].text) ? true : 'the focused text is not from the page';
  });
  check('a turn with no focus pass carries no focus record', async () => {
    const results = [{ id: 's1', skill: 'countWords', ok: true, ms: 1, input: { text: 'a b' },
      value: { count: 2, text: 'a b' }, provenance: { kind: 'computed', source: null, dataAsOf: null } }];
    const reply = await replyFor(results, { registry, message: 'count them', ctx: FIXED_CTX });
    return reply.focus === undefined ? true : 'a non-web reply invented a focus record';
  });
}

/* ── Messages With Receipts: the groundwork (docs/MESSAGES-WITH-RECEIPTS.md) ──
   The pieces the new flow is built from, tested before any window uses them:
   state v4, how a time reads, the status line, the send queue, the notes before
   a follow-up, and the mark under a reply. */
{
  /* Monday 14 September 2026, midday. */
  const NOW = new Date(2026, 8, 14, 12, 0).getTime();
  const daysBack = (d, h = 9, m = 41) => new Date(2026, 8, 14 - d, h, m).getTime();

  check('state v4: a v3 file upgrades, and its new chat and turn fields get safe defaults', () => {
    const out = parseBlob(JSON.stringify({ version: 3, chats: [{ id: 'a', nodes: { t: { id: 't', message: 'm', quoteId: 5, source: 'generated' } } }] }));
    const c = out && out.chats[0];
    return (out && out.version === 4 && STATE_VERSION === 4 && Array.isArray(c.queue) && !c.queue.length && c.noteSkips === 0
      && JSON.stringify(c.askSkipped) === '{}' && c.nodes.t.quoteId === null && c.nodes.t.source === 'typed')
      || `got ${JSON.stringify(out)}`;
  });
  check('state v4: queued messages keep only what a person sent, and junk is dropped', () => {
    const out = parseBlob(JSON.stringify({ version: 4, chats: [{ id: 'a', nodes: {},
      queue: [{ id: 'm', text: 'and 5 ways?', source: 'model', quoteId: 7, sentAt: 5 }, { id: 'n', text: '   ' }, 7, { text: 'no id' }],
      noteSkips: -1, askSkipped: { x: true, y: 'yes' } }] }));
    const c = out && out.chats[0];
    return (c && c.queue.length === 1 && c.queue[0].source === 'typed' && c.queue[0].quoteId === null && c.queue[0].sentAt === 5
      && c.noteSkips === 0 && JSON.stringify(c.askSkipped) === '{"x":true}') || `got ${JSON.stringify(c)}`;
  });
  check('state v4: the web log is text only and capped', () => {
    const log = Array.from({ length: WEB_LOG_CAP + 10 }, (_, i) => ({ at: i, text: `q${i}`, hosts: ['en.wikipedia.org', 3], extra: 'x' }));
    const out = parseBlob(JSON.stringify({ version: 4, chats: [], settings: { webLog: [...log, { at: 'no', text: 'x' }, { at: 1, text: '' }] } }));
    const l = out && out.settings.webLog;
    return (l && l.length === WEB_LOG_CAP && l[0].text === 'q10' && l[l.length - 1].text === `q${WEB_LOG_CAP + 9}`
      && JSON.stringify(l[0].hosts) === '["en.wikipedia.org"]' && !('extra' in l[0])) || `got ${l && l.length}`;
  });

  check('slotFor reads like a messaging app', () => {
    const want = [[0, '09:41'], [1, 'Yesterday'], [6, 'Tuesday'], [12, '2 Sept']];
    for (const [d, s] of want) if (slotFor(daysBack(d), NOW) !== s) return `${d} days back gave ${slotFor(daysBack(d), NOW)}, want ${s}`;
    return slotFor(0, NOW) === '' || 'no time should read as nothing';
  });
  check('groupFor sorts rows under Today, Yesterday, Last 7 days and Earlier', () => {
    const got = [0, 1, 6, 7].map(d => groupFor(daysBack(d), NOW)).join('|');
    return got === GROUPS.join('|') || `got ${got}`;
  });
  check('dayWords lets search find last Tuesday', () => {
    const tue = dayWords(daysBack(6), NOW);
    const older = dayWords(daysBack(9), NOW);
    return (tue.includes('tuesday') && tue.includes('8 sept') && tue.includes('september') && tue.includes('this week')
      && older.includes('last week') && dayWords(daysBack(1), NOW).includes('yesterday')) || `got ${tue} / ${older}`;
  });

  check('a wake countdown never reaches zero, then says it is taking longer', () => {
    const t0 = 1_000_000;
    const a = wakeEta(14000, t0, t0);
    const b = wakeEta(14000, t0, t0 + 13000);
    const c = wakeEta(14000, t0, t0 + 30000);
    const d = wakeEta(null, t0, t0);
    const e = restartEta(undefined, t0, t0);
    return (a === 'about 14 s' && b === 'about 2 s' && c === TAKING_LONGER && d === 'about 14 s' && e === 'about 25 s')
      || `got ${[a, b, c, d, e].join(' | ')}`;
  });
  check('the status line says what is true in the Delivered slot', () => {
    const cases = [
      [{ state: 'queued' }, 'Waiting'],
      [{ state: 'held', askName: 'Patch' }, 'Waiting for your answer to Patch'],
      [{ state: 'waking', name: 'Title Maker', eta: 'about 14 s' }, 'Waking Title Maker · about 14 s'],
      [{ state: 'restarting', name: 'Title Maker', eta: 'about 25 s' }, 'Getting Title Maker ready · about 25 s'],
      [{ state: 'behind', eta: 'about 25 s' }, 'Waiting for another reply to finish, then about 25 s'],
      [{ state: 'waking', name: 'Pen', eta: TAKING_LONGER }, TAKING_LONGER],
      [{ state: 'sent-web', at: new Date(2026, 8, 14, 14, 2).getTime() }, 'Sent to DuckDuckGo and Wikipedia · 14:02'],
      [{ state: 'done' }, '']
    ];
    for (const [input, want] of cases) if (statusLine(input) !== want) return `${JSON.stringify(input)} gave ${JSON.stringify(statusLine(input))}`;
    return /Read|Delivered/.test(cases.map(([i]) => statusLine(i)).join(' ')) ? 'the slot still says Read or Delivered' : true;
  });

  check('a queued message waits for a reply in flight and for an open question, and goes once it is skipped', () => {
    const c = { id: 'q', nodes: {}, queue: [] };
    linkTurn(c, { id: 't1', message: 'split it 4 ways', ask: { question: 'How much was the bill?' }, at: 1 });
    const m = enqueue(c, { text: 'what is the capital of Japan' }, { uid: () => 'm1' });
    if (!m || nextQueued(c) !== null) return 'a queued message was offered as the answer to an open question';
    if (!askOpen(c) || !skipAsk(c) || askOpen(c)) return 'skipping did not close the question';
    if (!nextQueued(c) || nextQueued(c).id !== 'm1') return 'the queue did not move after skipping';
    c.inflight = { message: 'busy' };
    if (nextQueued(c) !== null) return 'a message went while a reply was still on its way';
    c.inflight = null;
    const taken = takeQueued(c);
    return (taken && taken.id === 'm1' && !c.queue.length && enqueue(c, { text: '  ' }) === null) || 'take or blank text went wrong';
  });
  check('a queued message can be dropped before it goes', () => {
    const c = { id: 'q', nodes: {}, queue: [] };
    enqueue(c, { text: 'one' }, { uid: () => 'a' });
    enqueue(c, { text: 'two' }, { uid: () => 'b' });
    return (dropQueued(c, 'a') && c.queue.length === 1 && c.queue[0].text === 'two' && !dropQueued(c, 'zz')) || 'drop went wrong';
  });

  check('Patch gets a note before a follow-up he cannot see, and only then', () => {
    const fires = patchFollowUpNote({ lastWasWorked: true, text: 'what about 4 of us?' });
    const noNumber = patchFollowUpNote({ lastWasWorked: true, text: 'in euros please' });
    const fresh = patchFollowUpNote({ lastWasWorked: true, text: 'split £120 5 ways' });
    const afterDecline = patchFollowUpNote({ lastWasWorked: false, text: 'what about 4 of us?' });
    const tired = patchFollowUpNote({ lastWasWorked: true, text: 'what about 4 of us?', noteSkips: NOTE_SKIP_LIMIT });
    return (fires && fires.text.includes('Patch doesn’t carry figures from earlier messages') && noNumber && !fresh && !afterDecline && !tired)
      || `got ${JSON.stringify({ fires, noNumber, fresh, afterDecline, tired })}`;
  });
  check('a one-shot Pigeon gets a note before "shorter please", with an app-written frame for Pen', () => {
    const pigeon = { name: 'Title Maker', noun: 'title', inputMax: 12 };
    const n = oneShotNote({ pigeon, text: 'shorter please', prevText: 'buying milk for Sam', penAvailable: true });
    const pen = n && n.buttons.find(b => b.act === 'ask-pen');
    const newNote = oneShotNote({ pigeon, text: 'fixing the bike brakes', prevText: 'buying milk for Sam', penAvailable: true });
    const drawing = oneShotNote({ pigeon: { name: 'Icon Maker', drawing: true }, text: 'another one', prevText: 'a sleepy pigeon', penAvailable: true });
    const hi = oneShotNote({ pigeon, text: 'hi' });
    const long = oneShotNote({ pigeon, text: 'one two three four five six seven eight nine ten eleven twelve thirteen' });
    return (n && n.kind === 'follow-up' && n.text === 'Title Maker doesn’t see earlier messages. “shorter please” would get a title of its own.'
      && pen && pen.frame === 'Give me a shorter title for: buying milk for Sam' && !newNote
      && drawing && !drawing.buttons.some(b => b.act === 'ask-pen') && hi && hi.kind === 'greeting' && long && long.kind === 'long')
      || `got ${JSON.stringify({ n, newNote, drawing, hi, long })}`;
  });
  check('no note ever carries text to send in place of what was typed', () => {
    const notes = [
      patchFollowUpNote({ lastWasWorked: true, text: 'and 5 ways?' }),
      oneShotNote({ pigeon: { name: 'T', noun: 'title' }, text: 'shorter', prevText: 'buying milk', penAvailable: true }),
      lengthNote({ text: 'word '.repeat(4100) })
    ];
    for (const n of notes) {
      if (!n) return 'a note that should fire did not';
      const extra = Object.keys(n).filter(k => !['kind', 'text', 'buttons'].includes(k));
      if (extra.length) return `a note carries ${extra}`;
      if (n.buttons.some(b => b.act === 'send' || 'text' in b)) return 'a note offers a button that sends replacement text';
    }
    return lengthNote({ text: 'short' }) === null || 'a short message got a length note';
  });

  const computedTurn = (kind = 'computed', ok = true) => ({
    lane: 'A', message: 'split £87.40 three ways', mode: MODES.SINGLE_SKILL,
    results: [{ id: 's1', skill: 'splitBill', ok, provenance: { kind, source: kind === 'web' ? 'https://en.wikipedia.org/wiki/Bern' : null } }],
    reply: { segments: [{ type: 'text', text: '£87.40 in total: ' }, { type: 'value', text: '£29.14', skill: 'splitBill' }, { type: 'text', text: ' each.' }, { type: 'failure', code: 'X', text: 'nope' }] }
  });
  check('every reply carries exactly one mark, read off what ran', () => {
    const cases = [
      [computedTurn(), MARKS.WORKED],
      [computedTurn('bundled'), MARKS.WORKED],
      [computedTurn('web'), MARKS.LOOKED],
      [computedTurn('computed', false), MARKS.COULDNT],
      [{ lane: 'A', mode: MODES.NO_SKILL, results: [] }, MARKS.COULDNT],
      [{ lane: 'A', ask: { question: 'How much?' } }, MARKS.WAITING],
      [{ lane: 'B', reply: { text: 'Here is a gentler way' } }, MARKS.WRITTEN],
      [{ lane: 'B', reply: { text: 'x' }, handoff: { numbers: ['29.13'] } }, MARKS.COULDNT],
      [{ lane: 'B', reply: { text: '' }, noMaterial: true }, MARKS.COULDNT],
      [{ lane: 'B', reply: null }, MARKS.COULDNT],
      [{ lane: 'A', interrupted: true }, MARKS.COULDNT]
    ];
    for (const [t, want] of cases) if (markFor(t) !== want) return `${JSON.stringify(t).slice(0, 80)} marked ${markFor(t)}, want ${want}`;
    return markFor({ lane: 'A', ask: {} }, { skipped: true }) === MARKS.SKIPPED || 'a skipped question is not marked Skipped';
  });
  check('mark labels say who did the work in plain words', () => {
    const got = [
      markLabel(MARKS.WORKED, { firstThree: true }), markLabel(MARKS.WORKED),
      markLabel(MARKS.LOOKED, { source: webSource(computedTurn('web')) }),
      markLabel(MARKS.WRITTEN, { name: 'Pen' }), markLabel(MARKS.WRITTEN, { name: 'Pen', cutShort: true }),
      markLabel(MARKS.COULDNT)
    ].join(' | ');
    const want = 'Worked out from the inputs above | Worked out | Looked up · Wikipedia | Written by Pen · may be wrong | Written by Pen · cut short | Couldn’t answer';
    return got === want || `got ${got}`;
  });
  check('Copy is the answer sentence only; Copy with where it came from adds its source', () => {
    const t = computedTurn();
    const plain = copyText(t);
    const withSource = copyWithSource(t);
    const pen = copyWithSource({ lane: 'B', reply: { text: 'Hello there' } }, 'Pen');
    return (plain === '£87.40 in total: £29.14 each.' && withSource === '£87.40 in total: £29.14 each. (worked out by Patch in Pigeon: Split bill)'
      && pen === 'Hello there (written by Pen in Pigeon, may be wrong)' && humanise('splitBill') === 'Split bill' && humanise('') === '')
      || `got ${JSON.stringify({ plain, withSource, pen })}`;
  });
}

/* ── Messages With Receipts: the line under every reply, and Message info ── */
{
  /* ── E1: where each value came from ─────────────────────────────────── */
  {
    const e1ctx = { now: '2026-09-01T09:00:00Z', timezone: 'UTC', locale: 'en-GB', units: 'metric', webEnabled: false, confirmBeforeNetwork: true };
    const e1router = new LexicalRouter(registry);
    const e1ex = jsExtractor(registry);
    const ask = (text, extra = {}) => runTurn(text, { registry, router: e1router, ctx: { ...e1ctx }, extractor: e1ex, ...extra });
    const said = (t) => (t.reply ? t.reply.segments.map(s => s.text).join('') : '');

    check('each input records whether it was given, asked, a default, or the app’s own context', async () => {
      const t = await ask('split a £84.50 bill between 4 people');
      const r = (t.results || []).find(x => x.skill === 'splitBill');
      if (!r || !r.sources) return `no sources: ${JSON.stringify(r && r.input)}`;
      const want = { bill: 'given', people: 'given', currency: 'given', tipPercent: 'default' };
      for (const [k, v] of Object.entries(want)) if (r.sources[k] !== v) return `${k} is "${r.sources[k]}", not "${v}"`;
      const first = await ask('split the bill 4 ways');
      if (!first.ask) return `no question for the bill: ${said(first)}`;
      const answered = await ask('60', { pending: { ...first, plan: first.plan, ask: first.ask, message: first.message, routing: first.routing, mode: first.mode } });
      const a = (answered.results || []).find(x => x.skill === 'splitBill');
      return (a && a.sources && a.sources.bill === 'asked') || `an answered field is recorded as ${a && a.sources && a.sources.bill}`;
    });

    check('a default is not said back as if it were given: no tip, no "between 1 person", and the £ stays', async () => {
      const both = said(await ask('split £84.50', { plan: { steps: [{ id: 's1', skill: 'splitBill', input: { bill: 84.5, currency: '£' } }] } }));
      if (!/^£84\.50 in total, no tip\.$/.test(both)) return `bill only: ${both}`;
      const noTip = said(await ask('bill of £84.50 split 4 ways'));
      if (/0% tip/.test(noTip) || !/no tip/.test(noTip) || !/£21\.13, £21\.13, £21\.12 and £21\.12 each, between 4 people/.test(noTip)) return `no tip given: ${noTip}`;
      const noPeople = said(await ask('what is a 20% tip on £60'));
      if (/between 1 person/.test(noPeople) || !/£72\.00 in total with a 20% tip\./.test(noPeople)) return `nobody counted: ${noPeople}`;
      const all = said(await ask('split an 84.50 bill 4 ways with 15% tip'));
      return /97\.18 in total with a 15% tip — 24\.30, 24\.30, 24\.29 and 24\.29 each, between 4 people\./.test(all) || `everything given: ${all}`;
    });

    check('the variant wording is chosen only when every field it names defaulted', () => {
      const sb = registry.skill('splitBill');
      if (templateFor(sb, null) !== sb.replyTemplate) return 'a turn with no sources did not keep the plain template';
      if (templateFor(sb, { tipPercent: 'default', people: 'given' }) !== sb.replyWhenDefault[1].template) return 'tip-only default picked the wrong words';
      return templateFor(sb, { tipPercent: 'given', people: 'given' }) === sb.replyTemplate || 'a fully given split was reworded';
    });

    check('a variant keyed on a field with no default, or a long title or label, is refused at load', () => {
      const bad = { ...registry.skill('splitBill'), name: 'badSplit', title: 'A title that is far too long to fit', replyWhenDefault: [{ defaults: ['bill'], template: '{{total}}' }] };
      const msg = lintEntry(bad).join(' | ');
      return (/names "bill", which has no default/.test(msg) && /title must be a string of at most 24/.test(msg)) || `not refused: ${msg.slice(0, 200)}`;
    });

    check('"15% of 84.50" is never answered as a bill, and percentOf is on the planner’s list', async () => {
      const t = await ask('15% of 84.50');
      const r = (t.results || [])[0];
      if (r && r.skill === 'splitBill') return `answered as a bill: ${said(t)}`;
      return (t.routing && t.routing.forPlanner.some(c => c.name === 'percentOf')) || `percentOf is not a candidate: ${JSON.stringify(t.routing && t.routing.forPlanner.map(c => c.name))}`;
    });

    check('the skill line shows what was given or answered, and never a default or the date', async () => {
      const t = await ask('split a £84.50 bill between 4 people');
      const took = tookAs(t);
      if (!took || took.skill !== 'Split a bill' || took.values.join(' ') !== '£84.50 4') return JSON.stringify(took);
      return (!took.fields.some(f => f.field === 'tipPercent')) || 'a defaulted tip was shown as given';
    });
  }

  /* ── E2: a Reply carries the answer it replies to ────────────────────── */
  check('without a Reply the planner prompt is unchanged, and with one it lists the answer’s values as refs', async () => {
    const { plannerUserMessage, plannerSystem, earlierAnswerBlock, SYSTEM } = await import('../src/planner.js');
    const cards = [registry.compactCard('splitBill')];
    const pctx = { now: '2026-09-01T09:00:00Z', timezone: 'UTC', locale: 'en-GB' };
    if (earlierAnswerBlock(null) !== '' || earlierAnswerBlock({ results: [{ id: 's1', ok: false }] }) !== '') return 'a block was drawn with nothing to carry';
    const plain = plannerUserMessage({ message: 'split it 3 ways', cards, ctx: pctx });
    if (/EARLIER ANSWER/.test(plain) || plannerSystem({}) !== SYSTEM) return 'the prompt changed without a Reply';
    const carry = { message: 'dinner', results: [{ id: 's1', ok: true, skill: 'splitBill', value: { total: 97.18, perPerson: [24.3] } }] };
    const withIt = plannerUserMessage({ message: 'split it 3 ways', cards, ctx: pctx, carry });
    if (!/EARLIER ANSWER[\s\S]*total = 97\.18 \("\$prev\.s1\.total"\)[\s\S]*MESSAGE\nsplit it 3 ways/.test(withIt)) return withIt;
    if (/perPerson/.test(withIt)) return 'a list was offered as a single figure';
    return /5b\. When the message refers to a value in the EARLIER ANSWER/.test(plannerSystem({ carry: true })) || 'no rule goes with the block';
  });

  check('a reply reports only the earlier figures it really used, and a carry needs typed words', async () => {
    const { prevRefsUsed } = await import('../src/turn.js');
    const prevResults = [{ id: 's1', ok: true, skill: 'splitBill', value: { total: 97.18 } }];
    const plan = { steps: [{ id: 's1', skill: 'splitEvenly', input: { amount: '$prev.s1.total', parts: 3 } }, { id: 's2', skill: 'roundTo', input: { value: '$prev.s1.nothing' } }] };
    const used = prevRefsUsed(plan, [{ id: 's1', ok: true }, { id: 's2', ok: true }], prevResults);
    if (used.length !== 1 || used[0].value !== 97.18 || used[0].field !== 'total') return JSON.stringify(used);
    if (prevRefsUsed(plan, [{ id: 's1', ok: false }], prevResults).length) return 'a failed step was reported as having used a figure';
    const e2ctx = { now: '2026-09-01T09:00:00Z', timezone: 'UTC', locale: 'en-GB', units: 'metric', webEnabled: false, confirmBeforeNetwork: true };
    let seen = 'unset';
    const spy = async ({ carry }) => { seen = carry; return { steps: [] }; };
    await runTurn('split 100 3 ways', { registry, router: new LexicalRouter(registry), ctx: { ...e2ctx }, planner: spy, carry: { results: prevResults }, source: 'handed-over' });
    if (seen !== null) return 'a carry reached the planner on words nobody typed';
    await runTurn('split 100 3 ways', { registry, router: new LexicalRouter(registry), ctx: { ...e2ctx }, planner: spy, carry: { results: prevResults } });
    return (seen && seen.results === prevResults) || 'a typed Reply did not carry its answer';
  });

  check('a Reply’s plan is lined up with the answer it carries, and only when a Reply carries one', async () => {
    const { alignToCarry, headlineFigure, namedFigure } = await import('../src/carry.js');
    const carry = {
      results: [{ id: 's1', ok: true, skill: 'splitBill', value: { total: 97.18, tip: 12.68, people: 4 } }],
      reply: { segments: [{ type: 'value', field: 'total', step: 's1', raw: 97.18 }] }
    };
    const run = (steps, message) => alignToCarry({ steps }, { carry, message, registry }).plan.steps[0].input;
    if (headlineFigure(carry).field !== 'total') return 'the headline is not the first figure the reply showed';
    if (namedFigure(carry, 'round the tip to 0 places').field !== 'tip') return 'a named figure was not found';
    const a = run([{ id: 's1', skill: 'applyTax', input: { amount: '$s1.total', rate: 20 } }], 'add 20% vat to the total');
    if (a.amount !== '$prev.s1.total') return `$s1 was not read as the earlier answer: ${JSON.stringify(a)}`;
    const b = run([{ id: 's1', skill: 'applyDiscount', input: { price: 97.18, percent: 10 } }], 'take 10% off it');
    if (b.price !== '$prev.s1.total') return `a re-typed figure stayed a number: ${JSON.stringify(b)}`;
    const c = run([{ id: 's1', skill: 'roundTo', input: { value: 3.14159, places: 0 } }], 'round the tip to 0 decimal places');
    if (c.value !== '$prev.s1.tip' || c.places !== 0) return `an invented number was not replaced by the named figure: ${JSON.stringify(c)}`;
    const d = run([{ id: 's1', skill: 'splitEvenly', input: { amount: 3 } }], 'split that 3 ways');
    if (d.amount !== '$prev.s1.total') return `"that" did not take the carried field: ${JSON.stringify(d)}`;
    const e = run([{ id: 's1', skill: 'splitEvenly', input: { amount: 60, parts: 3 } }], 'split 60 between 3');
    if (e.amount !== 60) return `a message with its own numbers was rewritten: ${JSON.stringify(e)}`;
    const own = alignToCarry({ steps: [{ id: 's1', skill: 'simpleInterest', input: { principal: '$prev.s1.total', rate: 4, years: 2 } }] }, { carry, message: 'simple interest on 2000 at 4% for 2 years', registry });
    if ('principal' in own.plan.steps[0].input || !own.repairs.some(r => /its own number/.test(r.why))) return `a message with its own number still carried: ${JSON.stringify(own.plan.steps[0].input)}`;
    const named = alignToCarry({ steps: [{ id: 's1', skill: 'applyDiscount', input: { price: '$prev.s1.total', percent: 10 } }] }, { carry, message: 'take 10% off the total', registry });
    if (named.plan.steps[0].input.price !== '$prev.s1.total') return 'a named figure with no spare number lost its carry';
    const none = alignToCarry({ steps: [{ id: 's1', skill: 'applyTax', input: { amount: 250, rate: 20 } }] }, { carry: null, message: 'add 20% vat to that', registry });
    return (none.repairs.length === 0 && none.plan.steps[0].input.amount === 250) || 'a plan with no carried answer was changed';
  });

  check('a Reply that names one operation runs that operation on the figure it points at, and nothing else is rewritten', async () => {
    const { alignToCarry, namedOperation } = await import('../src/carry.js');
    const carry = {
      results: [{ id: 's1', ok: true, skill: 'applyTax', input: { amount: 100, rate: 20 }, value: { net: 100, tax: 20, gross: 120, rate: 20 } }],
      reply: { segments: [{ type: 'value', field: 'gross', step: 's1', raw: 120 }] }
    };
    const align = (steps, message) => alignToCarry({ steps }, { carry, message, registry });
    /* The shapes the planner produced in rounds 2–3. */
    const stack = align([{ id: 's1', skill: 'stackDiscounts', input: { price: '$prev.s1.gross', discounts: [5] } }, { id: 's2', skill: 'applyDiscount', input: { price: '$s1.result', percent: 5 } }], 'take 5% off that');
    if (JSON.stringify(stack.plan.steps) !== JSON.stringify([{ id: 's1', skill: 'applyDiscount', input: { price: '$prev.s1.gross', percent: 5 } }])) return `stackDiscounts: ${JSON.stringify(stack.plan.steps)}`;
    const even = align([{ id: 's1', skill: 'allocateProportionally', input: { total: '$prev.s1.gross', weights: [6, 6, 6, 6, 6, 6] } }], 'share that equally between 6');
    if (even.plan.steps[0].skill !== 'splitEvenly' || even.plan.steps[0].input.parts !== 6 || even.plan.steps[0].input.amount !== '$prev.s1.gross') return `even split: ${JSON.stringify(even.plan.steps)}`;
    const again = align([{ id: 's1', skill: 'applyTax', input: { amount: 100, rate: 5 } }], 'round the tax to 1 decimal place');
    if (JSON.stringify(again.plan.steps[0]) !== JSON.stringify({ id: 's1', skill: 'roundTo', input: { value: '$prev.s1.tax', places: 1 } })) return `round: ${JSON.stringify(again.plan.steps)}`;
    const vat = align([{ id: 's1', skill: 'percentOf', input: { percent: 5, value: '$prev.s1.gross' } }], 'add 5% vat to it');
    if (vat.plan.steps[0].skill !== 'applyTax' || vat.plan.steps[0].input.rate !== 5) return `vat: ${JSON.stringify(vat.plan.steps)}`;
    /* Said in other words (round 5): no digit for "whole", fractions, less/minus, per head. */
    const said = { 'round it to the nearest whole number': ['roundTo', {}], 'less 10%': ['applyDiscount', { percent: 10 }], 'minus 25% from it': ['applyDiscount', { percent: 25 }],
      'what is a quarter of that': ['percentOf', { percent: 25 }], 'put 20% vat on that': ['applyTax', { rate: 20 }], 'what is that per head for 4 of us': ['splitEvenly', { parts: 4 }] };
    for (const [m, [skill, params]] of Object.entries(said)) {
      const op = namedOperation(m);
      if (!op || op.skill !== skill || JSON.stringify(op.params) !== JSON.stringify(params)) return `"${m}" read as ${JSON.stringify(op)}`;
    }
    if (namedOperation('what is half of 80')) return 'a fraction of a figure the message gives was read as a reply';
    const ex = await jsExtractor(registry)({ message: 'round 12.6 to the nearest whole number', skill: registry.skill('roundTo'), input: { value: 12.6 }, ctx: FIXED_CTX });
    if (ex.places !== 0) return `the extractor did not read "nearest whole number" as 0 places: ${JSON.stringify(ex)}`;
    /* Left to the planner: a figure of its own, two operations, no operation, or nothing pointed at. */
    for (const m of ['take 10% off the price of 250', 'split 120 between 4', 'add 20% vat and split it between 2', 'what does that come to in euros']) {
      if (namedOperation(m) && !/euros/.test(m)) return `"${m}" was read as one operation`;
    }
    const own = align([{ id: 's1', skill: 'applyDiscount', input: { price: 250, percent: 10 } }], 'take 10% off the price of 250');
    if (own.plan.steps[0].skill !== 'applyDiscount' || JSON.stringify(own.plan).includes('$prev')) return 'a message with its own figure was carried or rewritten';
    const right = align([{ id: 's1', skill: 'applyDiscount', input: { price: '$prev.s1.gross', percent: 5 } }], 'take 5% off that');
    if (right.repairs.length) return 'a plan that was already the operation was repaired';
    const nothing = alignToCarry({ steps: [{ id: 's1', skill: 'stackDiscounts', input: { price: 80, discounts: [5] } }] }, { carry: null, message: 'take 5% off that', registry });
    return (nothing.plan.steps[0].skill === 'stackDiscounts' && !nothing.repairs.length) || 'rewritten without a carried answer';
  });

  check('carry is marked on at most one number per skill', () => {
    for (const s of registry.routable()) {
      const marked = Object.entries((s.inputSchema && s.inputSchema.properties) || {}).filter(([, p]) => p && p.carry);
      if (marked.length > 1) return `${s.name} marks ${marked.length}`;
      if (marked.length && !['number', 'integer'].includes(marked[0][1].type)) return `${s.name} marks a ${marked[0][1].type}`;
    }
    const bad = { ...registry.skill('roundTo'), name: 'badRound', inputSchema: { type: 'object', required: ['value'], properties: { value: { type: 'number', carry: true }, places: { type: 'integer', carry: true } } } };
    return /only one field may be marked carry/.test(lintEntry(bad).join(' ')) || 'two carried fields were not refused';
  });

  check('the window carries an answer only on a Reply to a worked-out Patch answer', () => {
    const app = readFileSync(join(ROOT, 'src/app.js'), 'utf8');
    if (!/carry: pending \? null : carryFor\(c, quoteId\)/.test(app)) return 'say() does not pass the quoted answer';
    const fn = app.slice(app.indexOf('function carryFor ('), app.indexOf('function changeValueFrom ('));
    if (!(/t\.lane !== 'B'/.test(fn) && /markFor\(t\) === MARKS\.WORKED/.test(fn))) return 'a written or failed reply could be carried';
    /* Until followups.mjs passes its bar, nothing is carried at all. Flipping
       this is a measured decision: change the test in the same commit. */
    return (/const REPLY_CARRIES = false;/.test(app) && /if \(!REPLY_CARRIES\) return null;/.test(fn)) || 'Reply carrying is switched on without a passing bench';
  });

  /* ── bugs the label review found in individual skills ──────────────── */
  {
    const run1 = async (skill, input) => (await runPlan({ steps: [{ id: 's1', skill, input }] }, { registry, ctx: FIXED_CTX })).results[0];
    check('numberToWords: money names the minor unit of its currency — dollars and cents, not dollars and pence', async () => {
      const usd = await run1('numberToWords', { value: 5.5, style: 'currency', currency: 'dollars' });
      const gbp = await run1('numberToWords', { value: 105.5, style: 'currency', currency: 'pounds' });
      return (usd.ok && usd.value.words === 'five dollars and fifty cents' && gbp.value.words === 'one hundred and five pounds and fifty pence') || `${usd.value?.words} / ${gbp.value?.words}`;
    });
    check('formatNumber: the percent style takes a fraction, and its field says so', () => {
      const d = registry.skill('formatNumber').inputSchema.properties.value.description || '';
      return /0\.15 is 15%/.test(d) || `value's description: "${d}"`;
    });
    check('tokenizeWords: the unique count agrees with the de-duplicated list when case is kept', async () => {
      const r = await run1('tokenizeWords', { text: 'Red red green', unique: true });
      return (r.ok && r.value.tokens.length === r.value.unique && r.value.unique === 3) || JSON.stringify(r.value);
    });
    check('extractCurrencyAmounts: "5 PMS" is not money, and a repeated amount keeps its own place', async () => {
      const pms = await run1('extractCurrencyAmounts', { text: 'I get 5 PMS a week and paid 12 GBP' });
      if (!pms.ok || pms.value.formatted.join('|') !== '12 GBP') return `read as money: ${pms.value.formatted.join('|')}`;
      const order = await run1('extractCurrencyAmounts', { text: '$5 then 10 USD then $5' });
      return order.value.formatted.join('|') === '$5|10 USD|$5' || `order: ${order.value.formatted.join('|')}`;
    });
    check('daysBetween: counting both end days of a single day is 1', async () => {
      const r = await run1('daysBetween', { from: '2026-04-03', to: '2026-04-03', inclusive: true });
      return (r.ok && r.value.days === 1) || `got ${r.value?.days}`;
    });
    check('expandRecurrence: a count given with an end date stops at whichever comes first', async () => {
      const both = await run1('expandRecurrence', { start: '2026-01-05', every: 'week', count: 3, until: '2026-12-31' });
      const until = await run1('expandRecurrence', { start: '2026-01-05', every: 'week', until: '2026-03-02' });
      return (both.ok && both.value.count === 3 && until.value.count === 9) || `${both.value?.count} / ${until.value?.count}`;
    });
    check('addDuration: the schema says the amount is a whole number, as run requires', () =>
      registry.skill('addDuration').inputSchema.properties.amount.type === 'integer' || 'amount is still any number');
    check('checkPalindrome: loose mode keeps accented letters — "été" is a palindrome, "étés" is not', async () => {
      const yes = await run1('checkPalindrome', { text: 'Été' });
      const no = await run1('checkPalindrome', { text: 'étés' });
      return (yes.value.isPalindrome === true && yes.value.normalised === 'été' && no.value.isPalindrome === false) || `${yes.value.normalised} ${yes.value.isPalindrome} / ${no.value.isPalindrome}`;
    });
    check('generateTableOfContents: a ~~~ fence hides its lines the way extract-headings does', async () => {
      const r = await run1('generateTableOfContents', { markdown: '# Real\n\n~~~\n# not a heading\n~~~\n\n## Also real' });
      return (r.ok && !JSON.stringify(r.value).includes('not a heading')) || JSON.stringify(r.value).slice(0, 200);
    });
    check('randomNumber: asking for more different numbers than the range holds is refused, not quietly shortened', async () => {
      const r = await run1('randomNumber', { min: 0, max: 0.0005, seed: 1, count: 20, whole: false, unique: true });
      return (!r.ok && r.error.code === 'INVALID_INPUT' && r.error.field === 'count') || `returned ${r.value?.count} numbers`;
    });
    check('budgetSplit: no dead split left behind', () =>
      !/void shares/.test(readFileSync(join(ROOT, 'skills/budget-split.js'), 'utf8')) || 'dead code still there');
  }

  check('every field a person can give a routable skill has a label', () => {
    const app = new Set(['now', 'timezone', 'locale', 'units', 'webEnabled']);
    const missing = [];
    for (const s of registry.routable()) {
      for (const [k, p] of Object.entries((s.inputSchema && s.inputSchema.properties) || {})) if (!app.has(k) && !(p && p.label)) missing.push(`${s.name}.${k}`);
    }
    if (missing.length) return `unlabelled: ${missing.slice(0, 8).join(', ')}${missing.length > 8 ? ` and ${missing.length - 8} more` : ''}`;
    const L = registry.skill('convertLength').inputSchema.properties;
    return (L.amount.label === 'length' && L.from.label === 'from unit' && registry.skill('convertMass').inputSchema.properties.amount.label === 'weight') || 'converter labels';
  });

  check('each value on the skill line is named on hover ("bill"), and the Change sheet says "Change `bill` value"', async () => {
    const run = await runPlan({ steps: [{ id: 's1', skill: 'splitBill', input: { bill: 84.5, tipPercent: 12, people: 4 } }] }, { registry, ctx: FIXED_CTX });
    const r = run.results[0];
    if (!r.fieldLabels || r.fieldLabels.bill !== 'bill' || r.fieldLabels.tipPercent !== 'tip %') return `recorded labels: ${JSON.stringify(r.fieldLabels)}`;
    const turn = { id: 'T1', message: 'split £84.50 4 ways with a 12% tip', results: [{ ...r, sources: { bill: 'given', tipPercent: 'given', people: 'given' } }] };
    const html = tookAsHtml(turn);
    for (const label of ['bill', 'tip %', 'people']) if (!html.includes(`data-label="${label}"`)) return `no hover label "${label}": ${html}`;
    const plain = tookAs({ message: 'how many km is 26.2 miles', results: [{ ok: true, skill: 'convertLength', input: { amount: 26.2, from: 'miles', to: 'km' }, sources: { amount: 'given', from: 'given', to: 'given' } }] });
    if (plain.fields.map(f => f.label).join() !== 'amount,from,to') return `fields without a recorded label read ${plain.fields.map(f => f.label).join()}`;
    const app = readFileSync(join(ROOT, 'src/app.js'), 'utf8');
    return /Change <code class="cv-label">\$\{esc\(label\)\}<\/code> value/.test(app) || 'the Change sheet title is not "Change `label` value"';
  });

  check('a plan that copied "£84.50" as 84.5 still answers in pounds, and a hand-written plan is not given a currency', async () => {
    const planner = async () => ({ steps: [{ id: 's1', skill: 'splitBill', input: { bill: 84.5, tipPercent: 12, people: 4 } }] });
    const t = await runTurn('split £84.50 4 ways with a 12% tip', { registry, router: new LexicalRouter(registry), extractor: jsExtractor(registry), planner, ctx: FIXED_CTX });
    const r = t.results && t.results[0];
    if (!r || r.input.currency !== '£' || r.sources.currency !== 'given' || r.value.currency !== '£') return JSON.stringify(r && r.input);
    const plain = await runPlan({ steps: [{ id: 's1', skill: 'splitBill', input: { bill: 84.5 } }] }, { registry, ctx: FIXED_CTX });
    return plain.results[0].input.currency === undefined || 'a plan with no message was given a currency';
  });

  check('a value on the skill line can be changed: one step re-worked with what you gave, anything else opens Edit', () => {
    const bub = readFileSync(join(ROOT, 'src/ui/bubbles.js'), 'utf8');
    const app = readFileSync(join(ROOT, 'src/app.js'), 'utf8');
    if (!/data-do="change-value"/.test(bub)) return 'the values on the skill line are not buttons';
    if (!/case 'change-value': changeValueFrom\(el\.dataset\.turn, el\.dataset\.field, el\.dataset\.shown\)/.test(app)) return 'nothing handles a change';
    const changedTurn = { message: 'split a £84.50 bill between 4 people', changed: { field: 'bill', from: 84.5, to: 100 },
      results: [{ ok: true, skill: 'splitBill', title: 'Split a bill', input: { bill: 100, people: 4, currency: '£', tipPercent: 0 }, sources: { bill: 'given', people: 'given', currency: 'given', tipPercent: 'default' } }] };
    const shownChange = tookAs(changedTurn).values.join(' ');
    if (shownChange !== '£100.00 4') return `a changed value reads "${shownChange}"`;
    const from = app.slice(app.indexOf('function changeValueFrom ('), app.indexOf('async function changeValue ('));
    if (!/startEdit\(turnId\)/.test(from) || !/results\.length === 1/.test(from) || !/webSentAt/.test(from)) return 'a multi-step or web answer is not sent to Edit';
    const run = app.slice(app.indexOf('async function changeValue ('), app.indexOf('/* ctx for a turn.'));
    if (!/r\.sources\[k\] === 'given' \|\| r\.sources\[k\] === 'asked'/.test(run)) return 'defaults are carried into the change as if given';
    return /parentId: t\.parentId \?\? null/.test(run) || 'a change does not land as a new version of the same message';
  });

  check('I took this as shows only what was in your words, never a default', () => {
    const t = { lane: 'A', message: 'split 84.50 4 ways', results: [{ id: 's1', skill: 'splitBill', ok: true, input: { bill: 84.5, people: 4, tipPercent: 0, currency: 'en-GB' } }] };
    const took = tookAs(t);
    const answered = tookAs({ ...t, message: 'split it 4 ways', answered: { field: 'bill', value: '£84.50' } });
    return (took.skill === 'Split bill' && took.values.join(',') === '84.50,4' && answered.values.join(',') === '84.50,4')
      || JSON.stringify({ took, answered });
  });

  check('the line under a reply opens Message info, and every reply offers Copy on hover', () => {
    const t = { id: 'M1', lane: 'A', message: 'split 84.50 4 ways', mode: MODES.SINGLE_SKILL,
      results: [{ id: 's1', skill: 'splitBill', ok: true, input: { bill: 84.5, people: 4 }, provenance: { kind: 'computed' } }],
      reply: { segments: [{ type: 'value', text: '21.13', step: 's1', skill: 'splitBill', field: 'perPerson', provenance: { kind: 'computed' } }] } };
    const last = turnHtml(t, { pigeon: pigeonOf('patch'), last: true, longMark: true, tip: 'figure' });
    const older = turnHtml(t, { pigeon: pigeonOf('patch') });
    return (/class="mark worked" data-do="info" data-turn="M1"/.test(last) && /Worked out from the inputs above/.test(last)
      && /data-do="copy-a" data-turn="M1"/.test(last) && /tip-figure/.test(last) && /Click anything underlined/.test(last)
      && /data-do="copy-a" data-turn="M1"/.test(older) && /Worked out</.test(older)) || last.slice(0, 600);
  });

  check('a decline offers chips that type a skill’s own example, never forcing the skill onto the question', () => {
    const t = { id: 'D1', lane: 'A', message: 'how many teaspoons in a tablespoon', mode: MODES.NO_SKILL, results: [],
      suggestions: [{ name: 'convertUnits', score: 0.3 }, { name: 'nope', score: 0.2 }], routing: { candidates: [{ name: 'convertUnits', score: 0.3 }], threshold: 0.42 } };
    const html = turnHtml(t, { pigeon: pigeonOf('patch'), canChat: true, exampleFor: (n) => (n === 'convertUnits' ? '3 tsp in tbsp' : null) });
    return (/data-do="type-chip" data-text="3 tsp in tbsp"/.test(html) && !/data-force/.test(html) && !/0\.30|0\.42/.test(html)
      && /Couldn’t answer/.test(html)) || html.slice(0, 600);
  });

  check('Message info says how a reply was made, and keeps the plan for developers only', () => {
    const worked = messageInfoHtml({ id: 'w', lane: 'A', message: 'split 84.50 4 ways', at: 1000, repliedAt: 2200,
      results: [{ id: 's1', skill: 'splitBill', ok: true, input: { bill: 84.5, people: 4 }, provenance: { kind: 'computed' } }], reply: { segments: [] } },
    { name: 'Patch', planHtml: '<div class="plan">P</div>', now: 2200 });
    const written = messageInfoHtml({ id: 'p', lane: 'B', message: 'hi', reply: { text: 'hello' } }, { name: 'Pen', kind: 'base' });
    const dropped = messageInfoHtml({ id: 'h', lane: 'B', message: 'how much each', reply: { text: 'x' }, handoff: { numbers: ['29.13'] } }, { name: 'Pen', kind: 'base' });
    const job = messageInfoHtml({ id: 'j', lane: 'B', message: 'buying milk', reply: { text: 'Milk Run' } }, { name: 'Title Maker', kind: 'job' });
    return (/Worked out/.test(worked) && /Split bill/.test(worked) && /Nothing left this Mac/.test(worked) && /\(1\.2 s\)/.test(worked)
      && /<details class="mi-dev"><summary>Details for developers<\/summary><div class="plan">P/.test(worked)
      && /Nothing checked it/.test(written) && /29\.13/.test(dropped) && /dropped it rather than show a guess/.test(dropped)
      && /exactly as you typed it/.test(job)) || [worked, written, dropped, job].join('\n\n').slice(0, 900);
  });
}

/* ── Messages With Receipts: sends queue, the status line, the ask bar, banners ── */
{
  check('a message sent while a reply is on its way waits in view, held while Patch’s question is open, with Send them after a relaunch', () => {
    const items = [{ id: 'q1', text: 'and the capital of Japan?' }, { id: 'q2', text: 'thanks' }];
    const waiting = queuedHtml(items, {});
    const held = queuedHtml(items, { held: true, askName: 'Patch' });
    const idle = queuedHtml(items, { idle: true });
    return (/>Waiting</.test(waiting) && (waiting.match(/data-do="drop-queued"/g) || []).length === 2 && !/Send them/.test(waiting)
      && /Waiting for your answer to Patch/.test(held) && /2 messages are waiting to be sent/.test(idle) && /data-do="send-queued"/.test(idle)
      && queuedHtml([], { idle: true }) === '') || idle;
  });

  check('a skipped question says Skipped, and an open one says Waiting on you', () => {
    const t = { id: 'AK', lane: 'A', message: 'split it 4 ways', ask: { question: 'How much was the bill?', skill: 'splitBill' } };
    const open = turnHtml(t, { pigeon: pigeonOf('patch'), last: true, pending: true });
    const skipped = turnHtml(t, { pigeon: pigeonOf('patch'), last: true, pending: false, skipped: true });
    return (/Waiting on you/.test(open) && /class="mark waiting"/.test(open) && />Skipped</.test(skipped) && /class="mark skipped"/.test(skipped)
      && /bub ai ask folded/.test(skipped)) || skipped;
  });

  check('the typing turn carries the status line, and a banner names who replied and where', () => {
    const f = { message: 'hi', sentAt: 1, stage: 'waking the models' };
    const html = inflightHtml(f, pigeonOf('chat'), { status: 'Waking Pen · about 14 s' });
    const quiet = inflightHtml(f, pigeonOf('chat'));
    const b = bannerHtml({ chatId: 'c9', name: 'Title Maker', title: 'buying milk', text: 'Milk Run\nfor Sam' });
    return (/id="statusLine">Waking Pen · about 14 s</.test(html) && /class="receipt status empty" id="statusWrap"/.test(quiet)
      && /data-banner="c9"/.test(b) && /<b>Title Maker<\/b>/.test(b) && /Milk Run for Sam/.test(b)) || html;
  });

  check('a sheet pops in when it opens, never again when a click redraws its card', () => {
    const css = readFileSync(join(ROOT, 'styles/app.css'), 'utf8');
    const app = readFileSync(join(ROOT, 'src/app.js'), 'utf8');
    /* Settings rebuilds its card on every click and Play on every game picked;
       an unconditional pop on .sheet-card shook the whole dialog each time. */
    if (/(^|[}\s])\.sheet-card:not\(\.fr-card\)[^{]*\{[^}]*animation/m.test(css.replace(/\.sheet:not\(\.settled\) \.sheet-card/g, ''))) return 'a sheet card animates without the settled gate';
    if (!/\.sheet:not\(\.settled\) \.sheet-card:not\(\.fr-card\)[^{]*\{[^}]*animation:pop/.test(css)) return 'the opening pop is gone';
    const open = app.slice(app.indexOf('function openSheet ('), app.indexOf('function openSheet (') + 4000);
    return /classList\.add\('settled'\)/.test(open) || 'openSheet never settles the sheet';
  });

  check('banners stay inside the window: capabilities still grant core:default to main, the popover, the bar and the play overlay only', () => {
    const caps = JSON.parse(readFileSync(join(ROOT, 'src-tauri/capabilities/default.json'), 'utf8'));
    const app = readFileSync(join(ROOT, 'src/app.js'), 'utf8');
    return (JSON.stringify(caps.windows) === '["main","popover","bar","playhud"]' && JSON.stringify(caps.permissions) === '["core:default"]'
      && !/sendNotification|new Notification\(/.test(app)) || JSON.stringify(caps);
  });

  check('the window no longer refuses a second message', () => {
    const app = readFileSync(join(ROOT, 'src/app.js'), 'utf8');
    return !/Wait for this reply to finish/.test(app) || 'a send is still refused while a reply is on its way';
  });
}

/* ── Messages With Receipts: Reply, the memory edge, Ask someone else, notes ── */
{
  check('the reply bar says what the Pigeon will see of a quote', () => {
    const q = { id: 't1', who: 'Patch', text: '£29.14 each', question: 'split £87.40 three ways' };
    const patch = quoteBarHtml(q, { name: 'Patch', kind: 'verified' });
    const pen = quoteBarHtml({ ...q, who: 'Pen' }, { name: 'Pen', kind: 'base' });
    const gone = quoteBarHtml({ ...q, who: 'Pen' }, { name: 'Pen', kind: 'base', aboveEdge: true });
    const job = quoteBarHtml({ ...q, who: 'Title Maker' }, { name: 'Title Maker', kind: 'job' });
    return (/won’t carry these figures over yet/.test(patch) && /sees the last 12 back-and-forths/.test(pen) && /can’t see this one any more/.test(gone)
      && /only sees what you type below, not this quote/.test(job) && /data-do="edit-quoted" data-turn="t1"/.test(job)
      && /data-do="cancel-quote"/.test(patch)) || job;
  });

  check('a writer’s memory edge sits above the oldest turn it can still see', () => {
    const path = Array.from({ length: 14 }, (_, i) => ({ id: `t${i}` }));
    return (memoryEdgeIndex(path, 12) === 2 && memoryEdgeIndex(path.slice(0, 12), 12) === -1
      && /can’t see above this line · everything is still saved/.test(memoryEdgeHtml('Pen'))) || 'the edge is in the wrong place';
  });

  check('a quoted message shows its quote, and a note is buttons that never carry text to send', () => {
    const t = { id: 'Q1', lane: 'B', message: 'and shorter?', reply: { text: 'Milk Run' } };
    const html = turnHtml(t, { pigeon: pigeonOf('chat'), quote: { who: 'Pen', text: 'Here is a gentler way' }, last: true });
    const n = noteHtml(oneShotNote({ pigeon: { name: 'Title Maker', noun: 'title' }, text: 'shorter please', prevText: 'buying milk for Sam', penAvailable: true }));
    return (/class="q-strip">↩ Pen: Here is a gentler way/.test(html) && /data-do="quote" data-turn="Q1">Reply/.test(html)
      && /data-do="note-edit-last"/.test(n) && /data-do="note-ask-pen" data-frame="Give me a shorter title for: buying milk for Sam"/.test(n)
      && /data-do="note-send-anyway"/.test(n) && noteHtml(null) === '') || n;
  });

  check('Ask someone else puts your words in the other chat’s box and sends nothing', () => {
    const app = readFileSync(join(ROOT, 'src/app.js'), 'utf8');
    const body = (app.match(/function askSomeoneElse \([\s\S]*?\n}\n/) || [''])[0];
    const q = messageMenuItems({ id: 'x', lane: 'A' }, 'q');
    const a = messageMenuItems({ id: 'x', lane: 'A', results: [] }, 'a', { canChat: true });
    return (body && /turn\.message/.test(body) && !/\bsay\(/.test(body) && !/turn\.reply/.test(body) && !/function forwardTurn/.test(app)
      && q.find(i => i.id === 'forward').label === 'Ask someone else…' && q.some(i => i.id === 'reply') && a.some(i => i.id === 'reply')
      && /your question, not this reply/.test(a.find(i => i.id === 'fwd:chat').label)) || body.slice(0, 300);
  });
}

/* ── Messages With Receipts: the chat list by day, and search by day ── */
{
  check('the list sits under Today, Yesterday, Last 7 days and Earlier, and search finds last Tuesday', () => {
    const now = new Date(2026, 8, 14, 12).getTime();
    const mk = (id, back, title) => ({
      id, title, lane: 'A', personaId: null, createdAt: 1,
      lastActivityAt: new Date(2026, 8, 14 - back, 9, 41).getTime(),
      nodes: { [`${id}t`]: { id: `${id}t`, message: title, at: 1, parentId: null, activeChildId: null } }, activeRootId: `${id}t`
    });
    const chats = [mk('G1', 0, 'today one'), mk('G2', 1, 'yesterday one'), mk('G3', 6, 'buying milk for Sam'), mk('G4', 12, 'old one')];
    const html = chatListHtml({ chats, personas: [], now });
    const order = [...html.matchAll(/<div class="sec">([^<]+)<\/div>/g)].map(m => m[1]).join('|');
    const opts = { textOf: replyText, dayWordsOf: (c) => dayWords(c.lastActivityAt, now), nameOf: (c) => (c.id === 'G3' ? 'Title Maker' : 'Patch') };
    const tue = searchAll(chats, [], 'tuesday title', opts);
    const wed = searchAll(chats, [], 'wednesday title', opts);
    const todayOnly = chatListHtml({ chats: [mk('G5', 0, 'only today')], personas: [], now });
    const declined = { id: 'ND', lane: 'A', message: 'if I run a marathon at 5:30 per km how long will it take', mode: MODES.NO_SKILL, results: [], suggestions: [] };
    const offer = turnHtml(declined, { pigeon: pigeonOf('patch'), download: { size: '2.3 GB' } });
    const again = turnHtml(declined, { pigeon: pigeonOf('patch'), download: 'done' });
    const app = readFileSync(join(ROOT, 'src/app.js'), 'utf8');
    if (!/Without Pigeon’s download I can only match short questions/.test(offer) || !/data-do="download">Download 2\.3 GB/.test(offer)
      || !/data-do="ask-again" data-turn="ND">Ask again now/.test(again) || /needsFirstRun\([^)]*\)\)\s*\{\s*openModelsSheet\(\)/.test(app)) {
      return 'the download is not offered where it is needed, or the launch sheet is back';
    }
    return (order === 'Today|Yesterday|Last 7 days|Earlier' && /<time>Tuesday<\/time>/.test(html) && /<time>2 Sept<\/time>/.test(html)
      && tue.chats.map(c => c.id).join() === 'G3' && !wed.chats.length && !/class="sec"/.test(todayOnly))
      || JSON.stringify({ order, tue: tue.chats.map(c => c.id), wed: wed.chats.map(c => c.id) });
  });
}

/* ── Messages With Receipts: a Pigeon's page ── */
{
  const cast = [
    { id: 'mood', name: 'Mood Tagger', kind: 'classifier', output_type: 'label', labels: ['urgent', 'waiting', 'later'], loaded: true },
    { id: 'manual', name: 'Kitchen Manual', kind: 'grounded', retrieval: 'keyword-overlap-v1', loaded: false },
    { id: 'tutor', name: 'Socratic Tutor', kind: 'persona', loaded: true, shape: 'A' }
  ];

  check('a shape B voice is sent no history by the page, a shape A voice its last turns, and Rust asks the voice from its file', async () => {
    const { messagesFor } = await import('../src/lane-b/chat.js');
    const history = [{ lane: 'B', message: 'explain a direct debit', reply: { text: 'It is a…' } }];
    const a = messagesFor('and a standing order?', history, { id: 'v', name: 'V', shape: 'A' });
    const b = messagesFor('and a standing order?', history, { id: 'v', name: 'V', shape: 'B' });
    if (a.length !== 4 || b.length !== 2 || b[1].content !== 'and a standing order?') return `A ${a.length} / B ${b.length}`;
    const rust = readFileSync(join(ROOT, 'src-tauri/src/chat.rs'), 'utf8');
    /* The engine sends a voice what its file's `history` declares (D17, E3). */
    return (/chat_in_process\(&app, req, &kept\)/.test(rust) && /crate::inprocess::wanted\(&app, id\)/.test(rust)) || 'chat_complete does not ask the voice from its kept file';
  });

  check('a derived card says only what the file shows, and never invents examples', () => {
    const mood = deriveCard(pigeonOf('pigeon:mood', cast), cast[0]);
    const manual = deriveCard(pigeonOf('pigeon:manual', cast), cast[1]);
    const tutor = deriveCard(pigeonOf('pigeon:tutor', cast), cast[2]);
    const patch = deriveCard(pigeonOf('patch'));
    const pen = deriveCard(pigeonOf('chat'));
    return (mood.withoutCard && mood.answersWith.join() === 'urgent,waiting,later' && mood.remembers === 'Nothing — each message starts fresh'
      && manual.inside && manual.send === 'a question about what it carries' && tutor.remembers === 'The last 12 back-and-forths of a chat'
      && !patch.imported && patch.works && patch.leaves === 'Only a look-up you say yes to' && !pen.withoutCard
      && !('examples' in mood) && !('check' in mood)
      && deriveCard(pigeonOf('pigeon:tutor', [{ ...cast[2], shape: undefined }]), { ...cast[2], shape: undefined }).remembers.startsWith('Not measured for this voice yet')
      && deriveCard(pigeonOf('pigeon:tutor', [{ ...cast[2], shape: 'B' }]), { ...cast[2], shape: 'B' }).remembers === 'Nothing — each message starts fresh') || JSON.stringify({ mood, manual, tutor, patch });
  });

  check('a Pigeon’s page leads with what it does, lists your chats dated, and offers Continue and a box', () => {
    const now = new Date(2026, 8, 14, 12).getTime();
    const chats = [
      { id: 'n1', title: 'buying milk for Sam', lastActivityAt: new Date(2026, 8, 8, 9).getTime() },
      { id: 'n2', title: 'fixing the gate', lastActivityAt: new Date(2026, 8, 2, 9).getTime() }
    ];
    const d = pigeonOf('pigeon:mood', cast);
    const page = profileHtml(d, { chats, now, card: deriveCard(d, cast[0]), facts: [['Size', '38 MB']] });
    const patchPage = profileHtml(pigeonOf('patch'), { skills: 307, now });
    const empty = profileHtml(pigeonOf('chat'), { now });
    return (/<b>Continue:<\/b> buying milk for Sam · Tuesday/.test(page) && /Your chats with Mood Tagger/.test(page) && /<time>2 Sept<\/time>/.test(page)
      && /came without a card/.test(page) && /Answers with one of/.test(page) && /urgent, waiting, later/.test(page)
      && /<details class="p-details"><summary>Details for developers<\/summary>[\s\S]*38 MB[\s\S]*Remove Mood Tagger…/.test(page)
      && /id="pageMsg"[^>]*placeholder="Start a new chat with Mood Tagger"/.test(page)
      && !/Remove/.test(patchPage) && !/came without a card/.test(patchPage) && /Comes with Pigeon/.test(patchPage)
      && /No chats with Pen yet/.test(empty) && !/p-continue/.test(empty)) || page.slice(0, 900);
  });

  /* D83, from Kevin's click-through: a base Pigeon's page says it has no
     training of its own where a person looks, and what its maker's test ran on. */
  check('a base Pigeon’s page says it has no training of its own', async () => {
    const { BASE_TEST_NOTE } = await import('../src/ui/details.js');
    const plain = { id: 'plain', name: 'Plain English', kind: 'persona', loaded: true, base_only: true, card: { does: 'Explains a letter in plain English.', revision: 3 } };
    const d = pigeonOf('pigeon:plain', [plain]);
    const page = profileHtml(d, { card: deriveCard(d, plain) });
    if (!/<dt>Does the work<\/dt><dd>Writes · no training of its own · may be wrong<\/dd>/.test(page)) return page.slice(0, 1200);
    const maker = page.slice(page.indexOf('From its maker'), page.indexOf('These are its maker’s words'));
    if (!maker.includes(BASE_TEST_NOTE)) return `not under From its maker: ${maker}`;
    /* A trained one says neither. */
    const trained = { ...plain, base_only: false };
    const t = profileHtml(pigeonOf('pigeon:plain', [trained]), { card: deriveCard(pigeonOf('pigeon:plain', [trained]), trained) });
    return (!/no training of its own/.test(t) && /<dd>Writes · may be wrong<\/dd>/.test(t)) || t.slice(0, 1200);
  });

  check('a chat whose Pigeon was removed offers the way back, and an empty chat says what its Pigeon remembers', () => {
    const gone = removedHtml(pigeonOf('pigeon:deleted-one', cast));
    const tutorEmpty = emptyChatHtml(pigeonOf('pigeon:tutor', cast), {});
    const patchEmpty = emptyChatHtml(pigeonOf('patch'), {});
    const app = readFileSync(join(ROOT, 'src/app.js'), 'utf8');
    return (/deleted-one was removed from this Mac/.test(gone) && /data-do="import-pigeon">Add it again…/.test(gone)
      && /Remembers:<\/b> the recent back-and-forths/.test(tutorEmpty) && /Remembers:<\/b> nothing, each message starts fresh/.test(patchEmpty)
      && /class="contact" data-do="page"/.test(app)) || gone;
  });
}

/* ── Messages With Receipts: Settings, the theme, and the web by button ── */
{
  check('Settings has five tabs: appearance, models with This build, Pigeons, privacy with its log, and the developer views', () => {
    const now = new Date(2026, 8, 14, 14, 30).getTime();
    const settings = { ...defaultSettings(), theme: 'system', webLog: [{ at: new Date(2026, 8, 14, 14, 2).getTime(), text: '“capital of Japan” → DuckDuckGo and Wikipedia', hosts: [] }] };
    const general = settingsHtml({ tab: 'general', settings, now });
    const models = settingsHtml({ tab: 'models', settings, models: { words: 'Models asleep', canWake: true, buildRows: '<div class="stackrow">ROWS</div>' } });
    const pigeons = settingsHtml({ tab: 'pigeons', settings, pigeons: [{ pick: 'patch', name: 'Patch', does: 'Works out sums', removable: false }, { pick: 'pigeon:t', name: 'Title Maker', does: 'Titles', removable: true }] });
    const privacy = settingsHtml({ tab: 'privacy', settings, saved: 'Saved on this Mac, and nowhere else', now });
    const advanced = settingsHtml({ tab: 'advanced', settings, native: false });
    return (SETTINGS_TABS.length === 5 && /data-set="theme" data-value="system">Match Mac/.test(general) && /aria-checked="true" class="on" data-set="theme" data-value="system"/.test(general)
      && /id="buildStack"><div class="stackrow">ROWS/.test(models) && /data-s="wake"/.test(models)
      && (pigeons.match(/data-s="remove"/g) || []).length === 1 && /data-pick="pigeon:t"/.test(pigeons)
      && /Only when I press Look it up/.test(privacy) && /data-value="fallback">Also try the web/.test(privacy) && /aria-checked="true" class="on" data-set="webPolicy" data-value="press"/.test(privacy)
      && /aria-checked="true" class="on" data-set="webPolicy" data-value="fallback"/.test(settingsHtml({ tab: 'privacy', settings: { ...settings, webPolicy: 'fallback' }, now }))
      && /Send once/.test(privacy) && !/Send once/.test(settingsHtml({ tab: 'privacy', settings: { ...settings, webPolicy: 'never' }, now })) && /14:02<\/time><span>“capital of Japan” → DuckDuckGo and Wikipedia/.test(privacy)
      && /data-s="ledger">Reality vs\. Aspiration/.test(advanced)) || privacy.slice(0, 600);
  });

  check('Privacy says what is kept on this Mac, once, after the chats row', () => {
    const privacy = settingsHtml({ tab: 'privacy', settings: defaultSettings(), saved: 'Saved on this Mac', now: Date.now() });
    const kept = privacy.indexOf('Kept on this Mac');
    return (kept > privacy.indexOf('>Chats<') && privacy.includes(escHtml(KEPT_HERE))
      && /chats, as plain files/.test(KEPT_HERE) && /settings and the look-up log/.test(KEPT_HERE)
      && /pictures of that game/.test(KEPT_HERE) && /key the models/.test(KEPT_HERE) && /nothing is sent anywhere/.test(KEPT_HERE)
      && !/Kept on this Mac/.test(settingsHtml({ tab: 'general', settings: defaultSettings() }))) || privacy.slice(kept, kept + 300);
  });

  /* The dev server's three `/__` routes: the page it served, and nobody else. */
  check('the dev server answers its own page and refuses another origin, a bare local process and a cross-site fetch', () => {
    const P = 4173;
    const yes = [
      { host: 'localhost:4173' },
      { host: '127.0.0.1:4173', origin: 'http://127.0.0.1:4173' },
      { host: 'localhost:4173', origin: 'http://localhost:4173', 'sec-fetch-site': 'same-origin' },
      { host: 'LOCALHOST:4173', 'sec-fetch-site': 'none' },
      { host: '[::1]:4173' }
    ];
    const no = [
      {},
      { host: 'localhost:4174' },
      { host: 'pigeon.example:4173' },
      { host: 'localhost:4173', origin: 'https://evil.example' },
      { host: 'localhost:4173', origin: 'http://localhost:4174' },
      { host: 'localhost:4173', origin: 'null' },
      { host: 'localhost:4173', origin: 'not a url' },
      { host: 'localhost:4173', 'sec-fetch-site': 'cross-site' },
      { host: 'localhost:4173', 'sec-fetch-site': 'same-site' },
      { host: 'localhost:4173', origin: 'http://localhost:4173', 'sec-fetch-site': 'cross-site' }
    ];
    const badYes = yes.filter(h => !sameOrigin(h, P));
    const badNo = no.filter(h => sameOrigin(h, P));
    return (!badYes.length && !badNo.length) || `let in ${JSON.stringify(badNo)}; kept out ${JSON.stringify(badYes)}`;
  });

  check('a look-up Patch did not make offers Look it up, and a sent one says both sites under your question', () => {
    const blocked = { id: 'W1', lane: 'A', message: 'capital of Japan', mode: MODES.SINGLE_SKILL,
      results: [{ id: 's1', skill: 'webAnswer', ok: false, error: { code: 'NETWORK_OFF', message: 'webAnswer needs the web, and the web is off.' } }],
      reply: { segments: [{ type: 'failure', code: 'NETWORK_OFF', text: 'x' }] } };
    const ask = turnHtml(blocked, { pigeon: pigeonOf('patch') });
    const never = turnHtml(blocked, { pigeon: pigeonOf('patch'), webNever: true });
    const sent = turnHtml({ id: 'W2', lane: 'A', message: 'capital of Japan', webSentAt: new Date(2026, 8, 14, 14, 2).getTime(), results: [], reply: { segments: [] } }, { pigeon: pigeonOf('patch') });
    return (/That needs a look-up on the web/.test(ask) && /data-do="look-it-up" data-turn="W1">Look it up…/.test(ask) && !/NETWORK_OFF/.test(ask)
      && /set never to use the web/.test(never) && !/look-it-up/.test(never)
      && /Sent to DuckDuckGo and Wikipedia · 14:02/.test(sent)) || ask;
  });

  /* ── E3: a look-up waits for a yes ─────────────────────────────────────── */
  {
    const e3ctx = { now: '2026-09-01T09:00:00Z', timezone: 'UTC', locale: 'en-GB', units: 'metric', confirmBeforeNetwork: true };
    const plan = { steps: [{ id: 's1', skill: 'webAnswer', input: { question: 'governor of Maryland' } }] };
    const found = async (q) => ({ answer: `Answer for ${q}.`, source: 'https://en.wikipedia.org/wiki/Wes_Moore', answeredBy: 'wikipedia', results: [] });

    check('a look-up that could be made stops and asks, one that cannot fails as it always did', async () => {
      const paused = await runPlan(plan, { registry, ctx: { ...e3ctx, webEnabled: false, webAvailable: true } });
      if (paused.outcome !== OUTCOME.CONSENT_WEB) return `outcome ${paused.outcome}`;
      const c = paused.consent;
      if (c.step !== 's1' || c.field !== 'question' || c.query !== 'governor of Maryland' || c.hosts.join(',') !== 'api.duckduckgo.com,en.wikipedia.org') return JSON.stringify(c);
      const off = await runPlan(plan, { registry, ctx: { ...e3ctx, webEnabled: false } });
      return (off.results[0] && off.results[0].error && off.results[0].error.code === 'NETWORK_OFF') || 'no provider did not fail as NETWORK_OFF';
    });

    check('a yes on the card sends what is in the box, and is not asked a second time', async () => {
      let sheet = 0;
      const run = await runPlan(plan, {
        registry, ctx: { ...e3ctx, webEnabled: true, search: found }, onNetworkConfirm: async () => { sheet++; return true; },
        consent: { step: 's1', field: 'question', query: 'Wes Moore' }
      });
      const r = run.results[0];
      if (sheet) return 'the sheet asked again after a yes on the card';
      return (r && r.ok && r.input.question === 'Wes Moore' && r.value.answer === 'Answer for Wes Moore.') || JSON.stringify(r);
    });

    check('a turn stops on the card, Send once looks it up, Don’t send leaves nothing sent', async () => {
      const base = { registry, router: new LexicalRouter(registry), extractor: jsExtractor(registry) };
      const first = await runTurn('', { ...base, ctx: { ...e3ctx, webEnabled: false, webAvailable: true }, plan });
      if (!first.consent || first.reply !== null || markFor(first) !== MARKS.WAITING) return `not waiting: ${JSON.stringify(first.consent)} ${markFor(first)}`;
      const sent = await runTurn('', { ...base, ctx: { ...e3ctx, webEnabled: true, confirmBeforeNetwork: false, search: found }, pending: first, consent: { send: true, query: 'Wes Moore' } });
      if (sent.consent || markFor(sent) !== MARKS.LOOKED || sent.results[0].input.question !== 'Wes Moore') return `send: ${markFor(sent)} ${JSON.stringify(sent.results[0] && sent.results[0].input)}`;
      const no = await runTurn('', { ...base, ctx: { ...e3ctx, webEnabled: false, webAvailable: true }, pending: first, consent: { send: false } });
      const err = no.results.find(r => r.error && r.error.code === 'NETWORK_OFF');
      return (no.consentDeclined && err && /nothing left this Mac/.test(err.error.message) && !no.consent) || JSON.stringify(no.results);
    });

    check('the card shows the exact query in a box, both sites, and Don’t send beside Send once', () => {
      const html = turnHtml({ id: 'C1', lane: 'A', message: 'who is the governor of Maryland', mode: MODES.PLANNED, results: [], reply: null,
        consent: { step: 's1', skill: 'webAnswer', field: 'question', query: 'governor of Maryland', hosts: ['api.duckduckgo.com', 'en.wikipedia.org'] } }, { pigeon: pigeonOf('patch') });
      return (/Send this to DuckDuckGo and Wikipedia\?/.test(html) && /data-consent-q="C1" value="governor of Maryland"/.test(html)
        && /data-do="consent-no" data-turn="C1">Don’t send/.test(html) && /data-do="consent-send" data-turn="C1">Send once/.test(html)
        && /Nothing has been sent yet/.test(html)) || html.slice(0, 500);
    });

    check('the window answers the card, logs a yes, logs a download, and Look it up asks again rather than sending', () => {
      const app = readFileSync(join(ROOT, 'src/app.js'), 'utf8');
      if (!/case 'consent-send':\s*case 'consent-no':/.test(app) || !/async function answerConsent \(/.test(app)) return 'nothing answers the card';
      const fn = app.slice(app.indexOf('async function answerConsent ('), app.indexOf('function carryFor ('));
      if (!/webLog = \[\.\.\.log, \{ at: lastWebSend\.at/.test(fn) || !/pending: t, consent: answer/.test(fn)) return 'a yes is not logged or not resumed';
      if (!/huggingface\.co/.test(app.slice(app.indexOf('async function startDownload')))) return 'a download is not written down';
      const look = app.slice(app.indexOf("case 'look-it-up':"), app.indexOf("case 'consent-send':"));
      return (!/webOnce = true/.test(look) && /webAvailable: Boolean\(search\) && state\.settings\.webPolicy !== 'never'/.test(app)) || 'Look it up still bypasses the card';
    });
  }

  /* ── E6: Pigeon reads a card ─────────────────────────────────────────────── */
  {
    const cardPersona = { id: 'coins', name: 'Coin Sorter', kind: 'text-to-text', loaded: true, output_type: 'label', labels: ['penny', 'dime'],
      card: { does: 'Sort coin photos by type.', input_hint: 'one photo', output_noun: 'label',
        examples: [{ input: 'what coin is this?', output: 'penny' }, { input: 'and this?', output: 'dime' }, { bad: true }],
        input_stats: { words: { p50: 4, p95: 20 }, lines: { p50: 1, p95: 1 } }, check: { passed: 5, total: 6 }, revision: 2, surprise: 'skipped' } };
    const coinD = pigeonOf('pigeon:coins', [cardPersona]);

    check('a card is read as the maker’s words, and a malformed part of it is left out', () => {
      const k = deriveCard(coinD, cardPersona);
      if (!k.maker || k.withoutCard || k.does !== 'Sort coin photos by type.' || k.send !== 'one photo') return JSON.stringify(k);
      if (k.maker.examples.length !== 2 || k.maker.check.passed !== 5 || k.maker.revision !== 2 || k.maker.wordsP95 !== 20) return JSON.stringify(k.maker);
      const none = deriveCard(coinD, { ...cardPersona, card: { does: '' } });
      return (!none.maker && none.withoutCard) || 'a card with no line was used';
    });

    check('the page shows the maker’s card, test and examples, with what reproduced on this Mac', () => {
      const html = profileHtml(coinD, { card: deriveCard(coinD, cardPersona), reproduced: [true, false] });
      return (/From its maker/.test(html) && /Passed 5 of 6 on its maker’s test/.test(html)
        && /what coin is this\?<\/span><span class="p-ex-out">→ penny<\/span><span class="p-tag ok">Reproduced on this Mac/.test(html)
        && /Came out differently on this Mac/.test(html) && !/came without a card/.test(html)) || html.slice(0, 900);
    });

    check('the maker’s block says which engine scored it, or that none was recorded', () => {
      const stamp = 'libpigeon 0.1.0 (llama.cpp 26394b4; spec 1; prefix-cache 2048)';
      const withEngine = profileHtml(coinD, { card: deriveCard(coinD, { ...cardPersona, report: { engine: stamp, graded_by_model: 0 } }) });
      const old = profileHtml(coinD, { card: deriveCard(coinD, { ...cardPersona, report: { engine: null } }) });
      const noReport = profileHtml(coinD, { card: deriveCard(coinD, cardPersona) });
      const line = (h) => (h.match(/<p class="p-claim p-engine">([^<]*)<\/p>/) || [])[1];
      if (line(withEngine) !== `Scored in ${stamp}`) return line(withEngine) || withEngine.slice(0, 900);
      if (line(old) !== 'Scored in an unrecorded engine' || line(noReport) !== 'Scored in an unrecorded engine') return `${line(old)} / ${line(noReport)}`;
      /* Inside From its maker, after the test line, in the same style. */
      return /From its maker[\s\S]*Passed 5 of 6[\s\S]*p-claim p-engine[\s\S]*These are its maker’s words/.test(withEngine) || withEngine.slice(0, 900);
    });

    check('a judged score is marked, and the mark says it can move by a couple of rows', () => {
      const judged = profileHtml(coinD, { card: deriveCard(coinD, { ...cardPersona, report: { graded_by_model: 3 } }) });
      const plain = profileHtml(coinD, { card: deriveCard(coinD, { ...cardPersona, report: { graded_by_model: 0 } }) });
      const mark = (judged.match(/Passed <abbr class="p-judged" title="([^"]*)">~<\/abbr>5 of 6/) || [])[1];
      if (!mark) return judged.slice(0, 900);
      if (!/^3 of these rows were judged by another model/.test(mark) || !mark.includes('A judged score can move by a couple of rows between rides.')) return mark;
      return (!/p-judged/.test(plain) && /Passed 5 of 6/.test(plain)) || 'a score no model judged was marked';
    });

    check('where its rows came from and where it was trained go under Details for developers', () => {
      const app = readFileSync(join(ROOT, 'src/app.js'), 'utf8');
      const fn = (app.match(/function pigeonFacts \(d\) \{[\s\S]*?\n}\n/) || [''])[0];
      return (/\['Test rows from', p\.report\.rows_source \|\| 'not recorded'\]/.test(fn) && /\['Trained on', p\.report\.trained_where \|\| 'not recorded'\]/.test(fn)) || fn.slice(-600);
    });

    check('an input far past its maker’s test is noted, and a grounded no offers what it covers', () => {
      const long = Array.from({ length: 80 }, () => 'word').join(' ');
      const n = testedLengthNote({ name: 'Coin Sorter', text: long, p95: 20 });
      if (!n || !/about 80 words/.test(n.text) || !/up to about 20/.test(n.text)) return JSON.stringify(n);
      if (testedLengthNote({ name: 'x', text: 'short', p95: 20 }) || testedLengthNote({ name: 'x', text: long, p95: null })) return 'a note for nothing';
      const no = turnHtml({ id: 'G1', lane: 'B', persona: 'manual', mode: 'generated', message: 'x', reply: { source: 'generated', text: '' }, noMaterial: true, contents: ['Downloads', 'Memory'] },
        { pigeon: { ...pigeonOf('chat'), kind: 'job', name: 'Kitchen Manual' } });
      return (/That isn’t in Kitchen Manual’s material/.test(no) && /It covers:/.test(no) && /data-do="type-chip" data-text="Downloads"/.test(no)) || no.slice(0, 500);
    });

    check('a drawing Pigeon\'s page shows its examples drawn, with the recipe a hover away, and the recipe where one did not draw', () => {
    const d = { kind: 'job', pick: 'pigeon:icons', id: 'icons', name: 'Icon Maker', does: 'Answers with a drawing', loaded: true };
    const persona = { id: 'icons', name: 'Icon Maker', skill: 'icon-parts', card: { does: 'Draws a small icon.', examples: [{ input: 'a red hat', output: '{"hat":"red"}' }, { input: 'a blue cup', output: '{"cup":"blue"}' }] } };
    const card = deriveCard(d, persona);
    const html = profileHtml(d, { card, drawings: ['<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>', null] });
    if (!/<img class="p-ex-art" alt="What it draws for “a red hat”" title="\{&quot;hat&quot;:&quot;red&quot;\}" src="data:image\/svg\+xml/.test(html)) return 'the first example is not drawn';
    if (!/→ \{&quot;cup&quot;:&quot;blue&quot;\}/.test(html)) return 'an example that did not draw lost its recipe';
    const plain = profileHtml(d, { card });
    if (/p-ex-art/.test(plain)) return 'pictures without drawings';
    const app = readFileSync(join(ROOT, 'src/app.js'), 'utf8');
    const rust = readFileSync(join(ROOT, 'src-tauri/src/pigeon.rs'), 'utf8') + readFileSync(join(ROOT, 'src-tauri/src/lib.rs'), 'utf8');
    if (!/pigeon::pigeon_example_drawings,/.test(rust)) return 'the drawing command is not registered';
    return (/call\('pigeon_example_drawings', \{ pigeon: persona\.id \}\)/.test(app) && /const exampleDrawings = new Map\(\);/.test(app)) || 'the page does not ask Rust for its drawings';
  });

  /* Kevin's test for a grounded Pigeon (2026-10-03): its examples are checked
     on where the answer came from, not on its wording. */
  check('a grounded Pigeon\'s examples are tagged by source, with both sentences on a miss', () => {
    const html = profileHtml(coinD, { card: deriveCard(coinD, cardPersona), reproduced: [true, false], grounded: true,
      sources: [{ expected: 'No Person except a natural born Citizen', got: 'No Person except a natural born Citizen' }, { expected: 'No Person except a natural born Citizen', got: null }] });
    if (!/<span class="p-tag ok">Same source on this Mac<\/span>/.test(html)) return 'no same-source tag';
    if (!/title="Expected answer came from: “No Person except a natural born Citizen”\nOn this Mac it came from: no sentence[^"]*">Answered from a different sentence/.test(html)) return html.slice(html.indexOf('p-tag'), html.indexOf('p-tag') + 600);
    const plain = profileHtml(coinD, { card: deriveCard(coinD, cardPersona), reproduced: [true, false] });
    return (/Reproduced on this Mac/.test(plain) && !/Same source/.test(plain)) || 'a non-grounded Pigeon lost its tags';
  });

  check('a grounded example is asked as an example and passes on the same source, others on the same words', async () => {
    const app = readFileSync(join(ROOT, 'src/app.js'), 'utf8');
    const at = app.indexOf('const REPRODUCE_CHECK = 2;');
    const end = app.indexOf('\n}\n', app.indexOf('async function checkReproduced (', at)) + 3;
    const run = async (reply) => {
      const state = { settings: {} };
      const asked = [];
      const call = async (cmd, args) => { asked.push(args.req); return reply(args.req); };
      const fn = new Function('pigeonInvoke', 'chat', 'state', 'persist', 'paint', `${app.slice(at, end)}\nreturn checkReproduced;`);
      await fn(() => call, {}, state, () => {}, () => {})({ id: 'pat' }, { revision: 3, examples: [{ input: 'q1', output: 'a1' }, { input: 'q2', output: 'a2' }] });
      return { asked, rec: state.settings.reproduced.pat };
    };
    const g = await run((r) => ({ text: 'other words', same_source: { same: r.text === 'q1', expected: 'E', got: r.text === 'q1' ? 'E' : 'G' } }));
    if (!g.asked.every(r => r.example === true && typeof r.expect === 'string')) return `not asked as examples: ${JSON.stringify(g.asked)}`;
    if (JSON.stringify(g.rec) !== JSON.stringify({ revision: 3, check: 2, results: [true, false], sources: [{ expected: 'E', got: 'E' }, { expected: 'E', got: 'G' }] })) return JSON.stringify(g.rec);
    const t = await run((r) => ({ text: r.text === 'q1' ? 'a1' : 'nope' }));
    return JSON.stringify(t.rec) === JSON.stringify({ revision: 3, check: 2, results: [true, false] }) || JSON.stringify(t.rec);
  });

  check('a check kept from the old way of checking is run again, and its sources are kept', () => {
    const kept = normaliseSettings({ reproduced: { pat: { revision: 2, check: 2, results: [true, false], sources: [{ expected: 'E', got: null }, 'x'] } } }).reproduced;
    if (JSON.stringify(kept) !== JSON.stringify({ pat: { revision: 2, results: [true, false], check: 2, sources: [{ expected: 'E', got: null }, null] } })) return JSON.stringify(kept);
    const app = readFileSync(join(ROOT, 'src/app.js'), 'utf8');
    if (!/rec\.check === REPRODUCE_CHECK/.test(app)) return 'an old check is trusted as a new one';
    /* The import's check ride (which keeps or reverts a revision) uses the same rule. */
    const ride = readFileSync(join(ROOT, 'src-tauri/src/pigeon.rs'), 'utf8');
    const body = ride.slice(ride.indexOf('pub async fn pigeon_check_ride'), ride.indexOf('let total = results.len() as u32;'));
    return (/example: true, expect: Some\(expected\.clone\(\)\)/.test(body) && /Some\(m\) => m\.same,/.test(body)) || 'the import check ride still compares a grounded answer word for word';
  });

  check('reproduction results are kept per Pigeon and revision, and the window checks, asks-first and copies', () => {
      const kept = normaliseSettings({ reproduced: { coins: { revision: 2, results: [true, false, 'x', null, true, true] }, bad: { revision: 0, results: [] } } }).reproduced;
      if (JSON.stringify(kept) !== JSON.stringify({ coins: { revision: 2, results: [true, false, null, null, true] } })) return JSON.stringify(kept);
      const app = readFileSync(join(ROOT, 'src/app.js'), 'utf8');
      if (!/async function checkReproduced \(/.test(app) || !/rec\.revision === card\.maker\.revision/.test(app)) return 'examples are not checked per revision';
      const job = app.slice(app.indexOf('async function runPigeonJob'), app.indexOf('const down = await beginLaneBTurn(c, { message, handedFrom, parentId: under, pendingAskId }, { persona: pigeon.name }, pigeon);'));
      const ask = app.slice(app.indexOf('async function noMaterialWithoutWaking'), app.indexOf('function landNoMaterial'));
      if (!/noMaterialWithoutWaking\(pigeon, message\)/.test(job) || !/!pigeon\.retrieval \|\| !call \|\| chat/.test(ask) || !/pigeon_contents/.test(ask)) return 'a grounded Pigeon still wakes the models to say no';
      const rust = readFileSync(join(ROOT, 'src-tauri/src/pigeon.rs'), 'utf8') + readFileSync(join(ROOT, 'src-tauri/src/lib.rs'), 'utf8');
      if (!/pigeon::pigeon_contents,/.test(rust) || !/card: manifest\.card\.clone\(\)\.filter\(card_readable\)/.test(rust)) return 'Rust does not keep the card or list contents';
      if (!/pigeon::pigeon_save_drawing,/.test(rust) || !/pub async fn pigeon_save_drawing<R: tauri::Runtime>\(app: AppHandle<R>, req: RunRequest\)/.test(rust)) return 'Save drawing is not a Rust command taking a Pigeon and its recipe';
      const save = rust.slice(rust.indexOf('pub async fn pigeon_save_drawing'), rust.indexOf('/* ── the import commands'));
      if (!/skill::render\(&payload, &recipe\)/.test(save) || !/blocking_save_file/.test(save) || !/std::fs::write\(&path, drawn\.as_bytes\(\)\)/.test(save)) return 'Save drawing does not write only what Rust drew, through the save dialog';
      if (!/call\('pigeon_save_drawing', \{ req: \{ pigeon: pigeonId, text: recipe \} \}\)/.test(app)) return 'the page sends something other than the Pigeon and its recipe';
      return (/async function copyDrawing \(/.test(app) && /ClipboardItem/.test(app)) || 'Copy image does not rasterise';
    });
  }

  /* ── E9: native menus ────────────────────────────────────────────────────── */
  check('the app’s menus carry actions to the page, and the Developer menu is a setting', () => {
    const native = settingsHtml({ tab: 'advanced', settings: { devMenu: true }, native: true });
    if (!/Developer menu/.test(native) || !/aria-checked="true" class="on" data-set="devMenu" data-value="on">Shown/.test(native) || /data-s="ledger"/.test(native)) return native.slice(0, 500);
    const app = readFileSync(join(ROOT, 'src/app.js'), 'utf8');
    if (!/listen\('app-menu', \(e\) => \{ menuAction\(e\.payload\); \}\)/.test(app) || !/call\('set_dev_menu', \{ on: state\.settings\.devMenu === true \}\)/.test(app)) return 'the page does not hear the menu, or never tells Rust the setting';
    const fn = app.slice(app.indexOf('function menuAction ('), app.indexOf('function menuAction (') + 600);
    for (const id of ['new-message', 'add-pigeon', 'settings', 'skills', 'plan', 'ledger', 'shortcuts']) if (!fn.includes(`'${id}'`)) return `the menu's ${id} does nothing`;
    const rust = readFileSync(join(ROOT, 'src-tauri/src/appmenu.rs'), 'utf8') + readFileSync(join(ROOT, 'src-tauri/src/lib.rs'), 'utf8');
    if (!/PredefinedMenuItem::copy/.test(rust) || !/PredefinedMenuItem::paste/.test(rust)) return 'a custom menu without Edit breaks copy and paste on macOS';
    return (/\.on_menu_event\(\|app, event\| appmenu::on_event\(app, event\)\)/.test(rust) && /appmenu::set_dev_menu,/.test(rust) && /if developer && cfg!\(debug_assertions\) \{\s*items\.push\(&dev\);/.test(rust)) || 'the menu is not wired, registered, or toggled';
  });

  /* ── E8: history slots, no amounts, keep going ───────────────────────────── */
  check('a voice remembers its own lane’s last back-and-forths, and a quote is never what was asked', async () => {
    const { messagesFor, HISTORY_TURNS, NO_AMOUNTS } = await import('../src/lane-b/chat.js');
    const bTurn = (i) => ({ lane: 'B', message: `b${i}`, reply: { text: `r${i}` } });
    const history = [...Array.from({ length: HISTORY_TURNS }, (_, i) => bTurn(i)), { lane: 'A', message: 'a patch turn' }, { lane: 'A', message: 'another' }];
    const msgs = messagesFor('now', history, null);
    const users = msgs.filter(m => m.role === 'user').map(m => m.content);
    if (users.length !== HISTORY_TURNS + 1 || users[0] !== 'b0') return `a Lane A turn took a slot: ${users.slice(0, 3).join(',')} (${users.length})`;
    if (msgs.some(m => /quoted text/.test(m.content))) return 'a quote reached the model';
    if (msgs[0].content.includes(NO_AMOUNTS)) return 'no-amounts was added unasked';
    if (!messagesFor('x', [], null, { noAmounts: true })[0].content.includes(NO_AMOUNTS)) return 'Pen was not asked for no amounts';
    return !messagesFor('x', [], { id: 'v', name: 'Voice' }, { noAmounts: true })[0].content.includes(NO_AMOUNTS) || 'a voice was given Pen’s instruction';
  });

  check('Keep going cannot slip a figure past the guard in two halves', async () => {
    const { runChat } = await import('../src/lane-b/chat.js');
    const first = { id: 'T1', lane: 'B', message: 'how much would a 12 month gym membership cost at 40 a month', reply: { text: 'Working it through, the yearly total comes to' } };
    const complete = async () => ({ text: '480 in all.', finishReason: 'stop' });
    const cont = await runChat('Continue', { history: [first], complete, continuing: first, seed: 1 });
    if (cont.continues !== 'T1') return 'the continuation does not say what it continues';
    return Boolean(cont.handoff) || `a computed figure was shown after Continue: ${JSON.stringify(cont.reply)}`;
  });

  check('Pen’s dropped reply offers to ask without amounts, and a cut-off reply offers Keep going', () => {
    const pen = pigeonOf('chat');
    const dropped = turnHtml({ id: 'H1', lane: 'B', message: 'what is 15% of 80', mode: 'generated', reply: { source: 'generated', text: 'x' }, handoff: { dropped: '12' } }, { pigeon: pen, last: true });
    if (!/data-do="pen-no-amounts" data-turn="H1">Ask Pen without amounts/.test(dropped)) return dropped.slice(0, 500);
    const cut = turnHtml({ id: 'K1', lane: 'B', message: 'tell me a story', mode: 'generated', reply: { source: 'generated', text: 'Once upon a time' }, finishReason: 'length', tokens: 300 }, { pigeon: pen, last: true });
    const app = readFileSync(join(ROOT, 'src/app.js'), 'utf8');
    return (/data-do="keep-going" data-turn="K1">Keep going/.test(cut) && /chatOptions\.set\(c\.id, \{ continuing: t \}\)/.test(app) && /sayInLaneB\('Continue', t\.id, c\.id\)/.test(app)) || cut.slice(0, 500);
  });

  /* ── E7: meeting a Pigeon before it is added ─────────────────────────────── */
  check('the Meet sheet says what a file is, and offers only what can honestly be done', async () => {
    const { meetHtml, addable, MEET_SAFETY } = await import('../src/ui/meet.js');
    const ready = { status: 'ready', id: 'm1', file: 'coins.pigeon', pigeon_id: 'coins', name: 'Coin Sorter', kind: 'classifier',
      card: { does: 'Sort coin photos by type.', check: { passed: 5, total: 6 } }, update: false, revision: 1 };
    const one = meetHtml([ready]);
    if (!/Meet Coin Sorter/.test(one) || !/From its maker/.test(one) || !/Passed 5 of 6/.test(one) || !/data-meet="add">Add Coin Sorter/.test(one) || !one.includes(MEET_SAFETY)) return one.slice(0, 700);
    if (/data-meet-pick/.test(one)) return 'a single file shows checkboxes';
    const update = meetHtml([{ ...ready, update: true, installed_revision: 1, revision: 2 }]);
    if (!/Update Coin Sorter/.test(update) || !/revision 1\)/.test(update) || !/is revision 2 and replaces it/.test(update)) return update.slice(0, 700);
    const nest = meetHtml([ready, { ...ready, id: 'm2', name: 'Title Maker', card: null }, { status: 'already', file: 'x.pigeon', name: 'Scout' }]);
    if ((nest.match(/data-meet-pick=/g) || []).length !== 2 || !/Add 2/.test(nest) || !/came without a card/.test(nest) || !/Already on this Mac/.test(nest)) return nest.slice(0, 900);
    const wrong = meetHtml([{ status: 'needs-base', file: 'w.pigeon', name: 'Wrong', reason: 'needs the base it was trained on', missing: false }], { canDownload: true });
    if (!/Copy details for its maker/.test(wrong) || /Download, then add/.test(wrong) || /data-meet="add"/.test(wrong)) return wrong.slice(0, 600);
    const missing = meetHtml([{ status: 'needs-base', file: 'w.pigeon', name: 'Wrong', reason: 'no base', missing: true }], { canDownload: true });
    if (!/Download, then add/.test(missing)) return 'a missing base cannot be downloaded from the sheet';
    /* A picture Pigeon without its stock picture reader: size, source and
       licence before the button that downloads (format §13.1, §16.4). */
    const slim = { status: 'needs-projector', id: 'm9', file: 'pocket-quest.pigeon', name: 'Pocket Quest',
      projector: { sha256: 'f9a68f', file: 'mmproj-Qwen3VL-2B-Instruct-Q8_0.gguf', bytes: 445053216, registry_id: 'qwen3-vl-2b-instruct', license: 'Apache-2.0', license_url: 'https://www.apache.org/licenses/LICENSE-2.0', host: 'huggingface.co' } };
    const fetch = meetHtml([slim], { canFetch: true });
    const at = (re) => fetch.search(re);
    if (!/445 MB/.test(fetch) || !/from huggingface\.co/.test(fetch) || !/Apache License 2\.0/.test(fetch) || !/licenses\/LICENSE-2\.0/.test(fetch)) return fetch.slice(0, 900);
    if (!(at(/Apache License/) < at(/data-meet="download-projector"/)) || !/data-sha="f9a68f"/.test(fetch) || /data-meet="add"/.test(fetch)) return 'the licence is not shown before the download, or it can be added without its reader';
    if (/data-meet="download-projector"/.test(meetHtml([slim], { canFetch: false }))) return 'offers a second download while one runs';
    if (!/CC-BY-NC-4\.0/.test(meetHtml([{ ...slim, projector: { ...slim.projector, license: 'CC-BY-NC-4.0' } }], { canFetch: true }))) return 'a licence the list does not word is not shown as it came';
    /* D83: a base Pigeon is not called trained, on its row or in the line said every time. */
    const { MEET_SAFETY_BASE, BASE_ONLY_NOTE } = await import('../src/ui/meet.js');
    const base = { ...ready, kind: 'persona', name: 'Plain English', base_only: true };
    const prompted = meetHtml([base]);
    if (!prompted.includes(MEET_SAFETY_BASE) || prompted.includes(MEET_SAFETY) || !prompted.includes(BASE_ONLY_NOTE) || !/data-meet="add">Add Plain English/.test(prompted)) return prompted.slice(0, 900);
    const mixed = meetHtml([base, ready]);
    if (!mixed.includes(MEET_SAFETY) || (mixed.match(/no training of its own/g) || []).length !== 1) return mixed.slice(0, 900);
    if (/no training of its own/.test(one)) return 'a trained Pigeon is called untrained';
    /* Opened again: "already here" says the same as the first add did. */
    const again = meetHtml([{ status: 'already', file: 'plain.pigeon', name: 'Plain English', base_only: true }]);
    if (!again.includes(MEET_SAFETY_BASE) || again.includes(MEET_SAFETY) || !again.includes(BASE_ONLY_NOTE) || !/Already on this Mac/.test(again)) return again.slice(0, 900);
    if (!meetHtml([{ status: 'already', file: 'x.pigeon', name: 'Scout' }]).includes(MEET_SAFETY)) return 'a trained Pigeon already here lost the trained line';
    const refused = meetHtml([{ status: 'refused', file: 'bad.pigeon', reason: 'not a valid .pigeon file' }]);
    return (addable([ready, { status: 'patch', id: 'p' }, { status: 'already' }]).length === 2 && /Can’t be added: not a valid \.pigeon file/.test(refused) && /data-meet="cancel">Close/.test(refused)) || refused;
  });

  /* A picture reader's download, from the Meet sheet's "Download, then add".
     Measured 2026-10-06: the first press downloaded and verified the file,
     then stopped on "Cannot access 'host' before initialization" — a local
     named like the sheet it closes — and was reported as the download
     failing. Its Retry then ran the models download instead, because the
     kind had already been reset. So: the flow runs here, outside app.js. */
  check('a picture reader that arrives is reported as arrived, and a Retry fetches the picture reader again', async () => {
    const { fetchProjector } = await import('../src/projector-download.js');
    const want = { sha: '980c9b', bytes: 844757728, host: 'huggingface.co' };
    const run = async (download, addHeld = async () => {}) => {
      const seen = { closed: 0, toasts: [], log: [], added: 0 };
      const sheet = { id: 'sheet' };
      const io = {
        download, cancelled: 'cancelled',
        shown: (el) => el === sheet, toast: (t) => seen.toasts.push(t), logWeb: (e) => seen.log.push(e),
        addHeld: async () => { seen.added += 1; await addHeld(); }
      };
      const out = await fetchProjector(want, sheet, () => { seen.closed += 1; }, io);
      return { out, seen };
    };
    const ok = await run(async () => {});
    if (ok.out.stage !== 'done') return `a download that arrived was reported as ${ok.out.stage}: ${ok.out.error}`;
    if (ok.seen.closed !== 1 || ok.seen.added !== 1 || !/arrived intact/.test(ok.seen.toasts[0] || '')) return JSON.stringify(ok.seen);
    if (JSON.stringify(ok.seen.log) !== JSON.stringify([{ text: 'A picture reader, for a picture Pigeon ← huggingface.co', hosts: ['huggingface.co'] }])) return JSON.stringify(ok.seen.log);
    const failed = await run(async () => { throw new Error('the connection was reset'); });
    if (failed.out.stage !== 'failed' || failed.out.kind !== 'projector' || failed.seen.added || failed.seen.closed) return `a failure leaves Retry fetching ${failed.out.kind}: ${JSON.stringify(failed)}`;
    const paused = await run(async () => { throw new Error('cancelled'); });
    if (paused.out.stage !== 'paused' || paused.seen.added) return JSON.stringify(paused);
    const addFails = await run(async () => {}, async () => { throw new Error('held too long'); });
    if (addFails.out.stage !== 'done') return 'an add that fails after the download arrived is reported as the download stopping';
    return /held too long/.test(addFails.seen.toasts.join(' ')) || `the add's own failure is not said: ${addFails.seen.toasts}`;
  });

  /* Every warning the import check raises is shown, worded for a person, on
     the Meet sheet and again on the Pigeon's page once it is added. */
  const NOTE_CASES = [
    [{ code: 'same_base_other_quant', detail: { tested_on: 'Q5.gguf', here: 'Q4.gguf' } }, /tested it on a different copy of its model/, /Tested on: Q5\.gguf · This Mac has: Q4\.gguf/],
    [{ code: 'same_base_other_quant', detail: { tested_on: 'Q4.gguf', here: 'Q4.gguf' } }, /a file with the same name as the one on this Mac/, /Q4\.gguf/],
    [{ code: 'card_skipped', detail: { field: 'card.does' } }, /description couldn’t be read — the part saying what it does —/, null],
    [{ code: 'prompt_unchecked', detail: {} }, /made before Pigeons carried a self-check, so this app can’t confirm/, null],
    [{ code: 'trained_quantized', detail: {} }, /smaller, compressed copy of its model/, null],
    [{ code: 'untrusted_seal', detail: { why: 'sealed by key 0123456789abcdef' } }, /from someone this app doesn’t know/, /0123456789abcdef/],
    [{ code: 'actions_skipped', detail: { cause: 'keys', why: 'keys is not an object' } }, /list couldn’t be used, so it won’t press anything and can’t play/, /keys is not an object/],
    [{ code: 'actions_skipped', detail: { cause: 'unreadable', why: 'not JSON' } }, /list couldn’t be used/, null],
    [{ code: 'actions_skipped', detail: { cause: 'no_version' } }, /doesn’t say which version of the app it was made for/, null],
    [{ code: 'actions_skipped', detail: { cause: 'newer' } }, /made for a newer version of this app/, null],
    [{ code: 'actions_skipped', detail: { cause: 'no_frames' } }, /doesn’t say how its pictures of the screen were taken/, null],
    [{ code: 'actions_skipped', detail: { cause: 'no_pictures' } }, /doesn’t look at pictures, so the list isn’t used/, null],
    [{ code: 'actions_skipped', detail: { cause: 'crop' } }, /isn’t described in a way this app can follow/, null],
    [{ code: 'actions_skipped', detail: { cause: 'stack' } }, /a number of frames this app can’t make/, null],
    [{ code: 'actions_skipped', detail: { cause: 'max_side' } }, /picture size it learned from isn’t one this app can make/, null],
    [{ code: 'actions_skipped', detail: { cause: 'gap', why: 'frames.gap_ms is not a time of at least 0' } }, /how far apart in time its stacked pictures were taken/, /gap_ms is not a time/],
    [{ code: 'registry_disagrees', detail: { entry: 'qwen3-vl-2b-instruct' } }, /doesn’t match the published list of models/, /qwen3-vl-2b-instruct/],
    [{ code: 'temperature_ignored', detail: { temperature: 0.7 } }, /keeps its answers steady/, null],
    [{ code: 'same_pigeon', detail: { keeps: 'this' } }, /Pigeon keeps this smaller copy instead/, null],
    [{ code: 'same_pigeon', detail: { keeps: 'yours_with_its_projector' } }, /puts the reader on this Mac and keeps your smaller copy/, null],
    [{ code: 'cannot_play', detail: { cause: 'key', key: 'Jump', code: 900 } }, /one of the keys it presses isn’t on a Mac keyboard/, /Key: Jump \(code 900\)/],
    [{ code: 'cannot_play', detail: { cause: 'no_keys' } }, /its file lists no keys for it to press/, null]
  ];
  for (const [note, words, more] of NOTE_CASES) {
    check(`the ${note.code}${note.detail.cause ? ` (${note.detail.cause})` : ''}${note.detail.tested_on && note.detail.tested_on === note.detail.here ? ' (same name)' : ''} note shows on the Meet sheet and on the Pigeon's page`, async () => {
      const { meetHtml } = await import('../src/ui/meet.js');
      const ready = { status: 'ready', id: 'm1', file: 'x.pigeon', pigeon_id: 'x', name: 'Icon Maker', kind: 'freeform', card: null, update: false, notes: [note] };
      const sheet = meetHtml([ready]);
      if (!words.test(sheet) || !sheet.includes(`data-note="${note.code}"`)) return sheet.slice(0, 900);
      if (more && !(/<details class="note-more"><summary>Details<\/summary>/.test(sheet) && more.test(sheet))) return 'its particulars are not behind Details';
      const d = { id: 'x', pick: 'p:x', name: 'Icon Maker', kind: 'job', imported: true };
      const page = profileHtml(d, { notes: [note] });
      return (/Notes from its check/.test(page) && words.test(page)) || page.slice(0, 900);
    });
  }

  check('a card that could not be read is said once, not as "came without a card"; no notes, no section', async () => {
    const { meetHtml } = await import('../src/ui/meet.js');
    const ready = { status: 'ready', id: 'm1', file: 'x.pigeon', pigeon_id: 'x', name: 'Icon Maker', kind: 'freeform', card: null, update: false };
    const skipped = meetHtml([{ ...ready, notes: [{ code: 'card_skipped', detail: { field: 'card.does' } }] }]);
    if (/came without a card/.test(skipped)) return 'the sheet says both that it has no card and that its card could not be read';
    if (!/came without a card/.test(meetHtml([{ ...ready, notes: [] }]))) return 'a Pigeon with no card stopped saying so';
    const d = { id: 'x', pick: 'p:x', name: 'Icon Maker', kind: 'job', imported: true };
    if (/Notes from its check/.test(profileHtml(d, {}))) return 'a Pigeon with nothing to note shows an empty section';
    const two = meetHtml([{ ...ready, notes: [{ code: 'same_base_other_quant', detail: { tested_on: 'a', here: 'b' } }, { code: 'prompt_unchecked', detail: {} }] }]);
    if ((two.match(/data-note=/g) || []).length !== 2) return 'two notes did not make two lines';
    const app = readFileSync(join(ROOT, 'src/app.js'), 'utf8');
    if (!/listen\('pigeons-changed', \(\) => \{ refreshPersonas\(\)/.test(app)) return 'notes rebuilt at launch never reach a page that is already open';
    return (/notes: persona \? persona\.notes \|\| \[\] : \[\]/.test(app) && /1 note' : `\$\{n\} notes`\} — see its page/.test(app)) || 'the page is not handed its notes, or the Added line still repeats the warning';
  });

  check('opening a file describes it first, and only Add installs, by the ids Rust gave out', () => {
    const app = readFileSync(join(ROOT, 'src/app.js'), 'utf8');
    const rust = readFileSync(join(ROOT, 'src-tauri/src/pigeon.rs'), 'utf8') + readFileSync(join(ROOT, 'src-tauri/src/lib.rs'), 'utf8');
    if (!/openMeet\(await call\('pigeon_inspect_pick'\)\)/.test(app) || !/openMeet\(await call\('pigeon_take_opens'\)\)/.test(app) || !/listen\('pigeon-meet'/.test(app)) return 'a file is still installed without being met';
    if (!/pigeonInvoke\(\)\('pigeon_add', \{ ids \}\)/.test(app)) return 'Add does not install by id';
    if (!/pigeon::pigeon_inspect_pick,/.test(rust) || !/pigeon::pigeon_add,/.test(rust) || !/manage\(pigeon::HeldImports::default\(\)\)/.test(rust)) return 'the Rust commands are not registered';
    return (/let all = inspect_paths\(&app, &paths\);/.test(rust) && /window\.emit\("pigeon-meet", &all\)/.test(rust) && /fn a_meet_record_names_a_file_and_never_a_path/.test(rust)) || 'a double-click still installs, or no test guards against a path';
  });

  /* ── E4: loading, waking, sleeping, restarting ─────────────────────────── */
  check('a router-only decline is flagged, and offers to wake the models with a countdown', async () => {
    const t = await runTurn('write me a limerick about a cat', { registry, router: new LexicalRouter(registry), ctx: { now: '2026-09-01T09:00:00Z', timezone: 'UTC', locale: 'en-GB' } });
    if (t.mode !== MODES.NO_SKILL || t.routerOnly !== true) return `mode ${t.mode}, routerOnly ${t.routerOnly}`;
    const withPlanner = await runTurn('write me a limerick about a cat', { registry, router: new LexicalRouter(registry), ctx: { now: '2026-09-01T09:00:00Z', timezone: 'UTC', locale: 'en-GB' }, planner: async () => ({ steps: [] }) });
    if (withPlanner.routerOnly) return 'a decline the planner made is not router-only';
    const html = turnHtml({ id: 'R1', lane: 'A', message: 'x', mode: MODES.NO_SKILL, routerOnly: true, results: [], reply: { segments: [] } }, { pigeon: pigeonOf('patch'), wakeOffer: 'about 14 s', canChat: true });
    return (/data-do="wake-ask" data-turn="R1">Try with the models · about 14 s/.test(html) && /Ask Pen/.test(html)) || html.slice(0, 400);
  });

  check('the sleep period is a setting, reaches the engine, and a measured restart time is kept', () => {
    const html = settingsHtml({ tab: 'models', settings: { sleepAfter: 3600 }, models: { words: 'asleep', canWake: true } });
    if (!/Sleep after/.test(html) || !/aria-checked="true" class="on" data-set="sleepAfter" data-value="3600">1 hour/.test(html)) return html.slice(0, 500);
    const app = readFileSync(join(ROOT, 'src/app.js'), 'utf8');
    if (!/set\.dataset\.set === 'sleepAfter'/.test(app) || !/engine\.setIdleUnload\(state\.settings\.sleepAfter\)/.test(app)) return 'the setting never reaches the engine';
    const rust = readFileSync(join(ROOT, 'src-tauri/src/engine.rs'), 'utf8') + readFileSync(join(ROOT, 'src-tauri/src/lib.rs'), 'utf8');
    if (!/pub async fn engine_set_idle_unload/.test(rust) || !/engine::engine_set_idle_unload,/.test(rust) || /ships OFF/.test(rust)) return 'the Rust command is missing, unregistered, or the stale comment is back';
    const kept = normaliseSettings({ lastRestartMs: 23000 }).lastRestartMs === 23000 && normaliseSettings({ lastRestartMs: 5 }).lastRestartMs == null;
    return (kept && /state\.settings\.lastRestartMs = took/.test(app) && /restartEta\(state\.settings\.lastRestartMs, at, now\)/.test(app)) || 'restart time is not measured or not used';
  });

  check('during a restart only what the router answers alone goes ahead, and a stranger server is explained', () => {
    const app = readFileSync(join(ROOT, 'src/app.js'), 'utf8');
    if (!/if \(pigeonRestart && !\(router && router\.route\(message\)\.actionable\.length\)\)/.test(app) || !/state: 'models-restarting'/.test(app)) return 'planner turns do not wait for a restart';
    if (!/turn\.routerOnly && turn\.mode === MODES\.NO_SKILL && \(\(turn\.routing && turn\.routing\.forPlanner\) \|\| \[\]\)\.length && modelsCanWake\(\)/.test(app)) return 'auto-wake is not limited to declines with candidates';
    return /another copy of the model server is running outside Pigeon/.test(laneDownText({ phase: 'error', detail: 'restart needed — the category server started outside Pigeon is not wearing this Patch’s adapter' }))
      || 'restart needed is still engine words';
  });

  check('the web switch, the per-request sheet and the This build footer are gone, and the consent card names both sites', () => {
    const app = readFileSync(join(ROOT, 'src/app.js'), 'utf8');
    if (/webToggle|WEB ON|webOnce|confirmNetwork/.test(app) || /This build · \$\{/.test(app)) return 'a way around the card is still in the window';
    /* Only a yes on the card hands a turn the provider, and without a second ask. */
    if (!/webEnabled: false \};\n\}/.test(app) || !/answer\.send \? \{ \.\.\.webCtx\(\), webEnabled: true, search, confirmBeforeNetwork: false \}/.test(app)) return 'webCtx can still enable the web by itself';
    const card = turnHtml({ id: 'W1', lane: 'A', message: 'who governs Maryland', consent: { query: 'governor of Maryland' }, results: [] }, { pigeon: pigeonOf('patch') });
    return (/Send this to DuckDuckGo and Wikipedia\?/.test(card) && /data-do="consent-no"[^>]*>Don’t send/.test(card) && /Send once/.test(card)
      && /const theme = t === 'dark' \|\| t === 'light' \? t : 'system'/.test(app)) || card.slice(0, 400);
  });

  /* A question that can never land is worse than one that lands badly: the
     thread says "replying…" for ever, and every later message in that chat
     queues behind a reply that is not coming. Lane B has always caught, and so
     has the menu-bar window; this is the gate that keeps Lane A catching. */
  check('a Lane A turn that throws lands as a failure with Try again, not as a chat stuck replying', () => {
    const app = readFileSync(join(ROOT, 'src/app.js'), 'utf8');
    const say = (app.match(/async function say \(text, \{[\s\S]*?\n}\n/) || [''])[0];
    if (!/try \{\n\s*turn = await askPatch\(\);/.test(say)) return 'the pipeline is not inside a try';
    if (!/\} catch \(e\) \{\n\s*return landReply\(chatId, \{/.test(say)) return 'nothing lands when it throws';
    if (!/interrupted: true, error: askFailed\(e\)/.test(say)) return 'what lands is not the shape that draws Try again';
    /* interrupted:true is what bubbles.js draws the retry button from, and what
       fileReply clears the inflight flag through — both have to stay true. */
    const bub = readFileSync(join(ROOT, 'src/ui/bubbles.js'), 'utf8');
    if (!/if \(turn\.interrupted\) \{[\s\S]*?data-retry=/.test(bub)) return 'an interrupted turn no longer draws Try again';
    if (!/window\.addEventListener\('unhandledrejection'/.test(app)) return 'there is no backstop for the paths nobody thought of';
    return /function askFailed \(e\)/.test(app) || 'askFailed is gone';
  });

  /* ── the four places a redraw used to take the keyboard away ─────────────
     Pigeon draws from strings, so "update" means "replace the markup". That is
     fine for text and fatal for whatever the person is standing on: focus does
     not survive an element being replaced, and neither does a scroll position
     or an open drawer. These are the places where that mattered. */

  check('the download card is updated in place, so Cancel can actually be pressed', () => {
    const app = readFileSync(join(ROOT, 'src/app.js'), 'utf8');
    const fn = (app.match(/function paintDownloadCard \(\)[\s\S]*?\n}\n/) || [''])[0];
    if (!fn) return 'paintDownloadCard is gone';
    /* A rebuild is allowed only when the card becomes a different card, and
       that is read off the DOM rather than remembered. */
    if (!/data-fr="retry"/.test(fn)) return 'it no longer checks whether the card has changed shape';
    if ((fn.match(/outerHTML/g) || []).length !== 1) return 'the card is still rebuilt on every event';
    for (const sel of ['.sheet-title', '.dl-overall', '.dl-line', '.dl-resume', '.bar > i']) {
      if (!fn.includes(sel)) return `${sel} is not updated in place`;
    }
    const escape = (x) => String(x).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const html = progressHtml({ id: 'planner', stage: 'download', received: 1, total: 4, overall_received: 1, overall_total: 4, resumed: false }, escape);
    const missing = ['dl-overall', 'dl-line', 'dl-resume'].filter(c => !html.includes(`class="${c}"`));
    return missing.length === 0 || `progressHtml has no hook for: ${missing.join(', ')}`;
  });

  /* The other half of the same fix: every progress event tests the host with
     document.body.contains(), which is false for a function — so assigning
     openSheet's close() to sheetHost silently froze the card at 0%. */
  check('sheetHost always holds the element, never the function that closes it', () => {
    /* Comments stripped: the one above openSheetHost quotes the mistake by name,
       and a gate that cannot tell a warning from the thing it warns about is
       not a gate. */
    const app = readFileSync(join(ROOT, 'src/app.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    if (/sheetHost = openSheet\(/.test(app)) return 'a close() is being stored as the host again';
    const every = (app.match(/sheetHost = /g) || []).length;
    const allowed = (app.match(/sheetHost = (openSheetHost\(|host;|null;)/g) || []).length;
    if (every !== allowed) return `${every - allowed} assignment(s) of something that is not openSheetHost, host or null`;
    /* Every one opened through the helper has to TAKE its .host. The call spans
       several lines, and forgetting the suffix on one of them stores the
       {host, close} object instead — which contains() rejects just as happily
       as it rejected the function. Counting ".host" in the file would also count
       `new URL(u).host`, so this walks each call to its own closing bracket. */
    const missing = [];
    for (let i = app.indexOf('sheetHost = openSheetHost('); i > -1; i = app.indexOf('sheetHost = openSheetHost(', i + 1)) {
      let depth = 0;
      let j = app.indexOf('(', i);
      for (; j < app.length; j++) {
        if (app[j] === '(') depth++;
        else if (app[j] === ')' && --depth === 0) break;
      }
      if (app.slice(j + 1, j + 7) !== '.host;') missing.push(app.slice(i, i + 60).split('\n')[0]);
    }
    return missing.length === 0 || `opened through the helper but not taking .host: ${missing.join(' | ')}`;
  });

  check('Settings puts the keyboard, the scroll and the open drawer back after a redraw', () => {
    const app = readFileSync(join(ROOT, 'src/app.js'), 'utf8');
    const fn = (app.match(/const redraw = \(\{ sameTab[\s\S]*?\n    \};/) || [''])[0];
    if (!fn) return 'the redraw no longer takes a sameTab flag';
    if (!/keyOf\(document\.activeElement\)/.test(fn) || !/back\.focus\(\)/.test(fn)) return 'focus is not restored';
    if (!/scrollTop/.test(fn)) return 'the scroll position is not restored';
    if (!/querySelectorAll\('details'\)/.test(fn)) return 'the This build drawer still snaps shut';
    /* Moving to another tab is different content: restoring a scroll into it
       would be the bug, but the tab button itself must still take the focus. */
    return /redraw\(\{ sameTab: false \}\)/.test(app) || 'a tab switch restores state that belongs to the tab you left';
  });

  check('every dialog says it is one, keeps Tab inside it, and gives the keyboard back', () => {
    const app = readFileSync(join(ROOT, 'src/app.js'), 'utf8');
    const fn = (app.match(/function openSheet \(html, onWire\)[\s\S]*?\n}\n/) || [''])[0];
    if (!fn) return 'openSheet is gone';
    if (!/setAttribute\('role', 'dialog'\)/.test(fn) || !/aria-modal/.test(fn)) return 'a sheet is still an anonymous div';
    if (!/aria-label/.test(fn)) return 'a dialog with no name is announced as nothing';
    if (!/aria-hidden/.test(fn)) return 'the page behind is still walkable by a screen reader';
    if (!/e\.key !== 'Tab'/.test(fn)) return 'Tab still walks out of the dialog';
    if (!/cameFrom/.test(fn)) return 'the keyboard is not given back on close';
    /* Settings labels its own card; nothing here may overwrite that. */
    if (!/if \(!card\.hasAttribute\('role'\)\)/.test(fn)) return 'a card that names itself is overwritten';
    /* One Escape used to close every open sheet at once, because each had its
       own handler on the document. */
    return /sheetStack\[sheetStack\.length - 1\] !== host/.test(fn) || 'every open sheet still answers the same Escape';
  });

  check('a context menu gives the keyboard back to whatever opened it', () => {
    const menu = readFileSync(join(ROOT, 'src/ui/menu.js'), 'utf8');
    return (/const cameFrom = fromElement \? document\.activeElement : null/.test(menu)
      && /document\.contains\(cameFrom\)/.test(menu)) || 'closing a menu still drops focus at the top of the page';
  });

  check('a reply in the chat on screen is announced, and the thread says while it is working', () => {
    const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
    if (!/id="said"[^>]*aria-live="polite"/.test(html) && !/aria-live="polite"[^>]*id="said"/.test(html)) return 'there is no live region for a reply';
    const app = readFileSync(join(ROOT, 'src/app.js'), 'utf8');
    const fn = (app.match(/function announce \(chatId, turn\)[\s\S]*?\n}\n/) || [''])[0];
    if (!/sayAloud\(/.test(fn)) return 'a reply you are looking at is still announced to nobody';
    /* Cleared before it is written, or an identical sentence is never read. */
    const say = (app.match(/function sayAloud \(text\)[\s\S]*?\n}\n/) || [''])[0];
    if (!/el\.textContent = '';/.test(say)) return 'the same answer twice would be announced once';
    if (!/aria-busy/.test(app)) return 'the wait is not perceivable';
    const css = readFileSync(join(ROOT, 'styles/app.css'), 'utf8');
    return /\.offscreen\{/.test(css) || 'the live region has no way to be off screen without leaving the accessibility tree';
  });

  /* ── the small ones ──────────────────────────────────────────────────────
     Individually minor, and every one of them a place where the app said
     something that was not so: a button that looked ready and did nothing, a
     role that promised arrow keys, a bar with no value on it, a dialog that
     went quiet, an error that named a path instead of a reason. */

  check('the progress bar carries its value, and keeps carrying it as it fills', () => {
    const escape = (x) => String(x).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const html = progressHtml({ id: 'planner', stage: 'download', received: 1, total: 4, overall_received: 1, overall_total: 4, resumed: false }, escape);
    if (!/role="progressbar"/.test(html) || !/aria-valuenow="25"/.test(html)) return html.slice(0, 300);
    if (!/aria-valuemin="0"/.test(html) || !/aria-valuemax="100"/.test(html)) return 'a progressbar with no range says nothing';
    const app = readFileSync(join(ROOT, 'src/app.js'), 'utf8');
    const fn = (app.match(/function paintDownloadCard \(\)[\s\S]*?\n}\n/) || [''])[0];
    return /setAttribute\('aria-valuenow'/.test(fn) || 'the number read aloud freezes at whatever it was drawn with';
  });

  check('Add says it is adding, and says Add again if it could not', () => {
    const app = readFileSync(join(ROOT, 'src/app.js'), 'utf8');
    const fn = (app.match(/function openMeet \(records\)[\s\S]*?\n}\n/) || [''])[0];
    if (!/b\.textContent = 'Adding…'/.test(fn)) return 'installing a Pigeon is still a greyed button and no other sign';
    return /b\.textContent = label;/.test(fn) || 'a failed add leaves the button saying Adding… for ever';
  });

  check('a group that claims the arrow keys answers them, and is one Tab stop', () => {
    const app = readFileSync(join(ROOT, 'src/app.js'), 'utf8');
    const fn = (app.match(/function rovingGroup \(group\)[\s\S]*?\n}\n/) || [''])[0];
    if (!fn) return 'rovingGroup is gone';
    if (!/b\.tabIndex = i === at \? 0 : -1/.test(fn)) return 'every option is still its own Tab stop';
    for (const k of ['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown', 'Home', 'End']) {
      if (!fn.includes(k)) return `${k} does nothing`;
    }
    /* All three groups that carry the roles have to be wired, or the claim is
       still only true in some of them. */
    if (!/rovingGroup\(document\.querySelector\('\.tabs\[role="tablist"\]'\)\)/.test(app)) return 'the Chats/Pigeons tabs are not wired';
    if (!/rovingGroup\(root\.querySelector\('\.st-tabs'\)\)/.test(app)) return 'the Settings tabs are not wired';
    if (!/querySelectorAll\('\.st-seg'\)\.forEach\(rovingGroup\)/.test(app)) return 'the segmented controls are not wired';
    /* And a group nobody can name is a group announced as "group". */
    const settings = readFileSync(join(ROOT, 'src/ui/settings.js'), 'utf8');
    const html = settingsHtml({ tab: 'general', settings: { theme: 'dark' } });
    if (!/role="radiogroup" aria-label="Appearance"/.test(html)) return 'the radiogroup has no name';
    return /role="tablist" aria-label="Settings sections"/.test(html) || (settings.includes('aria-label') ? 'the tablist has no name' : 'no labels at all');
  });

  /* Every path these two write is inside the app's own data directory and was
     built in Rust, so putting one in an error tells the reader nothing they can
     act on and buries the reason, which is the part they can. */
  check('an error a person reads names the reason, not a path on this Mac', () => {
    const leaks = [];
    for (const f of ['src-tauri/src/pigeon.rs', 'src-tauri/src/store.rs', 'src-tauri/src/download.rs']) {
      const rust = readFileSync(join(ROOT, f), 'utf8');
      for (const line of rust.split('\n')) {
        if (/^\s*(\/\/|\*)/.test(line)) continue;
        if (/format!\(/.test(line) && /\.display\(\)/.test(line)) leaks.push(`${f}: ${line.trim().slice(0, 70)}`);
      }
    }
    return leaks.length === 0 || `a path is being shown to a person:\n    ${leaks.join('\n    ')}`;
  });

  /* ── the boundary, counted ────────────────────────────────────────────────
     Three hand-written places state what the webview can reach: the security
     note above [dependencies] in Cargo.toml, the module header in lib.rs, and
     the description in capabilities/default.json. All three had drifted — the
     first two said "twenty-four" when the answer was thirty-three, and between
     them eight commands went undocumented. A boundary nobody recounts is a
     boundary nobody is defending, so it is recounted here. */
  check('every command the webview can reach is named in all three places that claim to list them', () => {
    const lib = readFileSync(join(ROOT, 'src-tauri/src/lib.rs'), 'utf8');
    const block = (lib.match(/generate_handler!\[([\s\S]*?)\]\)/) || [])[1];
    if (!block) return 'generate_handler![...] could not be found';
    const commands = block.split(',').map(x => x.trim().replace(/^.*::/, '')).filter(Boolean);
    if (commands.length < 10) return `only found ${commands.length} commands; the parse is wrong`;

    const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
      'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
    const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
    const words = (n) => (n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? `-${ONES[n % 10]}` : ''}`);
    const said = words(commands.length);

    /* The header and the Cargo note both state the number in words. */
    if (!new RegExp(`${said.toUpperCase()} commands exist`).test(lib)) {
      return `lib.rs does not say "${said.toUpperCase()} commands exist" (there are ${commands.length})`;
    }
    const cargo = readFileSync(join(ROOT, 'src-tauri/Cargo.toml'), 'utf8');
    const claims = (cargo.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(-(one|two|three|four|five|six|seven|eight|nine))?\b(?= named commands| times)/g) || []);
    if (!claims.length) return 'the Cargo.toml note no longer states a count';
    const wrong = claims.filter(c => c !== said);
    if (wrong.length) return `Cargo.toml says ${wrong.join(' and ')}; there are ${commands.length} (${said})`;

    /* And all three list them by name. */
    /* Every //! line; slicing at the first "use " cuts the header in half,
       because the prose says "for `pigeon.rs`'s own use" long before the
       imports start. */
    const header = lib.split('\n').filter(l => l.startsWith('//!')).join('\n');
    const caps = readFileSync(join(ROOT, 'src-tauri/capabilities/default.json'), 'utf8');
    const undocumented = commands.filter(c => !header.includes(`\`${c}\``));
    if (undocumented.length) return `not in the lib.rs header: ${undocumented.join(', ')}`;
    const ungranted = commands.filter(c => !caps.includes(c));
    return ungranted.length === 0 || `not in capabilities/default.json: ${ungranted.join(', ')}`;
  });

  check('the menu bar window is parsed in standards mode and says its language', () => {
    const pop = readFileSync(join(ROOT, 'popover.html'), 'utf8');
    if (!/^<!DOCTYPE html>/i.test(pop)) return 'no doctype: WebKit parses this window in quirks mode';
    if (!/<html lang="en">/.test(pop)) return 'no language for a screen reader to read it in';
    const index = readFileSync(join(ROOT, 'index.html'), 'utf8');
    return /^<!DOCTYPE html>/i.test(index) || 'the main window lost its doctype';
  });
}

/* ── the hover row: a bubble alone until the mouse is on it ─────────────── */
{
  const NOW = new Date('2026-10-15T22:00:00').getTime();
  check('a message shows only its bubble until hovered; then Copy, Edit, ⋯ and how long ago', () => {
    const t = { id: 'H1', lane: 'B', message: 'hello', at: NOW - 5 * 60000, repliedAt: NOW - 4 * 60000, reply: { text: 'hi' } };
    const html = turnHtml(t, { pigeon: pigeonOf('chat'), now: NOW, last: true });
    const q = html.slice(html.indexOf('data-which="q"'), html.indexOf('data-which="a"'));
    const a = html.slice(html.indexOf('data-which="a"'));
    if (!/<span class="hov" role="group" aria-label="Your message">/.test(q)) return 'no hover row under your message';
    if (!/data-do="copy-q" data-turn="H1">Copy</.test(q) || !/data-do="edit-q" data-turn="H1">Edit</.test(q)) return 'Copy and Edit are missing under your message';
    if (!/data-tool="more" data-key="H1\|q"/.test(q)) return 'no ⋯ under your message';
    if (!/class="when" data-do="when" data-turn="H1" data-which="q" aria-pressed="false" title="Oct 15, 2026 9:55 PM">5 mins ago</.test(q)) return `the time reads ${(q.match(/class="when"[^>]*>([^<]*)</) || [])[1]}`;
    if (!/data-do="copy-a" data-turn="H1">Copy<\/button><button data-do="quote" data-turn="H1">Reply</.test(a) || /data-do="edit-q"/.test(a)) return 'a reply offers Edit, or no Copy then Reply';
    if (/data-do="quote"/.test(q)) return 'your own message offers Reply';
    if (!/aria-pressed="false" title="Oct 15, 2026 9:56 PM">4 mins ago</.test(a)) return 'the reply’s time is not when it landed';
    if (/class="tools"|class="acts"/.test(html)) return 'the old side tools or action row are still drawn';
    /* Clicked, the time opens to the minute and stays open across repaints. */
    const open = turnHtml(t, { pigeon: pigeonOf('chat'), now: NOW, whenFull: (w) => w === 'q' });
    if (!/aria-pressed="true" title="Show how long ago">Oct 15, 2026 9:55 PM</.test(open)) return 'the clicked time does not read the date and minute';
    if (!/aria-pressed="false" title="Oct 15, 2026 9:56 PM">4 mins ago</.test(open)) return 'clicking one time opened the other';
    /* While a reply is on its way, Edit waits. */
    if (!/data-do="edit-q" data-turn="H1" disabled>Edit</.test(hoverHtml(t, 'q', { now: NOW, busy: true }))) return 'Edit is not held while a reply is coming';
    const css = readFileSync(join(ROOT, 'styles/app.css'), 'utf8');
    if (!/\.hov,\.markrow\{opacity:0/.test(css) || !/\.msg:hover \.hov,\.msg:focus-within \.hov,\.msg:hover \.markrow,\.msg:focus-within \.markrow\{opacity:1\}/.test(css)) return 'the row and the receipt line are not hidden until hover';
    /* The stage line while a reply is coming is not hidden: it is progress. */
    if (/\.prov[^{]*\{[^}]*opacity:0/.test(css)) return 'the stage line hides too';
    const app = readFileSync(join(ROOT, 'src/app.js'), 'utf8');
    if (!/case 'when': \{[\s\S]*?fullWhen\.has\(key\)\) fullWhen\.delete\(key\); else fullWhen\.add\(key\)/.test(app)) return 'the click on a time is not remembered';
    if (!/case 'copy-q': \{[\s\S]*?copyText\(t\.message/.test(app) || !/case 'edit-q': startEdit\(el\.dataset\.turn\)/.test(app)) return 'Copy or Edit under your message does nothing';
    /* React moved into ⋯ with the side tools gone. */
    if (!messageMenuItems(t, 'q').some(i => i.id === 'react') || !messageMenuItems(t, 'a').some(i => i.id === 'react')) return 'React is nowhere now the side tools are gone';
    return /what === 'react'\) \{ state\.tapback = `\$\{turnId\}\|\$\{which\}`; paint\(\); \}/.test(app) || 'React… in the menu opens no tapback bar';
  });

  check('how long ago reads like a person says it, and the full stamp is to the minute', () => {
    const min = 60000;
    const want = [[10000, 'just now'], [min, '1 min ago'], [5 * min, '5 mins ago'], [59 * min, '59 mins ago'], [61 * min, '1 hour ago'],
      [3 * 60 * min, '3 hours ago'], [26 * 60 * min, '1 day ago'], [3 * 24 * 60 * min, '3 days ago'], [9 * 24 * 60 * min, '6 Oct']];
    for (const [back, s] of want) if (ago(NOW - back, NOW) !== s) return `${back / min} min back reads ${ago(NOW - back, NOW)}, want ${s}`;
    if (ago(0, NOW) !== '' || fullStamp(0) !== '') return 'no time should read as nothing';
    const am = new Date('2026-10-14T00:05:00').getTime();
    return (fullStamp(NOW) === 'Oct 15, 2026 10:00 PM' && fullStamp(am) === 'Oct 14, 2026 12:05 AM') || `${fullStamp(NOW)} / ${fullStamp(am)}`;
  });

  /* A picture sent with a message stays in the chat as a preview, kept with
     the turn, and opens over the conversation at about four fifths of it. */
  check('a sent picture shows as a preview in the chat and opens over the conversation', () => {
    const t = { id: 'P1', lane: 'B', message: 'what is this', at: NOW, reply: { text: 'a cat' },
      image: { name: 'cat.jpg', picture: true, thumb: 'data:image/jpeg;base64,CCCC', width: 800, height: 600, typed: 'what is this' } };
    const html = turnHtml(t, { pigeon: pigeonOf('peek'), now: NOW });
    if (!/<img class="from-image-pic" src="data:image\/jpeg;base64,CCCC" alt="cat.jpg" title="Open the picture" data-do="see-picture" data-turn="P1" role="button" tabindex="0">/.test(html)) return 'the preview is not a button that opens the picture';
    /* A picture whose text was read shows the same preview. */
    const read = turnHtml({ ...t, image: { name: 'bill.png', thumb: 'data:image/jpeg;base64,DDDD', text: 'TOTAL 84.50', typed: 'split this' } }, { pigeon: pigeonOf('patch'), now: NOW });
    if (!/data-do="see-picture" data-turn="P1"/.test(read) || !/words read from a picture/.test(read)) return 'a picture read for its text has no preview';
    /* Not a picture: nothing is drawn as one. */
    if (/from-image-pic/.test(turnHtml({ ...t, image: { ...t.image, thumb: 'javascript:alert(1)' } }, { pigeon: pigeonOf('peek') }))) return 'a thumb that is not a data: image was drawn';
    const index = readFileSync(join(ROOT, 'index.html'), 'utf8');
    if (!/<div class="lightbox" id="lightbox" role="dialog" aria-label="Picture" hidden>/.test(index)) return 'no lightbox in the window';
    const css = readFileSync(join(ROOT, 'styles/app.css'), 'utf8');
    if (!/\.lightbox\{position:absolute;inset:0;[^}]*background:var\(--shade\)/.test(css) || !/\.lightbox img\{max-width:80%;max-height:80%/.test(css)) return 'the opened picture is not four fifths of the pane over a shade';
    const app = readFileSync(join(ROOT, 'src/app.js'), 'utf8');
    const fn = (app.match(/function openPicture \(turn\)[\s\S]*?\n}\n/) || [''])[0];
    if (!/sentPictures\.get\(turn\.image\)\) \|\| turn\.image\.thumb/.test(fn)) return 'the picture itself is not shown while it is still in memory';
    if (!/src\.startsWith\('data:image\/'\)/.test(fn) || !/e\.key === 'Escape'/.test(fn)) return 'the lightbox opens anything, or Escape does not close it';
    /* The preview goes to disk with the turn; the picture itself never does,
       and an oversized or non-image "preview" is dropped on reading. */
    const disk = JSON.stringify(forDisk([{ id: 'a', nodes: { P1: t } }]));
    if (!/CCCC/.test(disk)) return 'the preview is stripped on the way to disk';
    const back = parseBlob(JSON.stringify({ version: 3, chats: [{ id: 'a', nodes: {
      P1: t,
      P2: { ...t, id: 'P2', image: { ...t.image, thumb: 'data:image/jpeg;base64,' + 'A'.repeat(500 * 1024) } },
      P3: { ...t, id: 'P3', image: { ...t.image, thumb: 'https://example.com/x.jpg' } }
    } }] })).chats[0].nodes;
    return (back.P1.image.thumb === 'data:image/jpeg;base64,CCCC' && back.P2.image.thumb === null && back.P3.image.thumb === null)
      || `read back ${JSON.stringify([back.P1.image.thumb, back.P2.image.thumb, back.P3.image.thumb]).slice(0, 200)}`;
  });
}

await Promise.all(pending);

/* ── the chats file, when it cannot be read ───────────────────────────────
 *
 * Run after everything else and strictly in order, because each case installs
 * its own `globalThis.__TAURI__` and a concurrent check would see it. Each one
 * imports store.js under a fresh URL so it gets its own module state — `held`
 * is set for the life of a session on purpose, and these are four sessions.
 *
 * What is being defended: an unreadable file must never become an overwritten
 * one. Rust already tells "nothing saved yet" apart from "could not be read"
 * (store.rs), and this is the half of that contract that lives on the page. */
async function storeGuards () {
  const fresh = (n) => import(`../src/store.js?case=${n}`);
  const withBridge = async (n, invoke, body) => {
    const had = Object.prototype.hasOwnProperty.call(globalThis, '__TAURI__');
    const before = globalThis.__TAURI__;
    globalThis.__TAURI__ = { core: { invoke } };
    try { return await body(await fresh(n)); }
    finally { if (had) globalThis.__TAURI__ = before; else delete globalThis.__TAURI__; }
  };
  const saved = (calls) => calls.filter(c => c[0] === 'save_state').length;

  await record('a chats file that cannot be read holds the session rather than replacing it', await withBridge(1,
    async (cmd) => { if (cmd === 'load_state') throw new Error('could not read state.json: Permission denied'); return null; },
    async (store) => {
      const out = await store.loadState();
      if (!out || out.readOnly !== true || out.why !== 'unread') return `loadState said ${JSON.stringify(out)}`;
      if (!store.isReadOnly() || store.holdReason() !== 'unread') return 'the session did not hold its writes';
      store.saveState({ version: store.STATE_VERSION, chats: [] });
      await store.flush();
      return true;
    }));

  await record('an unreadable file is moved aside, and then the session saves as normal', await withBridge(2,
    async (cmd) => {
      if (cmd === 'load_state') return '{ truncated';
      if (cmd === 'keep_unreadable_state') return 'state.unreadable-1757000000.json';
      return null;
    },
    async (store) => {
      const out = await store.loadState();
      if (!out || out.why !== 'corrupt' || out.kept !== 'state.unreadable-1757000000.json') return `loadState said ${JSON.stringify(out)}`;
      return !store.isReadOnly() || 'the file was kept aside and the session STILL refuses to save';
    }));

  await record('an unreadable file that cannot be moved aside holds the session', await withBridge(3,
    async (cmd) => {
      if (cmd === 'load_state') return '{ truncated';
      if (cmd === 'keep_unreadable_state') throw new Error('Read-only file system');
      throw new Error(`save_state must never be reached: ${cmd}`);
    },
    async (store) => {
      const out = await store.loadState();
      if (!out || out.readOnly !== true || out.why !== 'corrupt') return `loadState said ${JSON.stringify(out)}`;
      /* The throw above is the assertion: a held session that writes anyway fails here. */
      store.saveState({ version: store.STATE_VERSION, chats: [] });
      await store.flush();
      return store.isReadOnly() || 'the session did not hold its writes';
    }));

  await record('an empty file is a first launch, not something to be kept aside', await withBridge(4,
    async (cmd) => {
      if (cmd === 'load_state') return '   ';
      throw new Error(`nothing else should be called: ${cmd}`);
    },
    async (store) => {
      const out = await store.loadState();
      return (out === null && !store.isReadOnly()) || `loadState said ${JSON.stringify(out)}`;
    }));

  await record('a newer file still holds the session, as it always has', await withBridge(5,
    async (cmd) => (cmd === 'load_state' ? JSON.stringify({ version: STATE_VERSION + 9, chats: [] }) : null),
    async (store) => {
      const out = await store.loadState();
      return (out && out.readOnly === true && out.why === 'newer' && store.holdReason() === 'newer') || `loadState said ${JSON.stringify(out)}`;
    }));

  /* Two refused writes in a row is a Mac that will not take them. The app is
     told so it can say so — and told again when it starts working, because a
     line claiming "not saved" after saving resumed is its own lie. */
  const calls = [];
  await record('two failed saves in a row are reported, and a success takes it back', await withBridge(6,
    async (cmd, args) => {
      calls.push([cmd, args]);
      if (cmd === 'save_state' && saved(calls) <= 2) throw new Error('No space left on device');
      return null;
    },
    async (store) => {
      const said = [];
      /* The two refusals below are the point of the test, and store.js warns on
         each one; keep them out of the suite's own output. */
      const warn = console.warn;
      console.warn = () => {};
      try {
        store.onSaveTrouble((failing) => said.push(failing));
        for (let i = 0; i < 3; i++) { store.saveState({ version: store.STATE_VERSION, chats: [{ id: `c${i}`, nodes: {} }] }); await store.flush(); }
        if (saved(calls) !== 3) return `it stopped trying after ${saved(calls)} writes`;
        if (store.saveFailing()) return 'it still reads as failing after a write succeeded';
        return isDeepStrictEqual(said, [true, false]) || `it said ${JSON.stringify(said)}, want [true,false]`;
      } finally { console.warn = warn; }
    }));

  record('restoreChats says which of the three reasons it is holding for', (() => {
    const app = readFileSync(join(ROOT, 'src/app.js'), 'utf8');
    const fn = (app.match(/async function restoreChats \(\)[\s\S]*?\n}\n/) || [''])[0];
    if (!/saved\.readOnly/.test(fn) || !/newer:/.test(fn) || !/unread:/.test(fn) || !/corrupt:/.test(fn)) return fn.slice(0, 400);
    return /saved\.why === 'corrupt'/.test(fn) && /saved\.kept/.test(fn) ? true : 'the kept-aside file is never named to the person';
  })());
}
await storeGuards();

/* ── the log (src/log.js; the file itself is src-tauri/src/log.rs) ────────── */
{
  const { turnSummary, cut, asksVerdict } = await import('../src/log.js');
  const long = 'how many working days are there between the first of march and the end of june this year, not counting bank holidays';
  const turn = {
    lane: 'A', mode: 'planned', message: long, ms: 2410,
    stages: { router: 70, planner: 1800, asks: 900 },
    routing: { category: 'dates', confidence: 0.98765, forPlanner: [{ name: 'a' }, { name: 'b' }, { name: 'c' }] },
    plan: { steps: [{ id: 's1', skill: 'workdaysBetween', input: { from: '2026-03-01', to: '2026-06-30', note: long } }] },
    results: [
      { skill: 'workdaysBetween', ok: true, ms: 3 },
      { skill: 'sum', ok: false, ms: 1, error: { code: 'INVALID_INPUT', message: long, dropped: [{ field: 'values' }] } }
    ],
    reply: { segments: [] }
  };
  const s = turnSummary(turn, { pigeon: 'patch', receipt: 'Worked out · Workdays between', reply: long });
  record('the log keeps a message to its first 80 characters', s.message === cut(long) && [...s.message].length === 81 && s.message.endsWith('…') || JSON.stringify(s.message));
  record('the log keeps the plan whole, with the arguments the planner chose', s.plan.steps[0].input.note === long || 'the plan was cut');
  record('the log names the router\'s category, confidence and shortlist', (s.router.category === 'dates' && s.router.confidence === 0.988 && s.shortlist === 3) || JSON.stringify(s.router));
  record('the log says the asks check let the plan stand', asksVerdict(turn) === 'yes' && s.asks === 'yes' || s.asks);
  record('the log says the asks check dropped a plan', asksVerdict({ asked: { asks: false }, stages: { asks: 5 } }) === 'no');
  record('the log leaves out the asks check when it never ran', asksVerdict({ stages: {} }) === null && turnSummary({ message: 'x' }).asks === undefined);
  record('the log lists each skill run, with its error cut', (s.skills.length === 2 && s.skills[1].error.code === 'INVALID_INPUT' && [...s.skills[1].error.message].length === 81) || JSON.stringify(s.skills));
  record('the log names what the audit dropped', isDeepStrictEqual(s.audit, { dropped: ['values'] }) || JSON.stringify(s.audit));
  record('the log keeps timing per stage and the reply\'s first 80 characters', (s.stages.planner === 1800 && s.ms === 2410 && [...s.reply].length === 81) || JSON.stringify(s));
  record('a failed turn is logged with its error', turnSummary({ message: 'x', interrupted: true, error: 'the engine did not answer' }).error === 'the engine did not answer');
  record('cut leaves short text alone and counts characters, not bytes', cut('héllo', 3) === 'hél…' && cut('hi') === 'hi' && cut(null) === null);
  const app = readFileSync(join(ROOT, 'src/app.js'), 'utf8');
  const land = (app.match(/function landReply \(chatId, turn[\s\S]*?\n}\n/) || [''])[0];
  record('every turn that lands in the window is logged', /logTurn\(turn/.test(land) || 'landReply does not log');
  for (const w of ['src/popover.js', 'src/bar.js']) {
    const src = readFileSync(join(ROOT, w), 'utf8');
    const tell = (src.match(/function tellWindow \([\s\S]*?\n}\n/) || [''])[0];
    record(`${w} logs what it hands the window`, /logTurn\(/.test(tell) || 'tellWindow does not log');
  }
}

/* ── Copy diagnostics (src/diagnostics.js) ─────────────────────────────── */
{
  const { diagnosticsText, COPY_NOTE, LOG_MINUTES } = await import('../src/diagnostics.js');
  const long = 'please work out what 17.5% of the deposit on a house costing four hundred and twenty thousand pounds would be';
  const text = diagnosticsText({
    header: 'App: Pigeon 0.1.0 (abc1234)\nEngine: libpigeon 0.1.0',
    lines: ['2026-10-15T11:00:00.000+01:00 launch Pigeon 0.1.0'],
    chat: 'Deposit', pigeon: 'Patch', now: Date.UTC(2026, 9, 15, 10),
    turns: [{ turn: { at: Date.UTC(2026, 9, 15, 9), lane: 'A', mode: 'planned', message: long, routing: { category: 'money', confidence: 0.9876, forPlanner: [1, 2] },
      plan: { steps: [{ skill: 'percentOf', input: { percent: 17.5, of: 420000 } }] }, results: [{ skill: 'percentOf', ok: true, ms: 2 }] }, receipt: 'Worked out · Percent of' }],
    warnings: [{ pigeon: 'Pat', code: 'prompt_unchecked', text: 'made before Pigeons carried a self-check' }]
  });
  const first = text.split('\n')[0];
  record('the copy\'s first line says what it holds and that nothing was sent', /this chat's turns/.test(first) && /last 60 minutes/.test(first) && /Nothing was sent anywhere/.test(first) || first);
  record('the copy has the header, the turns, the log and the warnings, in that order', (() => {
    const at = ['== This Mac and build ==', 'App: Pigeon 0.1.0 (abc1234)', '== This chat', '== Log, last 60 minutes (1 line) ==', 'launch Pigeon 0.1.0', '== Open warnings ==', 'Pat: prompt_unchecked'].map(x => text.indexOf(x));
    return at.every((x, i) => x >= 0 && (i === 0 || x > at[i - 1])) || JSON.stringify(at);
  })());
  record('a turn in the copy carries its receipt, router, plan and skills', ['receipt: Worked out · Percent of', 'router: money at 0.988, shortlist 2', 'plan: {"steps":[{"skill":"percentOf","input":{"percent":17.5,"of":420000}}]}', 'skill percentOf: ok (2 ms)'].every(x => text.includes(x)) || text);
  record('a message in the copy is cut to its first 80 characters', !text.includes(long) && text.includes(long.slice(0, 80) + '…'));
  const empty = diagnosticsText({});
  record('an empty chat and a quiet hour still say so', /\(no turns yet\)/.test(empty) && /nothing logged in the last hour/.test(empty) && /== Open warnings ==\nnone/.test(empty) || empty);
  record('the button\'s label says what it copies and that nothing is sent', COPY_NOTE === 'copies this chat and the last hour of the log; nothing is sent' && LOG_MINUTES === 60);
  {
    const app = readFileSync(join(ROOT, 'src/app.js'), 'utf8');
    const fn = (app.match(/async function copyDiagnostics \(c\) \{[\s\S]*?\n}\n/) || [''])[0];
    record('Copy diagnostics goes to the pasteboard through Rust, not the page\'s clipboard', (/call\('diagnostics_copy', \{ text \}\)/.test(fn) && /Nothing was sent/.test(fn)) || fn.slice(-500));
    const copy = (app.match(/async function copyText \(text\) \{[\s\S]*?\n}\n/) || [''])[0];
    record('a refused copy is not reported as copied', /copied = document\.execCommand\('copy'\)/.test(copy) && /toast\(copied \? 'Copied\.' :/.test(copy) || copy);
  }
  const html = chatDetailsHtml({ title: 'T' }, { name: 'Patch', pick: 'patch', kind: 'verified' }, { facts: [], dev: [] });
  record('Copy diagnostics sits under Details for developers, even with no facts', /<summary>Details for developers<\/summary>[\s\S]*data-do="copy-diagnostics"[\s\S]*nothing is sent<\/small><\/button><\/details>/.test(html) || html);
}

/* ── Settings › General › Developer ───────────────────────────────────── */
{
  const { developerHtml, LOG_PRIVACY, LOG_RANGES } = await import('../src/ui/settings.js');
  const general = settingsHtml({ tab: 'general', native: true, dev: false });
  record('Developer is in a release build\'s General tab, collapsed', /<details class="st-details st-dev"><summary>Developer<\/summary>/.test(general) && !/<details class="st-details st-dev" open/.test(general) || general);
  record('a browser tab, with no log, has no Developer section', !/st-dev/.test(settingsHtml({ tab: 'general', native: false })));
  record('Save logs offers Today, Last 7 days, Last 30 days and a custom range', isDeepStrictEqual(LOG_RANGES.map(r => r[1]), ['Today', 'Last 7 days', 'Last 30 days', 'From… to…']));
  const dev7 = developerHtml({ range: '7' });
  record('Save logs…, Show log folder and the privacy line sit together', /data-s="logs-save">Save logs…/.test(dev7) && /data-s="logs-reveal">Show log folder/.test(dev7) && dev7.includes(escHtml(LOG_PRIVACY)) || dev7);
  record('the custom range asks for two dates and only then', !/type="date"/.test(dev7) && (developerHtml({ range: 'custom', from: '2026-10-01' }).match(/type="date"/g) || []).length === 2 && /value="2026-10-01"/.test(developerHtml({ range: 'custom', from: '2026-10-01' })));
  record('the privacy line says what the log holds, never holds, and how it leaves', /first 80 characters/.test(LOG_PRIVACY) && /never holds a whole message, a picture or a key/.test(LOG_PRIVACY) && /only way it leaves/.test(LOG_PRIVACY));
}

/* ── report ─────────────────────────────────────────────────────────────── */
console.log('');
if (failures.length) {
  console.log('FAILURES\n');
  for (const f of failures) console.log('  ✗ ' + f + '\n');
}
const builtCount = registry.routable().length;
const stubCount = registry.all().length - builtCount;
console.log(`  ${pass} passed, ${fail} failed`);
console.log(`  ${builtCount} skills routable · ${stubCount} unbuilt (registry-only) · ${registry.categories().length} categories`);
console.log('');
process.exit(fail ? 1 : 0);
