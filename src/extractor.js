/* extractor.js — §3.4's Extractor seam, filled with JS instead of an adapter.
 *
 * §3.4 specifies the Extractor as the Planner adapter in a different prompt
 * mode: (message, one skill card, validation error) → the missing fields. No
 * adapter exists in this build, and §11 names the fallback:
 *
 *   "the web and mobile tiers fall back to router-only single-skill mode
 *    (top-1 skill, Extractor fills args, no multi-step). Design the executor so
 *    that fallback is a config flag, not a rewrite."
 *
 * That fallback still needs SOMETHING to fill args. This is that something: a
 * deterministic, inspectable JS extractor driven by the skill's own
 * inputSchema. It is not a model and does not pretend to be one — it reads the
 * schema, finds the shapes that schema wants in the message, and returns them.
 *
 * It is deliberately conservative. Anything it cannot place with confidence it
 * leaves out, and the executor's ASK_USER path takes over — which is the
 * correct escalation and costs one question rather than one wrong answer.
 *
 * It satisfies the same interface an adapter would, so swapping the real one
 * in is a one-line change in app.js. */

import { validate } from './schema.js';
import { parseDate } from './lib/dates.js';
import { resolveUnit } from './lib/units.js';

const NUMBER_RE = /-?\d{1,3}(?:,\d{3})+(?:\.\d+)?|-?\d*\.?\d+/g;

/* "double it" / "halve this" carry a factor with no digits in sight. */
const MULTIPLIERS = { double: 2, doubling: 2, twice: 2, triple: 3, tripling: 3, treble: 3, quadruple: 4, halve: 0.5, half: 0.5, halving: 0.5 };

const TO_WORDS = /\b(?:to|into|in|as)\b/i;

/* A currency is the symbol written in front of an amount, kept as it was typed
   so "£84.50" is answered in pounds rather than as a bare number. Undefined
   when the skill has no `currency` choice or the message writes none. */
export function writtenCurrency (skill, message) {
  const def = skill && skill.inputSchema && skill.inputSchema.properties && skill.inputSchema.properties.currency;
  if (!def || !Array.isArray(def.enum)) return undefined;
  const sym = (String(message || '').match(/[£$€₹¥](?=\s*\d)/) || [])[0];
  return sym && def.enum.includes(sym) ? sym : undefined;
}

