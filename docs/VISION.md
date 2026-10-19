# Seeing: a plan for vision Pigeons

**Where this starts.** `fe964de` taught the format to say what a Pigeon takes in
(`inputs`, §2.2) and made `SEES_PICTURES` the single place that says this app
cannot hand a model pixels. Everything below is what it takes to turn that
constant to `true` and have it be honest.

**Decisions taken (2026-09-20).**

1. **A vision Pigeon carries its own projector.** The `mmproj` bytes ship inside
   the `.pigeon`, not as part of a base download. One file, nothing else to
   install, works off a USB stick on a Mac that has never seen the internet.
2. **A vision Pigeon is still an adapter.** It names a VLM base from
   `models.json`, which the app offers to download, and refuses if it is absent
   — the same mechanism, the same hash chain, the same refusals as every Pigeon
   today. A Pigeon does not carry a whole model.

Together those say: **the base is shared and downloaded, the projector travels
with the Pigeon.** Everything below is rewritten around that.

The good news first, and it is better than expected.

---

## What is already there

**The binary can already see.** `src-tauri/binaries/llama-server-aarch64-apple-darwin`,
build `961e4b2`, reports:

```
-mm,   --mmproj FILE      path to a multimodal projector file. see tools/mtmd/README.md
       --mmproj-url URL
       --image-min-tokens N / --image-max-tokens N   (only used by vision)
       --vision-gemma-4b-default                     (downloads weights)
```

So mtmd is compiled in. No new sidecar, no new build, no change to the
llama.cpp pin. `--lora-scaled` and `--mmproj` are both on the same binary with
no stated incompatibility. **This is a models-and-plumbing job, not a toolchain
job** — which is the opposite of what I assumed before looking.

**The format already carries the claim.** A `.pigeon` can declare
`"inputs":["text","image"]` today; `Manifest::declared_inputs()` normalises it,
the sidecar keeps it, `PersonaInfo` carries it to the page, and the facts panel
already says *"text · its file asks for pictures too, and this build has no
vision model."* On the day the base exists, that sentence changes itself.

**The disclosure gets out of the way on its own.** `canBeSentAPicture(p)` is
`SEES_PICTURES && declaresImage(p)`. Flip the constant and a vision Pigeon stops
being shown the warn-coloured block, while every text-only Pigeon keeps it.
Nothing else in app.js needs to know.

**The rail already has a row for it.** `turn.js:704` draws `pass: 'vision'` at
state `'sub'` — "a classical OCR engine standing in for a vision model". It goes
to `'on'`, and the sentence under it stops being an apology.

---

## What actually blocks it

One thing, and it is structural.

**A vision Pigeon cannot share the category server.** Lane B's whole mechanism
is that every Pigeon is a LoRA adapter on *one* base — Qwen2.5-1.5B-Instruct —
loaded inert at spawn and raised to scale 1.0 per request (`chat.rs:130`,
`pigeon.rs:1298`). A LoRA is trained against one base's weights. Qwen2.5-1.5B
has no vision tower, so no adapter can give it one. A vision Pigeon needs a
**different base**, which means a **different server**.

That collides with three things that are hardcoded to exactly two models:

| Place | What assumes two |
|---|---|
| `engine.rs:274` | `slots: [Mutex<Slot>; 2]` |
| `engine.rs:273` | `fn idx(role)` — a two-arm match |
| `hardware.rs:44` | `enum Fit { Both, PlannerOnly, CategoryOnly, None }` |
| `hardware.rs:67` | `plan_fit(planner_mb, category_mb, share_mb)` |
| `engine.rs` spawn | one server per role, started once — but the projector now varies *per Pigeon*, not per role |

None of it is hard. All of it is load-bearing, and `Fit` in particular is a
user-facing promise — the first-run sheet tells someone which models their Mac
can hold.

This is the **same shape** as the two-base blocker recorded against
Patch-as-`patch.pigeon`: Patch spans the planner *and* the category base, and a
`.pigeon` has one base. Vision is that problem again from the other end. Solving
the engine's "more than two bases" question once solves both, and that is an
argument for doing this part properly rather than bolting on a third slot.

---

## The decision that actually matters: what a picture's receipt is

This is the part that is about Pigeon rather than about llama.cpp, and I think
it should be settled before any code.

