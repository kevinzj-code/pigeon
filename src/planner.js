/* planner.js — §3.2, pass 2. The model's entire job in this architecture.
 *
 * Input:  the user's message + the router's top-k COMPACT CARDS.
 * Output: plan JSON. Nothing else — no prose, no answer, no arithmetic.
 *
 * Three things are deliberately not left to the prompt:
 *
 * 1. THE SKILL NAMES ARE IN THE GRAMMAR. §3.2 says "it cannot invent a skill
 *    name; JS rejects unknown names". Rejecting after the fact is the floor;
 *    a GBNF grammar built from this turn's candidates makes an unknown name
 *    untokenizable in the first place. The model literally cannot emit one.
 * 2. THE SHAPE IS IN THE GRAMMAR. Step ids are s1–s8, so §4.4's cap is
 *    structural too, and there is no "the model forgot a brace" failure mode.
 * 3. THE CONTEXT COMES FROM ctx. Today's date is stated in the prompt because
 *    §2.5 owns it; the model is never asked what day it is, only to copy the
 *    date it was given.
 *
 * What IS left to the prompt is the hard part and the interesting one: does a
 * 2B model, given five plausible skills, pick the right one and pull the
 * arguments out of the sentence? That is what scripts/plannerbench.mjs measures.
 */

import { todayYMD, toISO, weekdayOf } from './lib/dates.js';
import { normalisePlanRefs } from './plan.js';

/** GBNF constraining output to a valid plan over exactly these skills. */
/* RUNWAY.
   With `runway`, the plan opens with a short free-text "about" field, which the
   model writes before it has to name a skill. It reads like a decoration and is
   not: measured on 60 graded questions, the shipped 2B model went from 28 right
   with 23 declines to 39 right with 3. Eighteen points, for a dozen tokens.

   Why it works is visible in an earlier accident. The same model scored 6% when
   a grammar forced the skill name as its very first token, and 49% inside the
   normal plan JSON, where it types {"steps":[{"id":"s1","skill":" first. The
   scaffolding was already acting as a runway; this lengthens it deliberately.
   A model that reasons before answering cannot reason when the first token it
   emits must be the answer.

   It is not free. Committing more often means declining less, and some of those
   declines were correct: on the 302-question holdout with the adapter routing,
   always-on runway answers 217 (against 142 plain) but leaks 22 of 50 no-skill
   messages (against 1). So the app does not use it on every turn. It uses
   `runway: 'auto'` — runway only when the router already believes a skill
   exists, which the category adapter can say with near-perfect separation —
   and that lands at 212 answered with 4 leaks. See llmPlanner below. */
export function planGrammar (skillNames, { runway = false } = {}) {
  const alts = skillNames.map(n => `"${n}"`).join(' | ');
  return [
    runway
      ? 'root ::= "{\\"about\\":" str ",\\"steps\\":[" steps? "]}"'
      : 'root ::= "{\\"steps\\":[" steps? "]}"',
    'steps ::= step ("," step)*',
    'step ::= "{\\"id\\":\\"" id "\\",\\"skill\\":\\"" skill "\\",\\"input\\":" obj "}"',
    'id ::= "s" [1-8]',
    `skill ::= ${alts}`,
    'obj ::= "{" (pair ("," pair)*)? "}"',
    'pair ::= str ":" val',
    'val ::= str | num | "true" | "false" | "null" | obj | arr',
    'arr ::= "[" (val ("," val)*)? "]"',
    'str ::= "\\"" chr* "\\""',
    'chr ::= [^"\\\\] | "\\\\" ["\\\\/bfnrt]',
    'num ::= "-"? int frac? exp?',
    'int ::= "0" | [1-9] [0-9]*',
    'frac ::= "." [0-9]+',
    'exp ::= [eE] [-+]? [0-9]+'
  ].join('\n');
}

