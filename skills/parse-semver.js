import { ok, fail, computed } from '../src/contracts.js';

const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/;

export default {
  name: 'parseSemver',
  description: "Split one version number into major, minor, patch and pre-release.",
  category: 'developer', tier: 'standard',
  title: 'Parse a version',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: 'Major {{major}}, minor {{minor}}, patch {{patch}}{{extra|prose}}.',
  inputSchema: {
    type: 'object', required: ['version'],
    properties: { version: { type: 'string', label: 'version', minLength: 1, prompt: 'Which version number?' } }
  },
  outputSchema: { type: 'object', properties: { major: { type: 'integer' }, minor: { type: 'integer' }, patch: { type: 'integer' }, prerelease: { type: 'string' }, build: { type: 'string' }, stable: { type: 'boolean' }, normalised: { type: 'string' }, extra: { type: 'string' } } },
  examples: [
    { text: 'break down version 2.11.5', input: { version: '2.11.5' }, output: { major: 2, minor: 11, patch: 5, prerelease: '', build: '', stable: true, normalised: '2.11.5', extra: '' } },
    { text: 'parse v1.0.0-beta.2', input: { version: 'v1.0.0-beta.2' }, output: { major: 1, minor: 0, patch: 0, prerelease: 'beta.2', build: '', stable: false, normalised: '1.0.0-beta.2', extra: ', pre-release beta.2' } },
    { text: 'what are the parts of 0.1.0', input: { version: '0.1.0' }, output: { major: 0, minor: 1, patch: 0, prerelease: '', build: '', stable: false, normalised: '0.1.0', extra: ', still pre-1.0' } },
    { text: 'parse a version with build metadata', input: { version: '1.2.3+20260901' }, output: { major: 1, minor: 2, patch: 3, prerelease: '', build: '20260901', stable: true, normalised: '1.2.3+20260901', extra: ', build 20260901' } },
    { text: 'parse 10.4.0-rc.1', input: { version: '10.4.0-rc.1' }, output: { major: 10, minor: 4, patch: 0, prerelease: 'rc.1', build: '', stable: false, normalised: '10.4.0-rc.1', extra: ', pre-release rc.1' } }
  ],
  errorCases: [
    { input: { version: '1.2' }, code: 'INVALID_INPUT' },
    { input: { version: 'latest' }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' }
  ],
  run (input) {
    const m = SEMVER.exec(String(input.version).trim());
    if (!m) return fail('INVALID_INPUT', `"${input.version}" isn't a semantic version — it needs major.minor.patch.`, 'version');
    const [, major, minor, patch, prerelease = '', build = ''] = m;
    /* A 0.x release is not stable by semver's own rules — "anything MAY change
       at any time" — so `stable` means major >= 1 AND no pre-release tag,
       which is what a caller deciding whether to depend on it wants to know. */
    const stable = Number(major) >= 1 && !prerelease;
    const extra = prerelease ? `, pre-release ${prerelease}`
      : Number(major) === 0 ? ', still pre-1.0'
        : build ? `, build ${build}` : '';
    return ok({
      major: Number(major), minor: Number(minor), patch: Number(patch),
      prerelease, build, stable,
      normalised: `${major}.${minor}.${patch}${prerelease ? `-${prerelease}` : ''}${build ? `+${build}` : ''}`,
      extra
    }, computed());
  }
};
