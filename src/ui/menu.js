/* menu.js — the context menu: right-click a chat, or press its ⋯ button.
 *
 * What a menu offers is data (`chatMenuItems`), so it can be tested without a
 * page. `openMenu` is the one piece that touches the DOM, and only when it is
 * called — nothing here runs at import, so the test suite can load it.
 */

import { esc, ICONS } from './html.js';
import { canMessage } from './pigeons.js';

/**
 * The chat menu, in the order a messaging app puts it: what you do to the
 * conversation, then starting another with the same Pigeon, then the one that
 * cannot be undone — which only ever asks, never deletes.
 */
export function chatMenuItems (c, d) {
  return [
    { id: 'rename', label: 'Rename…', icon: 'rename' },
    { id: 'pin', label: c.pinnedAt ? 'Unpin' : 'Pin', icon: 'pin' },
    { id: 'unread', label: c.unread ? 'Mark as read' : 'Mark as unread', icon: c.unread ? 'read' : 'unread' },
    { id: 'mute', label: c.muted ? 'Show alerts' : 'Hide alerts', icon: c.muted ? 'bell' : 'bellOff' },
    { rule: true },
    { id: 'new-with', label: `New chat with ${d.name}`, icon: 'compose', disabled: !canMessage(d) },
    { rule: true },
    { id: 'delete', label: 'Delete…', icon: 'trash', danger: true }
  ];
}

/**
 * A Pigeon's menu, from its ⋯ on the Pigeons tab or a right-click there: pin
 * it to the top of the tab or take it down, start a chat, open its page — and,
 * for a Pigeon you added, the way to remove it, which only ever asks.
 */
export function pigeonMenuItems (d, { pinned = false } = {}) {
  const removable = d.kind === 'voice' || d.kind === 'job';
  return [
    { id: 'pin-pigeon', label: pinned ? 'Unpin' : 'Pin to top', icon: 'pin' },
    { id: 'new-with', label: `New chat with ${d.name}`, icon: 'compose', disabled: !canMessage(d) },
    { id: 'page', label: `About ${d.name}`, icon: 'info' },
    ...(removable ? [{ rule: true }, { id: 'remove-pigeon', label: `Remove ${d.name}…`, icon: 'trash', danger: true }] : [])
  ];
}

/**
 * A message's menu. Your question can be copied, edited and asked again, or
 * forwarded; a reply can be copied — alone, or with where it came from — tried
 * again where trying again can change it, and its question forwarded to the
 * other side of the line: Pen for something Patch has no skill for, Patch for a
 * figure a model must not guess. What is forwarded is always the QUESTION, never
 * a reply, so nothing a model wrote can reach Patch looking like something you
 * typed. Info opens Message info, where the plan now lives.
 *
 * Try again is offered where the answer can come out different: Pen and a
 * voice. Patch plans the same message the same way, and a one-shot Pigeon runs
 * at temperature 0, so for them it is there but disabled, saying why.
 */
export function messageMenuItems (turn, which, { canChat = false, busy = false, job = false } = {}) {
  const info = { id: 'info', label: 'Info', icon: 'info' };
  /* A reaction lives here now that nothing sits beside a bubble until it is
     hovered: the hover row has Copy, Edit and when; React is one menu away. */
  const react = { id: 'react', label: 'React…', icon: 'smile' };
  if (which === 'q') {
    return [
      { id: 'copy-q', label: 'Copy', icon: 'copy' },
      { id: 'edit', label: 'Edit', icon: 'pencil', disabled: busy },
      { id: 'reply', label: 'Reply', icon: 'back' },
      react,
      { id: 'forward', label: 'Ask someone else…', icon: 'forward' },
      { rule: true },
      info
    ];
  }
  if (turn.interrupted) return [{ id: 'retry', label: 'Try again', icon: 'retry', disabled: busy }, { rule: true }, info];
  const same = 'Same message, same answer. Edit it to get a different one.';
  const again = turn.lane === 'B' && !job
    ? { id: 'retry', label: 'Try again', icon: 'retry', disabled: busy }
    : { id: 'retry', label: 'Try again', icon: 'retry', disabled: true, title: same };
  const copies = [
    { id: 'copy-a', label: 'Copy', icon: 'copy' },
    { id: 'copy-where', label: 'Copy with where it came from', icon: 'copy' },
    { id: 'reply', label: 'Reply', icon: 'back' },
    react
  ];
  if (turn.lane === 'B') {
    return [...copies, again, { rule: true }, { id: 'fwd:patch', label: 'Ask Patch — your question, not this reply', icon: 'forward' }, { rule: true }, info];
  }
  return [...copies, again, { rule: true }, { id: 'fwd:chat', label: 'Ask Pen — your question, not this reply', icon: 'forward', disabled: !canChat }, { rule: true }, info];
}

