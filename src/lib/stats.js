/* stats.js — the pieces the §10 statistics skills share.
 *
 * One definition each, in one place, because the alternative is ten skills
 * that each pick a percentile convention and quietly disagree with each other
 * about the same data. */

/** Linear interpolation between closest ranks — the R-7 / Excel PERCENTILE
 *  convention, the one most people's spreadsheet agrees with. */
export function percentileOf (sorted, p) {
  if (!sorted.length) return NaN;
  if (sorted.length === 1) return sorted[0];
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (rank - lo) * (sorted[hi] - sorted[lo]);
}

export const mean = (v) => v.reduce((a, b) => a + b, 0) / v.length;

export function variance (v, sample = false) {
  const m = mean(v);
  const d = sample ? v.length - 1 : v.length;
  return v.reduce((acc, x) => acc + (x - m) ** 2, 0) / d;
}

export const stdDev = (v, sample = false) => Math.sqrt(variance(v, sample));

/** Q1/Q2/Q3 by the same convention as percentileOf, plus the IQR fences. */
export function quartilesOf (values) {
  const s = [...values].sort((a, b) => a - b);
  const q1 = percentileOf(s, 25);
  const q2 = percentileOf(s, 50);
  const q3 = percentileOf(s, 75);
  const iqr = q3 - q1;
  return { q1, q2, q3, iqr, lowerFence: q1 - 1.5 * iqr, upperFence: q3 + 1.5 * iqr, sorted: s };
}

/** Pearson's r. Returns NaN when either series has no spread — a constant
 *  column has no correlation to report, and 0 would imply "unrelated". */
export function pearson (x, y) {
  const n = x.length;
  const mx = mean(x), my = mean(y);
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    const a = x[i] - mx, b = y[i] - my;
    num += a * b; dx += a * a; dy += b * b;
  }
  const den = Math.sqrt(dx * dy);
  return den === 0 ? NaN : num / den;
}
