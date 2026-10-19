/* sidebar.js — the conversation list, as strings.
 *
 * Rows, the pinned row above them, what a search finds, and the Pigeons tab.
 * Each row says which Pigeon it is with, what last happened in it, and whether
 * something is still coming — so the list itself answers "where was I, and is
 * anything waiting", the way a messaging app's does.
 */

import { esc, ICONS, mark } from './html.js';
import { slotFor, groupFor, dayWords, GROUPS } from './time.js';
import { avatarHtml, pigeonOf, pickForChat, factPill, builtInPigeons, canMessage } from './pigeons.js';
import { pathOf } from '../thread.js';
import { answerOf } from '../transcript.js';
import { MODES } from '../turn.js';
import { byActivity, lastActivity, isEmpty, hasDraft, searchAll } from '../chats.js';

/* A reply as one line of text, whichever lane wrote it. A written reply keeps
   its words in `reply.text`; a computed one in segments, which answerOf reads.
   A decline is one plain phrase in a list row — the router's scores belong in
   Message info, not in a preview. */
export function replyText (turn) {
  if (!turn) return '';
  if (turn.interrupted) return turn.error || '';
  if (turn.lane === 'B') return (turn.reply && turn.reply.text) || turn.error || '';
  if (turn.consent) return 'Waiting for a yes to look this up';
  if (turn.mode === MODES.NO_SKILL || turn.invalid) return 'Couldn’t work that out';
  /* A look-up nobody said yes to is not an answer, and its error text is not
     one either: the row says what the bubble says. */
  if ((turn.results || []).some(r => !r.ok && r.error && r.error.code === 'NETWORK_OFF')) return 'That needs a look-up on the web';
  return answerOf(turn);
}

const oneLine = (s) => String(s || '').replace(/\s+/g, ' ').trim();

/** The second line of a row. */
export function previewOf (c, { personas = [], activeId = null } = {}) {
  const d = pigeonOf(pickForChat(c), personas);
  if (c.inflight) return `<span class="busy">${esc(oneLine(c.inflight.stage) || `${d.name} is replying`)}…</span>`;
  const draft = c.draft;
  if (draft && c.id !== activeId && (draft.text || draft.attachment)) {
    return `<span class="draft">Draft:</span> ${esc(oneLine(draft.text) || (draft.attachment ? `an image, ${draft.attachment.name}` : ''))}`;
  }
  const path = pathOf(c);
  const last = path[path.length - 1];
  if (!last) return '<i>No messages yet</i>';
  const reply = oneLine(replyText(last));
  return reply ? `${esc(d.name)}: ${esc(reply)}` : `You: ${esc(oneLine(last.message))}`;
}

export function rowHtml (c, { personas = [], activeId = null, now = Date.now() } = {}) {
  const d = pigeonOf(pickForChat(c), personas);
  const on = c.id === activeId;
  return `<div class="crow-wrap${c.unread ? ' unread' : ''}" data-row="${esc(c.id)}">
    <button class="crow${on ? ' on' : ''}" data-chat="${esc(c.id)}"${on ? ' aria-current="true"' : ''} title="${esc(c.title)} — with ${esc(d.name)}">
      ${c.unread ? '<span class="udot" aria-label="Unread"></span>' : ''}${avatarHtml(d, 40)}
      <span class="crow-main">
        <span class="crow-top"><b>${esc(c.title)}</b>${c.muted ? `<span class="muted" title="Alerts hidden">${ICONS.bellOff}</span>` : ''}<time>${esc(slotFor(lastActivity(c), now))}</time></span>
        <span class="crow-prev">${previewOf(c, { personas, activeId })}</span>
      </span>
    </button>
    <button class="crow-more" data-chat-menu="${esc(c.id)}" aria-label="More for ${esc(c.title)}" title="Rename, pin, delete…">${ICONS.ellipsis}</button>
  </div>`;
}

export function pinHtml (c, { personas = [], activeId = null } = {}) {
  const d = pigeonOf(pickForChat(c), personas);
  const on = c.id === activeId;
  return `<button class="pin${on ? ' on' : ''}" data-chat="${esc(c.id)}" data-pin="${esc(c.id)}" title="${esc(c.title)} — with ${esc(d.name)}">
    ${c.unread ? '<span class="udot" aria-label="Unread"></span>' : ''}${c.inflight ? '<span class="pin-busy"><span class="dots"><i></i><i></i><i></i></span></span>' : ''}
    ${avatarHtml(d, 46)}<span class="pin-name">${esc(c.title)}</span></button>`;
}

