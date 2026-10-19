What is in this folder, and why it ships.

Pigeon is Apache 2.0 (see LICENSE at the root of the source). It carries other
people's work, and the licences here are the ones that ask to travel with a
binary rather than merely to be honoured. They are written by hand rather than
scraped, so each one says what the thing is and where Pigeon uses it.

  llama.cpp-MIT.txt        the model engine, built into Pigeon's own binary.
  Qwen-Apache-2.0.txt      the two models downloaded on first run, Peek's
                           base and projector (Qwen3-VL-2B), and the Apache
                           2.0 text several other notices point at.
  ring-and-BoringSSL.txt   the cryptography behind the HTTPS that download
                           uses. Three notices, all reproduced.
  rust-libraries.txt       rustls, webpki-roots, reqwest and Tauri.
  wordlist-SCOWL.txt       the 65,381 English words behind the word-game and
                           spelling skills.
  fonts-OFL-1.1.txt        Hanken Grotesk and IBM Plex Mono, under the SIL
                           Open Font License, bundled in the app.

Not here, and why:

  Text in pictures is read by macOS's own recogniser (the Vision framework),
  through the pigeon-eye helper in Contents/MacOS, which is Pigeon's own code.
  Tesseract (Apache 2.0) is not bundled; Pigeon runs one only when told to.
  The adapters Pigeon carries — the category adapter inside patch.pigeon, and
  the transcript-tidying adapter in Contents/Resources/model — are Pigeon's
  own, trained on Qwen3-VL-2B-Instruct, and fall under Pigeon's licence. A
  Pigeon a person adds carries its own maker's licence inside its file.
  Wikipedia text quoted in a reply is CC BY-SA 4.0 and carries its link in the
  reply itself, which is where attribution belongs for a quotation.

The first-run download writes its own copies of the model notices beside the
weights, before a single byte arrives — see ATTRIBUTION.md in the models
folder, which also records the exact size and SHA-256 of each file.