export function jsExtractor (registry) {
  const extract = async ({ message, skill, input = {}, ctx = {}, needField = null, untraceable = [] }) => {
    const schema = skill.inputSchema || {};
    const props = schema.properties || {};
    const required = schema.required || [];
    const patch = {};

    const unset = (f) => input[f] === undefined || input[f] === null || input[f] === '';
    /* `needField` is a field the SKILL asked for at run time — one the schema
       could not mark required because whether it is needed depends on the other
       values. It joins the missing list so the probe below will hunt for it. */
    /* A field the audit dropped was invented by the planner; refilling it from
       the message is the same invention by another route (the numbers in
       "smooth this over a 5 point window" are not the series). Arrays and
       numbers included — matchString already knew this, the others did not. */
    const missing = required.filter(unset).filter(f => !untraceable.includes(f));
    if (needField && !missing.includes(needField) && !untraceable.includes(needField)) missing.push(needField);
    /* Optional fields are filled ONLY from an explicit cue, never from a
       leftover number. "what is (18.5 * 12) / 4" has three spare numbers and an
       optional `decimals`; taking one positionally silently rounded the answer
       to 19 decimal places. An optional field the user did not mention should
       stay at its default. */
    const optional = Object.keys(props).filter(f => !required.includes(f) && unset(f) && !untraceable.includes(f));

    if (!missing.length && !optional.length) return patch;

    const msg = String(message || '');
    const numbers = (msg.match(NUMBER_RE) ?? []).map(s => Number(s.replace(/,/g, ''))).filter(Number.isFinite);
    /* Numbers are claimed by CUE first and by position only afterwards.
       "split an 84.50 bill 4 ways with 15% tip" has its numbers in the order
       84.50, 4, 15 and its fields in the order bill, tipPercent, people — so
       pure positional assignment produces a 4% tip for 15 people, which is
       both wrong and perfectly plausible-looking. The cues below read the
       words AROUND each number, which is where the meaning actually is. */
    const claimed = new Set();
    const claim = (n) => { claimed.add(n); return n; };
    const cued = (patterns) => {
      for (const re of patterns) {
        const m = re.exec(msg);
        if (!m) continue;
        const n = Number(String(m[1]).replace(/,/g, ''));
        if (Number.isFinite(n) && !claimed.has(n)) return claim(n);
      }
      return undefined;
    };
    const cueFor = (field) => {
      if (/percent|tip|rate|tax|discount|interest/i.test(field)) {
        return cued([/([\d.]+)\s*%/, /([\d.]+)\s*per\s?cent/i, /(?:tip|tax|rate|discount)\D{0,12}?([\d.]+)/i]);
      }
      if (/people|parts|ways|persons|count|players|guests/i.test(field)) {
        return cued([/([\d]+)\s*(?:ways|people|persons|guests|players|parts|of us)\b/i, /(?:between|among|split)\s+([\d]+)\b/i]);
      }
      if (/bill|price|amount|total|value|subtotal/i.test(field)) {
        return cued([/[£$€₹¥]\s*([\d,]*\.?\d+)/, /([\d,]*\.?\d+)\s*(?:bill|total|subtotal)\b/i]);
      }
      if (/seed/i.test(field)) return cued([/seed\D{0,6}?([\d]+)/i]);
      if (/^radius$/i.test(field)) {
        /* "30cm across", "a diameter of 30": people give a diameter at least as
           often as a radius, and the skill asks for the radius. Halving is a
           derivation, not a guess, and the reply shows the radius it used. */
        const r = cued([/radius\D{0,8}?([\d.]+)/i]);
        if (r !== undefined) return r;
        const d = cued([/([\d.]+)\s*(?:cm|mm|m|km|in|inch|inches|ft|feet|")?\s*(?:across|wide|in diameter|diameter)\b/i, /diameter\D{0,8}?([\d.]+)/i]);
        return d === undefined ? undefined : d / 2;
      }
      if (/places|decimals|digits|limit/i.test(field)) {
        const n = cued([/([\d]+)\s*(?:decimal|significant|dp\b|places?)/i, /to\s+([\d]+)\s*(?:decimal|significant)/i]);
        /* "to the nearest whole number" is 0 places, said without a digit. */
        if (n === undefined && /places|decimals/i.test(field) && /\bto\s+(?:the\s+)?(?:nearest\s+)?(?:a\s+)?(?:whole(?:\s+number)?|integer)\b/i.test(msg)) return 0;
        return n;
      }
      return undefined;
    };
    let numberCursor = 0;
    const takeNumber = () => {
      while (numberCursor < numbers.length && claimed.has(numbers[numberCursor])) numberCursor++;
      return numberCursor < numbers.length ? claim(numbers[numberCursor++]) : undefined;
    };

    /* Conversions are the one shape worth a dedicated pattern, because they are
       the most common multi-argument request and the argument ORDER is carried
       by a word ("26.2 miles to km") rather than by position. Getting from/to
       backwards is a wrong answer that looks like a right one. */
    const conv = matchConversion(msg);

    /* Dates are consumed left to right, exactly like numbers. Without a cursor,
       every date field ran the same scan and got the same answer: "how many days
       between 12 july 2026 and christmas" filled BOTH `from` and `to` with
       12 July and reported "0 days between July 12 2026 and July 12 2026" — a
       confidently wrong answer, which is the one outcome worse than a question.
       With the cursor, `to` finds no second date, and the turn ends in ASK_USER. */
    let dateCursor = 0;

    /* Two passes over the fields, and the order matters. Every CUED number is
       claimed first, then the positional pass takes what is left. Running them
       interleaved in schema order let an earlier field grab a number a later
       field had an explicit cue for: "25% off an 80 jacket" has `price` before
       `percent` in the schema, so price took 25 — the percentage — and the
       jacket cost 80 with a 25 discount, which is a different question. */
    const cueHits = new Map();
    for (const field of [...missing, ...optional]) {
      const def = props[field] || {};
      if (def.type !== 'number' && def.type !== 'integer') continue;
      const hit = /factor/i.test(field) ? (matchMultiplier(msg) ?? cueFor(field)) : cueFor(field);
      if (hit !== undefined) cueHits.set(field, def.type === 'integer' ? Math.round(hit) : hit);
    }

    for (const field of [...missing, ...optional]) {
      const def = props[field] || {};
      const isRequired = required.includes(field);
      let value = cueHits.get(field);

      if (value === undefined) {
        if (conv && field === 'amount' && conv.amount !== undefined) value = claim(conv.amount);
        else if (conv && field === 'from' && conv.from) value = conv.from;
        else if (conv && field === 'to' && conv.to) value = conv.to;
      }

      /* A currency is the symbol written in front of the amount, kept as it was
         typed so "£84.50" is answered in pounds rather than as a bare number. */
      if (value === undefined && field === 'currency') value = writtenCurrency(skill, msg);
      if (value === undefined && def.enum) value = matchEnum(msg, def.enum);

      if (value === undefined && (def.type === 'number' || def.type === 'integer')) {
        value = isRequired ? takeNumber() : undefined;
        if (def.type === 'integer' && value !== undefined) value = Math.round(value);
      }

      if (value === undefined && isRequired && def.type === 'array') {
        const items = def.items || {};
        if (items.type === 'number' || items.type === 'integer') {
          /* All the numbers, not the cursor — a list field wants the list. */
          value = numbers.length ? numbers.slice() : undefined;
        } else {
          const listed = splitList(msg);
          if (listed.length > 1) value = listed;
        }
      }

      if (value === undefined && isRequired && def.type === 'string') {
        const before = dateCursor;
        const got = matchString(msg, field, def, ctx, { from: dateCursor, advance: (n) => { dateCursor = n; } },
          { untraceable: untraceable.includes(field) });
        if (got === undefined) dateCursor = before;
        value = got;
      }
      if (value === undefined && def.type === 'boolean') value = matchBoolean(msg, field);

      if (value !== undefined) patch[field] = value;
    }

    /* PROBE. A guessed string can pass the schema and still be wrong — a
       `query` field happily accepts "what is the capital of Switzerland", and
       countryLookup then reports that no such country exists. Skills are pure
       (§3.3), so the extractor can simply ASK the skill: try the plausible
       substrings and keep the first one the skill actually accepts. This is the
       kind of check code can do cheaply and a model would only guess at. */
    for (const field of missing) {
      const def = props[field] || {};
      if (def.type !== 'string' || typeof skill.run !== 'function') continue;

      const trial = { ...input, ...patch };
      if (patch[field] === undefined) {
        /* Nothing was placed at all — probe from scratch. This is the "what
           does GBP stand for" case: no pattern names the argument, but the
           skill can recognise it the moment it sees it. */
        if (field !== needField && !onlyMissing(skill, trial, field)) continue;
      } else {
        const tv = validate(skill.inputSchema, trial);
        if (!tv.ok) continue;
        let env;
        try { env = await skill.run(tv.value, ctx); } catch { continue; }
        /* Only re-probe when the skill rejected THIS field. A skill that
           succeeded, or failed on something else, has nothing to say here. */
        if (!env || env.ok || (env.error && env.error.field !== field)) continue;
      }

      for (const cand of stringCandidates(msg)) {
        const attempt = { ...trial, [field]: cand };
        const v = validate(skill.inputSchema, attempt);
        if (!v.ok) continue;
        let out;
        try { out = await skill.run(v.value, ctx); } catch { continue; }
        if (out && out.ok) { patch[field] = cand; break; }
      }
    }

    /* Never hand back a patch that makes things worse. If applying it produces
       MORE validation errors than not applying it, drop it — a bad guess that
       passes the type check is exactly the kind of confident wrongness this
       whole design exists to prevent. */
    const before = validate(skill.inputSchema, input).errors.length;
    const after = validate(skill.inputSchema, { ...input, ...patch }).errors.length;
    return after <= before ? patch : {};
  };

  extract.backend = 'javascript (schema-driven)';
  void registry;
  return extract;
}

/** "26.2 miles to km", "100 EUR in USD", "180 celsius to fahrenheit" */
function matchConversion (msg) {
  const clean = (s) => (s || '').trim().replace(/[.,?!]$/, '');
  let amount, from, to;

  /* Reversed phrasing FIRST — "how many km is 26.2 miles" names the target
     before the source, and the forward pattern below would read it as
     "km → miles" with the numbers attached to the wrong end. People ask this
     way at least as often as the other. */
  const rev = /how\s+many\s+([A-Za-z°/²³µ]+(?:\s+[A-Za-z]+)?)\s+(?:is|are|in|would)\s+(-?[\d,]*\.?\d+)\s*([A-Za-z°/²³µ]+(?:\s+[A-Za-z]+)?)/i.exec(msg);
  if (rev) {
    amount = Number(rev[2].replace(/,/g, ''));
    to = clean(rev[1]);
    from = clean(rev[3]);
  } else {
    const m = /(-?[\d,]*\.?\d+)\s*([A-Za-z°/²³µ]+(?:\s+[A-Za-z]+)?)?\s*\b(?:to|into|in|as)\b\s*([A-Za-z°/²³µ]+(?:\s+[A-Za-z]+)?)/i.exec(msg);
    if (!m) return null;
    amount = Number(m[1].replace(/,/g, ''));
    from = clean(m[2]);
    to = clean(m[3]);
  }
  if (!Number.isFinite(amount)) return null;

  /* The trailing phrase often runs on ("to km please"). Keep the longest
     leading fragment that actually resolves to a unit or a currency code. */
  to = firstResolvable(to) ?? to;
  from = firstResolvable(from) ?? from;
  if (!from || !to) return null;
  return { amount, from, to };
}

function firstResolvable (phrase) {
  const parts = String(phrase).split(/\s+/).filter(Boolean);
  for (let n = parts.length; n >= 1; n--) {
    const cand = parts.slice(0, n).join(' ');
    if (resolveUnit(cand) || /^[A-Za-z]{3}$/.test(cand)) return cand;
  }
  return null;
}

function matchEnum (msg, values) {
  const lower = msg.toLowerCase();
  /* Longest first, so "significant figures" wins over "figures" and
     "descending" is never matched by a substring of something else. */
  const sorted = [...values].sort((a, b) => String(b).length - String(a).length);
  for (const v of sorted) {
    const s = String(v).toLowerCase();
    if (!s) continue;
    const re = new RegExp(`\\b${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (re.test(lower)) return v;
  }
  /* A few words people use for enum values they don't name literally. */
  const SYNONYMS = {
    descending: /\b(?:biggest|largest|highest|most|desc|reverse)\b/i,
    ascending: /\b(?:smallest|lowest|least|asc|alphabetical)\b/i,
    months: /\bmonths?\b/i, years: /\byears?\b/i, weeks: /\bweeks?\b/i, days: /\bdays?\b/i,
    upper: /\b(?:uppercase|shout|caps|all caps)\b/i,
    lower: /\b(?:lowercase)\b/i,
    average: /\b(?:mean|avg)\b/i,
    sum: /\b(?:total|add up|adds up)\b/i,
    previous: /\b(?:last|previous|before)\b/i
  };
  for (const v of sorted) {
    const re = SYNONYMS[String(v)];
    if (re && re.test(msg)) return v;
  }
  return undefined;
}

function matchMultiplier (msg) {
  const lower = msg.toLowerCase();
  for (const [word, factor] of Object.entries(MULTIPLIERS)) {
    if (new RegExp(`\\b${word}\\b`).test(lower)) return factor;
  }
  const x = /(\d+(?:\.\d+)?)\s*(?:x|×|times)\b/i.exec(msg);
  return x ? Number(x[1]) : undefined;
}

function matchBoolean (msg, field) {
  const human = field.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
  if (new RegExp(`\\bno ${human}\\b|\\bwithout ${human}\\b`, 'i').test(msg)) return false;
  if (new RegExp(`\\b${human}\\b`, 'i').test(msg)) return true;
  return undefined;
}

/** Quoted text, a colon tail, or line-separated items. */
function splitList (msg) {
  const afterColon = /:\s*([\s\S]+)$/.exec(msg);
  const body = afterColon ? afterColon[1] : msg;
  if (/\n/.test(body)) return body.split('\n').map(s => s.trim()).filter(Boolean);
  if (body.includes(',')) return body.split(',').map(s => s.trim()).filter(Boolean);
  return [];
}

/* "this csv", "these rows", "that file": the message POINTS AT a payload
   rather than containing one. When nothing follows a colon, nothing is quoted
   and there is no second line, the payload is not here — and handing the
   sentence itself to a CSV parser is how "read this csv into columns" became
   a header-only CSV with a data error instead of a question. */
const POINTS_AT_ABSENT_PAYLOAD = /\bth(?:is|ese|at|ose)\s+(?:csv|json|yaml|xml|html|markdown|md|table|rows?|columns?|data|dataset|file|document|doc|text|paragraph|passage|list|blob|string|config|settings|content|payload|log|output|input|spreadsheet|sheet|notes?|email|message|essay|article|draft|code|snippet|function|script|env|\.env)\b/i;
function pointsAtAbsentPayload (msg) {
  return POINTS_AT_ABSENT_PAYLOAD.test(msg) && !/:\s*\S/.test(msg) && !/["“”']([^"“”']{2,})["“”']/.test(msg) && !/\n/.test(msg);
}

function matchString (msg, field, def, ctx, cursor = { from: 0, advance: () => {} }, hint = {}) {
  /* Explicitly quoted text is the user pointing at the argument. Always wins. */
  const quoted = /["“”']([^"“”']{2,})["“”']/.exec(msg);
  if (quoted) return quoted[1];

  const wantsDate = /date|birth|from|to|on|day/i.test(field) &&
    (/date/i.test(def.description || '') || /date/i.test(def.prompt || ''));
  if (wantsDate) {
    const found = findDate(msg, ctx, cursor.from);
    if (found) { cursor.advance(found.end); return found.text; }
    /* No date left in the message. Returning undefined sends this field to
       ASK_USER, which is the correct escalation — reusing an earlier date
       would answer the wrong question. */
    return undefined;
  }

  /* An arithmetic expression is a recognisable SHAPE, not the leftover text:
     the longest run of digits, operators and brackets that contains at least
     one operator. Handing the whole sentence to the parser would fail on the
     first English word, and handing it the text after a colon only works when
     the user typed one. */
  if (field === 'expression') {
    const runs = msg.match(/[-+*/^()%.,\d\s]*\d[-+*/^()%.,\d\s]*/g) ?? [];
    const best = runs.map(r => r.trim())
      .filter(r => /[-+*/^]/.test(r) && /\d/.test(r))
      .sort((a, b) => b.length - a.length)[0];
    if (best) return best;
  }

  /* A field that wants the whole text takes what is left after a colon, or the
     message itself — unless the message merely points at a payload it does not
     contain, or the planner's value for this field was just found NOT to be in
     the message (`hint.untraceable`), in which case the message is the request
     and not the data, and the right answer is to ask. */
  if (/^(?:text|notation|query|code|find|replace)$/.test(field)) {
    const afterColon = /:\s*([\s\S]+)$/.exec(msg);
    if (afterColon) return afterColon[1].trim();
    if (hint.untraceable || pointsAtAbsentPayload(msg)) return undefined;
    if (field === 'text' || field === 'query') return msg.trim();
  }
  return undefined;
}

/* Scans left to right for the first substring lib/dates.js accepts. Bounded to
   short windows so it cannot accidentally swallow the whole sentence. */
function findDate (msg, ctx, from = 0) {
  /* Walks token starts so the returned `end` is an index into the ORIGINAL
     string, which is what lets the caller resume past a date it already used. */
  const re = /\S+/g;
  const starts = [];
  let m;
  while ((m = re.exec(msg)) !== null) starts.push({ text: m[0], at: m.index });

  for (let i = 0; i < starts.length; i++) {
    if (starts[i].at < from) continue;
    for (let n = Math.min(4, starts.length - i); n >= 1; n--) {
      const last = starts[i + n - 1];
      const raw = msg.slice(starts[i].at, last.at + last.text.length);
      const cand = raw.replace(/[.,?!]+$/, '');
      if (cand.length < 3) continue;
      if (parseDate(cand, ctx).ok) {
        return { text: cand, end: starts[i].at + cand.length };
      }
    }
  }
  return null;
}

/* True when `field` is the ONLY thing standing between this input and a valid
   call — probing is only worth it when filling one field completes the input,
   and it bounds the work to one field at a time. */
function onlyMissing (skill, input, field) {
  const errs = validate(skill.inputSchema, input).errors;
  return errs.length > 0 && errs.every(e => e.field === field);
}

/* Plausible sub-phrases of a message, most-specific first, capped so probing
   stays cheap. Capitalised words and all-caps tokens come first because that is
   what proper nouns and codes look like. */
function stringCandidates (msg) {
  const out = [];
  const push = (v) => { const t = String(v).trim().replace(/[.,?!]+$/, ''); if (t.length > 1 && !out.includes(t)) out.push(t); };

  /* Punctuation-joined runs FIRST, before the bare tokens they contain.
     "rewrite 2026-11-14 as DD/MM/YYYY" offered DD, MM and YYYY as three
     separate candidates, and the probe accepts the first one the skill
     tolerates — so formatDate happily formatted the date as "14". A run like
     DD/MM/YYYY is a single argument that happens to contain valid smaller
     ones, and the longer reading is the one the user typed. */
  for (const m of msg.matchAll(/\b[A-Za-z]{1,4}(?:[/\-.:][A-Za-z]{1,4})+\b/g)) push(m[0]);
  for (const m of msg.matchAll(/\b[A-Z]{2,4}\b/g)) push(m[0]);
  for (const m of msg.matchAll(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*/g)) push(m[0]);

  const tokens = msg.split(/\s+/).filter(Boolean);
  for (let n = 3; n >= 1; n--) {
    if (tokens.length >= n) push(tokens.slice(-n).join(' '));
  }
  for (const t of tokens) push(t);
  return out.slice(0, 16);
}
