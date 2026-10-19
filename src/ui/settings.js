/* settings.js — Settings, as a sheet inside the main window (⌘,).
 *
 * Five tabs. General: how it looks and whether banners show, and — folded
 * under Developer — saving the log for a developer. Models: whether
 * they are awake, waking and sleeping them, and — folded under This build —
 * the status of every part behind Pigeon. Pigeons: who is on this Mac. Privacy:
 * when Patch may use the web, and a record of everything that has left the Mac.
 * Advanced: the developer views.
 *
 * A sheet rather than a window of its own, by the user's choice: no new window
 * label, so the capabilities stay core:default for main and the popover only.
 *
 * Strings only, no DOM, so the test suite can draw every tab.
 */

import { esc, ICONS, hm, dayName } from './html.js';

export const SETTINGS_TABS = Object.freeze([
  ['general', 'General'], ['models', 'Models'], ['pigeons', 'Pigeons'], ['privacy', 'Privacy'], ['advanced', 'Advanced']
]);

/* A segmented control. `said` is what the group is called out loud: the same
   words as the label beside it, because a radiogroup announced as "group, three
   items" leaves a screen reader user to guess which setting they are in. The
   arrow keys that the role promises are wired in app.js (rovingGroup). */
const seg = (said, name, current, options) => `<div class="st-seg" role="radiogroup" aria-label="${esc(said)}">${options.map(([v, label]) =>
  `<button role="radio" aria-checked="${current === v}" class="${current === v ? 'on' : ''}" data-set="${esc(name)}" data-value="${esc(v)}">${esc(label)}</button>`).join('')}</div>`;

/* Every model this Mac keeps lives in Pigeon — Flight School borrows them
   (2026-09-21). So this is the one list of them, with who relies on each. */
function storeHtml (store) {
  if (store == null) return '<p class="st-note">Looking…</p>';
  if (!store.length) return '<p class="st-note">No models yet.</p>';
  return `<p class="st-note">Other Airoplane Mode apps on this Mac use these models too. Removing one they rely on asks first, and anything removed goes to the Trash.</p>
    <div class="st-list st-models">${store.map(m => `<div class="st-pigeon"><span><b class="st-mname">${esc(m.name)}</b><small>${esc(m.kind)} · ${esc(m.size)}${m.usedBy.length ? ` · used by ${esc(m.usedBy.join(', '))}` : ' · nothing uses it'}</small></span>
      <button class="btn-verb soft" data-s="rm-model" data-pick="${esc(m.path)}">Remove…</button></div>`).join('')}</div>`;
}

/* What the app writes to disk, said once, in Settings › Privacy. Every path is
   under this app's own folder in Application Support, protected by the Mac's
   login and FileVault and by nothing else: none of it is encrypted by Pigeon,
   and none of it is sent anywhere. Play frames are the game's window, not the
   screen, kept only while a Pigeon plays and pruned after. */
export const KEPT_HERE = 'Your chats, as plain files in this app\u2019s own folder in Application Support. Your settings and the look-up log, in one file beside them. While a Pigeon plays a game, pictures of that game\u2019s window, which are cleared afterwards. The key the models on this Mac answer to, which never leaves it. A log of what Pigeon did, one file a day for 30 days (see General › Developer). Nothing is encrypted beyond what your Mac\u2019s login and FileVault already do, and nothing is sent anywhere.';

/* Beside Save logs…: what the log holds, what it never holds, and how it
   leaves. Said once, here. */
export const LOG_PRIVACY = 'The log holds what Pigeon did: each plan with the values it chose, the skills it ran, timings and errors, and the first 80 characters of each message and reply. It never holds a whole message, a picture or a key. It stays on this Mac for 30 days; saving it (or Copy diagnostics in a chat) is the only way it leaves.';

/* Settings › General › Developer: the log, for handing an issue to a
   developer. Collapsed until opened. `logs` is the range chosen so far. */
export const LOG_RANGES = Object.freeze([['today', 'Today'], ['7', 'Last 7 days'], ['30', 'Last 30 days'], ['custom', 'From… to…']]);
export function developerHtml ({ range = '7', from = '', to = '' } = {}) {
  const custom = range === 'custom'
    ? `<div class="st-range"><label>From <input type="date" data-logs="from" value="${esc(from)}"></label><label>to <input type="date" data-logs="to" value="${esc(to)}"></label></div>`
    : '';
  return `<details class="st-details st-dev"><summary>Developer</summary>
    ${row('Logs', `${seg('Logs to save', 'logsRange', range, LOG_RANGES)}${custom}
      <div class="st-btns"><button class="btn-verb" data-s="logs-save">Save logs…</button><button class="btn-verb soft" data-s="logs-reveal">Show log folder</button></div>
      <p class="st-note">${esc(LOG_PRIVACY)}</p>`)}
  </details>`;
}

const row = (label, body) => `<div class="st-row"><span class="st-label">${esc(label)}</span><div class="st-val">${body}</div></div>`;

/**
 * The sheet's card.
 *   settings: the saved settings
 *   models:   { words, canWake, awake, buildRows, store } — buildRows is markup app.js
 *             draws; store is [{ path, name, size, kind, usedBy }] or null while it loads
 *   pigeons:  [{ pick, name, does, removable }]
 *   saved:    how chats are kept, in words
 */
