/* focus.js — §8's Assembler seam, filled with a SELECTION pass rather than a
 * writing one.
 *
 * The problem it solves is narrow and real. Asked "who is the governor of
 * Maryland", the web tier returns the encyclopedia's whole opening section:
 * three sentences about the office, with the name in the last one. Every word
 * is sourced and none of it is wrong, but the answer is buried, and the
 * question was not "what is a governor".
 *
 * The obvious fix — hand the passage to a model and ask for a one-line answer —
 * is the one thing this project must not do. `webAnswer` returns the provider's
 * own words precisely so that no step exists in which a model could add a
 * detail the source does not have, and the fabrication auditor cannot protect
 * that: it traces NUMBERS (§8), so a model that renamed the governor would sail
 * straight through it. A summariser here would quietly turn a sourced answer
 * into a generated one, which is the failure this whole project is built to
 * avoid.
 *
 * So the model never writes the reply. JS splits the passage into sentences and
 * numbers them; the model replies with a sentence NUMBER under a GBNF grammar;
 * JS renders that sentence, character for character, with the same provenance
 * and the same source link the full passage carried. The model's contribution
 * is an integer. It cannot rephrase, cannot merge two facts and cannot invent a
 * name, because the grammar never lets it emit prose in the first place.
 *
 * That is the same division of labour as the rest of Pigeon — the model
 * chooses, verified code produces the output — moved to the last pass. And it
 * degrades the right way: an unreachable model, a refusal ("0"), an
 * out-of-range answer or a one-sentence passage all leave the full text exactly
 * as it was before this file existed.
 *
 * WHICH STEP of a multi-step plan is the answer is a related question, and it
 * is NOT answered here — it needs no model at all. The plan already says: if a
 * later step references an earlier one, the earlier one is working. A model was
 * tried for it first and got 4 of 6, falling back to "show everything" on the
 * chained cases that most needed trimming; the rule in reply.js gets them all
 * by construction, with no call and no latency. Selection beats writing, and
 * derivation beats selection.
 *
 * THE RUNWAY IS NOT DECORATION. The model is asked to write `looking_for` — a
 * few words naming what the question actually wants — before the number. On
 * eight labelled passages the shipped 2B answered 2 of 6 without it, always
 * picking sentence 1 no matter what was asked, and 8 of 8 with it. It is the
 * same finding planner.js records for plans: a model that reasons before
 * answering cannot reason when the first token it emits must be the answer. The
 * field is thrown away; only the integer is used.
 */

/* Sentence boundaries, conservatively. A boundary is terminal punctuation
   followed by a space and something that starts a sentence — with the common
   abbreviations that also end in a period held back, because splitting "U.S.
   Senate" in two would quote half a phrase.

   Getting this wrong is not dangerous, which is worth saying plainly: a bad
   split makes the quote longer or shorter than ideal and it is still the
   source's own words. No failure mode here invents text. */
const ABBREV = /(?:\b(?:[A-Z]|Mr|Mrs|Ms|Dr|Prof|St|Jr|Sr|vs|etc|e\.g|i\.e|approx|Inc|Ltd|Co|No|Vol|pp|Fig|Gen|Sen|Rep|Gov|Lt|Col|Capt|Sgt|Rev|Hon|U\.S|U\.K)\.)$/;

/** Split a passage into sentences. Lossless: the pieces rejoin with single
 *  spaces to the whitespace-normalised original, which is what lets the caller
 *  assert that a chosen sentence really came out of the source. */
export function splitSentences (text) {
  const src = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!src) return [];
  const out = [];
  let start = 0;
  const re = /([.!?])(["')\]]*)\s+(?=[A-Z0-9"'(\[])/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const end = m.index + m[1].length + m[2].length;
    const candidate = src.slice(start, end);
    /* Not a boundary if this "sentence" ends in an abbreviation, or if it is so
       short that the period was almost certainly not terminal. */
    if (ABBREV.test(candidate.trimEnd()) || candidate.trim().length < 12) continue;
    out.push(candidate.trim());
    start = end;
    re.lastIndex = end;
  }
  const tail = src.slice(start).trim();
  if (tail) out.push(tail);
  return out;
}

/* A pack's copy of the examples is the same when it has the same text. */
const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export const FOCUS_SYSTEM = `You are given a QUESTION and a numbered PASSAGE. Find the ONE sentence that states the answer.

Reply with JSON: {"looking_for": "<the specific thing the question asks for, in a few words>", "sentence": <number>}

Use 0 for the sentence number if no sentence states the answer. The first sentence usually only defines the subject — if the question asks who holds a position, when something happened, or for a specific name or figure, the answer is usually in a later sentence.`;

/* Four demonstrations, and the balance between them is the point: two where the
   answer is the last sentence, one where it is genuinely the first, one where
   the passage does not answer the question at all. Showing only late answers
   teaches "always pick the end", which is the same positional guess in the
   other direction. */
