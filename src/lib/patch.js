/* patch.js — Patch the pigeon, the app's one illustrated character.
 *
 * He is a sprite sheet now (assets/patch-sprites.png): the owner's pigeon art
 * — grey bird, round glasses, amber beak — cut into 146 frames on a 12-column
 * grid. Every frame is one 160 × 144 cell with his feet on the same ground
 * line, so one animation can follow another without him jumping.
 *
 * TAGS names the animations by frame range, as the sheet's own page does.
 * patch() draws one frame; patch-life.js is what steps through them.
 */

export const SHEET = 'assets/patch-sprites.png';
/* The same sheet at half size, for the brand mark: at 22 or 44 px nothing of
   the full 1920 × 2448 sheet is seen, and a window that draws only the mark
   decodes a quarter of the pixels. The perch, at 84 px on a Retina screen,
   wants the full one. */
export const SHEET_HALF = 'assets/patch-sprites-half.png';
export const HALF_UP_TO = 44;
export const COLS = 12;
export const ROWS = 17;
export const CELL = Object.freeze([160, 144]);

/* from/to are frame numbers across the whole sheet; each tag starts a new row. */
export const TAGS = Object.freeze({
  idle: { row: 0, n: 12, fps: 8, loop: true },
  blink: { row: 1, n: 6, fps: 14 },
  look: { row: 2, n: 12, fps: 8, loop: true },
  talk: { row: 3, n: 8, fps: 10, loop: true },
  walk: { row: 4, n: 8, fps: 12, loop: true },
  peck: { row: 5, n: 10, fps: 12 },
  paint: { row: 6, n: 8, fps: 10, loop: true },
  hop: { row: 7, n: 10, fps: 12 },
  fly: { row: 8, n: 6, fps: 12, loop: true },
  sleep: { row: 9, n: 8, fps: 4, loop: true },
  proud: { row: 10, n: 11, fps: 10 },
  loaf_down: { row: 11, n: 6, fps: 10 },
  loaf: { row: 12, n: 12, fps: 6, loop: true },
  loaf_sleep: { row: 13, n: 12, fps: 5, loop: true },
  glide: { row: 14, n: 8, fps: 8, loop: true },
  wave: { row: 15, n: 8, fps: 12, loop: true },
  mark: { row: 16, n: 1, fps: 1 }
});

/**
 * One frame of him, as a sized box with the sheet behind it.
 * @param {string} tag   a name from TAGS
 * @param {number} frame which frame of that animation
 * @param {number} size  rendered width in px; height follows the 160:144 cell
 * @returns {string} an inline <span> string
 */
export function patch (tag = 'idle', frame = 0, size = 44) {
  const t = TAGS[tag] || TAGS.idle;
  const f = Math.max(0, Math.min(t.n - 1, frame | 0));
  const h = Math.round(size * CELL[1] / CELL[0]);
  const sheet = size <= HALF_UP_TO ? SHEET_HALF : SHEET;
  return `<span class="patch-sprite" aria-hidden="true" style="width:${size}px;height:${h}px;` +
    `background-image:url(${sheet});background-size:${size * COLS}px ${h * ROWS}px;` +
    `background-position:${-f * size}px ${-t.row * h}px"></span>`;
}
