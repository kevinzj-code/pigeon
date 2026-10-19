# pigeon-engine: notes

What this engine does is in `INTERFACE.md` (the engine's interface spec, kept
outside this repo; its §2 is pinned in `pigeon-ffi/tests/interface-section-2.h`) and the
crate's own doc comments. This file is what a host or the next developer needs
to know that is not obvious from either. Numbers are from an M1 Pro with 16 GB,
Qwen3-VL 2B Q4_K_M and its Q8_0 projector, llama.cpp 26394b4.

## Known limits

- **A cancel during a long prompt waits for that prompt's decode.** A prompt is
  decoded in one llama.cpp step, and a step cannot be interrupted on Metal
  (llama.cpp's abort callback works on the CPU only). Measured: a cancel sent
  during Pat's prompt (its section and question) stopped the answer 27 ms later,
  when that decode ended. During generation a cancel stops within one token
  (7 ms). Not worth working around.
- **A host must call `Engine::shutdown()` (or drop the engine) before its
  process exits.** Metal asserts at exit when GPU memory is still held, and the
  process ends with a crash report. `shutdown` waits for every context's thread.
  `tests/rides.rs` proves a loaded engine with four contexts exits cleanly, with
  a leaked one as the control that must crash.
- **ImageIO aborts the process when asked for a picture from bytes it could
  not read.** `apple::Image::decode` checks the source first; keep that check.
- **A projector carried only inside a Pigeon cannot be loaded** (llama.cpp's
  projector loader needs a file path). It is refused as `no_projector` with
  `"carried": true` (E14); the host installs it first.
- **The first Metal start compiles llama.cpp's shaders in the background,
  and the first ask does not wait for the slow one.** With the shader cache
  cleared (`$(getconf DARWIN_USER_CACHE_DIR)/com.apple.metal`), the log says
  `compiled 'fa' library in 21.917 sec` (flash attention), `mul_mm` 1.6 s,
  `mul_mv` 1.2 s, the rest under a second; macOS keeps the results in that
  per-user cache keyed by the library, once per Mac per llama.cpp build. But
  measured through `pigeon-serve` on 2026-10-16, a first Patch turn of three
  asks (router, asks check, planner) was **10.5 to 10.7 s with the cache
  cleared, 9.8 s warm**: the 22 s is not on the path a person waits on. The
  first turn's cost is the base load, the Pigeon checks and loads, a lane's
  cache, and the planner's prefill.
- **A precompiled Metal library was built, proved and not taken (2026-10-16).**
  With the Metal toolchain installed (`xcodebuild -downloadComponent
  MetalToolchain`, Xcode 27 ships without it) and `GGML_METAL_EMBED_LIBRARY=OFF`
  (llama-cpp-sys-2's build.rs forwards any `GGML_*` variable to CMake), the
  build compiles `default.metallib` (14.2 MB) and `ggml-tensor.metallib`
  (1.8 MB, the macOS 26 tensor API, which this M1 Pro does not use); ggml
  looks for them in the app bundle's Resources, then beside the executable
  (`ggml_metal_find_metallib`), and loads them in 2 ms. The planner bench on
  the compiled kernels is the record exactly, 294 of 308 and 2 of 100, all
  408 outcomes the same
  (`bench/results/prefix-6144-2026-10-15/planner-precompiled-metallib.json`).
  And the first turn was **9.9 to 10.4 s**, within a second of the embedded
  build's cold 10.5 to 10.7. The setting cannot be shared with the test and
  `pigeon-serve` builds without rebuilding llama.cpp at every switch (the
  library target is in CMake's ALL, so an embedded-off build needs the
  toolchain on every machine that builds), so the app would need its own
  target directory, and the repo 16 MB of binaries. Not worth under a second;
  the recipe is here if a future llama.cpp makes the first ask wait.

## The test suite's known failures

`npm test` reports **0 failed** since the v10 seal (2026-10-14). Any failure is new.

- **Cleared by the v10 seal:** "needs is not the list of Pigeons this build
  asks" (the second look retired, `needs` 10).
- **Cleared by the v9 seal:** formatNumber's second example and the phone
  trunk-prefix fix.
- **Before that change, and in any checkout still on v8 as sealed:**
  `formatNumber example[1] "write 1234567 in compact form"` got "1.2M" and wanted
  "1.2m". A compact number of 1,000 or more takes its suffix from the engine's
  ICU. JavaScriptCore, which the app runs, gives 1.2m / 1.5k / 2.5bn; Node 23 (ICU
  77) gives 1.2M / 1.5K / 2.5B. The example is now 950 → "950", which is the same
  in both. Planner cards show only a skill's first example, so no planner input
  changed.

## Every model the Pigeon app asks is a Pigeon

Since 2026-10-07 the app starts no llama-server. Patch's router, his planner's
asks, the transcript tidier, the OCR clean-up, Pen and Peek are Pigeons in
Patch's nest (`patch.nest`, spec D84), loaded from it by member; imported
Pigeons and voices are asked from the file the app kept for each. One thing
that ran before does not now: a voice dropped into the adapters folder by hand,
with no `.pigeon`, cannot be asked (Socratic Tutor and Plain English Explainer
on the development Mac until Flight School packs them).

**Patch's nest holds Flight School's sealed Pigeons** (2026-10-08). The
fourteen test packings were replaced by the real files (`patch-pigeons/`,
every one sealed by `5bce0d9361532748`, the key `keys/seal-keys.json` ships),
and `scripts/pack-patch.mjs` refuses a member that is unsealed or sealed by a
key not on that list; `release-check` says the same of a nest built another
way. Everything the engine runs in them is byte-identical to the test packings
(adapter, system prompt, shots parsed equal); only the name, card, examples
and `prompt_check` differ. Ridden through the engine against the test
packings, which matched the old llama-server on the same rows: the router
408/408 labels with confidence identical, the tidier 120/120 byte-identical.

**Qwen3.5 2B's chat template turns thinking off unless `enable_thinking` is
passed as true.** llama-server passed true by default, so the app's planner
asks ran with thinking on; the engine passes nothing, so they run with it off.
On the app-shape planner bench that moved Patch from 296 to 289 of 308 right
(higher is better), 18 of 100 leaks either way: the asks check now works and
stops 10 leaks, and 10 others get through. The engine's answers match a
thinking-off llama-server on all 408 rows, with the planner's grammar built
from its schema (D88) and the asks check constrained.

**The asks check earns its place with thinking off** (2026-10-07, app-shape
planner bench through the engine, the router and second look on):

| | Right of 308 (higher is better) | Leaks of 100 (lower is better) |
|---|---|---|
| Thinking off, asks check on | 289 | 18 |
| Thinking off, asks check off | 291 | 66 |
| Thinking on, asks check inert (the app before) | 296 | 18 |

Thinking off, the planner commits to a plan for most messages that ask for
nothing, and the asks check stops 48 of those for 2 right answers. The 7
answers below the old app are thinking's, not the check's. Kept.

## Memory

`info()`'s `bytes_in_memory` is weights plus what llama.cpp reported allocating
for each context and projector (its cache and working buffers). llama.cpp has
no C call that returns those sizes, so `llama.rs` reads them from llama.cpp's
own log as each is made. `memory_limit_bytes` is judged against the same figure.

| | Allocated (`info`) | Measured |
|---|---|---|
| One context, 4096 cells | 773 MiB (cache 448 + buffers 325) | +470 MB resident |
| One context, 8192 cells | 1,225 MiB (cache 896 + buffers 329) | +920 MB resident |
| Qwen3-VL 2B Q4_K_M weights | 1,056 MiB | mapped from the file; shared with any other process mapping it |
| Its Q8_0 projector | ~770 MiB (weights 424 + buffers 347) | copied in |

Two processes holding the same base (the engine and a llama-server) share its
weights' pages: the engine beside the category server costs about 1 GB less
than the engine alone.

**Before the server went (2026-10-06): the picture on a 16 GB Mac with the switch on, as the Pigeon app set it**
(`parallel` 2, `context_tokens` 8192, `max_bases_loaded` 2): each context is
1,225 MiB allocated, so two are about 2.4 GB beyond the weights, while the
category server keeps its own copy of the base and its own 8192-token context
(+2.3 GB measured alone). Measured with one engine context of 4096 tokens
beside the server: +1.2 GB for text Pigeons, +2.4 GB once a picture Pigeon has
loaded its projector; an 8192-token context adds about 0.45 GB more resident
(measured: 705 → 1,153 MB). That is why the switch did not default on at
16 GB then; with the server gone the engine is the only copy.

**Measured 2026-10-07 with the app's settings** (two contexts of 8192 cells,
two bases, idle unload 60 s here), system memory used as a change from nothing
loaded, and the processes' own footprint beside it. Lower is better.

| | Engine | Footprint | The old servers | Footprint |
|---|---|---|---|---|
| Awake, nothing asked | +0.1 GB | 0.12 GB | +4.1 GB | 1.2 GB |
| After a Patch turn (router, asks, planner) | +5.7 GB | 2.3 GB | +4.1 GB | 1.2 GB |
| After a picture (Peek) | +6.4 GB | 2.8 GB | +7.3 GB | 2.5 GB |
| After the idle unload / sleep | +0.3 GB | 0.13 GB | +0.4 GB | 0 |

Two things to know. **The idle unload frees a base's contexts only once their
lane has gone idle**, which can take a tick or two after `info()` already shows
no bases: measure 100 s after a 60 s period, not 70 s. **A base costs about
0.45 GB more in the engine than in llama-server 961e4b2** (router base alone:
footprint 1,416 MB against 984 MB; planner base 725 MB against 235 MB), with
the same 896 MiB cache reported by both. It is not `n_batch` (2048 gives the
same), not flash attention (on by default in both) and not a cleared cache
(the lane contexts are never zeroed), and `GGML_METAL_NO_RESIDENCY` is not
a switch this build reads (setting it changed nothing). Found and left
untraced, by decision (2026-10-07): most likely llama.cpp's own allocation in
26394b4 against the older build, and E10 already ties every figure to an
engine build.

## Unsafe code

Two modules only: `llama.rs` (llama.cpp) and `apple.rs` (CoreGraphics and
ImageIO, for frame pictures). The crate denies unsafe code everywhere else.
Each public entry point of both has a test.

## The planner's base: measured before moving

Before Patch's planner asks became Pigeons, the plan was to put them on
Qwen3-VL 2B so every Pigeon in the app shares one base. The app-shape planner
bench said no (2026-10-06, `scripts/plannerbench.mjs --pigeon pack/patch.pigeon
--router category --trained --only llm+ex --runway-auto --second-look --asks`,
308 holdout questions and 100 no-skill messages, Patch v5's prompts, thinking
off for every ask, llama-server 961e4b2):

| Planner base | Right of 308, incl. honest asks (higher is better) | Answered outright | Wrong skill | Skill failed | Declined | Leaks of 100 (lower is better) |
|---|---|---|---|---|---|---|
| Qwen3.5 2B Q4_K_M | 289 | 179 | 12 | 3 | 86 | 18 |
| Qwen3-VL 2B Q4_K_M, run 1 | 213 | 132 | 26 | 16 | 148 | 5 |
| Qwen3-VL 2B Q4_K_M, run 2 | 213 | 132 | 26 | 16 | 148 | 5 |

The two Qwen3-VL runs agree on all 408 rows: greedy, thinking off, one
request at a time, the bench does not move between runs. So 76 fewer right is
the base, not noise. Its fewer leaks come from declining far more, real
questions included. The planner Pigeons stay on Qwen3.5 2B until a re-tuned
or trained planner on Qwen3-VL 2B reaches 287 right and 18 leaks or better.

**Flight School's trained planner on Qwen3-VL 2B** (2026-10-08, the same bench through the engine: `plannerbench --pigeon pack/patch.pigeon --router category --trained --only llm+ex --runway-auto --second-look --asks --engine <pigeon-serve> --planner-pigeon patch-planner-trained`, one trained Pigeon standing in for the four prompted planners, every other Pigeon the same test copies as the baseline):

| Planner | Right of 308 (higher is better) | Answered outright | Honest asks | Wrong skill | Skill failed | Declined | Asked for an argument | Leaks of 100 (lower is better) |
|---|---|---|---|---|---|---|---|---|
| Four prompted, Qwen3.5 2B (baseline) | 289 | 179 | 110 | 12 | 3 | 4 | 0 | 18 |
| Prompted, Qwen3-VL 2B, re-tuned (`vl` variant) | 249 | | | | | | | 8 |
| `patch-planner-trained` (final step) | 238 | 166 | 72 | 56 | 7 | 5 | 2 | 4 |
| `patch-planner-trained-s4000` | 244 | 156 | 88 | 54 | 3 | 6 | 1 | 5 |
| Round 2 (`patch-planner-training-2`), 4 runs, 2026-10-10 | 274 each | 210 | 62 | 7 | 10 | 4 | 13 | 5 |
| **Under D92** (an ask on a message with no data and no digits is honest), 2026-10-11: prompted baseline **289**/18, round 2 **285**/5, round 1 **238**/4 — numbers of record until 2026-10-12, router gates off (see below) | | | | | | | | |
| Round 2 checkpoints, 2026-10-11, app with D93 and D94 (the harness now includes them): step 8,000 (⅓) **283**/4, step 16,000 (⅔) **287**/5, final (24,459) **288**/5 — the final under the old code was 285/5; no row went from right to wrong | | | | | | | | |
| Round 3 (`patch-planner-training-3`), 4 identical runs, 2026-10-12, today's code under D92: **289**/4; prompted planners on today's code 289/18. Short of 292 by 3. Write-up `patch-planner-misses-r3.md` (a write-up outside this repo) | | | | | | | | |

Short of 287 by 43 or more; the planner stays on Qwen3.5 2B. Three of the
experiment's four runs are spent, the last kept for one stated adjustment. The
two checkpoints choose the same wrong skill on 50 of 54 rows; the 29 near-twin
misses are 29 different pairs whose cards already tell them apart; 15 routable
skills have no training rows. The row-by-row write-up is
`patch-planner-misses.md` (a write-up outside this repo). Round 2 (new rows, minimal pairs, every
skill ≥20) scores 274 and 5 on four identical runs, round 1 238 and 4 again on
the same harness; 11 of its 13 asks are right by the app's own rule but scored
as misses (D92, decided 2026-10-10), and round 1 earned 8 of the same rows by
inventing values. Write-up: `patch-planner-misses-r2.md` (a write-up outside this repo). Under D92
round 2 is 285 against the prompted planners' 289, with 5 leaks against 18, so
Patch v7 (2026-10-11) asks the trained planner; the asks check, second look,
focus and OCR tidy stay prompted on Qwen3.5 2B, so both bases stay.

**Number of record, Patch v9 (2026-10-13, Kevin): 290 of 308, 1 of 100 leaks.**
v9 is v8 with the asks check trained on Qwen3-VL 2B (`patch-asks`, rows in
`patch-asks-training/`, built by `scripts/asksdata.mjs`) in place of
the prompted Qwen3.5 one. Everything else is unchanged: round 3's planner, the
widened router, the gates. One run on main 0762ed4, flagless, the bench nest
being v8's with `patch-asks` swapped:

| Patch | Right of 308 (higher is better) | Leaks of 100 (lower is better) | Mean per ask |
|---|---|---|---|
| **v9: trained asks check on Qwen3-VL** | **290** | **1** | 3.40 s |
| v8: prompted asks check on Qwen3.5 | 293 | 4 | 3.19 s |

The asks check alone (`scripts/asksbench.mjs`, the app's own `asksCheck`), real
asks let through of 308 and no-skill messages stopped of 100 (both higher is
better): trained Qwen3-VL **302 and 98**; prompted Qwen3.5 305 and 62 (measured
again 2026-10-12, the harness reproducing October); prompted Qwen3-VL 255 and 76
(October, not re-run). Against v8 the planner bench loses 5 ("tell me about
magnesium", "what changed between the old and new version", "does this read as
happy or unhappy", "at what point does the annual plan pay off", "what stands out
in this document", all declined after the check's NO) and gains 2 ("how long
would this take someone to read", "am I overusing any words here"), and 3 leaks
are stopped. The misses, with the cause of each: `patch-asks-misses.md` (a write-up outside this repo).
Qwen3.5 still loads for the second look, the focus pass and the OCR clean-up, so
the one-base saving is not taken yet.

**Number of record, Patch v10 with E26 (2026-10-14, Kevin): 294 of 308, 2 of 100
leaks, at `prefix-cache 2048`** (the default; the engine stamp
`libpigeon 0.1.0 (llama.cpp 26394b4; spec 1; prefix-cache 2048)`). Beside it,
the same nest with `prefix-cache off`: 293 of 308, 2 of 100. The one row
between them is the planner on "what is -.-. --.- in letters", `morseDecode`
with reuse on and `binaryDecode` off; 1,146 of 1,147 raw answers are the
same. A score belongs to its setting, as to its build (E10, E26).

**Patch v10 as first measured (2026-10-14, before E26): 293 of 308, 2 of 100 leaks; one model.**
Every Pigeon in his nest is on Qwen3-VL 2B: the asks check's second pass
(`patch-asks`, trained remotely on an L40S), the focus pass and the OCR clean-up
trained, the second look retired (`needs` 10). Qwen3.5 2B left `models.json`
and the app's roles: a fresh install downloads one model (1.1 GB, was 2.4 GB);
nothing is deleted: on Kevin's Mac the Qwen3.5 2B file stays in the models
folder, unused by Pigeon. Measured on main 5e2b2ee, alone on the GPU:

| | v9 (number of record) | v10 |
|---|---|---|
| Planner bench, right of 308 / leaks of 100 | 290 / 1 | **293 / 2** |
| Asks check alone, real asks let through of 308 / no-skill stopped of 100 | 302 / 98 | 305 / 95 |
| Focus, right of 166 (`scripts/focusbench.mjs`) | 160 (prompted Qwen3.5) | **161** |
| OCR, exact of 120 at light / medium / heavy (`scripts/ocrbench.mjs`) | 84 / 65 / 54 (prompted Qwen3.5) | **111 / 111 / 104** |
| OCR, undamaged texts handed back unchanged of 40 | 33 | **40** |
| Engine, bases in memory with Patch loaded (`/info`) | 2.39 GB + 1.90 GB | **2.39 GB** |
| Engine, phys_footprint with Patch loaded | 2.41–2.46 GB | 2.26–2.30 GB |
| Engine, phys_footprint idle | 157 MB | 224 MB |

"Patch loaded" is `pigeon-serve` on the nest after `plannerbench --limit 5`
(router, planner, asks) and one ask each to focus, OCR clean-up, tidier, Pen and
Pen without figures (and the second look on v9): two runs each, every one
listing the same members. The footprint counts only dirty pages; the weights are
mapped clean, which is why it moves less than the bases do. Idle grows by the
nest's own size (129 → 199 MB, the trained focus and OCR files being 35 MB
each): `pigeon_core::nest::members` is given the whole nest as one allocation,
and macOS's allocator keeps it dirty after it is freed (dropping it explicitly
changed nothing). v9's earlier 123 MB was on a 94 MB nest. The app reads the
nest whole at launch the same way (`patch::select_at_launch`), so it likely
carries the same; reading the nest's directory instead of the whole file is a
follow-up, not in v10.

**The second look, retired (2026-10-13, Kevin; branch `retire-second-look`, for the next seal).**
On the sealed v9 file, the planner bench with the second look on: 290 of 308, 1 of 100
leaks. It fired 2 times, and both rescues were wrong ("this config is being rejected,
what is malformed" → `parseKeyValue`, "am I saying the same phrase twice" →
`checkPalindrome`). With it off: **290 and 1, the same**, its two rescues becoming
declines (misses either way). `stack.js` no longer builds it, and `patch-second-look`
leaves `needs`. One Pigeon fewer on Qwen3.5. App-shape runs from here on drop
`--second-look`.

**v8 as it shipped, the widened router (2026-10-12, Kevin): 293 of 308, 4 of 100
leaks; the number of record until v9.** Round 3's planner (v8, unchanged) on the widened router: the gates
below, plus twins ride together (round 3's 145 pairs, `src/twins.js`), every
member of the chosen category kept, and the list cut to 24 without cutting what
the unwidened rule lists. The enum ask rule is in too. A flagless run is this,
head b41f41b, one run:

| Planner | Right of 308 | Answered outright | Honest asks | Asked for an argument | Wrong skill | Skill failed | Declined | Leaks of 100 |
|---|---|---|---|---|---|---|---|---|
| **Trained round 3 on the widened router (ships)** | **293** | 145 | 147 | 1 | 7 | 1 | 6 | **4** |

Against 287 on the unwidened router (the table below): +7 and −1. Two gains are
the widening's purpose (`durationToText` and the calendar grid, newly listed),
two are the enum rule (the fibonacci and palette asks), and three gains plus the
loss (Morse → `binaryDecode`) happen with both twins already listed. On the 152
twin messages, widening moved round 3 from 133 to 135, and its twin picks from 3
to 4. (Re-run on 2026-10-12 after the decompress message got a real
`compressText` blob; it was 132 and 134 before.)

**What the longer list costs** (2026-10-12, one run each, GPU otherwise quiet,
head 0060a86). The shipped router lists 17.3 skills on average; the unwidened one
lists 10.7 (`--no-twins --no-keep-category --no-cap`). Time per ask, whole turn:

| Router | Mean, all 408 | Mean, 308 questions | 95th percentile | Worst (after the first, which loads the models) |
|---|---|---|---|---|
| Unwidened | 2.58 s | 2.95 s | 3.80 s | 4.82 s |
| Shipped (widened) | 3.19 s | 3.67 s | 4.62 s | 5.28 s |

So the widening costs about **+0.6 s per ask** (median +0.5 s, up to +2.6 s on
date questions, where twins are many). It is prompt length: the planner writes
the same ~35 tokens either way. The first ask took 18.3 s in both runs. Scores:
293/4 shipped, 289/4 unwidened (287 plus the enum rule's 2). Widening does not cut twin confusion, so there is no round 4 (Kevin). The
cap rule Kevin first wrote (unscored non-twins cut first) gave 283/4; it is kept
behind `--cap-unscored-first`. `--no-twins --no-keep-category --no-cap` measures
the unwidened router. Report: `twin-check-and-cap.md` (a write-up outside this repo).

**The unwidened router, gates on (2026-10-12, Kevin).**
App-shape planner bench through the engine, with the router's two gates as the
app sets them (confidence 0.80, word floor 0.20, `src/stack.js`). These are now
the bench's defaults, so a run without flags is the app, and the record names
them (`routerGates`). Today's app code (D93, D94, and one figure, one field for
the extractor), scored under D92. One run each, head 9cadcd5:

| Planner | Right of 308 (higher is better) | Answered outright | Honest asks | Asked for an argument | Wrong skill | Skill failed | Declined | Leaks of 100 (lower is better) |
|---|---|---|---|---|---|---|---|---|
| Prompted, Qwen3.5 2B (four Pigeons) | 285 | 176 | 107 | 0 | 12 | 4 | 7 | 12 |
| **Trained round 3, Qwen3-VL 2B (ships, v8)** | **287** | 142 | 144 | 1 | 10 | 3 | 7 | **4** |

Right includes the network-off look-ups (2 prompted, 1 round 3). What the gates
moved, against the gates-off runs below:

- **Round 3, 289 → 287, leaks 4 → 4.** "longest run of consecutive days in this
  log" is emptied by the floor (asked honestly → declined). "offset from utc in
  Auckland" loses its category to the confidence gate (0.73) and is answered by
  the twin (`listTimezoneOffsets`).
- **Prompted, 289 → 285, leaks 18 → 12.** It loses the same two, plus "order these
  from best to worst" and "put these items in natural order" (honest asks →
  declines). Six leaks are stopped ("translate good morning into portuguese",
  "draft a thank you note to my team" and four more).

The trained planner still leads on both counts, now by 2 right and 8 leaks. The
target of 292 is 5 away.

**The same runs with the router's gates off** (`--min-confidence 0
--fallback-floor 0`, the bench's defaults before 2026-10-12). These are not what
the app does. They compare with each other and with the earlier rows of the
table above, which were all benched this way:

| Planner (gates off) | Right of 308 | Answered outright | Honest asks | Asked for an argument | Wrong skill | Skill failed | Declined | Leaks of 100 |
|---|---|---|---|---|---|---|---|---|
| Prompted, Qwen3.5 2B (four Pigeons) | 289 | 176 | 111 | 0 | 12 | 3 | 4 | 18 |
| Trained round 2, Qwen3-VL 2B | 288 | 140 | 146 | 2 | 7 | 7 | 4 | 5 |
| Trained round 3, Qwen3-VL 2B | 289 | 143 | 145 | 1 | 10 | 3 | 5 | 4 |

Round 3 gates off: four runs, identical on all 408 rows. The rounds stop here
(Kevin): the missing points are twins the router never lists together on plain
messages, so the next gain is the router's (proposal
`router-widening-proposal.md` (a write-up outside this repo)). Misses:
`patch-planner-misses-r3.md` (a write-up outside this repo).

**Focus pass and OCR clean-up: numbers of record before training (2026-10-13).**
Held-out sets `bench/focus-heldout.json` (166) and `bench/ocr-rows/heldout-clean.json`
(120 texts, 3 damage levels plus 40 undamaged), benches `scripts/focusbench.mjs` and
`scripts/ocrbench.mjs`, both through the app's own code. Summaries are in
`bench/results/baselines-2026-10-13/`.
- **Focus, right of 166 (higher is better):** prompted Qwen3.5 **160** (record);
  the same prompt on Qwen3-VL 154. "No answer" kept whole, of 20: 16 and 13.
- **OCR, exact of 120 at light / medium / heavy (higher is better):** prompted
  Qwen3.5 **80 / 60 / 47** (record), undamaged kept 33 of 40; on Qwen3-VL
  75 / 57 / 43 and 34. Words changed that nobody asked for (lower is better):
  7 / 17 / 24 against 39 / 57 / 66.
- **Found:** `cleanupBudget` (characters ÷ 4 × 1.5 + 32 tokens) cuts off
  number-heavy repairs, because each digit is a token. That accounts for 34 of
  Qwen3.5's 40 refusals (and 38 of Qwen3-VL's 43), all receipts, timetables,
  menus and forms. Not fixed; it waits on Kevin.

## Speed, 2026-10-15

The review of where the engine could be faster than llama-server is
an engine speed review kept outside this repo. Two of its levers landed the same day; neither
changes which batch a token is evaluated in, so no score moves and the
runtime stamp is unchanged.

- **An idle lane that keeps this Pigeon's prompt is the one its next ask
  takes** (`lanes.rs` `place`, rule 2). Kept prompts belong to a lane, and
  rule 2 took the *first* idle lane, so an ask that landed on the other lane
  read its whole prompt again and paid the adapter re-plan (14 ms). It worked
  in the app only because turn.js fires the asks check before the planner
  every turn. Now, among idle lanes: the one keeping this Pigeon's prompt,
  then the one whose adapter is already this Pigeon's, then any. Proven live
  (`tests/prefix_reuse.rs`, two lanes, asks check and router from two threads
  trading places as first to arrive): asks reused 909 on all 11 later asks,
  router 82 on all 11. The on-versus-off ride now asks Peek at temperature 0
  (E4); at his file's 0.7 two rides never matched, which was the test's
  mistake, not reuse's.
- **The tidier asks every piece at once** (`captions-tidy.js`). The engine
  runs up to four requests of one Pigeon in a single decode per step (`SEQS`)
  and queues the rest; the page asked piece after piece. Output order and the
  per-piece audit are unchanged. Not timed on a real transcript yet.

**The full app-shape planner bench, main 204b46b's `pigeon-serve` against
today's, back to back on the same nest (2026-10-15, 20 min a side):
294 of 308 and 2 of 100 on both, 2,885 ms mean per ask on both, all 408
cases the same outcome, medians 3,229 against 3,234 ms, 1,178 against
1,177 s wall.** The records are `bench/results/engine-compare-2026-10-15/`.
That is the expected result: the bench runs one lane, one request at a
time, so lane affinity never fires there, and the other levers are not on
its path. It proves today's engine changes moved no answer and no time on
the path that is scored.

Three more the same afternoon (a second hour), proven together by the
engine's live test (`lib.rs` `mod live`, `PIGEON_MODELS_DIR` and
`PIGEON_PREFIX_NEST` set, release), one run:

- **`Engine::warm(pigeon)`** (`lib.rs`, `Scheduler::warm`): the base loaded
  again if the idle unload took it, the Pigeon attached again, and a lane's
  context made on its thread, with nothing asked. The app's `engine_warm`
  command calls it for the router, asks check and planner, and both
  composers call that on the first keystroke of a message, at most once in
  20 s (`warmWhileTyping` in app.js, the same in bar.js). Measured: after a
  1 s idle unload, warm took **413 ms** and the router's ask right after it
  264 ms, so the reload is paid while the person is still typing.
- **Peek's picture is brought down to a longer side of 1,024** before the
  projector sees it (`chat.rs` `PEEK_MAX_SIDE`, `pigeon_engine::fit_picture`,
  `apple::Image::scaled`, high-quality interpolation, JPEG 0.85). A 3,000 ×
  2,000 picture whole: **4,070 prompt tokens, first piece at 22.4 s** (that
  first ask also loaded the projector); at 1,024: **686 tokens, 4.8 s**.
  Qwen3-VL makes a token of every 32 × 32 pixels, and each costs twice, in the
  vision encoder and in the prefill. Whether 1,024 is the right size for what
  Peek is asked to read is Kevin's call; the constant is one line.
- **The tidier's repair is streamed to the chip.** `task_complete` takes an
  optional `piece` number; with one it asks the engine with `stream` on and
  emits a `task-piece` event per few characters carrying that number, so the
  pieces asked together each reach their own listener (`captions-tidy.js`
  `hearPieces`). `tidyTranscript` hands `onStage` the repair so far, the
  pieces in their own order, and the transcript chip shows its tail under
  the dots with "n of m passages". Measured: 10 pieces for a 9-word repair,
  adding up to the answer exactly. Not seen in the app window yet; the chip
  logic is under `npm test`.

**The app's prefix budget is 6,144 (2026-10-15, late).** `inprocess.rs`
passes `prefix_cache_tokens: 6144`; the engine's own default stays 2,048, so
the engine's default stamp, Flight School's pin and every record taken
through a plain `pigeon-serve` are untouched. The app's stamp is
`libpigeon 0.1.0 (llama.cpp 26394b4; spec 1; prefix-cache 6144)`. Why: `keep`
refuses a prompt longer than the budget, so a Pen chat past about 2,000
tokens of history was never kept and re-read its whole history every turn;
and in one lane the asks check's 909 kept tokens, the router's 82 and the
planner's ~1,000 overran 2,048 together, so one was evicted and re-read
nearly every turn. The app's four numbers of record, measured again under
the new stamp (`pigeon-serve --prefix-cache 6144`, records in
`bench/results/prefix-6144-2026-10-15/`), one run each, back to back:

| | At 2048 (record) | At 6144 |
|---|---|---|
| Planner bench, right of 308 / leaks of 100 | 294 / 2 | **294 / 2**, all 408 outcomes identical |
| Planner bench, mean per ask / wall | 2,885 ms / 1,177 s | **2,185 ms / 892 s** |
| Asks check alone, let through of 308 / stopped of 100 | 305 / 95 | **305 / 95**, mean 169 ms |
| Focus, right of 166 | 161 | **161** |
| OCR, exact of 120 at light / medium / heavy; undamaged kept of 40 | 111 / 111 / 104; 40 | **111 / 111 / 104; 40** |

No answer moved; a Patch turn on the bench is a quarter faster because
nothing is evicted between its three asks. `pigeon-serve` now serves each
connection on its own thread (bench binary only), so a bench that asks
pieces together reaches the engine's batching.

**The tidier's pieces stay at 3,000 characters (2026-10-16, 00:30).**
`transcriptbench --engine` now asks the `tidier` Pigeon through
`pigeon-serve`, cut into pieces as `captions-tidy.js` cuts and asked
together as the app asks; `--chunk` sets the piece size and `--join N`
joins N holdout rows into one transcript, because the holdout's rows
(1,100 to 2,500 characters) are never cut by any size the app would use.
Records in `bench/results/tidier-pieces-2026-10-15/`, one run each:

| Pieces of | Transcripts | Boundaries F1 light / medium / heavy | Paragraphs F1 | Fabricated | Undisclosed | Pieces, wall |
|---|---|---|---|---|---|---|
| 3,000 | 120 rows as they are | 0.933 / 0.906 / 0.899 | 0.662 / 0.650 / 0.575 | 1 of 120 | 0 | 120 in 500 s |
| 2,000 | same | the same figures (nothing cut) | | 1 | 0 | 120 in 495 s |
| 1,500 | same | 0.933 / 0.906 / **0.889** | 0.662 / 0.650 / **0.543** | 1 | 0 | 123 in 496 s |
| 3,000 | 39, three rows joined | 0.894 / 0.875 / 0.838 | 0.649 / 0.677 / 0.625 | 0 of 39 | 0 | 104 in 434 s |
| 1,500 | 39, three rows joined | **0.863 / 0.827 / 0.779** | 0.683 / 0.688 / **0.548** | **1** | 0 | 120 in 412 s |

A cut costs the model the sentence across it: at 1,500 the boundaries fall
three to six points, a word is fabricated, and the time saved is 5 percent.
Not taken.

**What asking pieces together is worth, measured** (four light rows through
the tidier, the same 1,139 answer tokens): one after another 14.96 s, four
at once 9.81 s, **1.5x**, not the 3 to 4x the review estimated. A four-token
decode step on Metal costs about two and a half single ones for this model,
so the weights-read-once argument buys less than it promised. The gain is
real on a transcript of several pieces and nothing on a single passage.

**Streaming, the same evening (2026-10-15).** The engine's `piece` events
now reach the page on three doors, each keyed by a random number the page
puts in the request (random, not counted: every window hears every window's
events): `task-piece` (the tidier, earlier), `chat-piece` (`chat_complete`,
Pen, Peek and voices) and `llm-piece` (`llm_complete`, Lane A). What is shown
of them is the page's decision:

- **Lane B shows a reply as it is typed, a whole word at a time** (`chat.js`
  `showable`, `wholeWords`). On a question that wants a figure it is a whole
  sentence at a time instead (`wholeSentences`): a sentence stating a
  number the person did not supply is held, and nothing after it is shown;
  the whole reply is still read by `needsHandoff` at the end and dropped
  then, as before. So no sentence with an untraced figure ever reaches the
  screen, early or late. Each sentence lands in the typing bubble with a
  short fade, the dots trailing after it (`showText` in app.js,
  `liveBubbleHtml`, `.typing-bub.has-text`, `.land`). Peek streams unguarded,
  as his replies are unguarded.
- **Patch's stage line names the skill a few tokens into the plan**
  (`planner.js` `skillsNamedIn`, `onSkill` → `stage('reaching', …)` in
  turn.js, "reaching for convertLength", "then evaluateExpression"). The plan
  is still read whole, under its grammar, when it is back; nothing runs
  early. The stage line slides in on each new stage (`#stageLine.swap`).

Each event carries `sofar`, the whole answer to here, and the page awaits
its listener before the ask goes, so a piece that arrives early costs
nothing. Kevin's first try showed no stream: Pen answered in 17 tokens and
510 ms, one sentence, and the first cut showed a sentence only once the next
had begun. Proven at the Rust door (`inprocess.rs`
`pen_streams_his_reply_as_chat_pieces`, ignored, live): 71 `chat-piece`
events for a 71-token reply, `sofar` only growing, the last one the reply.
Not seen in the app window yet: the words landing, the dots trailing, the
stage line's slide. The page logic is under `npm test` (showable, runChat's
`onText`, `skillsNamedIn`). The one measurement that matters is unchanged by design: total
time per reply is the same, time to the first sentence on Pen is the prefill
plus one sentence, about half a second.