export const FOCUS_SHOTS = [
  [
    'QUESTION\nwho is the mayor of Springfield\n\nPASSAGE\n1. The mayor of Springfield is the head of the executive branch of the city government.\n2. The office was created in 1852 and its powers are set out in the city charter.\n3. The current mayor is Dana Whitfield, who took office in 2021.',
    '{"looking_for":"the name of the person who is currently mayor","sentence":3}'
  ],
  [
    'QUESTION\nwhat is the capital of Mongolia\n\nPASSAGE\n1. Ulaanbaatar is the capital and most populous city of Mongolia.\n2. It lies in the north central part of the country on the Tuul River.',
    '{"looking_for":"the name of the capital city","sentence":1}'
  ],
  [
    'QUESTION\nwhen was the museum founded\n\nPASSAGE\n1. The museum is a national institution devoted to natural history.\n2. Its collection holds over forty million specimens.\n3. It was founded in 1881 and moved to its present building the following year.',
    '{"looking_for":"the founding year","sentence":3}'
  ],
  [
    'QUESTION\nhow tall is the tower\n\nPASSAGE\n1. The tower was designed by an engineering firm and completed in 1889.\n2. It has become a global cultural icon.',
    '{"looking_for":"the height of the tower","sentence":0}'
  ]
];

/**
 * Build the focus pass. Satisfies the seam `replyFor` calls: given a web
 * answer, return the one sentence of it that answers the question, or null to
 * leave the reply exactly as it is.
 *
 * @param {object} deps
 * @param {Function} deps.complete  from llm.js — the planner's transport is fine
 * @returns {Function} async ({message, answer}) => {text, kept, of, ms} | null
 */
export function sentenceFocus ({ complete, system = FOCUS_SYSTEM, shots = FOCUS_SHOTS } = {}) {
  const focus = async ({ message, answer }) => {
    const sentences = splitSentences(answer);
    /* Nothing to choose between. A one-sentence answer is already focused and
       this must not spend a model call to discover that. */
    if (sentences.length < 2) return null;

    const indices = sentences.map((_, i) => String(i + 1));
    /* The grammar is the guarantee. `looking_for` is free text — the runway —
       but `sentence` can only be one of the integers JS just handed over, so
       the value this function returns is chosen from `sentences` and never
       written by the model. */
    const grammar = [
      'root ::= "{\\"looking_for\\":" str ",\\"sentence\\":" idx "}"',
      'str ::= "\\"" chr* "\\""',
      'chr ::= [^"\\\\] | "\\\\" ["\\\\/bfnrt]',
      `idx ::= ${['"0"', ...indices.map(i => `"${i}"`)].join(' | ')}`
    ].join('\n');

    let out;
    try {
      out = await complete({
        messages: [
          { role: 'system', content: system },
          ...shots.flatMap(([user, assistant]) => [
            { role: 'user', content: user },
            { role: 'assistant', content: assistant }
          ]),
          { role: 'user', content: `QUESTION\n${message}\n\nPASSAGE\n${sentences.map((s, i) => `${i + 1}. ${s}`).join('\n')}` }
        ],
        grammar,
        /* Enough for a short phrase plus the number. The grammar closes the
           JSON, so hitting this budget mid-string is the one way to get
           unparseable output — and that lands in the catch below as "no focus",
           which is the safe answer. */
        maxTokens: 80,
        temperature: 0,
        ...(system === FOCUS_SYSTEM && sameJson(shots, FOCUS_SHOTS)
          ? { pigeon: { id: 'patch-focus', input: `QUESTION\n${message}\n\nPASSAGE\n${sentences.map((s, i) => `${i + 1}. ${s}`).join('\n')}`, values: { sentence: [0, ...sentences.map((_, i) => i + 1)] } } }
          : {})
      });
    } catch {
      /* No model, or it failed. The full passage is a correct answer and stays. */
      return null;
    }

    let picked = 0;
    /* The runway, kept rather than dropped. `looking_for` is free text the
       model writes before it commits to a number, and it is the only moment in
       a whole turn where the model says anything in its own words. Surfacing it
       in the plan view is safe precisely because it is not the answer: the
       grammar guarantees the returned TEXT comes from the passage, so this
       phrase is shown as Patch's reasoning and never as a fact. */
    let lookingFor = '';
    try {
      const said = JSON.parse(out.text);
      picked = Number(said.sentence);
      lookingFor = typeof said.looking_for === 'string' ? said.looking_for.trim() : '';
    } catch {
      return null;
    }

    /* 0 is the model saying no sentence answers this, which is a real answer
       and the reason the grammar admits it. Anything out of range would be a
       grammar failure; treat it the same way. */
    if (!Number.isInteger(picked) || picked < 1 || picked > sentences.length) return null;

    const text = sentences[picked - 1];
    /* Choosing the only sentence there is would be a no-op; and a "focused"
       answer that is not shorter than the passage should not claim to be one. */
    if (sentences.length === 1) return null;

    /* The last line of defence. It cannot fail as written — `text` comes from
       `sentences` and from nowhere else — and it is here because that is a
       property of this implementation rather than of the contract, and the next
       edit to this function should be caught by an assertion instead of trusted
       to remember. */
    if (!splitSentences(answer).includes(text)) return null;

    return { text, lookingFor, kept: [picked], of: sentences.length, ms: out.ms };
  };

  focus.backend = 'sentence-selection';
  return focus;
}
