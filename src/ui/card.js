/* card.js — what a Pigeon's page can honestly say about it.
 *
 * A Pigeon's page is where a person learns what a contact is for before
 * messaging it: what it does, what to send, whether it remembers, and what can
 * leave the Mac. A `.pigeon` from Flight School carries a card in its maker's
 * words (`card`: what it does, what to send, examples); where it does, that is
 * what is said. Where it does not, the card here is DERIVED — said only from
 * what Pigeon already knows about the file: its kind, its labels, whether it
 * carries material or a drawing skill. It never invents examples or a pass
 * count, and it says it came without a card.
 *
 * Strings and data only, no DOM, so the test suite can check every claim.
 */

import { isVoice } from './pigeons.js';

/**
 * `d` is the contact as pigeonOf draws it; `persona` is its installed record
 * from personas_list, when there is one.
 */
export function deriveCard (d, persona = null, { turns = 12 } = {}) {
  const imported = d.kind === 'voice' || d.kind === 'job';
  const p = persona || {};
  const send = d.kind === 'verified' ? 'something with a number, a date, a unit or a sum in it'
    : d.kind === 'base' ? 'anything you want written, explained or thought through'
      : d.kind === 'peek' ? 'a picture, with a question about it or nothing at all'
      : p.retrieval ? 'a question about what it carries'
        : p.skill ? 'a description of what to draw'
          : persona && isVoice(persona) ? 'anything, in a conversation'
            : 'one message at a time';
  /* The maker's card (format §2.1), when the file carried one: shown as the
     maker's words, never as something Pigeon checked. Anything malformed on it
     is left out rather than guessed at. */
  const c = p.card && typeof p.card === 'object' && typeof p.card.does === 'string' && p.card.does.trim() ? p.card : null;
  const maker = c ? {
    does: c.does.trim(),
    inputHint: typeof c.input_hint === 'string' && c.input_hint.trim() ? c.input_hint.trim() : null,
    outputNoun: typeof c.output_noun === 'string' && c.output_noun.trim() ? c.output_noun.trim() : null,
    examples: (Array.isArray(c.examples) ? c.examples : []).filter(e => e && typeof e.input === 'string' && typeof e.output === 'string').slice(0, 5),
    check: c.check && Number.isInteger(c.check.passed) && Number.isInteger(c.check.total) && c.check.passed <= c.check.total ? { passed: c.check.passed, total: c.check.total } : null,
    wordsP95: c.input_stats && c.input_stats.words && Number.isFinite(c.input_stats.words.p95) ? c.input_stats.words.p95 : null,
    revision: Number.isInteger(c.revision) && c.revision > 0 ? c.revision : 1,
    /* From its report.json: the engine its score was measured in (D98), and
       how many of its rows another model judged rather than a rule. */
    engine: p.report && typeof p.report.engine === 'string' && p.report.engine.trim() ? p.report.engine.trim() : null,
    judged: p.report && Number.isInteger(p.report.graded_by_model) && p.report.graded_by_model > 0 ? p.report.graded_by_model : 0
  } : null;
  return {
    imported,
    withoutCard: imported && !maker,
    maker,
    does: maker ? maker.does : d.does,
    send: maker && maker.inputHint ? maker.inputHint : send,
    works: Boolean(d.works),
    remembers: d.memory === 'fresh' ? 'Nothing — each message starts fresh'
      : d.kind === 'peek' ? `The words of the last ${turns} back-and-forths — it sees only the picture in your newest message`
      : d.memory === 'remembers' ? `The last ${turns} back-and-forths of a chat`
        : d.memory === 'unmeasured' ? `Not measured for this voice yet — it is sent the last ${turns} back-and-forths` : null,
    answersWith: p.output_type === 'label' && Array.isArray(p.labels) && p.labels.length ? p.labels.slice() : null,
    inside: p.retrieval ? 'The material it was packed with, searched for each question' : null,
    /* The same two answers everywhere a picture comes up (pigeons.js
       pictureLine): the pixels, or the words read off them. */
    pictures: d.sees ? 'It sees the picture itself — what is in it, not only the words on it'
      : 'It gets only the words read off a picture, and you check them before they go',
    leaves: d.kind === 'verified' ? 'Only a look-up you say yes to' : 'Nothing — it can’t use the web, open your files or run programs'
  };
}
