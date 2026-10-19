/* captions-tidy.js — the model's half of a transcript repair, and the audit
 * that can throw it away.
 *
 * Shaped after the OCR tidy in ocr.js, for the same reason it exists: what the
 * model produces here is INPUT, not a reply. It is shown beside the
 * deterministic reading, the person chooses which to keep, and either way it
 * goes through the ordinary router afterwards. No model writes a reply.
 *
 * Three things happen, in order, and the order matters:
 *
 *   1. captions.js does everything provable — timestamps, labels, the cut
 *      sentences, stutters, fillers. The model never sees the raw file.
 *   2. the model is asked for boundaries, capitals and paragraphs only.
 *   3. auditRepair compares the LETTERS. A faithful repair has not changed
 *      one, so the test needs no threshold; a name repair moves a handful and
 *      is reported as such; a rewrite is thrown out.
 *
 * A rejected repair is not an error. The deterministic text is already useful
 * on its own, so the fallback is a good answer rather than a failure.
 */

import { mechanicalClean, auditRepair } from './captions.js';
import { devKeyHeaders } from './llm.js';

/* The instruction the adapter was TRAINED against, so it is not a knob.
 *
 * It is duplicated as TRANSCRIPT_INSTRUCTION in src-tauri/src/task.rs, and the
 * duplication is deliberate: in the app the page must not be able to write the
 * prompt at all, so Rust holds its own copy and the page sends only text. This
 * one is for the dev path, which talks to a bare llama-server and has to build
 * the messages itself. A test asserts the two strings are identical — if they
 * drift, the model is trained for one prompt and asked with another, and the
 * only symptom is that it quietly gets worse.
 */
export const REPAIR_SYSTEM =
  'Repair this transcript. Put the sentence boundaries and capitals where they belong, ' +
  'restore the paragraph breaks, and repair a name the transcriber split. ' +
  'Change nothing else: do not add, remove, reorder or summarise any word, and leave every number exactly as it is. ' +
  'Reply with the repaired transcript and nothing else.';

/* ── reaching a model ────────────────────────────────────────────────────── */

const TASK = 'transcript-repair';
const DEV_BASE = 'http://127.0.0.1:8101';
const ADAPTER = 'transcript-clean';

/**
 * A `complete` for tidyTranscript: `({ text, maxTokens }) => { text, tokens, finishReason }`.
 * In the app it is one command that takes a TASK NAME and the text, and Rust
 * owns the instruction, the adapter and the address. In a browser it is the
 * same request built here against the category server's chat endpoint, which
 * is the only endpoint that honours a per-request adapter on this build.
 * Returns null when neither is reachable, which is a normal state.
 */
export function tidyBridge () {
  return tauriTidy() || devTidy();
}

/* The repair as it grows. Rust emits one `task-piece` event per few
   characters, each naming the piece number the page gave the request, so the
   pieces of one transcript, asked together, each reach their own listener.
   One subscription for the page's life; a piece nobody is waiting for is
   dropped. */
const pieceListeners = new Map();
/* Random rather than counted: every window hears every window's events. */
const pieceNumber = () => Math.floor(Math.random() * 2 ** 52) + 1;
let subscribed = null;
function hearPieces () {
  if (subscribed) return subscribed;
  const listen = globalThis.__TAURI__?.event?.listen;
  if (typeof listen !== 'function') return Promise.resolve();
  /* Awaited before the ask goes, so the first piece finds its listener. Each
     event carries the whole answer so far, so one that slipped by anyway
     costs nothing. */
  subscribed = listen('task-piece', (e) => {
    const f = pieceListeners.get(e.payload && e.payload.piece);
    if (f) f(e.payload);
  }).catch(() => { subscribed = null; });
  return subscribed;
}

function tauriTidy () {
  const call = globalThis.__TAURI__?.core?.invoke;
  if (!call) return null;
  const complete = async ({ text, maxTokens = null, onPiece = null }) => {
    let piece = null;
    if (onPiece) {
      await hearPieces();
      piece = pieceNumber();
      let sofar = '';
      pieceListeners.set(piece, (p) => { sofar = typeof p.sofar === 'string' ? p.sofar : sofar + String(p.text || ''); onPiece(sofar); });
    }
    try {
      const out = await call('task_complete', { req: { task: TASK, text, max_tokens: maxTokens, ...(piece ? { piece } : {}) } });
      return { text: out.text, ms: out.ms, tokens: out.tokens, finishReason: out.finish_reason, adapter: out.adapter };
    } finally {
      if (piece) pieceListeners.delete(piece);
    }
  };
  complete.transport = 'rust command';
  complete.ready = async () => {
    const tasks = await call('tasks_list');
    return Boolean((tasks || []).find(t => t.name === TASK)?.ready);
  };
  return complete;
}

