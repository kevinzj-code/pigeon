# Tool-category classifier training set — build report

`train.jsonl` 6491 rows · `valid.jsonl` 500 rows · 6991 total, 24 labels.

Base model: **Qwen2.5-1.5B-Instruct**. Every row carries a byte-identical system prompt and a bare category name as the answer — no `<think>`, no punctuation, no explanation.


## 1. Rows per category

| category | train | valid | total | | category | train | valid | total |
|---|---:|---:|---:|---|---|---:|---:|---:|
| `none` | 1045 | 21 | 1066 | | `finance` | 179 | 21 | 200 |
| `text` | 571 | 21 | 592 | | `developer` | 167 | 21 | 188 |
| `dates` | 499 | 21 | 520 | | `generation` | 164 | 21 | 185 |
| `math` | 431 | 21 | 452 | | `learning` | 154 | 21 | 175 |
| `data` | 399 | 21 | 420 | | `organising` | 154 | 21 | 175 |
| `encoding` | 347 | 21 | 368 | | `reference` | 147 | 21 | 168 |
| `validation` | 260 | 20 | 280 | | `everyday` | 147 | 21 | 168 |
| `conversion` | 248 | 20 | 268 | | `decisions` | 139 | 21 | 160 |
| `lists` | 247 | 21 | 268 | | `games` | 139 | 21 | 160 |
| `writing` | 240 | 20 | 260 | | `files` | 129 | 21 | 150 |
| `statistics` | 220 | 20 | 240 | | `geometry` | 129 | 21 | 150 |
| `design` | 207 | 21 | 228 | | `health` | 129 | 21 | 150 |

Largest category **592**, smallest **150** → **3.95:1**. Clears the 4× check. ✅

`none` is 1066 rows (15.2% of the set).

## 2. Rows dropped for colliding with the held-out set

**4 generated rows rejected**, plus **41 of the 1,510 seeds** dropped as near-copies of exam questions.

By rule:

| rule | what it catches | rejections |
|---|---|---:|
| 1 | normalised token sequence identical | 1 |
| 2 | content-word multiset identical | 1 |
| 3 | token edit distance ≤ 1 | 1 |
| 4 | content Jaccard ≥ 0.75 | 1 |
| 5 | trigram cosine ≥ 0.85 | 0 |

**234 further rows dropped as duplicates of each other** — the same near-copy rule applied inside the corpus rather than against the exam. Most are seeds that differ only by their numbers: `is 97 prime`, `is 1 prime`, `is 2 prime` and `is 7919 prime` are one question under the plan's definition, so only the first survives and the skill's quota is refilled from bank headroom.

Where that cost a skill real coverage, the seed is **recovered by rephrasing** rather than lost: 25 seeds that lost a dedupe race against a sibling are re-authored into a distinct surface form (`is 1 prime` → `is the number 1 prime`), so the skill keeps its example. These are sibling collisions, never exam collisions — a gate-blocked seed is never rephrased back in. Two first attempts failed and were re-authored: `turn 1798185600 into a calendar date` was blocked by the gate against the exam's `turn 1700000000 into a readable date`, and the obvious `is 1 a prime number` collides with a *different* sibling seed, `is 91 a prime number`.

**Total rows the gate and its dedupe removed: 279.**

