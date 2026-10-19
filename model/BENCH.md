# Bench results

Every planner-bench run that was recorded, grouped by the host that ran it.
`scripts/benchqueue.mjs --report --write` regenerates everything below the
marker; edit above it only.

**Read within a host.** Metal (Mac) and Vulkan (Linux) do not produce the same
logits, so a job is compared to the most recent `control` on its own host. The
noise band between identical runs is about ±4 correct and ±2 leaks on 50.

Historic rows, hand-recorded before this table existed (Mac, Metal, shipped
flags `--router category --trained --min-confidence 0.80 --only llm+ex
--runway-auto --second-look`):

| date | HEAD | correct | leaks | siblings | ms | what changed |
|---|---|---|---|---|---|---|
| 2026-09-03 | — | 142/302 | 1/50 | — | — | plain prompt |
| 2026-09-03 | — | 212/302 | 4/50 | — | — | runway on the adapter's say-so |
| 2026-09-03 | — | 233/302 | 8/50 | — | — | 124 vocabulary examples |
| 2026-09-03 | — | 235/302 | 8/50 | — | — | input audit (39 fabricated answers → honest asks) |
| 2026-09-04 | — | 239/302 | 8/50 | — | — | empty-input shot |
| 2026-09-04 | f857bcd | 248/302 | 8/50 | 37 | 1986 | decline second look (shipped) |
| 2026-09-07 | 1eb5498 | 261/308 | 6/50 | 32 | 2125 | merge of main: 56 contrasting descriptions, 4 skills, holdout 308 |
| 2026-09-08 | d50f52f | 263/308 | 20/100 | 32 (17 same-category) | 1943 | bench widened to 100 no-skill; web skills scored right with the web off (recorded as ee1aa77 dirty: the tree had these changes uncommitted) |
| 2026-09-08 | 959566e | 272/308 | 20/100 | 32 (17 same-category) | 1899 | workstream 1: enum coercion, hex colours not quantities, request sentence not a payload, empty lists absent, radius from diameter. Bare answers 211→176, honest asks 50→94: 38 turns where the planner had fed the question itself to a text skill were counted as answers before |
| 2026-09-08 | f45f7c5 | 289/308 | 22/100 | 13 (12 same-category) | 1940 | workstream 3a: 54 contrasting descriptions across the 23 sibling pairs main never rewrote. Wrong-skill 32 → 13; router recall@5 on the grading half 85.1% → 87.8%. Leaks 20 → 22 is inside the ±2 band |
| 2026-09-08 | eea90b7 | 292/308 | 20/100 | 10 | 1866 | card lint (src/lint-cards.js) over all 46,971 pairs: 38 confusable pairs found, 35 rewritten, 3 left. The first pass scored 283 by handing each skill's own words to its twin; restoring them gave 292 |
| 2026-09-08 | e28754b | 292/308 | 20/100 | 10 | 1891 | end of day, confirming run: the plan view became a conversation, the question bubble says what it understood, skill names read as names. No outcome moved, which is the point — every one of those is a rendering change |
| 2026-09-08 | (category v3, not shipped) | 279/308 | 23/100 | 17 | 1817 | category adapter v3: v1 negative depth + 40 rows targeted at the measured idiom leaks. Worse on both counts. Confidence collapsed — 89.8% ungated but 73.2% at a 0.70 bar, against v1's 93.0% — so the classifier is right nearly as often and no longer sure of it. Benched at v3's own best bar (0.50) |
| 2026-09-08 | (ground check, not shipped) | 283/308 | 14/100 | 14 | 2209 | suppress a single-step plan carrying nothing from the message when the adapter is under full confidence. Stopped 6 leaks, cost 9 correct — all of them "work on the thing I named but have not pasted". Rule was "fewer than 2". Flag `--ground-check`, off |
| 2026-10-02 | cf23895 (control) | 289/308 | 21/100 | 13 | 1872 | same-day control before the base move: Qwen2.5 v1 adapter, unchanged |
| 2026-10-02 | (Qwen3-VL, v1 rows, last step, not shipped) | 282/308 | 24/100 | 13 | 1847 | category server moved to Qwen3-VL-2B, v1 rows retrained, final step shipped. Seed 1: 285/23. At a 0.70 bar: 284/26 — not a bar problem |
| 2026-10-03 | (Qwen3-VL, v1 rows, dev-picked step, not shipped) | 286/308 | 18/100 | 14 | 1873 | the step v1's own trainer would have kept (best on dev-labelled) |
| 2026-10-03 | (Qwen3-VL, v5 rows, seed 0) | 290/308 | 18/100 | 11 | 1863 | training-data-v5: statements rewritten as asks, openings rebalanced, 247 idiom/real pairs. Refusals held at 12.9% |
| 2026-10-03 | Qwen3-VL, v5 rows, seed 1 (shipped) | 292/308 | 18/100 | 11 | 1873 | the replicate; dev-picked step 2,400 |

