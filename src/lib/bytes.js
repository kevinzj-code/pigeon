/* bytes.js — text to bytes to base64/hex, the same way in Node and the browser.
 *
 * Node has Buffer and the browser does not; the browser has btoa/atob and they
 * only speak Latin-1. Both environments DO have TextEncoder and (since Node 16)
 * btoa/atob, so everything goes through those — one code path, no branching on
 * which runtime it is, and no Buffer import that would break the webview.
 *
 * The Latin-1 trap is why this file exists: btoa() throws on any character
 * outside its range, so an accented string cannot be encoded directly.
 * Converting to UTF-8 bytes FIRST and then mapping each byte to a code unit is
 * what makes non-ASCII text survive a round trip.
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const toBytes = (text) => encoder.encode(String(text));
export const fromBytes = (bytes) => decoder.decode(new Uint8Array(bytes));

const binaryString = (bytes) => {
  let s = '';
  /* Chunked: String.fromCharCode(...bytes) blows the argument limit somewhere
     around 100k bytes and throws a RangeError on large inputs. */
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return s;
};

export function bytesToBase64 (bytes, { urlSafe = false } = {}) {
  const b64 = btoa(binaryString(bytes));
  return urlSafe ? b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : b64;
}

export function base64ToBytes (b64) {
  const normalised = String(b64).replace(/-/g, '+').replace(/_/g, '/').replace(/\s/g, '');
  /* Restore the padding a URL-safe encoder stripped, or atob rejects it. */
  const padded = normalised + '='.repeat((4 - (normalised.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

export const bytesToHex = (bytes, sep = '') =>
  [...bytes].map((b) => b.toString(16).padStart(2, '0')).join(sep);

export function hexToBytes (hex) {
  const clean = String(hex).replace(/(^0x)|[\s:-]/gi, '');
  if (clean.length % 2 !== 0) throw new Error('hex needs an even number of digits');
  if (!/^[0-9a-f]*$/i.test(clean)) throw new Error('that is not hex');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export const isValidBase64 = (s) => /^[A-Za-z0-9+/\-_]*={0,2}$/.test(String(s).replace(/\s/g, ''));

/* Does a decoded string look like text a person would read? Base64 and hex
   often carry binary, and a wall of replacement characters should be labelled
   rather than presented as an answer.
   Written as a code-point walk rather than a character class: the class would
   need literal control bytes in the source, which is exactly the kind of thing
   that survives a copy-paste as invisible damage. */
const TAB = 9;
const CARRIAGE_RETURN = 13;
const SPACE = 32;
const REPLACEMENT = 0xfffd;

export function looksPrintable (s) {
  for (const ch of String(s)) {
    const c = ch.codePointAt(0);
    // tab, newline and carriage return are real text; the rest below space is not
    if (c < TAB) return false;
    if (c > CARRIAGE_RETURN && c < SPACE) return false;
    if (c === REPLACEMENT) return false;
  }
  return true;
}
