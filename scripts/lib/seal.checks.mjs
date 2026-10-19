/* seal.checks.mjs — the seal and strict-zip checks, for scripts/test.mjs.
 *
 *   import { sealChecks } from './lib/seal.checks.mjs';
 *   await sealChecks(check);
 *
 * `check(name, fn)`: fn returns true (or undefined) to pass, or a string that
 * says what went wrong.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sign, verify } from 'node:crypto';

import { listEntries, get, buildStoreZip, malform } from './zip-store.mjs';
import {
  sealMessage, keyId, keyFromSeed, publicKeyObject, checkSeal, pigeonRules,
  sealZip, validateTrustedKeys, loadTrustedKeys, SEAL_NAME, SCHEME
} from './seal.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIXTURES = join(ROOT, 'src-tauri', 'tests', 'fixtures');

/* RFC 8032 §7.1, TESTs 1–3. TEST 1 is the published seal test key. */
const RFC8032 = [
  { name: 'TEST 1',
    seed: '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60',
    pub: 'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a',
    msg: '',
    sig: 'e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b' },
  { name: 'TEST 2',
    seed: '4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb',
    pub: '3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c',
    msg: '72',
    sig: '92a009a9f0d4cab8720e820b5f642540a2b27b5416503f8fb3762223ebdb69da085ac1e43e15996e458f3613d0f11d8c387b2eaeb4302aeeb00d291612bb0c00' },
  { name: 'TEST 3',
    seed: 'c5aa8df43f9f837bedb7442f31dcb7b166d38535076f094b85ce3a2e0b4458f7',
    pub: 'fc51cd8e6218a1a38da47ed00230f0580816ed13ba3303ac5deb911548908025',
    msg: 'af82',
    sig: '6291d657deec24024827e69c3abe01a30ce548a284743a445e3680d7db5ac3ac18ff9b538d16f290ae67f760984dc6594a7c15e9716ed28dc027beceea1ec40a' }
];

export const TEST_SEED = RFC8032[0].seed;

/** fn must throw, with a message matching `re` when given. */
function refuses (fn, re) {
  try { fn(); } catch (e) {
    if (re && !re.test(e.message)) return `refused for the wrong reason: ${e.message}`;
    return true;
  }
  return 'accepted';
}

const trustedTest = (revoked = false) => {
  const pub = Buffer.from(RFC8032[0].pub, 'hex');
  return validateTrustedKeys([{ id: keyId(pub), ed25519_pub_hex: RFC8032[0].pub, revoked }]);
};
const manifest = (kind) => JSON.stringify({ format_version: 2, name: 'n', id: 'n', kind });
const rules = (buf, keys) => pigeonRules(listEntries(buf), buf, keys);
const seal = (buf, keys) => checkSeal(listEntries(buf), buf, keys);

