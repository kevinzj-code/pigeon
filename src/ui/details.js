/* details.js — a chat's details panel and a Pigeon's page, as strings.
 *
 * A Pigeon's page is where a person learns what a contact is for before they
 * message it, the way a Claude project's page does: what it does, what to send,
 * how it answers, whether it remembers, what can leave the Mac — then the chats
 * you already have with it, Continue on the latest, and a box to start another.
 * The technical facts (what it runs on, its size, whether it is loaded) are
 * folded under Details. The facts are worked out in app.js, which holds the live
 * stack, and only drawn here.
 */

import { esc, ICONS } from './html.js';
import { slotFor } from './time.js';
import { avatarHtml, factPill, canMessage } from './pigeons.js';
import { deriveCard } from './card.js';
import { notesHtml, cardWasSkipped } from './check-notes.js';
import { lastActivity } from '../chats.js';
import { COPY_LABEL, COPY_NOTE } from '../diagnostics.js';

/* D83: what a base Pigeon's maker tested — this base, with this prompt. */
export const BASE_TEST_NOTE = 'Its maker’s test ran on this base model with this prompt; it has no training of its own.';

/* Where the maker's score was measured (report.json's engine, D98), in the
   same voice as the other lines under From its maker. */
export const scoredInLine = (engine) => (engine ? `Scored in ${engine}` : 'Scored in an unrecorded engine');

/* A score some of whose rows another model judged (graded_by_model > 0): a
   "~" before it, and on hover what that means. */
export const JUDGED_NOTE = 'A judged score can move by a couple of rows between rides.';
export const judgedMarkHtml = (n) =>
  `<abbr class="p-judged" title="${esc(`${n} of these rows were judged by another model rather than by a rule. ${JUDGED_NOTE}`)}">~</abbr>`;

