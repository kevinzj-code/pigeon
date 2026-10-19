/* meet.js — the sheet a Pigeon file opens before anything is installed.
 *
 * Opening a .pigeon (or a .nest) no longer adds it. Rust checks the file,
 * holds it under an opaque id, and describes it (`Meet` in pigeon.rs); this
 * draws that description and asks. What the maker says is shown as theirs, the
 * base check as Pigeon's own, and the one fact every Pigeon shares — it is
 * weights and text, and cannot reach the web, your files or a program — is said
 * every time.
 *
 * Strings only, no DOM, so the test suite can check every sentence.
 */

import { notesHtml, cardWasSkipped } from './check-notes.js';
import { esc } from './html.js';

export const MEET_SAFETY = 'A Pigeon is a trained set of weights and a few text files. It can’t use the web, open your files or run programs.';
/* D83: a base Pigeon has no weights of its own — said instead when every
   Pigeon on the sheet is one, so the one sentence said every time stays true. */
export const MEET_SAFETY_BASE = 'A Pigeon like this is a few text files for a model already on this Mac. It can’t use the web, open your files or run programs.';
export const BASE_ONLY_NOTE = 'It has no training of its own: it is its maker’s instructions for a model already on this Mac.';

const KIND_WORDS = {
  classifier: 'sorts what you send into labels',
  freeform: 'one input in, one output back',
  persona: 'a voice to talk to',
  extractor: 'pulls details out of what you send',
  grounded: 'answers from the material it carries',
  router: 'a router'
};

/** Records that can be added: a Pigeon checked and held, or a Patch update. */
export const addable = (records = []) => records.filter(r => r && (r.status === 'ready' || r.status === 'patch'));

/* A licence, as a person reads it. The registry gives an SPDX id; the ones it
   lists today are worded, and anything else is shown as it came. */
const LICENCE_WORDS = {
  'Apache-2.0': 'the Apache License 2.0'
};
export const licenceWords = (id) => LICENCE_WORDS[id] || (id ? String(id) : 'a licence the published list doesn’t name');

const megabytes = (n) => (Number(n) > 0 ? `${Math.round(Number(n) / 1e6).toLocaleString('en-GB')} MB` : 'a download');

/* The line said every time, about the Pigeons the sheet shows (to add, or
   already here): the base wording only when every one of them is a base Pigeon. */
const safetyFor = (records) => {
  const shown = records.filter(r => r && (r.status === 'ready' || r.status === 'already'));
  return shown.length && shown.every(r => r.base_only) ? MEET_SAFETY_BASE : MEET_SAFETY;
};

export function meetHtml (records = [], { canDownload = false, canFetch = false } = {}) {
  const ready = addable(records);
  const many = ready.length > 1;
  const one = records.length === 1 ? records[0] : null;
  const title = one && one.name ? `Meet ${one.name}` : records.length > 1 ? 'Meet these Pigeons' : 'Meet this Pigeon';
  const add = ready.length === 0 ? ''
    : ready.length > 1 ? `Add ${ready.length}`
      : ready[0].status === 'patch' ? 'Add this Patch update'
        : ready[0].update ? `Update ${ready[0].name}` : `Add ${ready[0].name}`;
  return `<div class="sheet-card meet-card">
    <div class="sheet-title">${esc(title)}</div>
    <div class="sheet-body">${records.map(r => rowHtml(r, { many, canDownload, canFetch })).join('')}
      <p class="meet-safety">${esc(safetyFor(records))}</p></div>
    <div class="sheet-row">
      <button class="sheet-btn" data-meet="cancel">${ready.length ? 'Not now' : 'Close'}</button>
      ${add ? `<button class="sheet-btn primary" data-meet="add">${esc(add)}</button>` : ''}
    </div>
  </div>`;
}