/** §3.2's compact card, rendered. Types only — the full schema stays in JS. */
export function renderCard (card, { example = true } = {}) {
  const lines = [`${card.name} — ${card.description}`];
  if (card.required.length) lines.push(`  needs: ${card.required.join(', ')}`);
  if (card.optional.length) lines.push(`  optional: ${card.optional.join(', ')}`);
  /* `example: false` is a bench knob (prompt-variants.mjs `no-example-cards`):
     the hypothesis is that the model word-matches the message against the
     e.g. line and picks a sibling on vocabulary rather than on the description.
     The default is what ships and what the data generators render. */
  if (card.example && example) {
    lines.push(`  e.g. "${card.example.text}" → ${JSON.stringify(card.example.input)}`);
  }
  return lines.join('\n');
}

/** The skill names a plan has written so far, in order, whole names only:
 *  `"skill":"convertLength"` counts once its closing quote is there. */
export function skillsNamedIn (partialJson) {
  return [...String(partialJson ?? '').matchAll(/"skill"\s*:\s*"([^"]*)"/g)].map(m => m[1]);
}

/** The user turn exactly as the planner sends it.
 *
 * Exported because training data has to be byte-identical to what the model
 * will see at inference — the category adapter's README is emphatic about this
 * and it was learnt the hard way there. A generator that rebuilt this string by
 * hand would drift from the planner the first time either changed, so
 * scripts/plannerdata.mjs calls this function instead. */
export function plannerUserMessage ({ message, cards, ctx, ranked = false, order = 'skills-first', cardExamples = true, carry = null }) {
  const today = todayYMD(ctx);
  const iso = toISO(today);
  const context = `TODAY\n${iso} (${weekdayOf(today)}), timezone ${ctx.timezone}, locale ${ctx.locale}.`;
  const skills = `${ranked ? 'SKILLS (best match first)' : 'SKILLS'}\n${cards.map(c => renderCard(c, { example: cardExamples })).join('\n')}`;
  /* Only a Reply to a worked-out answer adds this block. Without one the prompt
     is byte for byte what it was, so the holdout cannot move because of it. */
  const earlier = earlierAnswerBlock(carry);
  const said = earlier ? `${earlier}\n\nMESSAGE\n${message}` : `MESSAGE\n${message}`;
  /* `order: 'message-first'` is a bench knob: a small model reads left to
     right, and today it reads twenty cards before it learns the question. */
  return order === 'message-first'
    ? `${context}\n\n${said}\n\n${skills}`
    : `${context}\n\n${skills}\n\n${said}`;
}

/* The answer a message is a reply to, as values the plan may point at. Only
   what the skill computed is listed, each with the ref that reads it, so the
   model copies a ref and never re-types a figure. */
export function earlierAnswerBlock (carry) {
  const ok = ((carry && carry.results) || []).filter(r => r && r.ok && r.value && typeof r.value === 'object' && !Array.isArray(r.value));
  if (!ok.length) return '';
  const lines = ok.slice(0, 3).map(r => {
    const fields = Object.entries(r.value)
      .filter(([, v]) => (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && v.length <= 40))
      .slice(0, 8);
    return `${r.id} ${r.skill}: ${fields.map(([k, v]) => `${k} = ${JSON.stringify(v)} ("$prev.${r.id}.${k}")`).join(', ')}`;
  });
  return `EARLIER ANSWER\nThe message is a reply to this answer${carry.message ? ` to "${String(carry.message).slice(0, 120)}"` : ''}.\n${lines.join('\n')}`;
}

/* The rule that goes with the block, and only with it. */
export const CARRY_RULE = '5b. When the message refers to a value in the EARLIER ANSWER ("that", "it", "the total"), write its ref exactly as listed, such as "$prev.s1.result". A number the message states itself is copied from the message, never taken from the earlier answer.';

/** The system prompt, with the runway rule appended when the runway is on.
 *  Same reason as above: one definition, used by both the planner and the
 *  data generator. */
export const RUNWAY_RULE = '8. Begin the JSON with a short "about" field naming what the user wants in a few words, then the steps.';

