/* patch-life.js — what Patch does between frames.
 *
 * patch.js draws one frame of the sprite sheet; this steps through them and
 * decides what he does when nobody is asking anything of him. A gesture is a
 * short list of the sheet's animations played one after another; when it ends
 * he goes back to his base loop — breathing on his feet, or sat down, or
 * dozing with Zs once he has been left alone long enough.
 *
 * Two of him can exist: the brand mark (small, reacts to the app) and the
 * perch on the empty chat (84px, has a life of his own — looks about, pecks,
 * paints, waves, turns to face the pointer, dozes). The app repaints both
 * elements freely; a Life outlives its element and is re-attached after every
 * paint, and a gesture carries on across the swap.
 *
 * Everything here is gated on prefers-reduced-motion: with it set, he is a
 * still drawing and nothing in this file moves.
 */

import { patch, TAGS } from './lib/patch.js';

const reduced = () => Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

/* ── the gesture kit ────────────────────────────────────────────────────── */
/* Each step is [tag, times]: play that animation through that many times. */
export const GESTURES = {
  peck: [['peck', 1]],
  hop: [['hop', 1]],
  wobble: [['wave', 2]],
  /* shuts his eyes on you for a bit. Enough. */
  sulk: [['blink', 1], ['sleep', 1], ['blink', 1]],
  blink: [['blink', 1]],
  blink2: [['blink', 2]],
  glance: [['look', 1]],
  talk: [['talk', 2]],
  paint: [['paint', 3]],
  wave: [['wave', 2]],
  proud: [['proud', 1]],
  doze: [['loaf_down', 1], ['loaf', 2]],
  wake: [['hop', 1]]
};

/* What he gets up to when left alone, and how often. */
const IDLE = [['glance', 30], ['blink2', 14], ['peck', 14], ['paint', 8], ['wave', 6], ['proud', 5], ['talk', 4]];
const IDLE_GAP = [2200, 5200];
const SLEEP_AFTER = 70_000;
/* pokes closer together than this count as one streak */
const STREAK_WINDOW = 1800;

const pick = (table) => {
  let n = Math.random() * table.reduce((s, [, w]) => s + w, 0);
  for (const [name, w] of table) { if ((n -= w) < 0) return name; }
  return table[0][0];
};
const rand = ([lo, hi]) => lo + Math.random() * (hi - lo);

/* Shared: the last time the person did anything, for dozing off. */
let lastActivity = performance.now();
const lives = new Set();
let listening = false;
function listen () {
  if (listening) return;
  listening = true;
  const wake = () => { lastActivity = performance.now(); for (const l of lives) l.onActivity(); };
  document.addEventListener('pointerdown', wake, { passive: true });
  document.addEventListener('keydown', wake, { passive: true });
  document.addEventListener('pointermove', (e) => {
    lastActivity = performance.now();
    for (const l of lives) { l.onActivity(); l.onPointer(e); }
  }, { passive: true });
  document.addEventListener('visibilitychange', () => {
    for (const l of lives) { if (document.hidden) l.pause(); else l.resume(); }
  });
}

class Life {
  /**
   * @param {string} id      element id he lives in; re-found after each paint
   * @param {number} size    rendered width, px
   * @param {object} traits  idle: has habits; track: turns to the pointer; sleep: dozes off
   */
  constructor (id, size, traits = {}) {
    this.id = id;
    this.size = size;
    this.traits = traits;
    this.el = null;
    this.tag = 'idle';
    this.frame = 0;
    this.left = false;
    this.asleep = false;
    this.gesture = null;
    this.timer = 0;
    this.idleTimer = 0;
    this.pokes = [];
    lives.add(this);
    listen();
  }

  /* Called after every paint. The element may be brand new, or gone. A
     running gesture carries on into the new element. */
  attach (el) {
    if (this.el === el) return;
    this.el = el;
    if (!el) { this.pause(); return; }
    el.onclick = () => this.poke();
    el.onpointerenter = () => { if (this.asleep) this.wakeUp(); };
    el.classList.toggle('asleep', this.asleep);
    this.render();
    this.resume();
  }

  pause () {
    clearTimeout(this.idleTimer);
    this.idleTimer = 0;
    clearTimeout(this.timer);
    this.timer = 0;
    if (this.gesture) { this.gesture.resolve(false); this.gesture = null; }
    this.tag = this.baseTag();
    this.frame = 0;
  }

  resume () {
    if (!this.el || !this.el.isConnected || reduced()) return;
    if (!this.timer) this.step();
    if (this.traits.idle && !this.idleTimer && !this.gesture) this.scheduleIdle();
  }

  baseTag () { return this.asleep ? 'loaf_sleep' : 'idle'; }

  render () {
    if (!this.el) return;
    this.el.innerHTML = patch(this.tag, this.frame, this.size);
    this.el.classList.toggle('faces-left', this.left);
  }

