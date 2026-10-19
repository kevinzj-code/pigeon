# Writing round-2 planner rows

You are writing training messages for Patch's planner, a small model (Qwen3-VL 2B)
that reads a message plus a shortlist of skill cards and writes a plan:
`{"about": …, "steps": [{"id": "s1", "skill": <name>, "input": {…}}]}`.
Round 1 was trained on the skills' own examples and fails on new phrasings, so
every message here is NEW. You write the message and the `input` the planner
should produce; a script builds the rest and checks each row by running it.

## What you write

`model/planner-data-2/authored/<batch>.json`:

```json
{ "rows":  [{ "skill": "countWords", "message": "…", "input": { "text": "…" }, "mode": "full" }],
  "pairs": [{ "twins": ["hexEncode", "hexDecode"],
              "rows": [{ "skill": "hexEncode", … }, { "skill": "hexDecode", … }] }] }
```

- `input` uses the field names, types and enum values of the skill's `inputSchema`
  (in your brief). Copy values out of the message exactly: every number, and every
  string with a space in it or 15+ characters, must appear in the message as written
  (numbers as digits, or as a plain word like "two", "half", "dozen"). Leave out
  optional fields the message does not mention.
- `mode: "full"`: the message gives everything required.
- `mode: "pointed"`: the message points at content it does not include ("count the
  words in this", "sort the list below", "tidy my json") and `input` LEAVES OUT that
  required field (keep any other required values the message does give). Aim for about
  a quarter pointed rows for skills whose required input is content (text, list, items,
  table, json, csv…), about one in ten where it is natural for a numeric skill ("what's
  the tip on our bill" with no amount), none for skills with nothing required.

## Per skill: 24 rows that pass

Vary them. Across the 24, mix:
- **who is speaking**: student, parent, nurse, shop owner, developer, retiree, teacher,
  traveller, gamer, accountant, cook, someone in a hurry…
- **how much they say**: 3–6 terse words; one plain sentence; two or three sentences
  with a bit of their situation first.
- **register**: casual lowercase, polite, a command, a question, the odd typo, British
  and American spellings.
- **where the values sit**: start, middle or end; digits, thousands commas, currency
  symbols, units.
- **verbs**: don't open most messages the same way.

Never paraphrase the skill's own `examples` (listed in your brief) — invent new
situations. Do not open or read `scripts/holdout.mjs`, `scripts/no-skill-set.mjs` or
`scripts/followups.mjs`: they are the exam. The checker refuses anything close to them
without showing them; when it says so, write a different message.

## Minimal pairs

For each entry in your brief's `pairs`, write `minimal_pairs` pairs. A pair is two
messages of the SAME shape that differ only in the detail that decides between the two
twins (read both cards: a direction word, one value or two, "how many" vs "list them",
which unit, encode vs decode…). The first row names `twins[0]`, the second `twins[1]`.
They must share most of their words (the checker measures it). New messages, not the
cards' examples. Pair rows are on top of the 24.

## Check, fix, repeat

From the repo root:

    node scripts/plannerdata2-check.mjs model/planner-data-2/authored/<batch>.json --engine http://127.0.0.1:<port>

It prints every failing row and why, then counts per skill. Fix or replace failing rows
until it reports 0 failures and every skill has 24 rows (fewer only when a skill truly
cannot get the router to list it after real effort — never below 20; say which). Do not
weaken a row to pass (for example by changing a value in the message to match a wrong
input). Re-runs are cached and fast. Touch nothing else in the repo.

When done, reply with: rows per skill, pairs written, and anything you could not meet.