Every other claim this app makes is inspectable. Patch's figures come from a
tested function and say which. Pen's words are marked as a model's words. And
the OCR path — the current stand-in — is inspectable in the strongest sense:
the reading is *shown*, it can be *corrected*, and only text reaches the turn.
`ocr.js`'s header is explicit that this is the point, and `fe964de` went out of
its way to protect it.

**A VLM has no equivalent.** When Qwen-VL says "Boxer" about a photograph, there
is nothing to show. No intermediate text, no span to highlight, no number to
extract and audit. The reply is the first and only artefact. That is a real
departure from everything else in the app, and it should be named as one rather
than discovered later.

Three honest options:

| | What it means | Cost |
|---|---|---|
| **A. Say so, loudly** | A vision reply is drawn like Pen's — a model's words, no receipt, permanent badge. The app already has this vocabulary. | Cheapest. Admits vision is the least checkable thing Pigeon does. |
| **B. Make it say what it saw** | Ask for a one-line description *and* the answer, show the description as the receipt. The description is itself unaudited, so it is a receipt in shape only. | Costs tokens and invites a receipt nobody can check — arguably worse than A. |
| **C. Keep OCR alongside** | Run tesseract *and* the VLM. Text in the picture is shown and auditable as today; the VLM answers about the pixels. Two readings, each labelled by what produced it. | Most work, most honest, and the only one that doesn't lose something the app already has. |

I'd recommend **C, falling back to A** where there is no text to read. OCR does
not become obsolete — a small VLM is *worse* than tesseract at dense text like a
receipt or a form, and the current path already handles that case well. They are
complementary, not sequential.

---

## Which base

**Measured 2026-09-20 on the M1 Pro 16 GB**, training with Flight School's own
`vlm_lora_restricted.py`, mlx-vlm 0.7.0, rank 8 / alpha 16, batch 1, seq 1400,
`--train-on-completions`. These replace the estimates that were here before.

| | Qwen2-VL-2B | the 3B picture base of the time |
|---|---:|---:|
| Peak memory | 6.26 GB | **9.90 GB** |
| Headroom against the ~10.5 GB budget | 4.2 GB | 0.6 GB |
| Throughput | 206 tok/s | 139 tok/s |
| 450 iterations, wall | ~19 min | **32 min, finished clean** |
| Layers the hybrid workaround excludes | **0** | **0** |

**Decision at the time: the 3B base, with Qwen2-VL-2B as the documented fallback. Superseded 2026-10-02: the picture base is Qwen3-VL-2B (Apache 2.0), and every picture Pigeon is trained on it.**

Three things the measurement settled, each of which had been a guess:

**The OOM was never the model.** Flight School's state record (kept outside its public source) records the dog-breed
pilot dying at iteration 320 with a Metal OOM at 10.808 GB, and that number was
the reason to doubt a 3B would fit at all. It was the wrong reason: Flight
School had already diagnosed it as MLX's Metal buffer *cache* growing over a
long run and capped it at 2 GB in `vlm_lora_restricted.py`. A 450-iteration run
— 130 past the old failure — held **9.901 GB flat from iteration 10 to
iteration 450** and converged to 0.03 loss. The cap works.

**The hybrid workaround becomes a no-op.** `vlm_lora_restricted.py` exists
because Qwen3.5's GatedDeltaNet layers cannot be mapped to GGUF safely, and an
adapter trained on them "loads without complaint and is quietly wrong". Both
candidates report `kept 7, excluded 0` — every layer converts. Moving off
Qwen3.5 retires that whole failure mode, which is a better reason to move than
the speed.

**What this did not measure: accuracy.** The 150 dog photos are gone from
Flight School's data — nothing image-shaped survives in `runs/` or
`quickbuild/` — so the corpus was synthesised. These numbers say the models
*fit and finish*. They say nothing about whether either can tell a Boxer from a
Beagle, and that still needs real labelled photographs.

**The 0.6 GB margin is a constraint, not a footnote.** Three things eat it: an
answer longer than a label, a larger image, another app holding memory. The
synthesised frames ran **597 tokens each against the ~150–320 vision tokens the
real dog photos produced**, so real input leaves more room than the table shows
— but corpus prep should cap image resolution rather than rely on that.

Dropped from consideration: **SmolVLM** (kept in reserve; only worth testing if
both above fail) and **Gemma 3 4B** (different family, so a third licence and
different prompt conventions in both apps, for no measured win).

---

## A worked example: the Game Boy Pigeon

The best argument in this document for building any of it, and the cheapest
thing on the list to build.

