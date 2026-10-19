/* bubbles.js — a turn, drawn as two messages.
 *
 * Your question on the right; the Pigeon's reply on the left, with ONE line
 * under it saying who did the work: Worked out, Looked up, Written by …, or
 * Couldn't (ui/marks.js). That line is where a messaging app says "Delivered",
 * which is where people already look, and clicking it opens Message info — the
 * plan, the scores and the raw results live there now, not in the thread.
 *
 * The distinction every change here must keep is computed versus written. A
 * reply from Patch is drawn with the aqua rule and its values marked by
 * segments.js, under a line saying what he took the question as. A written reply
 * never reaches segmentsHtml at all — it has no values to mark — and carries the
 * dark-yellow rule.
 *
 * Strings only, no DOM, so the test suite can draw real turns and check both
 * halves of that.
 */

import { esc, ICONS, hm, dayName } from './html.js';
import { ago, fullStamp } from './time.js';
import { avatarHtml, factPill } from './pigeons.js';
import { markFor, markLabel, webSource, tookAs, MARKS, humanise } from './marks.js';
import { foundIn, withoutCitations } from './cite.js';
import { statusLine } from './status.js';
import { quoteStripHtml } from './replybar.js';
import { segmentsHtml } from '../segments.js';
import { MODES } from '../turn.js';
import { describeAttachment } from '../ocr.js';
import { REACTIONS } from '../store.js';
import { INTERRUPTED } from '../chats.js';
import { patch } from '../lib/patch.js';

/* A time above a message when the conversation picks up again: the first
   message, a new day, or three quarters of an hour of quiet. */
const STAMP_GAP_MS = 45 * 60 * 1000;
const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
export const needsStamp = (at, prevAt) => Boolean(at) && (!prevAt || !sameDay(at, prevAt) || at - prevAt > STAMP_GAP_MS);
export const stampHtml = (at, now = Date.now()) => `<div class="stamp"><b>${esc(dayName(at, now))}</b> ${esc(hm(at))}</div>`;

/* What the typing bubble's line says while a Pigeon works. */
export const stageLine = (name, stage) => (stage ? `${name} · ${stage}…` : `${name} is replying…`);

/* A question that came from another chat says so above itself. */
export function forwardLabel (h) {
  if (!h) return '';
  const where = h.title
    ? `Forwarded from “${esc(h.title)}”${h.from ? ` with ${esc(h.from)}` : ''}`
    : 'Handed over from another chat';
  return `<span class="fwd-label">${ICONS.forward}${where}</span>`;
}

/* The user's bubble. With an image behind it, the bubble shows what was TYPED
   and, beneath a hairline, what was read and sent — labelled as read, with the
   full text one click away — rather than the composed message the router saw.
   Typed plus the block is that message, which is what the clipboard mirrors. */
export function userBubbleHtml (message, image, turnId = '') {
  if (!image) return `<div class="bub u">${esc(message)}</div>`;
  /* The picture that went with the message, as a preview kept with the turn
     (the picture itself only for the session, in app.js): a click opens it
     over the conversation. */
  const thumb = typeof image.thumb === 'string' && image.thumb.startsWith('data:image/') ? image.thumb : '';
  const pic = thumb
    ? `<img class="from-image-pic" src="${thumb}" alt="${esc(image.name || 'picture')}" title="Open the picture" data-do="see-picture" data-turn="${esc(turnId)}" role="button" tabindex="0">`
    : '';
  /* Sent as a picture to a Pigeon that sees: the preview, and whatever was
     typed with it. */
  if (image.picture) {
    return `<div class="bub u with-image">${image.typed ? `<div class="typed">${esc(image.typed)}</div>` : ''}
    <div class="from-image">
      ${pic}
      <div class="from-image-hd"><span class="t-badge image" title="The picture itself was handed over">seen as a picture</span><span>${esc([image.name, image.width && image.height ? `${image.width}×${image.height}` : ''].filter(Boolean).join(' · '))}</span></div>
    </div>
  </div>`;
  }
  const typed = image.typed ? `<div class="typed">${esc(image.typed)}</div>` : '';
  return `<div class="bub u with-image">${typed}
    <div class="from-image">
      ${pic}
      <div class="from-image-hd"><span class="t-badge image" title="Only the words read off the picture were sent, never the picture">words read from a picture</span><span>${esc(describeAttachment(image))}</span></div>
      <details><summary>the text as sent</summary><pre>${esc(image.text)}</pre></details>
    </div>
  </div>`;
}

function versionsHtml (id, { index, count }) {
  return `<span class="vers">
    <button data-ver="${esc(id)}|-1" ${index === 0 ? 'disabled' : ''} aria-label="Previous version" title="Previous version">${ICONS.chevL}</button>
    <span>${index + 1}/${count}</span>
    <button data-ver="${esc(id)}|1" ${index === count - 1 ? 'disabled' : ''} aria-label="Next version" title="Next version">${ICONS.chevR}</button></span>`;
}

