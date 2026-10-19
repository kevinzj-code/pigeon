# Writing lure pairs for the asks check

Patch's asks check reads a message and says YES (the person is asking for
something a tool can do: computed, converted, generated, looked up, checked,
formatted or transformed) or NO (they are describing, complaining, reminiscing,
joking, or using a word figuratively). It runs before the planner, and its job
is mostly to say NO to things that merely *sound* like a skill.

A **lure pair** is two messages built on the same skill vocabulary:

- **no**: an ordinary sentence that uses the skill's words (or its key word)
  but asks for nothing. A statement, a complaint, a memory, a joke, an idiom,
  a feeling. A tool could not carry it out, and the person does not want one to.
- **yes**: a real request a tool could carry out, for **that** skill, using the
  same key words, worded plainly as people type (lower case is fine, data
  included when the skill needs it).

The pattern is `ASKS_SHOTS` in `src/verify.js`:

| no | yes |
|---|---|
| he rounded on me in the meeting for no reason | round 12.7 to one decimal place |
| some days of the week just drag more than others | what day of the week was 3 march 1999 |
| i am trying to sort my life out this year | sort these names alphabetically |
| she is quite a character once you get to know her | how many characters are in this sentence |
| the whole thing is in code and nobody will explain it | encode this string as base64 |

## Rules

1. **Two pairs per skill** in your brief, every skill. The two pairs use
   different angles (one idiom, one ordinary life statement, say).
2. **The no must not be a request in disguise.** Not "I wonder what 15% of 80
   is", not "no idea how many days until christmas", not a question someone
   wants answered. Prefer statements. A rhetorical question is allowed only if
   nobody could take it as a request ("who even counts calories any more").
   Numbers and data may appear in a no ("ran 5k this morning and my legs are
   gone"), which makes good lures, as long as nothing is being asked.
3. **The yes must be clearly that skill** and not one of its neighbours. It must
   be something the skill's description says it does.
4. **Short:** at most 20 words each. Natural, varied, British or American
   spelling. Do not start every no with "I".
5. **Do not copy** the plan's examples, `ASKS_SHOTS`, or anything you know to
   be a bench message. The checker enforces the hold-out.
6. **If a pair is honestly ambiguous** (a reasonable person could read the no
   as a request, or the yes as idle talk), rewrite it or drop it. Kevin
   reviews; ambiguous pairs are left out of training.

## Output

Write `bench/asks-rows/authored/<batch>.json`:

```json
{ "batch": "l01", "pairs": [ { "skill": "convertLength", "no": "…", "yes": "…" } ] }
```

Then run, and fix until it passes with 0 errors:

```
node scripts/asksdata-check.mjs bench/asks-rows/authored/<batch>.json
```

Read every flag it prints and either rewrite the pair or leave it if the flag is
wrong for that pair. Reply with: pairs written, skills covered, errors (must be
0), the flags you left and why, and any skill you could not write a fair pair
for.