**Frames in parallel: measured, and the GPU is the wall (2026-10-15, Kevin's
question).** `lib.rs` `mod play_bench` (ignored unless `PIGEON_PLAY_PIGEON`,
`PIGEON_MODELS_DIR` and `PIGEON_FRAMES_DIR` are set): the same 60 frames,
768 × 432, through the Pokémon Fire Red Pigeon (its 3B picture base at Q4_K_M, its Q8_0
projector, `actions.frames` max_side 768), release, one run each, the first
frame off the clock:

| | Frames/s | Ask to answer, mean | p95 |
|---|---|---|---|
| One lane, one at a time | 0.40 | 2,484 ms | 2,565 ms |
| One lane, two in flight (one decode carries both) | 0.40 | 4,994 ms | 7,447 ms |
| Two lanes, two in flight | 0.40 | 4,974 ms | 7,431 ms |
| Two lanes, four in flight | 0.42 | 9,388 ms | 14,551 ms |
| Two engine processes, one frame each at a time | 0.21 + 0.21 = 0.42 | 4,786 and 4,792 ms | 4,908 and 4,918 ms |

Every way of putting more frames in flight gives the same frames per second
and a latency that is that many times longer. A frame's cost is the vision
encoder and the prefill of its ~420 picture tokens, both GPU compute, and
Metal has one queue; nothing on the CPU side is long enough to overlap. A
second engine process costs about 2 GB (the projector copied in, a context)
and buys nothing. `prefix_tokens` 0: this Pigeon's prompt opens with the
picture, so E26 has nothing to keep. What would move a frame: fewer picture
tokens (max_side 768 → 384 is about a quarter of the tokens, Flight School's
setting in the Pigeon's `actions.json`), and capturing the next frame while
the current one is judged, which hides the capture and JPEG write only.

## Open after v10 (2026-10-14)

- **Known build difference, adapter-less Pigeons only; no further work (Kevin,
  2026-10-14).** The planner's bare base: the engine and llama-server split 12
  of 50 rows (Flight School DEV-6). It is not the picture-path difference; it
  is the two llama.cpp builds themselves: the engine's
  26394b4 and Flight School's llama-server 4f37f51 compute the bare base's
  text logits differently enough to flip a choice the model makes at about
  2 to 1. With the adapter, all 766 rows agree, because a trained Pigeon's
  margins are far wider. Checked 2026-10-14, in Kevin's GPU window:
  - **The prompt is the same.** llama-server's `/apply-template` on the rows'
    exact messages gave text identical, character for character, to what the
    engine rendered (rows 3, 4 and 7), and the same token counts.
  - **Flash attention is the same.** Both builds resolve `auto` to enabled on
    this Mac ("resolve_fused_ops: Flash Attention enabled" in both load logs).
  - **The engine's cache layout and batch size are not it.** The engine run
    with llama-server's layout (`kv_unified` off, `n_batch` 2048, in a
    measurement build) gave all 12 answers unchanged.
  - **What the 12 are** (the engine's probabilities at the first token where
    its answer and llama-server's part, raw, before the grammar):
    - 7 rows part at the very first token. The bare base wants prose there
      ("Let", "Sure", "Got": 0.35 to 0.96), and the grammar forces JSON, so it
      picks among openers it scores near 0 (`{"` at 0.000) — a near-tie in
      effect.
    - Row 3 parts on closing whitespace: the base's own choice (`}` and two
      newlines, 0.989) is not one the grammar allows, and the engine's pick
      scores 0.001.
    - Row 7: 0.183 against 0.177, a genuine near-tie.
    - Rows 15 and 48: the engine's pick wins about 2 to 1 (0.63 against 0.27,
      0.61 against 0.29), and the server takes the other one.
    - Row 42: the server's skill is not even among the engine's top two (0.34
      and 0.27).
    - Those last three are larger than rounding moves, so the builds differ
      in how they compute this base on text, not only on pictures. Which
      change between 26394b4 and 4f37f51 does it is not being looked for.
  - **It touches no Pigeon the app runs.** Every adapter ride matches its
    card, 17 of 17. A score taken through llama-server on a bare base will
    not reproduce through the engine, which is E10's rule: a score belongs to
    its build.
