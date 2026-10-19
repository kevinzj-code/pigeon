/* cite.js — where an underlined answer came from, in one window.
 *
 * An underline in a reply means one thing: click it and you see the source,
 * with the part the answer came from marked. The source is whatever did the
 * work —
 *   a web page        the text the look-up returned, the sentence shown marked
 *   a Pigeon's file   the one section the answer came from, its sentence marked
 *   a calculation     your own message, the words the inputs came from marked,
 *                     and one line of working
 *   a bundled table   the row the figure was read from, and the table's date
 * — so the window is the same frame four ways, and the mark is the same mark
 * the grounded Pigeon's section always had.
 *
 * Strings only, no DOM, so the test suite can draw every kind.
 */

import { esc, ICONS } from './html.js';
import { humanise } from './marks.js';
import { splitSentences } from '../focus.js';
import { refsIn } from '../plan.js';
import { parseRef } from '../contracts.js';

/** Text with each `[start, end)` span marked, everything escaped. Spans out of
 *  range, empty, or overlapping an earlier one are dropped rather than drawn
 *  wrong. */
export function markSpans (text, spans = []) {
  const s = String(text ?? '');
  const ok = (spans || [])
    .filter(p => Array.isArray(p) && p.length === 2 && Number.isInteger(p[0]) && Number.isInteger(p[1]) && p[0] >= 0 && p[1] <= s.length && p[0] < p[1])
    .sort((a, b) => a[0] - b[0]);
  let out = '';
  let at = 0;
  for (const [a, b] of ok) {
    if (a < at) continue;
    out += `${esc(s.slice(at, a))}<mark class="from-here">${esc(s.slice(a, b))}</mark>`;
    at = b;
  }
  return out + esc(s.slice(at));
}

/** An answer as it is shown once it is underlined: its `[§n]` markers are the
 *  underline now, so they are taken out of the words. */
export const withoutCitations = (text) => String(text ?? '').replace(/\s*\[§\d+\]/g, '').trim();

/* ── a Pigeon's file ─────────────────────────────────────────────────────── */

/** The one section a grounded answer came from, or null. `main` names it; a
 *  turn saved before there was a `main` falls back to the section that
 *  carries a marked sentence. */
export function foundIn (turn) {
  if (!turn || turn.lane !== 'B' || !turn.reply || turn.noMaterial) return null;
  const sections = Array.isArray(turn.sections) ? turn.sections : [];
  const s = turn.main != null
    ? sections.find(x => Number(x.ordinal) === Number(turn.main))
    : sections.find(x => Array.isArray(x.support));
  return s && typeof s.text === 'string' && s.text ? s : null;
}

/** "§4 Article I, Section 3 · constitution.md" — the section, then the file
 *  exactly as its maker named it. */
export function foundLabel (s) {
  if (!s) return '';
  return [`§${Number(s.ordinal)} ${String(s.title || '').trim()}`.trim(), String(s.file || '').trim()].filter(Boolean).join(' · ');
}

/* ── a web page ──────────────────────────────────────────────────────────── */

/** The page's text and where the shown answer sits in it. The focus pass kept
 *  one sentence, by number, out of the whole passage; the passage is drawn
 *  whitespace-normalised, which is the text those numbers count in. With no
 *  focus pass the whole passage WAS the answer. */
export function webPassage (turn, seg) {
  const raw = String((seg && (seg.raw ?? seg.text)) ?? '');
  const focus = turn && turn.reply && turn.reply.focus;
  const kept = focus && Array.isArray(focus.kept) ? focus.kept : [];
  if (!kept.length) return { text: raw, spans: raw ? [[0, raw.length]] : [] };
  const all = splitSentences(raw);
  const text = all.join(' ');
  const spans = [];
  for (const k of kept) {
    const i = Number(k) - 1;
    if (!(i >= 0 && i < all.length)) continue;
    const start = all.slice(0, i).join(' ').length + (i ? 1 : 0);
    spans.push([start, start + all[i].length]);
  }
  return { text, spans };
}

/** What a search that returned pages, not an answer, gave back. */
function resultsPassage (value) {
  const rows = Array.isArray(value && value.results) ? value.results : [];
  return rows.map(r => [r.title, r.snippet].filter(Boolean).join(' — ')).join('\n\n');
}