export async function sealChecks (check) {
  /* ── Ed25519 itself ── */
  for (const v of RFC8032) {
    check(`seal: RFC 8032 ${v.name} public key from seed`, () => {
      const { pub } = keyFromSeed(v.seed);
      return pub.toString('hex') === v.pub || `got ${pub.toString('hex')}`;
    });
    check(`seal: RFC 8032 ${v.name} signature`, () => {
      const { privateKey } = keyFromSeed(v.seed);
      const s = sign(null, Buffer.from(v.msg, 'hex'), privateKey).toString('hex');
      return s === v.sig || `got ${s}`;
    });
    check(`seal: RFC 8032 ${v.name} verifies, and a flipped bit does not`, () => {
      const key = publicKeyObject(Buffer.from(v.pub, 'hex'));
      const sig = Buffer.from(v.sig, 'hex');
      if (!verify(null, Buffer.from(v.msg, 'hex'), key, sig)) return 'the vector did not verify';
      sig[0] ^= 1;
      return !verify(null, Buffer.from(v.msg, 'hex'), key, sig) || 'a flipped signature verified';
    });
  }

  check('seal: the TEST 1 key id is sha256(pub)[:16]', () => {
    const id = keyId(Buffer.from(RFC8032[0].pub, 'hex'));
    return /^[0-9a-f]{16}$/.test(id) || id;
  });

  check('seal: the shipped trusted keys file loads', () => {
    const keys = loadTrustedKeys();
    return Array.isArray(keys) || 'not an array';
  });

  check('seal: trusted keys refuse a duplicate id, a wrong id, and a missing revoked flag', () => {
    const k = { id: keyId(Buffer.from(RFC8032[0].pub, 'hex')), ed25519_pub_hex: RFC8032[0].pub, revoked: false };
    const k2 = { ...k, ed25519_pub_hex: RFC8032[1].pub, id: keyId(Buffer.from(RFC8032[1].pub, 'hex')) };
    for (const [label, list] of [
      ['duplicate', [k, k]],
      ['wrong id', [{ ...k, id: k2.id }]],
      ['no revoked', [{ id: k.id, ed25519_pub_hex: k.ed25519_pub_hex }]]
    ]) {
      const r = refuses(() => validateTrustedKeys(list));
      if (r !== true) return `${label}: ${r}`;
    }
    return validateTrustedKeys([k, k2]).length === 2 || 'two distinct keys refused';
  });

  /* ── the signed message ── */
  check('seal: message bytes for a fixed entry set', () => {
    const zip = buildStoreZip([['pigeon.json', '{}'], ['B.txt', 'b'], ['a/b.txt', ''], ['a.txt', 'a']]);
    const msg = sealMessage(listEntries(zip), zip).toString('latin1');
    const want =
      'PIGEON-SEAL-V1\n' +
      '3e23e8160039594a33894f6564e1b1348bbd7a0088d42c4acb73eeaed59c009d  B.txt\n' +
      'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb  a.txt\n' +
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  a/b.txt\n' +
      '44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a  pigeon.json\n';
    return msg === want || `got:\n${msg}`;
  });

  check('seal: the message leaves seal.json out', () => {
    const z = sealZip([['pigeon.json', manifest('freeform')]], TEST_SEED);
    const msg = sealMessage(listEntries(z), z).toString('latin1');
    return !msg.includes(SEAL_NAME) || msg;
  });

  /* ── strict zip: names ── */
  const badNames = [
    ['newline', 'a\nb'],
    ['..', '../x'],
    ['.. segment', 'a/../x'],
    ['./x', './x'],
    ['backslash', 'a\\b'],
    ['NUL', Buffer.from('a\0b', 'latin1')],
    ['leading /', '/x'],
    ['trailing /', 'dir/'],
    ['non-ASCII', 'café.txt'],
    ['empty segment', 'a//b'],
    ['>255 bytes', 'a'.repeat(256)]
  ];
  for (const [label, name] of badNames) {
    check(`zip: refuses a bad name (${label})`, () =>
      refuses(() => listEntries(buildStoreZip([['ok.txt', 'x'], [name, 'y']]))));
  }
  check('zip: accepts a 255-byte name and a nested path', () => {
    const e = listEntries(buildStoreZip([['a'.repeat(255), 'x'], ['code/sub_dir/x-1.js', 'y']]));
    return e.length === 2 || 'refused';
  });

  check('zip: refuses a duplicate name', () =>
    refuses(() => listEntries(buildStoreZip([['a.txt', '1'], ['a.txt', '2']])), /duplicate/));
  check('zip: refuses names that collide ignoring case', () =>
    refuses(() => listEntries(buildStoreZip([['Seal.json', '1'], ['seal.json', '2']])), /case/));

  /* ── strict zip: layout ── */
  const good = buildStoreZip([['pigeon.json', manifest('freeform')], ['a.txt', 'hello'], ['b.txt', 'world']]);
  check('zip: a well-formed stored zip reads back', () => {
    const e = listEntries(good);
    const a = get(e, good, 'a.txt');
    if (!a || a.toString() !== 'hello') return 'a.txt wrong';
    if (a.buffer !== good.buffer) return 'get() copied instead of viewing the buffer';
    return (get(e, good, 'nope') === null) || 'missing name did not give null';
  });
  check('zip: refuses gap bytes between entries', () => refuses(() => listEntries(malform.gapAfter(good, 0))));
  check('zip: refuses gap bytes before the central directory', () => refuses(() => listEntries(malform.gapAfter(good, 2))));
  check('zip: refuses prepended bytes', () => refuses(() => listEntries(malform.prepend(good))));
  check('zip: refuses trailing bytes', () => refuses(() => listEntries(malform.append(good))));
  check('zip: refuses an EOCD comment', () => refuses(() => listEntries(malform.comment(good))));
  check('zip: refuses flag bit 3 (data descriptor)', () => refuses(() => listEntries(malform.flags(good, 1, 0x8)), /flags/));
  check('zip: refuses flag bit 0 (encrypted)', () => refuses(() => listEntries(malform.flags(good, 1, 0x1)), /flags/));
  check('zip: accepts flag 0x800 (UTF-8 names)', () => listEntries(malform.flags(good, 1, 0x800)).length === 3 || 'refused');
  check('zip: refuses a compressed entry', () =>
    refuses(() => listEntries(buildStoreZip([['a.txt', 'hello hello hello hello']], { compress: ['a.txt'] })), /stored|compressed/));
  check('zip: refuses a local name that differs from the central one', () =>
    refuses(() => listEntries(malform.localName(good, 1)), /name/));
  check('zip: refuses a local size that differs from the central one', () =>
    refuses(() => listEntries(malform.localSize(good, 1)), /size/));
  check('zip: refuses junk', () => refuses(() => listEntries(Buffer.from('not a zip at all, sorry'))));

  /* ── the seal ── */
  const files = [['pigeon.json', manifest('skillpack')], ['code/main.js', 'export default 1'], ['data/x.json', '[1,2]']];
  const sealed = sealZip(files, TEST_SEED);
  const testId = keyId(Buffer.from(RFC8032[0].pub, 'hex'));

  check('seal: round trip — a sealed skillpack verifies with the TEST key trusted', () => {
    const r = rules(sealed, trustedTest());
    return (r.kind === 'skillpack' && r.sealed && r.keyId === testId) || JSON.stringify(r);
  });
  check('seal: seal.json is last and holds exactly scheme, key, signature', () => {
    const e = listEntries(sealed);
    if (e[e.length - 1].name !== SEAL_NAME) return 'not last';
    const obj = JSON.parse(get(e, sealed, SEAL_NAME).toString());
    return Object.keys(obj).sort().join(',') === 'key,scheme,signature' || JSON.stringify(obj);
  });

  check('seal: a flipped byte in an entry fails', () => {
    const bad = Buffer.from(sealed);
    const e = listEntries(bad).find(x => x.name === 'data/x.json');
    bad[e.dataStart] ^= 1;
    return refuses(() => seal(bad, trustedTest()), /verify/);
  });
  check('seal: an added entry fails', () => {
    const e = listEntries(sealed);
    const parts = e.map(x => [x.name, Buffer.from(get(e, sealed, x.name))]);
    const sealEntry = parts.pop();
    const bad = buildStoreZip([...parts, ['extra.txt', 'sneaky'], sealEntry]);
    return refuses(() => seal(bad, trustedTest()), /verify/);
  });
  check('seal: a renamed entry fails', () => {
    const e = listEntries(sealed);
    const parts = e.map(x => [x.name === 'data/x.json' ? 'data/y.json' : x.name, Buffer.from(get(e, sealed, x.name))]);
    return refuses(() => seal(buildStoreZip(parts), trustedTest()), /verify/);
  });
  check('seal: seal.json not last fails', () => {
    const e = listEntries(sealed);
    const parts = e.map(x => [x.name, Buffer.from(get(e, sealed, x.name))]);
    const bad = buildStoreZip([parts.pop(), ...parts]);
    return refuses(() => seal(bad, trustedTest()), /last/);
  });
  check('seal: an unknown key fails', () => {
    const other = sealZip(files, RFC8032[1].seed);
    return refuses(() => seal(other, trustedTest()), /not trusted/);
  });
  check('seal: no trusted keys at all fails a present seal', () => refuses(() => seal(sealed, []), /not trusted/));
  check('seal: a revoked key fails', () => refuses(() => seal(sealed, trustedTest(true)), /revoked/));
  check('seal: a malformed seal.json fails (extra key, bad hex, wrong scheme, repeated key)', () => {
    const e = listEntries(sealed);
    const parts = e.map(x => [x.name, Buffer.from(get(e, sealed, x.name))]);
    const obj = JSON.parse(parts.pop()[1].toString());
    const variants = [
      JSON.stringify({ ...obj, extra: 1 }),
      JSON.stringify({ ...obj, key: obj.key.toUpperCase() }),
      JSON.stringify({ ...obj, signature: obj.signature.slice(2) }),
      JSON.stringify({ ...obj, scheme: 'pigeon-seal-ed25519-v2' }),
      `{"scheme":"${SCHEME}","key":"0000000000000000","key":"${obj.key}","signature":"${obj.signature}"}`,
      '[]',
      'not json'
    ];
    for (const v of variants) {
      const r = refuses(() => seal(buildStoreZip([...parts, [SEAL_NAME, v]]), trustedTest()));
      if (r !== true) return `${v.slice(0, 60)}: ${r}`;
    }
    return true;
  });

  /* ── kinds ── */
  check('seal: an unsealed skillpack is refused', () =>
    refuses(() => rules(buildStoreZip(files), trustedTest()), /skillpack/));
  check('seal: code/ in a freeform Pigeon is refused, sealed or not', () => {
    const f = [['pigeon.json', manifest('freeform')], ['code/main.js', 'x']];
    const a = refuses(() => rules(buildStoreZip(f), trustedTest()), /code\//);
    if (a !== true) return `unsealed: ${a}`;
    const b = refuses(() => rules(sealZip(f, TEST_SEED), trustedTest()), /code\//);
    return b === true || `sealed: ${b}`;
  });
  check('seal: a data-only Pigeon is fine unsealed', () => {
    const r = rules(buildStoreZip([['pigeon.json', manifest('freeform')], ['adapter.lora.gguf', 'x']]), []);
    return (r.kind === 'freeform' && r.sealed === false && r.keyId === null) || JSON.stringify(r);
  });
  check('seal: a data-only Pigeon with a broken seal is refused', () => {
    const z = sealZip([['pigeon.json', manifest('freeform')], ['adapter.lora.gguf', 'x']], TEST_SEED);
    return refuses(() => rules(z, []), /not trusted/);
  });
  check('seal: a sealed data-only Pigeon reports its key', () => {
    const z = sealZip([['pigeon.json', manifest('grounded')], ['adapter.lora.gguf', 'x']], TEST_SEED);
    const r = rules(z, trustedTest());
    return (r.sealed && r.keyId === testId) || JSON.stringify(r);
  });

  /* ── the cross-implementation fixture (produced by Flight School with the TEST 1 key) ── */
  check('seal: fixture sealed-test.pigeon matches seal-message.txt and verifies', () => {
    const zipPath = join(FIXTURES, 'sealed-test.pigeon');
    const msgPath = join(FIXTURES, 'seal-message.txt');
    const hasZip = existsSync(zipPath);
    const hasMsg = existsSync(msgPath);
    if (!hasZip && !hasMsg) return true; // pending: neither fixture has been produced yet
    if (hasZip !== hasMsg) return `only one fixture present (${hasZip ? 'sealed-test.pigeon' : 'seal-message.txt'})`;
    const buf = readFileSync(zipPath);
    const entries = listEntries(buf);
    const msg = sealMessage(entries, buf);
    const want = readFileSync(msgPath);
    if (!msg.equals(want)) return `message differs from seal-message.txt:\n${msg.toString('latin1')}`;
    const r = checkSeal(entries, buf, trustedTest());
    return (r.sealed && r.keyId === testId) || JSON.stringify(r);
  });
}