export function settingsHtml ({ tab = 'general', settings = {}, models = {}, pigeons = [], saved = '', now = Date.now(), native = false, dev = true, logs = {} } = {}) {
  /* Advanced holds the developer views. A release build has none. */
  const shown = SETTINGS_TABS.filter(([k]) => dev || k !== 'advanced');
  if (!shown.some(([k]) => k === tab)) tab = 'general';
  const tabs = `<div class="st-tabs" role="tablist" aria-label="Settings sections">${shown.map(([k, label]) =>
    `<button role="tab" aria-selected="${tab === k}" class="${tab === k ? 'on' : ''}" data-st-tab="${k}">${esc(label)}</button>`).join('')}</div>`;
  let body = '';
  if (tab === 'general') {
    body = row('Appearance', seg('Appearance', 'theme', settings.theme || 'system', [['system', 'Match Mac'], ['light', 'Light'], ['dark', 'Dark']])) +
      row('Banners', `${seg('Banners', 'banners', settings.bannersOff ? 'off' : 'on', [['on', 'Show'], ['off', 'Don’t show']])}
        <p class="st-note">When a reply lands in a chat you aren’t looking at. Inside Pigeon only — it never asks for notifications.</p>`) +
      (native ? row('Ask from anywhere', `<p><kbd>⌘⇧P</kbd> brings up Patch over whatever you are doing, in any app. Patch is also in the menu bar, up by the clock — click the bird.</p>`) : '') +
      (native ? developerHtml(logs) : '');
  } else if (tab === 'models') {
    body = row('Right now', `<p>${esc(models.words || 'Checking…')}</p>
        ${models.canWake ? `<div class="st-btns"><button class="btn-verb${models.awake ? ' soft' : ''}" data-s="wake">Wake the models</button><button class="btn-verb soft" data-s="sleep">Put the models to sleep</button><button class="btn-verb soft" data-s="models">Download…</button></div>` : ''}`) +
      row('Sleep after', seg('Sleep after', 'sleepAfter', String(settings.sleepAfter ?? 600), [['300', '5 minutes unused'], ['600', '10 minutes unused'], ['3600', '1 hour'], ['0', 'Never']])) +
      (native ? row('On this Mac', storeHtml(models.store)) : '') +
      `<details class="st-details"><summary>Details for developers</summary><div class="stack" id="buildStack">${models.buildRows || ''}</div></details>`;
  } else if (tab === 'pigeons') {
    body = `<div class="st-list">${pigeons.map(p => `<div class="st-pigeon"><span><b>${esc(p.name)}</b><small>${esc(p.does)}</small></span>
        ${p.removable ? `<button class="btn-verb soft" data-s="remove" data-pick="${esc(p.pick)}">Remove…</button>` : ''}</div>`).join('')}</div>
      <div class="st-btns"><button class="btn-verb soft" data-s="import">${ICONS.plus}Add a Pigeon…</button></div>`;
  } else if (tab === 'privacy') {
    const log = Array.isArray(settings.webLog) ? settings.webLog.slice().reverse() : [];
    const policy = ['press', 'fallback', 'never'].includes(settings.webPolicy) ? settings.webPolicy : 'press';
    const policyNote = {
      press: 'Patch offers a look-up only for a question that needs the web.',
      fallback: 'When Patch can’t answer from this Mac, he also checks whether the web could, and offers a look-up.',
      never: 'Nothing is looked up, and Look it up is not offered.'
    }[policy];
    body = row('Web look-ups for Patch', `${seg('Web look-ups for Patch', 'webPolicy', policy, [['press', 'Only when I press Look it up'], ['fallback', 'Also try the web'], ['never', 'Never']])}
        <p class="st-note">${esc(policyNote)} ${policy === 'never' ? '' : 'Nothing is sent until you see the exact words and press Send once.'}</p>`) +
      row('What left this Mac', log.length
        ? `<div class="st-log">${log.slice(0, 50).map(e => `<div><time>${esc(dayName(e.at, now) === 'Today' ? hm(e.at) : `${dayName(e.at, now)} ${hm(e.at)}`)}</time><span>${esc(e.text)}</span></div>`).join('')}</div>`
        : '<p class="st-note">Nothing yet.</p>') +
      row('Menu bar and ⌘⇧P', `${seg('Menu bar and ⌘⇧P', 'saveMenuBar', settings.saveMenuBar === false ? 'off' : 'on', [['on', 'Keep in a chat'], ['off', 'Don’t keep']])}
        <p class="st-note">${settings.saveMenuBar === false
          ? 'What you ask from the menu bar or the summon bar is answered there and not kept anywhere.'
          : 'What you ask from the menu bar or the summon bar is kept in a chat called Menu bar, one for each Pigeon you ask.'}</p>`) +
      row('Chats', `<p>${esc(saved)}</p>`) +
      row('Kept on this Mac', `<p class="st-note">${esc(KEPT_HERE)}</p>`);
  } else {
    /* In the app the developer views live in a Developer menu at the top of
       the screen, shown on request. A browser tab has no menus, so there they
       are still buttons. */
    body = native
      ? row('Developer menu', `${seg('Developer menu', 'devMenu', settings.devMenu ? 'on' : 'off', [['off', 'Hidden'], ['on', 'Shown']])}<p class="st-note">Skills, Run a plan and Reality vs. Aspiration, in the menu bar at the top of the screen.</p>`)
      : row('Developer', `<div class="st-btns"><button class="btn-verb soft" data-s="skills">Skills</button><button class="btn-verb soft" data-s="plan">Run a plan</button><button class="btn-verb soft" data-s="ledger">Reality vs. Aspiration</button></div>
      <p class="st-note">Each opens in the main pane.</p>`);
  }
  return `<div class="sheet-card settings-card" role="dialog" aria-label="Settings">
    <div class="st-head"><div class="sheet-title">Settings</div><button class="icon-btn" data-close aria-label="Close settings">${ICONS.x}</button></div>
    ${tabs}<div class="st-body">${body}</div></div>`;
}