function devTidy () {
  if (typeof fetch !== 'function') return null;
  let loaded = null;
  const stem = (p) => String(p || '').split('/').pop().replace(/\.lora\.gguf$/, '');
  const adapters = async () => {
    if (loaded) return loaded;
    const r = await fetch(`${DEV_BASE}/lora-adapters`, { headers: await devKeyHeaders() });
    if (!r.ok) throw new Error(`the model did not list its adapters (${r.status})`);
    loaded = (await r.json()).map((a, i) => ({ id: typeof a.id === 'number' ? a.id : i, name: stem(a.path) }));
    return loaded;
  };

  const complete = async ({ text, maxTokens = null }) => {
    const all = await adapters();
    if (!all.some(a => a.name === ADAPTER)) {
      throw new Error(`the "${ADAPTER}" adapter is not loaded — it needs a restart before it can be used`);
    }
    const started = Date.now();
    const res = await fetch(`${DEV_BASE}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await devKeyHeaders()) },
      body: JSON.stringify({
        messages: [{ role: 'system', content: REPAIR_SYSTEM }, { role: 'user', content: text }],
        max_tokens: Math.min(2048, maxTokens ?? 1024),
        /* Greedy and seeded, matching Rust exactly: a repair must come back
           the same way twice or the audit is measuring the sampler. */
        temperature: 0, top_p: 1, seed: 11, stream: false,
        lora: all.map(a => ({ id: a.id, scale: a.name === ADAPTER ? 1 : 0 }))
      })
    });
    const out = await res.json();
    if (out.error) throw new Error(out.error.message || 'the model refused');
    const choice = (out.choices || [])[0] || {};
    return {
      text: String((choice.message && choice.message.content) || '').trim(),
      ms: Date.now() - started,
      tokens: (out.usage && out.usage.completion_tokens) || 0,
      finishReason: choice.finish_reason || null,
      adapter: ADAPTER
    };
  };
  complete.transport = 'direct fetch';
  complete.ready = async () => {
    try { return (await adapters()).some(a => a.name === ADAPTER); } catch { return false; }
  };
  return complete;
}

/* The model is asked to reproduce its input with different punctuation, so the
   reply is the same length as what went in. A little headroom lets it finish;
   more than that and a runaway costs a minute for nothing. */
export function repairBudget (text) {
  return Math.min(2048, Math.max(64, Math.ceil(String(text).length / 4 * 1.6) + 64));
}

/* Long transcripts do not fit. 8192 of context against a reply the same size
   as the prompt means the practical ceiling is well under half of it, so the
   text is cut into pieces on the blank lines the deterministic pass has
   already put in. Cutting mid-sentence would ask the model to punctuate a
   fragment whose ending it cannot see, which is the one cut that changes the
   answer. */
export const CHUNK_CHARS = 3000;

export function chunk (text, limit = CHUNK_CHARS) {
  const blocks = String(text ?? '').split(/\n\s*\n/).filter(b => b.trim());
  const out = [];
  let cur = '';
  for (const b of blocks) {
    if (cur && cur.length + b.length + 2 > limit) { out.push(cur); cur = b; }
    else cur = cur ? `${cur}\n\n${b}` : b;
  }
  if (cur) out.push(cur);
  /* A single block longer than the limit has no blank line to cut on. Fall
     back to sentence ends, and only then to a hard cut, saying which. */
  return out.flatMap(piece => piece.length <= limit * 1.5 ? [piece] : splitLong(piece, limit));
}

function splitLong (piece, limit) {
  const sentences = piece.split(/(?<=[.!?])\s+/);
  const out = [];
  let cur = '';
  for (const s of sentences) {
    if (cur && cur.length + s.length + 1 > limit) { out.push(cur); cur = s; }
    else cur = cur ? `${cur} ${s}` : s;
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * @param {object} opts
 * @param {string} opts.raw        the transcript exactly as pasted
 * @param {Function} opts.complete ({ text, maxTokens, onPiece }) => { text, tokens, finishReason }
 * @param {Function} [opts.onStage] (stage, done, of, live): `live` is the repair so
 *                                  far, the pieces in order, for a page that shows it growing
 */
export async function tidyTranscript ({ raw, complete, onStage = null }) {
  const cleaned = mechanicalClean(raw);
  const base = {
    raw: String(raw ?? ''),
    mechanical: cleaned.text,
    stats: cleaned.stats,
    format: cleaned.format,
    speakers: cleaned.speakers,
    repaired: null,
    used: 'mechanical',
    rejected: null,
    edits: 0,
    /* Every word the repair added or dropped, across all passages. A repair
       that changed a word and did not say so is the failure this whole audit
       exists to prevent, so the UI must render this whenever it is non-empty. */
    changed: { added: [], removed: [] }
  };

  if (!cleaned.text.trim()) return { ...base, rejected: 'there was nothing to read' };
  if (!complete) return { ...base, rejected: 'no model is awake to repunctuate it' };

  /* With more than one speaker, the model is asked for each turn on its own,
     WITHOUT its label, and the label is put back afterwards. The tidier was
     trained on one speaker's prose with no labels in it, and given
     "Speaker 1: …" it drops the label: the letters audit then sees the 1 and 2
     go missing and throws the whole repair out (click-through 6, 2026-10-12).
     A label is the transcript's own data, not the model's to keep or lose. */
  const units = cleaned.speakers.length > 1
    ? cleaned.blocks.flatMap(b => chunk(b.text).map((text, k) => ({ label: k === 0 ? b.speaker : null, text })))
    : chunk(cleaned.text).map(text => ({ label: null, text }));
  const pieces = units.map(u => u.text);
  const labelled = (i, text) => (units[i].label ? `${units[i].label}: ${text}` : text);
  const out = [];
  const rejects = [];
  /* Every piece is asked AT ONCE, not one after another. The engine runs up to
     four requests of one Pigeon in a single decode per step, reading the
     weights once for all of them (pigeon-engine lanes.rs, SEQS), and queues the
     rest, so five pieces cost little more than one where they used to cost
     five. The replies are audited below in the pieces' own order, so the
     output is the same as before; only the waiting changed. A piece that
     throws is reported as the whole repair's failure, as it was, by the first
     piece in order that did. */
  if (onStage) onStage('repairing', 0, pieces.length, '');
  let done = 0;
  /* What each piece has said so far, so the page can show the repair growing
     in the pieces' own order whatever order they answer in. */
  const partial = pieces.map(() => '');
  const live = () => partial.map((text, i) => (text ? labelled(i, text) : '')).filter(Boolean).join('\n\n');
  const replies = await Promise.all(pieces.map(async (piece, i) => {
    /* TEXT, not messages. In the app the instruction is Rust's and the page
       could not supply one if it wanted to; passing messages here would put
       the prompt back in the page's hands for the dev path only, and the two
       would drift. */
    try {
      const onPiece = onStage ? (sofar) => { partial[i] = sofar; onStage('repairing', done, pieces.length, live()); } : null;
      const reply = await complete({ text: piece, maxTokens: repairBudget(piece), ...(onPiece ? { onPiece } : {}) });
      done += 1;
      partial[i] = String((reply && reply.text) || '').trim();
      if (onStage) onStage('repairing', done, pieces.length, live());
      return { reply };
    } catch (e) {
      return { error: String((e && e.message) || e) };
    }
  }));
  const failed = replies.find(r => r.error !== undefined);
  if (failed) return { ...base, rejected: failed.error };
  for (let i = 0; i < pieces.length; i++) {
    const { reply } = replies[i];
    const text = String((reply && reply.text) || '').trim();
    const truncated = Boolean(reply && (reply.finishReason === 'length'
      || (typeof reply.tokens === 'number' && reply.tokens >= repairBudget(pieces[i]))));

    /* Audited piece by piece, and a failed piece falls back to ITS OWN
       deterministic text rather than taking the others down with it. The code
       used to return here, which threw away four good chunks because the fifth
       was bad — the comment said one thing and the code did another, and a
       real Zoom transcript found it. */
    const verdict = auditRepair(pieces[i], text, { truncated });
    if (verdict && verdict.reason) {
      rejects.push(verdict.reason);
      out.push(labelled(i, pieces[i]));
    } else {
      base.edits += (verdict && verdict.edits) || 0;
      if (verdict && verdict.changed) {
        base.changed.added.push(...verdict.changed.added);
        base.changed.removed.push(...verdict.changed.removed);
      }
      out.push(labelled(i, text));
    }
  }

  const repaired = out.join('\n\n');
  if (rejects.length === pieces.length) {
    /* Every piece failed, so nothing was repaired and saying otherwise would
       be a lie. The first reason stands for all of them. */
    return { ...base, repaired: null, used: 'mechanical', rejected: rejects[0], pieces: pieces.length, rejectedPieces: rejects.length };
  }
  return {
    ...base,
    repaired,
    used: 'repaired',
    /* Not an error, but not silence either: a partly repaired transcript says
       how much of it the audit refused. */
    rejected: rejects.length ? `${rejects.length} of ${pieces.length} passages were left as they were: ${rejects[0]}` : null,
    pieces: pieces.length,
    rejectedPieces: rejects.length
  };
}
