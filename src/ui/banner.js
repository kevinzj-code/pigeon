/* banner.js — a reply landed in a chat you are not looking at.
 *
 * The banner slides down inside the window, names who replied and in which
 * chat, and opens that chat when clicked. Inside the window only: Pigeon asks
 * for no notification permission, so its capabilities stay core:default.
 *
 * Strings only, no DOM, so the test suite can draw it.
 */

import { esc } from './html.js';

export function bannerHtml ({ chatId, name = 'Pigeon', title = '', text = '', avatar = '' } = {}) {
  const line = String(text || '').replace(/\s+/g, ' ').trim();
  return `<button class="banner" data-banner="${esc(chatId)}">${avatar}<span class="banner-txt"><b>${esc(name)}</b>${title ? `<span>${esc(title)}</span>` : ''}<em>${esc(line.length > 90 ? `${line.slice(0, 89)}…` : line)}</em></span></button>`;
}
