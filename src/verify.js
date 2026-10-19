/* verify.js — a second, smaller question after the planner has answered.
 *
 * The planner's remaining errors are two kinds, and both have the same shape:
 * it was shown the right card and did not choose it. Twenty-five of its misses
 * on the holdout pick a same-category SIBLING — `applyDiscount` for a message
 * that stacks two discounts, `checkTitleCase` for one that wants text
 * converted — and twenty-two are DECLINES on requests the router had good
 * candidates for. Shown twenty cards while also writing arguments, a 2B model
 * is answering too many questions at once.
 *
 * The evidence for asking a smaller one is already in this codebase. In
 * focus.js the same model picked the right sentence 2 times in 6 when it had
 * to answer in its first token, and 8 in 8 when given a numbered list, a few
 * words of runway, and a grammar. Handing the *planner* a single card
 * (`trustRouter`) made it decline more, not less — the difference is the task.
 * "Write a plan" from a short menu is still writing; "which of these two"
 * is selecting. So this file asks selection questions only, and never writes
 * a plan itself: when it changes the answer, the planner is asked again with
 * exactly one card to write the arguments.
 *
 * TWO CHECKS, ONE MECHANISM.
 *   siblingCheck  after a single-step plan: the draft skill against its
 *                 nearest siblings, chosen by JS. Confirm-biased — the draft
 *                 is listed first and named as the draft — so the common case
 *                 costs one short call and changes nothing.
 *   declineCheck  after an empty plan: the router's top few, or "none".
 *
 * WHO CHOOSES THE ALTERNATIVES. JS does, from three deterministic sources in
 * order: skills in the same category that share a name word with the draft
 * (applyDiscount / stackDiscounts — the shape most confusions take); the
 * router's lexical first choice for this message when it disagrees with the
 * planner; and the closest skills by the router's own TF-IDF vectors
 * (LexicalRouter.similarSkills). Capped at three.
 * The model is never asked "what else might fit" — that is the 20-way
 * question again.
 */

import { renderCard, sameJson } from './planner.js';

const runwayGrammar = (names) => [
  'root ::= "{\\"asked_for\\":" str ",\\"skill\\":" name "}"',
  'str ::= "\\"" chr* "\\""',
  'chr ::= [^"\\\\] | "\\\\" ["\\\\/bfnrt]',
  `name ::= ${names.map(n => `"\\"${n}\\""`).join(' | ')}`
].join('\n');

const parsePick = (text) => {
  try { return String(JSON.parse(text).skill || ''); } catch { return ''; }
};

/* ── the sibling check ──────────────────────────────────────────────────── */
/* MEASURED, AND NOT SHIPPED. On the 302-question holdout the sibling check
   fired on 279 turns and switched 17: 6 to the right skill, 8 away from a
   correct pick, 3 from one wrong skill to another — 239 → 237. Worse, in 13
   further cases the right skill was OFFERED beside the draft and the model
   kept the draft. Shown two full cards, the 2B does not tell parseMarkdownTable
   from toMarkdownTable any better than it did with twenty. The best gate
   (switch only when the router's lexical pick disagrees with the planner's)
   would keep 6 right and 2 wrong for about +4, inside the bench's noise, at a
   second of latency on a third of turns. It stays here as a bench flag
   (`--verify`) so the next model can be measured on the same question. */

export const SIBLING_SYSTEM = `You are given a MESSAGE and two to four SKILLS. The first skill is the DRAFT choice. Decide which skill does exactly what the message asks.

Reply with JSON: {"asked_for": "<what the message wants done, in a few words>", "skill": "<skill name>"}

Keep the draft unless another skill clearly fits better. Read each skill's description and example: skills that sound alike often go in opposite directions (parse vs. produce, one step vs. several, a check vs. a change).`;

/* The TRAINED form: the same question with no runway and no demonstrations,
   answered with the skill name alone — the shape the category adapter is
   asked in, and the shape scripts/siblingdata.mjs writes. Byte-identical
   between training and inference, for the reason model/README.md gives. */
