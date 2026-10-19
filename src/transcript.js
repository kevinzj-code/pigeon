/* transcript.js — a turn as plain text, for the clipboard.
 *
 * Deliberately NOT `element.textContent`. Reading the rendered DOM would copy
 * whatever the markup happens to concatenate — the error code jammed against the
 * prose that follows it, the suggestion buttons' scores, the "show plan" label —
 * and it would drift the moment the markup changed. This mirrors `paintTurn`'s
 * branches instead — the four reply shapes, and the user bubble with or without
 * an image behind it — which is a real coupling, so the suite can hold the two
 * together: `copyOf` and the rendered reply must say the same thing.
 *
 * No DOM here on purpose. app.js cannot be imported by the test suite (it needs
 * a document); this can.
 */

import { toPlainText } from './template.js';
import { describeAttachment } from './ocr.js';

/* Kept in step with MODES.NO_SKILL in turn.js. Imported rather than retyped
   would be better, but turn.js pulls in the executor and the whole registry —
   a clipboard helper should not drag that in. The test suite asserts they
   match. */
export const NO_SKILL = 'no-skill';

/**
 * One turn, as the text a person would expect on their clipboard.
 * @param {object} turn
 * @param {{ you?: string, pigeon?: string }} [labels]
 * @returns {string}
 */
export function copyOf (turn, labels = {}) {
  if (!turn) return '';
  const you = labels.you ?? 'You:';
  const pigeon = labels.pigeon ?? 'Pigeon:';

  /* A question asked with an image is copied as the question the user TYPED,
     then the text that was read and sent, labelled as such — the same two parts
     the bubble shows, rather than the composed message the router saw. */
  const lines = turn.image
    ? [
        `${you} ${turn.image.typed ?? ''}`.trim(),
        `[from an image — ${describeAttachment(turn.image)}]\n${turn.image.text ?? ''}`
      ]
    : [`${you} ${turn.message ?? ''}`.trim()];
  if (turn.answered) lines.push(`${you} ${turn.answered.value}`.trim());
  lines.push(`${pigeon} ${answerOf(turn)}`.trim());
  return lines.join('\n\n');
}

/** Just the answer, without the speaker labels — what the Copy button on an
 *  assistant bubble should put on the clipboard. */
export function answerOf (turn) {
  if (!turn) return '';

  if (turn.ask) return turn.ask.question;

  if (turn.invalid) {
    return `That plan didn't pass validation: ${turn.invalid.map(e => e.message).join(' ')}`;
  }

  if (turn.mode === NO_SKILL) {
    const sugg = turn.suggestions || [];
    const top = turn.routing?.candidates?.[0];
    const opening = sugg.length
      ? `Nothing scored high enough for me to pick a skill. ${sugg.length === 1 ? 'The nearest match was' : 'The nearest matches were'}: ${sugg.map(c => `${c.name} ${c.score.toFixed(2)}`).join(', ')}`
      : 'No skill covers that, so I have nothing computed to give you. Pen can answer it in prose — nothing there is computed or checked, which is the trade.';
    /* The scores go on the clipboard too. Someone copying a decline is almost
       always about to ask why it declined. */
    const why = `Top candidate ${top?.name ?? 'none'} scored ${(top?.score ?? 0).toFixed(3)}, under the ${turn.routing?.threshold} threshold.`;
    return `${opening}\n${why}`;
  }

  return turn.reply ? toPlainText(turn.reply.segments) : '';
}