**The job.** Show it a Game Boy screen, it presses a button. `kind: classifier`,
`labels.txt` holding the eight buttons, `output_contract.max_tokens: 3`,
`inputs: ["text","image"]`. Nothing new in the format — it is the breed sorter
with different labels.

**Measured, same rig as above:**

| Input | Tokens/frame | Peak memory | Speed | A 600-iter run |
|---|---:|---:|---:|---:|
| Photo-sized frames (768×576) | 597 | 9.90 GB | 0.24 it/s | 42 min |
| **Game Boy (160×144)** | **57** | **4.03 GB** | **2.1 it/s** | **~5 min** |

A Game Boy screen is the cheapest vision input there is: ten times fewer tokens
than a photograph, nine times faster, and **6.5 GB of headroom instead of 0.6**.
A Game Boy Pigeon trains faster than most of the *text* jobs in
that state record's table. Every memory worry this document raises about
the 3B disappears at this resolution.

**And the corpus labels itself.** This is the only vision job considered here
that needs no hand-labelling: an emulator and an input log produce thousands of
`(frame, button)` pairs per hour of play. Set against §7's receipt case — where
the user must hand-transcribe every receipt before the first run — that is the
difference between a demo somebody builds and one nobody starts.

### Why it will not actually play Pokémon

One frame does not determine the next button, and no amount of data fixes it.
Standing in a doorway: up or down? Already fought that trainer? Second time
through this dialogue? The screen does not say, but the recorded input does — so
the corpus ends up with the same screen labelled `UP` in one session and `DOWN`
in another, and training averages them into mush. Accuracy caps at however
ambiguous the job is.

What is genuinely determined by the frame, and so genuinely learnable:

| | Determined? |
|---|---|
| Dialogue box on screen → `A` | yes, near-perfect |
| Battle menu → FIGHT / BAG / POKÉMON / RUN | yes |
| Menu navigation | yes |
| Overworld movement | **no** — this is where it falls apart |

Two cheap answers, and they compose:

1. **Narrow the job.** A battle-only Pigeon is a real working thing. *"What does
   this screen want?"* is answerable; *"where should I go next?"* is not.
2. **Stack frames.** Tile the last 2–4 frames into one image. Still one image
   in, one button out, still the same format and the same `inputs` declaration —
   but now it can see motion and which way it came from. At 57 tokens a frame,
   four frames still cost less than one photograph.

### Why the latency does not matter

Roughly a second or two per inference, so about one action per second.
Unplayable for an action game. **Completely fine for one that sits on a dialogue
box until you press A** — Pokémon is among the few genres where being slow costs
nothing, because the game is waiting.

### Where the loop lives: neither app

Pigeon is a messaging app; sending it one screenshot at a time by hand is not a
game. The capture → ask → press → repeat loop is a hundred-line driver script
beside an emulator, with the `.pigeon` as the brain it calls. That is the right
shape: **the Pigeon is the model, not the harness**, and keeping the loop
outside means the same file works for anyone who writes their own.

### One thing it fixes that the rest of this document cannot

§"what a picture's receipt is" is the hard problem: a VLM's answer has nothing
to show for itself. Here it does. **Press the button and the game either
responds or it doesn't** — the world supplies the receipt that the model cannot.
That does not generalise to breed sorting or receipts, but it is worth noticing
that the most playful use case is also the most checkable one.

---

## The format

A vision `.pigeon` is the archive it already is, with one more member:

```
dog-breed-sorter.pigeon
  pigeon.json
  adapter.lora.gguf
  mmproj.gguf          ← new, and most of the file
  labels.txt
  icon.png
```

and `pigeon.json` describes it the way `models.json` already describes the
category adapter — the existing `AdapterSpec` shape fits without inventing
anything:

```json
"base_model": {
  "file": "Qwen3VL-2B-Instruct-Q4_K_M.gguf",
  "sha256": "…", "arch": "qwen3vl", "name": "Qwen3-VL", "size": "2B"
},
"mmproj": { "file": "mmproj.gguf", "bytes": 1342177280, "sha256": "…" },
"inputs": ["text", "image"]
```

**Three things this gets right by construction.** Because the projector is
carried rather than found, a projector *mismatch* is impossible — the adapter
and the projector it was trained with travel together, which is the strongest
argument for this decision and worth stating plainly. Because it is inside the
archive, the **seal already covers it**: `seal_message` hashes every entry, so a
tampered projector is a broken seal with no new check to write. And because
`mmproj` is declared with a hash as well, the bytes can be verified on the way
out of the zip without trusting the zip's own CRC.

