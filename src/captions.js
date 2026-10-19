/* captions.js — what a machine-made transcript gets wrong, and which of it
 * can be fixed without guessing.
 *
 * Calibrated against real files rather than an idea of one, and the real files
 * moved the design. An auto-transcript's problem is NOT missing punctuation.
 * Zoom and Whisper both punctuate. Their problem is punctuation in the WRONG
 * PLACE, a speaker label repeated on all 138 cues, sentences cut in half by
 * the caption chunker, and stutters the microphone heard exactly right.
 *
 * (Named for the files it reads. `transcript.js` is the clipboard helper and
 * has nothing to do with this.)
 *
 * That splits the work in two, and the split is the whole point of putting
 * this in the verified lane:
 *
 *   FUNCTIONS (here)    cue numbers, timestamps, the repeated label, rejoining
 *                       a sentence the chunker cut, stutters, fillers. All of
 *                       it deletion or reassembly, none of it a guess, and
 *                       every removal counted so the person can see it.
 *
 *   THE MODEL (later)   where a sentence really ends, where a paragraph turns,
 *                       and a mangled name — "Palewave.com" arriving as "full. Dot
 *                       com" with an invented full stop inside it. Judgement,
 *                       every time, which is why it is audited.
 *
 * Nothing here writes a word that was not already in the transcript.
 */

/* ── what shape is it? ───────────────────────────────────────────────────── */

/* Three generators, three layouts, all of them seen in the wild:
     webvtt      a WEBVTT header, a cue number, 00:00:02.440 --> 00:00:22.199
     srt         the same with a comma before the milliseconds
     bracketed   [0:00:00 --> 0:00:05] and the text on the same line
   Anything else is treated as prose that happens to be spoken. */
const VTT_TIME = /(\d{1,2}:)?\d{1,2}:\d{2}[.,]\d{1,3}\s*-->\s*(\d{1,2}:)?\d{1,2}:\d{2}[.,]\d{1,3}/;
const BRACKET_TIME = /^\s*\[\s*(\d{1,2}:)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?\s*-->\s*(\d{1,2}:)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?\s*\]\s*/;
const CUE_NUMBER = /^\s*\d{1,5}\s*$/;

export function detectFormat (text) {
  const s = String(text ?? '');
  if (/^﻿?WEBVTT/.test(s)) return 'webvtt';
  if (BRACKET_TIME.test(s.split('\n').find(l => l.trim()) || '')) return 'bracketed';
  if (VTT_TIME.test(s)) return /,\d{1,3}\s*-->/.test(s) ? 'srt' : 'webvtt';
  return 'plain';
}

/* A speaker label is "Name:" at the very start of a cue. The length cap alone
   is not enough, and a test says so: "There is one rule that matters here:"
   is 36 characters and was being read as somebody's name. A real label is a
   NAME, so it is also short in WORDS — "Dana Holloway", "Ana Ruiz",
   "Speaker 1". Four is generous and a clause almost never fits in it. */
const SPEAKER = /^([^:\n]{1,40}):\s+/;
/* Four words is still not enough on its own: "My conclusion is this:" fits.
   What a name never contains is a function word, so one in the label vetoes
   it. Kept deliberately short — "Me" and "Art" are things people are called,
   so neither is here. */
const NOT_IN_A_NAME = new Set(['is', 'are', 'was', 'were', 'the', 'a', 'an', 'my', 'our',
  'this', 'that', 'these', 'those', 'it', 'to', 'of', 'and', 'but', 'so', 'we',
  'you', 'they', 'here', 'there', 'what', 'why', 'how', 'if', 'then', 'because']);