export const factsHtml = (facts = []) => (facts.length
  ? `<dl class="facts">${facts.map(([k, v]) => `<div class="fact"><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`
  : '');

/* Copy diagnostics: the label says what it copies and that nothing is sent,
   on the button itself, so nobody presses it wondering. */
export const diagnosticsButtonHtml = () =>
  `<button class="act diag-copy" data-do="copy-diagnostics"><span>${esc(COPY_LABEL)}</span><small>${esc(COPY_NOTE)}</small></button>`;

export function chatDetailsHtml (c, d, { facts = [], dev = [] } = {}) {
  return `<button class="head-btn sm info-x" data-do="close-details" aria-label="Close details">${ICONS.x}</button>
    ${avatarHtml(d, 64)}<h3>${esc(c.title)}</h3><p>with ${esc(d.name)}</p>${factPill(d)}
    <div class="actions">
      <button class="act" data-do="rename">${ICONS.rename}Rename</button>
      <button class="act" data-do="pin">${ICONS.pin}${c.pinnedAt ? 'Unpin' : 'Pin'}</button>
      <button class="act" data-do="mute">${c.muted ? ICONS.bell : ICONS.bellOff}${c.muted ? 'Show alerts' : 'Hide alerts'}</button>
    </div>
    ${canMessage(d) ? `<button class="link" data-do="new-with" data-pick="${esc(d.pick)}">New chat with ${esc(d.name)}</button>` : ''}
    ${factsHtml(facts)}
    <details class="p-details"><summary>Details for developers</summary>${factsHtml(dev)}${diagnosticsButtonHtml()}</details>
    <button class="danger-link" data-do="delete">${ICONS.trash}Delete chat…</button>`;
}

/**
 * A Pigeon's page, from the Pigeons tab or the name in a chat's header.
 * `chats` are yours with it, newest first; `facts` are the technical ones for
 * Details; `card` is what can be said about it (derived until files carry one).
 */
export function profileHtml (d, { chats = [], facts = [], skills = 0, now = Date.now(), card = null, turns = 12, reproduced = null, sources = null, grounded = false, drawings = null, play = '', playButton = null, draft = '', getModel = null, notes = [], pinned = false } = {}) {
  const k = card || deriveCard(d, null, { turns });
  const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
  const name = esc(d.name);
  /* A Pigeon the running server has not loaded yet is messaged like any other:
     sending to it loads it, so there is no "Restart the models" to press. Patch
     not ready is different — his line says why — and a Pigeon that has been
     removed cannot be brought back from here. */
  /* Peek without its model: the one thing to do is fetch it. The button says
     how much and the note under it says under what terms, before the click
     that starts it. */
  const primary = getModel
    ? `<button class="act primary" data-do="${getModel.running ? 'download-show' : getModel.what === 'search' ? 'download-embedding' : 'download-picture'}">${ICONS.down}${esc(getModel.running ? `Downloading · ${getModel.running}` : `Download the ${getModel.what === 'search' ? 'search' : 'picture'} model · ${getModel.size}`)}</button>`
    : canMessage(d)
    ? `<button class="act primary" data-do="new-with" data-pick="${esc(d.pick)}">${ICONS.compose}New chat</button>`
    : d.kind === 'verified'
      ? `<button class="act primary" disabled aria-disabled="true">${ICONS.compose}${d.loading ? 'Getting ready…' : 'Unavailable'}</button>`
      : `<button class="act primary" disabled aria-disabled="true">${ICONS.compose}Not on this Mac</button>`;
  /* Everything an imported file claims would sit in the maker's block. None
     carries a card yet, so the block says so rather than inventing one. */
  /* A card is the maker's claim, and it reads as one: their line, their test,
     their examples — and, once the models have run them here, which came out
     the same on this Mac. */
  /* A grounded Pigeon is checked on where its answer came from, so its tag
     says so, and a miss shows both sentences on hover. */
  const sourceNote = (i) => {
    const s = sources && sources[i];
    if (!s) return '';
    const said = (x) => (x ? `“${clip(x, 200)}”` : 'no sentence (it declined, or shared too few words)');
    return ` title="${esc(`Expected answer came from: ${said(s.expected)}\nOn this Mac it came from: ${said(s.got)}`)}"`;
  };
  const tag = (i) => (reproduced && reproduced[i] === true
    ? `<span class="p-tag ok">${grounded ? 'Same source on this Mac' : 'Reproduced on this Mac'}</span>`
    : reproduced && reproduced[i] === false
      ? (grounded ? `<span class="p-tag"${sourceNote(i)}>Answered from a different sentence</span>` : '<span class="p-tag">Came out differently on this Mac</span>')
      : '');
  /* A drawing Pigeon's example answer is a recipe; Rust draws it from the
     Pigeon's own parts (pigeon_example_drawings), and the picture stands in
     for the recipe, which stays one hover away. */
  const exampleOut = (e, i) => (drawings && typeof drawings[i] === 'string'
    ? `<img class="p-ex-art" alt="What it draws for “${esc(clip(e.input, 60))}”" title="${esc(clip(e.output, 200))}" src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(drawings[i])}">`
    : `<span class="p-ex-out">→ ${esc(clip(e.output, 90))}</span>`);
  const maker = k.maker
    ? `<div class="p-maker"><div class="p-eyebrow">From its maker</div><p class="p-does">${esc(k.maker.does)}</p>
        ${k.maker.check ? `<p class="p-claim">Passed ${k.maker.judged ? judgedMarkHtml(k.maker.judged) : ''}${k.maker.check.passed} of ${k.maker.check.total} on its maker’s test.</p>` : ''}
        <p class="p-claim p-engine">${esc(scoredInLine(k.maker.engine))}</p>
        ${d.baseOnly ? `<p class="p-claim">${esc(BASE_TEST_NOTE)}</p>` : ''}
        ${k.maker.examples.length ? `<ul class="p-examples">${k.maker.examples.map((e, i) => `<li><span class="p-ex-in">${esc(clip(e.input, 90))}</span>${exampleOut(e, i)}${tag(i)}</li>`).join('')}</ul>` : ''}
        <p class="p-claim">These are its maker’s words and test. Pigeon shows them; it didn’t write them.</p></div>`
    : k.imported
    ? `<div class="p-maker"><div class="p-eyebrow">From its file</div><p class="p-does">${esc(k.does)}</p>
        ${cardWasSkipped(notes) ? '' : '<p class="p-claim">This Pigeon came without a card, so this page says only what its file shows.</p>'}</div>`
    : `<p class="p-does">${esc(k.does)}</p>`;
  const rows = [
    ['Does the work', k.works ? 'Works it out — every figure comes from code' : d.baseOnly ? 'Writes · no training of its own · may be wrong' : 'Writes · may be wrong'],
    ...(k.remembers ? [['Remembers', k.remembers]] : []),
    ...(k.answersWith ? [['Answers with one of', k.answersWith.join(', ')]] : []),
    ...(k.inside ? [['What’s inside', k.inside]] : []),
    ['A picture', k.pictures],
    ['Send it', k.send],
    ['Leaves this Mac', k.leaves]
  ];
  const latest = chats[0];
  const cont = latest && canMessage(d)
    ? `<button class="p-continue" data-do="open-chat" data-chat-id="${esc(latest.id)}"><span><b>Continue:</b> ${esc(latest.title)} · ${esc(slotFor(lastActivity(latest), now))}</span>${ICONS.chevR}</button>`
    : '';
  const list = chats.length
    ? `<div class="sec">Your chats with ${name}</div><div class="p-chats">${chats.map(c => `<button class="crow" data-do="open-chat" data-chat-id="${esc(c.id)}">${avatarHtml(d, 30)}
        <span class="crow-main"><span class="crow-top"><b>${esc(c.title)}</b><time>${esc(slotFor(lastActivity(c), now))}</time></span></span></button>`).join('')}</div>`
    : `<p class="p-none">No chats with ${name} yet.</p>`;
  const compose = canMessage(d)
    ? `<div class="p-compose"><textarea id="pageMsg" rows="1" placeholder="Start a new chat with ${name}" aria-label="Start a new chat with ${name}">${esc(draft)}</textarea></div>`
    : '';
  /* Only an actual imported Pigeon can be removed — never Patch, never Pen,
     and never one already gone (nothing left to take off). */
  const removable = d.kind === 'voice' || d.kind === 'job';
  return `<div class="profile page">${avatarHtml(d, 88)}<h3>${name}</h3>
    <p class="p-sub">${k.imported ? 'Added to this Mac' : 'Comes with Pigeon'}</p>
    ${maker}${Array.isArray(notes) && notes.length ? `<div class="p-notes"><div class="sec">Notes from its check</div>${notesHtml(notes, 'p-note')}</div>` : ''}${(d.kind === 'verified' || d.kind === 'peek') && !d.loaded ? `<p>${esc(d.line)}</p>` : ''}
    ${getModel ? `<p class="p-claim">${getModel.what === 'search'
      ? `${esc(getModel.name)} comes from huggingface.co and is checked against the hash this build names. It comes under the Apache License 2.0; its text is written beside it before anything downloads.`
      : `${esc(getModel.name)} and its projector come from huggingface.co and are checked against the hashes this build names. They come under the Apache License 2.0; its text is written beside them before anything downloads.`}</p>` : ''}
    ${factsHtml(rows)}
    <div class="actions">${primary}<button class="act" data-do="pin-pigeon" data-pick="${esc(d.pick)}" aria-pressed="${pinned}">${ICONS.pin}${pinned ? 'Unpin' : 'Pin'}</button>${playButton === 'play' ? `<button class="act" data-do="play-open" data-pick="${esc(d.pick)}">${ICONS.play}Play</button>`
      : playButton === 'stop' ? `<button class="act" data-do="play-stop">${ICONS.stop}Stop playing</button>` : ''}${d.kind === 'verified' ? `<button class="act" data-do="skills">${ICONS.skills}${Number.isFinite(skills) ? `${skills} skills` : 'Skills'}</button>` : ''}</div>
    ${play}
    ${cont}${compose}${list}
    <details class="p-details"><summary>Details for developers</summary>${factsHtml(facts)}
      ${removable ? `<button class="danger-link" data-do="remove-pigeon" data-pick="${esc(d.pick)}">${ICONS.trash}Remove ${name}…</button>` : ''}</details></div>`;
}

/* A chat whose Pigeon has been removed: the history stays readable, and the
   composer gives way to the way back. */
export const removedHtml = (d) =>
  `<div class="removed-bar">${esc(d.name)} was removed from this Mac. <button class="link" data-do="import-pigeon">Add it again…</button></div>`;