/**
 * The Chats tab. A chat whose first question is still being answered is listed
 * even with no turns, and so is the blank chat you are on and any blank chat
 * holding something you typed — a draft nobody can see is a draft that has been
 * lost. Other empty chats are not. While composing, a "New chat" row stands at
 * the top in place of the chat being composed, and nothing else is highlighted.
 * Once the list reaches past today it sits under Today, Yesterday, Last 7 days
 * and Earlier, and each row's time reads "09:41", "Tuesday" or "2 Sept".
 */
export function chatListHtml ({ chats = [], activeId = null, compose = null, personas = [], now = Date.now() } = {}) {
  const shownActive = compose ? null : activeId;
  const composing = compose ? compose.chatId : null;
  const visible = byActivity(chats).filter(c => c.id !== composing && (!isEmpty(c) || c.id === shownActive || hasDraft(c)));
  const pinned = visible.filter(c => c.pinnedAt).sort((a, b) => a.pinnedAt - b.pinnedAt);
  const rest = visible.filter(c => !c.pinnedAt);
  const to = compose && compose.to ? pigeonOf(compose.to, personas) : null;
  const composeRow = compose ? `<div class="crow-wrap"><button class="crow on" data-compose-row>
      ${avatarHtml(to, 40)}<span class="crow-main"><span class="crow-top"><b>New chat</b></span>
      <span class="crow-prev">${to ? `with ${esc(to.name)}` : 'Choose who to talk to'}</span></span></button></div>` : '';
  if (!pinned.length && !rest.length && !compose) return '<p class="list-empty">No chats yet. Press New chat to start one.</p>';
  const groups = [];
  for (const c of rest) {
    const label = groupFor(lastActivity(c), now);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.rows.push(c);
    else groups.push({ label, rows: [c] });
  }
  const headed = groups.length > 1 || Boolean(groups[0] && groups[0].label !== GROUPS[0]);
  const rows = groups.map(g => `${headed ? `<div class="sec">${esc(g.label)}</div>` : ''}${g.rows.map(c => rowHtml(c, { personas, activeId: shownActive, now })).join('')}`).join('');
  return `${pinned.length ? `<div class="pins">${pinned.map(c => pinHtml(c, { personas, activeId: shownActive })).join('')}</div>` : ''}
    ${composeRow}${rows}`;
}

/** What the search box finds: Pigeons by name, chats by title — or by day and who
 *  they are with, so "tuesday title" finds last Tuesday's Title Maker chat — and
 *  words inside messages. */
export function searchHtml (q, { chats = [], personas = [], now = Date.now(), patchState } = {}) {
  const needle = String(q || '').trim().toLowerCase();
  const pigeons = [pigeonOf('patch', personas, patchState), ...(personas || []).map(p => pigeonOf(`pigeon:${p.id}`, personas)), pigeonOf('chat')];
  const found = searchAll(chats, pigeons, needle, {
    textOf: replyText,
    dayWordsOf: (c) => dayWords(lastActivity(c), now),
    nameOf: (c) => pigeonOf(pickForChat(c), personas, patchState).name
  });
  let html = '';
  if (found.pigeons.length) {
    html += `<div class="sec">Pigeons</div>${found.pigeons.map(d => `<button class="crow" data-start="${esc(d.pick)}">${avatarHtml(d, 32)}
      <span class="crow-main"><span class="crow-top"><b>${mark(d.name, needle)}</b>${factPill(d)}</span>
      <span class="crow-prev one">New chat with ${esc(d.name)}</span></span></button>`).join('')}`;
  }
  if (found.chats.length) {
    html += `<div class="sec">Chats</div>${found.chats.map(c => `<button class="crow" data-chat="${esc(c.id)}">${avatarHtml(pigeonOf(pickForChat(c), personas), 32)}
      <span class="crow-main"><span class="crow-top"><b>${mark(c.title, needle)}</b><time>${esc(slotFor(lastActivity(c), now))}</time></span>
      <span class="crow-prev one">with ${esc(pigeonOf(pickForChat(c), personas).name)}</span></span></button>`).join('')}`;
  }
  if (found.messages.length) {
    html += `<div class="sec">Messages · ${found.messages.length}</div>${found.messages.map(m => {
      const c = chats.find(x => x.id === m.chatId);
      const d = pigeonOf(pickForChat(c), personas);
      const text = oneLine(m.text);
      const at = text.toLowerCase().indexOf(needle);
      const start = Math.max(0, at - 28);
      const snippet = (start ? '…' : '') + text.slice(start, at + needle.length + 70);
      return `<button class="crow" data-goto="${esc(m.chatId)}|${esc(m.turnId)}">${avatarHtml(d, 32)}
        <span class="crow-main"><span class="crow-top"><b>${esc(c.title)}</b></span>
        <span class="crow-prev">${m.who === 'you' ? 'You: ' : `${esc(d.name)}: `}${mark(snippet, needle)}</span></span></button>`;
    }).join('')}`;
  }
  return html || `<p class="list-empty">Nothing matches “${esc(String(q).trim())}”.</p>`;
}

