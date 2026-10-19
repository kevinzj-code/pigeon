/* marks.js — the line under a reply that says who did the work.
 *
 * This is the one habit Pigeon adds to texting. Every reply carries exactly one
 * of four marks, in plain verbs, where a messaging app says "Delivered":
 *   Worked out     code did it; Patch's figures can be clicked for how
 *   Looked up      the words are a web source's own, quoted
 *   Found in       a Pigeon wrote it from one section of its own file, and
 *                  the answer is underlined to that section
 *   Written        a small model wrote it, and nothing checked it
 *   Couldn't       nothing was produced
 * plus the two states a question of Patch's passes through: waiting on you,
 * and skipped.
 *
 * A mark is read off the turn the pipeline already returns, never chosen by the
 * page, so it cannot claim more than what ran.
 *
 * Plain strings and no DOM, so the test suite can import it.
 */

import { MODES } from '../turn.js';
import { toPlainText } from '../template.js';
import { foundIn, foundLabel } from './cite.js';

export const MARKS = Object.freeze({
  WORKED: 'worked',
  LOOKED: 'looked',
  FOUND: 'found',
  WRITTEN: 'written',
  COULDNT: 'couldnt',
  WAITING: 'waiting',
  SKIPPED: 'skipped'
});

/** Which mark a turn carries. `skipped` says the person skipped its question. */
export function markFor (turn, { skipped = false } = {}) {
  if (!turn) return null;
  if (turn.interrupted) return MARKS.COULDNT;
  if (turn.lane === 'B') {
    if (!turn.reply || turn.handoff || turn.noMaterial) return MARKS.COULDNT;
    if (turn.renderError && !turn.rendered) return MARKS.COULDNT;
    return foundIn(turn) ? MARKS.FOUND : MARKS.WRITTEN;
  }
  if (turn.consent) return MARKS.WAITING;
  if (turn.ask) return skipped ? MARKS.SKIPPED : MARKS.WAITING;
  if (turn.invalid || turn.mode === MODES.NO_SKILL) return MARKS.COULDNT;
  const results = turn.results || [];
  if (!results.length || results.some(r => !r.ok)) return MARKS.COULDNT;
  return results.some(r => (r.provenance || {}).kind === 'web') ? MARKS.LOOKED : MARKS.WORKED;
}

/** The site a looked-up answer came from, as a person would name it. */
export function webSource (turn) {
  const src = ((turn && turn.results) || []).map(r => (r.provenance || {}).source).find(Boolean);
  if (!src) return null;
  let host;
  try { host = new URL(src).hostname; } catch { return null; }
  if (/(^|\.)wikipedia\.org$/.test(host)) return 'Wikipedia';
  if (/(^|\.)duckduckgo\.com$/.test(host)) return 'DuckDuckGo';
  return host.replace(/^www\./, '');
}

/** The words of a mark. */
export function markLabel (mark, { name = 'Pigeon', firstThree = false, cutShort = false, source = null, found = null } = {}) {
  switch (mark) {
    case MARKS.WORKED: return firstThree ? 'Worked out from the inputs above' : 'Worked out';
    case MARKS.LOOKED: return `Looked up · ${source || 'the web'}`;
    case MARKS.FOUND: return `Found in · ${foundLabel(found) || `${name}’s material`}${cutShort ? ' · cut short' : ''}`;
    case MARKS.WRITTEN: return `Written by ${name} · ${cutShort ? 'cut short' : 'may be wrong'}`;
    case MARKS.COULDNT: return 'Couldn’t answer';
    case MARKS.WAITING: return 'Waiting on you';
    case MARKS.SKIPPED: return 'Skipped';
    default: return '';
  }
}

/**
 * What Patch took a question as: the skill, and only the values that are
 * literally in what the person typed or answered. A default the skill filled
 * in is not a value the person gave, so it is never shown as one — "0" is not
 * in "split 84.50 4 ways" as a number, however the characters line up.
 */
/* "tipPercent" → "tip percent", for a field its skill gave no label. */
const fieldWords = (k) => String(k).replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();