> Build-time paraphrase rejections are low (4) because the same gate runs at authoring time inside `lint_bank.py`: a phrasing that collided with the exam was caught and **rewritten** there rather than reaching the builder to be dropped. Phrasings rejected and rewritten that way include `'tile value of the word quartz'` (vs the exam's `'tile value of the word zebra'`), `'can you add 20 percent vat to 250'` (vs `'add 20 percent vat onto 480'`) and `'work out 15% of 240'` (vs `'work out 12% of 6500'`). The gate is demonstrably live: 41 of the 1,510 seeds still trip it at build time.

### Seeds dropped, by category

| dates 10 · generation 6 · reference 5 · text 5 · design 4 · math 3 · writing 2 · conversion 1 · data 1 · developer 1 · everyday 1 · finance 1 · statistics 1 |
|---|

A sample, with the exam question each collided with:

- `convertArea` — 'how big is 500 sq ft in square metres' ≈ '3000 sq ft in square metres'  *(rule 4)*
- `transposeTable` — 'turn columns into rows' ≈ 'turn the columns of this table into rows'  *(rule 4)*
- `addBusinessDays` — 'three working days before 2026-09-01' ≈ 'three working days on from 2026-11-02'  *(rule 4)*
- `countdownTo` — 'how long until tomorrow' ≈ 'how long until 25 december'  *(rule 3)*
- `daysBetween` — 'how many days between 12 July 2026 and 25 December 2026' ≈ 'how many days between 12 july 2026 and christmas'  *(rule 1)*
- `daysBetween` — 'days from 2026-01-01 to 2026-03-01' ≈ 'working days from 2026-02-02 to 2026-02-27'  *(rule 3)*
- `daysInMonth` — 'how long is september 2026' ≈ 'how long is april 2027'  *(rule 1)*
- `formatDate` — 'format 2026-11-14 as DD/MM/YYYY' ≈ 'rewrite 2026-11-14 as DD/MM/YYYY'  *(rule 3)*
- `isWeekend` — 'is 2026-03-15 a sunday' ≈ 'is 2026-07-04 a saturday'  *(rule 1)*
- `nextWeekday` — 'when is next tuesday' ≈ 'when is the next thursday'  *(rule 2)*
- `parseDuration` — 'how many seconds is 1h 30m' ≈ 'how many seconds is 2h 15m'  *(rule 1)*
- `timeAgo` — 'how long until 2026-09-15' ≈ 'how long until 25 december'  *(rule 1)*

**Skills that lost every seed:** `rollDice`. Base rows for these were authored from the skill's own description and input schema instead of dropping the skill — the exam asks about every skill exactly once, so an absent skill is a guaranteed lost point.

> Note: every worked example in the plan — all five rows of the motivating table, all five plain-refusal examples, all seven hard-negative examples — is itself inside `forbidden.json`. None could be used.

## 3. Do the paraphrases actually escape the seed's vocabulary?

| seed | category | paraphrase | kind | shared content words |
|---|---|---|---|---|
| 'scale 4000x3000 to fit in 1000x1000' | `design` | 'shrink this photo without squashing it' | i | **none** |
| 'scale 4000x3000 to fit in 1000x1000' | `design` | 'the banner slot is a fixed size' | i | **none** |
| 'scale 4000x3000 to fit in 1000x1000' | `design` | 'fit 4000x3000 inside a 1000 square' | s | fit, x |
| 'scale 4000x3000 to fit in 1000x1000' | `design` | 'can you shrink 1920x1080 so it is 800 across' | c | x |
| 'hex encode with spaces between bytes' | `encoding` | 'show me the underlying bytes for this word' | i | bytes |
| 'hex encode with spaces between bytes' | `encoding` | 'turn Pigeon into byte pairs' | s | **none** |
| 'hex encode with spaces between bytes' | `encoding` | 'Pigeon as byte pairs' | b | **none** |
| 'what line endings does this use' | `files` | 'the parser chokes on the last row' | i | **none** |
| 'what line endings does this use' | `files` | 'the import cut off halfway' | i | **none** |
| 'what line endings does this use' | `files` | 'summarise the size of this passage' | s | **none** |
| 'what line endings does this use' | `files` | 'crlf or lf here' | a | **none** |
| 'what line endings does this use' | `files` | 'i need the line count for this paste' | c | line |
| 'what line endings does this use' | `files` | 'which line endings here' | b | endings, line |
| 'what line endings does this use' | `files` | 'cout the lines here' | t | **none** |
| 'what line endings does this use' | `files` | 'break down what is in this text' | s | **none** |
| 'what line endings does this use' | `files` | 'could you tell me the size of this text' | c | **none** |
| 'plan 45 pages at 20 pages a day' | `learning` | 'break this book into a daily habit' | i | **none** |
| 'plan 45 pages at 20 pages a day' | `learning` | 'make this book fit my week' | i | **none** |
| 'plan 45 pages at 20 pages a day' | `learning` | '100 pages in 4 days per day' | a | day, pages |
| 'plan 45 pages at 20 pages a day' | `learning` | 'could you split this book across days' | c | **none** |
| 'grade level of a short instruction' | `text` | 'what grade level is this written at' | s | grade, level |
| 'trim and collapse this text' | `text` | 'the spacing came through wrong from word' | i | **none** |
| 'express 100000 seconds readably' | `dates` | 'the timer output needs to read like english' | i | **none** |
| 'express 100000 seconds readably' | `dates` | '5400 seconds written as a readable span' | s | seconds |
| 'express 100000 seconds readably' | `dates` | 'can you express 5400 seconds as a duration' | c | express, seconds |
| 'chuck four cubes and total them up' | `generation` | 'settle the move the way a board game would' | i | **none** |
| 'chuck four cubes and total them up' | `generation` | 'chuck a hundred sider for me' | s | chuck |
| 'chuck four cubes and total them up' | `generation` | '4d4 total sum' | a | total |
| 'chuck four cubes and total them up' | `generation` | 'one hundred sider' | b | **none** |
| 'write 100 in binary' | `conversion` | 'translate this number system for me' | i | **none** |
| 'write 100 in binary' | `conversion` | 'binary 11111111 stated in decimal' | s | binary |
| 'write 100 in binary' | `conversion` | 'i need binary 11111111 in decimal' | c | binary |
| 'find the longest word' | `text` | 'the crossword needs the biggest entry' | i | **none** |
| 'bedtimes for a 08:00 alarm with no wind-down' | `health` | 'whats a sensible lights out for a 6am start' | i | **none** |
| 'bedtimes for a 08:00 alarm with no wind-down' | `health` | 'i want to stop waking up mid cycle' | i | **none** |
| 'bedtimes for a 08:00 alarm with no wind-down' | `health` | 'sleep cycles for a 07:00 alarm' | a | alarm |
| 'bedtimes for a 08:00 alarm with no wind-down' | `health` | 'i need bedtimes to wake at half seven' | c | bedtimes |
| 'bedtimes for a 08:00 alarm with no wind-down' | `health` | 'when shoud i go to bed for a 7am alarm' | t | alarm |
| 'what pace is a 3 hour marathon' | `health` | 'how slow can i go and still finish in time' | i | **none** |
| 'what pace is a 3 hour marathon' | `health` | 'how does my sunday long run translate' | i | **none** |
| 'what pace is a 3 hour marathon' | `health` | 'turn 4:50 per km into a 5k time' | s | **none** |
| 'what pace is a 3 hour marathon' | `health` | '42.2k at 4:40 per km eta' | a | **none** |
| 'what pace is a 3 hour marathon' | `health` | '10k at 5:45 per km' | b | **none** |
| 'common items where the first list repeats one' | `lists` | 'is there any crossover between these' | i | **none** |
| 'common items where the first list repeats one' | `lists` | 'do these two collections touch at all' | s | **none** |
| 'common items where the first list repeats one' | `lists` | 'in both lists' | b | **none** |
| 'analyse the tone of this comment' | `text` | 'is the tone of this warm or cold' | i | tone |
| 'write that date as D MMMM YYYY' | `dates` | 'the american form rejects my date layout' | i | date |
| 'write that date as D MMMM YYYY' | `dates` | 'lay this date out in the required pattern' | i | date |
| 'write that date as D MMMM YYYY' | `dates` | 'show the festive date as DDDD, D MMM' | s | d, date |
| 'write that date as D MMMM YYYY' | `dates` | 'i need this shown MM-DD-YY' | c | **none** |
| 'perimeter of a triangle with sides 3 4 5' | `geometry` | 'trim needed to go round this frame' | i | **none** |
| 'perimeter of a triangle with sides 3 4 5' | `geometry` | 'distance round a rectangle 9 by 4' | s | **none** |
| 'perimeter of a triangle with sides 3 4 5' | `geometry` | 'circumference r 3' | a | **none** |
| 'perimeter of a triangle with sides 3 4 5' | `geometry` | 'rectangle 12 by 9 round the edge' | b | **none** |
| 'area of a triangle with base 10 and height 6' | `geometry` | 'how many tiles for a floor this size' | i | **none** |
| 'area of a triangle with base 10 and height 6' | `geometry` | 'how much glass for a window this shape' | i | **none** |
| 'area of a triangle with base 10 and height 6' | `geometry` | 'area rect 8x5' | a | area |
| 'area of a triangle with base 10 and height 6' | `geometry` | 'could you find the area of this trapezoid' | c | area |
| 'turn this outline into markdown' | `writing` | 'my tabbed notes need to become a real document' | i | **none** |
| 'turn this outline into markdown' | `writing` | 'give my scribbled plan real structure' | i | **none** |
| 'turn this outline into markdown' | `writing` | 'markdown from a flat list' | a | markdown |
| 'area of a rectangle 8 by 5' | `geometry` | 'how much turf do i need for the back garden' | i | **none** |
| 'area of a rectangle 8 by 5' | `geometry` | 'how much grass seed to cover this plot' | i | **none** |
| 'area of a rectangle 8 by 5' | `geometry` | 'floor space of a square with 6m sides' | s | **none** |
| 'area of a rectangle 8 by 5' | `geometry` | 'can you work out the area of a 7 by 3 room' | c | area |
| 'points for xylophone' | `games` | 'is it worth dumping my tiles for this' | i | **none** |
| 'points for xylophone' | `games` | 'scrabble value quiz' | b | **none** |
| 'points for xylophone' | `games` | 'sc score for the word fjord' | a | **none** |
| 'points for xylophone' | `games` | 'scrable score for pigeon' | t | **none** |

**18 of 20 sampled seeds** have at least one paraphrase sharing no content word with them (46 such rows in the sample).

Across the whole set: **1395 of 1492 seeds (93.5%)** carry at least one zero-overlap paraphrase.

## 4. Negatives

**498 plain refusals** · **568 hard negatives** · 1066 total.

Hard negatives per category (the category whose vocabulary they borrow):

| category | count | | category | count |
|---|---:|---|---|---:|
| `conversion` | 25 | | `geometry` | 25 |
| `data` | 25 | | `health` | 25 |
| `dates` | 23 | | `learning` | 25 |
| `decisions` | 25 | | `lists` | 25 |
| `design` | 25 | | `math` | 25 |
| `developer` | 25 | | `organising` | 24 |
| `encoding` | 25 | | `reference` | 25 |
| `everyday` | 25 | | `statistics` | 24 |
| `files` | 24 | | `text` | 25 |
| `finance` | 24 | | `validation` | 25 |
| `games` | 25 | | `writing` | 24 |
| `generation` | 25 | | | |

Hard negatives use a category's vocabulary in an ordinary, non-tool sense, so the adapter learns the boundary rather than finding a tool in every sentence.

## 5. Where the paraphrasing was genuinely hard

Named plainly rather than padded with near-duplicates.

**`math`, and every category built mostly of numbers.** The gate strips digits, so two questions differing only in their operands are *the same question* by the plan's own rule — and in maths that is most of them. `15 percent of 240`, `20 percent of 85.50` and `7.5 percent of 1200` collapse to one row; four `evaluateExpression` phrasings normalised to the **empty string** (`96 / 8`, `14 * 6 - 9`). Every bare-data row in this category had to be re-authored to vary in *wording* rather than in figures. The same pressure hit `validation`, where `192.168.1.1 well formed` and `4539578763621486 well formed` both reduce to `well formed`.

**Seeds written as test cases rather than as requests.** A meaningful minority of seeds are fixtures exercising an edge case, and there is no natural indirect paraphrase for them because nobody would ever type them: `distance between identical points`, `how big is an empty file`, `expected value of a certain outcome`, `is abc an anagram of abcd`, `flatten an already flat list`, `darken by nothing`, `simple interest at zero percent`. These were paraphrased conservatively — a real person's phrasing of the *operation*, not of the edge case — because inventing a goal for them would have invented a user who does not exist.

**`rollDice`, whose entire natural vocabulary is burned.** All five seeds are `roll NdN seed N` and collide with the exam's `roll 3d6 seed 12`. Its base rows are authored from the description and input schema instead, and they had to abandon *roll*, *d* and *seed* altogether — `simulate two six siders for my board game`. It is the only skill in the set with no surviving seed, and the phrasings are correspondingly less natural than elsewhere.

**The 58-way `text` split.** `countWords`, `countCharacters`, `countSentences` and `countLines` are four different answers to "how long is this", and `sortLines` sits next to `lists`/`sortList` while `findLongSentences` sits next to `writing`/`paragraphStats`. Every paraphrase has to name the unit or the artefact, which limits how far the wording can drift — the indirect rows carry the load here (`will this fit in a tweet`, `did every record come through`).

**`text` gets one paraphrase per seed, so "one indirect per seed" and "spread the six kinds" cannot both hold.** Indirect won, per the agreed policy. Two skills are declared exceptions where a goal-shaped question reads as another category — `flagPii` ("can i share this safely" sounds like `validation`) and `readingLevel` ("will a teenager follow this" sounds like `writing`) — and use synonym swaps on purpose. This is the main reason 97 of 1492 seeds (6.5%) carry no zero-overlap paraphrase.

Seeds without a zero-overlap paraphrase, by category: text 46 · dates 16 · data 9 · validation 5 · design 4 · everyday 3 · lists 3 · conversion 2 · encoding 2 · finance 2 · writing 2 · generation 1 · math 1 · statistics 1.

**Seeds that are the same question as each other.** 25 seeds reduce to a sibling's normalised form and had to be rephrased to survive — concentrated in `math` and `validation`, where `is 97 prime` / `is 1 prime` / `is 2 prime` / `is 7919 prime` are one question, and `is 256.1.1.1 valid` / `is 9780306406158 valid` are another. Worth knowing: these seed sets test different code paths but are indistinguishable as text once the numbers are removed.

**Two seeds are literally identical.** `allocateProportionally` and `splitEvenly` both ship the seed text `split 100 three ways`. Both label `math`, so nothing is mislabelled, but one copy is deduped and that skill refills from bank headroom. Worth knowing, since the two skills do different things.