function rowHtml (r, { many, canDownload, canFetch }) {
  const box = (id, label) => (many ? `<input type="checkbox" data-meet-pick="${esc(id)}" checked aria-label="${esc(label)}">` : '');
  if (r.status === 'ready') {
    const c = r.card && typeof r.card.does === 'string' && r.card.does.trim() ? r.card : null;
    const check = c && c.check && Number.isInteger(c.check.passed) && Number.isInteger(c.check.total)
      ? `<p class="p-claim">Passed ${c.check.passed} of ${c.check.total} on its maker’s test.</p>` : '';
    const maker = c
      ? `<div class="p-maker"><div class="p-eyebrow">From its maker</div><p class="p-does">${esc(c.does)}</p>${check}</div>`
      : cardWasSkipped(r.notes) ? ''
        : '<p class="p-claim">It came without a card, so all Pigeon can say is what its file shows.</p>';
    const update = r.update
      ? `<p class="meet-note">You already have ${esc(r.name)}${r.installed_revision ? ` (revision ${Number(r.installed_revision)})` : ''}. This${r.revision ? ` is revision ${Number(r.revision)} and` : ''} replaces it; your chats with it stay.</p>` : '';
    const warning = notesHtml(r.notes, 'meet-note');
    const sealed = r.sealed_by ? '<p class="meet-note">Sealed by a key this app trusts.</p>' : '';
    const base = r.base_only ? `<p class="meet-note">${esc(BASE_ONLY_NOTE)}</p>` : '';
    return `<div class="meet-row">${box(r.id, `Add ${r.name}`)}<div><b>${esc(r.name)}</b> <span class="meet-kind">${esc(KIND_WORDS[r.kind] || r.kind)}</span>${maker}${base}${update}${warning}${sealed}</div></div>`;
  }
  if (r.status === 'patch') {
    return `<div class="meet-row">${box(r.id, 'Add this Patch update')}<div><b>Patch</b> <span class="meet-kind">an update to Patch’s skills</span><p class="meet-note">It is checked against this app’s trusted key when it is added, and used from the next launch.</p></div></div>`;
  }
  if (r.status === 'already') {
    const base = r.base_only ? `<p class="meet-note">${esc(BASE_ONLY_NOTE)}</p>` : '';
    return `<div class="meet-row"><div><b>${esc(r.name)}</b><p class="meet-note">Already on this Mac — there is nothing to add.</p>${base}</div></div>`;
  }
  if (r.status === 'needs-base') {
    const act = r.missing && canDownload
      ? '<button class="btn-verb" data-meet="download">Download, then add</button>'
      : `<button class="btn-verb soft" data-meet="copy" data-text="${esc(`${r.name || r.file}: ${r.reason}`)}">Copy details for its maker</button>`;
    return `<div class="meet-row"><div><b>${esc(r.name || r.file)}</b><p class="meet-note">${esc(r.reason)}</p>${act}</div></div>`;
  }
  /* A picture Pigeon that leaves out its model's stock picture reader (the
     projector, format §13.1). Its size, source and licence are said before
     the button, because the button downloads (§16.4). */
  if (r.status === 'needs-projector') {
    const p = r.projector || {};
    const url = p.license_url ? ` <span class="meet-url">${esc(p.license_url)}</span>` : '';
    const act = canFetch
      ? `<button class="btn-verb" data-meet="download-projector" data-sha="${esc(p.sha256 || '')}" data-bytes="${esc(String(Number(p.bytes) || 0))}" data-host="${esc(p.host || '')}">Download, then add</button>`
      : '<p class="meet-note">Another download is running. Open this Pigeon again once it has finished.</p>';
    return `<div class="meet-row"><div><b>${esc(r.name || r.file)}</b>
      <p class="meet-note">It looks at pictures through its model’s picture reader, which it doesn’t carry and this Mac doesn’t have yet: ${esc(p.file || 'the picture reader')}, ${esc(megabytes(p.bytes))}, from ${esc(p.host || 'the address')} the published list of models gives${p.registry_id ? ` for ${esc(p.registry_id)}` : ''}. It is checked against the list’s fingerprint before it is kept, and every picture Pigeon on this model shares it.</p>
      <p class="meet-note">It comes under ${esc(licenceWords(p.license))}.${url}</p>${act}</div></div>`;
  }
  return `<div class="meet-row"><div><b>${esc(r.file || 'This file')}</b><p class="meet-note">Can’t be added: ${esc(r.reason || 'no reason given')}</p></div></div>`;
}
