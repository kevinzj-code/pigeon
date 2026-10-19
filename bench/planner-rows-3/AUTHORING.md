# Writing round-3 planner rows

Round 3 of Patch's trained planner. Read `model/planner-data-2/AUTHORING.md`
first: the row format, variety rules (who speaks, length, register, where values
sit), "never paraphrase the skill's examples", "never read scripts/holdout.mjs,
scripts/no-skill-set.mjs or scripts/followups.mjs" all still hold. What is new:

## Values the planner WORKS OUT (batches c01–c05)

Round 2 taught the planner to copy. It now fails when a value must be worked out:
"christmas" left as a date, "340 divided by 8 plus 12" kept in words, "a fifth" as
0.5, a half marathon as 13 km. Write rows where at least one value is worked out,
and say how, so the checker can work it out too:

```json
{ "skill": "daysBetween", "message": "how many days from 3 sept 2026 to christmas?",
  "input": { "from": "2026-09-03", "to": "2026-12-25" }, "mode": "full",
  "derive": [{ "field": "to", "rule": "date", "from": "christmas" }] }
```

`from` must appear in the message exactly (case aside). Today is **Tuesday
2026-09-01** (UTC). The rules, and only these (`scripts/lib/derive.mjs` is the
truth — run its examples if in doubt):

| rule | from → value |
|---|---|
| `date` | christmas, christmas eve, boxing day, new year's day/eve, halloween, valentine's day, bonfire night, st patrick's day, independence day, april fools' day, may day (next on or after today); today, tomorrow, yesterday, the day after tomorrow; end of the month / year, start of next month, end of next month; next/this/last <weekday>, a bare <weekday>; in N days/weeks/fortnights, N days/weeks ago, a week/fortnight from now → ISO `YYYY-MM-DD` |
| `days` | any `date` phrase → days from today to that day, **both counted** (end of the month = 30) |
| `fraction` | a half/quarter/fifth/tenth/eighth, three quarters, two fifths…, "N out of M", "one in N", "N percent"/"N%" → decimal |
| `quantity` | half marathon 21.0975, marathon 42.195, 5k, 10k, a dozen 12, half a dozen 6, a couple 2, a pair 2, a score 20, a gross 144, a fortnight 14, a week 7, a decade 10, an hour 60, half an hour 30 |
| `arithmetic` | "N divided by / times / multiplied by / plus / minus / over / squared / cubed / to the power of …" → the expression in symbols (`/ * + - ^`), spaces ignored |
| `enum` | a phrase → one of the field's enum values: either the phrase contains the value's own word, or you add a synonym to your file's `"synonyms": {"<skill>.<field>": {"<phrase>": "<value>"}}` — only unambiguous ones; I review every synonym before training |
| `dice` | a/one/two…/a couple of/a pair of/N + dice/die, optional "N-sided" or "dN" → `NdS` (6 sides by default) |

Other values in the row are still copied from the message as round 2 required.
Mix worked-out and literal values; vary where the phrase sits. Skip a skill a rule
does not fit naturally and say so.

## Minimal pairs the router lists together (c06, c07)

Round 2's pairs mostly taught nothing: the router listed both twins for both
messages in only 104 of 333. Run the checker with `--colist`: a pair passes only
when the router lists BOTH twins for BOTH messages. Same message shape, the deciding
detail changed, as before. If after real effort (several phrasings) the router will
not list both for a pair, stop on it and report it — that is a finding, not a
failure.

## Batch c08

- 16 `stackDiscounts` rows: discounts applied one after another ("an extra 10% off
  the already reduced price"), worded so the router also lists `applyDiscount`.
- 60 translate-shaped declines ("translate good morning into Polish", "how do you say
  thank you in Hindi", "what's 'cheers' in Swahili"…) across about 30 languages, in a
  `"declines"` list, and 30 `languageCodeLookup` rows that name a language ("what's
  the ISO code for Polish", "language code for Hindi please"), so the planner learns
  the difference, not to fear languages.
- 220 more declines of every kind (writing, advice, chit-chat, lures), as in round 2.

## Check

    node scripts/plannerdata2-check.mjs bench/planner-rows-3/authored/<batch>.json --engine http://127.0.0.1:<port> [--colist]

Fix or replace failing rows to 0 failures. Touch nothing else in the repo; keep your
working files under scratchpad/<batch>/. Reply with counts per skill (or per pair),
the synonyms you added, and every pair or skill you could not complete.