/* A pack's copy of a prompt is the same prompt when it has the same text. */
export const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** The Pigeon that is the shipped planner prompt in this version. */
export function plannerPigeon ({ runway = false, carry = false } = {}) {
  return `patch-planner${runway ? '-runway' : ''}${carry ? '-carry' : ''}`;
}

/* Patch v7: one trained planner (Qwen3-VL 2B) in place of the four prompted
   ones; it learnt the runway and the carry from its rows. Asked when his nest
   carries it (`plannerOptions.pigeonId`), so a v6 nest keeps its four. */
export const TRAINED_PLANNER = 'patch-planner-trained';

export function plannerSystem ({ runway = false, ranked = false, system = SYSTEM, runwayRule = RUNWAY_RULE, carry = false } = {}) {
  let out = system;
  if (carry) out += '\n' + CARRY_RULE;
  if (ranked) out += '\n7. The SKILLS list is ordered best match first. Use the first skill unless it clearly cannot do what was asked.';
  if (runway) out += '\n' + runwayRule;
  return out;
}

export const SYSTEM = `You turn a user's message into a PLAN: an ordered list of skill calls that will answer it.

You never answer the question yourself. You never do arithmetic, convert units, or work out a date. Verified code does all of that. Your only job is to choose skills from the list and copy the right values out of the message into their arguments.

RULES
1. Use ONLY the skills in the SKILLS list. There are no others.
2. If nothing in the list fits, return {"steps":[]}. This is a correct and common answer. Writing, summarising, translating, opinions, advice and conversation have no skill — return an empty plan for those.
2b. When a skill whose name begins with "web" is in the list, it can look things up on the internet. Use it for a question about a person, a place, an event or a current office-holder — anything you would otherwise have to answer from memory. Pass the user's question through as the argument. Never answer such a question yourself, and prefer an offline skill when one genuinely covers it.
3. Copy values out of the message. Never invent a number, date, name or unit that is not there or in TODAY.
4. Leave out an argument you cannot find in the message. Do not guess it. Code will ask the user. If the message names the thing to work on but has not included it — "tidy this json", "sort these rows" — still choose the skill and leave that argument out.
5. A later step may use an earlier step's output as a value: "$s1.fieldName". The "$" is required, and it works inside a longer value too: "$s1.result * 10".
6. Reply with the plan JSON only.`;

/* ── on making this planner braver, and why rule 4 stays as it is ───────────
 *
 * 28 holdout questions had the right skill ranked FIRST on the shortlist and
 * were declined anyway, nearly all of them requests whose data had not been
 * pasted in — "tidy this json", "does this account number check out". The
 * executor already handles that properly: an absent required field becomes
 * ASK_USER and the person is asked "Which JSON should I format?". So a rule was
 * added telling the planner to name the skill and leave the argument out.
 *
 * It did not do that. It invented the arguments instead.
 *
 *                        right       failed   leaks   declined
 *   rule 4 as written     233/308     7        2/50    89
 *   plus "commit anyway"  230/308     15       4/50    79
 *
 * Ten more commitments bought two questions, eight failures and two leaks. The
 * caution in rule 4 is load-bearing: loosened in general, the model does not
 * become more helpful, it becomes less careful — and rule 3 ("never invent a
 * value") is the rule that quietly goes with it.
 *
 * That is the third time this has been measured here. The ungated runway, the
 * tie-break, and this all made the planner more willing and all cost more than
 * they gained. The one intervention that DID pay — the runway gated on the
 * category adapter — did not make the planner braver in general; it made it
 * braver only when something had recognised the request. The lesson is not
 * "never loosen the planner". It is that willingness has to be conditioned on a
 * signal, and a prompt has no signal to condition on. */