const looksLikeName = (s) => {
  const words = s.trim().split(/\s+/);
  return words.length <= 4
    && words.every(w => /^[A-Za-z0-9][\w'’.-]*$/.test(w))
    && !words.some(w => NOT_IN_A_NAME.has(w.toLowerCase().replace(/[.'’-]+$/, '')));
};

/** Every cue, in order, with its label lifted off the text. */
export function parseCues (text) {
  const s = String(text ?? '').replace(/\r\n?/g, '\n').replace(/^﻿/, '');
  const format = detectFormat(s);
  const cues = [];

  if (format === 'bracketed') {
    for (const block of s.split(/\n\s*\n/)) {
      const line = block.trim();
      if (!line) continue;
      const m = line.match(BRACKET_TIME);
      const body = m ? line.slice(m[0].length) : line;
      cues.push(cueOf(body, m ? m[0].trim() : null));
    }
    return { format, cues: inheritSpeakers(cues) };
  }

  if (format === 'webvtt' || format === 'srt') {
    for (const block of s.split(/\n\s*\n/)) {
      const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
      if (!lines.length) continue;
      if (/^WEBVTT/.test(lines[0])) lines.shift();
      if (lines.length && CUE_NUMBER.test(lines[0])) lines.shift();
      let stamp = null;
      if (lines.length && VTT_TIME.test(lines[0])) stamp = lines.shift();
      if (!lines.length) continue;
      cues.push(cueOf(lines.join(' '), stamp));
    }
    return { format, cues: inheritSpeakers(cues) };
  }

  /* Plain prose: one cue a paragraph, so everything downstream has one shape
     to work with rather than two. */
  for (const para of s.split(/\n\s*\n/)) {
    if (para.trim()) cues.push(cueOf(para.trim(), null));
  }
  return { format, cues };
}

function cueOf (body, stamp) {
  const raw = String(body).match(SPEAKER);
  const m = raw && looksLikeName(raw[1]) ? raw : null;
  return {
    stamp,
    speaker: m ? m[1].trim() : null,
    labelled: Boolean(m),
    text: (m ? body.slice(m[0].length) : body).trim()
  };
}

/* An unlabelled cue continues whoever was last speaking. Without this a single
   unlabelled cue in the middle of a monologue splits it into three blocks, and
   a real 34-cue file with two of them came out as five. The distinction is
   kept on `labelled` rather than thrown away, because "the file said so" and
   "we worked it out" are not the same claim. */
function inheritSpeakers (cues) {
  let current = null;
  for (const c of cues) {
    if (c.speaker) current = c.speaker;
    else c.speaker = current;
  }
  return cues;
}

/* Worth telling the router about: is this even a transcript? Cheap, and it is
   what stops the skill firing on an ordinary paragraph. */
export function isTranscript (text) {
  const s = String(text ?? '');
  if (!s.trim()) return false;
  const { format, cues } = parseCues(s);
  if (format !== 'plain') return cues.length >= 2;
  /* No timestamps: fall back to the other tell, a label on most lines. */
  const labelled = cues.filter(c => c.speaker).length;
  return cues.length >= 3 && labelled >= cues.length * 0.6;
}

/* Is this worth offering to tidy?
 *
 * Stricter than `isTranscript`, and on purpose. A two-cue snippet IS a
 * transcript and is also not worth interrupting somebody over — an offer that
 * appears when it is not wanted is worse than one that never appears, because
 * the second costs nothing and the first has to be dismissed every time.
 *
 * The number is a judgement, not a measurement: 400 characters is roughly
 * thirty seconds of speech, below which the caption breaks are a nuisance
 * rather than a problem.
 */
export const OFFER_MIN_CHARS = 400;

export function worthTidying (text) {
  const t = String(text ?? '');
  return t.length >= OFFER_MIN_CHARS && isTranscript(t);
}

/* ── the repeated label ──────────────────────────────────────────────────── */

/** Cue labels in speaking order, with a run of the same speaker collapsed. */
export function speakerRuns (cues) {
  const runs = [];
  for (const c of cues) {
    const last = runs[runs.length - 1];
    if (last && last.speaker === c.speaker) last.cues.push(c);
    else runs.push({ speaker: c.speaker, cues: [c] });
  }
  return runs;
}

/* ── rejoining what the chunker cut ──────────────────────────────────────── */

/* A caption chunker breaks on a time budget, not a sentence, so a cue very
   often ends mid-clause. Joining on "the previous cue did not end in
   terminal punctuation" is right far more often than it is wrong, and when it
   is wrong the model's boundary pass gets a second look at it anyway. */
const ENDS_SENTENCE = /[.!?…]["')\]]?\s*$/;

export function joinRun (cues) {
  let out = '';
  for (const c of cues) {
    const t = c.text.trim();
    if (!t) continue;
    if (!out) { out = t; continue; }
    out += ENDS_SENTENCE.test(out) ? ' ' : ' ';
  /* One space either way today. The distinction is kept because the boundary
     pass wants to know which joins were mid-sentence, and that is recorded
     separately rather than smuggled into the whitespace. */
    out += t;
  }
  return out;
}

/** Which joins were mid-sentence — the model's shortlist of places a sentence
    boundary may be missing. */
export function midSentenceJoins (cues) {
  let n = 0;
  for (let i = 1; i < cues.length; i++) {
    if (cues[i - 1].text.trim() && !ENDS_SENTENCE.test(cues[i - 1].text.trim())) n++;
  }
  return n;
}

/* ── stutters ────────────────────────────────────────────────────────────── */

/* A doubled word is nearly always the speaker restarting, but not always:
   "had had", "that that" and a few others are ordinary English, and cutting
   them changes the sentence. Small allowlist, and the rest go.
 *
 * ONE CORNER THIS GETS WRONG, and it is worth knowing rather than hiding. When
 * the transcriber has already lost a sentence boundary, "...with it. It
 * smelled..." arrives as "with it it smelled" and one "it" is removed here as
 * a stutter. The word is gone before anything can tell it was two sentences.
 * It needs a lost boundary AND the same word either side of it, which is rare,
 * and the alternative — keeping every doubled word — costs far more often than
 * it saves. Measured: 2 of 300 generated passages hit it. */
const REAL_DOUBLES = new Set(['had', 'that', 'very', 'no', 'so', 'ha', 'blah']);
const WORD = /[A-Za-z']+/;

export function stripStutters (text) {
  const s = String(text ?? '');
  const removed = [];
  /* Two identical words in a row, same word boundary, case-insensitive, with
     nothing but a space between them. Punctuation between them means the
     speaker stopped, which is not a stutter. */
  const out = s.replace(/\b([A-Za-z']+)(\s+)(\1)\b/gi, (m, first, gap, second) => {
    if (REAL_DOUBLES.has(first.toLowerCase())) return m;
    if (!WORD.test(first)) return m;
    removed.push(first);
    return first;
  });
  return { text: out, removed };
}

/* ── fillers ─────────────────────────────────────────────────────────────── */

/* Three tiers, and the tiering is the honest part. "um" is never anything but
   filler. "you know" is filler most of the time. "like" and "right" are
   ordinary words that a filler list would quietly eat, so they stay, and the
   skill says so rather than pretending the job is finished. */
export const FILLERS = {
  always: ['um', 'umm', 'uh', 'uhh', 'erm', 'ah', 'mm', 'mhm', 'hmm'],
  usually: ['you know', 'i mean', 'sort of', 'kind of', 'or something', 'or whatever'],
  left_alone: ['like', 'right', 'actually', 'basically', 'literally', 'well', 'so']
};

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/* Compiled once, at module load, rather than per call — `stripFillers` runs
   once per speaker turn, and the phrase lists never change underneath it. */
const ALWAYS_RE = FILLERS.always.map(f => [f, new RegExp(`\\b${escapeRe(f)}\\b[,]?\\s*`, 'gi')]);
const USUALLY_RE = FILLERS.usually.map(f => [
  f,
  new RegExp(`,\\s*${escapeRe(f)}\\s*,`, 'gi'),
  new RegExp(`\\b${escapeRe(f)}\\s*,\\s*`, 'gi')
]);

export function stripFillers (text, { usually = true } = {}) {
  let s = String(text ?? '');
  const removed = [];

  for (const [f, re] of ALWAYS_RE) {
    /* Anchored to a word boundary and allowed to take a trailing comma with
       it, so "um, so" does not become ", so". */
    s = s.replace(re, () => {
      removed.push(f); return '';
    });
  }

  if (usually) {
    for (const [f, betweenCommas, leading] of USUALLY_RE) {
      /* Only between commas, or leading a clause. "kind of person" keeps its
         "kind of"; "it was, kind of, slow" loses it. This is the whole reason
         the tier exists. */
      s = s.replace(betweenCommas, () => {
        removed.push(f); return ', ';
      });
      s = s.replace(leading, () => {
        removed.push(f); return '';
      });
    }
  }

  s = s.replace(/[^\S\n]{2,}/g, ' ').replace(/\s+([,.!?;:])/g, '$1');
  /* A cue that began with a filler now begins with a lowercase letter that
     used to be mid-sentence. Recasing is the boundary pass's job, not this
     one's, so it is left visibly alone. */
  return { text: s.trim(), removed };
}

/* ── the whole deterministic pass ────────────────────────────────────────── */

/**
 * Everything that can be done without guessing, with a receipt.
 * The `text` it returns is what the model is then asked to punctuate and
 * paragraph — so this is also exactly what the training data must look like.
 */
export function mechanicalClean (raw, { usually = true, stutters = true } = {}) {
  const { format, cues } = parseCues(raw);
  const runs = speakerRuns(cues);
  const midJoins = midSentenceJoins(cues);

  const removed = { fillers: [], stutters: [] };
  const blocks = runs.map(run => {
    let text = joinRun(run.cues);
    if (stutters) {
      const s = stripStutters(text);
      text = s.text; removed.stutters.push(...s.removed);
    }
    const f = stripFillers(text, { usually });
    text = f.text; removed.fillers.push(...f.removed);
    return { speaker: run.speaker, text };
  }).filter(b => b.text.trim());

  const speakers = [...new Set(cues.map(c => c.speaker).filter(Boolean))];
  const text = blocks
    .map(b => (speakers.length > 1 && b.speaker ? `${b.speaker}: ${b.text}` : b.text))
    .join('\n\n');

  return {
    text,
    format,
    speakers,
    blocks,
    stats: {
      cues: cues.length,
      blocks: blocks.length,
      midSentenceJoins: midJoins,
      fillersRemoved: removed.fillers.length,
      stuttersRemoved: removed.stutters.length,
      charsBefore: String(raw ?? '').length,
      charsAfter: text.length
    },
    removed
  };
}

/* ── auditing the model's half ───────────────────────────────────────────── */

/* The check that makes this safe, and it is sharper than the OCR one.
 *
 * Putting sentence boundaries, capitals and paragraph breaks in the right
 * places does not change a single LETTER. Strip the punctuation, the spacing
 * and the case, and a faithful repair is byte-identical to what it was given.
 * So the letter stream is a complete test of the core task: no threshold, no
 * ratio, no judgement.
 *
 * Only one legitimate repair moves it — a name the transcriber split, where
 * "pail. Wave com" should come back "Palewave.com" and the letters really do change.
 * That is a word-level edit and it is shown to the person as one rather than
 * waved through, because it is precisely the place where a repair becomes a
 * guess. A handful is a name; a hundred is the model rewriting the transcript.
 *
 * This is why the same guard could not be written for OCR: there, every word
 * on the page might genuinely have been misread, so a total replacement and a
 * total repair are indistinguishable. Here the words arrive mostly right.
 */
/* The apostrophe counts. It looks like punctuation and is not: "its" and
   "it's" are different words, and a check that folds them together lets the
   model change one into the other with nothing to show for it. Measured — that
   is exactly what escaped once. */
const letters = (t) => String(t ?? '').toLowerCase().replace(/[’]/g, "'").replace(/[^a-z0-9']+/g, '');

/* Which words actually changed, so a repair is never accepted silently.
   A name the transcriber split cannot be repaired without changing words —
   "pail. Wave com" has to become "Palewave.com" — so the audit cannot forbid that
   and stay useful. What it CAN do is refuse to let one happen unnoticed: every
   word that appeared or vanished is named, and the caller shows them. */
export function changedWords (before, after) {
  const bag = (t) => String(t ?? '').toLowerCase().replace(/[’]/g, "'").match(/[a-z0-9']+/g) || [];
  const count = (list) => list.reduce((m, w) => m.set(w, (m.get(w) || 0) + 1), new Map());
  const b = count(bag(before));
  const a = count(bag(after));
  const added = [];
  const removed = [];
  for (const [w, n] of a) { const d = n - (b.get(w) || 0); for (let i = 0; i < d; i++) added.push(w); }
  for (const [w, n] of b) { const d = n - (a.get(w) || 0); for (let i = 0; i < d; i++) removed.push(w); }
  return { added, removed };
}

/* Levenshtein, banded: anything further apart than `max` is not a name repair
   and the exact distance stops being interesting, so it gives up and says so.
   Without the band this is O(n²) on a 20,000-character transcript. */
export function boundedEdits (a, b, max) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = new Array(b.length + 1);
  let cur = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    const from = Math.max(1, i - max);
    const to = Math.min(b.length, i + max);
    if (from > 1) cur[from - 1] = max + 1;
    for (let j = from; j <= to; j++) {
      cur[j] = a[i - 1] === b[j - 1]
        ? prev[j - 1]
        : 1 + Math.min(prev[j - 1], prev[j], cur[j - 1]);
    }
    for (let j = to + 1; j <= b.length; j++) cur[j] = max + 1;
    if (Math.min(...cur.slice(from, to + 1)) > max) return max + 1;
    [prev, cur] = [cur, prev];
  }
  return prev[b.length];
}

const ECHOED_INSTRUCTION = [
  'repair this transcript', 'reply with the repaired', 'do not add, remove',
  'leave every number exactly'
];

/**
 * Why the repair should be thrown out, or null to accept it.
 * `edits` on the returned object says how far the letters moved, so a caller
 * can show "two words were changed" beside an accepted repair.
 */
export function auditRepair (before, after, { truncated = false, maxNameEdits = 24 } = {}) {
  const b = String(before ?? '');
  const a = String(after ?? '');
  const say = (reason, edits = 0) => ({ reason, edits, changed: { added: [], removed: [] } });

  if (!a.trim()) return say('the model returned nothing');
  if (truncated) return say('it ran out of room before it finished');

  const low = a.toLowerCase();
  if (ECHOED_INSTRUCTION.some(p => low.includes(p) && !b.toLowerCase().includes(p))) {
    return say('it handed back the instructions instead of the transcript');
  }

  /* Every figure, unchanged. A transcript is full of them and none of them is
     the model's to revise. Same rule the OCR tidy keeps. */
  const nums = (t) => (String(t).match(/\d[\d.,]*\d|\d/g) || []).map(s => s.replace(/[.,]+$/, ''));
  const nb = nums(b).join(' ');
  const na = nums(a).join(' ');
  if (nb !== na) return say(`a figure changed: "${nb}" became "${na}"`);

  const lb = letters(b);
  const la = letters(a);
  if (lb === la) {
    /* Identical letters is not quite the same as "nothing changed". Rejoining
       a word the transcriber split — "americ an" back into "american" — moves
       no letter at all and yet is a word-level repair, and it slipped through
       undisclosed three times before this branch existed. Faithful, welcome,
       and still the person's business. */
    const changed = changedWords(b, a);
    if (!changed.added.length && !changed.removed.length) return null;
    return { reason: null, edits: 0, changed };
  }

  const edits = boundedEdits(lb, la, maxNameEdits);
  if (edits > maxNameEdits) {
    return { reason: 'it rewrote the words rather than repunctuating them', edits, changed: changedWords(b, a) };
  }
  /* Accepted, and the caller is handed the words that moved. An accepted
     repair with a non-empty `changed` MUST be shown as such: that is the
     difference between a disclosed name repair and a silent fabrication, and
     they are otherwise the same event. */
  return { reason: null, edits, changed: changedWords(b, a) };
}
