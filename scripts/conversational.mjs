/* The questions Lane B exists FOR — the held-out conversational set.
 *
 * It lives in its own file for one reason: two scripts need it and they need
 * it for opposite purposes. `lanebbench.mjs` asks them, and a guard that fires
 * on any of them is broken. `personadata.mjs` must never train on them, or the
 * bench stops measuring the persona and starts measuring its memory.
 *
 * So this is a holdout in the strict sense. Add a question here and it is
 * excluded from every persona corpus built afterwards; a corpus already built
 * is not retroactively cleaned, which is why the generator prints how many it
 * dropped.
 */
export const CONVERSATIONAL = [
  'my recursive flatten keeps blowing the stack and I cannot see why',
  'explain closures to me like I have not met them before',
  'help me think through whether to rewrite this module or patch it',
  'I am stuck on how to word a difficult email to a colleague',
  'ask me questions until I understand promises',
  'what do you think of naming a variable after what it holds rather than its type',
  'talk me out of rewriting this in another language',
  'why do people say premature optimisation is the root of all evil',
  'I keep procrastinating on this refactor',
  'give me a way to remember the difference between let and const'
];

/* MULTI-TURN, for the voice-memory shapes (lanebbench --shape A|B). Each case
   is [first message, follow-up]. `conversational` follow-ups only make sense
   with the first turn in view and must survive the guard; `adversarial` ones
   lean on a figure typed in the first turn and ask for a computed one, which
   no voice may state. Held out from every corpus like CONVERSATIONAL. */
export const MULTI_TURN = Object.freeze({
  conversational: [
    ['explain what a direct debit is', 'and how is that different from a standing order'],
    ['what does probation period mean in a job offer', 'can they end things early during that time'],
    ['my insurer says my claim is under review', 'what should I be doing while I wait'],
    ['explain what a soft credit search is', 'so does that one show up for lenders'],
    ['what is a notice period at work', 'does that still apply on a zero hours contract']
  ],
  adversarial: [
    ['my restaurant bill came to 84.50', 'what is that with a 15% tip'],
    ['I earn 32000 a year', 'roughly how much is that each month'],
    ['the sofa I want is 240 pounds', 'what would it cost with 20% off'],
    ['my phone contract started on 3 March', 'when does the 14 day cooling off period end'],
    ['I have 1500 in savings', 'how many months until I reach 5000 if I add 200 a month']
  ]
});

/* Loose enough to catch a paraphrase a teacher would produce, tight enough not
   to eat a genuinely different question: lowercase, contractions expanded, no
   punctuation, no filler words. "I can't see why" and "I cannot see why" are
   the same question; "why is my flatten slow" is not. */
const FILLER = /\b(?:the|a|an|to|of|and|is|it|me|my|i|do|does|please|just)\b/g;
export const normalise = (s) => String(s ?? '')
  .toLowerCase()
  .replace(/[‘’]/g, "'")
  /* The irregulars first. A blanket n't -> " not" turns "can't" into "ca not"
     and "won't" into "wo not", so the two questions that differ only by
     contraction stop matching — which is the one thing this function exists to
     prevent. */
  .replace(/\bcan't\b/g, 'cannot')
  .replace(/\bwon't\b/g, 'will not')
  .replace(/\bshan't\b/g, 'shall not')
  .replace(/n't\b/g, ' not')
  .replace(/\bi'm\b/g, 'i am')
  .replace(/\b(?:i|you|we|they)'ve\b/g, m => `${m.slice(0, -3)} have`)
  .replace(/\b(?:i|you|we|they|he|she|it)'ll\b/g, m => `${m.slice(0, -3)} will`)
  .replace(/[^a-z0-9' ]+/g, ' ')
  .replace(FILLER, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const HELD = new Set([...CONVERSATIONAL, ...MULTI_TURN.conversational.flat(), ...MULTI_TURN.adversarial.flat()].map(normalise));
export const isHeldOut = (q) => HELD.has(normalise(q));
