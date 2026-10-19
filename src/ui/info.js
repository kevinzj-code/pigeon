/* info.js — Message info: how one reply was made, in plain words.
 *
 * Opened by clicking the line under a reply. It is where the honesty data went
 * when it left the thread: the plan, the Patch-and-Robot exchange, the router's
 * scores and the raw results are all still one click away, under "Details for
 * developers", while the top of the panel says what happened the way a person
 * would want it said — second person, no scores, no function names.
 *
 * Strings only, no DOM, so the test suite can draw it.
 */

import { esc, ICONS, hm, dayName } from './html.js';
import { markFor, markLabel, webSource, tookAs, humanise, MARKS } from './marks.js';
import { foundIn, foundLabel } from './cite.js';

const span = (ms) => (ms < 1000 ? `${Math.max(0, Math.round(ms))} ms` : `${(ms / 1000).toFixed(1)} s`);

function hostOf (u) {
  try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return 'the web'; }
}

/* How this was made, as sentences. Each is already escaped HTML. */
function howItWasMade (turn, { name, kind }) {
  const mark = markFor(turn);
  const n = esc(name);
  if (turn.interrupted) return ['Pigeon closed before this was answered, so nothing ran.'];
  if (turn.lane === 'B') {
    if (!turn.reply) return [`${n} didn’t reply: ${esc(String(turn.error || 'nothing came back').replace(/[.\s]+$/, ''))}.`, 'Nothing was shown, so nothing needed checking.'];
    if (turn.handoff) {
      const nums = (turn.handoff.numbers || []).map(x => `<b>${esc(x)}</b>`).join(', ');
      return [`${n} wrote a reply with ${(turn.handoff.numbers || []).length === 1 ? 'a figure' : 'figures'} you never gave it${nums ? ` (${nums})` : ''}. Pigeon dropped it rather than show a guess.`,
        'Working a number out is Patch’s job. Put the amounts in your message and a written reply can use them.'];
    }
    if (turn.noMaterial) return [`Pigeon searched ${n}’s material before asking any model. Nothing matched, so the model was not called.`];
    if (turn.rendered || turn.renderError) {
      return [`${n} wrote a recipe, and Pigeon ${turn.rendered ? 'drew it from the parts its file carries' : `could not draw it: ${esc(turn.renderError)}`}.`, 'The picture is Pigeon’s drawing; the choice of parts is the model’s, and nothing checked that it fits what you asked.'];
    }
    if (kind === 'job') {
      const sections = (turn.sections || []).map(s => `<b>§${Number(s.ordinal)} ${esc(s.title)}</b>`);
      const found = foundIn(turn);
      return [sections.length
        ? `Pigeon found ${sections.join(', ')} and gave ${n} only that, with your message exactly as you typed it.`
        : `${n} got your message exactly as you typed it, and nothing else — no earlier messages.`,
      found
        ? `Click the underlined answer to see <b>${esc(foundLabel(found))}</b> with the sentence it most likely came from marked. ${n} wrote the answer in its own words, and nothing checked it against that sentence.`
        : 'Nothing checked what it wrote.'];
    }
    if (kind === 'peek') {
      return [`${n} wrote this with the picture model on your Mac, as it comes: Pigeon gave it no instructions of its own. It read the recent messages in this chat${turn.image ? ' and saw the picture you sent with this one' : ''}.`,
        '<b>Nothing checked it</b> — a count, a price or any other number in it is the model’s reading, not a sum.'];
    }
    return [`${n} wrote this with a small model on your Mac. It read the recent messages in this chat.`, '<b>Nothing checked it.</b>'];
  }
  if (turn.ask) return ['Patch had a skill ready but not every value it needs, so he asked rather than guessing.'];
  if (turn.invalid) return ['The plan didn’t pass validation, so nothing ran.'];
  if (mark === MARKS.COULDNT) {
    return (turn.results || []).length
      ? ['A step failed, so there is no answer to show. The failure is in the details below.']
      : ['No skill fit well enough to run, so nothing ran. Answering anyway would have meant a figure code didn’t make.'];
  }
  const took = tookAs(turn);
  const skills = [...new Set((turn.results || []).map(r => humanise(r.skill)))];
  const read = took && took.values.length ? `I read ${took.values.map(v => `<b>${esc(v)}</b>`).join(', ')} from your message and` : 'I';
  const out = [`${read} ran <b>${esc(skills.join(', then '))}</b>. Every figure in the answer came from ${skills.length > 1 ? 'those results' : 'its result'}.`];
  const bundled = (turn.results || []).map(r => r.provenance || {}).find(p => p.kind === 'bundled');
  if (bundled) out.push(`Some of it came from a table bundled with Pigeon${bundled.dataAsOf ? `, dated ${esc(bundled.dataAsOf)}` : ''}.`);
  if (mark === MARKS.LOOKED) {
    const web = (turn.results || []).map(r => r.provenance || {}).find(p => p.kind === 'web');
    out.push(`Your question went to ${esc(hostOf(web && web.source))} after you said yes. Words quoted from ${esc(webSource(turn) || 'the web')} were not worked out by code.`);
  } else {
    out.push('<b>Nothing left this Mac.</b>');
  }
  return out;
}

/**
 * The panel. `planHtml` is the plan panel app.js already draws — the chat flow
 * and the raw plan — moved here unchanged and folded away.
 */
export function messageInfoHtml (turn, { name = 'Pigeon', kind = '', planHtml = '', now = Date.now() } = {}) {
  const mark = markFor(turn);
  const title = turn.ask ? 'Patch asked a question' : markLabel(mark, { name, source: webSource(turn), cutShort: turn.finishReason === 'length', found: foundIn(turn) });
  const day = turn.at && dayName(turn.at, now) !== 'Today' ? `${dayName(turn.at, now)} ` : '';
  const times = [
    turn.at ? `Sent ${day}${hm(turn.at)}` : '',
    turn.repliedAt ? `answered ${hm(turn.repliedAt)}${turn.at ? ` (${span(turn.repliedAt - turn.at)})` : ''}` : ''
  ].filter(Boolean).join(' · ');
  return `<button class="head-btn sm info-x" data-do="close-info" aria-label="Close message info">${ICONS.x}</button>
    <div class="mi">
      <div class="mi-eyebrow">Message info</div>
      <h3>${esc(title)}</h3>
      ${times ? `<p class="mi-ts">${esc(times)}</p>` : ''}
      <div class="mi-eyebrow">How this was made</div>
      <div class="mi-how">${howItWasMade(turn, { name, kind }).map(s => `<p>${s}</p>`).join('')}</div>
      ${planHtml ? `<details class="mi-dev"><summary>Details for developers</summary>${planHtml}</details>` : ''}
    </div>`;
}