export const SHOTS = [
  {
    user: 'SKILLS\nwebAnswer — A short factual answer looked up on the web, with the page it came from.\n  needs: question: string\n\nMESSAGE\nwho is the mayor of Lisbon',
    about: 'looking a fact up on the web',
    assistant: '{"steps":[{"id":"s1","skill":"webAnswer","input":{"question":"mayor of Lisbon"}}]}'
  },
  {
    user: 'SKILLS\ncountdownTo — Days from today until a date, or how long ago it was.\n  needs: to: string\n\nMESSAGE\nhow many days until christmas',
    about: 'counting days from today to a date',
    assistant: '{"steps":[{"id":"s1","skill":"countdownTo","input":{"to":"2026-12-25"}}]}'
  },
  {
    /* The empty plan gets a demonstration of its own, because it is 15% of the
       training mix in §7.3 and the failure it prevents — reaching for a
       near-miss skill on a writing request — is the one users notice most. */
    user: 'SKILLS\nconvertCase — Change the capitalisation of text.\n  needs: text: string, style: string\n\nMESSAGE\nwrite me a short poem about the sea',
    about: 'writing a poem, which no skill here does',
    assistant: '{"steps":[]}'
  },
  {
    user: 'SKILLS\ncountryLookup — A country\'s capital city, ISO codes, currency and dialling code.\n  needs: query: string\ncurrencyLookup — What a currency code stands for.\n  needs: code: string\n\nMESSAGE\nwhat is japan\'s currency called',
    about: 'a country\'s currency, then what that code means',
    assistant: '{"steps":[{"id":"s1","skill":"countryLookup","input":{"query":"Japan"}},{"id":"s2","skill":"currencyLookup","input":{"code":"$s1.currency"}}]}'
  },
  {
    /* THE EMPTY INPUT. Rule 4 says to leave out what the message does not
       contain, and until this shot no demonstration showed it — so on "tidy
       this json" the model returned an empty PLAN rather than the skill with
       an empty INPUT. The two are not the same answer: the empty input goes
       to the executor, which asks for the JSON; the empty plan is a decline.
       Eleven of the planner's holdout declines were this shape. */
    user: 'SKILLS\nformatJson — Tidy JSON into readable indented form, or squash it onto one line.\n  needs: text: string\nflattenJson — Flatten nested JSON into a single level of dot-separated paths.\n  needs: json: string\n\nMESSAGE\nmake this json readable please',
    about: 'formatting a JSON document the user has not pasted yet',
    assistant: '{"steps":[{"id":"s1","skill":"formatJson","input":{}}]}'
  },
  {
    /* A ref used INSIDE a value rather than as the whole of one. The model
       reached for this unprompted — and wrote "s1.result * 10", without the
       "$" — so the shape is clearly natural to it and what it needed was the
       syntax. normalisePlanRefs repairs the missing "$" as well; this shot is
       what stops it being needed on the common case. */
    user: 'SKILLS\nproduct — Multiply numbers together.\n  needs: values: array\nevaluateExpression — Work out a plain arithmetic expression exactly.\n  needs: expression: string\n\nMESSAGE\nwhat is 20 * 200? then multiply by 10',
    about: 'multiplying two numbers, then scaling the result',
    assistant: '{"steps":[{"id":"s1","skill":"product","input":{"values":[20,200]}},{"id":"s2","skill":"evaluateExpression","input":{"expression":"$s1.result * 10"}}]}'
  }
];

/**
 * Build the §3.2 planner. Satisfies the `planner` seam in turn.js, so passing
 * it in takes the PLANNED branch and everything downstream is unchanged.
 *
 * @param {object} deps
 * @param {Function} deps.complete   from llm.js
 * @param {Registry} deps.registry
 * @param {boolean}  deps.fewShot    include the three demonstrations
 */
/* `system` and `shots` are injectable so the prompt can be A/B tested against
   the bench without editing this file between runs. The prompt is the single
   biggest lever on how often the model commits versus declines, and a lever
   that can only be pulled by editing production code does not get measured. */
/* `ranked` tells the model what the order of the list means. The router hands
   the cards best-match first, and a 2B model given no hint treats them as a
   menu of equals — it picked the second-ranked convertSpeed over a 0.70
   convertLength. Saying the order is a ranking is the cheapest possible fix;
   whether it is enough is measured by the bench, not assumed. */
/* `order`, `cardExamples` and `runwayRule` are bench knobs carried by a prompt
   variant (scripts/prompt-variants.mjs). Their defaults are the shipped prompt
   byte for byte; a variant that wins is promoted by changing the default. */