**Keep `inputs` even so.** The base says what the model *can* consume; `inputs`
says what this Pigeon *should be handed*. A text-only Pigeon trained on a VLM
base is a reasonable thing to have — you train on whatever base you have — and
it should not advertise pictures. They are different facts and both are needed
to route a turn.

**`Refused` grows one arm**, and it is a tamper check rather than a mismatch
check: `WrongProjector` when the carried bytes do not hash to the declared
`sha256`. There is no `NoProjector` — a vision Pigeon that failed to carry one
is refused by the existing `required_file_for_kind` mechanism, which already
knows how to say "a *kind* Pigeon needs *file*, and this one does not have it".

---

## What a gigabyte-class .pigeon costs, and the fix

This is the bill for the carried-projector decision, and it is the one part of
this plan that is not optional.

The import path is written for 21 MB files, and reasonably so. Today:

| Step | Cost on a 1.3 GB file |
|---|---|
| `add_path` → `std::fs::read(path)` (`pigeon.rs:886`) | 1.3 GB into a `Vec<u8>` |
| `HeldImports(Mutex<HashMap<String,(Vec<u8>,…)>>)` | held again between meet and install |
| `install()` → `fs::write(pigeons/<id>.pigeon, bytes)` (`pigeon.rs:594`) | **the whole archive written a second time**, for sidecar repair |

So roughly **2.6 GB resident at peak** and **1.3 GB duplicated on disk**, on a
machine whose model budget is 75% of RAM. Importing a vision Pigeon while two
models are loaded is how this falls over.

**The fix is small, and the codebase set it up.** `zip_store` is **store-mode
only** — it refuses compressed entries — and `get()` returns a *borrowed slice*
into the archive rather than a copy. So:

1. **Memory-map the file.** `add_path` maps instead of reads, and hands
   `&[u8]` onward. **Every existing signature stays exactly as it is** —
   `validate`, `seal::check`, `zip_store::get`, `install` all already take
   `&[u8]`. The projector is never copied; it is written out with one
   `io::copy` from the mapped slice.
2. **`HeldImports` holds a path and a hash, not bytes.** The hold is a
   two-phase-commit token; it does not need the contents.
3. **Keep the archive copy, but not twice over.** `pigeons/<id>.pigeon` exists
   solely so `repair_sidecars_in` can rebuild a contract. Options, in the order
   I'd consider them: keep the whole file and accept the disk cost; keep
   everything *but* the projector plus its hash, and re-splice from the store
   when a repair needs the original (possible precisely because store-mode zip
   holds the bytes verbatim); or keep the manifest alone and give up later
   seal re-verification. **This one is a decision, not an implementation** —
   it trades disk against the ability to re-check a seal after install.
4. **Content-address the installed projector.** Write it to
   `projectors/<sha256>.gguf` rather than `<pigeon-id>.mmproj.gguf`. Two
   Pigeons carrying the identical projector then share one file on disk and the
   second import is a no-op, which removes the duplication cost that made this
   decision expensive in the first place. A projector is deleted when the last
   Pigeon naming that hash is removed — `remove_persona_in` grows a refcount
   check.

---

## The phases

### V0 — Measure, decide nothing else (no app code)

**Half done, 2026-09-20.** The *training* side is answered and the base is
chosen (see *Which base*). The *inference* side is entirely open, and the one
question that decides the architecture is in it.

Answered:

- ✅ Both candidates train on this Mac. The 3B at 9.90 GB peak, flat
  across 450 iterations, converged. Qwen2-VL-2B at 6.26 GB and 1.5× faster.
- ✅ The iteration-320 OOM was MLX's buffer cache, already capped. Not a reason
  to avoid a 3B.
- ✅ Neither needs the hybrid-layer exclusion: `kept 7, excluded 0`.
- ✅ Game Boy resolution costs 57 tokens and 4.03 GB — see the worked example.

**Answered 2026-09-21 — the gate passes.** One server holds `--mmproj` and still
raises a LoRA per request: the same picture answered in prose with the adapter
off, "boxer" with it on, and the same prose again with it off. Server ready in
3.0 s, 3.0 GB resident, 593 tokens and ~3.5 s per 768×576 picture. Projector
0.84 GB (Q8) / 1.34 GB (f16); a 3B vision adapter 30.0 MB as GGUF. Full write-up
in Flight School's redesign milestones (outside its public source), Milestone 1.