/* ── a calculation ───────────────────────────────────────────────────────── */

const fieldWords = (k) => String(k).replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
const SYMBOLS = '£$€₹¥';

/** Where in `text` a value was written: a number however it was typed
 *  ("84.50" for 84.5, with its currency sign), a word or phrase as itself.
 *  Null when it is not there as written. */
export function spanOf (text, v) {
  const s = String(text ?? '');
  if (typeof v === 'number') {
    for (const m of s.matchAll(/-?\d[\d,]*(?:\.\d+)?/g)) {
      if (parseFloat(m[0].replace(/,/g, '')) !== v) continue;
      const before = m.index > 0 && SYMBOLS.includes(s[m.index - 1]) ? 1 : 0;
      return [m.index - before, m.index + m[0].length];
    }
    return null;
  }
  if (typeof v !== 'string') return null;
  const want = v.trim().toLowerCase();
  if (want.length < 2) return null;
  const at = s.toLowerCase().indexOf(want);
  return at < 0 ? null : [at, at + want.length];
}

/** The step a field's value came from, when the plan filled it from one. */
function fromStep (turn, r, field) {
  const step = ((turn && turn.plan && turn.plan.steps) || []).find(s => s.id === r.id);
  if (!step || !step.input) return null;
  const ref = refsIn(step.input[field]).map(parseRef).find(Boolean);
  if (!ref || ref.prev) return null;
  const n = turn.plan.steps.findIndex(s => s.id === ref.stepId);
  return n < 0 ? null : { n: n + 1, skill: turn.plan.steps[n].skill };
}

/** Your words, the spans each input came from, and the working as one line:
 *  "Split a bill: bill £84.50, people 4 → per person £21.13". Only a value
 *  that is really in what you typed is marked; one from an earlier step, the
 *  app's own context or the skill's default says so instead. */
export function computedPassage (turn, r, seg, { titleOf = null, labelOf = null } = {}) {
  const typed = String((turn && turn.message) || '');
  const answered = turn && turn.answered ? String(turn.answered.value ?? '') : '';
  const text = answered ? `${typed}\n\nYou answered: ${answered}` : typed;
  const spans = [];
  const parts = [];
  const input = (r && r.input) || (seg && seg.input) || {};
  const sources = (r && r.sources) || {};
  for (const [k, v] of Object.entries(input)) {
    if (v === undefined || v === null || typeof v === 'object') continue;
    const label = (labelOf && labelOf(r && r.skill, k)) || (r && r.fieldLabels && r.fieldLabels[k]) || fieldWords(k);
    const step = r ? fromStep(turn, r, k) : null;
    const src = sources[k];
    let where = '';
    if (step) where = ` (from step ${step.n}, ${humanise(step.skill).toLowerCase()})`;
    else if (src === 'context') where = ' (from this Mac)';
    else if (src === 'default') where = ' (default)';
    else {
      const at = spanOf(text, v);
      if (at) { spans.push(at); parts.push(`${label} ${text.slice(at[0], at[1])}`); continue; }
    }
    parts.push(`${label} ${typeof v === 'number' ? String(Number(v.toFixed(10))) : String(v)}${where}`);
  }
  const skill = (r && r.skill) || (seg && seg.skill) || '';
  const title = (titleOf && titleOf(skill)) || (r && r.title) || humanise(skill) || 'Worked out';
  const figure = (seg && seg.text) || '';
  const result = seg && seg.field ? `${fieldWords(seg.field)} ${figure}` : figure;
  const working = `${title}: ${parts.length ? parts.join(', ') : 'no inputs'} → ${result}`.trim();
  return { text, spans, working };
}

/* ── a bundled table ─────────────────────────────────────────────────────── */

/** The row the figure was read from, one field a line, the figure's own
 *  field marked. */
export function bundledPassage (r, seg) {
  const value = (r && r.value) || {};
  const lines = [];
  const spans = [];
  let at = 0;
  for (const [k, v] of Object.entries(value)) {
    if (k === 'dataAsOf' || v === null || v === undefined || typeof v === 'object') continue;
    const line = `${fieldWords(k)}: ${v}`;
    if (seg && k === seg.field) spans.push([at, at + line.length]);
    lines.push(line);
    at += line.length + 1;
  }
  return { text: lines.join('\n'), spans };
}

