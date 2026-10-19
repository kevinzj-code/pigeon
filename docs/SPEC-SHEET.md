# Pigeon — Spec Sheet

**The model plans, JS executes, the model phrases.**

Pigeon is a desktop assistant (Tauri 2, Rust shell, plain-JavaScript frontend)
that answers everyday requests — arithmetic, dates, conversions, text and data
tidying, lookups — by running one or more of 301 verified JavaScript *skills*.
Two small local language models help choose which skill to run and how to
present the result. They never compute anything and they never write a fact.

This document describes what the shipped build does on every turn, the gates
that keep it fast and honest, how it degrades, and the numbers behind each
claim. State as of branch `macos-port`, 2026-09-07, after the merge of the Linux build's branching UI, contrasting descriptions and four Extended skills.

---

## 1. Design goal: quick and reliable

Every design decision serves one pair of constraints:

| Constraint | How it is met |
|---|---|
| **Quick** | Most turns never call a model to write anything. Routing is a TF-IDF lookup in JS; a single-step answer renders from a template; the only model calls are short classification or selection answers under a grammar, at temperature 0. A model-planned turn averages about 2.1 seconds; a router-only turn is instant. |
| **Reliable** | No computed value ever comes from model weights. Numbers, dates, units and strings come from skill functions; web facts come verbatim from the page with its link. Every model output is constrained by a GBNF grammar and audited by JS before it can reach the user. When the input is missing, the app asks instead of guessing. |

The two are not in tension. The same rule — "the model chooses, verified code
produces" — is what removes both the latency of generation and the risk of
fabrication.

**Preference order** applied throughout the code: *derivation* (JS works it out
from structure) beats *selection* (the model picks from a menu under a grammar)
beats *generation* (the model writes prose). Generation is not used anywhere in
the shipped reply path.

---

## 2. Components

### 2.1 Processes

| Process | Role | Port | Model |
|---|---|---|---|
| Tauri window | UI, all pipeline logic (JS), 13 Rust commands, the engine that spawns the two servers below | — | — |
| Static server (`scripts/serve.mjs`) | serves the working tree in dev | 4173 | — |
| Planner server (`llama-server`, bundled) | writes plan JSON, picks sentences, answers second-look questions | 8099 | Qwen3.5-2B Q4_K_M, Metal |
| Category server (`llama-server`, bundled) | names a request's category or `none` | 8101 | Qwen2.5-1.5B-Instruct Q4_K_M + `model/pigeon-category.lora.gguf` |

In the built app the Rust shell starts both servers itself (`engine.rs`):
`llama-server` ships in the bundle as a sidecar, the weights are fetched on
first run into the app's own data directory (`download.rs`, §2.2), and the
window is told by event when each role is ready. Closing the window puts the
models to sleep; the app never holds a model it is not using.