Still owed, in the order that matters:

1. ~~**The one that decides the architecture.**~~ *Answered above: yes.* Start the bundled sidecar with
   `--mmproj` *and* `--lora-scaled adapter:0.0` together, and confirm the
   adapter can still be raised per request. If it cannot, a vision Pigeon
   cannot be an adapter at all — it would have to be a whole model, which the
   format's one-base-one-adapter shape does not describe, and **everything
   below changes shape**. Nothing in V1 is worth building until this is
   answered.
2. Fetch the picture base's **GGUF and its projector** — only the MLX training
   copies exist so far. Confirm `/health`, then POST an `image_url` content
   part carrying a `data:image/png;base64,…` and confirm the reply.
3. **Measure the projector at f16 and Q8.** Under the carried-projector
   decision its size is the floor on every vision `.pigeon` ever sent, and the
   gap between the two is roughly a factor of two.
4. Confirm a running server will **not** swap projectors without a respawn.
   `--mmproj` is a start-up argument with no runtime counterpart, so the
   expected answer is no; confirming it settles whether the vision slot is one
   server or a keyed pool (V1).
5. Measure real resident MB with the server up, not the manifest's guess.
6. **The dog test, once there are dogs.** A real Boxer photograph and a
   *screenshot* of a breed page, through both the VLM and tesseract. This is
   the only thing that will say anything about accuracy, and it needs real
   labelled photographs — the original 150 are gone from Flight School's data.

Gate: a written result for each, in the state record (kept outside this repo).

### V1 — The engine holds more than two models

