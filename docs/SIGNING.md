# Signing keys, and running a fork

Pigeon only runs code and adapters that are **sealed**: a `.pigeon` file
carries `seal.json` as its last entry, an Ed25519 signature over the SHA-256
of every other entry, made by a key the build trusts. Patch, the default
Pigeon, is sealed the same way, and so is every Pigeon he needs. This page
says which keys a build trusts, how to use the official Patch from a source
build, and how a fork makes and trusts its own key.

## What a build trusts

Two lists are compiled into the app. Changing either means rebuilding.

| File | Trusted to seal | Today |
|---|---|---|
| `src-tauri/keys/seal-keys.json` | Pigeons, and Patch's skill pack | one key, id `5bce0d9361532748` (the project's) |
| `src-tauri/keys/registry-keys.json` | the base-model registry (`src-tauri/registry/registry.zip`) | one key, id `25660ed562d33a0d` |

A key on one list is not trusted for the other. Each entry is:

```json
{ "id": "<first 16 hex of sha256(public key)>", "ed25519_pub_hex": "<64 hex>", "revoked": false }
```

Set `"revoked": true` to stop trusting a key without forgetting it; anything
it sealed is then refused with a note saying so. Only public keys live in this
repository. The private keys were never committed, and must never be.

Tests also trust one published key, RFC 8032 §7.1 TEST 1 (id
`21fe31dfa154a261`). It is added under `cfg(test)` only, so no build you can
ship trusts it.

## Building from source with the official Patch

You don't need a key for this. The official Patch is sealed by the project's
key, and an unmodified build trusts that key.

1. Check out the release tag you want.
2. From that release's assets, download `patch.nest` and `host-api.json` into
   `pack/` at the root of the checkout (the folder is gitignored).
3. Run `npm run dev` or `npm run app`. A debug build looks for Patch in
   `pack/`, then in `dist/`.

`host-api.json` lists the hash of every host-API module Patch's code was
built against. A debug build without it skips that check, but says so
(`host-api.json was not found, so this debug build skipped the host-API
check`). A release build refuses to start Patch without it. If Patch's code
and the checkout disagree, Patch is refused. Use the nest from the release
that matches your commit.

Without a nest, the app still runs. Patch shows as unavailable, and the chat
lane (Pen, Peek, and any Pigeon you import) works as normal.

## A fork with its own key

You need your own key if you change Patch's skills, prompts or code. You also
need one to ship Pigeons of your own that your build loads with no warning.

**Today this route needs Flight School**, the sibling app that trains, packs
and seals Pigeons. Its CLI generates keys and seals packs
(`src-tauri/python/pigeon/cli.py keygen` and `pack-skillpack`).
`npm run pack:patch` calls it. Pigeon itself can check a seal in Rust
(`src-tauri/src/pigeon/seal.rs`) and in Node (`scripts/lib/seal.mjs`). It
does not make seals outside its tests.

1. **Make a key** with Flight School's `cli.py keygen`. Keep the private key
   file outside every repository, readable only by you (`chmod 600`), and back
   it up. If you lose it, you can't update anything it sealed. Anyone who
   copies it can seal code your build will run.
2. **Trust it.** Add its public half to `src-tauri/keys/seal-keys.json`. To
   work out the id from the public key's hex:

   ```bash
   node -e "import('./scripts/lib/seal.mjs').then(s=>console.log(s.keyId(Buffer.from(process.argv[1],'hex'))))" <ed25519_pub_hex>
   ```

   Keep the project's entry too if you want your build to accept the official
   Pigeons, including the six that Patch's nest is built from. Remove it (or
   mark it revoked) if your build should trust only you.
3. **Seal Patch.** Commit your changes first: the pack records a real commit,
   and the script refuses a dirty `skills/`, `src/` or `model/`. Then run:

   ```bash
   PIGEON_SEAL_KEY=/path/to/your/seal.key FLIGHT_SCHOOL_DIR=/path/to/flight-school npm run pack:patch
   ```

   This stages Patch from the checkout, seals it with your key, writes
   `pack/patch.pigeon`, `pack/host-api.json` and `pack/patch.nest`, and reads
   all three back with the app's own strict reader. The nest also needs every
   Pigeon in `PATCH_NEEDS` (`scripts/export-pigeon-stage.mjs`), each sealed
   by a key the build trusts. They're read from `PATCH_PIGEONS_DIR`. You can
   take these from an official `patch.nest` (it's a stored ZIP), or train and
   seal your own.
4. **Build:** `npm run build`. A release bundles `pack/patch.nest` and
   `pack/host-api.json` (`src-tauri/tauri.release.conf.json`).

The base-model registry follows the same pattern, with its own key and
`registry-keys.json`. Most forks can leave it alone and keep shipping the
official `registry.zip`.

## Reporting a leaked key

If you believe the project's private key has been exposed, don't open a
public issue. Use the repository's private security advisory form instead.
The fix is a release that marks the key revoked and trusts a new one.
