> **These are the development notes, kept as written.** They were the README
> until the source was opened, and they record how the app got to where it is:
> the measurements, the dead ends, the corrections. Some passages describe
> things that have since changed (Pigeon no longer runs `llama-server`; the
> engine is in-process). The current overview is the [README](../README.md).

# Pigeon

**The model plans, JS executes, the model phrases.**

The smallest of the Airoplane Mode apps, built to the spec in
`Pigeon — Spec Sheet v0.1` and named from `pigeon-skill-index-v0.md`. Every
number, date, conversion, lookup and validation in a reply comes from a
verified JS function. Nothing computed is generated.

```bash
npm install         # once — pulls the Tauri CLI, the only dependency
npm run dev         # the app in its own window, with both model servers
npm run dev:fast    # the same, router-only — no models, instant replies
npm run tauri build # a release bundle for whatever OS you are on
```

`npm run dev` starts the static server and the two model servers together
(`scripts/dev.mjs`). The window opens as soon as the static server answers; the
models take 15–30 s to load and Pigeon switches from router-only to the
adapter and planner when they are up (Settings › Models says which). Nothing is required: without a
`llama-server` or the weights the app runs router-only and says so. Ctrl-C
stops all of it. `npm run models` still starts the servers on their own, which
the benches need.

On macOS the prerequisites are the Xcode command-line tools
(`xcode-select --install`), Rust (`rustup`) and Node 18+. The bundle lands in
`src-tauri/target/release/bundle/`: `macos/Pigeon.app` and
`dmg/Pigeon_0.1.0_aarch64.dmg` on Apple Silicon. It is not signed or notarised;
it opens normally on the machine that built it, and another Mac will want
right-click → Open the first time. On Linux the same command produces `deb`,
`rpm` and `appimage`.
```bash
npm test     # 5,000+ checks: every example executed, every error case, the Phase 0 gate
```

`npm run dev` starts the static file server and opens the Tauri window against
it. Frontend edits are live on reload (**⌘R** on macOS, **Ctrl+R** elsewhere) — the server
reads from the working tree, so there is no build step between editing a skill
and using it. `npm run serve` runs the server alone if you would rather test in
a browser at `http://localhost:4173`.

The only dependency is `@tauri-apps/cli`. Nothing is compiled, bundled or
transformed on the JS side; the two Altimeter typefaces ship in `fonts/` (see
`fonts/OFL.txt`), so the UI makes zero network requests.

**The shell.** `src-tauri/` registers **fifty-seven** `#[tauri::command]`s and
`capabilities/default.json` grants only `core:default`. One rule holds across
all fifty-seven: **the page says what, never where.** `llm_complete` and
`llm_status` take a *role*; `web_search` takes a *query*; `load_state` and
`save_state` take a *JSON string*; `ocr_image` takes an image's *bytes* as the
raw IPC body and `ocr_status` takes nothing; `engine_wake`, `engine_sleep`,
`engine_status`, `models_download`, `models_cancel` and `models_status` take
nothing at all; `chat_complete` takes messages and a *persona's name*, and
`personas_list` takes nothing; `screen_capture` takes nothing and hands back
a PNG made in memory, which never touches disk. Not one accepts a URL, a host or a path — those are built in
Rust from constants, from the manifest compiled into the app and from the
app's own data directory; the bytes an image arrives as go to the text reader on
stdin and never touch disk. Everything else in the frontend is pure
computation over values the user typed.

**Two lanes.** The verified lane is everything above: a model picks a skill, a
tested function produces the value, a template renders it and every figure says
where it came from. The **chat lane** is the opposite and says so — a model
writes the words, nothing is computed, nothing is checked — and it exists
because the verified lane permanently cannot chat, explain or keep company.
Who you message decides the lane — Patch is the verified lane; Pen, Peek and
every imported Pigeon are the chat lane — and a conversation carries its lane
for life, so a thread is never half one and half the other.

The wall between them is structural, not a promise. `src/lane-b/` imports
nothing from the rest of `src/` — not the registry, the executor, the reply
builder or the fabrication audit — and `npm test` fails the build if that ever
changes (`src/lint-imports.js`). A generated reply therefore has no segments,
no values and no provenance to render. Both lanes run on the same
`llama-server`, and cannot reach each other there either: the router uses the
one endpoint that takes a grammar and ignores per-request adapters, the chat
lane uses the one that honours them, and a test asserts the router's answers
are identical before and after the chat lane has been talking.

**A persona cannot compute.** Ask the chat lane something whose answer is a
figure and any number it states that you did not give it — spelled out or not —
is dropped before you see it, with the offer to hand the question to the
verified lane, where it comes back from a function. `npm run bench:laneb`
measures that against the questions the other lane was benchmarked on: zero
shown replies stating a figure, and zero ordinary chat answers eaten by
mistake. Personas themselves are LoRA adapters trained elsewhere; none exists
for this base model yet, so the lane currently talks in the base model's own
voice and Settings › Models says so.

**Its own engine.** A built Pigeon carries `llama-server` (`src-tauri/binaries/`,
a Metal build, relinked by `npm run sidecar` to load OpenSSL from the
bundle so a Mac without Homebrew can run it) and fetches its two models on
first run — pinned by URL, size and SHA-256 in `src-tauri/models.json`, the
exact bytes the bench was measured on — into its own data directory, writing
the licence notices beside them before the first byte arrives. The download
resumes, verifies, and never renames a short or mismatched file into place.
The Rust shell spawns the servers, waits for `/health`, and kills them when
the window closes; a server a dev script already started on the port is
adopted and left alone. The `engine` and `models` rows in Settings › Models
(under Details for developers) say which of
these is true, and a first-run sheet asks before anything downloads. Skip it
and Pigeon still answers about one question in six, instantly.