export const SIBLING_SYSTEM_TRAINED = `You are given a MESSAGE and two to four SKILLS. The first skill is the DRAFT choice. Reply with the name of the one skill that does exactly what the message asks, and nothing else. Keep the draft unless another skill clearly fits better.`;

/** The user turn, exactly as sent — shared with the data generator. */
export function siblingUserTurn ({ message, cards }) {
  const list = cards.map((c, i) => `${i + 1}. ${renderCard(c)}`).join('\n');
  return `MESSAGE\n${message}\n\nSKILLS (1 is the draft)\n${list}`;
}

/* Two keeps and two switches, so neither answer is the pattern. None of these
   messages appears in the bench. */
export const SIBLING_SHOTS = [
  [
    'MESSAGE\nstack a further 10 percent on top of the 25 percent sale price of 400\n\nSKILLS (1 is the draft)\n1. applyDiscount — Take a percentage or a fixed amount off a price and show what you save.\n  needs: price: number\n  e.g. "25% off a 80 jacket" → {"price":80,"percent":25}\n2. stackDiscounts — Apply several discounts one after another and show the real total saving.\n  needs: price: number, discounts: array\n  e.g. "stack 20% and 10% off 100" → {"price":100,"discounts":[20,10]}',
    '{"asked_for":"two discounts applied one after the other","skill":"stackDiscounts"}'
  ],
  [
    'MESSAGE\ntake 20 percent off 150\n\nSKILLS (1 is the draft)\n1. applyDiscount — Take a percentage or a fixed amount off a price and show what you save.\n  needs: price: number\n  e.g. "25% off a 80 jacket" → {"price":80,"percent":25}\n2. stackDiscounts — Apply several discounts one after another and show the real total saving.\n  needs: price: number, discounts: array\n  e.g. "stack 20% and 10% off 100" → {"price":100,"discounts":[20,10]}',
    '{"asked_for":"a single discount off a price","skill":"applyDiscount"}'
  ],
  [
    'MESSAGE\nwrite these rows out as a markdown table\n\nSKILLS (1 is the draft)\n1. parseMarkdownTable — Turn a Markdown table into rows of data.\n  needs: text: string\n  e.g. "parse this markdown table" → {"text":"| a | b |\\n|---|---|\\n| 1 | 2 |"}\n2. toMarkdownTable — Turn rows and columns into a formatted markdown table.\n  needs: table: object\n  e.g. "make a markdown table from this data" → {"table":{"headers":["a"],"rows":[{"a":1}]}}',
    '{"asked_for":"producing a markdown table from rows","skill":"toMarkdownTable"}'
  ],
  [
    'MESSAGE\nread this markdown table so I can sort the rows\n\nSKILLS (1 is the draft)\n1. parseMarkdownTable — Turn a Markdown table into rows of data.\n  needs: text: string\n  e.g. "parse this markdown table" → {"text":"| a | b |\\n|---|---|\\n| 1 | 2 |"}\n2. toMarkdownTable — Turn rows and columns into a formatted markdown table.\n  needs: table: object\n  e.g. "make a markdown table from this data" → {"table":{"headers":["a"],"rows":[{"a":1}]}}',
    '{"asked_for":"reading a markdown table into rows","skill":"parseMarkdownTable"}'
  ]
];

/* The other way two skills are siblings: they share half a name. The
   confusions the bench shows are overwhelmingly this shape — applyDiscount /
   stackDiscounts, parseSemver / compareSemver, base64Decode / base64Encode —
   and word vectors can miss them entirely when the descriptions and examples
   happen to use different words ("off" was all applyDiscount and
   stackDiscounts had in common). Name words are the author telling us these
   belong together. Generic verbs are excluded so "convert" alone does not make
   every converter a sibling of every other, and the search is not limited to
   the category, because the pairs it exists for straddle them. */
