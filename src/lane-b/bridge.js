/* bridge.js — Lane B's transport, and the only file in this folder that knows
 * a Tauri window exists.
 *
 * In the app: two commands. `chat_complete`, which is the one door in the whole
 * shell a model may write prose through, and `personas_list`. Neither takes a
 * path, a port or an adapter id — the page names a persona by the id it was
 * given and Rust maps that to a positional adapter on the category server.
 *
 * In a browser (`npm run serve`): the same two llama-server endpoints, reached
 * directly, exactly as `llm.js` falls back for Lane A. It is the same request
 * with the same per-request adapter array; only the transport differs, and the
 * rail says which. Without it the chat lane could not be seen or corrected
 * outside a built app, and a lane nobody can look at is a lane nobody can
 * check.
 *
 * Both paths obey the rule the shell measured: the chat endpoint is
 * /v1/chat/completions, never /completion, and every adapter is named with its
 * scale because an omitted one keeps whatever it was loaded with.
 */

const invoke = () => globalThis.__TAURI__?.core?.invoke ?? null;

/* Where the category server answers when the app is opened in a browser. The
   same constant llm.js keeps for the same reason; in the app this is never
   read, because Rust owns the address. */
const DEV_BASE = 'http://127.0.0.1:8101';

/* The servers' key, for the dev path. A COPY of llm.js's `devKeyHeaders`,
   on purpose: this lane imports nothing from the rest of src/ (lint-imports
   rule 1), and the honest move for a shared helper is to copy it and say so.
   Keep the two the same. */
let devKeyPromise = null;
function devKeyHeaders () {
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

export function chatBridge () {
  return tauriChat() || devChat();
}

/* The reply as it is written. Rust emits one `chat-piece` event per few
   characters, each carrying the number this page gave the request, so the
   replies in flight each reach their own listener. One subscription for the
   page's life; a piece nobody waits for is dropped. A COPY of llm.js's
   `hearPieces`, on purpose: this lane imports nothing from the rest of src/
   (lint-imports rule 1). The number is random rather than counted, because
   every window hears every window's events. */
const pieceListeners = new Map();
let subscribed = null;
function hearPieces () {
  if (subscribed) return subscribed;
  const listen = globalThis.__TAURI__?.event?.listen;
  if (typeof listen !== 'function') return Promise.resolve();
  /* Awaited before the ask goes, so the first piece finds its listener. Each
     event carries the whole answer so far, so one that slipped by anyway
     costs nothing. */
  subscribed = listen('chat-piece', (e) => {
    const f = pieceListeners.get(e.payload && e.payload.piece);
    if (f) f(e.payload);
  }).catch(() => { subscribed = null; });
  return subscribed;
}
const pieceNumber = () => Math.floor(Math.random() * 2 ** 52) + 1;

function tauriChat () {
  const call = invoke();
  if (!call) return null;

  /* `peek` writes on the picture model instead, and only it may carry an
     `image` (a data:image URL) — Rust refuses one anywhere else. `onPiece`
     hears the reply as it grows; what is shown of it is chat.js's decision,
     and the reply is still read whole from what comes back. */
  const complete = async ({ messages, persona = null, maxTokens = null, temperature = null, seed = null, peek = false, image = null, noAmounts = false, onPiece = null }) => {
    let piece = null;
    if (onPiece) {
      await hearPieces();
      piece = pieceNumber();
      let sofar = '';
      pieceListeners.set(piece, (p) => { sofar = typeof p.sofar === 'string' ? p.sofar : sofar + String(p.text || ''); onPiece(sofar); });
    }
    try {
      const out = await call('chat_complete', {
        req: { messages, persona, max_tokens: maxTokens, temperature, seed, ...(peek ? { peek: true } : {}), ...(image ? { image } : {}),
               ...(noAmounts ? { no_amounts: true } : {}), ...(piece ? { piece } : {}) }
      });
      return {
        text: out.text, ms: out.ms, tokens: out.tokens, promptTokens: out.prompt_tokens,
        persona: out.persona, finishReason: out.finish_reason
      };
    } finally {
      if (piece) pieceListeners.delete(piece);
    }
  };
  complete.transport = 'rust command';
  complete.personas = () => call('personas_list');
  return complete;
}

/* The dev path. Adapter ids come from the server's own /lora-adapters, which
   is the same positional list Rust builds from the launch line — asked for
   once and remembered, because it cannot change while the server runs. */
function devChat () {
  if (typeof fetch !== 'function') return null;
  let loaded = null;

  const adapters = async () => {
    if (loaded) return loaded;
    const res = await fetch(`${DEV_BASE}/lora-adapters`, { headers: await devKeyHeaders() });
    if (!res.ok) throw new Error(`the chat model did not list its adapters (${res.status})`);
    loaded = (await res.json()).map((a, i) => ({
      /* The category adapter is the one the launch line applies; everything
         after it is a persona. Same order, same rule as the shell's. */
      id: typeof a.id === 'number' ? a.id : i,
      file: String(a.path || '').split('/').pop() || `adapter ${i}`
    }));
    return loaded;
  };
  const idOf = (file) => file.replace(/\.lora\.gguf$/, '');

  const complete = async ({ messages, persona = null, maxTokens = null, temperature = null, seed = null }) => {
    const all = await adapters();
    if (persona && !all.some((a, i) => i > 0 && idOf(a.file) === persona)) {
      throw new Error(`the persona "${persona}" is not loaded — it needs a restart before it can be worn`);
    }
    const started = Date.now();
    const res = await fetch(`${DEV_BASE}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await devKeyHeaders()) },
      body: JSON.stringify({
        messages,
        max_tokens: maxTokens ?? 400,
        temperature: temperature ?? 0.7,
        top_p: 0.95,
        stream: false,
        ...(seed === null ? {} : { seed }),
        /* Every adapter, named. The category one off, the chosen persona on. */
        lora: all.map((a, i) => ({ id: a.id, scale: i > 0 && idOf(a.file) === persona ? 1 : 0 }))
      })
    });
    const out = await res.json();
    if (out.error) throw new Error(out.error.message || 'the chat model refused');
    const choice = (out.choices || [])[0] || {};
    return {
      text: String((choice.message && choice.message.content) || '').trim(),
      ms: Date.now() - started,
      tokens: (out.usage && out.usage.completion_tokens) || 0,
      promptTokens: (out.usage && out.usage.prompt_tokens) || 0,
      persona,
      finishReason: choice.finish_reason || null
    };
  };
  complete.transport = 'direct fetch';
  complete.personas = async () => {
    const all = await adapters();
    /* Position 0 is the category adapter, which is not a voice. */
    return all.slice(1).map(a => ({ id: idOf(a.file), name: idOf(a.file).replace(/[-_]/g, ' '), bytes: null, loaded: true }));
  };
  return complete;
}
