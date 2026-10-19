/* color.js — one parser and one set of conversions for every §16 skill.
 *
 * Colour maths is easy to get subtly wrong in ways that only show on some
 * inputs — the hue of a grey, the rounding of a shorthand hex — so it lives
 * here once rather than in ten skills that would drift apart.
 */

/** Accepts #rgb, #rgba, #rrggbb, #rrggbbaa, rgb()/rgba(), hsl()/hsla(). */
export function parseColor (input) {
  const s = String(input).trim();

  const hex = /^#?([0-9a-f]{3,8})$/i.exec(s);
  if (hex) {
    const body = hex[1];
    if (![3, 4, 6, 8].includes(body.length)) return null;
    /* Shorthand doubles each digit: #abc is #aabbcc, not #abc000. */
    const full = body.length <= 4 ? [...body].map((c) => c + c).join('') : body;
    const n = (i) => parseInt(full.slice(i, i + 2), 16);
    return { r: n(0), g: n(2), b: n(4), a: full.length === 8 ? Math.round((n(6) / 255) * 100) / 100 : 1 };
  }

  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.%]+))?\s*\)$/i.exec(s);
  if (rgb) {
    const clamp = (v) => Math.max(0, Math.min(255, Math.round(Number(v))));
    return { r: clamp(rgb[1]), g: clamp(rgb[2]), b: clamp(rgb[3]), a: alphaOf(rgb[4]) };
  }

  const hsl = /^hsla?\(\s*([\d.-]+)(?:deg)?[\s,]+([\d.]+)%?[\s,]+([\d.]+)%?(?:[\s,/]+([\d.%]+))?\s*\)$/i.exec(s);
  if (hsl) {
    const { r, g, b } = hslToRgb(Number(hsl[1]), Number(hsl[2]), Number(hsl[3]));
    return { r, g, b, a: alphaOf(hsl[4]) };
  }
  return null;
}

const alphaOf = (raw) => {
  if (raw === undefined) return 1;
  const v = raw.endsWith('%') ? Number(raw.slice(0, -1)) / 100 : Number(raw);
  return Number.isFinite(v) ? Math.max(0, Math.min(1, Math.round(v * 100) / 100)) : 1;
};

export const toHex = (r, g, b) =>
  '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('').toUpperCase();

export function rgbToHsl (r, g, b) {
  const rr = r / 255, gg = g / 255, bb = b / 255;
  const max = Math.max(rr, gg, bb), min = Math.min(rr, gg, bb);
  const l = (max + min) / 2;
  /* A grey has no hue at all. Reporting 0 is the convention, but it is a
     placeholder rather than a measurement, and lightenColor must not rotate it. */
  if (max === min) return { h: 0, s: 0, l: l * 100 };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === rr) h = ((gg - bb) / d + (gg < bb ? 6 : 0)) / 6;
  else if (max === gg) h = ((bb - rr) / d + 2) / 6;
  else h = ((rr - gg) / d + 4) / 6;
  return { h: h * 360, s: s * 100, l: l * 100 };
}

export function hslToRgb (h, s, l) {
  const hh = (((h % 360) + 360) % 360) / 360;
  const ss = Math.max(0, Math.min(100, s)) / 100;
  const ll = Math.max(0, Math.min(100, l)) / 100;
  if (ss === 0) {
    const v = Math.round(ll * 255);
    return { r: v, g: v, b: v };
  }
  const q = ll < 0.5 ? ll * (1 + ss) : ll + ss - ll * ss;
  const p = 2 * ll - q;
  const channel = (t) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  return {
    r: Math.round(channel(hh + 1 / 3) * 255),
    g: Math.round(channel(hh) * 255),
    b: Math.round(channel(hh - 1 / 3) * 255)
  };
}

/* WCAG relative luminance — the sRGB gamma curve, not a plain average. A naive
   (r+g+b)/3 gets contrast ratios wrong by enough to pass text that fails. */
export function luminance (r, g, b) {
  const channel = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}
