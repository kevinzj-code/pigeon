/* seeded.js — the one pseudo-random generator every generation skill uses.
 *
 * §20 of the skill index is titled "Generation (seeded, reproducible)" and
 * §3.3 says skills are pure. Math.random() would break both at once: the same
 * plan would stop replaying to the same result, "Show plan" would stop being
 * an honest record, and no example could assert an output. So the seed is a
 * required input everywhere, and it lives here so three skills cannot end up
 * with three different generators.
 *
 * mulberry32 — small, fast, and good enough that consecutive draws don't
 * correlate visibly. Not cryptographic, and nothing here should be. */

export function mulberry32 (seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Uniform integer in [min, max], inclusive of both ends. */
export function intBetween (rand, min, max) {
  return min + Math.floor(rand() * (max - min + 1));
}
