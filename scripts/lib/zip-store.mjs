/* zip-store.mjs — the strict stored-zip reader a sealed .pigeon is read with.
 *
 * Not a general zip reader. It accepts exactly the shape Pigeon writes —
 * every entry stored, laid end to end from byte 0, the central directory
 * straight after the last entry, a 22-byte EOCD with no comment at the very
 * end — and refuses anything else outright. The point is that there is only
 * one way to read the file: no gap, prefix, trailer, comment or duplicate
 * where a second reader could see different bytes from the one that checked
 * the seal. The Rust (src-tauri/src/zip_store.rs) and Python readers follow
 * the same rules, word for word, from the shared seal spec.
 *
 * Node-only (Buffer). Nothing under src/ may import this; src/lint-imports.js
 * enforces that.
 */

import { deflateRawSync } from 'node:zlib';

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;
const LOCAL_LEN = 30;
const CENTRAL_LEN = 46;
const EOCD_LEN = 22;
export const MAX_ENTRIES = 4096;
export const MAX_NAME_BYTES = 255;

const NAME_RE = /^[A-Za-z0-9_-][A-Za-z0-9._-]*(\/[A-Za-z0-9_-][A-Za-z0-9._-]*)*$/;

/** Is this raw name acceptable? Returns null when it is, else the reason. */
export function nameProblem (raw) {
  if (raw.length === 0) return 'empty name';
  if (raw.length > MAX_NAME_BYTES) return `name longer than ${MAX_NAME_BYTES} bytes`;
  for (const b of raw) {
    if (b === 0) return 'NUL in name';
    if (b >= 0x80) return 'non-ASCII byte in name';
  }
  const s = raw.toString('latin1');
  if (s.includes('\\')) return 'backslash in name';
  if (s.startsWith('/')) return 'leading / in name';
  if (s.endsWith('/')) return 'directory entry';
  if (!NAME_RE.test(s)) return 'name has a disallowed character or segment';
  return null;
}

const fail = (reason) => { throw new Error(`zip refused: ${reason}`); };

/**
 * Every entry, in file order, as { name, offset, dataStart, size }.
 * Throws Error('zip refused: <reason>') on any strict-rule violation.
 */
