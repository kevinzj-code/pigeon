# Tool-category classifier training set — build report

`train.jsonl` 6181 rows · `valid.jsonl` 500 rows · 6681 total, 24 labels.

Base model: **Qwen2.5-1.5B-Instruct**. Every row carries a byte-identical system prompt and a bare category name as the answer — no `<think>`, no punctuation, no explanation.


## 1. Rows per category

| category | train | valid | total | | category | train | valid | total |
|---|---:|---:|---:|---|---|---:|---:|---:|
| `none` | 815 | 21 | 836 | | `finance` | 179 | 21 | 200 |
| `text` | 560 | 20 | 580 | | `developer` | 159 | 21 | 180 |
| `dates` | 499 | 21 | 520 | | `generation` | 154 | 21 | 175 |
| `math` | 431 | 21 | 452 | | `organising` | 154 | 21 | 175 |
| `data` | 399 | 21 | 420 | | `learning` | 154 | 21 | 175 |
| `encoding` | 339 | 21 | 360 | | `reference` | 147 | 21 | 168 |
| `validation` | 260 | 20 | 280 | | `decisions` | 139 | 21 | 160 |
| `lists` | 239 | 21 | 260 | | `everyday` | 139 | 21 | 160 |
| `conversion` | 240 | 20 | 260 | | `files` | 129 | 21 | 150 |
| `writing` | 239 | 21 | 260 | | `geometry` | 129 | 21 | 150 |
| `statistics` | 220 | 20 | 240 | | `games` | 129 | 21 | 150 |
| `design` | 199 | 21 | 220 | | `health` | 129 | 21 | 150 |

Largest category **580**, smallest **150** → **3.87:1**. Clears the 4× check. ✅

`none` is 836 rows (12.5% of the set).

## 2. Rows dropped for colliding with the held-out set

**3 generated rows rejected**, plus **35 of the 1,510 seeds** dropped as near-copies of exam questions.

By rule:

| rule | what it catches | rejections |
|---|---|---:|
| 1 | normalised token sequence identical | 0 |
| 2 | content-word multiset identical | 1 |
| 3 | token edit distance ≤ 1 | 1 |
| 4 | content Jaccard ≥ 0.75 | 1 |
| 5 | trigram cosine ≥ 0.85 | 0 |

**227 further rows dropped as duplicates of each other** — the same near-copy rule applied inside the corpus rather than against the exam. Most are seeds that differ only by their numbers: `is 97 prime`, `is 1 prime`, `is 2 prime` and `is 7919 prime` are one question under the plan's definition, so only the first survives and the skill's quota is refilled from bank headroom.

Where that cost a skill real coverage, the seed is **recovered by rephrasing** rather than lost: 25 seeds that lost a dedupe race against a sibling are re-authored into a distinct surface form (`is 1 prime` → `is the number 1 prime`), so the skill keeps its example. These are sibling collisions, never exam collisions — a gate-blocked seed is never rephrased back in. Two first attempts failed and were re-authored: `turn 1798185600 into a calendar date` was blocked by the gate against the exam's `turn 1700000000 into a readable date`, and the obvious `is 1 a prime number` collides with a *different* sibling seed, `is 91 a prime number`.

**Total rows the gate and its dedupe removed: 265.**