/* `fresh` only on the reaction just added, so it pops in once rather than on
   every repaint of the thread. */
const reactionHtml = (emoji, fresh = false) => (emoji
  ? `<span class="react${fresh ? ' fresh' : ''}" aria-label="You reacted ${esc(emoji)}">${esc(emoji)}</span>`
  : '');
const tapbackHtml = (id, which, current) => `<span class="tapback" role="group" aria-label="React">${REACTIONS.map(r =>
  `<button data-react="${esc(id)}|${which}|${r}" aria-pressed="${current === r}" aria-label="React with ${r}">${r}</button>`).join('')}</span>`;
/* What shows under a message only while it is hovered (or holds the
   keyboard): Copy, Reply under a reply, Edit on your own message, ⋯ for the
   rest, and when it was sent — "5 mins ago", or the date and minute once the
   time is clicked. The line saying who did the work (markHtml) hides with it,
   so the bubble alone is what you see otherwise. */
export const hoverHtml = (turn, which, { now = Date.now(), full = false, busy = false } = {}) => {
  const id = esc(turn.id);
  const at = which === 'q' ? turn.at : (turn.repliedAt || turn.at);
  const when = at
    ? `<button class="when" data-do="when" data-turn="${id}" data-which="${which}" aria-pressed="${full}" title="${esc(full ? 'Show how long ago' : fullStamp(at))}">${esc(full ? fullStamp(at) : ago(at, now))}</button>`
    : '';
  const edit = which === 'q' ? `<button data-do="edit-q" data-turn="${id}"${busy ? ' disabled' : ''}>Edit</button>` : '';
  const reply = which === 'a' ? `<button data-do="quote" data-turn="${id}">Reply</button>` : '';
  return `<span class="hov" role="group" aria-label="${which === 'q' ? 'Your message' : 'This reply'}">
    <button data-do="${which === 'q' ? 'copy-q' : 'copy-a'}" data-turn="${id}">Copy</button>${reply}${edit}
    <button data-tool="more" data-key="${id}|${which}" aria-label="More" title="Reply, react, forward and more">${ICONS.ellipsis}</button>${when}</span>`;
};

/* No tick on Worked out: a tick in the receipt slot reads as "delivered", or
   as "correct", and neither is what it means. */
const CALC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8 12h.01M12 12h.01M16 12h.01M8 16h.01M12 16h.01M16 16h.01"/></svg>';
const MARK_ICON = { worked: CALC, looked: ICONS.web, found: ICONS.doc, written: ICONS.pencil, couldnt: ICONS.x, waiting: ICONS.info, skipped: ICONS.x };

/** The line under a reply. Clicking it opens Message info. */
export function markHtml (turn, mark, label) {
  return `<button class="mark ${esc(mark)}" data-do="info" data-turn="${esc(turn.id)}" title="${esc(label)} — how this was made">${MARK_ICON[mark] || ''}<span>${esc(label)}</span><span class="chev" aria-hidden="true">›</span></button>`;
}

/** "Split bill [84.50] [4]" — what Patch read from the words, above the answer. */
export function tookAsHtml (turn) {
  const t = tookAs(turn);
  if (!t || !t.skill) return '';
  /* A value you gave is a button. On a one-step answer that never touched the
     web it opens a small sheet to change just that value; anywhere else it
     opens Edit on your message, which is the honest way to change a plan. */
  const results = turn.results || [];
  const one = results.length === 1 && results[0].ok && !turn.webSentAt;
  const chip = (v, i) => {
    const f = t.fields && t.fields[i];
    if (!f) return `<span class="tv">${esc(v)}</span>`;
    /* Hovering a value says what it is ("bill"); the button's spoken name
       says what pressing it does. */
    const what = f.label || f.field;
    return `<button class="tv" data-do="change-value" data-turn="${esc(turn.id || '')}" data-field="${esc(f.field)}" data-label="${esc(what)}" data-shown="${esc(String(v).replace(/^[£$€₹¥]/, ''))}" aria-label="${one ? `${esc(v)}, ${esc(what)} — change it` : `${esc(v)}, ${esc(what)} — edit your message to change it`}">${esc(v)}</button>`;
  };
  /* One tap to the twin: the router listed a skill the planner mistakes for
     this one, so the line offers it; a tap asks again with that one card and
     the answer lands as a version beside this one. An answer that came of
     such a tap says so instead. */
  const twin = turn.twin && !turn.chosen
    ? `<button class="btn-verb soft twin" data-do="retwin" data-turn="${esc(turn.id || '')}" data-skill="${esc(turn.twin)}" title="Ask again with ${esc(turn.twin)} instead">or ${esc(turn.twin)}?</button>`
    : '';
  const chose = turn.chosen ? '<span class="chose">you chose this</span>' : '';
  return `<div class="took"><b>${esc(t.skill)}</b>${t.values.length ? `<span class="tvs">${t.values.map(chip).join('')}</span>` : ''}${chose}${twin}</div>`;
}

