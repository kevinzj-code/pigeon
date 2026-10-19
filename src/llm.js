/* llm.js — the transport to a local llama.cpp server, and nothing more.
 *
 * This is the ONLY file in the project that opens a socket. Everything above
 * it — registry, router, executor, skills — is pure computation, and stays
 * that way: the planner receives a `complete` function and never learns where
 * the tokens came from. Swap this for WebLLM, MediaPipe or mlx-lm and the
 * planner is unchanged.
 *
 * Two llama.cpp endpoints are used together, deliberately:
 *   /apply-template  turns messages into a prompt using the MODEL'S OWN chat
 *                    template, so we never hand-roll <|im_start|> markers and
 *                    silently mis-format a model we didn't expect.
 *   /completion      generates, with a GBNF `grammar` — the only endpoint that
 *                    accepts one. §3.2 calls for "constrained decoding to the
 *                    plan grammar"; this is where that happens. */

const DEFAULT_BASE = 'http://127.0.0.1:8099';

/* The key the model servers require (engine.rs writes it; `scripts/models.mjs`
   hands it to the servers it starts). The direct-fetch route below is the dev
   path — a browser, or a bench in Node — and it needs the key too. In Node it
   is read from the same file the shell writes; in a browser it is asked of
   the static server (`/__key`, loopback only). In Node it is PIGEON_API_KEY
   in the environment, which `scripts/lib/apikey.mjs` sets from the file when
   a script imports it — this file cannot read a file: it ships in the sealed
   pack, which may import nothing it does not carry. Asked once. Sent as
   `X-Api-Key`: a wildcard CORS allow-list covers a custom header and not
   `Authorization`. Missing, the request goes without it, and a keyless server
   — an older script's — still answers. */
let devKeyPromise = null;
export function devKeyHeaders () {
  if (devKeyPromise) return devKeyPromise;
  devKeyPromise = (async () => {
    try {
      const env = globalThis.process?.env?.PIGEON_API_KEY;
      if (env) return /^[0-9a-f]{64}$/.test(env) ? { 'x-api-key': env } : {};
      if (typeof fetch === 'function' && globalThis.location) {
        const r = await fetch('/__key', { signal: AbortSignal.timeout(2000) });
        const key = r.ok ? (await r.json()).key : null;
        return key ? { 'x-api-key': key } : {};
      }
    } catch {}
    return {};
  })();
  return devKeyPromise;
}

/* Inside the Tauri window the page has no network permission at all — the CSP's
   connect-src admits nothing, deliberately. The model is reached through the
   `llm_complete` command instead, which builds the address in Rust from a
   loopback constant. Same interface, so the planner cannot tell the difference
   and nothing above this file changes. */
/* An answer as it is written. Rust emits one `llm-piece` event per few
   characters, each carrying the number this page gave the ask, so the asks
   in flight (two windows, several a turn) each reach their own listener. One
   subscription for the page's life; a piece nobody waits for is dropped.
   The number is random rather than counted, because every window hears
   every window's events. */
const pieceListeners = new Map();
let subscribed = null;
function hearPieces () {
  if (subscribed) return subscribed;
  const listen = globalThis.__TAURI__?.event?.listen;
  if (typeof listen !== 'function') return Promise.resolve();
  /* Awaited before the ask goes, so the first piece finds its listener. Each
     event carries the whole answer so far, so one that slipped by anyway
     costs nothing. */
  subscribed = listen('llm-piece', (e) => {
    const f = pieceListeners.get(e.payload && e.payload.piece);
    if (f) f(e.payload);
  }).catch(() => { subscribed = null; });
  return subscribed;
}
export const pieceNumber = () => Math.floor(Math.random() * 2 ** 52) + 1;

export function tauriBridge ({ role = 'planner' } = {}) {
  const invoke = globalThis.__TAURI__?.core?.invoke;
  if (!invoke) return null;

  /* A ROLE, not an address. Two models run — the planner and the smaller one
     carrying the category adapter — and Rust owns the mapping from role to
     port. The page cannot name a host here, which is the invariant the shell
     is built around. */
  /* `pigeon` names the Pigeon this ask is ({ id, input, values }, D84):
     with the engine on, Rust asks that Pigeon from Patch's nest and the
     messages and grammar here go unused; with it off, the server is asked
     with them, as always. */
  const complete = async ({ messages, grammar = null, maxTokens = 256, temperature = 0,
                            wantConfidence = false, pigeon = null, onPiece = null }) => {
    /* `onPiece(textSoFar)`: the answer as it grows, for a caller that can
       say something before the whole of it is back (the planner names the
       skill it reached for). The answer itself is read from the reply. */
    let piece = null;
    if (onPiece) {
      await hearPieces();
      piece = pieceNumber();
      let sofar = '';
      pieceListeners.set(piece, (p) => { sofar = typeof p.sofar === 'string' ? p.sofar : sofar + String(p.text || ''); onPiece(sofar); });
    }
    try {
      const out = await invoke('llm_complete', {
        req: { messages, grammar, max_tokens: maxTokens, temperature, role, want_confidence: wantConfidence, ...(pigeon ? { pigeon } : {}), ...(piece ? { piece } : {}) }
      });
      return {
        text: out.text, ms: out.ms, tokens: out.tokens, promptTokens: out.prompt_tokens,
        confidence: typeof out.confidence === 'number' ? out.confidence : null
      };
    } finally {
      if (piece) pieceListeners.delete(piece);
    }
  };
  complete.base = `tauri://llm_complete#${role}`;
  complete.transport = 'rust command';
  complete.role = role;
  /* Each role is probed separately: they run as separate servers and fail
     independently, so one being down must not be reported as the other. */
  const statusFor = async () => {
    const s = await invoke('llm_status');
    return role === 'category' ? (s.category ?? { available: false }) : s;
  };
  complete.health = async () => {
    try { return Boolean((await statusFor()).available); } catch { return false; }
  };
  complete.model = async () => {
    try { return (await statusFor()).model || 'unknown'; } catch { return 'unknown'; }
  };
  return complete;
}

