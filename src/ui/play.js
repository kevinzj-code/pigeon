/* play.js — a picture Pigeon, playing a window (docs/PLAY-LOOP.md, P4).
 *
 * Drawn on a picture Pigeon's page when its file says which key each answer
 * presses. Everything it shows comes from Rust (src-tauri/src/play.rs): the
 * two permissions, the windows the watcher can see, the key test, and each
 * turn as it happens. The page names a window and a way to send keys; what
 * is pressed is decided in Rust, from the Pigeon's own list, and nothing
 * here can make it press anything else. */

import { esc, ICONS } from './html.js';

/* The three ways a key can reach a game, as the key test names them. Asked
   of nobody up front: the first is what works in mGBA, and a game that
   ignores it is found out by the test under More, which remembers per app. */
export const HOW_WORDS = { hid: 'as a keyboard', session: 'into the session', pid: 'straight to the app' };

/** Can this installed Pigeon play? A picture Pigeon whose file says which key
 *  each answer presses. */
export const canPlay = (p) => Boolean(p && p.vision && p.presses && (p.presses.keys || []).length);

const keyList = (p) => (p.presses?.keys || []).map(k => keyWords(k.key));

/* The two macOS permissions, as a checklist with one button each. */
function permsHtml (perm) {
  if (!perm) return '<p class="ps-note">Checking what macOS allows…</p>';
  const row = (ok, which, what, why) => `<li class="${ok ? 'ok' : ''}"><span class="ps-tick" aria-hidden="true">${ok ? ICONS.check : ''}</span>
    <span class="ps-perm"><b>${what}</b><small>${why}</small></span>
    ${ok ? '<span class="ps-on">On</span>' : `<button class="btn-verb soft" data-play="ask" data-which="${which}">Allow…</button>`}</li>`;
  const missing = !perm.screen || !perm.keys;
  return `<ul class="ps-perms">
      ${row(perm.screen, 'screen', 'See the game', 'Screen Recording — so it can look at one window')}
      ${row(perm.keys, 'keys', 'Press keys', 'Accessibility — so it can press its own keys in that window')}
    </ul>
    ${missing ? '<p class="ps-note">macOS opens its list; switch Pigeon on there. Screen Recording only takes effect after Pigeon is quit and opened again. <button class="link" data-play="recheck">Check again</button></p>' : ''}`;
}

/* The windows it could play, as pictures of themselves. */
function windowsHtml (ui) {
  const wins = ui.windows;
  if (!wins) return '<p class="ps-note">Looking for windows…</p>';
  if (!wins.length) return '<p class="ps-note">No game window is open. Open the game, then <button class="link" data-play="refresh">look again</button>.</p>';
  return `<div class="ps-wins" role="radiogroup" aria-label="The game">${wins.map(w => {
    const t = ui.thumbs && ui.thumbs[w.id];
    const on = w.id === ui.window;
    return `<button class="ps-win${on ? ' on' : ''}" role="radio" aria-checked="${on}" data-play="pick" data-win="${w.id}">
      <span class="ps-shot">${typeof t === 'string' && t.startsWith('data:image/') ? `<img alt="" src="${t}">` : `<span>${t === 'failed' ? 'no picture' : '…'}</span>`}</span>
      <span class="ps-app">${esc(w.app)}</span><span class="ps-title">${esc(w.title || 'untitled')}</span></button>`;
  }).join('')}</div>
  <p class="ps-note"><button class="link" data-play="refresh">Look again</button> · the picture is what it will see.</p>`;
}

/**
 * The Play sheet: what it will do, the two permissions, the game, and Play.
 * `ui` is app.js's playUi; `how` is the way remembered for the chosen app.
 */