- **Few-shot Pigeons are slower per ask than on llama-server because the engine
  re-reads the shared prompt prefix every ask** (asks check 1,364 against
  157 ms; router 161 against 66). llama-server's first, uncached ask takes as
  long as the engine's. E26 (prefix reuse per Pigeon) is built on branch
  `e26-prefix-reuse`. Its proof found answers differ on near-ties (Kevin's GPU
  window, 2026-10-14), and Kevin shipped it on by default anyway: a score
  belongs to the setting it was measured with, as it belongs to the build, so
  the runtime stamp now names it (`…; spec 1; prefix-cache 2048)`; D98's
  `check_ride.engine` carries it). What the proof found:
  - **Flight School's 37 DEV-6 rides:** 4,586 of 4,607 rows identical; 21
    differ. The four sampled Pigeons were asked at temperature 0 for the
    comparison.
  - **15 of the 21 are on D83 control files (bare bases):** planner 11, router
    2, focus 1, Note to Title 1.
  - **6 are on trained Pigeons, all long free text parting late:** Plain
    English Explainer 2, Peek without a picture 2, Pat V2 1, tidier 1.
  - **Patch's trained Pigeons: identical on all 1,964 rows** (asks check 558,
    router 500, focus 140, planner 766).
  - **Why answers can move:** with reuse, the part after the shared prefix is
    evaluated in a different batch than in a full prefill, so the logits move
    by rounding. That flips only near-ties, the same kind the build difference
    above flips.
  - **Speed, the same rides:** asks check 780 → 97 s (558 rows), router 84 →
    38 s, focus 133 → 53 s, planner 1,178 → 1,154 s; all 37 rides 5,434 →
    3,979 s.
  - **Run in a second window (2026-10-14, 45 min):**
    - **The planner bench, reuse off then on:** 293 → 294 of 308, leaks 2 →
      2, 3.35 → 2.92 s per ask. Raw answers were compared request by
      request: 1,146 of 1,147 identical. The one that differs is the planner
      on "what is -.-. --.- in letters", which was `binaryDecode` off and
      `morseDecode` on (right); that is the +1.
    - **The engine's E26 test (two Pigeons in one lane, Peek with a
      picture):** every answer identical on and off. The asks check reused
      909 tokens and the router 82. Peek reused none, which is right: his
      prompt opens with the picture, so nothing comes before it. The test
      had expected otherwise and is corrected.
    - **The C host, reuse on:** all ten steps passed plain, under
      AddressSanitizer (no error) and under ThreadSanitizer (no warning),
      with `leaks` at 0. Python passed. `info` shows 1,115 kept tokens on the
      base and the stamp `…; prefix-cache 2048)`.

