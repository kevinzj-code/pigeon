#!/usr/bin/env node
/* serve.mjs — a static file server, because ES modules do not load from
   file:// in any browser. No dependencies; this is not a build step. */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureApiKey } from './lib/apikey.mjs';
import { sameOrigin } from './lib/same-origin.mjs';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const PORT = Number(process.env.PORT || 4173);
/* Only this machine. The routes below run tesseract and reach the web on the
   caller's behalf; the static root is a working copy of the app. Neither is
   for the LAN. */
const HOST = '127.0.0.1';
/* What the page may fetch: the same set `scripts/bundle.mjs` ships, plus the
   skills the worker imports in a browser. Not `.git/`, not `model/`, not
   `bench/`, not this script. */
const SERVED = ['index.html', 'popover.html', 'bar.html', 'src/', 'styles/', 'fonts/', 'assets/', 'skills/'];
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8'
};

/* The web tier's dev route. In the app, `web_search` in Rust owns these two
   hosts and the page only ever hands over a query; opened in a browser there is
   no Rust, and these APIs do not send CORS headers that would let the page call
   them itself. So the same two requests are made here instead — same endpoints,
   same query encoding, same reply shape. Dev only: the Tauri window's CSP
   blocks this path and uses the command. */
const DDG = 'https://api.duckduckgo.com/';
const WIKIPEDIA = 'https://en.wikipedia.org/w/api.php';

const UA = 'Pigeon/0.1 (Airoplane Mode; offline-first assistant)';
const stripTags = (s) => String(s).replace(/<[^>]*>/g, '')
  .replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#39;/g, "'");

/* Whole sentences, up to a readable length.
   The limit is generous on purpose. Cutting short is exactly how the summary
   endpoint lost the answer: asked who governs Virginia it described the office
   and stopped, while the name sits in the third paragraph of the same lead.
   Trimming to look tidy is how a lookup quietly stops answering the question,
   so this errs long and only ever cuts at a full stop. */
function trimToSentences (text, limit = 1400) {
  const clean = String(text).replace(/\s+/g, ' ').trim();
  if (clean.length <= limit) return clean;
  const cut = clean.slice(0, limit);
  const stop = cut.lastIndexOf('. ');
  return stop > 120 ? cut.slice(0, stop + 1) : clean.slice(0, clean.indexOf('. ', limit) + 1) || clean;
}

