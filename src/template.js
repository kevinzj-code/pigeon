/* template.js — §3.5 "template first, model second".
 *
 * For a single-step plan with a replyTemplate, this file IS the reply path and
 * the chat model never runs. That is the majority of Pigeon turns, so it is
 * also the majority of the latency budget and the entirety of the fabrication
 * risk on those turns — which is to say, none.
 *
 * render() returns SEGMENTS, not a string. A computed value has to render
 * differently from prose (§3.6), and the only place that distinction is
 * knowable for free is right here, where we substituted it. Flattening to a
 * string and re-finding the numbers later is how a renderer starts guessing. */

const TOKEN = /\{\{\s*([^}]+?)\s*\}\}/g;

/**
 * @param {string} tpl
 * @param {object} value      the skill's output value
 * @param {object} meta       { skill, step, input, provenance, locale }
 * @returns {Array<{type:'text'|'value', text:string, field?:string, skill?:string, provenance?:object, raw?:any}>}
 */
export function render (tpl, value, meta = {}) {
  const segs = [];
  let last = 0;
  let m;
  TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(tpl)) !== null) {
    if (m.index > last) segs.push({ type: 'text', text: tpl.slice(last, m.index) });
    const [field, text, raw, prose] = resolveToken(m[1], value, meta);
    /* §3.6 draws one distinction and it has to mean something: a marked span is
       a COMPUTED VALUE. Some outputs carry prose — a caveat, a tense, a verdict
       — and marking those mono-and-underlined says "this is a datum" about a
       sentence, which devalues the mark everywhere else. `|prose` opts a token
       out and it renders as ordinary text. */
    segs.push(prose ? { type: 'text', text } : {
      type: 'value',
      text,
      raw,
      field,
      skill: meta.skill,
      /* The plan step this value came out of. Not the skill name: a plan may run
         the same skill twice, and "which of the two" is exactly the question the
         detail view has to answer. */
      step: meta.step,
      input: meta.input,
      provenance: meta.provenance
    });
    last = m.index + m[0].length;
  }
  if (last < tpl.length) segs.push({ type: 'text', text: tpl.slice(last) });
  return segs;
}

export function toPlainText (segs) {
  return segs.map(s => s.text).join('');
}

function resolveToken (token, value, meta) {
  const parts = token.split('|').map(s => s.trim());
  const path = parts.shift();
  let raw = getPath(value, path);
  let prose = false;
  for (const f of parts) {
    const [name, ...args] = f.split(':');
    if (name.trim() === 'prose') { prose = true; continue; }
    raw = applyFilter(name.trim(), raw, args, { ...meta, value });
  }
  return [path, stringify(raw, meta), raw, prose];
}

export function getPath (obj, path) {
  if (path === '' || path === '.') return obj;
  return path.split('.').reduce((o, k) => (o === undefined || o === null ? undefined : o[k]), obj);
}

