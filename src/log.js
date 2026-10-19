/* log.js — what the page tells the log file (src-tauri/src/log.rs).
 *
 * Rust owns the file; the page reports through one command, `log_event`, and
 * never waits for it. Rust cuts every text to 80 characters (the plan alone is
 * kept whole), drops pictures and leaves out ~/.airoplane-mode, so a field here
 * can be passed as it is. The cut is made here as well, so a summary read in a
 * test is what the file will hold.
 *
 * One line per landed turn, in every lane: which Pigeon, the router's category
 * and confidence, the shortlist, the asks check, the plan, each skill, what the
 * audit dropped or asked for, timing per stage. Tokens per model call are
 * Rust's own lines (`engine ask …`), written as each call answers.
 */

export const TEXT = 80;

/** The first 80 characters, with an ellipsis when there were more. */
export function cut (s, n = TEXT) {
  if (s == null) return null;
  const chars = [...String(s)];
  return chars.length > n ? `${chars.slice(0, n).join('')}…` : chars.join('');
}

/** The asks check's verdict on a turn: "no" when it dropped the plan, "yes"
 *  when it ran and let the plan stand, null when it never ran. */
export function asksVerdict (turn) {
  if (turn.asked && turn.asked.asks === false) return 'no';
  return turn.stages && turn.stages.asks != null ? 'yes' : null;
}

/** One landed turn, as the log keeps it. `receipt` is the line under the
 *  answer and `reply` the answer's text, both worked out by the caller. */
export function turnSummary (turn, { pigeon = 'patch', receipt = '', reply = '' } = {}) {
  const r = turn.routing || {};
  const results = turn.results || [];
  const dropped = [...new Set(results.flatMap(x => ((x.error && x.error.dropped) || []).map(d => d.field))
    .concat(((turn.ask && turn.ask.dropped) || []).map(d => d.field)))];
  const out = {
    pigeon,
    lane: turn.lane || 'A',
    mode: turn.mode || null,
    message: cut(turn.message),
    receipt: receipt || null,
    ms: turn.ms ?? null,
    stages: turn.stages || null
  };
  if (turn.routing) {
    out.router = {
      category: r.category ?? null,
      confidence: typeof r.confidence === 'number' ? Math.round(r.confidence * 1000) / 1000 : null,
      ...(r.declinedBy ? { declinedBy: r.declinedBy } : {})
    };
    out.shortlist = (r.forPlanner || []).length;
  }
  const asks = asksVerdict(turn);
  if (asks) out.asks = asks;
  if (turn.verified) out.sibling = { chosen: turn.verified.chosen ?? null, draft: turn.verified.draft ?? null };
  if (turn.plan) out.plan = turn.plan;
  if (results.length) {
    out.skills = results.map(x => ({
      skill: x.skill, ok: Boolean(x.ok), ms: x.ms ?? null,
      ...(x.ok ? {} : { error: x.error ? { code: x.error.code || null, message: cut(x.error.message) } : null })
    }));
  }
  if (dropped.length) out.audit = { dropped };
  if (turn.ask) out.asked = { skill: turn.ask.skill || null, field: turn.ask.field || null, why: cut(turn.ask.why) };
  if (turn.consent) out.consent = { skill: turn.consent.skill || null };
  if (turn.invalid) out.invalid = turn.invalid.map(e => cut(e.message));
  if (turn.interrupted || turn.error) out.error = cut(typeof turn.error === 'string' ? turn.error : (turn.error && turn.error.message) || 'interrupted');
  if (reply) out.reply = cut(reply);
  return out;
}

const invoker = () => globalThis.__TAURI__?.core?.invoke;

/** Sends one event. Never throws and never waits: a log that cannot be
 *  written must not be the thing that breaks a turn. */
export function logEvent (kind, fields = {}) {
  const invoke = invoker();
  if (!invoke) return;
  try { Promise.resolve(invoke('log_event', { kind, fields })).catch(() => {}); } catch { /* nothing to do */ }
}

export function logTurn (turn, opts) {
  try { logEvent('ask', turnSummary(turn, opts)); } catch { /* a summary that fails is skipped */ }
}

/** A refusal or warning the person was shown, with its code. */
export function logShown (kind, { code = null, sentence = '', where = '' } = {}) {
  logEvent(kind === 'refusal' ? 'refusal' : kind === 'notice' ? 'notice' : 'warning', { code, sentence: cut(sentence, 300), where });
}
