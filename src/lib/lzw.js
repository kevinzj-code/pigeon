/* lzw.js — the compression behind compressText / decompressText.
 *
 * Written out rather than reached for: CompressionStream('deflate') exists in
 * both Node and the webview, but deflate output is allowed to differ between
 * zlib versions while still decoding correctly. Examples in this project state
 * exact outputs, so a codec whose bytes depend on the host's zlib build would
 * make the test suite pass or fail on which machine ran it. LZW is fully
 * specified here, so the same text produces the same base64 everywhere.
 *
 * Variable-width codes, 9 bits growing to 16. The dictionary starts as the 256
 * single bytes, so any input round-trips — this compresses UTF-8 bytes, not
 * characters.
 */

const MAX_CODES = 1 << 16;

class BitWriter {
  constructor () { this.out = []; this.cur = 0; this.bits = 0; }
  write (value, width) {
    for (let i = width - 1; i >= 0; i--) {
      this.cur = (this.cur << 1) | ((value >> i) & 1);
      if (++this.bits === 8) { this.out.push(this.cur); this.cur = 0; this.bits = 0; }
    }
  }
  finish () {
    if (this.bits) this.out.push(this.cur << (8 - this.bits));
    return this.out;
  }
}

class BitReader {
  constructor (bytes, at) { this.bytes = bytes; this.pos = at * 8; }
  read (width) {
    let v = 0;
    for (let i = 0; i < width; i++) {
      const byte = this.bytes[this.pos >> 3] ?? 0;
      v = (v << 1) | ((byte >> (7 - (this.pos & 7))) & 1);
      this.pos++;
    }
    return v;
  }
}

export function lzwCompress (bytes) {
  const dict = new Map();
  for (let i = 0; i < 256; i++) dict.set(String.fromCharCode(i), i);
  let next = 256;
  let width = 9;
  const w = new BitWriter();
  let run = '';

  for (const b of bytes) {
    const c = String.fromCharCode(b);
    const grown = run + c;
    if (dict.has(grown)) { run = grown; continue; }
    w.write(dict.get(run), width);
    if (next < MAX_CODES) {
      dict.set(grown, next++);
      if (next > (1 << width) - 1 && width < 16) width++;
    }
    run = c;
  }
  if (run !== '') w.write(dict.get(run), width);

  /* Four bytes of original length in front of the stream. Without it the zero
     bits used to pad the last byte are indistinguishable from a real code 0,
     and a decoder has no way to know whether the last symbol is data or
     padding. It also lets decompressText report the original size honestly. */
  const body = w.finish();
  const n = bytes.length;
  return new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255, ...body]);
}

export function lzwDecompress (bytes) {
  if (bytes.length < 4) throw new Error('too short to be a compressed stream');
  const want = ((bytes[0] << 24) >>> 0) + (bytes[1] << 16) + (bytes[2] << 8) + bytes[3];
  if (want === 0) return new Uint8Array(0);
  /* The header is data and data can lie. A planner that invents a "compressed
     blob" hands over four bytes that may spell four billion, and the reader
     below returns zeros past the end of the stream — code 0 is always in the
     dictionary — so without this bound the loop runs `want` times and the
     process dies growing `out`. Each code is at least 9 bits and yields at most
     one dictionary entry, whose length grows by one per code, so the stream
     cannot possibly expand beyond codes × (codes + 256) bytes. */
  const codes = Math.floor(((bytes.length - 4) * 8) / 9);
  if (want > codes * (codes + 256)) throw new Error(`the length header says ${want.toLocaleString('en-GB')} bytes, more than ${bytes.length} bytes of codes could hold`);

  const dict = [];
  for (let i = 0; i < 256; i++) dict.push(String.fromCharCode(i));
  let width = 9;
  const reader = new BitReader(bytes, 4);
  const out = [];
  let prev = null;

  while (out.length < want) {
    if (reader.pos >= bytes.length * 8) throw new Error('the stream ends before the length it declares');
    const code = reader.read(width);
    let entry;
    if (code < dict.length) entry = dict[code];
    else if (code === dict.length && prev !== null) entry = prev + prev[0];
    else throw new Error(`code ${code} is not in the dictionary`);

    for (const ch of entry) { out.push(ch.charCodeAt(0)); if (out.length === want) break; }

    if (prev !== null && dict.length < MAX_CODES) {
      dict.push(prev + entry[0]);
      /* The decoder learns each dictionary entry one code later than the
         encoder wrote it, so it has to widen one code EARLY to stay in step —
         hence dict.length + 1 rather than dict.length. Get this wrong and the
         streams agree perfectly until the 256th code and never again. */
      if (dict.length + 1 > (1 << width) - 1 && width < 16) width++;
    }
    prev = entry;
  }
  return new Uint8Array(out);
}