const GENERIC = new Set(['convert', 'parse', 'format', 'get', 'set', 'to', 'from', 'check', 'find', 'extract', 'generate', 'validate', 'count', 'list', 'text', 'lookup', 'make', 'build', 'calculate', 'apply', 'solve', 'describe', 'compare', 'read', 'write', 'is', 'of']);
const nameWords = (name) => String(name).replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/)
  .map(w => w.replace(/s$/, '')).filter(w => w.length >= 4 && !GENERIC.has(w));
/* A registry entry's name never changes after it is built, so its name-word
   breakdown is cached against the entry object itself the first time any
   skill's siblings are checked — every subsequent lookup, for any skill,
   reuses it rather than re-splitting the same name again. */
const nameWordsCache = new WeakMap();
function nameWordsOf (entry) {
  let words = nameWordsCache.get(entry);
  if (!words) {
    words = nameWords(entry.name);
    nameWordsCache.set(entry, words);
  }
  return words;
}
function nameSiblings (registry, skill) {
  const me = registry.skill(skill);
  if (!me) return [];
  const mine = new Set(nameWordsOf(me));
  if (!mine.size) return [];
  /* Not restricted to the category: applyDiscount sits in one and
     stackDiscounts in another, and that pair is exactly the confusion this
     source exists to surface. A shared name word is evidence enough. */
  return registry.routable()
    .filter(s => s.name !== skill && nameWordsOf(s).some(w => mine.has(w)))
    .map(s => s.name)
    .sort();
}

/**
 * @param {object} deps
 * @param {Function} deps.complete   from llm.js
 * @param {Registry} deps.registry
 * @param {object}   deps.router     anything with similarSkills(name, n) → [{name, score}]
 * @param {number}   deps.floor      a sibling below this description-similarity is not offered
 * @param {number}   deps.maxAlternatives
 * @returns {Function} async ({message, skill, routing}) =>
 *   {draft, chosen, alternatives, ms} | null   (null: no plausible sibling, nothing asked)
 */
/** The alternatives JS would put beside a draft pick, in offer order. Shared
 *  by the check and by scripts/siblingdata.mjs, so the adapter trains on the
 *  same shortlists it will be shown. */
export function siblingAlternatives ({ registry, router, skill, routing, floor = 0.15, maxAlternatives = 3 }) {
  const alternatives = [];
  const offer = (name) => {
    if (name && name !== skill && !alternatives.includes(name) && registry.compactCard(name)) alternatives.push(name);
  };
  /* Name siblings first: they are the shape the confusions actually take.
     Then the router's lexical first choice when it disagrees with the
     planner — two signals that reached two answers. Then the nearest by
     vector, to fill what is left of the slots. */
  const ranked = router && typeof router.similarSkills === 'function' ? router.similarSkills(skill, 100).map(x => x.name) : [];
  const rank = (n) => { const i = ranked.indexOf(n); return i < 0 ? Infinity : i; };
  for (const n of nameSiblings(registry, skill).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))) offer(n);
  const lexicalTop = routing && routing.candidates && routing.candidates[0] && routing.candidates[0].name;
  if (lexicalTop && routing.candidates[0].score > 0) offer(lexicalTop);
  if (router && typeof router.similarSkills === 'function') {
    for (const s of router.similarSkills(skill, maxAlternatives + 1)) {
      if (s.score >= floor) offer(s.name);
    }
  }
  return alternatives.slice(0, maxAlternatives);
}

