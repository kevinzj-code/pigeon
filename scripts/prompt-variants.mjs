/* prompt-variants.mjs — alternate planner prompts, for A/B testing on the bench.
 *
 * The measurement that prompted this: with a shortlist of 5, the model declined
 * 106 questions it should have answered, and for 63 of them the right skill was
 * on the list in front of it. Declining is 53% of everything it does.
 *
 * Two suspects in the shipped prompt, both about emphasis rather than fact:
 *
 *   1. Rule 2 tells the model an empty plan is "a correct and COMMON answer".
 *      True, and an invitation.
 *   2. The empty plan is one of only three demonstrations — a third of
 *      everything the model is shown is a refusal, against §7.3's intended 15%.
 *
 * `commit` rebalances both without weakening the refusal itself: the no-skill
 * safety rail must not move. If it does, the variant loses regardless of its
 * accuracy — a Pigeon that answers "i had a rough day" is worse than one that
 * declines too much.
 */

import { SHOTS, SYSTEM } from '../src/planner.js';
import { DECLINE_SHOTS, ASKS_SHOTS } from '../src/verify.js';

export const COMMIT_SYSTEM = `You turn a user's message into a PLAN: an ordered list of skill calls that will answer it.

You never answer the question yourself. You never do arithmetic, convert units, or work out a date. Verified code does all of that. Your only job is to choose skills from the list and copy the right values out of the message into their arguments.

RULES
1. Use ONLY the skills in the SKILLS list. There are no others.
2. If a skill in the list fits the request, USE IT. The user's wording will often differ from the skill's description — "squash this down" is a compression request, "shade this darker" is a darkening request. Match on what they are asking for, not on matching words.
3. Return {"steps":[]} only when nothing in the list can serve the request at all. Writing, summarising, translating, explaining, opinions, advice and conversation have no skill — return an empty plan for those, and for nothing else.
4. Copy values out of the message. Never invent a number, date, name or unit that is not there or in TODAY.
5. If you cannot find an argument in the message, leave it out and still choose the skill. Code will ask the user for it. A plan missing an argument is far better than no plan.
6. A later step may use an earlier step's output as a value: "$s1.fieldName".
7. Reply with the plan JSON only.`;

/* Same three demonstrations, plus two that target the two commonest ways the
   model gives up: near-neighbours, and a request whose wording shares nothing
   with the skill that serves it. The empty plan is now one of five rather than
   one of three. */
export const COMMIT_SHOTS = [
  {
    user: 'SKILLS\ncountdownTo — Days from today until a date, or how long ago it was.\n  needs: to: string\n\nMESSAGE\nhow many days until christmas',
    assistant: '{"steps":[{"id":"s1","skill":"countdownTo","input":{"to":"2026-12-25"}}]}'
  },
  {
    /* Wording shares nothing with the skill, and one argument is absent. Both
       are cases the model currently answers with an empty plan. */
    user: 'SKILLS\ntruncateText — Shorten text to a maximum length, cutting on a word boundary.\n  needs: text: string, length: integer\nwrapText — Hard-wrap text so no line is longer than a given number of characters.\n  needs: text: string, width: integer\n\nMESSAGE\nmake this fit in a tweet',
    assistant: '{"steps":[{"id":"s1","skill":"truncateText","input":{"length":280}}]}'
  },
  {
    user: 'SKILLS\nconvertCase — Change the capitalisation of text.\n  needs: text: string, style: string\n\nMESSAGE\nwrite me a short poem about the sea',
    assistant: '{"steps":[]}'
  },
  {
    /* Two near-neighbours, one right. The model declines this shape often. */
    user: 'SKILLS\ncountWords — Count the words in a text.\n  needs: text: string\nwordFrequency — How often each word appears in a text.\n  needs: text: string\n\nMESSAGE\nhow long is this in words',
    assistant: '{"steps":[{"id":"s1","skill":"countWords","input":{}}]}'
  },
  {
    user: 'SKILLS\ncountryLookup — A country\'s capital city, ISO codes, currency and dialling code.\n  needs: query: string\ncurrencyLookup — What a currency code stands for.\n  needs: code: string\n\nMESSAGE\nwhat is japan\'s currency called',
    assistant: '{"steps":[{"id":"s1","skill":"countryLookup","input":{"query":"Japan"}},{"id":"s2","skill":"currencyLookup","input":{"code":"$s1.currency"}}]}'
  }
];

/* ── Batch 1 (2026-09-08): one change from the shipped prompt each ─────────
 *
 * Every variant below differs from `control` in exactly one thing, so a
 * result can be attributed. Keys other than `system`/`shots` are knobs that
 * `llmPlanner` and `declineCheck` accept (see planner.js, verify.js); the
 * bench spreads a variant into both. Hypotheses and the reading rule for
 * each are in bench/queue/<id>.json; results land in bench/results/. */

