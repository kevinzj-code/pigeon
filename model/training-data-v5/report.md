# Category router training-data-v5: build report

Built 2026-10-03 by `build_v5.py` (seed 5, deterministic; re-running gives the same sha). Plan: the router data plan (kept outside this repo), sections 2, 3 and 5.

`train.jsonl` **7942** rows · `valid.jsonl` **500** rows (v1's file, byte copy) · sha256 of train.jsonl `a37a742127dd6b9c`.

Every row has the v1 system prompt, byte-identical to `SYSTEM.txt` (copied from `model/training-data/`), the request as the user turn, and the bare category name as the answer. Rows are shuffled with the fixed seed.

Direction labels: **(higher is better)** or **(lower is better)**. Plain counts are marked *(descriptive)*.

## 1. Rows by block

| block | what it is | rows *(descriptive)* | refusals *(descriptive)* |
|---|---|---:|---:|
| v1 | v1 train rows kept as they are | 5303 | 626 |
| A | statement -> ask rewrites of v1 real requests (in place) | 689 | 0 |
| B2 | refusal rewrites into one-label openings (in place) | 150 | 150 |
| B1 | new real requests, loose openings | 550 | 0 |
| C-real | idiom pairs: real half | 247 | 0 |
| C-idiom | idiom pairs: idiom half (`none`) | 247 | 247 |
| P-bank | picked: Flight School bank headroom | 608 | 0 |
| P-sibling | picked: sibling-only messages | 148 | 0 |
| **total** | | **7942** | **1023** |

Against the plan: A is 689 of 690 (one rewrite failed the gate and its v1 original stays), B2 150 of 150, B1 550 of 550, C 247 of 250 pairs (pairs whose real half failed the stricter probe check were dropped whole), and 756 pool picks instead of 750 so the total still lands on 7942.

## 2. Refusal share and statement share

- Refusals: **1023 of 7942 = 12.88%**. Target band 12.5–13.5% (inside the band is the pass; v1 was 12.63%).
- Statement-form real requests (subject-led, not an ask; the plan's main problem): v1 **690 of 5366 = 12.9%** → v5 **5 of 6919 = 0.1%** (lower is better). Bench holdout is 1.3%.

## 3. Rows by category

Growth is pool-limited: files, health and decisions have the smallest clean pools, so they were taken first (up to a quarter of the picks), then each pick went to the smallest category that still had candidates.

| category | v1 train *(descriptive)* | v5 train *(descriptive)* | change *(descriptive)* | of which picked *(descriptive)* |
|---|---:|---:|---:|---:|
| `none` | 776 | 1023 | +247 (+32%) | 0 |
| `text` | 560 | 604 | +44 (+8%) | 0 |
| `dates` | 499 | 530 | +31 (+6%) | 0 |
| `math` | 431 | 467 | +36 (+8%) | 0 |
| `data` | 399 | 436 | +37 (+9%) | 0 |
| `encoding` | 339 | 371 | +32 (+9%) | 0 |
| `lists` | 239 | 336 | +97 (+41%) | 62 |
| `conversion` | 240 | 329 | +89 (+37%) | 47 |
| `validation` | 260 | 325 | +65 (+25%) | 35 |
| `writing` | 239 | 317 | +78 (+33%) | 46 |
| `statistics` | 220 | 300 | +80 (+36%) | 47 |
| `design` | 199 | 293 | +94 (+47%) | 61 |
| `finance` | 179 | 261 | +82 (+46%) | 48 |
| `generation` | 154 | 238 | +84 (+55%) | 52 |
| `developer` | 159 | 229 | +70 (+44%) | 39 |
| `learning` | 154 | 228 | +74 (+48%) | 44 |
| `organising` | 154 | 223 | +69 (+45%) | 41 |
| `games` | 129 | 221 | +92 (+71%) | 62 |
| `everyday` | 139 | 214 | +75 (+54%) | 35 |
| `reference` | 147 | 212 | +65 (+44%) | 31 |
| `health` | 129 | 206 | +77 (+60%) | 39 |
| `geometry` | 129 | 203 | +74 (+57%) | 35 |
| `decisions` | 139 | 190 | +51 (+37%) | 12 |
| `files` | 129 | 186 | +57 (+44%) | 20 |

Largest real category `text` 604, smallest `files` 186: ratio **3.25:1** (lower is better; must stay under 4). v1 was 4.34:1.

Pool picks by source *(descriptive)*: bank 608, sibling 148. Every pairs.json and card-example candidate is also a sibling (or bank) message, so it is counted there; of the picks, 91 are also in pairs.json and 57 are skill-card examples.
Priority categories, picked of clean candidates in the pool *(descriptive)*: files 20 of 21, health 39 of 40, decisions 12 of 12. They took every candidate that passed the filters and the gate, which is why their growth is capped by the pool, not by the picker.
Picks whose two-word opening is new for their skill: **479 of 756 = 63%** (higher is better).
Pool candidates skipped *(descriptive)*: length 4, statement form 87, web 15, gated 42 (by rule: strict-probe 6, v1-valid r2 1, v1-valid r3 30, v1-valid r4 5, v1-valid r5 1).

## 4. Opening / label balance

Frames are `frames.py` plus `balance_b.py`'s additions. Pass: no opening with at least 20 rows has more than 95% one label.

| opening | v1 real | v1 refusals | v1 max share one label (lower is better) | v5 real | v5 refusals | v5 max share one label (lower is better) |
|---|---:|---:|---:|---:|---:|---:|
| tell me about | 0 | 0 | – | 49 | 14 | 77.8% |
| show me | 11 | 0 | 100.0% | 64 | 14 | 82.1% |
| turn my/these/this X into | 28 | 2 | 93.3% | 94 | 9 | 91.3% |
| put my/these X on/in/into | 20 | 2 | 90.9% | 71 | 7 | 91.0% |
| plan (out)? | 3 | 2 | 60.0% | 31 | 4 | 88.6% |
| ... properly | 16 | 3 | 84.2% | 49 | 9 | 84.5% |
| X from these Y (noun-led, no verb) | 62 | 5 | 92.5% | 115 | 8 | 93.5% |
| help me | 10 | 14 | 58.3% | 54 | 18 | 75.0% |
| sort out | 2 | 1 | 66.7% | 35 | 6 | 85.4% |
| go through | 0 | 0 | – | 44 | 7 | 86.3% |
| can i get / could i get | 0 | 0 | – | 44 | 7 | 86.3% |
| i've got / i have | 9 | 3 | 75.0% | 36 | 11 | 76.6% |
| do/does/did i (self-check) | 36 | 0 | 100.0% **over** | 40 | 6 | 87.0% |
| as i go / as we go | 1 | 0 | 100.0% | 29 | 5 | 85.3% |
| can you | 221 | 0 | 100.0% **over** | 269 | 36 | 88.2% |
| give me | 37 | 15 | 71.2% | 101 | 18 | 84.9% |
| write | 25 | 23 | 52.1% | 46 | 5 | 90.2% |
| do the … thing | 0 | 0 | – | 31 | 5 | 86.1% |

Highest share among openings with at least 20 rows: **93.5%** (lower is better). Openings over 95%: **0** (lower is better).

## 5. Contamination gate (plan section 3)

Every non-v1 row (A, B1, B2, C, picks) was checked against: the 5 gate rules (vendored `sources/catrouter_gate.py`, byte copy of a Flight School gate script that is not in its public source) vs the 408 bench messages (308 holdout + 100 no-skill), vs grade + dev-labelled, vs both probe files in both directions (probe set as reference, and each row as reference with every probe checked), and vs v1 valid; the stricter check vs the 57 bench messages either router gets wrong; and the same stricter check vs the probes.

| reference | r1 | r2 | r3 | r4 | r5 |
|---|---:|---:|---:|---:|---:|
| bench-holdout | 0 | 0 | 0 | 0 | 0 |
| bench-noskill | 0 | 0 | 0 | 0 | 0 |
| grade/dev | 0 | 0 | 0 | 0 | 0 |
| probes | 0 | 0 | 0 | 0 | 0 |
| probes-rev | 0 | 0 | 0 | 0 | 0 |
| v1-valid | 0 | 0 | 0 | 0 | 0 |
| strict vs 57 failing bench messages | 0 | | | | |
| strict vs probes | 0 | | | | |

Hits in the final set: **0** (lower is better). v1 rows vs the bench and grade/dev: **0** (lower is better). Rows whose normalised key is also in v1 valid: **0** (lower is better). Duplicate normalised keys: **0** (lower is better).

Rows the gate removed while building *(descriptive)*:

- A `flatten this json to one level` — strict-probe ~ `squash this nested json down to one level`
- C-real `i need this spoiler scrambled with rot13` — strict-probe ~ `do the rot13 thing for this spoiler`
- C-real `my gpa from an a, a b+ and a c, each worth 3 credits` — strict-probe ~ `work out my gpa from these results: a 3 credits, b+ 4, c 3`
- C-real `what's the percent increase from 1.80 to 2.35` — strict-probe ~ `what's 18 percent of my 2,400 rent`
  - A `flatten this json to one level`: gate -> v1 original kept
  - C-idiom `my brain is scrambled after that exam`: pair partner gated
  - C-idiom `she finally got my gpa right even though the numbers were all over the place`: pair partner gated
  - C-idiom `i think the percentage increase in coffee prices is unfair to my wallet`: pair partner gated

## 6. Label fixes

Near-identical texts (any of the 5 gate rules, run across the whole set with an index, then verified with the real gate) with different labels were reviewed. Where the ask is the same, the label the bench or skill cards imply was applied to every row with that text, and each family was searched for further members.

| text | block | was | now | why |
|---|---|---|---|---|
| make this heading look like a book title | A | text | **writing** | same ask as v1 'make this look like a book title' (writing); bench 'capitalise this headline properly' -> writing |
| what time is it in tokyo | v1 | dates | **reference** | one named place's current time is timezoneLookup (card: 'current time in London', 'time in Tokyo'); currentTime is 'in your own time zone'; several places stay dates |
| what hour is it over in tokyo | A | dates | **reference** | one named place's current time is timezoneLookup (card: 'current time in London', 'time in Tokyo'); currentTime is 'in your own time zone'; several places stay dates |
| i need 45 minutes in seconds | v1 | dates | **conversion** | one plain unit to another is convertTime (card '90 minutes in seconds'); dates/parseDuration is kept for compound or shorthand durations (bench 'turn 2h 15m into seconds') |
| 45 minutes counted in seconds | v1 | dates | **conversion** | one plain unit to another is convertTime (card '90 minutes in seconds'); dates/parseDuration is kept for compound or shorthand durations (bench 'turn 2h 15m into seconds') |
| just pick for me, i cannot decide | A | games | **lists** | same ask as 'pick a restaurant for me, i cannot decide' (lists); picking one option is pickRandom, the magic eight ball answers yes/no questions |
| 4 tsp to tbsp | v1 | everyday | **conversion** | spoon-to-spoon with no ingredient is a plain volume conversion (card convertVolume '3 teaspoons in tablespoons'; bench 'how much is 6 tablespoons in millilitres' -> conversion) |
| how long is 45 minutes in seconds | v1 | dates | **conversion** | one plain unit to another is convertTime (card '90 minutes in seconds'); dates/parseDuration is kept for compound or shorthand durations (bench 'turn 2h 15m into seconds') |
| collapse the repeats in this stack | v1 | text | **lists** | same ask as v1 'collapse the repeats in this' (lists); bench 'strip the repeats out of this list' -> lists |
| clock hour in tokyo now | v1 | dates | **reference** | one named place's current time is timezoneLookup (card: 'current time in London', 'time in Tokyo'); currentTime is 'in your own time zone'; several places stay dates |
| convert 4 teaspoons to tablespoons | v1 | everyday | **conversion** | spoon-to-spoon with no ingredient is a plain volume conversion (card convertVolume '3 teaspoons in tablespoons'; bench 'how much is 6 tablespoons in millilitres' -> conversion) |
| 4 teaspoons as tablespoons | P-bank | everyday | **conversion** | spoon-to-spoon with no ingredient is a plain volume conversion (card convertVolume '3 teaspoons in tablespoons'; bench 'how much is 6 tablespoons in millilitres' -> conversion) |

Near pairs with different labels left as they are (reviewed: the asks differ by one word naming a different thing, for example `can you decode this binary for me` encoding vs `can you decode this jwt for me` developer): **31**. Unreviewed conflicts left: **0** (lower is better).

## 7. Sources

Everything the builder reads besides v1 is vendored in `sources/` so it runs from the repo alone:

- `catrouter_gate.py`: byte copy of a Flight School gate script that is not in its public source.
- `A-rewrites.jsonl`, `B2-refusal-rewrites.jsonl` (field `orig` = the v1 row replaced), `B1-loose.jsonl`, `C-pairs.jsonl`: the hand-written blocks.
- `pool-real.jsonl`: the clean candidate pools from `overlap.py` (bank paraphrases, sibling v1+v3+v4 messages, sibling-v4 pairs.json, skill-card examples), one row per normalised key, with skill and source attached; `web` marks webAnswer/webSearch rows, which are excluded.
- `skills.json`: skill → category (the `category:` field of each card in `skills/*.js`).
- `v1-skills.json`: v1 train text → skill (seeds and bank), used for 'opening new for that skill'.
- `bench-gate.json`: the 408 bench messages and the 57 failing ones. **Gate input only, never training.**

`probes/` holds the held-out sets (`v5-contrast-holdout.jsonl`, `v5-loose-probe.jsonl`, and `bench-router.jsonl`, the 408 bench messages for the router-only pass). They are evaluation only and are never read into train or valid.

