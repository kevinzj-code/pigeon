/* lint-imports.js — the wall between the lanes, as something a machine checks.
 *
 * §5.1 of the spec: "No shared code path between Lane B's renderer and
 * fabrication.js or any skill executor. Enforce this at CI time, not only in
 * code review." This is that enforcement. `npm test` fails the build if the
 * wall is breached, which is the point — a wall that only exists in a review
 * comment is a wall that a refactor removes without anyone noticing.
 *
 * Three rules (the third, below `wallViolations`, keeps Node-only
 * `scripts/lib/` out of the webview), and the first is stricter than the
 * spec asks for:
 *
 *   1. A module under `src/lane-b/` may import only from `src/lane-b/`.
 *      Not just "not the executor and not the audit" — nothing at all from
 *      the rest of `src/`. A total rule is one sentence to state, one line to
 *      check, and has no edge for an argument to live on; the narrow version
 *      invites "well, contracts.js is harmless", and it is, right up until
 *      the thing imported through it is not. If Lane B ever genuinely needs a
 *      shared helper, the honest move is to copy it or to loosen this rule
 *      deliberately, in a commit that says why.
 *
 *   2. Only the files that draw a window — `src/app.js`, `src/popover.js` and
 *      `src/bar.js` —
 *      may import `src/lane-b/`. The lane is reached from a UI and from its
 *      own tests; nothing in the pipeline may reach into it, or the generative
 *      path would become something a Lane A turn could end up in.
 *
 * Pure and dependency-free so the test suite can call it; `scripts/lintimports.mjs`
 * is the same thing with a command line for a person.
 */

/** Where the lane lives, relative to the repo root. One place to change it. */
export const LANE_B_DIR = 'src/lane-b';
/** The modules allowed to reach into the lane: the three that draw a window,
 *  and nothing else. Adding to this list is the deliberate act the rule below
 *  is about — it is a short list on purpose, and it is where an argument
 *  should have to be made. */
export const LANE_B_CALLERS = ['src/app.js', 'src/popover.js', 'src/bar.js'];

/* Static `import ... from '...'`, `export ... from '...'`, and dynamic
   `import('...')`. Comments are stripped first so a specifier quoted inside a
   comment — this file is full of them — is not read as an import. */