`npm run dev` starts all of them (`scripts/dev.mjs`). The window opens as soon
as the static server answers; the models take 15–30 s to load, and the shell
adopts a server already answering on a role's port rather than starting a
second one — the dev script's servers are used, never killed. `npm run
dev:engine` (`PIGEON_MODELS=rust`) starts none from the script so the shell's
own spawn path is the one exercised. `npm run dev:fast` or `PIGEON_NO_MODELS=1`
runs router-only. Both model servers are optional and independent; the app is
fully usable with neither.

### 2.2 The Rust shell — eighteen commands, "what, never where"

| Command | Takes | Never takes |
|---|---|---|
| `llm_complete` | messages, grammar, max_tokens, temperature, **role** (`planner` / `category`) | a URL or port |
| `llm_status` | — | — |
| `web_search` | a **query** string | a host |
| `load_state` / `save_state` | a JSON string | a path |
| `ocr_image` | an image's **bytes**, as the raw IPC body (experimental) | a path, an engine, a language |
| `ocr_status` | — | — |
| `engine_wake` / `engine_sleep` / `engine_status` | — | a binary, a model file, a port, a flag |
| `models_download` / `models_cancel` / `models_status` | — | a URL, a destination |
| `chat_complete` | messages, a **persona's name**, sampling | a port, an adapter id, a grammar |
| `personas_list` | — | a path |
| `screen_capture` / `screen_capture_status` | — | a path, a display, a window id |
| `open_main_window` | — | a window label, a size, a position |

**The menu bar (§2.3).** Pigeon sits in the tray with a template icon —
Patch's head, one flat colour — and clicking it opens `popover.html`, a second
webview that runs the same pipeline through `src/stack.js` and draws values
with the same renderer (`src/segments.js`). It opens in the Verified lane and
that is not a setting; the chat tab is disabled until a model is awake. Its
status line is permanent and says what the app is holding: *resident · models
asleep · router only* by default, the 15–30 s cold start counted down while
waking, and the real resident total when awake. Closing the main window hides
it, sleeps both models and drops the Dock icon; quitting is in the tray menu.
Measured with the models asleep: **209 MB across three processes** — the app
and the router, not the weights.

**The capture (§5.8).** `screen_capture` takes no path and returns a PNG made
in memory from CoreGraphics; nothing is written to disk at any point, and a
test asserts no file appears while one is taken. The screen-recording prompt is
raised from inside that command and from nowhere else, so launching Pigeon
never asks for it. The popover shows the capture, the person drags over the
part they meant, and the crop is taken at full resolution and read by the
existing Tesseract path — the reading is input, marked `raw — no model`.

**The engine.** `engine_wake` locates each role's weights (an environment
override that names a real file, then `app_data_dir/models`, then the Loft
app's folder if it is installed), sizes them against this Mac (75% of RAM is
the budget, 85% of that the models' share, both estimates; the planner is kept
when only one fits), and for each role either adopts a `llama-server` already
answering on the port (200, or 503 while loading) or spawns the bundled one
with `std::process::Command` and the flags `scripts/models.mjs` uses, flag for
flag. Ready means `/health` said 200. An owned server is killed when the main
window is destroyed, when the app exits, when the state is dropped, and — since
a release build aborts on panic — by a pidfile sweep at the next launch that
kills only a `llama-server` on our port. An adopted server is never killed.
`engine-status` is emitted on every change.

**The chat lane (§3.6).** `chat_complete` is the one command through which a
model may write words a person reads, and it is a separate command from
`llm_complete` so that difference is visible in the handler list. It reaches
the SAME llama-server the category adapter runs on, through a different door:
the router uses `/completion`, the only endpoint that takes a grammar and one
that ignores a per-request adapter selection on this build; the chat lane uses
`/v1/chat/completions`, which honours one and where every loaded adapter is
named with its scale — the category adapter at 0, the chosen persona at 1. An
omitted adapter keeps whatever scale it was loaded with, so "base weights" is
said out loud. Personas are loaded inert at launch (`--lora-scaled path:0.0`);
with none on the machine the category server's launch line is byte for byte
the one the dev script has always used. A category server that will not start
with personas loaded is started again once without them, because Lane A's
routing must not be lost to a bad file in a folder. Naming a persona that is
not loaded is an error, never an answer from base weights.

**The download.** `models_download` fetches the two files pinned in
`src-tauri/models.json` (URL, size, SHA-256 — the bytes the bench was measured
on) into `app_data_dir/models`. Licence texts and an `ATTRIBUTION.md` are
written there before the connection opens. A `.part` is resumed with a Range
(a 200 instead of a 206 discards it), the host's total must equal the pinned
size, the hash covers the whole file across resumes, a short body keeps the
part, a bad hash deletes it, and only a verified file is renamed into place
with a `.sha256` record beside it. `model-download-progress` is emitted at
most every 150 ms and on every stage change.

`ocr_image` finds Tesseract in Rust (`PIGEON_TESSERACT`, then PATH, then
`/opt/homebrew/bin`, `/usr/local/bin`, `/usr/bin`) and runs it with the bytes
on stdin and a constant argument list; the image never touches disk. The
window's `dragDropEnabled` is false so a dropped file reaches the page as
bytes through HTML5 rather than as a path through the shell.

Roles map to loopback ports in Rust from constants and `PIGEON_LLM_PORT` /
`PIGEON_CATEGORY_PORT` (a non-numeric value falls back to the default). The
webview's CSP (`connect-src 'self' ipc: http://ipc.localhost`) admits no host,
so these commands are the only way out of the page. Web search contacts exactly
two public endpoints (DuckDuckGo Instant Answer, Wikipedia search), no key, no
account, 15 s timeout.

### 2.3 Skills

| | |
|---|---|
| Built, tested, routable | 307 across 23 categories (3 registry-only stubs remain, all needing a canvas) |
| Per skill | `inputSchema` (JSON-Schema subset, linted), `outputSchema`, `replyTemplate`, ≥5 executed `examples`, ≥3 asserted `errorCases`, `needsNetwork`, `dataAsOf` |
| Contract | pure function `(input, ctx) → ok(value, provenance) | fail(code, message, field)`; 2,000 ms per-skill budget |
| Provenance | `computed`, `bundled` (with a data date), or `web` (must carry a source URL) |
| Web skills | `webAnswer`, `webSearch` — return the provider's words, never summarise |

Skill examples are also the router's index and the planner's cards, so every
example is executed by the test suite and compared to its stated output.

### 2.4 Pipeline modules (`src/`)

