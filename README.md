# Pigeon

**The model plans, JavaScript does the work, the model phrases the answer.**

Pigeon is a small macOS assistant that runs entirely on your Mac. You message
it the way you'd message a person. Every number, date, conversion, lookup and
check in a reply comes from a tested JavaScript function, never from the
model's guess, and each figure in the reply shows you where it came from.

The model has three jobs: work out which of the 300-odd skills you're asking
for, pull the values out of your message, and put the result into words. It
computes nothing itself.

- **Patch** is the default Pigeon, and the verified one. A model picks a
  skill, a tested function gives the value, and a template writes the reply.
  If Patch can't do something, he says so and tells you who can.
- **Pen** writes, explains and thinks things through. Pen's replies are
  labelled as model-written and unchecked. Any figure Pen states that you
  didn't give it is dropped before you see the reply, with an offer to ask
  Patch instead.
- **Peek** reads pictures.
- **Imported Pigeons** are `.pigeon` files made with Flight School, the
  companion app that trains them. Each one is a contact in the sidebar.

Pigeon runs on one small open model, Qwen3-VL 2B Instruct (Apache 2.0). It
downloads the model on first run and checks each file's SHA-256 against
`src-tauri/models.json`. The engine is llama.cpp, built into the app's own
binary. No server runs, and nothing listens on the network.

## Privacy

Nothing you type leaves your Mac unless you press **Look it up** and then
**Send** on the exact words shown. Settings › Privacy keeps a log of every
time that happened. The app writes its chats, settings and that log to its
own folder in `~/Library/Application Support/mode.airoplane.pigeon/`. Nothing
there is sent anywhere.

## Requirements

- A Mac with Apple Silicon running macOS 12.3 or later. Apple Silicon is the
  only supported platform.
- About 2 GB of disk for the models. 16 GB of RAM is comfortable.
- To build from source:
  - Xcode command line tools (`xcode-select --install`). These include the
    Swift compiler that builds the `pigeon-eye` helper.
  - Rust 1.77 or later (`rustup`).
  - Node 18 or later.

## Build and run

```bash
npm install
```

```bash
npm run dev
```

`npm run dev` opens the app in a development window. Frontend edits show up
when you reload (**⌘R**), with no build step in between. If you want to try
playing a Pigeon, use `npm run app` instead. It builds a real `.app` and
signs it with your development certificate, which macOS needs before it will
grant Screen Recording and Accessibility.

**Patch needs his sealed pack.** Patch's skills run only from a signed
`patch.nest`, which isn't in git. Download `patch.nest` and `host-api.json`
from the release that matches your checkout, and put them in `pack/`. Without
them, the app still runs, but Patch shows as unavailable. If you want to
change Patch and sign your own pack, see [docs/SIGNING.md](docs/SIGNING.md).

```bash
npm test
```

`npm test` runs the JavaScript suite and then the Rust tests. The JavaScript
suite executes every skill's examples and error cases.

```bash
npm run build
```

`npm run build` makes a release bundle in
`src-tauri/target/release/bundle/`. It needs a full `pack/`, and you need to
sign and notarise the result yourself.

## How a turn works

1. **Route.** A small adapter on the base model names the category your
   message belongs to, or declines. A lexical router stands behind it.
2. **Plan.** The planner writes a plan against a shortlist of skills. The plan
   is checked against a grammar. Every value in it must appear in your
   message; any value that doesn't becomes a question back to you.
3. **Execute.** The skills run in a locked Web Worker. They are pure
   functions, with no network, no `eval` and no DOM.
4. **Reply.** A template turns the result into segments, each figure carrying
   its source. The model may smooth the wording, and an auditor removes any
   number it adds.

The chat lane (`src/lane-b/`) imports nothing from the verified lane, and a
lint in `npm test` fails the build if that ever changes. The Rust shell keeps
the same kind of boundary. A command takes the input itself (a role, a query,
an image's bytes), never a URL or a path. Rust builds every location from
constants and the app's own folder.

## Layout

```
src/                the frontend: router, planner, executor, reply builder, auditors
  lane-b/           the chat lane, walled off from the rest of src/
skills/             one module per skill; skills/index.js is the manifest
src-tauri/          the Rust shell (Tauri 2)
  pigeon-core/      the strict .pigeon reader and seal check
  pigeon-engine/    llama.cpp in-process
  pigeon-ffi/       a C interface to the engine
  eye/Eye.swift     pigeon-eye: window capture and Apple Vision OCR, built by build.rs
  keys/             the public keys this build trusts (docs/SIGNING.md)
  licences/         third-party notices that ship inside the app
model/              training data and the scripts that build Pigeon's adapters
bench/              held-out sets and recorded results
scripts/            tests, benches, packing, data builders
docs/               design notes and specs
```

## Documentation

- [docs/SIGNING.md](docs/SIGNING.md): sealed Pigeons, trusted keys, and
  running a fork.
- [docs/DEVELOPMENT-NOTES.md](docs/DEVELOPMENT-NOTES.md): the full
  development notes, including every measurement, dead end and correction.
- [docs/SPEC-SHEET.md](docs/SPEC-SHEET.md): the original spec.
- [model/README.md](model/README.md) and [model/BENCH.md](model/BENCH.md):
  how the adapters are trained and measured.

## Licence

Pigeon is licensed under Apache 2.0 (see [LICENSE](LICENSE)). The
third-party software and models it ships or downloads, and their licences,
are listed in [src-tauri/licences/README.txt](src-tauri/licences/README.txt).
Every model the app downloads is Apache 2.0. A Pigeon you import carries its
own maker's licence inside its file.

The Patch artwork in `assets/` is the author's own and is covered by the same
licence.