> Build-time paraphrase rejections are low (3) because the same gate runs at authoring time inside `lint_bank.py`: a phrasing that collided with the exam was caught and **rewritten** there rather than reaching the builder to be dropped. Phrasings rejected and rewritten that way include `'tile value of the word quartz'` (vs the exam's `'tile value of the word zebra'`), `'can you add 20 percent vat to 250'` (vs `'add 20 percent vat onto 480'`) and `'work out 15% of 240'` (vs `'work out 12% of 6500'`). The gate is demonstrably live: 35 of the 1,510 seeds still trip it at build time.

### Seeds dropped, by category

| dates 9 · reference 5 · text 5 · design 4 · math 3 · writing 2 · conversion 1 · data 1 · developer 1 · everyday 1 · finance 1 · generation 1 · statistics 1 |
|---|

A sample, with the exam question each collided with:

- `convertArea` — 'how big is 500 sq ft in square metres' ≈ '3000 sq ft in square metres'  *(rule 4)*
- `transposeTable` — 'turn columns into rows' ≈ 'turn the columns of this table into rows'  *(rule 4)*
- `addBusinessDays` — 'three working days before 2026-09-01' ≈ 'three working days on from 2026-11-02'  *(rule 4)*
- `countdownTo` — 'how long until tomorrow' ≈ 'how long until 25 december'  *(rule 3)*
- `daysBetween` — 'days from 4 March 2027 to 19 August 2027' ≈ 'working days from 2026-02-02 to 2026-02-27'  *(rule 3)*
- `daysBetween` — 'days from 2026-01-01 to 2026-03-01' ≈ 'working days from 2026-02-02 to 2026-02-27'  *(rule 3)*
- `daysInMonth` — 'how long is september 2026' ≈ 'how long is april 2027'  *(rule 1)*
- `formatDate` — 'format 2026-11-14 as DD/MM/YYYY' ≈ 'rewrite 2026-11-14 as DD/MM/YYYY'  *(rule 3)*
- `isWeekend` — 'is 2026-03-15 a sunday' ≈ 'is 2026-07-04 a saturday'  *(rule 1)*
- `nextWeekday` — 'when is next tuesday' ≈ 'when is the next thursday'  *(rule 2)*
- `parseDuration` — 'how many seconds is 1h 30m' ≈ 'turn 2h 15m into seconds'  *(rule 4)*
- `pxToRem` — 'what is 24px in rem' ≈ '2.25rem in px please'  *(rule 2)*

> Note: every worked example in the plan — all five rows of the motivating table, all five plain-refusal examples, all seven hard-negative examples — is itself inside `forbidden.json`. None could be used.

## 3. Do the paraphrases actually escape the seed's vocabulary?

| seed | category | paraphrase | kind | shared content words |
|---|---|---|---|---|
| 'make this title case: the lord of the rings' | `text` | 'make my heading read in title case' | i | case, title |
| 'make a memorable password from words' | `encoding` | 'give me a login i can say down the phone' | i | **none** |
| 'make a memorable password from words' | `encoding` | 'a login i can hold in my head' | i | **none** |
| 'make a memorable password from words' | `encoding` | 'eight word long passphrase' | a | **none** |
| 'when was 2025-09-01 in plain words' | `dates` | 'when did i last hear from them in plain words' | i | plain, when, words |
| 'when was 2025-09-01 in plain words' | `dates` | 'how far back 2026-08-29 sits' | s | **none** |
| 'when was 2025-09-01 in plain words' | `dates` | 'how far back that date sits' | b | **none** |
| '8 oz of flour in grams' | `conversion` | 'the doctor quoted a number i cannot picture' | i | **none** |
| '8 oz of flour in grams' | `conversion` | '165 pounds written in kilograms' | s | **none** |
| '8 oz of flour in grams' | `conversion` | 'two tonnes kilograms' | b | **none** |
| 'what is 9am Tokyo in London on 2026-01-15' | `dates` | 'the webinar is at three their time what is mine' | i | **none** |
| 'what is 9am Tokyo in London on 2026-01-15' | `dates` | 'restate this meeting time for their zone' | i | **none** |
| 'what is 9am Tokyo in London on 2026-01-15' | `dates` | 'midnight UTC in Auckland 2026-12-25' | a | **none** |
| 'distance between two nearby points' | `geometry` | 'how many miles am i flying tomorrow' | i | **none** |
| 'distance between two nearby points' | `geometry` | 'how far would i travel going direct' | i | **none** |
| 'distance between two nearby points' | `geometry` | 'haversine 51.5 -0.1 to 48.85 2.35' | a | **none** |
| 'distance between two nearby points' | `geometry` | 'could you tell me how far paris is from oslo' | c | **none** |
| 'decode morse using dashes and dots' | `encoding` | 'the distress signal in the story says what' | i | **none** |
| 'decode morse using dashes and dots' | `encoding` | 'read this with a word break in it' | s | **none** |
| 'decode morse using dashes and dots' | `encoding` | 'these dashes as words' | b | dashes |
| 'checklist ignoring blank entries' | `generation` | 'i keep forgetting steps make it trackable' | i | **none** |
| 'checklist ignoring blank entries' | `generation` | 'convert my jobs into a checkable list' | s | **none** |
| 'checklist ignoring blank entries' | `generation` | 'numbered checkboxes from this list' | a | **none** |
| 'checklist ignoring blank entries' | `generation` | 'these items with tick marks' | b | **none** |
| 'uppercase hex for this text' | `encoding` | 'the firmware config takes byte pairs' | i | **none** |
| 'uppercase hex for this text' | `encoding` | 'write hello as byte pairs' | s | **none** |
| 'uppercase hex for this text' | `encoding` | 'hello in byte values' | b | **none** |
| 'what time is it in Sydney and Los Angeles' | `dates` | 'the dashboard needs every region side by side' | i | **none** |
| 'what time is it in Sydney and Los Angeles' | `dates` | 'the hour in London Tokyo and New York' | s | **none** |
| 'what time is it in Sydney and Los Angeles' | `dates` | 'hour across those three cities' | b | **none** |
| 'what is at a.b.c in this document' | `data` | 'what sits at that nested position' | i | **none** |
| 'what is at a.b.c in this document' | `data` | 'read user.name out of this json' | s | **none** |
| 'what is at a.b.c in this document' | `data` | 'user.name from this document' | b | document |
| 'what divides 270 and 192 evenly' | `math` | 'cut both lengths into equal pieces as big as possible' | i | **none** |
| 'what divides 270 and 192 evenly' | `math` | 'can you find the gcd of 48 and 18' | c | **none** |
| 'what divides 270 and 192 evenly' | `math` | 'gcd of 100 and 75 pleae' | t | **none** |
| 'make this string regex-safe' | `developer` | 'the dots in this are behaving as wildcards' | i | **none** |
| 'make this string regex-safe' | `developer` | 'treat every character here as itself' | i | **none** |
| 'make this string regex-safe' | `developer` | 'escape brackets for regex' | a | regex |
| 'what is the average q1' | `data` | 'which row has the top score' | i | **none** |
| 'what is the average q1' | `data` | 'one figure summarising that whole column' | i | **none** |
| 'what is the average q1' | `data` | 'can you add up the amount column' | c | **none** |
| '11pm Sydney in Los Angeles 2026-06-10' | `dates` | 'my flight lands at local time what is that here' | i | **none** |
| '11pm Sydney in Los Angeles 2026-06-10' | `dates` | '3pm London shown in New York on 2026-09-01' | s | pm |
| '11pm Sydney in Los Angeles 2026-06-10' | `dates` | 'can you tell me 3pm London in New York time' | c | pm |
| 'look up the element Au' | `reference` | 'the homework asks about this symbol' | i | **none** |
| 'look up the element Au' | `reference` | 'i need the facts on this element for a quiz' | i | element |
| 'look up the element Au' | `reference` | 'atomic mass of carbon' | s | **none** |
| 'look up the element Au' | `reference` | 'can you look up the element Au' | c | au, element, look |
| 'what is the offset for Asia/Kolkata' | `reference` | 'should i call now or wait' | i | **none** |
| 'what is the offset for Asia/Kolkata' | `reference` | 'how far New York sits from utc' | s | **none** |
| 'what is the offset for Asia/Kolkata' | `reference` | 'Asia/Tokyo clock now' | b | asia |
| 'check this password strength' | `validation` | 'is this safe enough for my bank' | i | **none** |
| 'check this password strength' | `validation` | 'how guessable is what i chose' | i | **none** |
| 'check this password strength' | `validation` | 'i need this password rated' | c | password |
| 'am I repeating myself' | `writing` | 'the editor said i lean on certain words' | i | **none** |
| 'am I repeating myself' | `writing` | 'the words i overwork in this draft' | i | **none** |
| 'am I repeating myself' | `writing` | 'words used twice in this' | a | **none** |
| 'compress a repeated list of names' | `encoding` | 'shrink this so i can store it in a cookie' | i | **none** |
| 'compress a repeated list of names' | `encoding` | 'can you squeeze this text down for me' | c | **none** |
| 'compress a repeated list of names' | `encoding` | 'reduce this repeating pattern in size' | s | **none** |

**19 of 20 sampled seeds** have at least one paraphrase sharing no content word with them (50 such rows in the sample).

Across the whole set: **1376 of 1470 seeds (93.6%)** carry at least one zero-overlap paraphrase.

## 4. Negatives

**499 plain refusals** · **337 hard negatives** · 836 total.

Hard negatives per category (the category whose vocabulary they borrow):

| category | count | | category | count |
|---|---:|---|---|---:|
| `conversion` | 13 | | `geometry` | 13 |
| `data` | 13 | | `health` | 13 |
| `dates` | 15 | | `learning` | 13 |
| `decisions` | 16 | | `lists` | 16 |
| `design` | 13 | | `math` | 13 |
| `developer` | 13 | | `organising` | 16 |
| `encoding` | 19 | | `reference` | 16 |
| `everyday` | 13 | | `statistics` | 16 |
| `files` | 13 | | `text` | 17 |
| `finance` | 13 | | `validation` | 17 |
| `games` | 17 | | `writing` | 13 |
| `generation` | 16 | | | |

Hard negatives use a category's vocabulary in an ordinary, non-tool sense, so the adapter learns the boundary rather than finding a tool in every sentence.

## 5. Where the paraphrasing was genuinely hard

Named plainly rather than padded with near-duplicates.

**`math`, and every category built mostly of numbers.** The gate strips digits, so two questions differing only in their operands are *the same question* by the plan's own rule — and in maths that is most of them. `15 percent of 240`, `20 percent of 85.50` and `7.5 percent of 1200` collapse to one row; four `evaluateExpression` phrasings normalised to the **empty string** (`96 / 8`, `14 * 6 - 9`). Every bare-data row in this category had to be re-authored to vary in *wording* rather than in figures. The same pressure hit `validation`, where `192.168.1.1 well formed` and `4539578763621486 well formed` both reduce to `well formed`.

**Seeds written as test cases rather than as requests.** A meaningful minority of seeds are fixtures exercising an edge case, and there is no natural indirect paraphrase for them because nobody would ever type them: `distance between identical points`, `how big is an empty file`, `expected value of a certain outcome`, `is abc an anagram of abcd`, `flatten an already flat list`, `darken by nothing`, `simple interest at zero percent`. These were paraphrased conservatively — a real person's phrasing of the *operation*, not of the edge case — because inventing a goal for them would have invented a user who does not exist.

**`rollDice`, whose entire natural vocabulary is burned.** All five seeds are `roll NdN seed N` and collide with the exam's `roll 3d6 seed 12`. Its base rows are authored from the description and input schema instead, and they had to abandon *roll*, *d* and *seed* altogether — `simulate two six siders for my board game`. It is the only skill in the set with no surviving seed, and the phrasings are correspondingly less natural than elsewhere.

**The 58-way `text` split.** `countWords`, `countCharacters`, `countSentences` and `countLines` are four different answers to "how long is this", and `sortLines` sits next to `lists`/`sortList` while `findLongSentences` sits next to `writing`/`paragraphStats`. Every paraphrase has to name the unit or the artefact, which limits how far the wording can drift — the indirect rows carry the load here (`will this fit in a tweet`, `did every record come through`).

**`text` gets one paraphrase per seed, so "one indirect per seed" and "spread the six kinds" cannot both hold.** Indirect won, per the agreed policy. Two skills are declared exceptions where a goal-shaped question reads as another category — `flagPii` ("can i share this safely" sounds like `validation`) and `readingLevel` ("will a teenager follow this" sounds like `writing`) — and use synonym swaps on purpose. This is the main reason 94 of 1470 seeds (6.4%) carry no zero-overlap paraphrase.

Seeds without a zero-overlap paraphrase, by category: text 43 · dates 16 · data 9 · validation 5 · design 4 · everyday 3 · lists 3 · conversion 2 · finance 2 · generation 2 · writing 2 · encoding 1 · math 1 · statistics 1.

**Seeds that are the same question as each other.** 25 seeds reduce to a sibling's normalised form and had to be rephrased to survive — concentrated in `math` and `validation`, where `is 97 prime` / `is 1 prime` / `is 2 prime` / `is 7919 prime` are one question, and `is 256.1.1.1 valid` / `is 9780306406158 valid` are another. Worth knowing: these seed sets test different code paths but are indistinguishable as text once the numbers are removed.

**Two seeds are literally identical.** `allocateProportionally` and `splitEvenly` both ship the seed text `split 100 three ways`. Both label `math`, so nothing is mislabelled, but one copy is deduped and that skill refills from bank headroom. Worth knowing, since the two skills do different things.