| Module | Job |
|---|---|
| `router.js` | `LexicalRouter`: TF-IDF cosine over per-example vectors, max-sim per skill, light stemming, stopwords, previous-turn bias, calibrated gates |
| `category-router.js` | wraps the lexical router with the category adapter; orders the chosen category's skills, blends the lexical top pick |
| `planner.js` | prompt, shots, grammar and `runway` for the 2B planner; `renderCard` |
| `plan.js` | plan validation, `$ref` normalisation |
| `audit-input.js` | drops plan values the message cannot account for |
| `extractor.js` | schema-driven JS argument filler (stand-in for an adapter) |
| `executor.js` | the step loop: refs → ctx → audit → validate → extract → ask/fail → network gate → run |
| `verify.js` | `declineCheck` (shipped), `siblingCheck` (measured, off) |
| `focus.js` | sentence selection for web answers |
| `reply.js` | template-first reply, focused replies, answering-step derivation |
| `fabrication.js` | the §8 number audit |
| `contracts.js`, `ctx.js`, `schema.js`, `template.js` | envelopes, device context, validation, rendering |
| `llm.js`, `search.js`, `store.js`, `ocr.js` | transports to the four Rust seams; `ocr.js` also holds the tidy pass and the number audit that can veto it |
| `turn.js` | the four passes in order; no DOM |
| `app.js` | UI, wiring, ledger, probes |

---

## 3. One turn, stage by stage

```
Message
  → [1] Router        category adapter (64 ms) + lexical ranking → shortlist
  → [2] Planner       2B under a grammar → plan JSON            (~1–2 s)
        ↳ empty plan + category named → decline second look (top-3 + none)
        ↳ empty plan + web on          → web second look (web skills only)
  → JS: validate plan
  → [3] Executor      per step: refs → ctx → input audit → validate
                      → JS extractor (one retry) → ASK_USER | run skill
        ↳ skill rejects input + router disagrees → one replan with router's pick
  → [4] Reply         template (0 ms) | focused sentence | answering step
        → fabrication audit → segments with provenance marks
  → UI
```

### Stage 0 — resume or hand-written plan

- A pending `ASK_USER` is resumed by writing the user's answer into the step
  that asked and re-running the whole plan from the top. Skills are pure, so
  replaying costs milliseconds and yields one inspectable execution. The answer
  is added to the input audit's `known` text.
- A hand-written plan (Run a plan screen) skips stages 1–2 and is not audited:
  the person typed the values.

### Stage 1 — Router (always runs, no model required)

1. **Category adapter** (if reachable). One `llm_complete` with role
   `category`, grammar over the 23 names + `none`, max 12 tokens, temperature 0,
   confidence requested. Below **0.80** confidence the answer is discarded.
   Measured: 88% category accuracy, 24/25 nonsense refused, 64 ms. The adapter
   names a category on 280/302 real questions and 1/50 nonsense messages, which
   is the "is there a skill here at all?" signal the rest of the turn relies on.
2. **Lexical ranking.** Skills in the named category, ordered by TF-IDF score,
   then the category's zero-scoring members (the ones word matching could
   never reach), capped at 20. The lexical router's own top pick is blended in
   if it lies outside the category. With no category, the plain lexical router
   answers.
3. **Gates**, swept on a tuning holdout and graded on a separate one:

   | Gate | Value | Meaning |
   |---|---|---|
   | `plannerFloor` | 0.10 | everything above this reaches the planner |
   | `threshold` (t_skill) | 0.375 | bar to act without a planner |
   | `marginFloor` | 0.12 | top must beat runner-up by this to be `actionable` |
   | `suggestFloor` | 0.22 | "did you mean" band, shown, never run |

   Output: `candidates`, `forPlanner`, `actionable`, `suggestions`, `category`.
   If nothing clears the planner floor the turn ends as **no-skill** without
   touching the planner.

### Stage 2 — Planner (model, when reachable)

- **Input:** the shortlist rendered as compact cards (name, description,
  `needs:` fields), the device `TODAY`, the message. Six demonstrations show:
  a web lookup, a date, an empty plan for a writing request, a two-step plan
  with a `$s1.currency` ref, an **empty input** (`formatJson` with `{}` for
  "make this json readable please"), and a ref inside an expression.
- **Rules** the prompt states: only listed skills; empty plan is a correct
  answer; copy values, never invent; leave out what is not in the message
  (code will ask); `$sN.field` refs; JSON only.
- **Grammar:** the plan JSON with skill names restricted to the offered cards,
  ids `s1..s8`. The model cannot name a skill it was not shown.
- **Runway (`runway: 'auto'`).** When the router is confident (an actionable
  pick, or the adapter named a category) the grammar admits a short `"about"`
  field before the steps. Measured: a runway on every turn answers 22 of 50
  nonsense messages; gating it on the adapter keeps leaks at 8 while lifting
  correct answers from 142 to 212 on the same model. The field is discarded.