export function siblingCheck ({ complete, registry, router, floor = 0.15, maxAlternatives = 3, trained = false,
                                system = SIBLING_SYSTEM, systemTrained = SIBLING_SYSTEM_TRAINED,
                                shots = SIBLING_SHOTS } = {}) {
  const check = async ({ message, skill, routing }) => {
    const offered = siblingAlternatives({ registry, router, skill, routing, floor, maxAlternatives });
    if (!offered.length) return null;

    const names = [skill, ...offered];
    const cards = names.map(n => registry.compactCard(n)).filter(Boolean);
    if (cards.length !== names.length) return null;

    let out;
    try {
      out = await complete({
        messages: trained
          ? [
              { role: 'system', content: systemTrained },
              { role: 'user', content: siblingUserTurn({ message, cards }) }
            ]
          : [
              { role: 'system', content: system },
              ...shots.flatMap(([u, a]) => [{ role: 'user', content: u }, { role: 'assistant', content: a }]),
              { role: 'user', content: siblingUserTurn({ message, cards }) }
            ],
        grammar: trained ? `root ::= ${names.map(n => `"${n}"`).join(' | ')}` : runwayGrammar(names),
        maxTokens: trained ? 12 : 80,
        temperature: 0
      });
    } catch {
      return null;
    }
    const chosen = trained ? String(out.text || '').trim() : parsePick(out.text);
    if (!names.includes(chosen)) return null;
    return { draft: skill, chosen, alternatives: offered, ms: out.ms };
  };
  check.backend = trained ? 'sibling-selection (adapter)' : 'sibling-selection';
  return check;
}

/* ── the decline check ──────────────────────────────────────────────────── */
/* MEASURED, AND SHIPPED. Fired 12 times on the holdout (only when the planner
   declined AND the category adapter had named a category), chose right 11
   times, wrong once, leaked nothing — 239 → 248 correct. Nine of the twelve
   became honest asks: the one-card re-plan came back empty, as the
   trust-router experiment predicted it would, so turn.js falls back to the
   skill with an empty input and the executor asks for the data. */

export const DECLINE_SYSTEM = `You are given a MESSAGE and a few SKILLS. Decide whether one of the skills does what the message asks.

Reply with JSON: {"asked_for": "<what the message wants done, in a few words>", "skill": "<skill name>"} — or "none" as the skill if nothing here does it.

A skill still fits when the message names the thing to work on but has not pasted it yet; the data will be asked for. Writing, opinions, conversation and general knowledge have no skill here: answer "none" for those.`;

export const DECLINE_SHOTS = [
  [
    'MESSAGE\nput this json on one line\n\nSKILLS\n1. formatJson — Tidy JSON into readable indented form, or squash it onto one line.\n  needs: text: string\n  e.g. "pretty print this json" → {"text":"{\\"a\\":1}"}\n2. flattenJson — Flatten nested JSON into a single level of dot-separated paths.\n  needs: json: string\n  e.g. "flatten this json" → {"json":"{\\"a\\":{\\"b\\":1}}"}\n3. sortObjectKeys — Sort the keys of a JSON object alphabetically, all the way down.\n  needs: json: string\n  e.g. "sort the keys in this json" → {"json":"{\\"b\\":1,\\"a\\":2}"}',
    '{"asked_for":"minifying a json document not yet pasted","skill":"formatJson"}'
  ],
  [
    'MESSAGE\nwhat is 6 times 7 times 2\n\nSKILLS\n1. sum — Add up a list of numbers and give the total.\n  needs: values: array\n  e.g. "add up 3, 4 and 5" → {"values":[3,4,5]}\n2. product — Multiply a list of numbers together.\n  needs: values: array\n  e.g. "multiply 3 by 4" → {"values":[3,4]}\n3. factorial — Work out a factorial — the product of every whole number up to n.\n  needs: n: integer\n  e.g. "what is 5 factorial" → {"n":5}',
    '{"asked_for":"multiplying three given numbers","skill":"product"}'
  ],
  [
    'MESSAGE\nwrite me a limerick about a lighthouse\n\nSKILLS\n1. countWords — Count the words in a text.\n  needs: text: string\n  e.g. "how many words is this" → {"text":"one two"}\n2. syllableCount — Estimate how many syllables are in a word or a text.\n  needs: text: string\n  e.g. "how many syllables in beautiful" → {"text":"beautiful"}\n3. readingTime — Estimate how long a text takes to read.\n  needs: text: string\n  e.g. "how long to read this" → {"text":"…"}',
    '{"asked_for":"writing a poem, which no skill does","skill":"none"}'
  ]
];