const STRIP_COMMENTS = /\/\*[\s\S]*?\*\/|(^|[^:])\/\/[^\n]*/g;
const SPECIFIER = /(?:^|[\s;}])(?:import|export)\s[^'"`;]*?from\s*['"]([^'"]+)['"]|(?:^|[^.\w])import\s*\(\s*['"]([^'"]+)['"]/g;

/** Every module specifier a source file imports. */
export function importsIn (source) {
  const code = String(source ?? '').replace(STRIP_COMMENTS, '$1');
  const out = [];
  for (const m of code.matchAll(SPECIFIER)) out.push(m[1] ?? m[2]);
  return out;
}

/** Does this specifier stay inside the lane? Relative, and not climbing out. */
export function staysInsideLane (spec) {
  if (!spec.startsWith('.')) return false;
  if (spec.startsWith('./') && !spec.includes('..')) return true;
  return false;
}

/** Does this specifier reach into the lane from outside? */
export function reachesIntoLane (spec) {
  return /(^|\/)lane-b\//.test(spec);
}

/**
 * Check the wall.
 *
 * `files` is `[{ path, source }]` with repo-relative paths — the caller reads
 * the disk so this stays pure. Returns a list of violations, empty when the
 * wall holds.
 */
export function wallViolations (files) {
  const out = [];
  for (const { path, source } of files) {
    const inLane = path.startsWith(`${LANE_B_DIR}/`);
    for (const spec of importsIn(source)) {
      if (inLane && !staysInsideLane(spec)) {
        out.push({
          path,
          spec,
          rule: 'lane-b-imports-out',
          message: `${path} imports ${spec}. Lane B may import only from ${LANE_B_DIR}/ — it cannot be allowed to run a skill or audit a value.`
        });
      }
      if (!inLane && reachesIntoLane(spec) && !LANE_B_CALLERS.includes(path)) {
        out.push({
          path,
          spec,
          rule: 'reaches-into-lane-b',
          message: `${path} imports ${spec}. Only ${LANE_B_CALLERS.join(', ')} may reach into Lane B.`
        });
      }
    }
  }
  return out.concat(scriptsLibViolations(files), lockedRoomViolations(files));
}

/* Rule 4: skill code is loaded in one place. Patch's skills run in a locked
   Blob worker (src/skill-worker.js) and nowhere else, so nothing else under
   src/ may name the pack scheme or import a module whose name is computed —
   a computed import in the page would load pack code outside the room. The
   protocol file may name the scheme because it validates it. patch-pack.js,
   the main-thread half, may not import dynamically at all, not even a
   literal: it has no business loading code. */
export const SKILL_WORKER = 'src/skill-worker.js';
export const PATCH_PACK = 'src/patch-pack.js';
export const PACK_SCHEME_FILES = [SKILL_WORKER, 'src/skill-protocol.js'];
const DYNAMIC_IMPORT = /(?:^|[^.\w$])import\s*\(/g;
const LITERAL_ARG = /^\s*(['"])[^'"\\\n]*\1\s*\)/;

/** Violations of rule 4 alone, for files under src/. */
export function lockedRoomViolations (files) {
  const out = [];
  for (const { path, source } of files) {
    /* This file spells out the patterns it looks for, so it is not read by them. */
    if (!path.startsWith('src/') || path === 'src/lint-imports.js') continue;
    const raw = String(source ?? '');
    const code = raw.replace(STRIP_COMMENTS, '$1');
    if (path === PATCH_PACK && /\bimport\s*\(/.test(raw)) {
      out.push({ path, spec: 'import(', rule: 'patch-pack-loads-code', message: `${path} contains import(. The main-thread half of the locked room loads no code; the worker does.` });
    }
    if (!PACK_SCHEME_FILES.includes(path) && code.includes('pigeon-pack')) {
      out.push({ path, spec: 'pigeon-pack', rule: 'pack-scheme-outside-worker', message: `${path} names pigeon-pack. Only ${PACK_SCHEME_FILES.join(' and ')} may: pack code is loaded in the locked worker and nowhere else.` });
    }
    if (path !== SKILL_WORKER) {
      for (const m of code.matchAll(DYNAMIC_IMPORT)) {
        const rest = code.slice(m.index + m[0].length);
        if (!LITERAL_ARG.test(rest)) {
          out.push({ path, spec: rest.slice(0, 40).split('\n')[0], rule: 'computed-import-outside-worker', message: `${path} imports a module whose name is computed. Only ${SKILL_WORKER} may; anywhere else it could load pack code outside the locked room.` });
        }
      }
    }
  }
  return out;
}

/* Rule 3: nothing under `src/` (the webview bundle) imports from
   `scripts/lib/`. That folder is Node-only tooling — the seal checker, the
   strict zip reader — and the shipped reader of record is the Rust one. A
   webview that imported the Node copy would be trusting a second
   implementation, and one that cannot even load in a browser. */
export const SCRIPTS_LIB_DIR = 'scripts/lib';

/** Resolve a relative specifier against a repo-relative file path, posix-style, without node:path. */
function resolveFrom (path, spec) {
  const parts = path.split('/').slice(0, -1);
  for (const seg of spec.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') parts.pop(); else parts.push(seg);
  }
  return parts.join('/');
}

/** Does this specifier, imported from `path`, land in scripts/lib/? */
export function reachesScriptsLib (path, spec) {
  const target = spec.startsWith('.') ? resolveFrom(path, spec) : spec.replace(/^\/+/, '');
  return target === SCRIPTS_LIB_DIR || target.startsWith(`${SCRIPTS_LIB_DIR}/`) || /(^|\/)scripts\/lib\//.test(spec);
}

/** Violations of rule 3 alone, for files under src/. */
export function scriptsLibViolations (files) {
  const out = [];
  for (const { path, source } of files) {
    if (!path.startsWith('src/')) continue;
    for (const spec of importsIn(source)) {
      if (reachesScriptsLib(path, spec)) {
        out.push({
          path,
          spec,
          rule: 'src-imports-scripts-lib',
          message: `${path} imports ${spec}. Nothing under src/ may import ${SCRIPTS_LIB_DIR}/ — it is Node-only tooling, not part of the app.`
        });
      }
    }
  }
  return out;
}

/** The violations as something a person reads. */
export function formatViolations (found) {
  if (!found.length) return 'the wall holds: Lane B imports nothing from the verified path';
  return found.map(v => `  ${v.message}`).join('\n');
}