- **Budget:** 200 tokens (+60 with runway), temperature 0, 60 s transport
  timeout. A model that reasons before its first answer token is the whole
  gain; nothing is generated for the user here.
- **Decline second look** (`verify.js declineCheck`, shipped). If the plan is
  empty but the adapter named a category, the router's top three cards are put
  to a selection question with `none` allowed, under a name grammar. A named
  skill goes back to the planner as one card; if the planner declines again,
  the turn proceeds in single-skill mode with an empty input and the executor
  asks for the data. Measured: fired 12 times on the holdout, 11 right.
- **Web second look.** If the plan is still empty and the web switch is on,
  the planner is asked once more with only the web skills on the table. Any
  step naming a non-web skill is dropped. Measured: no change in leaks.
- **Trust-router, fallback-on-empty, sibling check:** all measured on the
  bench and switched off (121 correct; +1/+1 leak; broke more than it fixed).
  The flags remain for re-measurement.

Without a planner the turn takes §11's fallback: one step, the router's
actionable pick, empty input, extractor fills what it can.

### JS: plan validation

`validatePlan` rejects unknown skills, more than **8 steps**, malformed ids,
refs to steps that do not exist or run later, and refs to fields not in the
producing skill's output schema. An invalid plan is reported as such; nothing
runs.

### Stage 3 — Executor (JS)

For each step, in order:

1. **Resolve refs** — `$s1.result`, `$prev.s2.value`, and refs embedded in
   strings (`"$s1.result * 10"`). Unresolvable ref → `UNRESOLVED_REF`, step
   fails; a wrong answer is worse than an absent one.
2. **Context wins** — `now`, `timezone`, `locale`, `units`, `webEnabled` come
   from the device; the model can neither supply nor override them.
3. **Input audit** (`audit-input.js`) — a *payload* string (≥40 chars,
   multi-line, structured, or ≥2 commas) or a multi-leaf object must be found
   in the message, an earlier result, or the user's ASK answer, whitespace and
   case ignored. A *number* is dropped only when the message contains no
   quantity at all. Enums, short strings, defaults, refs and ctx fields are
   exempt. Dropped fields are recorded on the result for "Show plan".
   Measured before this existed: 26.5% of plans carried invented data.
4. **Validate** against the skill's schema, with coercion.
5. **Extractor, one retry** — the JS extractor reads the schema and the
   message for numbers, dates, units, multipliers ("double it"). It will not
   refill a field the audit dropped, nor a payload field when the message
   points at content it does not contain ("this csv").
6. **Missing required field** → `ASK_USER`. The question is the schema's own
   `prompt` string; no model writes it. The ask records *why*: the plan
   supplied an untraceable value, or the message simply carried no data.
7. **Network gate** — a `needsNetwork` skill fails with `NETWORK_OFF` unless
   the header switch is on, and then asks a per-request confirmation showing
   exactly what would be sent. A "no" is reported as never sent.
8. **Run** the skill with a 2,000 ms budget; record input, output, provenance,
   timing and any error.

- **Router second opinion.** A single planned step that the skill itself
  rejected as `INVALID_INPUT`, while the router had a *different* actionable
  pick, is replanned once with only the router's card. It can only turn a
  failure into an answer; it never runs on a decline, so it cannot add a leak.

Outcomes: `COMPLETE`, `ASK_USER`, `FAILED`.

### Stage 4 — Reply

In order of preference:

1. **Template** — one step, succeeded, skill has a `replyTemplate`: rendered
   in JS with `{{field}}` tokens and filters. Zero latency, no model.
2. **Focused web answer** (`focus.js`) — for a single successful web step: JS
   splits the passage into sentences; the planner model writes a few words
   naming what the question wants, then a sentence **number**, under a grammar
   over the valid indices; JS renders that sentence verbatim with the source
   link. Measured 8/8 with the naming field, 2/6 without. A refusal (`0`), an
   out-of-range number, an unreachable model, or a one-sentence passage leaves
   the full text.
3. **Answering step** (`reply.js answeringStep`) — for a multi-step plan with
   no failures: a step whose output another step consumes is working, so the
   terminal unconsumed step is the answer and only its template is shown. No
   model; derived from the plan's refs.
4. **Concatenated templates** — independent steps or any turn with a failure,
   each failure explained inline.
5. **Assembler** — not installed. No model writes prose in this lane; the
   chat lane (§3.6) is a separate path and does not change that.

Every reply is a list of **segments** typed `text` or `value`, each value
carrying its step, field and provenance. The **fabrication audit** then checks
that every numeral and number word in the prose traces to a result or to the
user's message. A violation on a model-written path would fall back to
templates; on the template path only the connecting prose is audited, and value
segments are correct by construction.