Measured and not shipped, same period: trust-router 121; category adapter v2
236 / 9 leaks; sibling adapter v1 244 (4 right / 7 broke); sibling adapter v3
252 (6 right / 1 broke), +4 with zero harm when gated on lexical-top agreement.

## The Linux crash, and what fixed it — resolved 2026-09-08

Batch 1 first died on `linux-x64-310371`: the `control` job crashed
three times identically, V8 `Runtime_GrowArrayElements` at ~124 s. It was
isolated here to one stage — `--runway-auto` alone crashed, `--second-look`
alone finished clean at 88/130 — and fixed on the Mac in 58f8252 as
`lzwDecompress` trusting the four-byte length header at the front of its own
input. A planner-invented "compressed blob" whose header spells four billion
ran the decode loop four billion times, because the bit reader returns zeros
past the end of the stream and code 0 is always in the dictionary.

The runway is what made the difference: it makes the planner willing to invent
that blob, and the Vulkan model writes a different blob from the Metal one, so
only this host reached the loop. Verified here after the fix — the same run
that crashed three times completed 130/130 under the same 384 MB heap cap that
had forced the OOM.

Two harness notes for whoever runs this next:

- **A failed result still counts as done.** The done-check asks only whether the
  host has a result file, not whether it succeeded, so the crashed `control`
  record silently skipped the baseline until it was deleted. `--again` or
  removing the file is the workaround.
- **`--report` cannot run with a non-directory inside `bench/results/`.** The
  host enumeration scans every entry as a host directory, and the launch command
  in the skill writes `run.out` there. The log now lives at `bench/run.out` and
  is git-ignored.

<!-- generated below -->

### darwin-arm64-aa4fb6 — control 263/308 · 20/100 leaks · 17 siblings · 1943 ms (2026-09-08, ee1aa77 dirty)

| job | correct | Δ | leaks | Δ | siblings | declined | ms | verdict | hypothesis |
|---|---|---|---|---|---|---|---|---|---|
| control | 263/308 | +0 | 20/100 | +0 | 17 | 84 | 1943 | control | baseline for batch 1 on this host |
| ws1-argument-shapes | 272/308 | +9 | 20/100 | +0 | 17 | 84 | 1899 | KEEP | the eight failures and three asks are argument-shape errors fixable in JS: enum coercion, hex colours are not quantities, the request sentence is not the payload, empty lists are absent, untraceable fields stay empty, radius from diameter |

### linux-x64-310371 — control 274/308 · 15/100 leaks · 12 siblings · 1698 ms (2026-09-08, 58f8252)

| job | correct | Δ | leaks | Δ | siblings | declined | ms | verdict | hypothesis |
|---|---|---|---|---|---|---|---|---|---|
| commit | 246/308 | -28 | 10/100 | -5 | 18 | 112 | 1862 | DROP | rule 2 'a correct and common answer' invites declines; the commit prompt was never measured with runway-auto, second look and the audit |
| control | 274/308 | +0 | 15/100 | +0 | 12 | 90 | 1698 | control | baseline for batch 1 on this host |
| decline-shot | 272/308 | -2 | 15/100 | +0 | 12 | 93 | 1703 | DROP | the four remaining declines are 'work on the thing I have not pasted'; one decline-check shot of that shape |
| k12 | 264/308 | -10 | 15/100 | +0 | 16 | 92 | 1635 | DROP | 20 cards is a round-1 default never re-swept with the adapter in front; fewer siblings in view, shorter prompt |
| lean-shots | 267/308 | -7 | 11/100 | -4 | 12 | 100 | 1949 | DROP | the web shot and the chain shot earn nothing on 300 of 308 turns; ~350 fewer prompt tokens a call |
| message-first | 238/308 | -36 | 14/100 | -1 | 32 | 95 | 1703 | DROP | a 2B reads left to right; today it reads twenty cards before it learns the question |
| no-example-cards | 235/308 | -39 | 14/100 | -1 | 15 | 96 | 1360 | DROP | the planner word-matches the message against the card's e.g. line and picks a sibling on vocabulary |
| ranked | 262/308 | -12 | 12/100 | -3 | 17 | 96 | 1971 | DROP | 'best match first' measured 159 alone before runway-auto existed; never with the current stack |
| runway-verb | 268/308 | -6 | 15/100 | +0 | 16 | 90 | 2014 | DROP | an action-led runway phrase steers the commit along the sibling axis (parse/render, encode/decode) where a topic noun does not |
