# The play loop: a picture Pigeon that presses the keys

**The goal.** Open a picture Pigeon like the Fire Red one, point it at a
window, press Play, and watch it play. Every moment it looks at the window,
answers with one of its own actions (`KEY(Confirm)`, `KEY(Up)`, `NONE`), and
the key gets pressed. You can stop it at any time, and afterwards you can see
every moment it saw and what it pressed.

**What it is not.** It won't finish Pokémon. One picture doesn't say where to
walk next ([VISION.md](VISION.md), "Why it will not actually play Pokémon"). It
plays what a screen decides: dialogue, menus, battles. The game waits for you,
so being slow (0.3–3 seconds a move) costs nothing.

---

## What already exists

| Piece | Where | State |
|---|---|---|
| The Pigeon: a picture in, an action out | a `.pigeon` from Flight School | ✓ Fire Red, 5/17 on its exam |
| Running it on a picture | Pigeon's picture server (Milestone 3) | ✓ ~3 s at 768 px, ~0.3 s at 160×144; Fire Red's 480×376 frames should be ~1–1.5 s (estimate) |
| Seeing one window, frame by frame | Flight School's `fs-recorder` (ScreenCaptureKit) | ✓ live-tested |
| Stacking frames the way training did | `fs-recorder` | ✓ |
| Pressing a key | nothing yet | — |
| Knowing which key `KEY(Confirm)` means | nothing yet | **missing** |

**Two gaps in what is recorded and packed.**

1. **Which key an answer means.** `labels.txt` says `KEY(Confirm)`, but nothing
   says Confirm is the X key — once a key is renamed, the key itself is lost.
   And a name is not enough to press: "X" is a different physical key on another
   keyboard layout, and a symbol key has no stable name. The recorder must keep
   the **key code** too.
2. **How long a key was held.** The recorder keeps the press and ignores the
   repeats, so a held key and a tap look the same. In Pokémon they are not: a
   tap turns to face a direction, a hold walks. The recorder must keep **how
   long each press lasted**, and play presses a key for as long as you usually
   did.

So the `.pigeon` carries its actions:

```json
// actions.json — written by Flight School's packer from the table's actions
{ "keys": {
    "Confirm": { "code": 7,   "name": "X",  "hold_ms": 90  },
    "Up":      { "code": 126, "name": "Up", "hold_ms": 260 } },
  "frames": { "stack": 1, "gap_ms": 250, "max_side": 768 },
  "question": "What do you do next?" }
```

`hold_ms` is the median of your own presses of that key. `frames` matters too:
a Pigeon trained on 3 stacked frames must be shown 3 stacked frames, or it is
asked something it never learned. A key recorded with ⌘, Ctrl or Option held
(⌘S, say) is **never packed as a key to press**: ⌘Q would quit the game.

---

## Where the loop lives

VISION.md's first answer was "neither app: a script beside the emulator". That
was right while no app could see a window. Now two can, so here are the options:

| | For | Against |
|---|---|---|
| **A. Pigeon** (recommended) | Already holds the Pigeon, its picture server and its revisions. Play becomes something you do *with a Pigeon*, next to messaging it. | Pigeon needs the window-capture helper, and two new permissions: Screen Recording, plus Accessibility to press keys. |
| B. Flight School | Already has the recorder and its permissions. | Flight School makes Pigeons; playing one there mixes the two apps' jobs. |
| C. A script | Smallest to build. | A terminal tool, and a second copy of everything Pigeon already does. |

Recommended: **A**. Pigeon's own screen capture (`capture.rs`) uses a call
macOS 15 no longer allows, so it needs the same Swift helper anyway.

**The loop runs in Pigeon's Rust engine, not in the page.** Frames go from the
capture helper straight to the picture server and answers straight to the key
presser; the page only draws the Stop bar and the log. Passing every frame
through the page as a data URL would add a copy and a delay to every turn.

---

## One turn of the loop

1. **See.** Take the latest frame of the window, made the way training made it:
   same size cap, same stack.
2. **Ask.** Send it to the Pigeon on the picture server, with the question it
   was trained on. Greedy decoding, so the same screen gets the same answer.
3. **Check the answer is one of its own.** Anything off the list is not
   pressed; it's logged and the turn is skipped.
4. **Act.** `NONE` → wait. `KEY(x)` → hold x for its `hold_ms`, then release
   — only if the window is still in front.
5. **Settle.** Wait for the screen to change or ~300 ms, then go again.