- **The idle footprint grew with the nest: fixed on `daily-driver` (2026-10-15).**
  The app read `patch.nest` whole at launch (`patch::select_at_launch`, then
  `pigeon_core::nest::members`), and `pigeon-serve` did the same; macOS's
  allocator kept that freed read counted as dirty MALLOC_LARGE, so idle
  carried roughly the nest's size. Both now open the nest mapped
  (`pigeon_core::blob::Blob`), so choosing Patch touches only the
  directories, each member's `pigeon.json` and the pack, as clean file pages.
  Measured in the release app, 30 s after launch with nothing asked (no
  engine, no GPU), three launches each, phys_footprint, lower is better:
  **537 / 538 / 539 MB on main 6cc112b → 348 / 349 / 348 MB** (−189 MB; the
  nest is 199 MB). `pigeon-serve` by v10's method (the app-shape planner
  bench `--limit 5` with `--planner-pigeon patch-planner-trained`, then one
  ask each to focus, OCR clean-up, tidier, Pen, Pen without figures; idle is
  100 s after a 60 s idle unload), main's build against the branch's, one
  run each, back to back:

  | `pigeon-serve`, phys_footprint (lower is better) | main 6cc112b | branch |
  |---|---|---|
  | Started, nothing loaded | 225 MB | 34 MB |
  | Patch loaded | 2,252 MB | 2,058 MB |
  | Idle, after the unload | 234 MB (v10 recorded 224) | **44 MB** |