### 3.6 The chat lane is not this pipeline

Everything above is Lane A. The chat lane does not enter it at any stage: it
has no router pass, no planner, no plan to validate, no executor and no
fabrication audit, and it is not a branch inside `turn.js` but a separate
module tree (`src/lane-b/`) that imports nothing from the rest of `src/`. A
lint fails the build if that changes (`src/lint-imports.js`, asserted by
`npm test`), which is §5.1's requirement that the wall be enforced at CI time
rather than in review.

What comes back from it is a turn with `lane: 'B'` and a reply that is TEXT
rather than segments. A Lane A reply is a list of typed segments each carrying
where its value came from; a Lane B reply has no segments, so it cannot render
a marked value, and it is drawn in a different colour with a permanent
"Generated · not computed" badge.

**A persona cannot compute (§5.4).** The system prompt asks the model to hand a
numeric question over rather than answer it. `src/lane-b/handoff.js` is what
happens when it does not: for a question whose answer would be a FIGURE, any
number in the reply the person did not supply — in digits or spelled out —
means the prose is dropped before it is shown, replaced by a sentence written
in JavaScript and the offer to ask the verified lane. The guard fires on the
question rather than on every number, because an always-on version dropped a
conversational answer over the "1." beginning a numbered list. Measured by
`npm run bench:laneb` over 40 quantitative holdout phrasings: zero shown
replies stating a figure, zero conversational answers eaten, the model
declining by itself 8 times and the guard catching the other 32.

### UI render

- The turn is drawn the moment it is sent, and the wait shows which pass is
  running (finding the skill, planning, running a named skill) from `onStage`
  events emitted by `runTurn`, not from a timer. The finished reply is typed
  out on arrival; nothing is streamed because nothing is generated.
- Conversations are a tree (`src/thread.js`): editing a question or asking
  again adds a version beside the old one, and ‹ 1/2 › walks between them.
  Older flat chats are migrated into the tree on load.

- Values are marked **computed / bundled (dated) / web (linked)**; clicking one
  opens the untruncated input and output of the skill that produced it.
