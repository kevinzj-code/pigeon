/* segments.js — how a computed value is drawn, in the one place both windows
 * read it from.
 *
 * A reply is a list of typed segments; a `value` segment carries the step that
 * produced it and where the number came from — computed, bundled with a date,
 * or from the web with a link. Drawing that mark is the whole point of the
 * app, so it must look and claim the same in the main window and in the
 * menu-bar popover. Two copies would drift, and the first thing to drift would
 * be the smaller surface quietly dropping a caveat. The spec is explicit that
 * a smaller surface is not a reason for a weaker guarantee, so there is one
 * renderer.
 *
 * Pure string work, no DOM: the escaper is passed in and the suite can call it.
 */

const short = (s, n) => (s && s.length > n ? `${s.slice(0, n)}…` : s);

/**
 * `segments` is `reply.segments`; `esc` is the caller's HTML escaper; `turnId`
 * is stamped on each value so a click can find the record it came from.
 */
export function segmentsHtml (segments, { esc, turnId = '' } = {}) {
  return (segments || []).map(seg => {
    if (seg.type === 'failure') {
      return `<span class="fail"><span class="code">${esc(seg.code)}</span>${esc(seg.text)}</span>`;
    }
    if (seg.type !== 'value') return esc(seg.text);

    const p = seg.provenance || {};
    const kind = p.kind === 'bundled' ? 'bundled' : p.kind === 'web' ? 'web' : '';
    const bits = [`${seg.skill || 'computed'} → ${seg.field}`];
    if (seg.input) bits.push(`input: ${short(JSON.stringify(seg.input), 120)}`);
    if (p.kind === 'bundled' && p.dataAsOf) bits.push(`data as of ${p.dataAsOf}`);
    if (p.kind === 'web' && p.source) bits.push(`source: ${p.source}`);
    /* The tooltip stays — it is free and it answers the common question at a
       glance. The click is the escalation: the same record, whole. */
    return `<span class="val ${kind}" data-run="${esc(turnId ?? '')}|${esc(seg.step ?? '')}" title="${esc(bits.join('\n'))}">${esc(seg.text)}</span>`;
  }).join('');
}

/** One line naming what produced an answer, for a surface with no room for a
 *  plan panel. Empty when nothing ran, which is a state the popover draws. */
export function provenanceLine (turn) {
  const results = (turn && turn.results) || [];
  const ran = results.filter(r => r.ok).map(r => r.skill);
  if (!ran.length) return '';
  const kinds = new Set(results.filter(r => r.ok).map(r => (r.provenance || {}).kind).filter(Boolean));
  const where = kinds.has('web') ? 'web' : kinds.has('bundled') ? 'bundled' : 'computed';
  const model = turn.mode === 'planned' ? '' : ' · router only, no model';
  const ms = typeof turn.ms === 'number' ? ` · ${turn.ms} ms` : '';
  return `${[...new Set(ran)].join(', ')} · ${where}${model}${ms}`;
}