One correction worth keeping, because it misled for a while: app-registered
commands are **not** gated by `capabilities/default.json`. That file governs
plugin permissions, and Pigeon uses no plugins. The boundary is what
`invoke_handler` registers and what each command will accept. A future feature
that needs disk goes through a new
command and a new permission, never through a relaxed CSP.

**Patch.** The bird is the owner's own art — grey pigeon, round glasses, amber
beak — as a sprite sheet (`assets/patch-sprites.png`, 12 × 17 cells of
160 × 144, feet on one ground line). He is the app's one illustrated character;
everything else in the UI is line art or type. `src/lib/patch.js` names the
sheet's animations and draws one frame; `src/patch-life.js` steps through them:
the perch on the empty chat breathes, looks about, pecks, paints, waves, turns
to face the pointer, sits down and dozes off after a quiet minute and hops
awake. Poke him. Keep poking and he has opinions. His face is the app icon
(`assets/app-icon.png`), and the same picture travels in `patch.pigeon` as
`icon.png`.
Under `prefers-reduced-motion` he is a still drawing.

---

## Running the models

Pigeon works with no model at all — that is §11's router-only mode and it is a
supported state, not a degraded one. Two optional local servers improve it, and
they are independent: either, both or neither may be running.

The web tier needs no key and no account: it asks DuckDuckGo and Wikipedia,
both of which take a bare query string. Neither is required — they fail
independently, Wikipedia rate-limits a burst with a 429, and a request only
fails when both gave nothing. It is also the reason `reqwest` carries a TLS
feature: until the web tier existed the only thing Rust contacted was
`http://127.0.0.1`, so it was built without one, and every `https` request
failed at connect the first time one was made. `cargo test --lib -- --ignored`
is the live check for that; the ordinary suite is offline and cannot catch it. `npm run webcheck` checks they still
answer, and in the shape the skills parse; it is deliberately not part of
`npm test`, which runs against recorded replies instead.

```bash
# the planner — writes the plan, sees the shortlist
llama-server -m Qwen3.5-2B-Q4_K_M.gguf --port 8099 --host 127.0.0.1 -ngl 99 -c 8192

# the category adapter — names the neighbourhood, refuses when unsure
llama-server -m Qwen2.5-1.5B-Instruct-Q4_K_M.gguf \
  --lora pigeon-category.lora.gguf --port 8101 --host 127.0.0.1 -ngl 99 -c 8192
```

In the built app the Rust shell starts both itself, from the bundled
`llama-server` and the weights the first run fetched. In development `npm run dev` starts both from the script
alongside the app and the shell adopts them; `npm run dev:engine` starts none
from the script so the shell's own spawn path is exercised; `npm run models`
starts them on their own for the benches. Pigeon switches from router-only
mode when a role is ready — pushed by the engine in the app, probed every few
seconds in a browser. The category adapter is the one committed in `model/`.
The dev script uses `llama-server` from `PATH` if there is one (`brew install
llama.cpp`), otherwise the build in `src-tauri/binaries/`; on Linux, a Vulkan
build named by `LLAMA_SERVER`. `LLAMA_SERVER` overrides any of
these, for the shell too. Ports are `PIGEON_LLM_PORT` and
`PIGEON_CATEGORY_PORT`; the webview never sees a URL, only the role name, and
Rust maps that to a loopback port.

The adapter is trained by `train_category_lora.py`, converted with llama.cpp's
`convert_lora_to_gguf.py`, and graded by `npm run bench:planner -- --router
category --category-base http://127.0.0.1:8101 --trained --min-confidence 0.80`.

---

## Reading an image (experimental)