- **Show plan** draws the turn as a conversation between two characters, in
  plain English. **Patch** is the model: his first line quotes the planner's
  own runway phrase ("I think the user's asking for help with counting days
  from today to a future date") and how sure he sounds comes from the router —
  the adapter's confidence, or the top word-match score against the bar. His
  second line is the plan. **The Robot** is the JavaScript: one flat line per
  step, what ran, how long, where the data came from, and whether anything
  left the machine. Every plain word carries the system's real number, shown
  on hover and pinned on click. The raw plan and results stay one click
  further in.
  Three shapes end differently, in the voice that ended them. An answered turn
  stops at the Robot, because no model pass happens after execution. A **web**
  turn gets one more Patch line, and it is the only one in the pipeline that
  is a real post-execution model call: he says which sentence of the page he
  kept and why ("I was after the name of the current governor, so I kept the
  3rd"). A **decline** distinguishes the router never asking the planner from
  the planner seeing the cards and refusing, and names the near miss with what
  it would have done instead.
- An `ASK_USER` renders as the question, plus what Pigeon is lined up to run
  and which parts of your sentence it already read back. When the input audit
  dropped a value the planner invented, it says so — the difference between
  "I need more" and "I nearly made something up".
- No-skill turns show "did you mean" suggestions from the router's band.
- The rail states what is really running behind each pass (router on;
  planner *sub*; extractor *sub*; assembler *sub* via focus) — the Reality vs.
  Aspiration ledger, on every screen.

---

## 4. Latency budget

| Path | Model calls | Typical wall time |
|---|---|---|
| Router-only, single skill, template | 0 | < 20 ms |
| Category adapter + lexical, planner declines | 1 (category) + 1 (planner) | ~0.5–1.5 s |
| Planned single step, template | 2 | ~1–2 s |
| Planned + decline second look + replan | 4 | ~2–3 s |
| Web answer, focused | 2 + web (≤15 s) + 1 (focus) | web-bound |
| Resume after ASK_USER | 0 (plan replayed) | milliseconds |

Bench average across the 308-question holdout with everything on: **2,125 ms**.
Servers run `--parallel 1`, `-c 8192`, `-ngl 99` (full Metal offload). The
category call is ~64 ms; the planner call dominates. Every model call is
temperature 0 with a hard token cap and a grammar, so worst-case output length
is bounded, and the JS transport aborts at 60 s.

---

## 5. Reliability mechanisms, in one place

| Failure it prevents | Mechanism | Where |
|---|---|---|
| Model does arithmetic / dates / conversions | skills are the only source of computed values; the planner prompt forbids it and the grammar cannot express an answer | `planner.js`, `executor.js` |
| Planner names a skill that was not offered | grammar restricted to the shortlist; web second look drops non-web steps | `planner.js planGrammar`, `turn.js` |
| Planner invents a payload or number | input audit drops it → ASK_USER | `audit-input.js` |
| Extractor re-invents the dropped value | `untraceable` hint, deictic rule | `extractor.js` |
| Wrong answer from a missing ref | `UNRESOLVED_REF` hard failure | `executor.js` |
| Model overrides device context | `mergeInput`: ctx-owned fields win | `ctx.js` |
| Model rewrites a web fact | focus selects a sentence index; the text is the source's | `focus.js` |
| Untraceable numbers in prose | fabrication audit (numerals + number words + ordinals + fractions) | `fabrication.js` |
| Nonsense request runs a skill | category adapter refuses < 0.80; planner floor; runway gated on the adapter | `category-router.js`, `turn.js` |
| Sibling near-tie acted on blindly | margin gate; ties become suggestions | `router.js` |
| Silent network access | CSP with no host; single Rust command; header switch; per-request confirmation; `NETWORK_OFF` reported | `lib.rs`, `executor.js` |
| Half-written chat history | atomic write (temp file + rename), one file, no localStorage mirror | `store.rs`, `store.js` |
| A model server being down | every seam has a no-model branch; the rail says which is live | `turn.js`, `app.js` |
| Prompt drift between training and inference | `renderCard`, `plannerUserMessage`, `plannerSystem` exported and used byte-identically by the data generators | `planner.js`, `scripts/*data.mjs` |

---

## 6. Degradation modes

| Condition | Behaviour |
|---|---|
| Category server down | lexical router alone; the rail says "router-only" for that pass |
| Planner server down | single-skill mode: router's actionable pick, JS extractor, ASK_USER for the rest; multi-step only via hand-written plans |
| Both down | fully offline router-only app; instant replies; measured 142/302 correct |
| Web switch off | web skills fail with `NETWORK_OFF`, the transcript says the request was never made |
| One web provider fails | the other's answer is used; only both failing reports an error, with the reasons |
| Opened in a browser (`npm run serve`) | no Rust bridge: no persistence, no models, no web; session in memory |
| Model returns garbage | grammar makes most garbage unparseable; anything unparseable is an empty plan or "leave the text whole" |
| No Tesseract installed | the image button is not drawn, the rail's `vision` row is off, a pasted image says to install it |
| Tesseract, no planner | the reading goes in raw; the chip says `raw — no model` |
| The tidy introduces a number, or comes back empty or at an odd length | the tidy is discarded for the raw reading and the chip and trace say why |
| **Models asleep** (the default in the menu bar, and after the window closes) | the popover and the window answer router-only, instantly; the status line says `resident · models asleep · router only`, and the lane switch's Chat tab is disabled because there is nothing awake to write with |
| **Models waking** | the 15–30 s cold start is counted down in the status line rather than hidden; a question asked meanwhile is answered router-only, and waking never revisits an answer already given |
| **A model has been idle ten minutes** | it is unloaded and the app returns to holding the router. The period is chosen, not measured; `PIGEON_IDLE_UNLOAD_S` changes it and 0 means never |
| **No weights on the machine** | the first-run sheet offers the download and the app answers router-only until it finishes; declining is remembered and the rail's `models` row is the way back |
| **A weight file is short or its hash is wrong** | it is never renamed into place. A short download keeps its `.part` and resumes; a hash mismatch deletes the part, because a corrupt one cannot be resumed into a good file |
| **The persona adapters will not load** | the category server is started again once without them: Lane A's routing must not be lost to a bad file in the adapters folder. The chat lane loses its personas and the status says so |
| **The chat model is asleep, in the chat lane** | the lane says it has nothing to write with rather than falling back to the verified lane — no silent lane-switching (§5.5) |
| **A generated reply states a figure the person did not supply** | the prose is dropped before it is shown and replaced by a sentence written in JavaScript, with the offer to ask the verified lane (§5.4) |
| **No screen-recording permission** | the capture refuses, names the exact System Settings switch, and captures nothing. Nothing is written to disk on any path |
| **A `llama-server` is already on a role's port** | it is adopted, not replaced, and never killed — this is how `npm run dev` keeps working. Anything on that port that is not llama-server is an error, never a spawn |
| **The app was killed without running its exit hooks** | the next launch sweeps its pidfiles and reaps any `llama-server` still on its own port, and only that |

---

## 7. Measured performance

Bench: `npm run bench:planner` on 308 unseen phrasings (one per skill, in no
skill's examples, and in Flight School's `forbidden.json` so no training row
can paraphrase them) plus 50 no-skill messages. Run from a bash script.

| Configuration | Correct incl. honest asks | Leaks (of 50 until 2026-09-08) |
|---|---|---|
| Router-only (no models) | 142 | 1 |
| + category adapter + planner, plain prompt | 142 → 198 | — |
| + runway on adapter's say-so | 212 | 4 |
| + 124 vocabulary examples across 65 skills | 233 | 8 |
| + input audit (39 fabricated answers → honest asks) | 235 | 8 |
| + empty-input demonstration | 239 | 8 |
| + decline second look | 248 (82%) | 8 |
| + 56 contrasting descriptions, 4 new skills, holdout 308 (merged from main) | 261 / 308 (85%) | 6 |
| + bench widened to 100 no-skill messages, web skills scored right with the web off | 263 / 308 (85%) | 20 / 100 |
| + argument-shape fixes in JS (enum coercion, hex colours, empty lists, radius from diameter) | 272 / 308 (88%) | 20 / 100 |
| + 54 contrasting descriptions across the sibling pairs | 289 / 308 (94%) | 22 / 100 |
| + the card lint's 35 further pairs | **292 / 308 (95%)** — shipped | **20 / 100** |

Shipped breakdown: 188 answered from the message, 101 answered with the right
question, 2 right web skill with the web off, 10 wrong skill, 1,866 ms
average. Live table: `model/BENCH.md`.

A third of successful turns now end in a question rather than an answer, and
that is the input audit working: the planner used to hand a text skill the
question itself, and 38 such turns were being counted as answers.

Router alone: recall@5 73% on the grading holdout (83% on the tuning half —
the split exists to expose that gap). Category adapter: 88% and 24 of 25 refusals
in 64 ms, on `grade.jsonl` with the 0.80 gate — reproduced exactly on
2026-09-08. Flight School's `eval_category_router.py` reports 21 of 25 for the
same weights because it runs a different set (`dev-labelled.jsonl`) and applies
no gate; gated, that set refuses 25 of 25. Four numbers, one adapter.

---

## 8. Training programme (adapters)

Principle: **training exists to improve moderate scores, not to rescue awful
ones.** Every prompt-level lever is measured first.

Seven rounds have now been trained and one shipped — the original category
adapter, which solved something nothing else could: skills that share no
vocabulary with the question, which no threshold can promote because they were
never ranked. Everything since has been cheaper to fix in text. The bench went
from 142 to 292 on prompts, JavaScript and descriptions, and not one of those
points came from an adapter. Category v3 also showed how a round can fail
invisibly: ungated it was four points behind v1, gated at the shipped bar it
was twenty, because its confidence had collapsed rather than its accuracy. Any
future adapter is measured both gated and ungated, and the gap between them is
the health check.

| Adapter | Base | Status |
|---|---|---|
| Category (shipped) | Qwen2.5-1.5B, LoRA r16 | in repo, 6,142 rows, 12.6% refusals |
| Planner round 1 | Qwen2.5-1.5B (2B is untrainable on this Mac: hybrid GatedDeltaNet) | 162/302, 4 leaks — not shipped |
| Category v2 | +276 hard negatives, +44 paraphrases | 236 / 9 leaks — not shipped |
| Sibling v1 (skill examples) | 3,234 rows | 244; 4 right / 7 broke — not shipped |
| Sibling v3 (Flight School paraphrases) | 14,020 rows, 1 epoch | 252; 6 right / 1 broke / 5 neutral; net +5 vs rule +8 — not shipped |
| Sibling v4 (contrastive pairs) | 14,668 rows, 30 pairs × 5 msgs/side | trained: +2 against a rule of +8 — not shipped |
| Category v3 | v1 negative depth + 40 targeted at the measured idiom leaks | trained: 279/308 and 23 leaks — not shipped |

Ship rules are written into each round script and summary before the run:
sibling verifier `→right − →wrong ≥ +8`, correct ≥ 292, leaks ≤ 20/100. Training is
MLX through Flight School's venv; conversion is mlx → PEFT → GGUF
(`scripts/convert-planner-adapter.sh`, asserting alpha = scale × rank = 320).

---

## 9. Verification

| Check | Command | Covers |
|---|---|---|
| Unit + skill suite | `npm test` (`node scripts/test.mjs` + `cargo test`) | 4,986 JS checks and 65 Rust: every example executed, every error case, schema lint, plan grammar, audit rules, replies, store parsing, Phase 0 gate, the lane wall, the popover's status line, the engine's arguments and manifest, the downloader against a local host |
| The wall between the lanes | `npm run lint:imports` (also run by `npm test`) | §5.1 — `src/lane-b/` imports nothing from the verified path, and only the two window files reach into it |
| Lane B, adversarially | `npm run bench:laneb` | §6 — Lane-A-shaped questions asked in the chat lane; zero shown replies may state a figure, and no ordinary chat answer may be eaten |
| The engine, end to end | `cargo test --lib -- --ignored --test-threads=1 the_engine_wakes` | spawns the bundled server on real weights, answers, sleeps, and asserts the port is dead and no process survives |
| The wall, at runtime | `cargo test --lib -- --ignored --test-threads=1 the_chat_lane` | the router's answers and confidences are identical before and after the chat lane has been talking |
| The download, against the real host | `cargo test --lib -- --ignored a_real_host` | a Range request the CDN answers 206 to, cancelled and resumed |
| The sidecar's independence | `npm run sidecar -- --check` (also asserted by `cargo test`) | no Homebrew load command survives on the bundled server or its libraries |
| The pinned models | `npm run manifest:models` | the sizes and hashes in `models.json` still match what Hugging Face publishes |
| Router calibration | `npm run sweep` / `scripts/gate.mjs` | constants fitted on HOLDOUT_TUNE, graded on HOLDOUT_GRADE |
| End-to-end planner bench | `npm run bench:planner -- --router category --category-base http://127.0.0.1:8101 --trained --min-confidence 0.80 --only llm+ex --runway-auto --second-look` | the table in §7; flags for every measured-off feature |
| Web providers | `npm run webcheck` | live shape of both endpoints (not part of `npm test`) |
| Rust transport | `cargo test --lib -- --ignored` | real TLS round trip |

Known non-regressions: one ICU-dependent formatNumber case on Node 23
("1.2M" vs "1.2m") and a ~5% flake in a nondeterminism check. Because `npm
test` chains with `&&`, the ICU failure stops it before `cargo test` runs; the
Rust suite is run on its own.

**Still owed, and not claimed anywhere as done.** Three of the spec's own
verification rows have no measurement yet, each for a reason this machine
cannot remove: a first run on a clean Mac with no models and no Homebrew
installed; a complete 2.3 GB download end to end, where only a
partial fetch has been exercised; and a screen capture against a real screen,
on a machine that grants the permission. The refusal path is what the capture's
test covers instead, along with the contract that holds either way — no file
appears while one is taken.

---

## 10. Operating

```bash
npm install          # once
npm run dev          # window + static server + both model servers
npm run dev:fast     # router-only
npm run models       # servers alone (benches need this)
npm run tauri build  # .app / .dmg on macOS; deb / rpm / appimage on Linux
```

Built app: `llama-server` from the bundle (`src-tauri/binaries/`, relinked
by `npm run sidecar` to load OpenSSL from `Contents/Frameworks` so a Mac
without Homebrew can run it); weights fetched on first run into
`~/Library/Application Support/mode.airoplane.pigeon/models/`; adapter
from `Contents/Resources/model/`. Dev script defaults: `llama-server` from PATH
or the build in `src-tauri/binaries/`; weights from Pigeon's own models
folder; adapter from `model/`. Overrides, honoured by both:
`LLAMA_SERVER`, `PIGEON_PLANNER_MODEL`, `PIGEON_CATEGORY_MODEL`,
`PIGEON_CATEGORY_LORA`, `PIGEON_LLM_PORT`, `PIGEON_CATEGORY_PORT`,
`PIGEON_NO_MODELS`, `PIGEON_IDLE_UNLOAD_S` (off by default: the period is
unmeasured). `npm run manifest:models` checks the pinned files against what
Hugging Face publishes.

Chat history: `state.json` in the app's data directory
(`mode.airoplane.pigeon`), versioned (2: chats plus a settings block that
remembers the first-run answer), written atomically, nothing leaves the
machine.

---

## 11. Known limits

- **Sibling confusion** is the residual error: 10 wrong-skill picks, down from 32, ~12 kept-wrong pairs where two
  skills share vocabulary (`applyDiscount` / `stackDiscounts`,
  `parseMarkdownTable` / `toMarkdownTable`, …). The 2B cannot resolve them
  pairwise; round 4's contrastive data targets exactly these.
- **20 of 100 no-skill leaks**, 14 of them in the second fifty, which were written to be harder: a skill's own word in an ordinary sentence ("he made a hash of the presentation", "binary thinking", "the dice were loaded"). Mostly figurative language ("in his prime").
- **No `web` category** in the adapter: general-knowledge questions split
  between `reference` and `none`; the web second look covers them.
- **Recall@5 of the lexical router is a ranking limit** (73%); a threshold
  cannot reorder a list. The category adapter is what lifts skills that score
  zero into view.
- **No model writes replies in the verified lane.** Multi-step turns with
  independent steps read as concatenated templates; that is by design until an
  assembler exists that can pass the fabrication audit. The chat lane writing
  prose does not touch this: it is a separate path with no access to a skill,
  a value or the audit (§3.6, §5.1), and building it neither required nor
  implied an assembler.
