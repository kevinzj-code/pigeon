/* ocr.js — reading an image without a vision model.
 *
 * Two halves, and the seam between them is the point.
 *
 *   The READING. A classical OCR engine (the Mac's own Vision recogniser, or a
 *   Tesseract a developer names) turns the pixels into text.
 *   In the app that is a Rust command that takes the image's BYTES and nothing
 *   else — no path, no engine name, no language — the way `web_search` takes a
 *   query and never a host. Opened in a browser the dev server does the same
 *   job on a route, so the chip can be tried without a window.
 *
 *   The TIDY. OCR output is full of the damage a camera does: a line broken
 *   inside a sentence, "Tota|" for "Total", a space before a comma. A local
 *   model is asked to repair exactly that and nothing else, and its answer is
 *   then AUDITED with the same number extractor §8 uses on replies: a number in
 *   the tidied text that Tesseract never read is a number the model made up,
 *   and the tidy is thrown away for the raw reading. "1O apples" tidied to
 *   "10 apples" is discarded — 10 is not a number the engine read — which is
 *   the safe direction for this check to be wrong in.
 *
 * Nothing here is in the reply path. What this produces is INPUT: it is shown
 * beside the question, can be corrected, and goes through the same router and
 * planner as anything typed. focus.js's argument — that a model must not write
 * text the user takes as an answer — is untouched. */

import { numbersIn } from './fabrication.js';
import { reasonFrom } from './search.js';

/* ── the reading ─────────────────────────────────────────────────────────── */

/** @typedef {{text: string, ms: number, engine: string}} OcrReading */

export function tauriOcr () {
  const invoke = globalThis.__TAURI__?.core?.invoke;
  if (!invoke) return null;
  /* The bytes go as the raw IPC body — a Uint8Array handed straight to invoke,
     not wrapped in an object. That is the one payload shape that carries
     nothing about where the image came from. */
  const ocr = async (bytes) => {
    let out;
    try {
      out = await invoke('ocr_image', bytes);
    } catch (e) {
      throw new Error(reasonFrom(e));
    }
    return { text: String(out.text ?? ''), ms: out.ms ?? 0, engine: out.engine || 'the text reader' };
  };
  ocr.transport = 'rust command';
  ocr.status = async () => invoke('ocr_status');
  /* Actually ask. A binary that predates the command rejects the call; one with
     the command but no engine installed says so. Both are "no". */
  ocr.health = async () => {
    try { return Boolean((await ocr.status()).available); } catch { return false; }
  };
  return ocr;
}

/* The dev-server route. `scripts/serve.mjs` runs the same binary with the same
   arguments, so what a browser sees and what the app sees is the same reading.
   Not shipped: in the Tauri window the CSP blocks this and tauriOcr() is used. */
export function proxyOcr ({ base = '' } = {}) {
  const ocr = async (bytes) => {
    const res = await fetch(`${base}/__ocr`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: bytes,
      signal: AbortSignal.timeout(40000)
    });
    if (!res.ok) {
      const why = await res.json().then(b => b && b.error).catch(() => null);
      throw new Error(why || `ocr failed: HTTP ${res.status}`);
    }
    const out = await res.json();
    return { text: String(out.text ?? ''), ms: out.ms ?? 0, engine: out.engine || 'the text reader' };
  };
  ocr.transport = 'dev-server proxy';
  ocr.status = async () => {
    const r = await fetch(`${base}/__ocr?probe=1`, { signal: AbortSignal.timeout(3000) });
    return r.json();
  };
  ocr.health = async () => {
    try { return Boolean((await ocr.status()).available); } catch { return false; }
  };
  return ocr;
}

/* Returns null when there is no engine, which is a normal state: the image
   button is simply not drawn and a paste says why. */
export async function detectOcr ({ base = '' } = {}) {
  for (const candidate of [tauriOcr(), proxyOcr({ base })]) {
    if (candidate && await candidate.health()) return candidate;
  }
  return null;
}

/* ── the tidy ────────────────────────────────────────────────────────────── */

export const CLEANUP_SYSTEM =
`You are given text that an OCR engine read from an image. Repair ONLY the damage OCR does:
1. Join a line that was broken in the middle of a sentence; keep a line break where the image had one (a list, a receipt, a heading).
2. Fix spacing: a space before a comma or full stop, two words run together, one word split in two.
3. Fix a letter the engine misread inside a WORD when the word is obvious: "Tota|" is "Total", "rn" read as "m".
4. Leave every number exactly as it is, even one that looks wrong. Never turn a letter into a digit or a digit into a letter.
5. Add nothing, remove nothing, reorder nothing, summarise nothing.
Reply with the repaired text and nothing else.`;

