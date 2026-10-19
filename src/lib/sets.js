/* sets.js - the comparison the three set-op skills share.
 *
 * intersectLists, unionLists and differenceLists all have to agree about two
 * things: when two items are "the same", and what order the answer comes back
 * in. Three copies of that would eventually be three slightly different
 * answers, so it lives here once - the same reasoning as inflect.js.
 *
 * Order is first appearance, never sorted, matching dedupeList. A list someone
 * typed has an order they chose, and quietly re-sorting the answer makes it
 * hard to line up against the input.
 */

/* Objects compare by their JSON, so two structurally identical entries count as
   one. Reference equality would keep both and look broken. */
export const keyOf = (v, ignoreCase = false) => {
  const s = typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v);
  return ignoreCase ? s.toLowerCase() : s;
};

/* Deduplicated, in first-appearance order. Callers pass the values they want
   kept, so intersect and union return the FIRST list's spelling of a shared
   item when case is being ignored - "Ana" rather than "ana". */
export function uniqueBy (values, ignoreCase) {
  const seen = new Set();
  const out = [];
  for (const v of values) {
    const k = keyOf(v, ignoreCase);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(v);
  }
  return out;
}

export const keySet = (values, ignoreCase) => new Set(values.map((v) => keyOf(v, ignoreCase)));

/* One pass over both lists, returning the three disjoint groups every set
   operation is built from. Each skill then reports the parts it is about. */
export function partition (first, second, ignoreCase = false) {
  const inSecond = keySet(second, ignoreCase);
  const inFirst = keySet(first, ignoreCase);
  return {
    shared: uniqueBy(first.filter((v) => inSecond.has(keyOf(v, ignoreCase))), ignoreCase),
    onlyInFirst: uniqueBy(first.filter((v) => !inSecond.has(keyOf(v, ignoreCase))), ignoreCase),
    onlyInSecond: uniqueBy(second.filter((v) => !inFirst.has(keyOf(v, ignoreCase))), ignoreCase)
  };
}
