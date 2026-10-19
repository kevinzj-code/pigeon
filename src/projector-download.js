/* projector-download.js — one press of "Download, then add" for a picture
 * Pigeon's stock picture reader (its projector, format §13.1), from the Meet
 * sheet. Kept out of app.js so the whole flow runs under test: on 2026-10-06
 * the first press downloaded and verified the file, then stopped on a local
 * named like the sheet it was closing, and was reported as the download
 * failing; its Retry then ran the models download, because the kind had been
 * reset before the step that threw.
 *
 * So the download is the only thing that can be reported as the download
 * stopping, and what the next Retry fetches is decided from the outcome.
 *
 * `want` is { sha, bytes, host } from the Meet row. `io` is the app's:
 * download(sha), cancelled (the cancel message), shown(sheet), toast(text),
 * logWeb(entry) and addHeld() for the Pigeons held through the download.
 * Returns { stage: 'done' | 'paused' | 'failed', kind, error? }, where `kind`
 * is what a Retry on this card downloads next.
 */

/* The web log's line for it: where it came from, as the registry's address
   names it. */
export function projectorLogEntry (want) {
  const source = want.host || 'the published list’s address';
  return { text: `A picture reader, for a picture Pigeon ← ${source}`, hosts: want.host ? [want.host] : [] };
}

export async function fetchProjector (want, sheet, close, io) {
  try {
    await io.download(want.sha);
  } catch (e) {
    const msg = String(e && e.message ? e.message : e);
    if (msg === io.cancelled) {
      if (io.shown(sheet)) close();
      return { stage: 'paused', kind: 'models' };
    }
    // Retry on this card fetches the picture reader again, never the models.
    return { stage: 'failed', error: msg, kind: 'projector' };
  }
  /* Here the file is on this Mac and its hash matched. Nothing below is the
     download stopping, so nothing below may be reported as it. */
  if (io.shown(sheet)) close();
  io.toast('Picture reader ready · checked it arrived intact');
  io.logWeb(projectorLogEntry(want));
  try {
    await io.addHeld();
  } catch (e) {
    io.toast(`The picture reader arrived, but the Pigeon could not be added: ${String(e && e.message ? e.message : e)}`);
  }
  return { stage: 'done', kind: 'models' };
}