export function tookAs (turn, { titleOf = null, labelOf = null } = {}) {
  const results = (turn && turn.results) || [];
  const r = results.find(x => x && x.ok) || results[0];
  if (!r || !r.skill) return null;
  const skill = (titleOf && titleOf(r.skill)) || r.title || humanise(r.skill);
  /* Where each value came from, as the executor recorded it: only what the
     person gave or answered is shown. A default is not something they said,
     and the app's own context (today's date, the timezone) is not either. */
  if (r.sources && typeof r.sources === 'object') {
    const typed = `${turn.message || ''} ${turn.answered ? turn.answered.value : ''}`;
    /* A number as it was written ("84.50", not 84.5), when it was written. */
    const asTyped = (n) => {
      for (const m of typed.matchAll(/-?\d[\d,]*(?:\.\d+)?/g)) if (parseFloat(m[0].replace(/,/g, '')) === n) return m[0];
      return String(Number(n.toFixed(10)));
    };
    const given = (k) => r.sources[k] === 'given' || r.sources[k] === 'asked';
    const sym = given('currency') && typeof (r.input || {}).currency === 'string' ? r.input.currency : '';
    let symbolUsed = false;
    const shown = Object.entries(r.input || {})
      .filter(([k, v]) => k !== 'currency' && given(k) && v !== undefined && v !== null && typeof v !== 'object')
      .map(([k, v]) => {
        const changed = turn.changed && turn.changed.field === k && typeof v === 'number' && typeof turn.changed.from === 'number';
        /* A value you changed from the skill line is shown with the places the
           original was written with ("84.50" → "100.00"). */
        let value = typeof v !== 'number' ? String(v).trim()
          : changed ? v.toFixed(((asTyped(turn.changed.from).split('.')[1]) || '').length)
          : asTyped(v);
        /* The currency goes on the amount it was written in front of — or on the
           amount changed in its place. */
        const wasWithSym = changed && typed.includes(`${sym}${asTyped(turn.changed.from)}`);
        if (sym && !symbolUsed && typeof v === 'number' && (typed.includes(`${sym}${value}`) || wasWithSym)) { value = `${sym}${value}`; symbolUsed = true; }
        return { field: k, label: (labelOf && labelOf(r.skill, k)) || (r.fieldLabels && r.fieldLabels[k]) || fieldWords(k), value, source: r.sources[k] };
      })
      .filter(x => x.value && x.value.length <= 40);
    if (sym && !symbolUsed) shown.push({ field: 'currency', label: (r.fieldLabels && r.fieldLabels.currency) || 'currency', value: sym, source: r.sources.currency });
    return { skill, values: shown.map(x => x.value).slice(0, 4), fields: shown.slice(0, 4) };
  }
  /* A turn saved before sources were recorded: only values literally present
     in what was typed. */
  const said = `${turn.message || ''} ${turn.answered ? turn.answered.value : ''}`;
  const numbers = new Map();
  for (const m of said.matchAll(/-?\d+(?:\.\d+)?/g)) {
    const n = parseFloat(m[0]);
    if (!numbers.has(n)) numbers.set(n, m[0]);
  }
  const lower = said.toLowerCase();
  const values = [];
  for (const v of Object.values(r.input || {})) {
    if (typeof v === 'number' && numbers.has(v)) values.push(numbers.get(v));
    else if (typeof v === 'string' && v.trim().length > 1 && v.trim().length <= 40 && lower.includes(v.trim().toLowerCase())) values.push(v.trim());
  }
  return { skill, values: [...new Set(values)].slice(0, 4) };
}

/** A skill's name as a person reads it: "splitBill" → "Split bill". */
export function humanise (name) {
  const s = String(name || '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[-_]+/g, ' ').trim().toLowerCase();
  return s ? s[0].toUpperCase() + s.slice(1) : '';
}

/** The badge over a written answer in the popover and the bar: who wrote
 *  it, or — for a grounded Pigeon's — where it was found. */
export function badgeFor (turn, name = 'Pigeon') {
  const mark = markFor(turn);
  return markLabel(mark === MARKS.FOUND ? mark : MARKS.WRITTEN, { name, found: foundIn(turn), cutShort: Boolean(turn && turn.finishReason === 'length') });
}

/** The one line under an answer in the popover and the bar: the mark, then
 *  the skills that did the work, then whether a model was involved. */
export function receiptLine (turn) {
  const mark = markFor(turn);
  if (!mark) return '';
  const label = markLabel(mark, { found: foundIn(turn) });
  if (mark !== MARKS.WORKED && mark !== MARKS.LOOKED) return label;
  const skills = [...new Set((turn.results || []).filter(r => r.ok).map(r => humanise(r.skill)).filter(Boolean))];
  const model = turn.mode === 'planned' ? '' : ' · no model';
  return `${label}${skills.length ? ` · ${skills.join(', ')}` : ''}${model}`;
}

/** What Copy puts on the clipboard: the answer as plain text, and only that —
 *  no mark, no "I took this as" line, no failure codes. */
export function copyText (turn) {
  if (!turn || !turn.reply) return '';
  if (turn.lane === 'B') return String(foundIn(turn) ? turn.reply.text.replace(/\s*\[§\d+\]/g, '') : turn.reply.text || '').trim();
  const segs = (turn.reply.segments || []).filter(s => s && s.type !== 'failure');
  return toPlainText(segs).trim();
}

/** Copy, with where the answer came from in brackets. */
export function copyWithSource (turn, name = 'Pigeon') {
  const text = copyText(turn);
  if (!text) return '';
  const mark = markFor(turn);
  const skill = humanise(((turn.results || [])[0] || {}).skill);
  const where = mark === MARKS.WORKED ? `worked out by Patch in Pigeon${skill ? `: ${skill}` : ''}`
    : mark === MARKS.LOOKED ? `looked up by Patch in Pigeon, from ${webSource(turn) || 'the web'}`
      : mark === MARKS.FOUND ? `written by ${name} in Pigeon from ${foundLabel(foundIn(turn))}`
      : mark === MARKS.WRITTEN ? `written by ${name} in Pigeon, may be wrong`
        : null;
  return where ? `${text} (${where})` : text;
}
