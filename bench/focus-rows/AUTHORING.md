# Writing training cases for the focus pass

Patch's focus pass is used on web look-up answers. An encyclopedia-style
passage comes back, the app splits it into sentences and numbers them, and a
small model must name the ONE sentence that states the answer to the person's
question, or 0 if none does. The app then quotes that sentence word for word.
The model writes only a few words of reasoning (`looking_for`) and a number.

Read `src/focus.js` (`FOCUS_SYSTEM`, `FOCUS_SHOTS`) to see exactly what it is
shown.

Each case is a question, a passage, the sentence that answers it, the
answering words quoted from that sentence, and `looking_for`: the specific thing
the question asks for, in a few words, as in the shots ("the name of the person
who is currently mayor", "the year the tower was finished").

## Rules

1. **Invented subjects only:** towns, offices, companies, rivers, festivals,
   societies, schools, buildings, clubs, products, species. No real-world fact
   can then be wrong. Do not reuse the shots' subjects (Springfield, Mongolia
   and so on), and keep away from your batch's neighbours: each batch has its
   own domain (below).
2. **Write like an encyclopedia opening.** Sentence 1 usually defines the
   subject. Use 3 to 7 sentences, and avoid abbreviations with full stops (the
   app's splitter may break on them).
3. **Questions as people type them** into a search box: who holds a post, when
   it happened, how many, where, what it is called, how long or tall, who
   founded or designed it, what it is.
4. **Spread the answer:** about 20% sentence 1, 30% sentence 2, 30% sentence 3
   or later, and **20% labelled 0**.
5. **The 0 cases are where the model fails today, so make them good traps.** The
   passage is about the subject and has a tempting sentence that does not
   answer: a *former* principal when the question asks for the current one, the
   founder when it asks the owner, last year's winner when it asks the record
   holder, a guest conductor when it asks the music director.
6. **Distractors in the answered cases:** other names, dates and figures in other
   sentences, so the model has to read the question.
7. `quote` is copied exactly from the answering sentence and is unique to it;
   it is null for 0.
8. `looking_for` is 2 to 12 words, and is what the question wants, not the
   answer itself.

## Output

Write `bench/focus-rows/authored/<batch>.json`:

```json
{ "batch": "f01", "domain": "…", "cases": [ { "question": "…", "passage": "…", "sentence": 2, "quote": "…", "looking_for": "…" } ] }
```

Then run, and fix until it passes with 0 errors:

```
node scripts/focusdata-check.mjs bench/focus-rows/authored/<batch>.json
```

The checker splits passages with the app's own splitter, checks each quote sits
in exactly the labelled sentence, checks `looking_for`, and refuses anything
within reach of the held-out set. Reply with the count, the answer-position
spread, and any case you think is arguable.

## Batches (150 cases each)

| Batch | Domain |
|---|---|
| f01 | towns, villages and districts |
| f02 | public offices, councils and institutions |
| f03 | companies, shops and products |
| f04 | rivers, lakes, mountains, islands and parks |
| f05 | festivals, fairs, races and annual events |
| f06 | buildings, bridges, towers and landmarks |
| f07 | sports clubs, leagues and competitions |
| f08 | societies, orchestras, choirs, theatres and schools |
| f09 | railways, canals, roads, ferries and airports |
| f10 | invented species, inventions, ships and machines |