Paste a screenshot into the box, drop an image on the composer, or press the
image button beside the box, and Pigeon reads the text in it — with no
vision model, for Patch, Pen and any Pigeon that takes text. macOS's own text
recogniser (the Vision framework, through
the bundled `pigeon-eye` helper's `ocr` subcommand) does the reading, and the
planner (when one is up) tidies what it read. The result sits on the composer
as a chip: the file, its size, how many words, and whether the text is as read
or tidied. Open it to see and correct the text before sending. What you type is
the question; the text goes underneath it, and the router and planner see the
two together exactly as if you had typed both.

Nothing is installed for this. A developer who wants Tesseract instead names
one with `PIGEON_TESSERACT=/path/to/tesseract`; otherwise it is never looked
for. Without a planner the reading goes in exactly as it was read and the chip
says `as read`. The `vision` row in Settings › Models reports which reader is
running, and it is amber either way: a text recogniser is a stand-in for a
vision model, not one.

Two contacts are handed the **picture itself** instead: **Peek**, the picture
model Pigeon ships with (its model, Qwen3-VL-2B, is a separate download from
Peek's page), and any imported
Pigeon trained on a picture base. Their replies are the model's own words,
marked as written. A picture is kept in memory while Pigeon is open, so Try
again and Edit can send it again; it is never written to disk, and after a
relaunch the turn asks for it to be attached again.

**The tidy pass writes input, not output** — which is the reason it is allowed
to exist in a project whose whole argument is that a model must not write text
the user takes as an answer (`src/focus.js` makes that case). The model is asked
to repair only what OCR breaks: a line broken inside a sentence, `Tota|` for
`Total`, a space before a comma. Its answer is then checked with the same number
extractor §8 uses on replies: a number in the tidied text that the reader never
saw means the model made it up, and the tidy is thrown out for the raw reading.
So `1O apples` tidied to `10 apples` is **discarded** — 10 is not a number the
engine read — and the chip says `as read — introduced the number 10`. That is the
safe direction for the check to be wrong in: the price of a false positive is a
broken line, the price of a false negative is a number nobody read. A tidy that
comes back empty, or at less than half or more than one and a half times the
length, is thrown out the same way. Either version can be chosen on the chip
and either can be edited; the trace under Show plan says which was sent and, if
the tidy was discarded, why.

Only the **text** reaches the conversation and `state.json`. The pixels stay in
the composer and are gone when the chip is; the raw reading, the tidied one, and
the one sent are all kept on the turn, untruncated, under the raw plan. A long
reading is capped at 4,000 characters on its way to the router so it cannot
crowd out the planner's cards; the full text is still on the record. Editing a
question asked with an image shows the composed text — question and reading in
one box — which is acceptable for an experiment and is noted here so it is not
mistaken for a design.

Two shell details. The bytes cross to Rust as the raw IPC body — a `Uint8Array`
handed straight to `invoke` — so `ocr_image` has no field a path could arrive
in. And the window's own drag-and-drop handling is **off** in
`tauri.conf.json` (`dragDropEnabled: false`): with it on, the shell intercepts
a dropped file before the page sees it and hands Rust a *path*, which is the
one thing the page must never hold. Off, the page receives an ordinary HTML5
drop with the file's bytes, and the path-carrying event is never emitted at
all. Opened in a browser, `scripts/serve.mjs` runs the same binary with the same
arguments on `/__ocr`, so the chip can be tried without a window.

**Nothing is measured yet.** There is no accuracy figure for the engine on the
kinds of image people actually paste, and none for how often the tidy is
accepted, discarded, or wrong in a way the number check cannot see (a name, a
word). The ledger row says so. `npm test` proves the audit's branches on a stub
model, and `cargo test` reads a fixture PNG through the real engine when one is
installed.

---

## Privacy

Nothing you type leaves this Mac unless you press **Look it up** and then
**Send** on the exact words shown; Settings › Privacy keeps the log of what
did. The same tab says what the app writes to disk — chats, settings, the
look-up log, a playing Pigeon's game frames, and the key the local model
servers answer to — all under this app's own folder in Application Support,
unencrypted beyond your Mac's login and FileVault, and never sent anywhere.
The spec's Privacy tab is in [docs/MESSAGES-WITH-RECEIPTS.md](MESSAGES-WITH-RECEIPTS.md).

---

## What's here

| | |
|---|---|
| Skills built, tested, routable | **301** — every Core and Standard row in the index |
| Registered but unbuilt | **7** — registry entries only, excluded from the router index. Three of them are blocked on a canvas, which §3.3 forbids |
| Hand-written examples | **1,510**, each executed by the test suite and compared to its stated output |
| Error cases | **920**, each asserted to fail with the error code it claims |
| Reply templates | **301** — every built skill can answer without a model |
| Categories | 23 |

Skill names follow `pigeon-skill-index-v0.md` exactly (`convertLength`, not
`convertUnit`; `evaluateExpression`, not `calculate`). Where the index and an
earlier guess disagreed, the index won.

---

## The four passes (§3)

```
Message
  → [1] Router      → candidate skills + confidence
  → [2] Planner     → ordered plan JSON
  → JS: validate plan
  → [3] Executor loop (JS)
        resolve refs → validate input → run skill → save result
        ↳ missing/invalid arg: Extractor, one retry, then ASK_USER or FAILED
  → [4] Assembler   → reply text, read-only access to results
  → UI render with provenance marks
```

`src/turn.js` runs exactly this. Passing a real `planner` and `assembler` takes
the other branch at each seam — §11's requirement that the fallback be "a config
flag, not a rewrite".

### What is real, and what stands in

The spec's §12 keeps a Reality vs. Aspiration ledger because over-claiming is
this project's most likely failure. The app has a **Ledger** screen carrying the
current one, and Settings › Models shows the short version. Summarised:

| Component | State | Notes |
|---|---|---|
| Contracts, registry, executor | running | Envelopes, plan grammar, `ctx`, `ASK_USER`, the JSON-Schema subset and its linter |
| Core and Standard skills | running | 301, with schemas, ≥5 examples and ≥3 error cases each — every Core and Standard row in the index |
| Template-first replies | running | Single-step plans render in JS; the chat model never runs |
| Fabrication auditor | running | Numerals *and* number words traced to results or the message |
| Provenance UI | running | computed / bundled / web marks, dated tables, inline failures, Show plan |
| **Chat UI** | **running** | Copy, edit-and-ask-again, and ask-again on every turn; clicking a marked value opens what the skill was given and what it returned, untruncated; "Show plan" draws the turn as a sequence of stages with the raw plan one click further in. A question in flight is drawn as a turn, reporting what the pipeline is actually doing as it does it — finding the skill, planning, running it — and the answer is typed out on arrival. There is no token stream to show: the reply is rendered from templates once the skill has run, not generated, which is the same property that stops it fabricating a number. The progress is real events rather than a timed animation |
| **Branching** | **running** | A conversation is a tree. Editing a question or asking again adds a version beside the old one; `‹ 1/2 ›` walks between them and the branch you left keeps everything under it. Chats saved before branching existed are walked into the tree on load |
| **Router** | **stand-in** | The *structure* §3.1 specifies — per-example vectors, max-sim, previous-turn bias, calibrated threshold — with a TF-IDF backend instead of an embedding model. recall@5 73% at 301 skills, down from 98% at 100. With the category adapter in front of it, the share of questions whose right skill reaches the planner rises from 80% to 84% |
| **Extractor** | **stand-in** | Schema-driven JS instead of the adapter — no LoRA is trained for it either |
| **Category adapter** | **running when reachable** | A LoRA fine-tune of Qwen2.5-1.5B that names a request's category before word matching runs, so skills sharing no vocabulary with the question are still reachable. 88% of categories right and 24 of 25 nonsense messages refused, in 64ms, on a holdout used for neither training nor tuning. Refuses below 0.80 confidence and hands back to the lexical router when it does |
| Planner adapter | trained once, not shipped | No LoRA for the *planner* yet; it is a stock model behind a grammar. `npm run plannerdata` now builds **1,728 rows** from the skills' own examples, each one executed before it is kept, with zero overlap with the bench that would grade it. Round 1 was trained on MLX in 2 hours and graded on that bench: **162 of 302 at 4 leaks** — it fixed the 1.5B base's leaking (30 → 4) but lost accuracy to sibling-skill confusion and learnt to invent arguments, so the prompted 2B (212, 4 leaks) stays. `model/planner-data/README.md` has the numbers and what round 2 changes |
| Planner (external model) | running when reachable | An external llama-server is used as the planner if one answers on the loopback port, through a Rust command. With the category adapter routing, **248 of the 302 holdout questions come out right (82%)** — 200 answered from the data in the message and 48 answered with a question, because the message carried no data — with 8 of 50 no-skill messages leaking. The last 13 came from two prompt changes and no model change: a demonstration in the planner's shots of choosing a skill and leaving out an argument the message does not contain, and a *second look* when the planner declines but the category adapter named a category — a selection question over the router's top three with "none" allowed (12 fired, 11 right). A pairwise sibling check was measured on the same bench and not shipped: shown two full cards, the 2B broke more correct picks than it fixed (`verify.js` carries the numbers). That is up from 212 on the same model and prompt, from a card audit: the bench's misses were mostly the wanted skill never reaching the planner because the holdout's wording ("need a fresh guid", "how many beats in the word") shared no vocabulary with the skill's examples, so 124 examples were added across 65 skills — each executed, each checked against the bench with the category set's own four collision rules so none is a paraphrase of a bench question. Raising the shortlist cap to 30 or 40 changed nothing (213), which is how the absences were traced to routing rather than the cap. Measured 2026-09-03, 26.5% of its plans carried a number the message never contained — on a request with no data ("read this csv into columns") it invented the data rather than leaving the argument out. `audit-input.js` now closes that: a payload or a number the message cannot account for is dropped before the step runs, and the executor's ASK_USER path asks for it instead. The bench scores such an ask as correct, separately, because it is. The gain over the plain prompt (47%) is a short "about" field the model writes before naming a skill, granted only when the adapter has named a category — see `runway: 'auto'` in `planner.js`. Falls back to §11's router-only single-skill mode when nothing is listening |
| **Assembler** | **selection pass, not a writing one** | No model writes a reply in the verified lane — the chat lane is a separate path and does not fill this seam. §8's seam is filled by `focus.js`: a long web answer is split into sentences by JS, the model replies with a sentence **number** under a grammar that admits nothing else, and JS renders that sentence verbatim with the same source link. Asked who governs Maryland, the reply is the one sentence naming the governor instead of three about the office. The model's contribution is an integer, so it cannot rephrase or invent a name — and the auditor could not have caught it if it could, since §8 traces numbers, not names. It writes a few words naming what the question wants before the number: 2 of 6 labelled passages without that, 8 of 8 with it. A refusal, an unreachable model or a one-sentence answer leaves the passage whole. A multi-step turn is reduced with **no model at all**: the plan says which step is the answer, since a step another step consumes is working — so "20 * 200 = 4000 4000 / 10 = 400" becomes "4000 / 10 = 400". Independent steps, and any turn with a failure, still concatenate |
| **Web skills** | **running when switched on** | `webAnswer` and `webSearch`, via a Rust command that owns the two endpoints it may contact — the page sends a query, never a host. Off by default, behind a header switch and a per-request confirmation. Answers carry their source; neither skill summarises, so nothing can be added to what the page said |
| **Category adapter weights** | **in this repo** | `model/` carries the 35 MB adapter the app loads, the trainer, and the 6,142 training rows — so it can be run as-is or rebuilt from scratch. The 70 MB PEFT output is not committed; git keeps every version of a binary forever and that one is recoverable by rerunning the trainer |
| **Chat history** | **running** | Conversations are saved to one file, `state.json`, in the app's own data directory, through two named Rust commands — the page hands over a JSON string and never a path. Written atomically (temp file, then rename), so a crash mid-save leaves the previous transcript whole. No `localStorage` copy. Nothing leaves the machine. In a browser, where there is no bridge, the session is discarded on close and the rail says so |
| **Reading an image** | **experimental, stand-in** | The Mac's own Vision recogniser (through the bundled `pigeon-eye`) reads the text in a pasted, dropped or chosen image through a Rust command that takes the bytes and nothing else; the planner, when up, repairs OCR damage and its answer is audited with §8's number extractor — a number the engine never read discards the tidy. The text is input, shown and editable before it is sent; no model writes a reply. Text only reaches the disk. No accuracy figure yet |

The `NETWORK_OFF` branch and `provenance.kind: "web"` were built and tested long
before anything used them. When the web tier arrived it needed no changes to
either — which is the argument for writing the contract before the feature.

---

## Honest numbers

**The live table is `model/BENCH.md`**, written by `scripts/benchqueue.mjs`
from recorded runs; the figures in this section are the history behind it.
On 2026-09-08 the bench was widened to 100 no-skill messages, because 50 moved
by ±2 between identical runs and no leak result could be read. Every "x / 50"
below is on the old set.

The shipped configuration now measures **292 of 308 correct (95%)** and **20
of 100 leaks** at about 1.9 s a turn. It got there from 263 in one day without
touching a model: argument-shape fixes in JavaScript (+9), contrasting
descriptions across the sibling pairs the bench had caught (+17), and a lint
over all 46,971 skill pairs that found 35 more no bench question had ever
tested (+3). Wrong-skill picks fell from 32 to 10 over the same day.

`npm test` measures these. They are not the spec's §8 targets, because §8
measures a planner adapter that does not exist; they are what *this* build can
claim. Figures recorded here before 2026-09-02 do not reproduce — the holdout was
rebuilt to remove questions that overlapped the skills' own examples, so anything
older was scored on an easier exam. Re-measure a baseline in the same session
rather than quoting a stored one.

The registry's own examples cannot be used to tune or grade the router — they
*are* its index, so they score 0.65–0.97 and every constant looks excellent.
`scripts/holdout.mjs` holds one phrasing for every built skill that appears in
no skill's `examples[]`, split in two:

- **`HOLDOUT_TUNE`** (157) — what `npm run sweep` fits the router constants to.
- **`HOLDOUT_GRADE`** (145) — what `npm test` grades. No tuning script imports it.

That split is new, and it matters more than it sounds. The same router scores
**83%** recall@5 on the half its constants were fitted to and **73%** on the
half they have never seen. Grading on the tuning set would have reported the
first number.

A second correction came out of building it. Fifteen holdout phrasings turned
out to be token-identical to one of their own skill's examples once numerals are
dropped — and numerals are exactly what the router discards. Two were literal
copies. They were being graded as unseen while being the training text, and
rewriting them cost four points of recall@5 and five of top-1. The numbers below
are the ones after that.

Against `HOLDOUT_GRADE`, plus 50 hand-written no-skill messages:

| Metric | Result |
|---|---|
| Routed to the **right** skill | 34 / 145 (23%) |
| Routed to the **wrong** skill | 11 / 145 (8%) |
| Declined (offered as ranked suggestions) | 100 / 145 |
| **recall@5** — what a planner would see | **106 / 145 (73%)** |
| No-skill messages wrongly accepted | **3 / 50** |
| Fabrication rate | 0, by construction — no model is in the reply path |

**Three findings worth stating plainly, because all three are the uncomfortable
read:**

**1. The absolute guarantee died at 42 skills.** At 42 there was a threshold
that made *zero* wrong-skill calls. At 100 there was none. At 301 the rate had
to move again, from 5% to 8%. That property belonged to a small registry, not
to the router, and the test that asserted it is a rate now rather than an
absolute.

**2. What recovered the loss was a margin, not a higher bar.** Nearly every
wrong call was a near-tie between neighbours — `percentOf` against
`whatPercent`, `countWords` against `wordFrequency` — where the winner cleared
the threshold comfortably and the runner-up was a hundredth behind. A score that
high says *this message is about arithmetic*; it does not say which arithmetic
skill. Requiring a gap to the runner-up cut wrong calls while **increasing**
correct ones. A tie now goes to the user as a two-way suggestion, which is the
honest outcome: the router genuinely does not know.

**3. recall@5 fell from 98% to 73% as the registry tripled, and no constant
touches it.** Measured at `t_skill` 0.35, 0.375 and 0.45, recall@5 does not move
at all — it asks whether the right skill is in the top five, which is a question
about *ranking*, and a threshold cannot reorder a list. The threshold only
trades top-1 against wrong answers: a higher bar cuts wrong calls by declining a
large share of the questions it currently answers correctly.

This is the ceiling on everything downstream. The planner only ever sees the
router's top five, so a skill the router does not surface is one no model can
choose. Roughly one question in four is unanswerable before the model is asked.

**That is the case for §3.1's embedding model, and it is now three times louder
than it was.** The right skill is usually still in the top five; a lexical
matcher just cannot tell which. Closing that gap is an encoder's job.

### What the model adds, and what it cannot fix

Measured over all 302 holdout phrasings and 50 no-skill messages, with a local
Qwen3.5-2B:

| | Router alone | Router + model |
|---|---|---|
| Answered correctly | 53 / 308 (17%) | **232 / 308 (75%)** |
| Nonsense wrongly answered | 3 / 50 | **2 / 50** |
| Time per question | ~1 ms | ~2 s |

The model more than quadruples the hit rate. It is not writing any of the
answers — it only chooses a tool and fills in the arguments; the reply is still
rendered from a template by JS, which is why the fabrication rate above is zero
by construction rather than by measurement.

An earlier version of this table read 48% and 1 of 50, and said the model was
*better* at declining than the router alone. Both were true of a planner given
no room to think, which is also a planner that refused 86 questions it could
have answered. It now answers those and wrongly answers one more nonsense
message than the router alone does. That is the trade, stated rather than
smoothed over.

But the ceiling is the router. Of the 145 questions the model still gets wrong:

- **65 were impossible.** The right skill was never in the five it was shown,
  so no answer it could have given would have been right.
- **63 it declined** with the right skill sitting in front of it.
- **17 it picked wrong** when the right one was available.

So a little under half the remaining failure is the shortlist, not the model.
Feeding a better model the same five candidates cannot fix the 65; only a better
router can.

### Why the router misses

Every one of the 39 recall failures on the grading half scored **zero** — the
right skill was not ranked low, it was not ranked at all. They are synonym
misses:

| The question | The skill's examples say |
|---|---|
| "squash this text down" | compress |
| "shade #FFAA00 down 30 percent" | darken |
| "b64 this string for me" | base64 encode |
| "turn this .env content into an object" | parse these key value pairs |

Same meaning, no shared words, and a word-matcher matches words. No threshold
reorders a list to promote something that is not on it. That is the argument for
an encoder stated as plainly as the data states it.

**A recommendation withdrawn.** A category-first router — ask the model for a
category, then search only that category — was considered and is not
recommended. It cannot address the 65 impossible cases at all, because the skill
never enters the candidate list to be filtered. Of the wrong picks it might help
about 20, and it adds a model round-trip to every question. The measurement
that suggested otherwise came from a ten-case sample.

## Layout

```
index.html          Altimeter shell — tokens carried verbatim from the desktop app
src-tauri/          the windows: fifty-seven narrow commands, core:default only; engine.rs, download.rs, chat.rs, tray.rs, capture.rs
popover.html        the menu bar's window — src/popover.js, the second file that touches a DOM
bar.html            the summon bar, ⌘⇧P from anywhere — src/bar.js, the third and last; Patch only, on native glass (src-tauri/src/bar.rs)
src/lane-b/         the chat lane — imports nothing from the rest of src/, and a lint says so
assets/             icon sources (Patch)
src/
  contracts.js      §4 envelopes, error codes, plan refs, budgets
  schema.js         the JSON Schema subset, plus a linter that rejects the rest
  registry.js       registry views: routable() (stubs excluded), compactCard(), lint
  router.js         §3.1 — LexicalRouter, and the interface an encoder must satisfy
  plan.js           §4.4 plan grammar and its gate
  executor.js       §3.3 — the loop, ASK_USER, the network gate, provenance
  extractor.js      §3.4's seam, filled with schema-driven JS
  template.js       §3.5 — replyTemplate → segments (not a string)
  fabrication.js    §8 — the numeral and number-word auditor
  reply.js          template first, Assembler second, concatenation third
  focus.js          §8's seam: the model picks a sentence, JS renders it
  audit-input.js    a plan's values must come from the message; invented payloads become questions
  verify.js         the decline second look (shipped) and the sibling check (measured, not shipped)
  ocr.js            reading an image: the engine's transports, and a tidy pass the number audit can veto
  scripts/plannerdata.mjs   builds the planner adapter's training set
  turn.js           the four passes, no DOM
  app.js            the only file that touches the DOM
  patch-life.js     what Patch does between poses: gestures, habits, the eye
  lib/              dates, units, reference tables, arithmetic parser, text, patch
skills/             one module per skill; index.js is the manifest
scripts/            test, calibrate, sweep, holdout, no-skill set, serve, bundle
```

`src/lib/arith.js` is a hand-written recursive-descent parser, not `eval` — §3.3
says skills are pure, and an evaluator that reaches the JS runtime turns "do this
sum" into "run this program".

---

## Things worth knowing before changing something

- **`npm test` executes every example.** §11 names registry drift as the main
  maintenance risk and calls executing examples "the only thing that keeps it
  honest". A skill whose example no longer produces its stated output fails.
- **A stub cannot be routed.** `Registry.routable()` filters `unbuilt: true`, the
  router indexes only that list, and `validatePlan` rejects any plan naming one.
  Four separate checks assert it, which is why `skills/_extended-stubs.js`
  exists — without at least one stub they would all pass vacuously.
- **Re-run `npm run calibrate` and `npm run sweep` after adding skills, and add
  a holdout phrasing for each one.** The score bands narrow as the registry
  grows — that is how the zero-wrong property was lost between 42 skills and
  100. When they overlap, the fix is better descriptions and examples, not a
  nudged constant: `percentOf` and `whatPercent` stopped colliding when their
  descriptions stopped using the same words, not when the threshold moved.
- **`{{field|prose}}` opts a template token out of the computed-value mark.**
  §3.6 draws one distinction and it has to mean something. A caveat or a tense
  rendered mono-and-underlined says "this is a datum" about a sentence, which
  devalues the mark on every real number beside it.
- **A field the schema cannot know is needed is returned as `MISSING_FIELD`
  from `run()`**, and the executor turns that into ASK_USER. `convertCookingMeasure`
  needs an ingredient to cross between a volume and a weight and needs nothing
  extra to convert cups to millilitres; that is not expressible in the schema
  subset, so the skill says so at run time.
- **Do not name an input field `timezone`, `now`, `locale`, `units` or
  `webEnabled`.** Those are ctx-owned (§2.5) and `mergeInput` overwrites them
  before `run()` is called. `currentTime` takes a `zone` for exactly this reason.
- **Bundled tables carry `dataAsOf` and `contracts.js` throws without it.** A
  dated table that forgets its date is the failure this whole design exists to
  prevent.
- **Exchange rates are an input, never a table.** §9 of the skill index is titled
  "rates always supplied, never assumed", and a stale rate is the one kind of
  stale data that costs money when acted on. `convertCurrencyFixed` takes the
  rate; `currencyLookup` bundles only what a currency *is*.
- **Altimeter tokens are carried over verbatim** from the desktop app's `:root`.
  Treat them as the single source of truth; don't fork the values. Flat by
  default, glass only on the sanctioned gauges, shimmer in exactly two places.

## Next, in the spec's order

Phases 0, 1 and 3 are done. Phase 2 is done with a lexical backend *plus* a
trained category adapter in front of it. Every Core (98) and Standard (203) row
in the index is built; three image skills are registry-only because they need a
canvas, which §3.3 forbids. **2 of the 9 Web rows are built** (`webAnswer`,
`webSearch`), and the four Extended rows that were stubbed in this repo are now
built too — `expandRecurrence`, `solveQuadratic`, `wordleFilter`,
`nearestNamedColor`. The rest of Extended lives in the skill index rather than
here. Three skills stay unbuilt with a stated blocker: they need a canvas, and
§3.3 says a skill touches no DOM.

**The bottleneck is no longer finding the skill — it is committing to it.**

| | Answers correctly | Nonsense wrongly answered |
|---|---|---|
| Before this | 122 / 302 (40%) | 0 / 50 |
| Runway on, ungated | 215 / 302 (71%) | 14 / 50 |
| Runway gated on the router's score | 141 / 302 (47%) | 1 / 50 |
| Runway gated on the adapter | 208 / 302 (69%) | 2 / 50 |
| **What ships now** — plus contrastive descriptions | **232 / 308 (75%)** | **2 / 50** |

The runway — a free-text field the planner fills in before its constrained
choice — is worth **ninety-odd more answered questions**, because a planner that
has worked out what you meant commits rather than shrugs. It cost fourteen
wrongly-answered nonsense messages for exactly the same reason, which is why it
was off.

**Thirteen of those fourteen were on turns where nothing cleared the router's
threshold at all** — top scores of 0.15–0.32 against a bar of 0.375, on sentences
using a skill's vocabulary in an ordinary sense ("he is in his prime", "my streak
of bad luck finally ended", "shuffle along, nothing to see here"). The planner
was being handed room to reason about a shortlist that was noise.

Two gates were measured. Withholding the runway on the **router's own score** is
too blunt: it removed thirteen leaks and seventy-four correct answers with them,
because plenty of real questions score under the bar too — those are exactly the
ones the planner rescues. Withholding it when the **category adapter** declined
to name a neighbourhood keeps 208 of the 215 and cuts the leaks to two. The
adapter was trained to refuse; the word-matcher was not, which is the whole
difference.

The two that remain are named in the Ledger rather than rounded away: *"what a
day it has been"*, which the word-matcher over-scored at 0.54, and *"the whole
project is an anagram of chaos"*, which the adapter confidently filed under
`games`.

### Corrections to what this section used to say

Two claims here were overtaken by the work and are worth naming rather than
quietly deleting:

- It said the next step was **an encoder router**, on the argument that recall@5
  had fallen to 73% and no threshold moved it. A category adapter was built
  instead — a LoRA that names the neighbourhood before word matching runs — and
  it lifts the share of questions whose right skill reaches the planner from 80%
  to 84%, and answered-correctly from 108 to 122 of 302. An encoder may still be
  the better backend; it is no longer the *obvious* next step.
- It said **category-first routing** was doubtful, because 7 of 10 sampled
  planner confusions were between skills in the same category. That reasoning
  was about *filtering* a shortlist, not about *replacing* one, and it was wrong
  about the thing that was built. Measured, category-first wins.

### Skills that read alike, and the descriptions that fixed it

With the runway on, the largest remaining failure was not routing — it was the
planner picking a skill's near-twin. **32 of the 93 misses were a sibling in the
right category**: `countdownTo` → `daysBetween`, `base64Decode` →
`decompressText`, `perimeterOf` → `areaOf` for *"how much fencing round a 12 by
9 plot"*.

The cards already showed the difference (`needs: to` against `needs: from, to`)
and the model still chose wrong, because the *descriptions* did not contrast.
Two rules for rewriting them:

- **Give each skill the words its users would use** — "fencing", "guid",
  "beats", "un-base64" — and never the sibling's. Descriptions are in the
  router's index (`router.js:209`), so borrowing a twin's vocabulary would make
  routing worse while making the planner's job easier.
- **Stay verb-led.** The failure renderer says "Couldn't {description}", so a
  description starting with an article produces "Couldn't the distance round…".

56 descriptions rewritten. It moved both stages at once:

| | Before | After |
|---|---|---|
| Right skill reaches the planner (word matching) | 116 / 145 (80%) | **128 / 145 (88%)** |
| Right skill reaches the planner (with the adapter) | 122 / 145 (84%) | **131 / 145 (90%)** |
| Answered correctly | 211 / 302 (70%) | **230 / 302 (76%)** |
| Sibling confusions | 32 | **13** |

Nineteen questions recovered by writing better sentences, and no cost to the
no-skill precision. **13 sibling confusions remain**, and some look
irreducible from the message alone: `dayOfWeek` and `isWeekend` now swap in both
directions, because *"is 2026-07-04 a saturday"* is a fair question to put to
either. Those want a tie-break, not a better sentence — so one was built, and it did
not work.

### The tie-break, and why it is not switched on

One extra constrained question when the planner's pick has a same-category
twin: two cards, one name back, under a grammar that admits nothing else.
Measured on the same 308 questions:

| | Answered correctly | Sibling confusions |
|---|---|---|
| **No tie-break** | **232 / 308 (75%)** | **16** |
| Ask whenever a rival is close | 208 / 302 (69%) | 33 |
| Ask only when the router outranked the pick | 223 / 308 (72%) | 24 |

It costs answers and *adds* confusions. The reason is visible once the numbers
are: the planner reads the whole message against twenty candidates, and the
tie-break reads two cards. Asked alone the question looks easier, but the
context that would resolve it has been thrown away — and a confident second
opinion formed on less information is how you talk someone out of a right
answer.

`src/tiebreak.js` stays as a seam the benchmark can switch on with
`--tiebreak`, and is not wired into the app. The idea is reasonable and a better
model may make it pay; rebuilding it without knowing it was tried is what the
file exists to prevent. **The number to beat is 232 of 308 at 16.**

### Three attempts to make the planner braver, and the one that worked

The largest remaining bucket is **44 questions declined**, and 28 of those had
the right skill ranked FIRST on the planner's own shortlist. It is looking at the
answer and refusing. Three things were tried:

| | Answered right | Nonsense answered |
|---|---|---|
| Runway with no gate | 215 / 302 | 14 / 50 |
| Tie-break on twins | 223 / 308 | 2 / 50 |
| Rule telling it to commit with missing arguments | 230 / 308 | 4 / 50 |
| **Runway gated on the category adapter** | **232 / 308** | **2 / 50** |

The first three all made the planner more willing and all cost more than they
gained. The rule is the clearest case: told to name the skill and leave the
argument out, it invented the argument instead — ten more commitments bought two
questions, eight skill failures and two leaks. Rule 3 ("never invent a value")
turns out to go with rule 4's caution; loosen one and you loosen both.

**The one that paid did not make the planner braver in general.** It made it
braver only when something had recognised the request. That is the shape worth
copying: willingness conditioned on a signal, not willingness by instruction —
and a prompt has no signal to condition on.

So the 28 are not simple timidity, and the next attempt on them should carry a
signal the planner does not already have rather than another sentence.

### Four other planners, measured

Three newer small models plus a smaller sibling, each swapped in as the PLANNER
with everything else held constant — same category adapter on 8101, same 308
questions, same 50 no-skill messages.

| Planner | Size | Answered right | Nonsense answered | Declined |
|---|---|---|---|---|
| **Qwen3.5-2B** (what ships) | 1.19 GB | **232 / 308 (75%)** | **2 / 50** | 92 |
| Llama 3.2 3B | 1.88 GB | 243 / 308 (79%) | **42 / 50** | 10 |
| SmolLM3-3B | 1.78 GB | 243 / 308 (79%) | 19 / 50 | 38 |
| Granite 4.1 3B | 1.95 GB | 218 / 308 (71%) | 7 / 50 | 76 |
| Qwen3.5-0.8B | 0.49 GB | 180 / 308 (58%) | 6 / 50 | 92 |

**Nothing beat it, and judging on accuracy alone would have picked the worst
option.** Llama and SmolLM3 both answer eleven more questions — and answer 42 and
19 of the 50 nonsense messages respectively, against two. Llama declines just ten
things in the entire run; it is not more capable, it is less willing to say no.

The column that separates these models is not accuracy, it is **calibration**.
Every one of them trades refusals for answers at some rate, and Qwen3.5-2B sits
at the best point on that curve by a distance. Granite is simply worse on both.

`Qwen3.5-0.8B` is worth knowing about: **58% at 0.49 GB**, less than half the
size, with refusals nearly intact. Not a replacement — 52 answers is a lot to
give up — but it is the model to reach for if the memory budget ever halves.

Latency was not measured here: all four ran at once and shared one GPU, so the
timings in those logs are meaningless. Speed only becomes a question if a
challenger ever wins on both other columns.

### After that

- **A `web` category for the adapter.** It was trained to answer `none` to
  general knowledge — correct when nothing could look anything up — so web
  questions split roughly 54/45 between `reference` and `none` and never clear
  its confidence bar. The web skills are filed under `reference` so they are
  reachable anyway, and a second pass covers the rest. A 24th category is the
  real fix and needs a retrain.
- **The Assembler** (§3.5), one of the two rows the Ledger still marks *not
  built*. It is what makes a multi-step answer read as one sentence, and it is
  the moment `src/fabrication.js` stops being precautionary and starts being
  load-bearing.
- **The remaining 52 Extended and 7 Web rows.** Last on purpose: more skills
  lower the routing ceiling, so they are worth adding once the ceiling moves.