export const CLEANUP_SHOTS = [
  {
    role: 'user',
    content: 'The meeting has been moved to\nThursday , and the room is the\nsame as last time.'
  },
  {
    role: 'assistant',
    content: 'The meeting has been moved to Thursday, and the room is the same as last time.'
  },
  {
    role: 'user',
    content: 'Coffee 4.50\nBage1 3.25\nTota| 7.75'
  },
  {
    role: 'assistant',
    content: 'Coffee 4.50\nBage1 3.25\nTotal 7.75'
  },
  {
    role: 'user',
    content: 'Doors open at l0am and the talk starts at 11.'
  },
  {
    role: 'assistant',
    content: 'Doors open at l0am and the talk starts at 11.'
  }
];

/* Budget: the repair is the same length as the reading, so its budget is the
   reading's token count with headroom. Capped so a pasted page cannot become a
   long generation.

   "Four characters a token" was the old estimate, and it is true of prose and
   false of what people photograph. The tokenizer reads every digit as a token
   of its own, and most punctuation, symbols and line breaks too, so a 251-
   character receipt that needed about 140 tokens was given 126, and the
   correct repair was cut off and refused ("ran out of room"). Measured on the
   OCR bench (2026-10-13): 34 of 400 repairs on Qwen3.5 and 38 on Qwen3-VL,
   every one a receipt, timetable, menu or form. So letters count three to a
   token, and each digit, symbol, punctuation mark and line break as one. */
export function ocrTokenEstimate (text) {
  const s = String(text ?? '');
  const letters = (s.match(/[A-Za-z]/g) || []).length;
  const spaces = (s.match(/[ \t]/g) || []).length;
  const rest = s.length - letters - spaces;
  return Math.ceil(letters / 3) + rest;
}

export function cleanupBudget (raw) {
  return Math.min(1024, Math.max(64, Math.ceil(ocrTokenEstimate(raw) * 1.25) + 32));
}

const THINK = /<think>[\s\S]*?<\/think>/g;
/* A thinking model that spends its whole budget thinking returns an
   unterminated block and nothing else. That must audit as EMPTY, not be sent
   to the router as text. */
const THINK_OPEN = /<think>[\s\S]*$/;

/* Not every model wraps its reasoning in a tag. Qwen3.5 hands back a plain
   "Thinking Process:" heading and then works through the rules out loud, which
   sailed straight past a tag-only strip and reached the composer as if it were
   the reading. So a preamble is recognised by its OPENING and cut at the first
   blank line after it: what follows is either the repair or nothing, and
   nothing is a state the audit already handles.
   Only ever anchored at the start — a receipt that happens to contain the word
   "Thinking" halfway down is not a preamble. */
