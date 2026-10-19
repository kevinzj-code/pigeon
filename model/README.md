# The category adapter

A LoRA fine-tune of `Qwen3-VL-2B-Instruct` that reads a request and names the
**category of tools** that can serve it — or `none`. It never picks the tool and
never answers the question. One word out, and it is allowed to refuse.

## Why it exists

Pigeon's router matched requests to skills by shared words. That works when you
happen to use the skill author's vocabulary and fails completely when you don't.
These are real measured failures, and note they did not score *badly* — the right
skill scored **zero** and never appeared at all:

| Someone typed | The skill's examples all say |
|---|---|
| "squash this text down" | compress |
| "shade #FFAA00 down 30 percent" | darken |
| "b64 this string for me" | base64 encode |
| "need a fresh guid" | generate a uuid |

No threshold reaches those, because a threshold cannot promote something that was
never ranked. That is what this adapter is for.

## What it measures

On 145 phrasings held out of **both** training and threshold tuning (all at the
0.80 bar):

| | Qwen3-VL-2B, v5 (shipped 2026-10-03) | Qwen2.5-1.5B, v1 (before) | Target |
|---|---|---|---|
| Category accuracy (higher is better) | **90%** (130/145) | 88% (127/145) | 80% |
| Refuses nonsense (higher is better) | 22 of 25 | **24 of 25** | ≥90% |
| Time per request (lower is better) | 68 ms | 64 ms | <500 ms |

On Pigeon's full bench (308 questions, 100 no-skill messages, shipped flags) the
v5 adapter scores **292/308 correct and 18/100 leaks**, against v1's 289 and 21
measured the same day; its seed-0 twin scored 290 and 18. See
"The move to Qwen3-VL-2B" below.

It refuses below **0.80 confidence** and hands back to word matching when it does.
The trade is deliberate: ungated it scores 92% accuracy but refuses only 17 of 25,
and a wrong category is worse than none — it hands the planner twenty tools that
matched nothing. The bar was fitted on the tuning half and never on the grading
half, which is why the numbers above are worth quoting.

Untrained, the same base model refused **0 of 50** nonsense messages. The negative
examples in the training data are what fixed that, and they are the most valuable
part of the set.

**More of them do not help, twice measured.** v2 raised refusals to 16.1% and
scored 236/302 against v1's 248. On 2026-09-10 v4 tried again with negatives
mined to be exactly the sentences v3 gets wrong — 226 of them, 16.0% — and
scored 269/308 against v3's 291, for one leak. It refuses 74 of 308 real
questions where v3 refuses 25. Raising the refusal share teaches refusing, not
discrimination, however the extra rows are chosen. The corpus and the mining
script are kept in `model/negatives` so the next attempt starts from this
rather than from the idea.

The leak it was aimed at is not here anyway: asked one message at a time, v3
refuses 12 of the 21 leaking bench messages and 91 of the 100 no-skill ones.
They leak downstream, in the router's lexical fallback, and `FALLBACK_FLOOR`
in `src/category-router.js` is what addresses it.

## Using it

The app loads it through llama.cpp:

```bash
llama-server -m Qwen3VL-2B-Instruct-Q4_K_M.gguf \
  --lora pigeon-category.lora.gguf \
  --port 8101 --host 127.0.0.1 -ngl 99 -c 8192
```

`npm run models` does this for you. It uses the copy committed here in
`model/`, or wherever `PIGEON_CATEGORY_LORA` points.

The app works without it — the router falls back to word matching and the rail
says so. It is an improvement, not a dependency.

## Rebuilding it

`train_category_lora.py` and `training-data/` are everything needed. About five
hours on 16 CPU threads, no GPU:

```bash
python train_category_lora.py \
  --train training-data/train.jsonl \
  --valid training-data/valid.jsonl \
  --dev   training-data/dev-labelled.jsonl \
  --eval-every 288 --epochs 3 --batch 8 \
  --lr 2e-4 --rank 16 --threads 16 --amp \
  --out ./adapter
```

Then convert with llama.cpp's `convert_lora_to_gguf.py`.

Two details that mattered more than expected:

- **`--amp` keeps fp32 weights and computes in bf16.** Pure bf16 was slightly
  faster but AdamW updates 18.5M parameters, and small updates vanish into an
  8-bit mantissa. The autocast version was *both* faster and numerically safer.
- **Accuracy is checked by generating the answer**, not by watching the loss, and
  the adapter is written only when it improves. Loss can fall while the model
  still emits a plausible wrong category, and the emitted answer is what ships.

## What is here, and what is not

| | |
|---|---|
| `pigeon-category.lora.gguf` | the adapter, as the app loads it |
| `train_category_lora.py` | the trainer |
| `training-data/train.jsonl` | 6,142 rows, 12.6% of them refusals |
| `training-data/valid.jsonl` | 500 held-out rows |
| `training-data/dev-labelled.jsonl` | the tuning half — used to pick the checkpoint and the confidence bar |
| `training-data/grade.jsonl` | the grading half — used only to produce the numbers above |
| `training-data/SYSTEM.txt` | the system prompt, byte-identical on every training row |

**Not here:** the PEFT output (`adapter_model.safetensors`, 70 MB). Git keeps
every version of a binary forever, and it is recoverable by rerunning the trainer.

## Two honest caveats

**The grading set was checked against the training set** — 0 exact matches and 1
borderline near-copy out of 170, comparing words with numbers wildcarded rather
than by string equality. Contamination does not announce itself; it just makes
things look good. An earlier version of this project was caught by it once.

**It has no `web` category.** It was trained on the 23 categories of offline
skills, and the refusal rows taught it that general-knowledge questions are
`none` — which was correct when nothing could look anything up. It now splits
roughly 54/45 between `reference` and `none` on questions like "who is the
governor of Virginia" and so never clears its own confidence bar. The web skills
are filed under `reference` so they are reachable anyway, and a second pass
covers the rest. A 24th category is the real fix.

## The move to Qwen3-VL-2B (2026-10-03)

Every Pigeon now trains on one base, Qwen3-VL-2B-Instruct, so the category
server moved with them. Retraining v1's 6,142 rows on the new base tied on the
145-question exam and **lost on the bench** (282/308, 24 leaks). Two things
fixed it, each measured:

- **Keep the best step, not the last.** v1's trainer kept the step with the best
  generated accuracy on `dev-labelled.jsonl`; the first retrain shipped the final
  step. Picking on dev alone: 286/308, 18 leaks.
- **Vary the wording (`training-data-v5/`).** 12.9% of v1's real requests were
  statements ("the link in my email goes nowhere"), the same shape as an idiom,
  and "can you…" was never a refusal. v5 rewrites those 690 rows as asks,
  rebalances the openings, adds 550 loosely worded requests and 247 idiom/real
  pairs that share a key word. Refusals stay at 12.9% — more of them has lost
  twice. 292/308, 18 leaks (seed 1); 290, 18 (seed 0).

Recipe (mlx-lm, Qwen3-VL-2B bf16): rank 16, scale 20, all layers, batch 8,
3 passes (2,979 steps), lr 2e-5, mask-prompt, then the dev-picked checkpoint
(step 2,400). `training-data-v5/report.md` has the data, `probes/` the held-out
checks written before any training row.