/* ── the window ──────────────────────────────────────────────────────────── */

/**
 * Everything the window says about one underline. `kind` is doc, web,
 * computed or bundled; the caller hands over what it found on the turn.
 */
export function citationFor ({ kind, turn, r = null, seg = null, name = 'Pigeon', source = null, host = '', date = '', titleOf = null, labelOf = null } = {}) {
  if (kind === 'doc') {
    const s = foundIn(turn);
    if (!s) return null;
    const spans = [s.support, s.also].filter(Array.isArray);
    return {
      kind,
      title: `§${Number(s.ordinal)} ${String(s.title || '').trim()}`.trim(),
      sub: String(s.file || '').trim(),
      passage: markSpans(s.text, spans),
      note: `${spans.length > 1 ? 'The marked sentences share the most words with the answer, so they are' : 'The marked sentence shares the most words with the answer, so it is'} most likely where the answer came from. ${name} wrote the answer in its own words; nothing checked it against this.`,
      copy: withoutCitations(turn.reply.text),
      copyLabel: 'Copy answer'
    };
  }
  if (kind === 'web') {
    const answer = seg && seg.field === 'answer';
    const p = answer ? webPassage(turn, seg) : { text: resultsPassage(r && r.value) || String((seg && seg.text) || ''), spans: [] };
    const focused = answer && Boolean(turn && turn.reply && turn.reply.focus);
    return {
      kind,
      title: `From ${source || host || 'the web'}`,
      sub: (r && r.provenance && r.provenance.source) || (seg && seg.provenance && seg.provenance.source) || '',
      passage: markSpans(p.text, p.spans),
      note: focused
        ? 'This is what the look-up returned. The answer is the marked sentence, word for word.'
        : answer ? 'This is what the look-up returned, and the answer is all of it, word for word.' : 'These are the pages the search returned.',
      copy: (seg && seg.text) || '',
      copyLabel: 'Copy answer',
      link: (r && r.provenance && r.provenance.source) || ''
    };
  }
  if (kind === 'bundled') {
    const p = bundledPassage(r, seg);
    return {
      kind,
      title: 'From a table bundled with Pigeon',
      sub: date ? `dated ${date}` : '',
      passage: markSpans(p.text, p.spans),
      note: `Read from data that shipped inside the app${date ? `, dated ${date}` : ''}. Nothing was fetched.`,
      copy: (seg && seg.text) || '',
      copyLabel: `Copy ${(seg && seg.text) || ''}`.trim()
    };
  }
  const p = computedPassage(turn, r, seg, { titleOf, labelOf });
  return {
    kind: 'computed',
    title: 'Worked out from your message',
    sub: 'on this Mac',
    passage: p.text ? markSpans(p.text, p.spans) : '<i>Nothing you typed.</i>',
    working: p.working,
    note: 'Worked out by code on this Mac, not by a model. The marked words are the values it used.',
    copy: (seg && seg.text) || '',
    copyLabel: `Copy ${(seg && seg.text) || ''}`.trim()
  };
}

/** The window's markup. `dev` is the exact input and output, for a figure. */
export function citationHtml (c, { dev = '' } = {}) {
  return `
    <div class="modal cite ${esc(c.kind)}">
      <div class="modal-head">
        <b>${esc(c.title)}</b>
        <button class="icon-btn" data-close title="Close">${ICONS.x}</button>
      </div>
      <div class="modal-body">
        ${c.sub ? `<div class="cite-sub">${esc(c.sub)}</div>` : ''}
        <div class="cite-passage">${c.passage}</div>
        ${c.working ? `<div class="cite-working">${esc(c.working)}</div>` : ''}
        <p class="cite-note">${esc(c.note)}</p>
        ${dev}
      </div>
      <div class="modal-foot">
        <button class="btn ghost" data-close>Close</button>
        <div class="spacer"></div>
        ${c.link ? '<button class="btn ghost" id="cite-link">Copy link</button>' : ''}
        ${c.copy ? `<button class="btn primary" id="cite-copy">${esc(c.copyLabel)}</button>` : ''}
      </div>
    </div>`;
}