/**
 * The Pigeons tab: the Pigeons you pinned in a grid at the top, in the order
 * you pinned them, the way pinned chats sit; then the three that come with the
 * app — Patch, Pen and Peek — then everything you added A to Z, each with what
 * it does. The built-ins lead for the same reason To: leads with Patch: they
 * came with the app rather than being ones you added, so they are not letters
 * among yours. Searching drops them back among the matches, because a typed
 * name is a search and not a default. A Pigeon the running server has not
 * loaded yet is listed like any other — sending to it loads it — so only a
 * built-in that cannot run (Patch before his skills are ready, Peek without
 * its model) says why not.
 *
 * A row opens the Pigeon's page. The way to message it is the compose button
 * that shows on hover, set apart so it is never pressed by accident on the
 * way to the page; ⋯ beside it holds Pin and the rest. Adding a Pigeon is the
 * + button at the top of the list, not a row.
 */
export function pigeonsTabHtml ({ personas = [], q = '', profile = null, patchState, pinned = {} } = {}) {
  const needle = String(q || '').trim().toLowerCase();
  const builtIn = builtInPigeons(personas, patchState);
  const added = (personas || []).map(p => pigeonOf(`pigeon:${p.id}`, personas));
  const matches = (list) => list.filter(d => !needle || d.name.toLowerCase().includes(needle));
  const byName = (list) => [...list].sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
  const pins = needle ? [] : [...builtIn, ...added].filter(d => pinned[d.pick]).sort((a, b) => pinned[a.pick] - pinned[b.pick]);
  const lead = needle ? [] : builtIn.filter(d => !pinned[d.pick]);
  const listed = byName(needle ? matches([...builtIn, ...added]) : added.filter(d => !pinned[d.pick]));
  const crow = (d) => {
    const off = (d.kind === 'verified' || d.kind === 'peek') && !d.loaded;
    const go = canMessage(d)
      ? `<button class="crow-go" data-start="${esc(d.pick)}" aria-label="New chat with ${esc(d.name)}" title="New chat with ${esc(d.name)}">${ICONS.compose}</button>`
      : '';
    return `<div class="crow-wrap prow" data-row="${esc(d.pick)}"><button class="crow${profile === d.pick ? ' on' : ''}${off ? ' dim' : ''}" data-profile="${esc(d.pick)}" title="About ${esc(d.name)}">${avatarHtml(d, 36)}
      <span class="crow-main"><span class="crow-top"><b>${mark(d.name, needle)}</b></span>
      <span class="crow-prev one">${esc(off ? d.line : d.does)}</span></span></button>
      <span class="crow-side">${go}<button class="crow-more" data-pigeon-menu="${esc(d.pick)}" aria-label="More for ${esc(d.name)}" title="Pin, new chat…">${ICONS.ellipsis}</button></span></div>`;
  };
  const pin = (d) => `<button class="pin${profile === d.pick ? ' on' : ''}" data-profile="${esc(d.pick)}" data-pinned-pigeon="${esc(d.pick)}" title="About ${esc(d.name)}">
    ${avatarHtml(d, 46)}<span class="pin-name">${esc(d.name)}</span></button>`;
  let html = pins.length ? `<div class="pins">${pins.map(pin).join('')}</div>` : '';
  html += lead.map(crow).join('');
  let letter = '';
  for (const d of listed) {
    const L = d.name[0].toUpperCase();
    if (L !== letter) { html += `<div class="sec">${esc(L)}</div>`; letter = L; }
    html += crow(d);
  }
  if (!html) html = `<p class="list-empty">No Pigeon is called “${esc(String(q).trim())}”.</p>`;
  return html;
}
