/* diff.js — longest-common-subsequence diff over an array of tokens.
 *
 * Classic dynamic-programming LCS. O(n·m) in time and space, which is why the
 * skill that uses it caps its inputs: two 5,000-line files would allocate a
 * 25-million-cell table, and a diff that hangs the tab is worse than one that
 * declines. */

export function diffTokens (a, b) {
  const n = a.length, m = b.length;
  /* Int32Array rather than nested JS arrays: same algorithm, a fraction of the
     allocation, and it keeps the cap generous enough to be useful. */
  const table = new Int32Array((n + 1) * (m + 1));
  const at = (i, j) => i * (m + 1) + j;

  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[at(i, j)] = a[i] === b[j]
        ? table[at(i + 1, j + 1)] + 1
        : Math.max(table[at(i + 1, j)], table[at(i, j + 1)]);
    }
  }

  const ops = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { ops.push({ op: 'same', value: a[i] }); i++; j++; }
    else if (table[at(i + 1, j)] >= table[at(i, j + 1)]) { ops.push({ op: 'removed', value: a[i] }); i++; }
    else { ops.push({ op: 'added', value: b[j] }); j++; }
  }
  while (i < n) ops.push({ op: 'removed', value: a[i++] });
  while (j < m) ops.push({ op: 'added', value: b[j++] });
  return ops;
}