/* Everyone a question can be forwarded to: anyone who can be messaged, except
   the Pigeon already answering it. */
export function forwardMenuItems (pigeons, currentPick) {
  return (pigeons || [])
    .filter(d => canMessage(d) && d.pick !== currentPick)
    .map(d => ({ id: `fwd:${d.pick}`, label: d.name, icon: d.kind === 'verified' ? 'check' : 'bubble' }));
}

export function menuHtml (items) {
  return items.map(it => it.rule
    ? '<div class="rule" role="separator"></div>'
    : `<button role="menuitem" data-item="${esc(it.id)}"${it.danger ? ' class="danger"' : ''}${it.disabled ? ' disabled' : ''}${it.title ? ` title="${esc(it.title)}"` : ''}>${
      it.icon && ICONS[it.icon] ? ICONS[it.icon] : ''}<span>${esc(it.label)}</span></button>`).join('');
}

/**
 * Open a menu under an element, or at a point `{ x, y }` for a right-click.
 * Escape, a click elsewhere or the window losing focus closes it; the arrow
 * keys move through the items. Returns the function that closes it.
 */
export function openMenu (at, items, onPick) {
  document.querySelectorAll('.ctx').forEach(m => m.remove());
  const menu = document.createElement('div');
  menu.className = 'ctx';
  menu.setAttribute('role', 'menu');
  menu.innerHTML = menuHtml(items);
  document.body.appendChild(menu);

  const fromElement = at && typeof at.getBoundingClientRect === 'function';
  const r = fromElement ? at.getBoundingClientRect() : { left: at.x, top: at.y, bottom: at.y };
  const below = r.bottom + 4;
  menu.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - menu.offsetWidth - 8))}px`;
  menu.style.top = `${below + menu.offsetHeight > window.innerHeight - 8 ? Math.max(8, r.top - menu.offsetHeight - 4) : below}px`;

  const buttons = [...menu.querySelectorAll('button:not(:disabled)')];
  /* Where the keyboard was before the menu took it. Given back on the way out,
     so Escape leaves you on the ⋯ you opened rather than at the top of the
     document. An item that ACTS repaints the list under it, which takes the
     opener with it — hence the check that it is still there. */
  const cameFrom = fromElement ? document.activeElement : null;
  const close = () => {
    menu.remove();
    document.removeEventListener('mousedown', away, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('blur', close);
    if (cameFrom && cameFrom.focus && document.contains(cameFrom)) cameFrom.focus();
  };
  function away (e) { if (!menu.contains(e.target)) close(); }
  function onKey (e) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
    if ((e.key === 'Enter' || e.key === ' ') && buttons.includes(document.activeElement)) {
      e.preventDefault();
      e.stopPropagation();
      document.activeElement.click();
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const down = e.key === 'ArrowDown';
    const i = buttons.indexOf(document.activeElement);
    const n = buttons.length;
    const next = i < 0 ? (down ? 0 : n - 1) : (i + (down ? 1 : n - 1)) % n;
    if (buttons[next]) buttons[next].focus();
  }
  menu.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-item]');
    if (!b || b.disabled) return;
    close();
    onPick(b.dataset.item);
  });
  setTimeout(() => document.addEventListener('mousedown', away, true), 0);
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('blur', close);
  /* Opened from a button, the keyboard is already there; from a right-click it
     is not, and moving focus would scroll the list under the pointer. */
  if (fromElement && buttons[0]) buttons[0].focus();
  return close;
}