const verbs = (buttons) => (buttons.length ? `<div class="acts-in">${buttons.join('')}</div>` : '');
const noStop = (s) => String(s || '').replace(/[.\s]+$/, '');

/* A reply that ran into its token budget is a fragment, not an answer: the
   model reports it as finish_reason "length", and the reply has to say so
   rather than let half a sentence stand as the output. */
function cutOff (turn) {
  return Boolean(turn.reply && turn.finishReason === 'length');
}
function cutNote (turn) {
  if (!cutOff(turn)) return '';
  const at = typeof turn.tokens === 'number' && turn.tokens ? ` at ${turn.tokens} tokens` : '';
  return `<span class="job-note">Cut off${at}, the most this reply was allowed — this isn’t the whole answer.</span>`;
}

function replyParts (turn, o) {
  const id = esc(turn.id);
  const d = o.pigeon || { name: 'Pigeon', kind: 'voice' };
  const mark = markFor(turn, { skipped: Boolean(o.skipped) });
  const label = markLabel(mark, { name: d.name, firstThree: Boolean(o.longMark), cutShort: cutOff(turn), source: webSource(turn), found: foundIn(turn) });
  const part = (bubble, over) => ({ bubble, mark, label: over || label });

  /* Asked, and Pigeon closed before it was answered. The question stays whole
     — it is what you typed — with the one thing worth doing next. */
  /* A picture is kept only while Pigeon is open. Asked again after a
     relaunch, it has to be attached again, and the button says so. */
  const again = (button) => (o.pictureGone ? '<button class="btn-verb" data-do="attach-again">Attach the picture again</button>' : button);
  if (turn.interrupted) {
    return part(`<div class="bub ai${turn.lane === 'B' ? ' gen' : ''} couldnt"><p>${esc(turn.error || INTERRUPTED)}</p>${verbs([again(`<button class="btn-verb" data-retry="${id}">Try again</button>`)])}</div>`);
  }

  /* Written, before anything else: a generated reply never reaches
     segmentsHtml, which is the function that draws a value with provenance. */
  if (turn.lane === 'B') {
    /* Trying again always wakes first if the server is down, so the button is
       the same action either way — but it only SAYS "Wake models" when the
       chat model is actually asleep and there is an engine that could wake it. */
    if (!turn.reply) {
      const verb = !o.canChat && o.canWake ? 'Wake models' : 'Try again';
      return part(`<div class="bub ai gen couldnt"><p>${esc(d.name)} didn’t reply: ${esc(noStop(turn.error || 'nothing came back'))}.</p>${verbs([again(`<button class="btn-verb" data-wake="${id}">${verb}</button>`)])}</div>`);
    }
    /* The handoff guard dropped a reply that stated a figure nobody gave. The
       way forward is the move that works: put the amounts in the message. */
    if (turn.handoff) {
      /* Pen can also be asked again for an answer with no figures in it. */
      const again = d.kind === 'base' && !turn.noAmounts ? [`<button class="btn-verb soft" data-do="pen-no-amounts" data-turn="${id}">Ask ${esc(d.name)} without amounts</button>`] : [];
      return part(`<div class="bub ai gen couldnt"><p>${esc(d.name)}’s reply had a figure you didn’t give it, so it isn’t shown. Put the amounts in your message and ${esc(d.name)} will use them.</p>${verbs([`<button class="btn-verb" data-fwd="${id}|patch" title="${esc(o.handoffOffer || 'Ask Patch')}">Ask Patch</button>`, ...again])}</div>`);
    }
    const unmatched = turn.unmatchedLabel
      ? `<span class="job-note">That is not one of ${esc(d.name)}’s own labels — it was asked to classify and answered with something else.</span>`
      : '';
    if (d.kind === 'job') return jobReply(turn, d, unmatched, part);
    /* A question that wanted a figure: working one out is Patch's job. */
    const ask = turn.offer
      ? verbs([`<button class="btn-verb soft" data-fwd="${id}|patch" title="${esc(o.handoffOffer || 'Ask Patch')}">Ask Patch</button>`])
      : '';
    /* Cut off at its budget: the newest such reply can be asked to carry on. */
    const more = o.last && cutOff(turn) ? verbs([`<button class="btn-verb soft" data-do="keep-going" data-turn="${id}">Keep going</button>`]) : '';
    return part(`<div class="bub ai gen">${esc(turn.reply.text)}${cutNote(turn)}${unmatched}${ask}${more}</div>`);
  }

  if (turn.ask) {
    /* THE QUESTION IS A THIRD OF ALL SUCCESSFUL TURNS. It stays the loud part,
       and under it sit the two facts a person wants: what it is lined up to do,
       and which parts of the sentence it already read back. `untraceable` means
       the planner wrote a value the message never contained and the audit
       removed it — saying so is the difference between "I need more" and "I
       nearly made something up". */
    const ask = turn.ask;
    const held = (ask.have || []).length
      ? `<span class="ask-have">already read: ${ask.have.map(h => `<span class="ask-kv">${esc(humanise(h.field).toLowerCase())} <b>${esc(h.text)}</b></span>`).join('')}</span>`
      : '';
    const why = ask.untraceable
      ? `<span class="ask-why">${esc(ask.why || 'it was not in your message')}, so I am asking rather than guessing</span>`
      : '';
    return part(`<div class="bub ai ask${o.skipped ? ' folded' : ''}">${esc(ask.question)}
        <span class="ask-meta">
          <span class="ask-does">ready to <b>${esc(humanise(ask.skill).toLowerCase())}</b>${ask.does ? ` — ${esc(ask.does.replace(/\.$/, '').toLowerCase())}` : ''}</span>
          ${held}${why}
        </span></div>`, o.skipped ? 'Skipped' : o.pending ? 'Waiting on you' : 'Answered');
  }

  /* A look-up waiting for a yes, asked right where it is needed: the exact
     words that would be sent, in a box they can be changed in, and the two
     sites. Nothing has left the Mac while this is on screen. */
  if (turn.consent) {
    const c = turn.consent;
    return part(`<div class="bub ai couldnt consent"><p>That needs a look-up on the web. Send this to DuckDuckGo and Wikipedia?</p>
        <input class="net-q" type="text" data-consent-q="${id}" value="${esc(c.query || '')}" aria-label="What will be searched — you can change it" spellcheck="false">
        <p class="why">Nothing has been sent yet. Only what is in the box leaves this Mac.</p>
        ${verbs([`<button class="btn-verb soft" data-do="consent-no" data-turn="${id}">Don’t send</button>`, `<button class="btn-verb" data-do="consent-send" data-turn="${id}">Send once</button>`])}</div>`);
  }

  if (turn.invalid) {
    return part('<div class="bub ai couldnt"><p>That plan didn’t pass validation, so nothing ran.</p></div>');
  }

  if (turn.mode === MODES.NO_SKILL) {
    /* Pigeon does not pretend a function covers writing, summarising or
       explaining. The decline says so in one sentence, offers the nearest
       skills' own examples as chips that type — to edit, never forced onto the
       question — and offers Pen. The scores and the threshold are in Message
       info: at a score of 0.26 "this one is close" would be a false claim. */
    /* A decline that teaches: the router named a category with confidence
       and the planner still found nothing, so three of that category's own
       examples are offered, typed into the box on a tap and never sent. Without
       a category, the skills that merely share words, two at most, as before. */
    const taught = turn.taught && Array.isArray(turn.taught.skills) ? turn.taught : null;
    const examples = taught
      ? [...new Set(taught.skills.map(n => (o.exampleFor ? o.exampleFor(n) : null)).filter(Boolean))].slice(0, 3)
      : [...new Set((turn.suggestions || []).map(c => (o.exampleFor ? o.exampleFor(c.name) : null)).filter(Boolean))].slice(0, 2);
    const why = taught ? `With <code>${esc(taught.category)}</code> I can:` : 'Skills that share words with your question, none a close match:';
    const chips = examples.length
      ? `<p class="why">${why}</p><div class="chips">${examples.map(t =>
        `<button class="chip" data-do="type-chip" data-text="${esc(t)}"><span class="g">Aa</span>${esc(t)}</button>`).join('')}</div>`
      : '';
    /* Without the download Patch can only match short questions by their words.
       That is said plainly, with the download offered right where it was
       needed — and once it has landed, Ask again now sends the same words. */
    if (o.download) {
      const act = o.download === 'done'
        ? `<button class="btn-verb" data-do="ask-again" data-turn="${id}">Ask again now</button>`
        : `<button class="btn-verb" data-do="download">Download ${esc(o.download.size)}</button>`;
      return part(`<div class="bub ai couldnt"><p>Without Pigeon’s download I can only match short questions to a skill, and this one didn’t match.</p>${verbs([act])}</div>`);
    }
    /* Declined with only the router working: the models can be woken for it,
       and the button says how long that takes on this Mac. */
    const offers = [
      ...(o.wakeOffer ? [`<button class="btn-verb" data-do="wake-ask" data-turn="${id}">Try with the models · ${esc(o.wakeOffer)}</button>`] : []),
      ...(o.canChat ? [`<button class="btn-verb${o.wakeOffer ? ' soft' : ''}" data-fwd="${id}|chat">Ask Pen</button>`] : [])
    ];
    const pen = offers.length ? verbs(offers) : '';
    return part(`<div class="bub ai couldnt"><p>I can’t work that out — no skill of mine fits it.${o.canChat ? '' : ' Pen could write an answer, but no model is awake to write with.'}</p>${chips}${pen}</div>`);
  }

  /* A look-up Patch did not make. The web is used only when the person presses
     Look it up and then says yes to exactly what would be sent. */
  if ((turn.results || []).some(r => !r.ok && r.error && r.error.code === 'NETWORK_OFF')) {
    const act = o.webNever
      ? '<p class="why">Pigeon is set never to use the web (Settings › Privacy).</p>'
      : verbs([`<button class="btn-verb" data-do="look-it-up" data-turn="${id}">Look it up…</button>`]);
    return part(`<div class="bub ai couldnt"><p>That needs a look-up on the web.</p>${act}</div>`);
  }

  const took = mark === MARKS.WORKED ? tookAsHtml(turn) : '';
  /* A skill that failed on its input: its own example and two neighbours
     under the error, typed on a tap, so the right shape is one tap away. */
  const taught = turn.taught && Array.isArray(turn.taught.skills) && (turn.results || []).some(r => !r.ok)
    ? [...new Set(turn.taught.skills.map(n => (o.exampleFor ? o.exampleFor(n) : null)).filter(Boolean))].slice(0, 3)
    : [];
  const teach = taught.length
    ? `<p class="why">Asked like this, I can:</p><div class="chips">${taught.map(t => `<button class="chip" data-do="type-chip" data-text="${esc(t)}"><span class="g">Aa</span>${esc(t)}</button>`).join('')}</div>`
    : '';
  return part(`<div class="bub ai${mark === MARKS.COULDNT ? ' err' : ''}${o.tip === 'figure' ? ' tip-figure' : ''}">${took}<div class="segs">${segmentsHtml(turn.reply ? turn.reply.segments : [], { esc, turnId: turn.id })}</div>${teach}</div>`);
}