**Safety, all non-negotiable:**
- A floating **Stop** bar, and a chord that stops it at once from anywhere:
  **⌘⇧.** — not Escape, which games and OpenEmu use themselves.
- It only ever presses keys from its own `actions.json`, never with ⌘, Ctrl or
  Option held. It never types anything else, and never clicks in this version.
- **Stuck is noticed.** The same key pressed ten times with the screen not
  changing, or a minute of nothing but `NONE`, stops it and says which.
- If another window comes to the front, it **pauses**. A key meant for the
  game never reaches your mail.
- No time limit by default (decided): it plays until you press Stop. A limit
  can be set per run.

---

## The receipt: a play log

VISION.md noted that a picture answer has nothing to show for itself, except
here: press the key and the game either responds or it doesn't. So each run
keeps a **play log**: every frame it saw, what it answered, what was pressed,
and how long each step took.

That log is also the best training data you can get. Open it in Flight School,
fix the moments it got wrong, and those become new rows. They arrive the way a
model's drafts do — marked, and not trained on until you approve them — because
a moment you did not look at is only the Pigeon's guess. It plays, you correct
it, you teach it again. That loop is what turns 5/17 into something good.

---

## Milestones

Each one stops with something you can run, as before.

| # | Milestone | Done when |
|---|---|---|
| **P1** | **Actions travel with the Pigeon.** The recorder keeps each key's code and how long it was held; Flight School packs `actions.json`; Pigeon reads and shows it ("Confirm = X, held 0.09 s"). A Pigeon recorded before this has no hold times — play uses a short press and says so — and one packed before it is told to be re-packed. | The Fire Red Pigeon, re-packed, says which key each answer presses |
| **P2** | **Pigeon sees a window.** The capture helper in Pigeon, its Screen Recording permission (asked by Pigeon itself, and a signed `npm run app` build — both lessons from this week), a window picker. | Pigeon shows a live frame of OpenEmu |
| **P3** | **Pigeon presses a key.** **First, a gate:** does OpenEmu take a key that software presses? Emulators often read the keyboard at a level synthetic keys never reach. Tried three ways — posted to the system, posted to OpenEmu's process, sent as a key event to its window. **None works → stop and ask**, as the vision gate would have. Then: the Accessibility permission, the Stop bar and ⌘⇧., pause-on-focus-loss. | A test button makes Fire Red's character walk one step, and Stop works |
| **P4** | **Play.** The loop, from a picture Pigeon's page: pick the window, Play (a time limit if you want one), the live answer and speed on the Stop bar, stuck-detection. | Fire Red advances through a dialogue on its own |
| **P5** | **The play log, back into Flight School.** Each run saved; open it in Flight School; its moments arrive as drafts to approve or correct, then train like any row. | A corrected play run teaches round 2 |

Clicks (`CLICK(Send)`: finding a named place on screen by its picture) come
after P5, when a job needs them. Fire Red doesn't.

---

## Decisions — settled 2026-09-21

| | Decision |
|---|---|
| Where it lives | **Pigeon** |
| The play log into Flight School (P5) | **Part of this plan** |
| Default time limit | **None** — it plays until Stop; a limit can be set per run |

---

## Status — built overnight, 2026-09-21/22

Everything that could be built and checked without a person at the Mac is
built. Nothing was pressed and no permission was asked while nobody watched.

| # | State | Checked by |
|---|---|---|
| **P1** | **Done.** Flight School's recorder keeps each key's code and hold time; `actions.json` is packed; Pigeon keeps it and shows "Presses: A = A (a tap) · …". Fire Red, re-packed into scratch, shows its keys. Its presses are taps: it was recorded before hold times were kept. | Rust + pytest; `a_repacked_picture_pigeon_says_which_key_each_answer_presses` on the real file |
| **P2** | **Built.** `pigeon-eye` (Swift, ScreenCaptureKit) watches a window and hands over frames in the Pigeon's own shape; permissions asked in Pigeon's process; window picker; `npm run app` builds a signed debug `Pigeon.app`. | eye self-test; replay of real frames; the signed app builds |
| **P3** | **Built; the gate is yours.** Keys are posted by Pigeon itself, three ways. **Test a key** on the Play panel brings the game to the front, presses once each way, and compares frames before and after to say which way the game took. | the rules test (only its own keys, never a modifier); **not yet run against OpenEmu** |
| **P4** | **Built.** The loop, the Play panel, pausing while another app is in front, stuck detection, ⌘⇧., the play log. | watch-only on the real Fire Red Pigeon over a replay of its own frames: 47 turns in 45 s, ~1.4 s a turn, only its own keys, nothing pressed |
| **P5** | **Built.** Flight School › Collect › **Import a play** reads a play log, copies its frames into the run and adds every turn as a draft. | a test on a play log's shape; **not yet run on a real play** |

