/* hud.js — the play overlay's page (hud.html, src-tauri/src/playhud.rs).
 *
 * It listens to play-event and draws the card; its buttons are Stop
 * (play_stop), Hide (play_hud false — it keeps playing, the menu bar brings
 * it back), and, once the play has stopped, Open Pigeon and Close. A stopped
 * card closes itself after a while: the summary is in Pigeon, on the
 * Pigeon's page. */

import { hudHtml } from './ui/play.js';

const call = globalThis.__TAURI__?.core?.invoke ?? null;
const listen = globalThis.__TAURI__?.event?.listen ?? null;
const root = document.getElementById('hud');
if (call) document.documentElement.classList.add('native');

let status = null;
let closeTimer = null;
/* How long a stopped play's card stays up. */
const LINGER_MS = 12000;

function draw () {
  root.innerHTML = hudHtml(status);
}

function take (s) {
  status = s;
  clearTimeout(closeTimer);
  if (s && s.state === 'stopped') closeTimer = setTimeout(() => call && call('play_hud', { show: false }), LINGER_MS);
  draw();
}

root.addEventListener('click', (e) => {
  const b = e.target.closest('[data-hud]');
  if (!b || !call) return;
  const what = b.dataset.hud;
  if (what === 'stop') call('play_stop');
  else if (what === 'hide' || what === 'close') call('play_hud', { show: false });
  else if (what === 'open') { call('open_main_window'); call('play_hud', { show: false }); }
});

/* The elapsed time moves between events. */
setInterval(() => { if (status && status.state !== 'stopped') draw(); }, 1000);

if (call && listen) {
  listen('play-event', (e) => take(e.payload));
  call('play_status').then(take).catch(() => draw());
} else if (/[?&]demo\b/.test(location.search)) {
  /* A browser tab: a made-up run, to work on the card without a game. */
  const cv = Object.assign(document.createElement('canvas'), { width: 160, height: 144 });
  const g = cv.getContext('2d');
  const frameAt = (n) => {
    g.fillStyle = '#9bbc0f'; g.fillRect(0, 0, 160, 144);
    g.fillStyle = '#306230'; for (let i = 0; i < 8; i++) g.fillRect(i * 20, 110, 18, 34);
    g.fillStyle = '#0f380f'; g.fillRect(20 + (n * 9) % 120, 70, 16, 16);
    return cv.toDataURL('image/jpeg', 0.8);
  };
  const keys = ['Up', 'Up', 'Right', null, 'Down', 'Left'];
  let n = 0;
  const since = Date.now() - 83000;
  take({ state: 'starting', name: 'Seed Run V2', since_ms: since, turns: 0, pressed: 0 });
  setInterval(() => {
    n += 1;
    const k = keys[n % keys.length];
    take({ state: n % 17 === 0 ? 'waiting' : 'playing', name: 'Seed Run V2', since_ms: since, turns: n, pressed: Math.ceil(n * 0.8), last_pressed: k, last_answer: k ? `KEY(${k})` : 'NONE', last_ms: 1240, frame: frameAt(n) });
  }, 1500);
} else {
  draw();
}