/* A job's answer, with what a grounded or skill Pigeon adds beside it. The
   drawing is markup out of a file somebody else made, so it is shown as an
   image — an <img> never runs anything inside it — and never put in the page. */
function jobReply (turn, d, unmatched, part) {
  if (turn.noMaterial) {
    /* Answered from the material alone, no model: and what it DOES cover, as
       chips that type, so the next question has somewhere to go. */
    const covers = (turn.contents || []).length
      ? `<p class="why">It covers:</p><div class="chips">${turn.contents.map(t => `<button class="chip" data-do="type-chip" data-text="${esc(t)}">${esc(t)}</button>`).join('')}</div>`
      : '';
    return part(`<div class="bub ai gen couldnt"><p>That isn’t in ${esc(d.name)}’s material, so it was not asked.</p>${covers}</div>`);
  }
  /* A grounded answer reads like a looked-up one: the words it came from are
     a click away, so it is underlined, and the click opens that section with
     the sentence marked. One that came from no section — it declined, or
     nothing in what it was shown shares its words — is drawn the same way
     without the underline, because there is nothing to open. */
  const found = foundIn(turn);
  const grounded = Array.isArray(turn.sections) && turn.sections.length > 0;
  const out = turn.rendered
    ? `<img class="skill-art" alt="What ${esc(d.name)} drew" src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(turn.rendered)}"><code class="recipe">${esc(turn.reply.text)}</code>${verbs([`<button class="btn-verb soft" data-do="copy-drawing" data-turn="${esc(turn.id || '')}">Copy image</button>`, `<button class="btn-verb soft" data-do="save-drawing" data-turn="${esc(turn.id || '')}">Save drawing…</button>`])}`
    : found
      ? `<div class="job-out doc"><span class="val doc" data-cite="${esc(turn.id || '')}" role="button" tabindex="0" title="Where this came from">${esc(withoutCitations(turn.reply.text))}</span></div>`
      : `<div class="job-out${grounded ? ' doc' : ''}">${esc(turn.reply.text)}</div>`;
  const miss = turn.renderError ? `<span class="job-note">${esc(turn.renderError)}</span>` : '';
  const cited = turn.unsupportedCitations || [];
  const cites = cited.length
    ? `<span class="job-note">It cites ${cited.map(n => `§${Number(n)}`).join(', ')}, which it was not shown.</span>`
    : '';
  return part(`<div class="bub ai gen${turn.renderError && !turn.rendered ? ' couldnt' : ''}">${out}${cutNote(turn)}${miss}${unmatched}${cites}</div>`);
}