function stringify (v, meta) {
  if (v === undefined || v === null) return '—';
  if (typeof v === 'number') {
    /* Trailing-zero noise ("55.50 miles") reads as false precision. Numbers
       arrive already rounded by their skill; this only strips the artefacts of
       float representation. */
    return Number.isInteger(v) ? String(v) : String(Number(v.toFixed(10)));
  }
  if (Array.isArray(v)) return v.map(x => stringify(x, meta)).join(', ');
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

const FILTERS = {
  /* "a, b and c" — Intl does the locale's own conjunction, so a French build
     gets "et" without this file knowing that. */
  /* An optional decimal count, because money is the common case and stripping
     a trailing zero off 24.30 makes a correct number look like a sloppy one. */
  list (v, [dp], meta) {
    if (!Array.isArray(v)) return v;
    const items = v.map(x => {
      if (typeof x === 'number' && dp !== undefined) return x.toFixed(Number(dp));
      return typeof x === 'object' && x !== null ? Object.values(x).join(' ') : String(x);
    });
    try {
      return new Intl.ListFormat(meta.locale || 'en-GB', { style: 'long', type: 'conjunction' }).format(items);
    } catch {
      return items.join(', ');
    }
  },
  lines (v) { return Array.isArray(v) ? v.join('\n') : v; },
  fixed (v, [n]) { return typeof v === 'number' ? Number(v.toFixed(Number(n || 0))) : v; },
  comma (v, _a, meta) {
    return typeof v === 'number' ? v.toLocaleString(meta.locale || 'en-GB') : v;
  },
  money (v, [code], meta) {
    if (typeof v !== 'number') return v;
    try {
      return v.toLocaleString(meta.locale || 'en-GB', { style: 'currency', currency: code || 'USD' });
    } catch { return v.toFixed(2); }
  },
  /* {{total|cur:2}} — an amount in the currency the person wrote it in: the
     output's `currency` symbol (£, $, €…) in front, at a fixed number of
     places. With no symbol given it is the bare amount, never a guessed one. */
  cur (v, [dp], meta) {
    const sym = meta.value && typeof meta.value.currency === 'string' ? meta.value.currency : '';
    const one = (x) => (typeof x === 'number' ? `${sym}${x.toFixed(Number(dp ?? 2))}` : String(x));
    if (!Array.isArray(v)) return typeof v === 'number' ? one(v) : v;
    const items = v.map(one);
    try {
      return new Intl.ListFormat(meta.locale || 'en-GB', { style: 'long', type: 'conjunction' }).format(items);
    } catch {
      return items.join(', ');
    }
  },
  upper (v) { return typeof v === 'string' ? v.toUpperCase() : v; },
  lower (v) { return typeof v === 'string' ? v.toLowerCase() : v; },
  /* {{count}} {{count|plural:day:days}} — the filter returns the WORD, so the
     number is still its own token and still gets marked as computed. */
  plural (v, [one, many]) { return Math.abs(Number(v)) === 1 ? (one || '') : (many || `${one}s`); },
  date (v, _a, meta) {
    if (typeof v !== 'string') return v;
    const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T00:00:00Z` : v);
    if (Number.isNaN(d.getTime())) return v;
    try {
      return d.toLocaleDateString(meta.locale || 'en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
    } catch { return v; }
  },
  pct (v, [n]) { return typeof v === 'number' ? `${Number((v * 100).toFixed(Number(n ?? 1)))}%` : v; },
  /* Handled in resolveToken — listed here so the registry linter accepts it. */
  prose (v) { return v; }
};

function applyFilter (name, v, args, meta) {
  const f = FILTERS[name];
  /* An unknown filter is an author typo. Failing loudly in the test suite beats
     rendering "{{x|fixd:2}}" to a user. */
  if (!f) throw new Error(`unknown template filter "${name}"`);
  return f(v, args, meta);
}

export const FILTER_NAMES = Object.keys(FILTERS);

/* §3.5 Assembler path: the model emits {{result:s1.field}} and JS substitutes
   the real value at render time, so the model physically cannot alter a number.
   Unresolvable tokens are dropped to a visible marker rather than left as
   literal braces — a token that points nowhere is a model error and should
   look like one. */
export function substituteResultTokens (text, results, meta = {}) {
  const segs = [];
  const re = /\{\{\s*result:([A-Za-z][A-Za-z0-9_]*)\.([A-Za-z0-9_.]+)\s*\}\}/g;
  let last = 0, m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) segs.push({ type: 'text', text: text.slice(last, m.index) });
    const step = results.find(r => r.id === m[1]);
    if (step && step.ok) {
      const raw = getPath(step.value, m[2]);
      segs.push({
        type: 'value',
        text: stringify(raw, meta),
        raw,
        field: m[2],
        skill: step.skill,
        step: step.id,
        input: step.input,
        provenance: step.provenance
      });
    } else {
      segs.push({ type: 'text', text: '[unavailable]' });
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) segs.push({ type: 'text', text: text.slice(last) });
  return segs;
}