export function playSheetHtml (p, ui, { how = 'hid' } = {}) {
  const perm = ui.perm;
  const ready = perm && perm.screen && (perm.keys || ui.watchOnly) && ui.window != null;
  const chosen = (ui.windows || []).find(w => w.id === ui.window);
  const test = ui.test
    ? `<p class="ps-note${ui.test.error ? ' bad' : ''}">${ui.test.error ? esc(ui.test.error)
      : ui.test.works ? `${esc(chosen ? chosen.app : 'The game')} takes keys sent ${esc(HOW_WORDS[ui.test.works] || ui.test.works)} — Pigeon will send them that way from now on.`
      : `${esc(chosen ? chosen.app : 'This game')} ignored all three ways. It reads the keyboard in a way Pigeon can’t reach, so ${esc(p.name)} can’t play it.`}</p>` : '';
  return `<div class="sheet-card play-sheet" aria-label="Play with ${esc(p.name)}">
    <div class="sheet-title">Play with ${esc(p.name)}</div>
    <p class="ps-lede">It looks at the game and presses its own keys — ${esc(keyList(p).join(', '))} — only while the game is in front. <b>⌘⇧.</b> stops it from anywhere.</p>
    ${permsHtml(perm)}
    ${perm && perm.screen ? `<div class="ps-sec">The game</div>${windowsHtml(ui)}` : ''}
    <details class="ps-more"${ui.moreOpen ? ' open' : ''}><summary>More</summary>
      <label class="check"><input type="checkbox" data-play="watch" ${ui.watchOnly ? 'checked' : ''}> Watch only — decide every move, press nothing</label>
      <label class="ps-limit">Stop after <select data-play="limit" aria-label="Stop playing after">${[[0, 'no limit'], [5, '5 minutes'], [15, '15 minutes'], [30, '30 minutes'], [60, 'an hour']].map(([m, w]) =>
        `<option value="${m}"${(ui.limitMin || 0) === m ? ' selected' : ''}>${w}</option>`).join('')}</select></label>
      <p class="ps-note">Keys go ${esc(HOW_WORDS[how] || how)}. If the game ignores them:
        <button class="link" data-play="test" ${ui.busy || !chosen || !(perm && perm.keys) ? 'disabled' : ''}>${ui.busy === 'test' ? 'Trying each way…' : 'find a way it takes keys'}</button>
        — this presses ${esc(keyList(p)[0] || 'a key')} in the game up to three times.</p>
      ${test}
    </details>
    ${ui.error ? `<p class="ps-note bad">${esc(ui.error)}</p>` : ''}
    <div class="sheet-row">
      <button class="sheet-btn" data-close>Cancel</button>
      <button class="sheet-btn primary" data-play="start" ${ready && !ui.busy ? '' : 'disabled'}>${ICONS.play}${ui.watchOnly ? 'Watch' : 'Play'}</button>
    </div>
  </div>`;
}

const ago = (ms, now) => {
  const s = Math.max(1, Math.round((now - ms) / 1000));
  return s < 90 ? `${s} s` : `${Math.round(s / 60)} min`;
};

/**
 * On the Pigeon's page, under its buttons: the play going on now (what it
 * sees, the last key, Stop), or how the last one ended. Nothing before its
 * first play — the Play button beside New chat is the way in.
 */
export function playCardHtml (p, status, now = Date.now()) {
  if (!status || status.pigeon !== p.id || !status.state) return '';
  const live = ['starting', 'playing', 'waiting'].includes(status.state);
  const frame = typeof status.frame === 'string' && /^data:image\/jpeg;base64,/.test(status.frame) ? status.frame : '';
  if (live) {
    const what = status.state === 'waiting' ? 'Paused — the game isn’t in front'
      : status.state === 'starting' ? 'Starting — the picture model loads first'
        : status.last_pressed ? `${status.watch_only ? 'Would press' : 'Pressed'} ${keyWords(status.last_pressed)}` : 'Waiting — nothing to press';
    return `<section class="play-card live" aria-label="Playing">
      ${frame ? `<img class="pc-shot" alt="What it sees" src="${frame}">` : '<span class="pc-shot"></span>'}
      <div class="pc-txt"><b>${esc(what)}</b><small>${status.turns || 0} moves · ${status.pressed || 0} keys${status.since_ms ? ` · for ${ago(status.since_ms, now)}` : ''}</small></div>
      <div class="pc-btns"><button class="btn-verb soft" data-do="play-hud">Show over the game</button><button class="btn-verb" data-do="play-stop">Stop</button></div>
    </section>`;
  }
  const stuck = /^stuck/.test(status.reason || '') && !status.watch_only;
  return `<section class="play-card" aria-label="The last play">
      ${frame ? `<img class="pc-shot" alt="The last thing it saw" src="${frame}">` : '<span class="pc-shot"></span>'}
      <div class="pc-txt"><b>Last play: ${status.turns || 0} moves, ${status.pressed || 0} keys ${status.watch_only ? 'it would have pressed' : 'pressed'}</b>
      <small>Stopped — ${esc(status.reason || 'done')}.${stuck ? ' If the game didn’t move at all, it may be ignoring Pigeon’s keys: Play › More › find a way it takes keys.' : ''}</small></div>
    </section>`;
}

/* ── the overlay (hud.html) ──────────────────────────────────────────────── */

const ARROWS = { Up: '↑', Down: '↓', Left: '←', Right: '→' };
/** A key as a person reads it: "↑ Up", "X", "Space". */
export const keyWords = (k) => (ARROWS[k] ? `${ARROWS[k]} ${k}` : String(k || ''));

const since = (ms, now) => {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  return s < 60 ? `${s} s` : s < 3600 ? `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s` : `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`;
};

const X = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
const MIN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 12h12"/></svg>';

