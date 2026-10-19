/* check-notes.js — what the import check said about a Pigeon, in words for someone
 * who knows nothing about models.
 *
 * Rust sends each note as a code and the specific file, field or key it is
 * about (`pigeon::Note`); the sentence is chosen here. A note says what a
 * person needs to know and can act on. The particulars — file names, a key's
 * id — sit behind "Details", where a person who wants them can find them and
 * nobody else has to read them.
 */

import { esc } from './html.js';

/* card.<field>, as the part of the maker's description it is. */
const CARD_PARTS = {
  'card.does': 'what it does',
  'card.input_hint': 'what to give it',
  'card.output_noun': 'what one answer is called',
  'card.talks_like': 'how it talks',
  'card.examples': 'its examples',
  'card.input_stats': 'how long its inputs usually are',
  'card.check': 'its test result',
  'card.revision': 'its revision number'
};

/* Why a list of keys was skipped, by the cause the reader gives (§13.2):
   each one is also why there is no Play button. */
const SKIPPED = {
  unreadable: 'It came with a list of keys it can press, but the list couldn’t be used, so it won’t press anything and can’t play. Its answers still work.',
  keys: 'It came with a list of keys it can press, but the list couldn’t be used, so it won’t press anything and can’t play. Its answers still work.',
  no_version: 'It can’t play: its list of keys doesn’t say which version of the app it was made for. Its answers still work.',
  newer: 'It can’t play: its list of keys was made for a newer version of this app. Updating the app may let it play. Its answers still work.',
  no_frames: 'It can’t play: its file doesn’t say how its pictures of the screen were taken, so this app can’t show it the screen the way it learned. Its answers still work.',
  no_pictures: 'It came with a list of keys to press, but it doesn’t look at pictures, so the list isn’t used. Its answers still work.',
  crop: 'It can’t play: the part of the window it learned to look at isn’t described in a way this app can follow. Its answers still work.',
  stack: 'It can’t play: it learned from pictures made of a number of frames this app can’t make. Its answers still work.',
  max_side: 'It can’t play: the picture size it learned from isn’t one this app can make. Its answers still work.',
  gap: 'It can’t play: its file doesn’t say how far apart in time its stacked pictures were taken. Its answers still work.'
};

const str = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v));

/* One note as { text, more }: the sentence, and the particulars for Details
   (empty when there are none worth showing). An unknown code still says
   something, so a newer check never goes silent on an older page. */
export function noteWords (note) {
  const d = (note && note.detail) || {};
  switch (note && note.code) {
    case 'same_base_other_quant':
      return str(d.tested_on) && d.tested_on === d.here
        ? { text: 'Its maker tested it on a file with the same name as the one on this Mac, but this app hasn’t confirmed they are the same file. It works, but its answers may not match the maker’s test exactly.',
            more: `Tested on and here: ${str(d.here)}` }
        : { text: 'Its maker tested it on a different copy of its model than the one on this Mac. It works, but its answers may not match the maker’s test exactly.',
            more: `Tested on: ${str(d.tested_on)} · This Mac has: ${str(d.here)}` };
    case 'card_skipped': {
      const part = CARD_PARTS[d.field];
      return { text: part
        ? `Its maker’s description couldn’t be read — the part saying ${part} — so it isn’t shown. The Pigeon itself works normally.`
        : 'Its maker’s description couldn’t be read, so it isn’t shown. The Pigeon itself works normally.', more: '' };
    }
    case 'prompt_unchecked':
      return { text: 'This Pigeon was made before Pigeons carried a self-check, so this app can’t confirm it is being asked the way it was taught. It will probably work, but its maker’s test score is less certain here.', more: '' };
    case 'trained_quantized':
      return { text: 'It was taught on a smaller, compressed copy of its model, so its answers about pictures may be less reliable than its maker’s score suggests.', more: '' };
    case 'untrusted_seal':
      return { text: 'It carries a signature, but from someone this app doesn’t know, so the signature proves nothing. It’s treated like an unsigned Pigeon.', more: str(d.why) };
    case 'actions_skipped':
      return { text: SKIPPED[d.cause] || SKIPPED.unreadable, more: str(d.why) };
    case 'registry_disagrees':
      return { text: 'A model file on this Mac doesn’t match the published list of models, so Pigeon ignored that list when checking this one. Nothing is wrong with this Pigeon.',
        more: str(d.entry) ? `List entry: ${str(d.entry)}` : '' };
    case 'temperature_ignored':
      return { text: 'Its file asks for varied answers, but it’s meant to give one exact answer, so Pigeon keeps its answers steady.', more: '' };
    case 'same_pigeon':
      if (d.keeps === 'this') {
        return { text: 'You already have this Pigeon in a larger copy that carries its picture reader. This Mac has that reader, so Pigeon keeps this smaller copy instead. Nothing about how it answers changes.', more: '' };
      }
      return { text: 'You already have a smaller copy of this Pigeon. This copy carries the picture reader that one needs, so adding it puts the reader on this Mac and keeps your smaller copy.', more: '' };
    case 'cannot_play':
      if (d.cause === 'key') {
        return { text: 'It can’t play: one of the keys it presses isn’t on a Mac keyboard. Its answers still work.',
          more: `Key: ${str(d.key)}${d.code != null ? ` (code ${str(JSON.stringify(d.code))})` : ''}` };
      }
      if (d.cause === 'no_keys') return { text: 'It can’t play: its file lists no keys for it to press. Its answers still work.', more: '' };
      return { text: SKIPPED[d.cause] || SKIPPED.unreadable, more: '' };
    default:
      return { text: 'Its check raised something this version of the app has no words for yet. It still loaded.', more: str(note && note.code) };
  }
}

/* The notes, as paragraphs of `cls`, each with its Details when it has any. */
export function notesHtml (notes = [], cls = 'meet-note') {
  return (Array.isArray(notes) ? notes : []).map((n) => {
    const { text, more } = noteWords(n);
    const details = more ? ` <details class="note-more"><summary>Details</summary>${esc(more)}</details>` : '';
    return `<div class="${cls}" data-note="${esc(str(n && n.code))}">${esc(text)}${details}</div>`;
  }).join('');
}

/* Whether a note stands in for the "came without a card" line: the card was
   there, but could not be read. */
export const cardWasSkipped = (notes = []) => Array.isArray(notes) && notes.some(n => n && n.code === 'card_skipped');