async function webSearch (query) {
  const ddg = new URL(DDG);
  ddg.search = new URLSearchParams({ q: query, format: 'json', no_html: '1', skip_disambig: '1' });
  const wiki = new URL(WIKIPEDIA);
  wiki.search = new URLSearchParams({
    action: 'query', list: 'search', srsearch: query, srlimit: '5', format: 'json'
  });

  /* An HTTP error is NOT an empty result, and conflating the two produces the
     worst possible message: "nothing on the web matched that" when the truth is
     "we were rate-limited and never asked". Wikipedia returns 429 readily, so
     this distinction is not hypothetical — it showed up within minutes of the
     first real use. Errors propagate; the skill reports NETWORK_FAILED and says
     why. */
  /* NEITHER provider is required. They fail independently — Wikipedia returns
     429 readily under any burst — and one being down is no reason to have
     nothing to say when the other answered. Each failure is recorded and the
     request only fails when BOTH gave nothing, at which point the recorded
     reasons are what the caller is told. An HTTP error is never reported as an
     empty result. */
  const why = [];
  const get = async (url) => {
    let res;
    try {
      res = await fetch(url, { headers: { 'user-agent': UA } });
    } catch (e) {
      why.push(`could not reach ${url.host}: ${e.message}`);
      return null;
    }
    if (!res.ok) {
      why.push(res.status === 429
        ? `rate-limited by ${url.host} — try again in a moment`
        : `${url.host} returned HTTP ${res.status}`);
      return null;
    }
    return res.json().catch(() => null);
  };

  const [a, w] = await Promise.all([get(ddg), get(wiki)]);

  const results = (w?.query?.search || []).filter(h => h.title).map(h => ({
    title: h.title,
    snippet: stripTags(h.snippet || ''),
    source: `https://en.wikipedia.org/wiki/${h.title.replace(/ /g, '_')}`
  }));

  let answer = (a?.AbstractText || '').trim() || null;
  let source = answer ? (a?.AbstractURL || null) : null;

  /* The encyclopedia's own opening section, for the best-matching page.
     Two things had to be got right here and both were found by testing rather
     than reasoning:

     · Not DuckDuckGo alone. It has no abstract for "capital of X", so those
       questions came back empty.
     · Not the REST summary endpoint, which truncates. Asked who governs
       Virginia it returned a description of the OFFICE and stopped one sentence
       before the name — while the full opening section says plainly who holds
       it. A confident half-answer is worse than a slow one.

     Wikidata has this as structured data and was the obvious choice; it is not
     used because it was measurably WRONG here, still listing a holder whose term
     had ended with no end date recorded. Prose that is maintained beats a field
     that is not. */
  if (results.length) {
    const top = results[0];
    const introUrl = new URL(WIKIPEDIA);
    introUrl.search = new URLSearchParams({
      action: 'query', prop: 'extracts', exintro: '1', explaintext: '1',
      redirects: '1', titles: top.title, format: 'json'
    });
    const intro = await get(introUrl);
    const pages = intro?.query?.pages || {};
    const extract = (Object.values(pages)[0]?.extract || '').trim();
    if (extract) { answer = trimToSentences(extract); source = top.source; }
  }

  if (!answer && !results.length && why.length) throw new Error(why.join('; '));
  return { answer, source, results };
}

/* The image reader's dev route. In the app, `ocr_image` in Rust finds tesseract
   and runs it with the bytes on stdin; opened in a browser there is no Rust, so
   the same binary is run here with the SAME arguments — they must match
   `TESSERACT_ARGS` in lib.rs, or a browser and the window would read the same
   image differently. Dev only: the Tauri window's CSP blocks this path. */
const TESSERACT_ARGS = ['stdin', 'stdout', '--psm', '6'];
const TESSERACT_WELL_KNOWN = ['/opt/homebrew/bin/tesseract', '/usr/local/bin/tesseract', '/usr/bin/tesseract'];
const OCR_MAX_BYTES = 20 * 1024 * 1024;

function findTesseract () {
  const over = process.env.PIGEON_TESSERACT;
  if (over && existsSync(over)) return over;
  const onPath = (process.env.PATH || '').split(':').some(d => d && existsSync(join(d, 'tesseract')));
  if (onPath) return 'tesseract';
  return TESSERACT_WELL_KNOWN.find(p => existsSync(p)) || null;
}

/* Run tesseract with a body on stdin; resolve with { text, ms, engine } or
   reject with the first line it said on stderr. */
function runTesseract (bin, args, body, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const child = spawn(bin, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const out = [], err = [];
    child.stdout.on('data', d => out.push(d));
    child.stderr.on('data', d => err.push(d));
    const timer = setTimeout(() => { child.kill(); reject(new Error(`tesseract took longer than ${timeoutMs / 1000} s`)); }, timeoutMs);
    child.on('error', e => { clearTimeout(timer); reject(e); });
    child.on('close', code => {
      clearTimeout(timer);
      const stdout = Buffer.concat(out).toString('utf8');
      const stderr = Buffer.concat(err).toString('utf8');
      if (code !== 0) {
        const first = stderr.split('\n').map(s => s.trim()).find(Boolean) || 'it exited with an error';
        reject(new Error(`tesseract could not read that: ${first}`));
        return;
      }
      resolve({ stdout, stderr, ms: Date.now() - t0 });
    });
    child.stdin.on('error', () => {});
    child.stdin.end(body);
  });
}