**For the person, in order:**
1. Re-send Fire Red from Flight School (Send › Try it in Pigeon), so it carries `actions.json`.
2. `npm run app` in Pigeon; on Fire Red's page, allow **Screen Recording** and **Accessibility** when Play asks.
3. With the game at a dialogue box, **Test a key** with A. If a way works, it is chosen for Play. If none does, stop and ask — the plan's gate.
4. **Play**, first with **Watch only** ticked, then without.
5. In Flight School, **Import a play** from the log it left, fix the moments it got wrong, teach again.

---

## The key gate, answered — 2026-09-22

**OpenEmu does not take a key that software presses.** It reads the keyboard at
the device level, below where any app can post one, so all three ways (into the
system's key stream, into the session's, straight to its process) leave it
unmoved — while the same presses reach ordinary apps. Nothing in Pigeon can fix
that; a virtual keyboard *driver* could, at the cost of a system extension and
someone else's software.

**mGBA does.** Measured the same day: Fire Red played in mGBA — 141 turns,
75 × `KEY(Up)`, 4 × `KEY(D)`, 62 × `NONE` — pressing for real, keys posted into
the system's stream (`hid`). So **P3 and P4 are done**, on mGBA.

What this costs: a Pigeon trained on OpenEmu's window is being asked about
mGBA's. The game screen is the same, the window around it is not, so a short
re-record in mGBA (which also captures hold times, which the OpenEmu recording
never had) is the honest next corpus. P5 — the play log back into Flight
School — is the other half of that: what it just played is already rows.

---

## Play, as a person meets it (2026-09-26)

The first page was a form halfway down a Pigeon's page — a window dropdown, a
"Keys go" choice, a manual key test — and it reported progress on that page,
which is behind the game for the whole of a play. Rebuilt (user's choices:
one sheet to start; an overlay AND the menu bar while it plays):

- **Play is a button** in a playing Pigeon's chat header and beside New chat on
  its page (`canPlay`: a picture Pigeon with `actions.json`). While it plays
  both become Stop.
- **One sheet** (`playSheetHtml`): what it will press and ⌘⇧.; the two macOS
  permissions as a checklist with one Allow each (re-checked when Pigeon comes
  back to the front); the game picked from thumbnails of the windows, each the
  frame the Pigeon would see (`play_preview`), Pigeon's own windows left out,
  the app played last picked first; Watch only and the key test under More.
  The key method is no longer asked: `hid` unless the key test found another
  way for that app, remembered in `settings.playHow`.
- **The game comes to the front by itself** when a play starts (`run_loop`
  activates the window), so Play is the last click.
- **The overlay** (`hud.html`, `playhud.rs`, `play_hud` — command 59): a
  non-activating panel, top right, never key, so the game keeps the keyboard.
  What it sees (the frame it was just asked about, `PlayStatus.frame`), the key
  it pressed, moves, time a move, Stop and Hide. A stopped card lingers 12 s.
- **The menu bar** shows `▶ 42` (moves) or `❙❙` beside the icon, and its menu
  leads with "Seed Run V2 is playing", Stop playing ⌘⇧., Show what it sees.
- **The page** keeps a card for the play going on or the last one, and a
  "stuck" stop says how to find a way the game takes keys.

Not seen yet: the overlay and the menu-bar title in the running app (this
session cannot see the screen) — check both on the first real play.

**Play from the menu bar and the summon bar (2026-09-26).** Picking a Pigeon
that plays adds Play beside Screenshot and Picture… in the menu-bar window, and
a fourth ▶ bubble to the summon bar (bar.rs lays glass for four and shows three
or four; `bar_bubbles` now carries the count, bar.html reads `--n`). One click
(`quickPlay`) starts it in the game played last when both permissions are on
and that game is open — the small window steps away, the game comes forward,
the overlay comes up. Anything else hands over to the window's Play sheet
(`menubar-open` with `action: 'play'`). While any Pigeon plays, the button is
Stop. `settings_peek` now also returns `playLastApp` and `playHow`.