export function listEntries (buf) {
  if (!Buffer.isBuffer(buf)) fail('not a buffer');
  const len = buf.length;
  if (len < EOCD_LEN) fail('too short for an end-of-central-directory record');
  const eocd = len - EOCD_LEN;
  if (buf.readUInt32LE(eocd) !== EOCD_SIG) fail('no EOCD record at exactly len-22 (comment or trailing bytes?)');
  if (buf.readUInt16LE(eocd + 20) !== 0) fail('EOCD comment is not empty');
  const diskNo = buf.readUInt16LE(eocd + 4);
  const cdDisk = buf.readUInt16LE(eocd + 6);
  const countDisk = buf.readUInt16LE(eocd + 8);
  const count = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) fail('zip64 is not accepted');
  if (diskNo !== 0 || cdDisk !== 0) fail('multi-disk archive');
  if (countDisk !== count) fail('EOCD disk entry count differs from total');
  if (count > MAX_ENTRIES) fail(`more than ${MAX_ENTRIES} entries`);
  if (cdOffset + cdSize !== eocd) fail('central directory size does not end exactly at the EOCD');

  const entries = [];
  const seen = new Set();
  const seenLower = new Set();
  let cursor = 0; // where the next local header must begin
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (p + CENTRAL_LEN > eocd) fail('central directory truncated');
    if (buf.readUInt32LE(p) !== CENTRAL_SIG) fail('bad central directory signature');
    const cFlags = buf.readUInt16LE(p + 8);
    const cMethod = buf.readUInt16LE(p + 10);
    const cComp = buf.readUInt32LE(p + 20);
    const cSize = buf.readUInt32LE(p + 24);
    const cNameLen = buf.readUInt16LE(p + 28);
    const cExtraLen = buf.readUInt16LE(p + 30);
    const cCommentLen = buf.readUInt16LE(p + 32);
    const cStartDisk = buf.readUInt16LE(p + 34);
    const localOff = buf.readUInt32LE(p + 42);
    const cEnd = p + CENTRAL_LEN + cNameLen + cExtraLen + cCommentLen;
    if (cEnd > eocd) fail('central directory record runs past its end');
    const rawName = buf.subarray(p + CENTRAL_LEN, p + CENTRAL_LEN + cNameLen);

    const problem = nameProblem(rawName);
    if (problem) fail(`${problem}: ${JSON.stringify(rawName.toString('latin1'))}`);
    const name = rawName.toString('latin1');
    if (seen.has(name)) fail(`duplicate name ${name}`);
    const lower = name.toLowerCase(); // ASCII only by now, so this is ASCII lower-casing
    if (seenLower.has(lower)) fail(`names collide ignoring case: ${name}`);
    seen.add(name); seenLower.add(lower);

    if (cFlags !== 0 && cFlags !== 0x800) fail(`general-purpose flags 0x${cFlags.toString(16)} on ${name}`);
    if (cMethod !== 0) fail(`${name} is not stored (method ${cMethod})`);
    if (cComp !== cSize) fail(`${name} compressed size differs from its size`);
    if (cSize === 0xffffffff || localOff === 0xffffffff) fail('zip64 is not accepted');
    if (cStartDisk !== 0) fail('multi-disk archive');
    if (localOff !== cursor) fail(`${name} local header at ${localOff}, expected ${cursor} (gap, overlap or prefix)`);

    if (localOff + LOCAL_LEN > cdOffset) fail(`${name} local header runs into the central directory`);
    if (buf.readUInt32LE(localOff) !== LOCAL_SIG) fail(`bad local header signature for ${name}`);
    const lFlags = buf.readUInt16LE(localOff + 6);
    const lMethod = buf.readUInt16LE(localOff + 8);
    const lComp = buf.readUInt32LE(localOff + 18);
    const lSize = buf.readUInt32LE(localOff + 22);
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    if (lFlags !== 0 && lFlags !== 0x800) fail(`local general-purpose flags 0x${lFlags.toString(16)} on ${name}`);
    if (lMethod !== cMethod) fail(`${name} local method differs from central`);
    if (lComp !== cComp || lSize !== cSize) fail(`${name} local sizes differ from central`);
    if (lNameLen !== cNameLen) fail(`${name} local name length differs from central`);
    const dataStart = localOff + LOCAL_LEN + lNameLen + lExtraLen;
    if (dataStart > cdOffset) fail(`${name} local header runs into the central directory`);
    if (!buf.subarray(localOff + LOCAL_LEN, localOff + LOCAL_LEN + lNameLen).equals(rawName)) fail(`${name} local name differs from central`);
    const dataEnd = dataStart + cSize;
    if (dataEnd > cdOffset) fail(`${name} data runs into the central directory`);

    entries.push({ name, offset: localOff, dataStart, size: cSize });
    cursor = dataEnd;
    p = cEnd;
  }
  if (p !== eocd) fail('central directory size does not match its records');
  if (cursor !== cdOffset) fail('central directory does not start where the last entry ends');
  return entries;
}

/** The bytes of one entry, as a view of the same buffer, or null. */
export function get (entries, buf, name) {
  const e = entries.find(x => x.name === name);
  return e ? buf.subarray(e.dataStart, e.dataStart + e.size) : null;
}