/* How many parts a recipe names, for the Robot's line: a named part is any
   non-empty field, and a list (extras) counts its items. Null when the text is
   not a recipe at all — the render error then says why. */
function recipeParts (text) {
  let r;
  try { r = JSON.parse(text); } catch { return null; }
  if (!r || typeof r !== 'object' || Array.isArray(r)) return null;
  let parts = 0; let extras = 0;
  for (const v of Object.values(r)) {
    if (Array.isArray(v)) extras += v.length;
    else if (v !== null && v !== '') parts += 1;
  }
  return { parts, extras };
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * The plan panel for a Lane B turn, as rows for app.js's chat-flow renderer.
 *
 * Whoever wrote the reply speaks in their own name — a Pigeon as itself, and
 * Patch only for the base model, which is the model he is. The Robot reports
 * only what actually ran, and for a job Pigeon something often did: Rust drew
 * its recipe from the parts table it shipped, searched its material, or
 * checked its answer against its own labels. Claiming "nothing ran" there
 * would be the same fiction as claiming a check that never happened.
 *
 * `d` is the Pigeon as pigeonOf draws it (null for the base model); `persona`
 * is its installed record, when it is still installed, for the facts only the
 * record has — its skill, its labels, how it searches.
 */
export function laneBFlow (turn, { d = null, persona = null } = {}) {
  const rows = [];
  const name = d ? d.name : 'the chat model';
  const speaker = d ? { who: 'pigeon', name: d.name, avatar: avatarHtml(d, 26) } : { who: 'patch' };
  const job = (d && d.kind === 'job') || Boolean(turn.rendered || turn.renderError || turn.sections || turn.noMaterial || turn.unmatchedLabel || turn.unsupportedCitations);
  const drew = Boolean(turn.rendered || turn.renderError);
  const cost = [
    typeof turn.tokens === 'number' && turn.tokens ? `${turn.tokens} tokens` : '',
    typeof turn.ms === 'number' ? `${(turn.ms / 1000).toFixed(1)} s` : ''
  ].filter(Boolean).join(' · ');

  /* The writer's line. A grounded Pigeon whose search found nothing was never
     asked, so it has no line to speak. */
  if (!turn.noMaterial) {
    const html = !turn.reply
      ? `I couldn't write anything: ${esc(turn.error || 'the model did not answer')}.`
      : drew
        ? `I picked the parts: <code>${esc(turn.reply.text)}</code>. Choosing them is mine — nothing checked that they fit what you asked.`
        : job
          ? 'I wrote this from the one prompt I was trained with. Nothing checked it against anything.'
          : 'I wrote this myself. No skill ran, no value has provenance, and nothing here was checked against anything.';
    const sub = [cost, cutOff(turn) ? 'cut off at its budget' : ''].filter(Boolean).join(' · ');
    rows.push({ ...speaker, html, sub, cls: turn.reply ? '' : 'bad', subTitle: 'What the model cost.' });
  }

  if (turn.handoff) {
    const nums = turn.handoff.numbers || [];
    rows.push({
      ...speaker,
      html: `I had written ${nums.length === 1 ? 'a figure' : 'figures'} you never gave me — ${nums.map(n => `<code>${esc(n)}</code>`).join(', ')} — so the app threw the answer away before you saw it. Working a number out is Patch’s job.`,
      sub: 'dropped by the handoff guard',
      cls: 'ask',
      subTitle: 'src/lane-b/handoff.js reads every reply for numbers the person did not supply, and drops the prose when it finds one.'
    });
  }

  const robot = (html, sub = '', cls = '', subTitle = '') => rows.push({ who: 'robot', html, sub, cls, subTitle });
  if (!job) {
    robot('Nothing ran. No skill was used and nothing was checked — every word was written.', 'nothing left this Mac', '', 'The model runs on this Mac; the reply was written locally.');
    return rows;
  }

  const before = rows.length;
  if (turn.noMaterial) {
    robot(`Searched ${esc(name)}’s material — no section matched, so ${esc(name)} was not asked.`, 'the model was not called');
  }
  const sections = turn.sections || [];
  if (sections.length) {
    const list = sections.map(s => `[§${Number(s.ordinal)}] ${esc(s.title)}`).join(', ');
    robot(`Found ${plural(sections.length, 'section')} in ${esc(name)}’s material and handed ${sections.length === 1 ? 'it' : 'them'} over: ${list}.`,
      persona && persona.retrieval ? `searched by ${persona.retrieval}` : '');
  }
  const cited = turn.unsupportedCitations || [];
  if (cited.length) {
    robot(`The answer cites ${cited.map(n => `§${Number(n)}`).join(', ')}, which ${esc(name)} was not shown.`, '', 'bad');
  }
  if (turn.rendered) {
    const skill = persona && persona.skill ? `<code>${esc(persona.skill)}</code>` : 'its skill';
    const counted = turn.reply ? recipeParts(turn.reply.text) : null;
    const what = counted ? ` — ${plural(counted.parts, 'part')}${counted.extras ? ` and ${plural(counted.extras, 'extra')}` : ', no extras'}` : '';
    robot(`Drew the recipe with ${skill} from the parts table ${esc(name)} shipped${what}.`, 'drawn in Rust · no code from the Pigeon ran',
      '', 'The .pigeon carries an SVG piece for each part; the drawing is those pieces joined in a fixed order, so the same recipe always draws the same picture.');
  }
  if (turn.renderError) {
    robot(`Could not draw it: ${esc(turn.renderError)}. The recipe is shown as ${esc(name)} wrote it — no part was swapped for a nearer one.`, '', 'bad');
  }
  if (cutOff(turn)) {
    const at = turn.tokens ? plural(turn.tokens, 'token') : 'its limit';
    robot(`Stopped the reply at ${at}, the most ${esc(name)} is allowed — it ran out before it finished.`, '', 'bad');
  }
  const labels = persona && persona.output_type === 'label' ? persona.labels || [] : [];
  if (labels.length && turn.reply) {
    robot(turn.unmatchedLabel
      ? `Checked the answer against ${esc(name)}’s ${plural(labels.length, 'label')} — it is not one of them.`
      : `Checked the answer against ${esc(name)}’s ${plural(labels.length, 'label')} — it is one of them.`,
    '', turn.unmatchedLabel ? 'bad' : '');
  } else if (turn.unmatchedLabel) {
    robot(`Checked the answer against ${esc(name)}’s own labels — it is not one of them.`, '', 'bad');
  }
  if (rows.length === before && turn.reply) {
    robot(`Ran ${esc(name)} once, with the prompt it was trained with. Nothing checked what it wrote.`);
  }
  const last = rows[rows.length - 1];
  if (last && last.who === 'robot' && !last.sub) last.sub = 'nothing left the machine';
  return rows;
}

const TIPS = {
  written: 'Written replies come from a small model on your Mac. Nothing checks them, so they can be wrong — and figures are Patch’s job.',
  figure: 'Click anything underlined to see where it came from.'
};
const tipHtml = (key) => (TIPS[key]
  ? `<div class="fnote"><span>${esc(TIPS[key])}</span><button data-do="tip-done" data-tip="${esc(key)}">Got it</button></div>`
  : '');

/**
 * One turn: your question and the reply to it.
 *
 * `o` carries what only the window knows — who the chat is with, the version
 * count, whether this is the last question, which tapback bar is open, whether
 * Pen is awake, whether this answer gets the long first-three mark, which
 * one-time note it carries, how to find a skill's example, and which times
 * have been clicked open to the minute (`whenFull`).
 */
export function turnHtml (turn, o = {}) {
  const id = esc(turn.id);
  const stamp = needsStamp(turn.at, o.prevAt) ? stampHtml(turn.at, o.now) : '';
  if (o.editing) {
    return `<div class="turn" id="turn-${id}">${stamp}<div class="edit-wrap">
      <textarea class="edit-ta" id="editbox" aria-label="Edit and ask again">${esc(turn.message)}</textarea>
      <div class="edit-actions">
        <button class="btn ghost" id="editCancel">Cancel</button>
        <button class="btn primary" id="editSave" data-edit-save="${id}">Save &amp; ask again</button>
      </div></div></div>`;
  }
  const r = turn.reactions || {};
  const tap = (w) => (o.tapback === `${turn.id}|${w}` ? tapbackHtml(turn.id, w, r[w]) : '');
  const hov = (w) => hoverHtml(turn, w, { now: o.now, full: Boolean(o.whenFull && o.whenFull(w)), busy: Boolean(o.busy) });
  /* Under your question: its versions, and — only once you said yes — the two
     sites it was sent to, and when; then, on hover, Copy, Edit, ⋯ and when. */
  const under = `${o.versions ? versionsHtml(turn.id, o.versions) : ''}${turn.webSentAt ? `<span class="q-status">${esc(statusLine({ state: 'sent-web', at: turn.webSentAt }))}</span>` : ''}`;
  const question = `<div class="msg me" data-turn="${id}" data-which="q">${forwardLabel(turn.handedFrom)}
    ${o.quote ? quoteStripHtml(o.quote) : ''}<div class="bub-wrap">${tap('q')}${userBubbleHtml(turn.message, turn.image, turn.id)}${reactionHtml(r.q, o.freshReaction === `${turn.id}|q`)}</div>
    <div class="receipt">${under}${hov('q')}</div></div>`;
  /* A question that was answered with a question: your answer to it. */
  const answered = turn.answered
    ? `<div class="msg me"><div class="bub-wrap"><div class="bub u">${esc(turn.answered.value)}</div></div></div>`
    : '';
  const p = replyParts(turn, o);
  /* The line under a reply says who did the work; it and the actions show on
     hover, the same for every reply. Message info is still one click away. */
  const reply = `<div class="msg them" data-turn="${id}" data-which="a">
    <div class="bub-wrap">${tap('a')}${p.bubble}${reactionHtml(r.a, o.freshReaction === `${turn.id}|a`)}</div>
    <div class="markrow">${markHtml(turn, p.mark, p.label)}${hov('a')}</div>${tipHtml(o.tip)}</div>`;
  return `<div class="turn" id="turn-${id}">${stamp}${question}${answered}${reply}</div>`;
}

/* A question being answered: drawn as a turn, never as an absence, with the
   typing bubble under it and what is actually happening written beneath.
   Under your own message sits the status line — "Waking Pen · about 14 s" —
   where a messaging app says Delivered; it is empty when there is nothing to
   wait for, and app.js counts it down in place. */
export function inflightHtml (f, d, { prevAt = null, now = Date.now(), status = '' } = {}) {
  const stamp = needsStamp(f.sentAt, prevAt) ? stampHtml(f.sentAt, now) : '';
  return `<div class="turn inflight">${stamp}<div class="msg me">${forwardLabel(f.handedFrom)}
      <div class="bub-wrap">${userBubbleHtml(f.message, f.image)}</div>
      <div class="receipt status${status ? '' : ' empty'}" id="statusWrap"><span class="q-status busy" id="statusLine">${esc(status)}</span></div></div>
    <div class="msg them">${liveBubbleHtml(f, d)}
      <div class="prov busy" id="stageLine">${esc(stageLine(d.name, f.stage))}</div></div></div>`;
}

/* The typing bubble: the dots alone, or — while a reply is being written in
   the chat lane — the whole sentences that have landed so far with the dots
   after them. `f.live` is what may be on screen (every sentence of it past
   the figure guard, chat.js `showable`); a repaint keeps it, and `showText`
   in app.js appends to it between repaints. */
export function liveBubbleHtml (f, d) {
  const warm = d.kind === 'verified' ? '' : ' warm';
  const live = f.live ? `<span class="live" id="liveText"><span class="land">${esc(f.live)}</span></span>` : '';
  return `<div class="typing-bub${warm}${f.live ? ' has-text' : ''}" id="liveBub" aria-label="${esc(d.name)} is replying">${live}<span class="dots"><i></i><i></i><i></i></span></div>`;
}

/**
 * Messages sent while a reply was on its way, waiting their turn. Each says
 * Waiting — or, while Patch's question is open, that it is waiting for your
 * answer to him — and can be taken back before it goes. After a relaunch a
 * queue never sends by itself: `idle` offers to send it.
 */
export function queuedHtml (items = [], { held = false, askName = 'Patch', idle = false } = {}) {
  if (!items.length) return '';
  const status = statusLine({ state: held ? 'held' : 'queued', askName });
  const rows = items.map(m => `<div class="msg me queued" data-queued="${esc(m.id)}">
      <div class="bub-wrap"><div class="bub u">${esc(m.text)}</div></div>
      <div class="receipt"><span class="q-status">${esc(status)}</span><button class="q-x" data-do="drop-queued" data-id="${esc(m.id)}" aria-label="Don’t send this" title="Don’t send this">${ICONS.x}</button></div></div>`).join('');
  const n = items.length;
  const note = idle
    ? `<div class="queue-note">${n === 1 ? 'A message is' : `${n} messages are`} waiting to be sent · <button data-do="send-queued">Send ${n === 1 ? 'it' : 'them'}</button></div>`
    : '';
  return `<div class="turn">${rows}${note}</div>`;
}

/* A chat with nothing in it yet: who you are talking to, what to try, and —
   for Patch — Patch himself. */
export function emptyChatHtml (d, { intro = '', starters = [], foot = '' } = {}) {
  const face = d.kind === 'verified'
    ? `<span class="patch-perch" id="patchEmpty" title="Patch — try poking him">${patch('idle', 0, 84)}</span>`
    : avatarHtml(d, 72);
  const remembers = d.memory === 'fresh' ? 'nothing, each message starts fresh'
    : d.memory === 'remembers' ? 'the recent back-and-forths of this chat'
      : d.memory === 'unmeasured' ? 'not measured for this voice yet' : '';
  return `<div class="card-c">${face}<h3>${esc(d.name)}</h3>${factPill(d)}${intro ? `<p>${esc(intro)}</p>` : ''}
    ${remembers ? `<p class="card-rem"><b>Remembers:</b> ${esc(remembers)}</p>` : ''}
    ${starters.length ? `<div class="starters">${starters.map(s => `<button class="starter" data-say="${esc(s)}">${esc(s)}</button>`).join('')}</div>` : ''}
    ${foot ? `<p class="card-foot">${esc(foot)}</p>` : ''}</div>`;
}