async function tesseractVersion (bin) {
  try {
    const { stdout, stderr } = await runTesseract(bin, ['--version'], Buffer.alloc(0), 2000);
    return `${stdout}\n${stderr}`.split('\n').map(s => s.trim()).find(l => l.startsWith('tesseract ')) || 'tesseract';
  } catch { return 'tesseract'; }
}

async function ocrRoute (req, res, url) {
  const json = (code, body) => res.writeHead(code, { 'content-type': 'application/json' }).end(JSON.stringify(body));
  const bin = findTesseract();
  if (url.searchParams.has('probe')) {
    json(200, { ok: true, available: Boolean(bin), engine: bin ? await tesseractVersion(bin) : null });
    return;
  }
  if (req.method !== 'POST') { json(405, { error: 'POST the image bytes' }); return; }
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > OCR_MAX_BYTES) { json(413, { error: `image is over ${OCR_MAX_BYTES / (1024 * 1024)} MB` }); return; }
    chunks.push(c);
  }
  const body = Buffer.concat(chunks);
  if (!body.length) { json(400, { error: 'empty image' }); return; }
  if (!bin) { json(503, { error: 'tesseract is not installed — brew install tesseract' }); return; }
  try {
    const { stdout, ms } = await runTesseract(bin, TESSERACT_ARGS, body);
    json(200, { text: stdout.replace(/\f/g, '').trimEnd(), ms, engine: await tesseractVersion(bin) });
  } catch (e) {
    json(502, { error: String(e && e.message) });
  }
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');

    /* The three `/__` routes answer only the page this server served. Loopback
       keeps the LAN out; this keeps out another tab's origin and any local
       process that is not the page (scripts/lib/same-origin.mjs). */
    if (url.pathname.startsWith('/__') && !sameOrigin(req.headers, PORT)) {
      res.writeHead(403, { 'content-type': 'application/json' }).end('{"error":"same-origin only"}');
      return;
    }

    if (url.pathname === '/__ocr') { await ocrRoute(req, res, url); return; }

    /* The model servers' key, for the page opened in a browser: the servers
       `npm run models` starts require it, and the page has no other way to
       learn it. Loopback only, like everything here, and same-origin only,
       checked above. */
    if (url.pathname === '/__key') {
      try {
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ key: ensureApiKey().key }));
      } catch (e) {
        res.writeHead(500, { 'content-type': 'application/json' }).end(JSON.stringify({ error: String(e && e.message) }));
      }
      return;
    }

    if (url.pathname === '/__search') {
      if (url.searchParams.has('probe')) {
        res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
        return;
      }
      const q = (url.searchParams.get('q') || '').trim();
      if (!q) { res.writeHead(400, { 'content-type': 'application/json' }).end('{"error":"empty query"}'); return; }
      try {
        const out = await webSearch(q);
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(out));
      } catch (e) {
        res.writeHead(502, { 'content-type': 'application/json' })
          .end(JSON.stringify({ error: String(e && e.message) }));
      }
      return;
    }

    const rel = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
    const want = rel === '/' ? 'index.html' : rel.replace(/^\//, '');
    if (!SERVED.some(p => want === p || (p.endsWith('/') && want.startsWith(p)))) { res.writeHead(404, { 'content-type': 'text/plain' }).end('not found'); return; }
    const path = join(ROOT, want);
    if (!path.startsWith(ROOT)) { res.writeHead(403).end('no'); return; }
    const body = await readFile(path);
    res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' }).end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
  }
});

/* `npm run dev` starts this as Tauri's beforeDevCommand. A second `npm run dev`
   — or a stray server left over from testing in a browser — would otherwise die
   on EADDRINUSE and take the whole dev command down with it. If something is
   already serving the port that is fine: say so, exit 0, and let Tauri attach
   to whatever is there. Any other listen error is a real failure and still
   crashes loudly. */
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log(`\n  Pigeon → http://localhost:${PORT} (already serving)\n`);
    process.exit(0);
  }
  throw err;
});

server.listen(PORT, HOST, () => console.log(`\n  Pigeon → http://localhost:${PORT}\n`));
