import { ok, fail, computed } from '../src/contracts.js';

const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

const parse = (v) => {
  const m = SEMVER.exec(String(v).trim());
  return m ? { major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] ?? '' } : null;
};

export default {
  name: 'compareSemver',
  description: "Say which of two version numbers is the newer.",
  category: 'developer', tier: 'standard',
  title: 'Compare versions',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{verdict|prose}}',
  inputSchema: {
    type: 'object', required: ['a', 'b'],
    properties: {
      a: { type: 'string', label: 'first version', minLength: 1, prompt: 'Which is the first version?' },
      b: { type: 'string', label: 'second version', minLength: 1, prompt: 'Which is the second version?' }
    }
  },
  outputSchema: { type: 'object', properties: { result: { type: 'integer' }, newer: { type: 'string' }, verdict: { type: 'string' }, difference: { type: 'string' }, a: { type: 'string' }, b: { type: 'string' } } },
  examples: [
    { text: 'is 2.11.5 newer than 2.9.0', input: { a: '2.11.5', b: '2.9.0' }, output: { result: 1, newer: '2.11.5', verdict: '2.11.5 is newer than 2.9.0 — a minor version ahead.', difference: 'minor', a: '2.11.5', b: '2.9.0' } },
    { text: 'compare 1.0.0 and 1.0.1', input: { a: '1.0.0', b: '1.0.1' }, output: { result: -1, newer: '1.0.1', verdict: '1.0.1 is newer than 1.0.0 — a patch version ahead.', difference: 'patch', a: '1.0.0', b: '1.0.1' } },
    { text: 'which is newer, 1.0.0 or 1.0.0-beta', input: { a: '1.0.0', b: '1.0.0-beta' }, output: { result: 1, newer: '1.0.0', verdict: '1.0.0 is newer than 1.0.0-beta — a release beats its pre-release.', difference: 'prerelease', a: '1.0.0', b: '1.0.0-beta' } },
    { text: 'compare two identical versions', input: { a: '3.2.1', b: '3.2.1' }, output: { result: 0, newer: '', verdict: '3.2.1 and 3.2.1 are the same version.', difference: 'none', a: '3.2.1', b: '3.2.1' } },
    { text: 'is 10.0.0 newer than 9.9.9', input: { a: '10.0.0', b: '9.9.9' }, output: { result: 1, newer: '10.0.0', verdict: '10.0.0 is newer than 9.9.9 — a major version ahead.', difference: 'major', a: '10.0.0', b: '9.9.9' } }
  ],
  errorCases: [
    { input: { a: '1.0', b: '1.0.0' }, code: 'INVALID_INPUT' },
    { input: { a: '1.0.0' }, code: 'MISSING_FIELD' },
    { input: { a: 'latest', b: '1.0.0' }, code: 'INVALID_INPUT' }
  ],
  run (input) {
    const pa = parse(input.a);
    if (!pa) return fail('INVALID_INPUT', `"${input.a}" isn't a semantic version.`, 'a');
    const pb = parse(input.b);
    if (!pb) return fail('INVALID_INPUT', `"${input.b}" isn't a semantic version.`, 'b');

    let result = 0, difference = 'none';
    for (const part of ['major', 'minor', 'patch']) {
      if (pa[part] !== pb[part]) { result = pa[part] > pb[part] ? 1 : -1; difference = part; break; }
    }
    if (result === 0 && pa.pre !== pb.pre) {
      /* Semver rule: a version WITHOUT a pre-release outranks the same version
         with one — 1.0.0 is newer than 1.0.0-beta, which reads backwards to
         anyone comparing the strings. */
      difference = 'prerelease';
      if (!pa.pre) result = 1;
      else if (!pb.pre) result = -1;
      else result = pa.pre > pb.pre ? 1 : -1;
    }

    const newer = result === 1 ? input.a : result === -1 ? input.b : '';
    const older = result === 1 ? input.b : input.a;
    const tail = difference === 'prerelease' ? ' — a release beats its pre-release.'
      : difference === 'none' ? '' : ` — a ${difference} version ahead.`;
    return ok({
      result, newer,
      verdict: result === 0 ? `${input.a} and ${input.b} are the same version.` : `${newer} is newer than ${older}${tail}`,
      difference, a: input.a, b: input.b
    }, computed());
  }
};