/**
 * @param {object} deps
 * @param {Function} deps.complete
 * @param {Registry} deps.registry
 * @returns {Function} async ({message, cards}) => {chosen, ms} | null
 *   (null: "none", or nothing usable — the decline stands)
 */
/* `shots` is injectable for the same reason the planner's are: the decline
   check's demonstrations are a lever, and a lever that can only be pulled by
   editing this file does not get measured. */
export function declineCheck ({ complete, registry, shots = DECLINE_SHOTS, system = DECLINE_SYSTEM } = {}) {
  const check = async ({ message, cards }) => {
    const usable = (cards || []).filter(c => c && registry.compactCard(c.name));
    if (!usable.length) return null;
    const names = usable.map(c => c.name);
    const list = usable.map((c, i) => `${i + 1}. ${renderCard(c)}`).join('\n');
    let out;
    try {
      out = await complete({
        messages: [
          { role: 'system', content: system },
          ...shots.flatMap(([u, a]) => [{ role: 'user', content: u }, { role: 'assistant', content: a }]),
          { role: 'user', content: `MESSAGE\n${message}\n\nSKILLS\n${list}` }
        ],
        grammar: runwayGrammar([...names, 'none']),
        maxTokens: 80,
        temperature: 0,
        ...(system === DECLINE_SYSTEM && sameJson(shots, DECLINE_SHOTS)
          ? { pigeon: { id: 'patch-second-look', input: `MESSAGE\n${message}\n\nSKILLS\n${list}`, values: { skill: [...names, 'none'] } } }
          : {})
      });
    } catch {
      return null;
    }
    const chosen = parsePick(out.text);
    if (!names.includes(chosen)) return null;
    return { chosen, ms: out.ms };
  };
  check.backend = 'decline-selection';
  return check;
}

/* ── is the message asking for anything at all? ──────────────────────────── */

/* The third check, and the one aimed at what is left of the leak.
 *
 * After the fallback floor, 17 of 100 off-topic messages still run a tool, and
 * 9 of those are ones the category adapter names a category for at 0.80 to
 * 1.00. No confidence gate reaches them: the adapter is certain, and it is
 * certain about the wrong thing, because "my morse code is rusty" really does
 * belong to encoding as far as its words go.
 *
 * What separates them is not the category. It is that they are not asking for
 * anything. Statements, idioms, complaints, and requests for things no function
 * produces. So this asks that one question, and nothing else.
 *
 * MEASURED, and the demonstrations are the whole difference — the same finding
 * the category router records for itself:
 *
 *                     leaks stopped   real questions lost   ms per message
 *   no shots            3 of 17            0 of 308             678
 *   with shots         12 of 17            3 of 308             161
 *
 * Without them the model narrates its reasoning until the token budget runs out
 * and never answers, which reads as a confident NO on everything.
 *
 * It takes the MESSAGE and not the plan, so it is asked at the same time as the
 * planner rather than after it, which is why it is a veto on the plan rather
 * than a gate in front of it.
 *
 * THAT DOES NOT MAKE IT FREE, and the first version of this comment claimed it
 * did. Both questions go to the same llama-server, which runs `--parallel 1`,
 * so concurrent requests queue instead of overlapping: measured, the bench goes
 * from 1647 ms a turn to 1832. A second slot would genuinely overlap them and
 * hand that back, but `--parallel 1` is the line the 292 was measured on and
 * changing it is its own experiment.
 *
 * The category server IS idle during planning and was tried as the cheap way
 * out. It answers, but worse — it calls "my morse code is rusty" a request —
 * so the accuracy is worth the 185 ms.
 */
