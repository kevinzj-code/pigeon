/* phone-format.js — structural parsing of international phone numbers.
 *
 * NOT a replacement for a real numbering-plan library. It knows the country
 * calling codes, roughly how many digits a national number has in the common
 * regions, and the trunk prefix those regions write in front of it. That is
 * enough to say "this is the wrong shape to be a French number" and not nearly
 * enough to say "this number is in service" — the skills say which of the two
 * they are doing.
 */

import { PHONE_CODES } from './phone-codes.js';

/* [min, max] digits in the national part, for the regions where a wrong length
   is a common and catchable mistake. Anything not listed falls back to E.164's
   own limits, which is a weaker check and is reported as such. */
export const NATIONAL_LENGTHS = {
  1: [10, 10], 7: [10, 10], 20: [9, 10], 27: [9, 9], 30: [10, 10], 31: [9, 9],
  32: [8, 9], 33: [9, 9], 34: [9, 9], 39: [9, 11], 41: [9, 9], 44: [9, 10],
  46: [7, 13], 49: [6, 11], 52: [10, 10], 55: [10, 11], 61: [9, 9], 64: [8, 9],
  65: [8, 8], 81: [9, 10], 82: [9, 10], 86: [11, 11], 90: [10, 10], 91: [10, 10],
  92: [10, 10], 234: [10, 10], 351: [9, 9], 353: [9, 9], 380: [9, 9], 852: [8, 8],
  886: [9, 9], 971: [9, 9], 972: [9, 9]
};

/* The digit written in front of a national number when dialling inside the
   country. Not universal — the United States has none, Italy keeps the leading
   zero as part of the number itself — so an absent entry means "no trunk
   prefix", never "unknown". */
export const TRUNK_PREFIX = {
  20: '0', 27: '0', 30: '', 31: '0', 32: '0', 33: '0', 34: '', 39: '', 41: '0',
  44: '0', 46: '0', 49: '0', 52: '', 55: '0', 61: '0', 64: '0', 65: '', 81: '0',
  82: '0', 86: '0', 90: '0', 91: '0', 92: '0', 234: '0', 351: '', 353: '0',
  380: '0', 852: '', 886: '0', 971: '0', 972: '0'
};

/* A number written the national way ("07700 900123") with a region's dialling
   code supplied separately. The national form carries the trunk prefix, which
   is not part of the international number: +44 7700 900123, not
   +44 07700 900123. Only the region's own trunk prefix is dropped, and only
   where it has one (Italy keeps its leading zero; the United States has none). */
export function joinRegion (regionDigits, digits) {
  const trunk = TRUNK_PREFIX[Number(regionDigits)] ?? '';
  return regionDigits + (trunk && digits.startsWith(trunk) ? digits.slice(trunk.length) : digits);
}

const CODES = PHONE_CODES.map((p) => p.code).sort((a, b) => String(b).length - String(a).length);

/* Longest match wins: +1 and +1876 would both match a Jamaican number, and the
   shorter one would silently take four digits of the subscriber number with it. */
export function splitCountryCode (digits) {
  for (const code of CODES) {
    const s = String(code);
    if (digits.startsWith(s)) return { code, national: digits.slice(s.length) };
  }
  return null;
}

/* How each region actually writes its national number, for the ones where the
   convention is unambiguous. Even chunks are a poor substitute: +44 2079 4609 58
   is a real London number rendered in a grouping no British person has ever
   used, which reads as wrong even though every digit is right. A region with no
   entry, or a length that does not fit its pattern, falls back to even chunks. */
const GROUPINGS = {
  1: { 10: [3, 3, 4] },
  33: { 9: [1, 2, 2, 2, 2] },
  34: { 9: [3, 3, 3] },
  61: { 9: [1, 4, 4] },
  65: { 8: [4, 4] },
  81: { 10: [2, 4, 4] },
  86: { 11: [3, 4, 4] },
  91: { 10: [5, 5] }
};

export function groupNational (code, national) {
  /* London and other 020-style numbers split 2-4-4; UK mobiles are 07xxx and
     split 4-6. Same length, different shape, so the pattern depends on the
     prefix rather than on the length alone. */
  if (code === 44 && national.length === 10) {
    const sizes = national.startsWith('7') ? [4, 6] : [2, 4, 4];
    return chunk(national, sizes);
  }
  const sizes = GROUPINGS[code]?.[national.length];
  return sizes ? chunk(national, sizes) : groupDigits(national);
}

function chunk (d, sizes) {
  const out = [];
  let at = 0;
  for (const n of sizes) { out.push(d.slice(at, at + n)); at += n; }
  if (at < d.length) out.push(d.slice(at));
  return out.join(' ');
}

export const groupDigits = (d) => {
  if (d.length <= 4) return d;
  const size = d.length % 3 === 0 ? 3 : 4;
  const out = [];
  for (let i = 0; i < d.length; i += size) out.push(d.slice(i, i + size));
  return out.join(' ');
};

export const regionFor = (code) => (PHONE_CODES.find((p) => p.code === code)?.regions ?? []);