export function llmPlanner ({ complete, registry, fewShot = true, maxTokens = 200, system = SYSTEM, shots = SHOTS, runway: runwayMode = false, ranked = false,
                              order = 'skills-first', cardExamples = true, runwayRule = RUNWAY_RULE, pigeonId = null }) {
  /* `onSkill(name, n)`: the n-th skill the plan names, the moment its name
     is whole in the stream — about ten tokens into the plan, well before
     its arguments. Only ever a name from the cards, since the grammar admits
     no other; the plan itself is still read whole from the reply. */
  const planner = async ({ message, cards, ctx, routerConfident = false, carry = null, onSkill = null }) => {
    if (!cards.length) return { steps: [] };
    /* RUNWAY, ONLY WHEN THE ROUTER IS SURE. Measured on the 302-question
       holdout with the category adapter routing: the plain prompt answers 142
       and leaks 1 of 50 no-skill messages; the runway answers 217 and leaks 22.
       The runway cures timidity and causes over-commitment, and the two show
       up on different questions — the declines are where the router already
       has an actionable pick, the leaks are where it has none. So the router's
       own verdict chooses the prompt: room to think when there is a skill to
       find, the cautious prompt when there probably is not. */
    const runway = runwayMode === 'auto' ? routerConfident : Boolean(runwayMode);

    const user = plannerUserMessage({ message, cards, ctx, ranked, order, cardExamples, carry });

    const messages = [{ role: 'system', content: plannerSystem({ runway, ranked, system, runwayRule, carry: Boolean(earlierAnswerBlock(carry)) }) }];
    if (fewShot) {
      for (const s of shots) {
        messages.push({ role: 'user', content: s.user });
        /* Each shot describes ITS OWN request. An earlier version substituted the
           literal string "the request" into all three, and the model dutifully
           emitted "the request" every time — the field became four filler tokens
           rather than a place to work out what was being asked. It still bought
           eleven points, which says the runway alone has value; this asks whether
           orienting properly buys more. */
        messages.push({ role: 'assistant', content: runway
          ? s.assistant.replace('{"steps"', `{"about":${JSON.stringify(s.about ?? 'the request')},"steps"`)
          : s.assistant });
      }
    }
    messages.push({ role: 'user', content: user });

    const withCarry = Boolean(earlierAnswerBlock(carry));
    let named = 0;
    const onPiece = onSkill ? (sofar) => {
      const skills = skillsNamedIn(sofar);
      for (; named < skills.length; named++) onSkill(skills[named], named + 1);
    } : null;
    const out = await complete({
      messages,
      grammar: planGrammar(cards.map(c => c.name), { runway }),
      maxTokens: runway ? maxTokens + 60 : maxTokens,
      ...(onPiece ? { onPiece } : {}),
      /* The shipped prompt in its four versions is four Pigeons (D84, D86). */
      ...(system === SYSTEM && sameJson(shots, SHOTS) && runwayRule === RUNWAY_RULE && fewShot && !ranked && order === 'skills-first' && cardExamples
        ? { pigeon: { id: pigeonId ?? plannerPigeon({ runway, carry: withCarry }), input: user, values: { 'steps[].skill': cards.map(c => c.name) } } }
        : {})
    });

    planner.lastCall = { ms: out.ms, tokens: out.tokens, promptTokens: out.promptTokens, raw: out.text };

    try {
      const plan = JSON.parse(out.text);
      /* The grammar guarantees the shape, so a parse failure here means the
         model hit the token budget mid-plan. An unfinished plan is not a plan. */
      if (!plan || !Array.isArray(plan.steps)) return { steps: [] };
      /* Repair a ref the model wrote without its "$" — see normalisePlanRefs.
         Applied here, to the model's own output, so it can never touch a value
         the user typed. */
      return normalisePlanRefs(plan);
    } catch {
      return { steps: [] };
    }
  };

  planner.backend = 'llm';
  void registry;
  return planner;
}