/* Four shots instead of six: the web lookup (no web card is offered on 300
   of 308 turns) and the countryLookup→currencyLookup chain are dropped.
   ~350 fewer prompt tokens a call; the chain is the only multi-step
   demonstration, so this also asks whether it was earning its place. */
export const LEAN_SHOTS = SHOTS.filter((_, i) => i !== 0 && i !== 3);

/* Rule 8 reworded so the runway names the ACTION, not the topic. The field is
   discarded, but what the model writes there is what it then commits to; a
   phrase that ends in a verb may steer it along the sibling axis (parse vs
   render, decode vs encode) where a topic noun does not. */
export const RUNWAY_RULE_VERB = '8. Begin the JSON with a short "about" field: what the user wants done, as an action — "converting a running time to hours", "decoding hex bytes to text" — then the steps.';

/* One more decline-check demonstration, of the shape the four remaining
   declines share: work on a document the user has named but not pasted. */
export const DECLINE_SHOTS_PLUS = [
  ...DECLINE_SHOTS,
  [
    'MESSAGE\nwhat changed between the two versions\n\nSKILLS\n1. diffText — Show what changed between two versions of a text, line by line.\n  needs: before: string, after: string\n  e.g. "diff these two texts" → {"before":"a\\nb","after":"a\\nc"}\n2. findRepeatedWords — Find words used more than once, close together.\n  needs: text: string\n  e.g. "am I repeating myself" → {"text":"…"}\n3. countWords — Count the words in a text.\n  needs: text: string\n  e.g. "how many words is this" → {"text":"one two"}',
    '{"asked_for":"comparing two versions not yet pasted","skill":"diffText"}'
  ]
];

/* ── Qwen3-VL 2B as the planner (the one-base experiment, 2026-10-07) ──────
   Measured with Patch v5's prompts on Qwen3-VL 2B: 213 of 308 right, 5
   leaks, against Qwen3.5 2B's 289 and 18. Where the 76 went: 47 real
   questions the ASKS check called not-a-request (it says YES to 255 of 308
   on that base, against 305 on Qwen3.5), 22 near-twin skills picked the
   wrong way round (parse for produce, split for join), and 15 right skills
   with invented or renamed arguments. Tuned on HOLDOUT_TUNE and the even
   no-skill messages, never on HOLDOUT_GRADE; no example is a bench message. */
export const VL_SYSTEM = SYSTEM + '\n' +
  '1b. Skills that sound alike often go in opposite directions: parse and produce, split and join, check and change, one step and several. Read the description, not just the name, and choose the one that does what the message asks.\n' +
  '4b. Use each argument name exactly as the skill lists it after "needs:" or "optional:". Never rename one or add one it does not list.';

export const VL_ASKS_TEMPLATE =
  `Message: "{message}"\n\n` +
  `Is this person ASKING for something to be done — something computed, converted, ` +
  `generated, looked up, checked, formatted or transformed?\n\n` +
  `A short request with no verb still asks: "median of these salaries" and "the links in this email" are requests. ` +
  `Answer NO if they are describing, complaining, reminiscing, joking, or using a ` +
  `phrase figuratively. Answer YES if a tool could carry the message out.\n\nYES or NO:`;

export const VL_ASKS_SHOTS = [
  ...ASKS_SHOTS,
  ['median of these salaries', 'YES'],
  ['my salary is about the median round here', 'NO'],
  ['any typos in this paragraph', 'YES'],
  ['the typo in my wedding speech still haunts me', 'NO'],
  ['hex for a dark teal', 'YES'],
  ['the links in this email', 'YES']
];

export const VARIANTS = {
  vl: { system: VL_SYSTEM, asks: { shots: VL_ASKS_SHOTS, userTurnTemplate: VL_ASKS_TEMPLATE } },
  commit: { system: COMMIT_SYSTEM, shots: COMMIT_SHOTS },
  'lean-shots': { shots: LEAN_SHOTS },
  'no-example-cards': { cardExamples: false },
  'message-first': { order: 'message-first' },
  'runway-verb': { runwayRule: RUNWAY_RULE_VERB },
  'decline-shot': { decline: { shots: DECLINE_SHOTS_PLUS } }
};

/* The planner's share of a variant: everything but the decline check's. */
export const plannerOptions = (v) => { const { decline, asks, ...rest } = v || {}; void decline; void asks; return rest; };
export const declineOptions = (v) => (v && v.decline) || {};
export const asksOptions = (v) => (v && v.asks) || {};
