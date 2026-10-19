#!/bin/sh
# Build Pigeon as a real .app (debug, fast to build), sign it with this Mac's
# development certificate, and open it — `npm run app`.
#
# Screen Recording and Accessibility attach to an app bundle's identity
# (mode.airoplane.pigeon). The bare dev binary `npm run dev` starts from a
# terminal has no bundle, and macOS may credit the permission to the terminal
# instead, so playing is tried in this build.
#
# The app is only rebuilt, re-bundled and re-signed when its SOURCE changed.
# Pigeon's binary is not byte-for-byte the same from one build to the next, so
# comparing builds would re-sign every launch — and re-signing is what can
# make a freshly granted permission stop applying.
set -e
cd "$(dirname "$0")/../.."
app="src-tauri/target/debug/bundle/macos/Pigeon.app"
stamp="$app/Contents/Resources/.built-from"
now="$( (find src styles skills model assets fonts src-tauri/src src-tauri/pigeon-core/src src-tauri/pigeon-engine/src src-tauri/eye src-tauri/capabilities src-tauri/keys -type f 2>/dev/null;
         ls index.html bar.html popover.html hud.html src-tauri/Cargo.toml src-tauri/pigeon-core/Cargo.toml src-tauri/pigeon-engine/Cargo.toml src-tauri/Cargo.lock src-tauri/tauri.conf.json 2>/dev/null) \
       | LC_ALL=C sort | tr '\n' '\0' | xargs -0 shasum -a 256 | shasum -a 256 | cut -d' ' -f1)"
if [ -d "$app" ] && [ "$(cat "$stamp" 2>/dev/null)" = "$now" ]; then
  echo "[app] nothing changed — opening Pigeon as it was built and signed"
else
  PIGEON_DEBUG_APP=1 RUSTFLAGS="--remap-path-prefix=$HOME=/home" npx tauri build --debug --bundles app
  echo "$now" > "$stamp"
  id="${FS_SIGN_IDENTITY:-$(security find-identity -v -p codesigning 2>/dev/null | sed -n 's/^ *1) \([0-9A-F]*\) .*/\1/p')}"
  if [ -n "$id" ]; then
    codesign --force --deep --sign "$id" "$app"
  else
    echo "no signing identity on this Mac — the app runs unsigned, and macOS may forget its permissions after a rebuild" >&2
  fi
  # Pigeon stays in the menu bar when its window closes, so a copy from the
  # last build may still be running — and `open` would only bring THAT one
  # forward. Ask it to quit (it saves as it goes), then open the new one.
  if pgrep -f "$app/Contents/MacOS/" >/dev/null 2>&1; then
    echo "[app] quitting the Pigeon that is still running from the last build"
    osascript -e 'tell application id "mode.airoplane.pigeon" to quit' >/dev/null 2>&1 || true
    i=0
    while pgrep -f "$app/Contents/MacOS/" >/dev/null 2>&1 && [ $i -lt 50 ]; do sleep 0.2; i=$((i + 1)); done
  fi
fi
[ "$1" = "--no-open" ] || open "$app"