  /* ── the frame loop ─────────────────────────────────────────────────── */
  step () {
    this.timer = 0;
    if (!this.el || !this.el.isConnected || reduced()) return;
    this.render();
    const t = TAGS[this.tag];
    this.timer = setTimeout(() => {
      this.timer = 0;
      this.frame++;
      if (this.frame >= t.n) {
        this.frame = 0;
        const g = this.gesture;
        if (g && ++g.times >= g.steps[g.i][1]) {
          g.times = 0;
          if (++g.i >= g.steps.length) {
            if (g.loop) g.i = 0;
            else { this.gesture = null; g.resolve(true); }
          }
        }
        this.tag = this.gesture ? this.gesture.steps[this.gesture.i][0] : this.baseTag();
        if (!this.gesture && this.traits.idle && !this.idleTimer) this.scheduleIdle();
      }
      this.step();
    }, 1000 / t.fps);
  }

  /**
   * Play a gesture. One at a time: a second call while one is running is
   * dropped unless `preempt`, which cuts the first short.
   * @returns {Promise<boolean>} true if it played to the end
   */
  play (name, { preempt = false, loop = false } = {}) {
    if (!this.el || reduced()) return Promise.resolve(false);
    if (this.gesture) {
      if (!preempt) return Promise.resolve(false);
      this.gesture.resolve(false);
      this.gesture = null;
    }
    clearTimeout(this.idleTimer);
    this.idleTimer = 0;
    const steps = GESTURES[name] || name;
    if (!steps.length) return Promise.resolve(false);
    return new Promise((resolve) => {
      this.gesture = { name, steps, i: 0, times: 0, loop, resolve };
      this.tag = steps[0][0];
      this.frame = 0;
      clearTimeout(this.timer);
      this.step();
    });
  }

  /* Ends a looping gesture; he finishes the cycle he is in and goes back to base. */
  stop () {
    const g = this.gesture;
    if (g && g.loop) {
      g.loop = false;
      g.steps = [g.steps[g.i]];
      g.i = 0;
      g.times = g.steps[0][1] - 1;
      g.resolve(false);
      g.resolve = () => {};
    }
    return Promise.resolve(false);
  }

  /* ── habits ─────────────────────────────────────────────────────────── */
  scheduleIdle () {
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.idleTimer = 0;
      if (!this.el || !this.el.isConnected || this.gesture) return;
      if (this.traits.sleep && !this.asleep && performance.now() - lastActivity > SLEEP_AFTER) {
        this.fallAsleep();
        return;
      }
      if (this.asleep) { this.scheduleIdle(); return; }
      this.play(pick(IDLE));
    }, rand(IDLE_GAP));
  }

  fallAsleep () {
    this.asleep = true;
    if (this.el) this.el.classList.add('asleep');
    this.play('doze', { preempt: true });
  }

  wakeUp () {
    if (!this.asleep) return;
    this.asleep = false;
    if (this.el) this.el.classList.remove('asleep');
    this.play('wake', { preempt: true });
  }

  onActivity () {
    if (this.asleep && this.el && this.el.isConnected) this.wakeUp();
  }

  /* A poke deserves a peck. Keep poking and he has opinions about it. */
  poke () {
    if (!this.el || reduced()) return;
    if (this.asleep) { this.wakeUp(); return; }
    /* he is ignoring you */
    if (this.gesture && this.gesture.name === 'sulk') return;
    const now = performance.now();
    this.pokes = this.pokes.filter(t => now - t < STREAK_WINDOW);
    this.pokes.push(now);
    const n = this.pokes.length;
    if (n >= 4) this.pokes = [];
    this.play(n === 1 ? 'peck' : n === 2 ? 'hop' : n === 3 ? 'wobble' : 'sulk', { preempt: true });
  }

  /* ── he turns to face the pointer ───────────────────────────────────── */
  onPointer (e) {
    if (!this.traits.track || this.asleep || !this.el || !this.el.isConnected) return;
    /* `getBoundingClientRect` forces layout; pointermove can fire far more
       often than the screen repaints, so the read is coalesced to at most
       once per animation frame instead of once per raw event. */
    this._pendingPoint = e.clientX;
    if (this._pointerRaf) return;
    this._pointerRaf = requestAnimationFrame(() => {
      this._pointerRaf = null;
      if (!this.el || !this.el.isConnected || reduced()) return;
      const box = this.el.getBoundingClientRect();
      if (!box.width) return;
      /* a dead zone as wide as he is, so he does not flap about under the pointer */
      const dx = this._pendingPoint - (box.left + box.width / 2);
      if (Math.abs(dx) < box.width) return;
      this.left = dx < 0;
      this.el.classList.toggle('faces-left', this.left);
    });
  }
}

/** One Patch, by the id of the element he lives in. */
export function life (id, size, traits) {
  return new Life(id, size, traits);
}