/* Pick whichever route exists: the Rust command in the app, a direct fetch when
   the same files are opened in a browser for testing. Returns null when no
   model is reachable, which is a normal state and one the rail reports. */
export async function detectLlm ({ base = DEFAULT_BASE, role = 'planner' } = {}) {
  for (const candidate of [tauriBridge({ role }), llamaServer({ base })]) {
    if (candidate && await candidate.health()) return candidate;
  }
  return null;
}

/* Where the category adapter answers when the app is opened in a browser for
   testing. In the Tauri window the port lives in Rust instead. */
export const CATEGORY_BASE = 'http://127.0.0.1:8101';

export function llamaServer ({ base = DEFAULT_BASE, timeoutMs = 60000 } = {}) {
  /* The browser-testing route. In the Tauri window this is unreachable by
     design — the CSP blocks it — and tauriBridge() is used instead. */
  const post = async (path, body, signal) => {
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await devKeyHeaders()) },
      body: JSON.stringify(body),
      signal
    });
    if (!res.ok) throw new Error(`${path} → ${res.status} ${await res.text().catch(() => '')}`);
    return res.json();
  };

  /**
   * @param {object} opts
   * @param {Array<{role:string,content:string}>} opts.messages
   * @param {string|null} opts.grammar   GBNF; constrains the output shape
   * @param {number} opts.maxTokens
   * @returns {Promise<{text:string, ms:number, tokens:number}>}
   */
  /* `think: false` turns the reasoning preamble OFF at the template, which is
     the only place it can be turned off. Qwen3.5 emits "Thinking Process: ..."
     before answering, and a caller asking a yes/no question with a small token
     budget gets the preamble truncated and no answer at all — which looks
     exactly like a confident answer if the caller is lenient about parsing.
     That cost a whole bench run: a check that was measured working over raw
     fetch went inert the moment it was moved behind this function. */
  const complete = async ({ messages, grammar = null, maxTokens = 256, temperature = 0,
                           wantConfidence = false, think = true }) => {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    const t0 = Date.now();
    try {
      const { prompt } = await post('/apply-template',
        { messages, ...(think ? {} : { chat_template_kwargs: { enable_thinking: false } }) }, ac.signal);
      const out = await post('/completion', {
        prompt,
        n_predict: maxTokens,
        /* Greedy. A planner is a parser, not a writer — there is no upside to
           sampling and every reason to want the same plan for the same
           message, which §3.1's determinism claim assumes anyway. */
        temperature,
        top_k: 1,
        cache_prompt: true,
        /* Asking for the first token's probability, which callers use to tell a
           confident answer from a guess. Only when requested: it costs a little
           work and most callers have no use for it. */
        ...(wantConfidence ? { n_probs: 1 } : {}),
        ...(grammar ? { grammar } : {})
      }, ac.signal);
      const first = out.completion_probabilities?.[0];
      return {
        text: String(out.content ?? '').trim(),
        ms: Date.now() - t0,
        tokens: out.tokens_predicted ?? 0,
        promptTokens: out.tokens_evaluated ?? 0,
        /* null, not 1, when unavailable — a caller gating on this must be able
           to tell "certain" from "the server never said". */
        confidence: typeof first?.logprob === 'number' ? Math.exp(first.logprob) : null
      };
    } finally {
      clearTimeout(timer);
    }
  };

  complete.base = base;
  complete.transport = 'direct fetch';
  complete.health = async () => {
    try {
      const r = await fetch(`${base}/health`, { signal: AbortSignal.timeout(2000) });
      return r.ok;
    } catch { return false; }
  };
  complete.model = async () => {
    try {
      const r = await fetch(`${base}/props`, { headers: await devKeyHeaders(), signal: AbortSignal.timeout(2000) });
      const j = await r.json();
      return (j.model_path || '').split('/').pop() || 'unknown';
    } catch { return 'unknown'; }
  };
  return complete;
}