## Open after the whole app moved onto the engine (2026-10-08)

- **The planner on Qwen3-VL 2B** (one base for every Pigeon). Target: at least
  287 of 308 right and no more than 18 of 100 leaks on the app-shape bench,
  thinking off. Run 1 of 4, prompts re-tuned for Qwen3-VL (the `vl` variant in
  `scripts/prompt-variants.mjs`): 249 right, 8 leaks. What is left is the
  planner itself (wrong near-twins, invalid arguments), which prompting does
  not reach, so the training rows went to Flight School:
  `patch-planner-training/` (built by `scripts/plannerdata.mjs` and
  `scripts/planner-pigeon-rows.mjs`; its README is the contract: no system
  prompt, `about` always first, carry as the EARLIER ANSWER block). **Runs 2 and 3
  (2026-10-08) benched their trained planner: 238 and 244, see the table
  above; one run remains.** Bench it through the
  engine with `pigeon-serve` and `plannerbench --engine`, in a nest whose
  planner is the trained Pigeon. Until it meets the target, the four prompted
  planner Pigeons stay on Qwen3.5 2B.
- **One base would mean training the asks check on Qwen3-VL (2026-10-11, Kevin
  decides after round 3).** In v7 four Pigeons stay prompted on Qwen3.5 2B (the
  asks check, second look, focus, OCR tidy), so both bases load: 1.9 GB of
  Qwen3.5 besides Qwen3-VL's 2.4 GB. The asks check is the one that matters:
  it stops 48 of 66 leaks for 2 right answers (291/66 off, 289/18 on), and
  prompted on Qwen3-VL in October it passed only 255 of 308 real asks against
  Qwen3.5's 305 (stopping 76 of 100 no-skill messages against 62); re-tuned
  prompts got the tune half to 151 of 160 and 32 of 50, not enough. A trained
  patch-asks would take rows in its own contract (the user turn
  `ASKS_USER_TURN_TEMPLATE` builds from **the message alone**, after the system
  line and the ten shots → YES/NO; corrected 2026-10-12: no chosen skill is in
  the turn, `src/verify.js` sends only the message): YES from round 2–3's
  ~8,000 checked plans, NO from their ~1,300
  declines and, above all, lures paired with the skill whose words they share,
  the bench's 408 messages never in it; then the asks check alone and the whole
  app-shape bench with the trained planner, against v7's 285/5. Second look,
  focus and OCR tidy each need the same before the 1.9 GB goes.
