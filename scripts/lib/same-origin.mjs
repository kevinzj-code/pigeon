/* same-origin.mjs — is this request from the page the dev server itself
   served? The server binds loopback only, so a stranger on the LAN cannot
   reach it; this is for the other two callers loopback still lets in: a page
   in another tab, on another origin, and a process on this Mac that is not
   the page. The three `/__` routes hand out the model servers' key, reach
   the web on the caller's behalf and run tesseract, so each refuses anything
   that is not the page.

   Three headers, each checked only when present, because none is sent by
   every client:
     Host            — every HTTP/1.1 request; must be this server's own.
     Origin          — sent on cross-origin and on non-GET requests; must be
                       this server's own.
     Sec-Fetch-Site  — sent by browsers; `same-origin` (the page) or `none`
                       (the address bar). A WebView that omits it passes on
                       Host and Origin alone. */

const OWN_HOSTS = (port) => new Set([`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`]);

export function sameOrigin (headers = {}, port) {
  const own = OWN_HOSTS(port);
  const host = String(headers.host || '').toLowerCase();
  if (!own.has(host)) return false;
  const origin = headers.origin;
  if (origin != null && origin !== 'null') {
    let o;
    try { o = new URL(String(origin)); } catch { return false; }
    if (o.protocol !== 'http:' || !own.has(o.host.toLowerCase())) return false;
  } else if (origin === 'null') {
    return false;
  }
  const site = headers['sec-fetch-site'];
  if (site != null && site !== 'same-origin' && site !== 'none') return false;
  return true;
}
