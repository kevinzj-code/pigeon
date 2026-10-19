# The planner adapter — the training set, and the plan

`§12`'s ledger has carried **Planner adapter — not built** since the beginning,
and it is now the measured ceiling. With the category adapter routing, the
prompted 2B answers **212 of 302** holdout questions. The router is not what is
holding that number down: every decline checked by hand had the wanted skill
ranked *first*. The planner is shown the right tool and picks another one, or
declines. That is a narrow, format-bound job — exactly what a LoRA is for.

This directory holds the training set for it. `scripts/plannerdata.mjs` builds
it; nothing here is written by hand except the decline list and the chain
patterns.

```bash
npm run plannerdata                # rebuild, using the lexical router
npm run plannerdata -- --dry       # count and sample, write nothing
npm run plannerdata -- --router category --category-base http://127.0.0.1:8101
```

## Where the labels come from

Pigeon already had a labelled planner set and nobody had noticed. Every skill
carries hand-written examples pairing *the text a person would type* with *the
input that text should produce* — 1,510 of them, each already executed by
`npm test` and compared against a stated output. The message is the example's
text, the plan is one step calling that skill with that input, and the shortlist
is whatever the real router returns for that text.

**Every row is executed before it is kept.** A row survives only if its plan
validates, runs, and reproduces the output the example claims. 21 rows were
dropped for failing that check. A training set that cannot run teaches plans
that do not work.

| | rows | |
|---|---|---|
| Single-step, from skill examples | 1,394 | executed and compared to the stated output |
| Chained, from patterns | 39 | generated, then executed — teaches `$s1.result / 10` |
| Declines (empty plan) | 224 | 13.5% of the set; §7.3 asks for ~15% |
| **Total** | **1,657** | train 1,361 · valid 147 · grade 149 |

Splits are by **message**, hashed, so no phrasing appears in two files.

## Four rules the generator enforces

1. **The prompt is the real prompt.** System and user turns come from
   `plannerSystem()` and `plannerUserMessage()` in `src/planner.js` — the same
   functions the app calls. `model/README.md` records that the category adapter
   is measurably worse when asked in any other form, so training and inference
   must not be able to drift.
2. **The shortlist is the real shortlist.** Cards come from the router, not from
   "the right skill plus distractors". A planner trained on a tidy list learns a
   task it will never be given.
3. **The bench is never trained on.** Every message in `scripts/holdout.mjs` and
   `scripts/no-skill-set.mjs` is excluded, normalised, and the exclusion is
   asserted: **0 leaks**. A number measured on training data is worth nothing.
4. **Declining is taught.** The base model refused 0 of 50 nonsense messages
   untrained. The runway makes the prompted planner *over*-commit — 22 of 50 —
   so the negative rows are the ones that keep the adapter from inheriting that.

The declines are reused from the category adapter's own `none` rows: ~800
hand-written messages, same project, same judgement about what has no skill.
Sampled deterministically to hit the §7.3 share rather than taken whole.

## Training it — on the GPU, through Flight School's MLX environment

**Do not use `train_category_lora.py` for this set.** It is CPU-only torch
(`torch.autocast("cpu")`), it took ~5 hours for the category set at a median of
97 tokens, and this set's rows are ten times longer. Measured with the real
tokenizer: median **1,031** tokens, max **2,019** after the row cap; roughly half the
training rows are over 1,024. On CPU that is well over a day.

Flight School — the sibling app — trains with **mlx-lm on
Apple Silicon**, and its Python environment can run the trainer headlessly on
this set with no conversion: the rows are already mlx-lm's native `messages`
format. Measured here, 40-iteration probe, M1 Pro 16 GB:

| | |
|---|---|
| Base | `mlx-community/Qwen2.5-1.5B-Instruct-4bit`, top 16 layers (mlx-lm's default), rank 16 |
| Sequence ceiling | 2,048 (`--max-seq-length`), `--mask-prompt`, `--grad-checkpoint` |
| Speed | **0.36 it/s — 2.7 s per row** |
| Peak memory | **4.16 GB** |
| Val loss | 1.70 → 0.29 in 40 iterations |

Two epochs (2,700 iterations) is therefore **~2.1 hours** of training plus about
15 minutes of validation passes. Stop the two `llama-server`s first — they hold
GPU memory, and Flight School itself refuses to train with a model loaded.

```bash
VENV="$HOME/Library/Application Support/mode.airoplane.flightschool/venv/bin/python"
HF_HOME="$HOME/Library/Application Support/mode.airoplane.flightschool/hf_cache" \
"$VENV" -m mlx_lm lora --model mlx-community/Qwen2.5-1.5B-Instruct-4bit --train \
  --data model/planner-data --iters 2700 --batch-size 1 --learning-rate 1e-5 \
  --max-seq-length 2048 --mask-prompt --grad-checkpoint --fine-tune-type lora \
  --steps-per-eval 100 --save-every 200 -c model/planner-data/lora_config.yaml \
  --adapter-path model/planner-adapter
```

`lora_config.yaml` is beside this file (rank 16, scale 20). Watch the val loss
line every 100 iterations and stop after three consecutive rises — Flight
School's early-stopping rule, learnt from a run whose train loss kept falling
while it overfit. Then `scripts/convert-planner-adapter.sh`: mlx adapter → PEFT → llama.cpp's
`convert_lora_to_gguf.py`, the path Flight School's `ADAPTERS.md` verified for
this exact base, borrowed rather than rewritten. It asserts the one thing that
would otherwise fail silently — PEFT's `lora_alpha` must equal mlx-lm's
`scale × rank`, 320 here — by reading it back out of the GGUF. Verified on the
40-iteration probe adapter before the real run. Output
`model/pigeon-planner.lora.gguf`.

### Why the base is Qwen2.5-1.5B and not the 2B the planner runs on today

The planner currently runs on Qwen3.5-2B, and it cannot be trained on this
machine: it is a hybrid GatedDeltaNet model, and Flight School's Phase A
measured **250 s per iteration** full-depth in MLX (26 s on four layers), with
~75% of its layers unconvertible to a GGUF LoRA anyway. So the adapter targets
Qwen2.5-1.5B — the base the category adapter already runs on — and adopting it
means the planner **switches base**. Phase A found the prompted 1.5B 12 points
behind the prompted 2B on a routing bench, so the adapter has that gap to close
before it counts. The prompted 1.5B's number on Pigeon's own bench is the first
thing to measure; it is the floor the adapter starts from.

If it wins, one 1.5B server can carry both adapters (`--lora` twice, selected
per request), and the 2B is retired: ~1.3 GB less resident, faster per call.

## Grading it

The set is built so this number means something — the bench messages are not in
it:

```bash
npm run bench:planner -- --router category --category-base http://127.0.0.1:8101 \
  --trained --min-confidence 0.80 --only llm+ex --runway-auto
```

Baselines to beat, same 302 holdout questions and 50 no-skill messages:

| | answered right | no-skill leaks |
|---|---|---|
| Plain prompt | 142 (47%) | 1 / 50 |
| Runway always on | 217 (72%) | 22 / 50 |
| Shipped — 2B, adapter-gated runway (before the card audit) | 212 (70%) | 4 / 50 |
| Shipped — same, after 124 vocabulary examples | 233 (77%) | 8 / 50 |
| Shipped — same, with the input audit | 194 answered + 41 honest asks = 235 (78%) | 8 / 50 |
| + an empty-input demonstration in the planner's shots | 239 (79%) | 8 / 50 |
| + a sibling check after every single-step plan (not shipped) | 237 — switched 17: 6 right, 8 broke a correct pick | 8 / 50 |
| **+ the decline second look (shipped)** | **200 answered + 48 honest asks = 248 (82%)** | **8 / 50** |
| Round 2: category adapter v2 (not shipped) | 236 (78%) — declined 8 more real questions | 9 / 50 |
| Round 2: sibling-discrimination adapter (not shipped) | 244 — switched 18: 4 right, 7 broke a correct pick | 8 / 50 |
| Round 2: both together | 233 | 9 / 50 |
| **Round 3: sibling adapter on Flight School's paraphrases** (not shipped, narrowly) | **252** — switched 12: 6 right, 1 broke a correct pick, 5 neutral | 8 / 50 |

The last row is the honest one. Of the 233, thirty-nine had been answered from
data the planner invented; the audit turns those into questions, the extractor
no longer refills a payload field with the request sentence, and the total
goes *up* — 235 — because three failures became asks too. "Answered right" as
a bare number was rewarding fabrication; it no longer can.
| Prompted 1.5B — the adapter's floor (measured) | 198 (66%) | **30 / 50** |
| **Round 1 adapter, final (iter 2,700)** | **162 (54%)** | **4 / 50** |
| Round 1 adapter, checkpoint 1,200 | 151 (50%) | 4 / 50 |

The floor says what the adapter's job is. The prompted 1.5B is only 14 answers
behind the 2B but it answers 30 of 50 nonsense messages — it is eager, not
weak. The training set's 224 empty plans are aimed at exactly that; the
category adapter on the same base went from 0 to 24-of-25 refusals on the
strength of its negatives.

## Round 1 — trained 2026-09-03, did not clear the gate

The first adapter is not shipped, and the reason is specific enough to be
useful. It did what the negatives were for: leaks fell from 30 to 4. But it
answered **162** against its own prompted base's 198, and the 116 wrong-skill
picks are overwhelmingly **sibling confusions** — `toMarkdownTable` for
`parseMarkdownTable`, `buildQueryString` for `parseQueryString`,
`convertLength` for `convertArea`, `compareSemver` for `parseSemver`. The
prompted model reads the card and picks; the adapter learnt the skill names
as tokens tied to phrasings and stopped reading. Train loss reached 0.009 by
iteration 2,000 while val hovered at 0.18–0.28: it memorised the set.

A second symptom, measured: on the same 352 messages, **40% of the adapter's
plans carry a number the message never contained** (115 of 286), against
26.5% for the prompted 2B (74 of 279) — so the shipped planner does this too,
less often, and the adapter made a pre-existing hole wider. It **invents
arguments** rather than omitting them — `formatJson({"text":"{\"a\":1}"})` for
"tidy this json", a made-up potato for "what should I cook". Every training row
has a complete input, so it learnt that plans always do. The bench's "asked for
a arg" count went to 0, which is the same fact from the other side.

What round 2 needs, in order of expected effect:

1. **Rows that omit an argument.** Take an example, strip the value from the
   message, drop the key from the input. The plan is still correct — the
   executor asks. Nothing in the set shows this today.
2. **Contrastive shortlists.** Put sibling skills in the same shortlist with
   the message clearly wanting one of them, both directions, and **shuffle
   card order** so position carries no signal.
3. **Phrasing variety.** One row per example gives five near-identical rows
   per skill; paraphrase (or borrow the category set's paraphrases) so a
   phrasing cannot be memorised.
4. **Stop earlier, regularise harder.** Best val was at iteration 1,500; the
   second epoch was worse on every measure. One epoch, dropout on.

Until then the shipped planner is the prompted 2B with the adapter-gated
runway, at 212 and 4 leaks.

The 26.5% figure was the more consequential number, because it was about the
model that ships. `fabrication.js` licenses every number in a step's input on
the stated assumption that "it either came from the user's message or from an
earlier result" — which was false whenever the planner filled an argument in.
An invented CSV became a computed, marked, licensed reply. `src/audit-input.js`
now makes the assumption true: before a step runs, a content payload (a CSV,
a JSON body, a table, a paragraph) must be findable in the message or an
earlier result, and a number is dropped when the message contains no quantity
at all. Anything dropped goes through the executor's existing path — Extractor,
then ASK_USER — so "read this csv into columns" is answered with "What CSV
should I read?" The rule is narrow on purpose: short strings, enum values,
defaults, refs and derived numbers are never touched, because "christmas" →
2026-12-25 and "double it" → 2 are correct. The bench reports an ask that
follows an audit drop as `asked, honest` and counts it as correct — it is.

## Round 2 — trained overnight 2026-09-04, neither adapter shipped

Two adapters, both on Qwen2.5-1.5B through Flight School's MLX environment,
both converted and benched against the shipped configuration as a control
(248 correct, 8 leaks). The full numbers and logs are in `model/round2/`.

**Category adapter, round 2** (+276 hard negatives in the style of the eight
leak idioms, +44 paraphrases and 22 new seeds for the 11 misfiled skills;
6,491 rows, `none` 15.2%, gate-checked): 236 correct, 9 leaks; dev-set
accuracy 91.8% against the shipped adapter's 92.3%, refusals identical at
21/25. The extra negatives did not move the leaks at all. What they moved was
the adapter's willingness to name a category on *real* questions — declines
46 → 54 — and every refused real question loses the runway. Doubling the
negatives taught caution where the bench wanted discrimination.

**Sibling-discrimination adapter** (3,234 rows from the skills' own examples,
keep/switch balanced, draft position randomised, no card carrying the
message's own example, gate-checked): validation loss 0.015 on its own held-out
rows, and on the holdout it switched 18 times — 4 right, 7 breaking a correct
pick — and kept the wrong draft 14 times with the right card offered. That is
the prompted 2B's result again, from a model that had "learnt" the task.

The reason is visible in the switches it made: "epoch value for 2027-01-01"
went to `unixToIso`, "-.-. --.- in letters" went to `morseEncode`. It learnt to
match the message's *words* against the cards' example text — which is what
the training rows reward, because they are built from the skills' own examples
and share their vocabulary — and the holdout is paraphrased precisely so that
word-matching fails. A model trained on in-vocabulary rows cannot be expected
to discriminate out-of-vocabulary ones.

**What round 3 would use instead**, and it already exists: Flight School's
category banks hold ~5,000 paraphrases labelled *by skill*, written in six
kinds of which one shares no content word with its seed, all bench-gated. Build
the sibling rows from those instead of from the examples, and the adapter
trains on the distribution it is graded on. Until then the shipped pipeline is
unchanged, and the 36 sibling confusions remain the ceiling.

RESOLVED 2026-09-08, and it was never drift. The shipped adapter scores 21/25
on `dev-labelled.jsonl` UNGATED and 24/25 on `grade.jsonl` GATED at 0.80 — both
reproduce exactly, and they are different sets with zero overlap. Flight
School's eval script applies no confidence gate, so it measures something the
app never does; on the app's own configuration the same weights refuse 25/25 of
the dev set. Nothing about the adapter changed.

## Round 3 — the sibling adapter on paraphrases (2026-09-04): +4, not shipped

Same task, same generator, one change: the messages came from Flight School's
skill-labelled paraphrase banks (5,616 rows in six kinds, 2,084 of them
"indirect" — sharing no content word with their seed) alongside the 1,637 skill
examples. 14,020 rows from 7,009 messages, one epoch, three hours.

| | correct | switched | right | broke a correct pick | neutral | leaks |
|---|---:|---:|---:|---:|---:|---:|
| control (shipped) | 248 | — | | | | 8 |
| round 2 (examples only) | 244 | 18 | 4 | 7 | 6 | 8 |
| **round 3 (paraphrases)** | **252** | 12 | **6** | **1** | 5 | 8 |

The data change did what it was meant to: the adapter stopped breaking correct
picks (7 → 1) and its switches went right twice as often. Kept-wrong-with-the-
right-card-offered fell only 14 → 12, so the hard pairs stay hard.

**Why it is not shipped.** The rule set before training was a net of at least
+8 (twice the bench's noise band); this is +5, and with only 12 switches the
most any gate could reach is +6. Gating on agreement with the router's lexical
pick keeps 4 right and 0 wrong (+4, no harm) — a shippable shape if a smaller,
safe gain is ever preferred to the rule. Cost is ~0.3 s on nearly every turn.

**What would push it over.** The 12 kept-wrong cases are the ceiling, and they
are the same pairs every round: `parseMarkdownTable`/`toMarkdownTable`,
`applyDiscount`/`stackDiscounts`, `convertCase`/`checkTitleCase`. Those need
*contrastive* rows — the same message shown against exactly that sibling, both
directions — which the banks do not contain and which would have to be written.

**Success is beating 248 correct (answered + honest asks) without going past ~8 leaks** (the leak count has moved 4 → 8 → 8 across runs that only changed examples; treat ±4 as noise). The runway number shows
answering more is easy if refusing matters less; the adapter has to do both. A
trained planner should also make `runway: 'auto'` unnecessary — the reason the
runway exists is that a prompted model cannot reason when its first token must
be the answer, and a fine-tune moves that behaviour into the weights.

## Known gaps in this set

- **Chained plans are 2.3% of it.** 39 rows from 4 patterns, all arithmetic. Refs
  are the planner's weakest area and the least represented; more patterns —
  convert-then-round, look-up-then-expand — would be the highest-value
  hand-written addition.
- **Single-step dominates at 84%.** That matches production, but a set this
  lopsided may teach "always one step".
- **`about` is derived from the skill's description**, not written per row. It
  is honest and consistent, but a model trained on it may learn to recite the
  card rather than orient. Worth checking the first thing after training: if
  `about` comes back as a description, the field has become filler again — the
  failure `planner.js` already records once.
- **The row cap is a character proxy.** `--max-row-chars 7000` (≈2,048 tokens
  at 3.4 chars/token) dropped ~70 rows, of which only 3 actually exceeded 2,048
  tokens by the real tokenizer. A tokenizer-aware filter would recover ~4% of
  the set; the trade taken here is a generator with no Python dependency.
- **One row per example phrasing.** The set inherits whatever phrasing variety
  the examples have; skills with five near-identical examples contribute five
  near-identical rows.