- `Role` gains `Vision`; `idx()` and `slots` stop being a fixed pair. Prefer a
  `Vec`/map keyed by role over widening the array to 3 — the next one is
  already known (Patch's two bases).
- `hardware.rs`: `plan_fit(planner_mb, category_mb, share_mb) -> Fit` becomes
  something like `plan_fit(&[(Role, mb)], share_mb) -> Vec<Role>`. `Fit`'s four
  variants stop scaling at three models; the first-run sheet reads the list.
  **Keep the existing tests' numbers** — `sixteen_gb_budgets_12288_and_shares_10444`
  and friends are the regression for the 75%/85% rules and must still pass
  unchanged.
- `models.json` gains the VLM **base only** — no `mmproj` entry, because the
  projector is not downloaded. It is a second, offered fetch, not part of the
  default 2.3 GB.
- Spawn args: `--mmproj <path>` for the vision role, pointing at
  `projectors/<sha256>.gguf` — so **which projector the server starts with
  depends on which Pigeon is being asked**. That is new: the planner and
  category servers are started once and serve every request, but two vision
  Pigeons carrying different projectors cannot share one server process. Either
  the vision slot re-spawns when the projector changes (simple, costs a wake),
  or the app refuses to hold two projectors at once and says so. **Settle this
  in V1, not V2** — it decides whether the vision slot is one server or a
  keyed pool.

Gate: `cargo test`; `cargo test --lib -- --ignored --test-threads=1 the_engine_wakes`.

### V2 — A picture reaches the model

- `pigeon.rs::pigeon_run` and `chat.rs`: when the Pigeon declares `image` and an
  image is attached, send OpenAI-style content parts —
  `[{type:"text",…},{type:"image_url",image_url:{url:"data:…"}}]` — to the
  **vision** port rather than the category port.
- Route by the Pigeon's declared base, not by its `inputs`: `inputs` says what
  goes in, `base_model` says which server it runs on. They must not be
  conflated, or a text Pigeon trained on a VLM base goes to the wrong port.
- The bytes take the same road the OCR bytes take: a Rust command, bytes and
  nothing else, never written to disk. `ocr.js`'s note on that payload shape is
  the precedent and should be followed exactly.
- `installed_bases` must see VLM bases, and `Refused::NoBaseInstalled` should,
  for a vision base, offer the download rather than only naming it.

### V3 — The page

- `SEES_PICTURES = true`.
- `settleOneShot` needs no change — `canBeSentAPicture` already gates it.
- The attach path forks: OCR for text-only Pigeons (unchanged), pixels for
  vision Pigeons, **both** under option C. The chip grows a second line saying
  which is which.
- Whatever V0's receipt decision was, the bubble says it.
- `turn.js:704` vision row: `'sub'` → `'on'`, detail naming the model.
- The spec sheet entry at `app.js:2525` is currently a careful apology for
  there being no vision model. It gets rewritten, and the sentence *"Nothing is
  measured yet"* must not survive unless it is still true.

### V4 — Flight School

**One honest caveat about carrying the projector.** If Flight School trains
**LM-only** adapters — which is the safe constraint, see below — then the
projector a Pigeon carries is an *unmodified copy of the stock one* for that
base. Every vision Pigeon on the same base would carry byte-identical bytes,
which is what makes content-addressing (`projectors/<sha256>.gguf`) so
effective, and it does weaken the mismatch-impossible argument: a stock file
was never likely to mismatch. The decision still earns its keep for the case
that matters — a maker who **fine-tunes the projector too** (mlx-vlm allows it)
produces a Pigeon that cannot work with anyone else's copy, and under a
declared-not-carried design that Pigeon would be unshippable. Carrying it makes
the general case possible at the cost of the common case being redundant, and
content-addressing pays most of that cost back.

Out of this repo, and the reason V0 step 4 matters. Flight School, the sibling repo,
trains adapters with mlx-lm at rank 16 / scale 20 (`lora_alpha == 320`, asserted
by the converter). Vision adapters are **mlx-vlm**, not mlx-lm — a different
library with its own conventions.

**The constraint to hold to: LM-only adapters.** `scripts/convert-planner-adapter.sh`
runs `convert_lora_to_gguf.py`, which maps adapter tensors through the base's
*language model* tensor map. Vision-tower and projector tensors are not in that
map, so an adapter that touched them will either fail conversion or, worse, have
those tensors silently dropped — an adapter that loads cleanly and is missing
half of what it learned. That is the same failure mode as the `alpha == 320`
bug the converter already guards against, and it deserves the same treatment: an
assertion in the converter on the tensor names, not a note in a README.

Owed there: whether mlx-vlm's scale convention
matches (the mlx-lm-applies-`scale`-directly vs PEFT-applies-`lora_alpha/r`
distinction cost a failed step once already), and whether the converter's
assertion still holds.

---

## What I'd do first

**V0's first remaining item** — `--mmproj` and `--lora-scaled` on one server,
together. It is an afternoon, it needs no app code, and it is the difference
between "a vision Pigeon is an adapter like every other Pigeon" and "the format
needs a new idea". Every phase above is written assuming the answer is yes. If
it is no, the plan changes shape entirely, and better to know that before
touching `Fit`.

**Then the Game Boy Pigeon**, ahead of anything with receipts or dog breeds in
it. It is the only job on the list whose corpus labels itself, it trains in five
minutes with 6.5 GB to spare, and it is visibly working or visibly not — which
makes it the honest end-to-end test of every piece this document describes, from
the carried projector to the page that draws the reply.

## Peek, and the two answers to "what does a picture do?" (2026-09-25)

Every contact answers that question one of two ways, and every surface that
mentions a picture says which (`pictureLine` in `src/ui/pigeons.js`: the
picture button, the chip, the Pigeon's page, the developer facts, the
thread's badge):

- **It sees the picture itself.** Peek, and a picture Pigeon — one whose file
  asks for pictures (`inputs`) *and* whose base can see (a carried projector).
  The pixels go to the picture server.
- **It reads text only.** Patch, Pen, and every other Pigeon, including a file
  that asks for pictures on a text base. Apple Vision reads the words off the
  picture on this Mac, the person checks them, and only those words go.

**Peek** is the third Pigeon that comes with the app: the picture model as it
comes (`peek_parts()` in engine.rs, read from models.json — Qwen3-VL-2B Q4_K_M and
its Q8_0 projector), with every picture Pigeon on that server named at 0. It
answers the way that model answers: no instruction of Pigeon's and no guard on
figures (`runPlain` in `src/lane-b/chat.js`), so a count or a price read off a
picture is shown, and the reply is still drawn as written and checked by
nothing. Its chats carry `personaId: '@peek'`, which `plain_id` can never
produce. It shares the picture server with the picture Pigeons on the same
base, so switching between them never restarts it. Measured: 2.5 s from cold
for a 111-token picture, 0.2 s for words alone after that.

**Its model is `models.json` › `picture`** — base and projector, pinned by URL,
size and SHA-256, never part of the first-run download or the fit arithmetic.
Peek's page offers it (`models_download_picture`, the 58th command) with its
size and its terms: Qwen3-VL-2B is Apache 2.0 (`licences/Qwen-Apache-2.0.txt`,
written beside the weights before the first byte).
