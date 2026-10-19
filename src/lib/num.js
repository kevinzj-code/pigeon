/* num.js — rounding, fractions, and the small numeric conveniences several
   skills share. Nothing here is clever; it exists so ten skills round the same
   way rather than ten slightly different ways. */

/** Round to `dp` decimals without float drift ("1.005 → 1.01", not 1.00). */
export function round (n, dp = 2) {
  if (!Number.isFinite(n)) return n;
  const f = Math.pow(10, dp);
  return Math.round((n + Number.EPSILON * Math.sign(n) * Math.abs(n)) * f) / f;
}

/** Significant-figure rounding, for conversions where dp is the wrong unit of
 *  precision (0.0001 km and 40000 km both want ~4 sig figs, not 2 dp). */
export function sig (n, digits = 4) {
  if (!Number.isFinite(n) || n === 0) return n;
  const mag = Math.floor(Math.log10(Math.abs(n)));
  const dp = Math.max(0, Math.min(12, digits - 1 - mag));
  return round(n, dp);
}

export const gcd = (a, b) => { a = Math.abs(a); b = Math.abs(b); while (b) { [a, b] = [b, a % b]; } return a; };
export const lcm = (a, b) => (a === 0 || b === 0) ? 0 : Math.abs(a * b) / gcd(a, b);

const VULGAR = { 0.125: '⅛', 0.25: '¼', 0.333: '⅓', 0.375: '⅜', 0.5: '½', 0.625: '⅝', 0.667: '⅔', 0.75: '¾', 0.875: '⅞' };
/* Kitchen denominators. A recipe never asks for 7/16 of a teaspoon, so scaling
   snaps to what a measuring spoon can actually express. §4.1's scaleRecipe
   description promises "sensible kitchen fractions" — this is that promise. */
const KITCHEN = [
  [0, ''], [0.125, '⅛'], [0.25, '¼'], [1 / 3, '⅓'], [0.375, '⅜'], [0.5, '½'],
  [0.625, '⅝'], [2 / 3, '⅔'], [0.75, '¾'], [0.875, '⅞'], [1, '']
];

/** 2.5 → "2½", 0.75 → "¾", 1.02 → "1" (snapped). */
export function toKitchenFraction (n) {
  if (!Number.isFinite(n)) return String(n);
  const neg = n < 0;
  n = Math.abs(n);
  let whole = Math.floor(n);
  const frac = n - whole;
  let best = KITCHEN[0], bestErr = Infinity;
  for (const cand of KITCHEN) {
    const err = Math.abs(frac - cand[0]);
    if (err < bestErr) { bestErr = err; best = cand; }
  }
  if (best[0] === 1) whole += 1;
  const glyph = best[0] === 1 ? '' : best[1];
  let out;
  if (whole === 0 && glyph === '') out = '0';
  else if (glyph === '') out = String(whole);
  else if (whole === 0) out = glyph;
  else out = `${whole}${glyph}`;
  return neg ? `-${out}` : out;
}

/** Largest-remainder split: 100 / 3 → [33.34, 33.33, 33.33], summing exactly. */
export function splitAmount (total, ways, dp = 2) {
  const f = Math.pow(10, dp);
  const cents = Math.round(total * f);
  const base = Math.floor(cents / ways);
  const extra = cents - base * ways;
  return Array.from({ length: ways }, (_, i) => (base + (i < extra ? 1 : 0)) / f);
}