- **Scripts that still start llama-server themselves**, for development only;
  the app never does: `scripts/models.mjs` and `npm run dev` (`scripts/dev.mjs`,
  the browser page's two servers), `scripts/persona-run.sh` (it pointed at the
  sidecar, which is gone), `scripts/overnight-round2.sh`, `benchqueue.mjs`, and
  the benches that take `--base` (`plannerbench`, `followups`, `modelbench`,
  `transcriptbench`, `lanebbench`) and the data generators (`plannerdata`,
  `personadata`, `transcriptdata`, `negativesdata`, `mine-negatives`). They find
  `llama-server` on PATH, in `LLAMA_SERVER`, or in `src-tauri/binaries/`. The planner's
  benches can now run through the engine instead (`--engine`); the others
  cannot yet.
- **Licence text beside a downloaded projector: done (2026-10-08).** A
  projector fetched from the registry (`download::download_projector`) gets
  `<file>.LICENSE.txt` beside it before the download starts
  (`weights::write_projector_notice`): what it is, its source, hash and size,
  the registry's licence id and address, and the text when this build carries
  it (Apache-2.0's own terms, Qwen's research licence); for any other licence
  it says the text is at the registry's address.
- **Flight School's `nest pack`** refuses a skill pack inside a nest; a fix is
  pending there. `scripts/pack-patch.mjs` writes Patch's nest itself
  until then.
- **The two hand-dropped voices** (Socratic Tutor, Plain English Explainer) have
  no `.pigeon` and cannot be asked now; Flight School packs them.
- **Planner data gaps for a future round (2026-10-12, twin check).** On the 152
  approved twin messages (`bench/twin-colist.json`, never trained on), round 3
  on the widened router declines 6 messages whose skill was on its list. These
  are not twin confusions; the planner does not recognise the request. Rows for
  these shapes belong in any future round:
  - "how many lines has this got:\nroses are red\nviolets are blue\nsugar is sweet" (`countLines`)
  - "count the sentences: Stop. Look both ways. Then cross." (`countSentences`)
  - "break this into one sentence per line: Stop. Look both ways. Then cross." (`tokenizeSentences`)
  - "one sentence per line: It works. Ship it. Then rest." (`tokenizeSentences`)
  - "what do you call more than one cactus" (`pluralize`)
  - "what's just one of geese" (`singularize`)

  The same check found 5 where the right skill was chosen and then failed. They
  are in a skill-bugs note kept outside this repo.