/* ── test-only writing and breaking ──────────────────────────────────────── */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
export function crc32 (b) {
  let c = 0xffffffff;
  for (const x of b) c = CRC_TABLE[(c ^ x) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const toBuf = (x) => Buffer.isBuffer(x) ? x : Buffer.from(String(x), 'utf8');
const nameBuf = (n) => Buffer.isBuffer(n) ? n : Buffer.from(n, 'utf8');

/**
 * TEST ONLY. A contiguous stored zip, flags 0, no extras, no comments.
 * `files` is [[name, Buffer|string]]; names are written as given (Buffer
 * names allowed, so tests can write raw bad bytes).
 * `opts.flags`, `opts.method`, `opts.compress` (names to deflate) exist for
 * building the malformed cases.
 */
export function buildStoreZip (files, opts = {}) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [n, d] of files) {
    const name = nameBuf(n);
    const raw = toBuf(d);
    const compress = opts.compress && opts.compress.includes(name.toString('latin1'));
    const data = compress ? deflateRawSync(raw) : raw;
    const method = compress ? 8 : (opts.method ?? 0);
    const flags = opts.flags ?? 0;
    const crc = crc32(raw);
    const lh = Buffer.alloc(LOCAL_LEN);
    lh.writeUInt32LE(LOCAL_SIG, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(flags, 6);
    lh.writeUInt16LE(method, 8); lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(raw.length, 22);
    lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28);
    locals.push(lh, name, data);
    const ch = Buffer.alloc(CENTRAL_LEN);
    ch.writeUInt32LE(CENTRAL_SIG, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(flags, 8); ch.writeUInt16LE(method, 10); ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(raw.length, 24);
    ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(offset, 42);
    centrals.push(ch, name);
    offset += LOCAL_LEN + name.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(EOCD_LEN);
  eocd.writeUInt32LE(EOCD_SIG, 0);
  eocd.writeUInt16LE(files.length, 8); eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

/**
 * A strict stored zip (§3.2: stored, contiguous, no extras or comments) for
 * files this repo writes for real, such as Patch's nest. The same writer the
 * tests use, without the knobs that exist to break it.
 */
export function storeZip (files) {
  return buildStoreZip(files);
}

/** TEST ONLY. Offsets of the i-th local and central headers of a zip from buildStoreZip. */
export function headerOffsets (buf, i) {
  const eocd = buf.length - EOCD_LEN;
  let p = buf.readUInt32LE(eocd + 16);
  for (let k = 0; k < i; k++) {
    p += CENTRAL_LEN + buf.readUInt16LE(p + 28) + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
  }
  return { local: buf.readUInt32LE(p + 42), central: p };
}

/** TEST ONLY. Malformations of a well-formed stored zip; each returns a new Buffer. */
export const malform = {
  /** `n` junk bytes before the first local header; central offsets shifted so only the prefix is wrong. */
  prepend (buf, n = 4) {
    const out = Buffer.concat([Buffer.alloc(n, 0x41), buf]);
    const eocd = out.length - EOCD_LEN;
    const count = out.readUInt16LE(eocd + 10);
    out.writeUInt32LE(out.readUInt32LE(eocd + 16) + n, eocd + 16);
    let p = out.readUInt32LE(eocd + 16);
    for (let i = 0; i < count; i++) {
      out.writeUInt32LE(out.readUInt32LE(p + 42) + n, p + 42);
      p += CENTRAL_LEN + out.readUInt16LE(p + 28) + out.readUInt16LE(p + 30) + out.readUInt16LE(p + 32);
    }
    return out;
  },
  /** `n` bytes after the EOCD. */
  append (buf, n = 4) { return Buffer.concat([buf, Buffer.alloc(n, 0x42)]); },
  /** A non-empty EOCD comment. */
  comment (buf, text = 'hi') {
    const c = Buffer.from(text);
    const out = Buffer.concat([buf, c]);
    out.writeUInt16LE(c.length, buf.length - EOCD_LEN + 20);
    return out;
  },
  /** `n` bytes of gap between entry `i` and the next thing; later offsets shifted to stay consistent otherwise. */
  gapAfter (buf, i, n = 3) {
    const entries = listEntries(buf);
    const end = entries[i].dataStart + entries[i].size;
    const out = Buffer.concat([buf.subarray(0, end), Buffer.alloc(n), buf.subarray(end)]);
    const eocd = out.length - EOCD_LEN;
    const cdOff = out.readUInt32LE(eocd + 16) + n;
    out.writeUInt32LE(cdOff, eocd + 16);
    let p = cdOff;
    for (let k = 0; k < entries.length; k++) {
      if (k > i) out.writeUInt32LE(out.readUInt32LE(p + 42) + n, p + 42);
      p += CENTRAL_LEN + out.readUInt16LE(p + 28) + out.readUInt16LE(p + 30) + out.readUInt16LE(p + 32);
    }
    return out;
  },
  /** Set the flags field on both headers of entry `i`. */
  flags (buf, i, value) {
    const out = Buffer.from(buf);
    const { local, central } = headerOffsets(out, i);
    out.writeUInt16LE(value, local + 6); out.writeUInt16LE(value, central + 8);
    return out;
  },
  /** Change one byte of entry `i`'s name in the local header only. */
  localName (buf, i) {
    const out = Buffer.from(buf);
    const { local } = headerOffsets(out, i);
    const at = local + LOCAL_LEN;
    out[at] = out[at] === 0x61 ? 0x62 : 0x61;
    return out;
  },
  /** Change entry `i`'s uncompressed size in the local header only. */
  localSize (buf, i) {
    const out = Buffer.from(buf);
    const { local } = headerOffsets(out, i);
    out.writeUInt32LE(out.readUInt32LE(local + 22) + 1, local + 22);
    return out;
  }
};