export const ASKS_SYSTEM = 'You answer with one word: YES or NO. Nothing else.';

export const asksUserTurn = (message) =>
  `Message: "${message}"\n\n` +
  `Is this person ASKING for something to be done — something computed, converted, ` +
  `generated, looked up, checked, formatted or transformed?\n\n` +
  `Answer NO if they are describing, complaining, reminiscing, joking, or using a ` +
  `phrase figuratively. Answer YES if a tool could carry the message out.\n\nYES or NO:`;

/* The same user turn as a single-slot template, for a prompt loaded as data.
   Filled with split/join, never String.replace — a message containing `$&`
   would otherwise be rewritten by the replacement-pattern syntax. Asserted in
   scripts/test.mjs to equal asksUserTurn for every message. */
export const ASKS_USER_TURN_TEMPLATE =
  `Message: "{message}"\n\n` +
  `Is this person ASKING for something to be done — something computed, converted, ` +
  `generated, looked up, checked, formatted or transformed?\n\n` +
  `Answer NO if they are describing, complaining, reminiscing, joking, or using a ` +
  `phrase figuratively. Answer YES if a tool could carry the message out.\n\nYES or NO:`;

/* Pairs, each one an ordinary use of a skill's vocabulary against a real
   request in the same words. None is a bench message: both holdouts stay
   holdouts, or this measures its own training set. */
export const ASKS_SHOTS = [
  ['round 12.7 to one decimal place', 'YES'],
  ['he rounded on me in the meeting for no reason', 'NO'],
  ['what day of the week was 3 march 1999', 'YES'],
  ['some days of the week just drag more than others', 'NO'],
  ['sort these names alphabetically', 'YES'],
  ['i am trying to sort my life out this year', 'NO'],
  ['how many characters are in this sentence', 'YES'],
  ['she is quite a character once you get to know her', 'NO'],
  ['encode this string as base64', 'YES'],
  ['the whole thing is in code and nobody will explain it', 'NO']
];

/**
 * `(message) => Promise<{ asks: boolean, ms: number }>`.
 * Returns `asks: true` on any failure — a check that cannot be reached must
 * never turn into a refusal.
 */
export function asksCheck ({ complete, shots = ASKS_SHOTS, system = ASKS_SYSTEM, userTurnTemplate } = {}) {
  if (!complete) return null;
  const userTurn = typeof userTurnTemplate === 'string'
    ? (m) => userTurnTemplate.split('{message}').join(m)
    : asksUserTurn;
  const demo = shots.flatMap(([m, a]) => [
    { role: 'user', content: userTurn(m) },
    { role: 'assistant', content: a }
  ]);
  return async function asks (message) {
    const t0 = Date.now();
    try {
      const out = await complete({
        messages: [{ role: 'system', content: system }, ...demo,
                   { role: 'user', content: userTurn(String(message ?? '')) }],
        maxTokens: 6,
        temperature: 0,
        ...(system === ASKS_SYSTEM && sameJson(shots, ASKS_SHOTS) && (userTurnTemplate === undefined || userTurnTemplate === ASKS_USER_TURN_TEMPLATE) ? { pigeon: { id: 'patch-asks', input: String(message ?? '') } } : {}),
        /* Without this the model narrates instead of answering and the budget
           cuts it off mid-thought, which this function would then read as a
           yes — a check that is on, costs time, and does nothing. */
        think: false
      });
      const text = String((out && out.text) || '').trim();
      const no = /^\s*no\b/i.test(text);
      const yes = /^\s*yes\b/i.test(text);
      /* Anything that is not a clear NO is a yes: the failure that matters is
         refusing a real question, so the tie goes to answering. But an answer
         that is NEITHER is a broken check rather than a permissive one, and it
         says so on the way past instead of passing for agreement. */
      return { asks: !no, ms: Date.now() - t0, said: text, clear: no || yes };
    } catch {
      return { asks: true, ms: Date.now() - t0, said: null };
    }
  };
}
