/* picture.js — a picture made ready for a model that sees it: Peek and the
 * picture Pigeons, from the window, the menu bar and the summon bar alike. */

/* A picture made small enough to send: at most 1024 px on its longer side, as
   a JPEG. The picture server reads every pixel it is given — 768×576 was 593
   tokens and ~3.5 s — so a 12-megapixel photo would be minutes of work for a
   model that was trained on small pictures anyway. */
export const PREVIEW_MAX = 512;

export function pictureOf (file, max = 1024) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.max(1, Math.round(img.naturalWidth * k));
      const h = Math.max(1, Math.round(img.naturalHeight * k));
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      const g = cv.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
      g.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      /* The preview kept with the turn: big enough to open in the chat
         (PREVIEW_MAX on its longer side), small enough to live in the file. */
      const t = Math.min(1, PREVIEW_MAX / Math.max(w, h));
      const small = document.createElement('canvas');
      small.width = Math.max(1, Math.round(w * t)); small.height = Math.max(1, Math.round(h * t));
      small.getContext('2d').drawImage(cv, 0, 0, small.width, small.height);
      resolve({ url: cv.toDataURL('image/jpeg', 0.9), thumb: small.toDataURL('image/jpeg', 0.78), width: w, height: h });
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('that picture could not be opened')); };
    img.src = url;
  });
}

/* The preview alone, for a picture whose TEXT is what goes to the Pigeon: the
   chat still shows the picture that was read. */
export async function previewOf (file) {
  const p = await pictureOf(file, PREVIEW_MAX);
  return { thumb: p.thumb, width: p.width, height: p.height };
}
