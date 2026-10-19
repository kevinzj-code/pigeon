/* pii.js - the patterns behind flagPii and maskSensitive.
 *
 * Patterns, not understanding. Every detector here both misses things and
 * fires on things that are not what it thinks - a sixteen-digit order number
 * passes the same check a card number does. Both skills say so in their replies
 * rather than presenting a match list as a finding. The check digits (Luhn,
 * mod-97) are what separate "looks like a card" from "is a well-formed card",
 * and they are used wherever the format defines one.
 */

const luhn = (digits) => {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = Number(digits[i]);
    if (double) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
};

const mod97 = (s) => {
  const rearranged = s.slice(4) + s.slice(0, 4);
  const digits = [...rearranged].map((c) => (/[A-Z]/.test(c) ? String(c.charCodeAt(0) - 55) : c)).join('');
  let r = 0;
  for (const ch of digits) r = (r * 10 + Number(ch)) % 97;
  return r === 1;
};

export const DETECTORS = [
  { kind: 'email', label: 'email address', re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+\b/g },
  {
    kind: 'card', label: 'payment card number',
    re: /\b(?:\d[ -]?){12,18}\d\b/g,
    /* Luhn is what makes this worth flagging. Without it every long digit run -
       order numbers, tracking codes, timestamps - comes back as a card. */
    accept: (m) => { const d = m.replace(/\D/g, ''); return d.length >= 13 && d.length <= 19 && luhn(d); }
  },
  {
    kind: 'iban', label: 'IBAN',
    /* Written with the spaces allowed: IBANs are almost always printed in
       four-character groups, and a pattern that only matches the unspaced form
       leaves the spaced one to be claimed by the phone detector. */
    re: /\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]){10,32}\b/g,
    accept: (m) => mod97(m.replace(/\s/g, '').toUpperCase())
  },
  { kind: 'ssn', label: 'US social security number', re: /\b\d{3}-\d{2}-\d{4}\b/g },
  { kind: 'nino', label: 'UK national insurance number', re: /\b[A-CEGHJ-PR-TW-Z]{2}\s?\d{2}\s?\d{2}\s?\d{2}\s?[A-D]\b/g },
  { kind: 'ipv4', label: 'IP address', re: /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g },
  { kind: 'postcode', label: 'UK postcode', re: /\b[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}\b/gi },
  {
    kind: 'phone', label: 'phone number',
    re: /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{2,6}\)[\s.-]?)?\d{1,6}(?:[\s.-]\d{2,6}){1,4}\b/g,
    /* Seven digits is the shortest real subscriber number; below that this
       matches dates, prices and version strings far more often than phones.
       The first group allows a single digit because French numbers are written
       +33 1 42 68 53 00 - requiring two dropped the country code and the area
       digit and returned the tail of the number as if it were the whole thing. */
    accept: (m) => { const d = m.replace(/\D/g, ''); return d.length >= 7 && d.length <= 15; }
  }
];

export function findSensitive (text, kinds) {
  const wanted = kinds?.length ? new Set(kinds) : null;
  const found = [];
  const taken = [];
  for (const d of DETECTORS) {
    if (wanted && !wanted.has(d.kind)) continue;
    for (const m of String(text).matchAll(d.re)) {
      const value = m[0];
      const start = m.index;
      const end = start + value.length;
      if (!(d.accept?.(value) ?? true)) continue;
      /* Detectors overlap - an IBAN is also a long digit run, a phone number
         sits inside a postcode line. First match wins by detector order, so the
         more specific pattern claims the span. */
      if (taken.some(([s, e]) => start < e && end > s)) continue;
      taken.push([start, end]);
      found.push({ kind: d.kind, label: d.label, value, start, end });
    }
  }
  return found.sort((a, b) => a.start - b.start);
}
