/* _extended-stubs.js — §2.4 and §5's stub policy, made concrete.
 *
 *   "Extended-tier skills are in the registry file with `unbuilt: true` and
 *    nowhere else."
 *   "The router index is built only from `unbuilt: false` entries. A stub
 *    cannot be selected, so it cannot appear as a fake capability."
 *
 * These entries exist so the policy is EXERCISED rather than merely stated:
 * registry.routable() filters them out, LexicalRouter.reindex() never embeds
 * them, validatePlan() rejects any plan naming them, lintEntry() fails if one
 * ever grows a `run`, and the test suite asserts all four. Without at least one
 * stub in the registry, every one of those checks passes vacuously.
 *
 * They are visible on the Skills screen, greyed, labelled "not built". That is
 * the one place §2.4 permits them to appear: a backlog the user can read is
 * not an aspirational UI, but a menu item that does nothing would be.
 *
 * Note the deliberate absence of a `run` function and of examples. A stub that
 * carried either would be one flag away from shipping. */

const stub = (name, description, category) => ({
  name,
  description,
  category,
  tier: 'extended',
  unbuilt: true,
  needsNetwork: false,
  dataAsOf: null,
  labels: []
});

/* All four entries that lived here have been built and moved into their own
   files. The stub POLICY is still exercised, by the three image skills in
   _blocked.js — they carry `blockedBy` because §3.3 forbids a skill touching
   a canvas, so they are unbuilt for a stated reason rather than for want of
   time. If those are ever built, put something back here or the checks in §5
   start passing vacuously again. */
export default [
  /* §10 open decision 4 asked for "the exact UI treatment for `formula-only`
     before moving any of §27 out of Extended". bmiCalculate used to sit here
     for that reason. It has now moved to Standard, which is where the skill
     index puts it, and the decision it was waiting on is settled as follows:
     a `formula-only` skill renders its label as a badge AND carries its own
     limitation in the reply text, so the caveat travels with the number rather
     than living only in chrome the reader may not look at. bmiCalculate's
     `note` field is the worked example. */
];
