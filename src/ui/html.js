/* html.js — the small pieces every view draws with: escaping, the icon set,
 * and how a time reads in a list. Plain strings and no DOM, so the test suite
 * can import everything under src/ui/.
 */

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* Text with the first occurrence of what was searched for marked. `q` is
   already lower-cased. */
export const mark = (text, q) => {
  const s = String(text ?? '');
  const at = q ? s.toLowerCase().indexOf(q) : -1;
  return at < 0 ? esc(s) : `${esc(s.slice(0, at))}<mark>${esc(s.slice(at, at + q.length))}</mark>${esc(s.slice(at + q.length))}`;
};

const svg = (body, width = '1.9') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const ICONS = {
  /* Lines with a clock: a timed transcript, which is what the chip is about. */
  transcript: svg('<path d="M4 6h11M4 10h9M4 14h6"/><circle cx="17" cy="16" r="4.5"/><path d="M17 14.2V16l1.3.9"/>'),
  chat: svg('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>'),
  stop: svg('<rect x="6.5" y="6.5" width="11" height="11" rx="2.5"/>'),
  skills: svg('<path d="M4 6h16M4 12h16M4 18h10"/>'),
  plan: svg('<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/><path d="M6.5 10v4.5A2.5 2.5 0 0 0 9 17h5"/>'),
  ledger: svg('<path d="M12 3v18M5 8h4M5 12h4M15 8h4M15 12h4"/><rect x="3" y="3" width="18" height="18" rx="2"/>'),
  send: svg('<path d="M22 2 11 13M22 2l-7 20-4-9-9-4z"/>', '2'),
  newchat: svg('<path d="M21 14a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h8"/><path d="M18 3v6M15 6h6"/>'),
  /* A page with a folded corner: a Pigeon's own file. */
  doc: svg('<path d="M6.5 3h8l4 4v14h-12z"/><path d="M14.5 3v4h4M9 12h6M9 16h6"/>'),
  web: svg('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/>'),
  eye: svg('<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>', '1.8'),
  play: svg('<path d="M8 5.5v13l10.5-6.5z"/>', '2'),
  image: svg('<rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="8.5" cy="9.5" r="1.6"/><path d="M21 15.5l-4.8-4.8a1.5 1.5 0 0 0-2.1 0L6 19"/>'),
  /* The message-action set, drawn to match the desktop app's exactly. */
  copy: svg('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>', '1.8'),
  pencil: svg('<path d="M4 20h4l10-10-4-4L4 16v4Z"/><path d="M13.5 6.5 17.5 10.5"/>', '1.8'),
  retry: svg('<path d="M21 12a9 9 0 1 1-2.64-6.36"/><polyline points="21 3 21 8 16 8"/>', '1.8'),
  x: svg('<path d="M6 6l12 12M18 6L6 18"/>', '1.8'),
  ellipsis: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg>',
  chevL: svg('<path d="M15 5l-7 7 7 7"/>', '2'),
  chevR: svg('<path d="M9 5l7 7-7 7"/>', '2'),
  /* The messaging layout's own. */
  search: svg('<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>', '2'),
  compose: svg('<path d="M12 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6"/><path d="M17.6 3.4a2 2 0 0 1 2.9 2.9L12 14.8l-3.8.9.9-3.8z"/>', '1.8'),
  pin: svg('<path d="M9 4h6l-1 5.5 3 3V14H7v-1.5l3-3z"/><path d="M12 14v6"/>'),
  bell: svg('<path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>'),
  bellOff: svg('<path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/><path d="M3.5 3.5l17 17"/>'),
  unread: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.5" fill="currentColor"/></svg>',
  read: svg('<circle cx="12" cy="12" r="4.5"/>'),
  info: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5"/><path d="M12 7.8h.01"/>', '1.8'),
  gear: svg('<circle cx="12" cy="12" r="3"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>', '2'),
  back: svg('<path d="M15 5l-7 7 7 7"/>', '2'),
  bubble: svg('<path d="M4 5.5h16v10H10l-4.5 4v-4H4z"/>'),
  trash: svg('<path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13"/>'),
  rename: svg('<path d="M4 7V5h16v2"/><path d="M12 5v14"/><path d="M9 19h6"/>'),
  smile: svg('<circle cx="12" cy="12" r="8.5"/><path d="M8.5 14a4 4 0 0 0 7 0"/><path d="M9.5 9.5h.01M14.5 9.5h.01"/>'),
  forward: svg('<path d="M14 5l6 6-6 6"/><path d="M20 11H10a6 6 0 0 0-6 6v2"/>'),
  check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>', '2.2'),
  down: svg('<path d="M12 5v14M6 13l6 6 6-6"/>', '2')
};

const pad = (n) => String(n).padStart(2, '0');
const DAY = 86400000;
const startOfDay = (ms) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };

/** 14:02 */
export const hm = (ms) => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };

/** Today, Yesterday, a weekday within the week, else a date. */
export function dayName (ms, now = Date.now()) {
  const days = Math.round((startOfDay(now) - startOfDay(ms)) / DAY);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return new Date(ms).toLocaleDateString('en-GB', { weekday: 'long' });
  return new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/** What a chat row shows: the time today, otherwise the day. */
export function rowTime (ms, now = Date.now()) {
  if (!ms) return '';
  const day = dayName(ms, now);
  return day === 'Today' ? hm(ms) : day;
}
