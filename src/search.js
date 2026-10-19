/* search.js — the §3 web tier's only route out of the machine.
 *
 * The same seam as llm.js, for the same reason: skills receive a `search`
 * function on `ctx` and never learn where the bytes came from. That is what
 * lets the test suite execute a web skill's examples against a fixture, with no
 * network and no flakiness, while the app injects the real thing.
 *
 * Two transports, picked by what exists:
 *   · the Tauri command — the page hands over a QUERY, and Rust owns the hosts.
 *   · the dev-server proxy — the same shape for browser testing, because a page
 *     on localhost cannot call these APIs directly (their CORS headers do not
 *     admit it, and adding a host to the CSP is exactly what this design avoids).
 *
 * Nothing here decides WHETHER to go to the network. `webEnabled` and the
 * per-request confirmation are the executor's gates and run before a skill is
 * ever called; by the time `search` is invoked, that decision is made.
 */

/** @typedef {{title: string, snippet: string, source: string}} SearchResult */
/** @typedef {{answer: string|null, source: string|null, results: SearchResult[]}} SearchReply */

const EMPTY = { answer: null, source: null, results: [] };

/* A Rust command rejects with a STRING, not an Error. Reading `.message` off it
   gives undefined, which is how a perfectly clear "rate-limited by
   en.wikipedia.org" reached the user as "no reason given" — the one thing the
   reply is not allowed to be. */
export function reasonFrom (e) {
  if (typeof e === 'string') return e;
  if (e && typeof e.message === 'string' && e.message) return e.message;
  if (e && typeof e.toString === 'function') {
    const s = e.toString();
    if (s && s !== '[object Object]') return s;
  }
  try { return JSON.stringify(e); } catch { return 'unknown error'; }
}

export function tauriSearch () {
  const invoke = globalThis.__TAURI__?.core?.invoke;
  if (!invoke) return null;
  const search = async (query) => {
    let out;
    try {
      out = await invoke('web_search', { req: { query } });
    } catch (e) {
      throw new Error(reasonFrom(e));
    }
    return { answer: out.answer ?? null, source: out.source ?? null, answeredBy: out.answered_by ?? null, results: out.results ?? [] };
  };
  search.transport = 'rust command';
  /* Actually ask, rather than assuming. This used to return true on the grounds
     that a Tauri window always has commands — which is false the moment the
     running binary predates the command, and it showed up exactly that way: the
     web switch appeared, and every search failed. An empty query is refused by
     Rust BEFORE any request is made, so this proves the command exists without
     touching the network. */
  search.health = async () => {
    try {
      await invoke('web_search', { req: { query: '' } });
      return true;
    } catch (e) {
      return /empty query/i.test(reasonFrom(e));
    }
  };
  return search;
}

/* The dev-server route. `scripts/serve.mjs` proxies to the same two endpoints
   the Rust command uses, so what a browser sees and what the app sees are the
   same bytes from the same places. Not shipped: in the Tauri window the CSP
   blocks this and tauriSearch() is used instead. */
export function proxySearch ({ base = '' } = {}) {
  const search = async (query) => {
    const res = await fetch(`${base}/__search?q=${encodeURIComponent(query)}`, {
      signal: AbortSignal.timeout(20000)
    });
    if (!res.ok) {
      /* The proxy puts the real reason in the body — "rate-limited by
         en.wikipedia.org" is worth far more than "search failed: 502". */
      const why = await res.json().then(b => b && b.error).catch(() => null);
      throw new Error(why || `search failed: HTTP ${res.status}`);
    }
    const out = await res.json();
    return { answer: out.answer ?? null, source: out.source ?? null, answeredBy: out.answered_by ?? null, results: out.results ?? [] };
  };
  search.transport = 'dev-server proxy';
  search.health = async () => {
    try {
      const r = await fetch(`${base}/__search?probe=1`, { signal: AbortSignal.timeout(2000) });
      return r.ok;
    } catch { return false; }
  };
  return search;
}

/* Returns null when there is no way out, which is a normal state: Pigeon is an
   offline app whose web tier is optional, and every web skill reports
   NETWORK_OFF rather than failing strangely when this is absent. */
export async function detectSearch ({ base = '' } = {}) {
  for (const candidate of [tauriSearch(), proxySearch({ base })]) {
    if (candidate && await candidate.health()) return candidate;
  }
  return null;
}

/* A deterministic stand-in, used by the test suite and available to anyone who
   wants to exercise a web skill without a network. Takes a map of query → reply
   so an example states exactly what the provider returned when it was written. */
export function fixtureSearch (byQuery) {
  const norm = (q) => String(q).trim().toLowerCase();
  const table = new Map(Object.entries(byQuery).map(([k, v]) => [norm(k), v]));
  const search = async (query) => table.get(norm(query)) ?? EMPTY;
  search.transport = 'fixture';
  search.health = async () => true;
  return search;
}