/**
 * The overlay's card for one play-event. Everything in it is said from the
 * status Rust sent — `frame` is the picture the Pigeon was just asked about,
 * as the data URL it was sent, so "what it sees" is exactly that.
 */
export function hudHtml (s, now = Date.now()) {
  if (!s || !s.state) return '<div class="top"><span class="dot off"></span><span class="who">Nothing is playing</span></div>';
  const name = esc(s.name || 'Your Pigeon');
  const live = ['starting', 'playing', 'waiting'].includes(s.state);
  const dot = s.state === 'waiting' ? 'wait' : live ? 'live' : 'off';
  const state = { starting: 'starting', playing: s.watch_only ? 'watching' : 'playing', waiting: 'paused', stopped: 'stopped' }[s.state] || s.state;
  const frame = typeof s.frame === 'string' && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(s.frame) ? s.frame : '';
  const sees = `<div class="sees">${frame ? `<img src="${frame}" alt="What ${name} sees">` : `<span class="none">${s.state === 'starting' ? 'Loading the picture model — the first move takes a few seconds' : 'Nothing seen yet'}</span>`}
    ${frame ? '<span class="tag">what it sees</span>' : ''}</div>`;
  const pressed = s.last_pressed ? keyWords(s.last_pressed) : null;
  const move = s.state === 'waiting' ? '<div class="move"><b>Paused</b><span>the game isn’t in front</span></div>'
    : s.state === 'starting' ? '<div class="move"><b>Starting…</b></div>'
      : s.state === 'stopped' ? `<div class="move"><b>Stopped</b><span class="why">${esc(s.reason || '')}</span></div>`
        : pressed ? `<div class="move"><b>${esc(pressed)}</b><span>${s.watch_only ? 'it would press' : 'pressed'}</span></div>`
          : `<div class="move"><b>Waiting</b><span>${esc(s.last_answer === 'NONE' ? 'nothing to press here' : s.last_answer ? `answered ${s.last_answer}` : '')}</span></div>`;
  const moves = `${s.turns || 0} move${s.turns === 1 ? '' : 's'} · ${s.pressed || 0} key${s.pressed === 1 ? '' : 's'}${s.watch_only ? ' it would press' : ''}`;
  const meta = `<div class="meta"><span>${moves}</span><span>${s.since_ms ? since(s.since_ms, now) : ''}${s.last_ms && live ? ` · ${(s.last_ms / 1000).toFixed(1)} s a move` : ''}</span></div>`;
  const btns = live
    ? '<div class="btns"><button class="btn stop" data-hud="stop">Stop<kbd>⌘⇧.</kbd></button></div>'
    : '<div class="btns"><button class="btn" data-hud="open">Open Pigeon</button><button class="btn" data-hud="close">Close</button></div>';
  return `<div class="top"><span class="dot ${dot}"></span><span class="who">${name} <small>· ${state}</small></span>
      <button class="x" data-hud="${live ? 'hide' : 'close'}" title="${live ? 'Hide — it keeps playing; the menu bar brings this back' : 'Close'}" aria-label="${live ? 'Hide' : 'Close'}">${live ? MIN : X}</button></div>
    ${sees}${move}${meta}${btns}`;
}

/* ── Play from the menu bar and the summon bar ───────────────────────────── */

/**
 * One click from a small window. When both permissions are on and the game
 * played last is open, the play starts there and then — the game comes to the
 * front and the overlay comes up — and this returns `{ started: app }`. When
 * anything is missing it returns `{ sheet: why }`, and the caller hands over to
 * Pigeon's own window, where the Play sheet can ask for it. Never guesses a
 * game it has not played before: the first play is always chosen in the sheet.
 *
 * `call` is Tauri's invoke; `peek` is settings_peek's answer.
 */
export async function quickPlay (call, p, peek = {}) {
  if (!call || !canPlay(p)) return { sheet: 'cannot play' };
  const perm = await call('play_permission');
  if (!perm || !perm.screen || !perm.keys) return { sheet: 'permissions' };
  const last = peek && typeof peek.playLastApp === 'string' ? peek.playLastApp : null;
  if (!last) return { sheet: 'no game yet' };
  const wins = (await call('play_windows')) || [];
  const w = wins.find(x => x.app === last);
  if (!w) return { sheet: 'game not open' };
  const how = (peek.playHow && ['hid', 'session', 'pid'].includes(peek.playHow[last])) ? peek.playHow[last] : 'hid';
  await call('play_start', { pigeon: p.id, window: w.id, how, watchOnly: false, limitS: null });
  return { started: last };
}

/** Is `id` playing now, by the last play-event? */
export const isPlaying = (status, id) => Boolean(status && (!id || status.pigeon === id) && ['starting', 'playing', 'waiting'].includes(status.state));
