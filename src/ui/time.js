/* time.js — how a moment reads in a chat list: "09:41" today, "Yesterday",
 * "Tuesday" within the week, then "2 Sept"; which group a row sits under; and
 * the day words search should match.
 *
 * Weekday and month names are spelled out here rather than asked of Intl, so
 * "Sept" reads the same on every Mac. ICU builds disagree about such things —
 * formatNumber's compact example already fails on this one for that reason.
 *
 * Plain strings and no DOM, so the test suite can import it.
 */

import { hm } from './html.js';

const DAY = 86400000;
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'June', 'July', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const startOfDay = (ms) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };

export const GROUPS = Object.freeze(['Today', 'Yesterday', 'Last 7 days', 'Earlier']);

/** Whole calendar days between a moment and now: 0 today, 1 yesterday. */
export const daysAgo = (ms, now = Date.now()) => Math.round((startOfDay(now) - startOfDay(ms)) / DAY);

/** What a chat row's time slot says. */
export function slotFor (ms, now = Date.now()) {
  if (!ms) return '';
  const d = daysAgo(ms, now);
  if (d <= 0) return hm(ms);
  if (d === 1) return 'Yesterday';
  const t = new Date(ms);
  if (d < 7) return WEEKDAYS[t.getDay()];
  return `${t.getDate()} ${MONTHS[t.getMonth()]}`;
}

/** The heading a chat row sits under once the list is past today. */
export function groupFor (ms, now = Date.now()) {
  const d = daysAgo(ms, now);
  if (d <= 0) return GROUPS[0];
  if (d === 1) return GROUPS[1];
  if (d < 7) return GROUPS[2];
  return GROUPS[3];
}

/** The day words a search for this moment should match, lower-cased:
 *  "tuesday", "8 sept", "september", and "yesterday" or "last week" when true. */
export function dayWords (ms, now = Date.now()) {
  if (!ms) return [];
  const d = daysAgo(ms, now);
  const t = new Date(ms);
  const words = [
    WEEKDAYS[t.getDay()].toLowerCase(),
    `${t.getDate()} ${MONTHS[t.getMonth()].toLowerCase()}`,
    MONTHS[t.getMonth()].toLowerCase(),
    MONTHS_LONG[t.getMonth()]
  ];
  if (d <= 0) words.push('today');
  else if (d === 1) words.push('yesterday');
  if (d >= 0 && d < 7) words.push('this week');
  else if (d >= 7 && d < 14) words.push('last week');
  return [...new Set(words)];
}

/* How long ago a message was, as a hover reads it: "just now", "5 mins ago",
   "3 hours ago", "1 day ago" — and past a week the short date, which says
   more than "9 days ago" would. */
export function ago (ms, now = Date.now()) {
  if (!ms) return '';
  const s = Math.max(0, Math.round((now - ms) / 1000));
  const n = (k, word) => `${k} ${word}${k === 1 ? '' : 's'} ago`;
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return n(Math.max(1, m), 'min');
  const h = Math.round(m / 60);
  if (h < 24) return n(h, 'hour');
  const d = daysAgo(ms, now);
  if (d < 7) return n(Math.max(1, d), 'day');
  const t = new Date(ms);
  return `${t.getDate()} ${MONTHS[t.getMonth()]}`;
}

/* The same moment to the minute, for the click that asks: "Oct 14, 2026 10:00 PM". */
export function fullStamp (ms) {
  if (!ms) return '';
  const t = new Date(ms);
  const h24 = t.getHours();
  const h = h24 % 12 || 12;
  const mm = String(t.getMinutes()).padStart(2, '0');
  return `${MONTHS[t.getMonth()]} ${t.getDate()}, ${t.getFullYear()} ${h}:${mm} ${h24 < 12 ? 'AM' : 'PM'}`;
}