const PREAMBLE = /^\s*(?:\*{0,2}|#{1,6}\s*)(?:thinking(?:\s+process)?|thought(?:\s+process)?|reasoning|analysis|let me think|okay,?\s+let'?s?\b[^\n]*|sure[!,][^\n]*|here(?:'s| is)\s+the\s+(?:repaired|corrected|cleaned)[^\n]*)\*{0,2}\s*:?[^\n]*\n/i;

export function stripThinking (text) {
  let out = String(text ?? '').replace(THINK, '').replace(THINK_OPEN, '').trim();
  /* One pass, not a loop: a second preamble after the first is a model that
     never got to the answer, and the audit should see that rather than have it
     tidied away here. */
  const m = out.match(PREAMBLE);
  if (m) {
    const rest = out.slice(m[0].length);
    /* A numbered or bulleted restatement of the rules follows the heading with
       no blank line, so cut to the first blank line when there is one. */
    const body = rest.includes('\n\n') ? rest.slice(rest.indexOf('\n\n') + 2) : rest;
    out = body.trim();
  }
  return out;
}

/* Phrases from CLEANUP_SYSTEM distinctive enough that seeing them come BACK
   means the model restated its instructions instead of doing them. Matched
   only when the reading itself does not contain them, so a document that is
   genuinely about repairing OCR is still tidied. */
const ECHOED = [
  'repair only the damage',
  'reply with the repaired text',
  'join a line that was broken',
  'two words run together',
  'one word split in two',
  'add nothing, remove nothing',
  'leave every number exactly',
  'never turn a letter into a digit',
  'an ocr engine read from an image'
];

/**
 * Why a tidy is not allowed, or null when it is.
 * The checks are ordered so the first reason is the most specific one.
 */
export function auditCleanup (raw, cleaned, { truncated = false } = {}) {
  const r = String(raw ?? '');
  const c = String(cleaned ?? '');
  if (!c.trim()) return 'the model returned nothing';

  /* A repair that ran out of room is not a repair: the tail is missing and
     there is no way to tell how much. This is the check that catches a model
     which talked its way through the whole budget — the length ratio below
     cannot, because the budget is what stops it growing in the first place. */
  if (truncated) return 'ran out of room before it finished';

  const lower = c.toLowerCase();
  const rawLower = r.toLowerCase();
  const echoed = ECHOED.filter(p => lower.includes(p) && !rawLower.includes(p));
  if (echoed.length) return 'handed back the instructions instead of the reading';

  const allowed = numbersIn(r);
  const invented = [...numbersIn(c)].filter(n => !allowed.has(n));
  if (invented.length) {
    const list = invented.slice(0, 3).map(n => String(n)).join(', ');
    return `introduced the number${invented.length > 1 ? 's' : ''} ${list}`;
  }

  /* Shrinking is the half of this that does the work. Growing is all but
     unreachable — cleanupBudget caps generation at 1.5x the reading in TOKENS,
     so the model cannot emit 1.5x the reading in characters — which is why the
     truncation check above exists rather than this one being widened. */
  const ratio = c.length / Math.max(1, r.length);
  if (ratio > 1.5 || ratio < 0.5) {
    return `came back ${ratio.toFixed(1)}× the length of what was read`;
  }
  return null;
}

/**
 * @param {object} opts
 * @param {string} opts.raw          what the engine read
 * @param {Function|null} opts.complete  the planner's `complete`, or null
 * @param {string|null} [opts.model]     its name, for the record
 * @returns {Promise<{used:'cleaned'|'raw', cleaned:string|null, reason:string|null,
 *                    ms:number, model:string|null, error?:string}>}
 */
export async function cleanupOcr ({ raw, complete, model = null }) {
  const t0 = Date.now();
  const rawText = String(raw ?? '');
  if (!complete) return { used: 'raw', cleaned: null, reason: 'no model', ms: 0, model: null };

  const budget = cleanupBudget(rawText);
  let out;
  try {
    out = await complete({
      messages: [
        { role: 'system', content: CLEANUP_SYSTEM },
        ...CLEANUP_SHOTS,
        { role: 'user', content: rawText }
      ],
      maxTokens: budget,
      temperature: 0,
      pigeon: { id: 'ocr-tidy', input: rawText }
    });
  } catch (e) {
    /* No model reachable, or it failed mid-call. The raw reading is a perfectly
       good input; this must never be the thing that loses the image. */
    return { used: 'raw', cleaned: null, reason: 'no model', ms: Date.now() - t0, model, error: reasonFrom(e) };
  }

  const cleaned = stripThinking(out && out.text);
  /* The server reports how many tokens it produced; spending the whole budget
     means it was cut off mid-sentence. Nothing else here can tell. */
  const truncated = Boolean(out && typeof out.tokens === 'number' && out.tokens >= budget);
  const reason = auditCleanup(rawText, cleaned, { truncated });
  return {
    used: reason ? 'raw' : 'cleaned',
    /* Kept even when discarded, so the trace can show what was thrown out. */
    cleaned: cleaned || null,
    reason,
    ms: Date.now() - t0,
    model
  };
}

/* ── the attachment, as the message sees it ──────────────────────────────── */

/* The category adapter and the planner run with an 8k context; a whole page of
   OCR text would crowd out the cards. This bounds what goes to the router; the
   full reading stays on the turn for the trace. */
export const ATTACH_CAP = 4000;

export function capAttached (text) {
  const s = String(text ?? '');
  if (s.length <= ATTACH_CAP) return { text: s, truncated: false };
  const head = s.slice(0, ATTACH_CAP);
  const nl = head.lastIndexOf('\n');
  const cut = nl > ATTACH_CAP / 2 ? head.slice(0, nl) : head;
  return { text: `${cut.trimEnd()}…`, truncated: true };
}

/** The message as the router and planner see it: the question, then the text. */
export function composeMessage (typed, attached) {
  const q = String(typed ?? '').trim();
  const a = String(attached ?? '').trim();
  if (q && a) return `${q}\n\n${a}`;
  return q || a;
}

export function wordCount (s) {
  return String(s ?? '').split(/\s+/).filter(Boolean).length;
}

/**
 * One line naming what happened to an image, for the bubble, the clipboard
 * and the rail. Every claim in it is on the record it describes.
 * @param {{name?:string, text?:string, engine?:string, model?:string|null,
 *          used?:string, reason?:string|null, edited?:boolean}} image
 */
export function describeAttachment (image) {
  if (!image) return '';
  const parts = [
    image.name || 'image',
    `${wordCount(image.text)} words`,
    `read by ${image.engine || 'the text reader'}`
  ];
  let s = parts.join(' · ');
  if (image.used === 'cleaned') s += `, tidied by ${image.model || 'the model'}`;
  else s += ' · raw' + (image.reason ? ` — ${image.reason}` : '');
  if (image.edited) s += ' · edited before sending';
  return s;
}
