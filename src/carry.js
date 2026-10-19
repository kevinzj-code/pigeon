/* carry.js — E2: a Reply to a worked-out answer, lined up with that answer.
 *
 * When a person replies "split that 3 ways" to a £97.18 answer, the planner is
 * shown the earlier answer and asked to write "$prev.s1.total". A 2B model
 * does that rarely (measured: 2 of 60). What it does instead is predictable,
 * and each shape has a repair that needs no judgement:
 *
 *   1. It writes "$s1.total" — a ref to a step this plan does not have. When
 *      the carried answer has that step, the ref meant it.
 *   2. It re-types the figure, 97.18, instead of the ref. A number equal to
 *      exactly one carried figure, and not in the person's own words, is that
 *      figure.
 *   0. It picks a sibling of the operation the reply names (see OPERATIONS).
 *   3. It fills the field "that" points at with a number from nowhere (a skill
 *      card's example, 250) or leaves it out. When the message points back
 *      ("that", "it", "the total"), the skill's `carry: true` field takes the
 *      figure the message names, or else the answer's headline figure — the
 *      first figure the earlier reply showed.
 *
 * Every repair runs only when a Reply is carrying an answer. Without one this
 * file is never called, so a plan for an ordinary message cannot change here.
 * Each repair is recorded, so the plan view can say what was lined up and why.
 */

import { isRef } from './contracts.js';

/* Words that point back at an earlier answer. */
const POINTS_BACK = /\b(?:that|it|this|those|them|the\s+(?:same|result|answer|figure|amount|number|total|price|gross|net|tip|interest|payment|salary|balance|share|base|saving|cost|rate|percent|annual|monthly|weekly|hourly|daily))\b/i;

const NUMBER = /-?\d[\d,]*(?:\.\d+)?/g;
const numbersIn = (text) => new Set([...String(text || '').matchAll(NUMBER)].map(m => Number(m[0].replace(/,/g, ''))).filter(Number.isFinite));
const same = (a, b) => typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) < 1e-9;

/** Every numeric figure a carried answer computed: {id, field, value, echo}.
 *  `echo` marks an output that only repeats an input the person gave ("15% of
 *  240 is 36" echoes 15 and 240) — a figure they typed, not one worked out. */
export function carriedFigures (carry) {
  const out = [];
  for (const r of (carry && carry.results) || []) {
    if (!r || !r.ok || !r.value || typeof r.value !== 'object' || Array.isArray(r.value)) continue;
    for (const [field, value] of Object.entries(r.value)) {
      if (typeof value !== 'number' || !Number.isFinite(value)) continue;
      const echo = Boolean(r.input && Object.prototype.hasOwnProperty.call(r.input, field) && same(r.input[field], value));
      out.push({ id: r.id, field, value, echo });
    }
  }
  return out;
}

/** The figure an answer leads with: the first worked-out figure its reply
 *  showed, never one that only repeats what was typed; else the first
 *  worked-out output; else the first figure at all. */
export function headlineFigure (carry) {
  const figures = carriedFigures(carry);
  if (!figures.length) return null;
  for (const seg of (carry.reply && carry.reply.segments) || []) {
    if (!seg || seg.type !== 'value' || !seg.field || !seg.step) continue;
    const hit = figures.find(f => f.id === seg.step && f.field === seg.field && !f.echo);
    if (hit) return hit;
  }
  return figures.find(f => !f.echo) || figures[0];
}

/* "monthlyPayment" → "monthly payment"; "perPerson" → "per person". */
const wordsOf = (field) => field.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();

/** The carried figure the message names ("the tip", "the monthly payment"),
 *  choosing the longest name that matches; null when none, or when two
 *  different figures match equally. */
export function namedFigure (carry, message) {
  const text = ` ${String(message || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `;
  let best = null;
  let tie = false;
  /* A person pointing back means what was worked out: "that price" after "25%
     off an 80 jacket" is the 60, not the 80 they typed. */
  for (const f of carriedFigures(carry).filter(x => !x.echo)) {
    const name = wordsOf(f.field);
    if (!text.includes(` ${name} `)) continue;
    if (!best || name.length > wordsOf(best.field).length) { best = f; tie = false; }
    else if (name.length === wordsOf(best.field).length && (best.id !== f.id || best.field !== f.field)) tie = true;
  }
  return tie ? null : best;
}

const refTo = (f) => `$prev.${f.id}.${f.field}`;

/* 0 — THE OPERATION A REPLY NAMES. "take 5% off that", "add 20% vat to it",
   "round the total to 0 decimal places", "split that between 4": each names one
   plain operation and one setting for it, and the figure is the one pointed at.
   Measured on the practice and fresh sets (rounds 2–3), the planner's misses on
   these were all a sibling chosen for the operation — a one-discount
   stackDiscounts, allocateProportionally for an even split, the earlier skill
   again — never a misread setting. So when a reply names exactly one of these
   and every number in it is that operation's setting, the operation is the
   plan. Anything else (two operations, a figure of its own) is left to the
   planner and the repairs below. */
const NUM = '(\\d+(?:\\.\\d+)?)';
const FRACTIONS = { half: 50, third: 100 / 3, quarter: 25, fifth: 20, tenth: 10 };
const WHOLE = /\bround\b.*?\bto\s+(?:the\s+)?(?:nearest\s+)?(?:a\s+)?(?:whole(?:\s+number)?|integer|(?:pound|dollar|euro|unit))\b/i;
const OPERATIONS = [
  { skill: 'roundTo', re: new RegExp(`\\bround\\b.*?\\bto\\s+${NUM}\\s*(?:decimal places?|decimals?|dp|places?)\\b`, 'i'), params: (m) => ({ places: Number(m[1]) }) },
  /* "to the nearest whole number", "to a whole number": no digit, so no places
     are written here — a number the message does not contain would be dropped
     by the input audit. The extractor reads the words as 0 places. */
  { skill: 'roundTo', re: WHOLE, params: () => ({}), numbers: () => [] },
  { skill: 'applyDiscount', re: new RegExp(`${NUM}\\s*(?:%|percent)\\s+off\\b`, 'i'), params: (m) => ({ percent: Number(m[1]) }) },
  /* "less 10%", "minus 25% from the total". */
  { skill: 'applyDiscount', re: new RegExp(`\\b(?:less|minus)\\s+${NUM}\\s*(?:%|percent)`, 'i'), params: (m) => ({ percent: Number(m[1]) }) },
  { skill: 'applyTax', re: new RegExp(`\\badd\\s+${NUM}\\s*(?:%|percent)(?:\\s+(?:vat|tax|sales tax))?\\s+(?:to|on(?:to)?)\\b`, 'i'), params: (m) => ({ rate: Number(m[1]) }) },
  /* "add 20% vat", "put 20% vat on that", "plus 20% vat", "with 20% tax on top". */
  { skill: 'applyTax', re: new RegExp(`\\b(?:add|put|plus|with)\\s+${NUM}\\s*(?:%|percent)\\s+(?:vat|tax|sales tax)\\b`, 'i'), params: (m) => ({ rate: Number(m[1]) }) },
  { skill: 'percentOf', re: new RegExp(`${NUM}\\s*(?:%|percent)\\s+of\\b`, 'i'), params: (m) => ({ percent: Number(m[1]) }) },
  /* "a tenth of the balance", "half of it". */
  { skill: 'percentOf', re: /\b(?:(?:a|one)\s+)?(half|third|quarter|fifth|tenth)\s+of\b/i, params: (m) => ({ percent: FRACTIONS[m[1].toLowerCase()] }), numbers: () => [] },
  { skill: 'splitEvenly', re: new RegExp(`\\b(?:split|share|divide)\\b.*?\\b(?:between|among|into|by|over)?\\s*${NUM}(?:\\s+(?:ways|people|persons|parts|equal parts|equal shares|of us))?\\b`, 'i'), params: (m) => ({ parts: Number(m[1]) }) },
  /* "per head for 4 of us", "each if 4 of us share it", "4 of us share it". */
  { skill: 'splitEvenly', re: new RegExp(`\\b(?:per\\s+(?:head|person)|each|share)\\b.*?\\b${NUM}\\s+(?:of us|people|persons)\\b|\\b${NUM}\\s+of us\\b.*?\\b(?:share|split|divide)`, 'i'), params: (m) => ({ parts: Number(m[1] ?? m[2]) }), numbers: (m) => [Number(m[1] ?? m[2])] }
];

/** The one operation a reply names, with its setting, or null. */
export function namedOperation (message) {
  const text = String(message || '');
  const found = [];
  for (const op of OPERATIONS) {
    const m = text.match(op.re);
    if (m && !found.some(f => f.skill === op.skill)) found.push({ skill: op.skill, params: op.params(m), numbers: op.numbers ? op.numbers(m) : [Number(m[1])] });
  }
  if (found.length !== 1) return null;
  /* Every number in the reply is the operation's setting: "take 10% off the
     price of 250" gives a figure of its own and is not a reply to anything. */
  const all = [...numbersIn(text)];
  return all.every(n => found[0].numbers.some(x => same(x, n))) ? found[0] : null;
}

/**
 * Line a planned reply up with the answer it carries.
 * @returns {{plan: object, repairs: Array<{step, field, from, to, why}>}}
 */
export function alignToCarry (plan, { carry, message = '', registry = null } = {}) {
  const repairs = [];
  if (!carry || !plan || !Array.isArray(plan.steps) || !plan.steps.length) return { plan, repairs };
  const figures = carriedFigures(carry);
  if (!figures.length) return { plan, repairs };
  const carriedIds = new Set(figures.map(f => f.id));
  const typed = numbersIn(message);
  const pointsBack = POINTS_BACK.test(String(message || ''));
  const target = namedFigure(carry, message) || (pointsBack ? headlineFigure(carry) : null);

  const op = target && registry && registry.skill ? namedOperation(message) : null;
  const opSkill = op && registry.skill(op.skill);
  const opField = opSkill && Object.entries((opSkill.inputSchema && opSkill.inputSchema.properties) || {}).find(([, p]) => p && p.carry === true);
  if (op && opField) {
    const input = { [opField[0]]: refTo(target), ...op.params };
    const planned = plan.steps.length === 1 && plan.steps[0] && plan.steps[0].skill === op.skill
      && JSON.stringify(plan.steps[0].input || {}) === JSON.stringify(input);
    if (!planned) {
      repairs.push({ step: 's1', field: opField[0], from: plan.steps.map(st => st && st.skill).join(' → '), to: `${op.skill} on ${refTo(target)}`, why: 'the one operation your reply names, on the answer it points at' });
      return { plan: { ...plan, steps: [{ id: 's1', skill: op.skill, input }] }, repairs };
    }
  }

  const earlier = new Set();
  const steps = plan.steps.map((step, index) => {
    if (!step || typeof step !== 'object') return step;
    const input = { ...(step.input && typeof step.input === 'object' ? step.input : {}) };

    for (const [field, value] of Object.entries(input)) {
      /* 1 — "$s1.total" for a step this plan has not got. */
      if (typeof value === 'string') {
        const fixed = value.replace(/\$([A-Za-z][A-Za-z0-9_]*)((?:\.[A-Za-z0-9_]+)+)/g, (whole, id, path) => {
          if (id === 'prev' || earlier.has(id) || !carriedIds.has(id)) return whole;
          return `$prev.${id}${path}`;
        });
        if (fixed !== value) { repairs.push({ step: step.id, field, from: value, to: fixed, why: 'a ref to a step of the earlier answer' }); input[field] = fixed; }
        continue;
      }
      /* 2 — the figure re-typed rather than referred to. */
      if (typeof value === 'number' && !typed.has(value)) {
        const matches = figures.filter(f => same(f.value, value));
        if (matches.length === 1) {
          repairs.push({ step: step.id, field, from: value, to: refTo(matches[0]), why: 'the earlier figure, typed rather than referred to' });
          input[field] = refTo(matches[0]);
        }
      }
    }

    /* 3 — the field "that" points at, on the first step only: a later step reads
       the first one, not the earlier answer. */
    if (index === 0 && target && registry && registry.skill) {
      const skill = registry.skill(step.skill);
      const props = (skill && skill.inputSchema && skill.inputSchema.properties) || {};
      const field = Object.keys(props).find(k => props[k] && props[k].carry === true);
      if (field) {
        const value = input[field];
        const want = refTo(target);
        const pointsAtTarget = value === want;
        const isCarried = typeof value === 'string' && isRef(value) && value.startsWith('$prev.');
        const invented = typeof value === 'number' && !typed.has(value) && !figures.some(f => same(f.value, value));
        /* Any other earlier figure in the field "that" belongs to is the wrong
           one: a named figure wins when there is one, the headline when the
           message only says "it". */
        const otherCarried = isCarried && !pointsAtTarget;
        /* The target's own value, typed: the same figure, but as a number it
           cannot say where it came from — and two fields can share a value. */
        const typedTarget = typeof value === 'number' && !typed.has(value) && same(value, target.value);
        if (!pointsAtTarget && (value === undefined || invented || otherCarried || typedTarget || (typeof value === 'number' && typed.has(value)))) {
          /* A number the person typed, sitting in the field "that" belongs to,
             was put in the wrong place: it is let go, so the extractor can give
             it to the field its words cue ("3 ways" → parts). */
          repairs.push({ step: step.id, field, from: value === undefined ? null : value, to: want, why: namedFigure(carry, message) ? 'the figure the message names' : 'the answer "that" points at' });
          input[field] = want;
        }
      }
    }

    earlier.add(step.id);
    return { ...step, input };
  });

  /* 4 — a message's own numbers win. "simple interest on 2000 at 4% for 2
     years" names a figure the earlier answer also has, and the model reached
     for the earlier one. When a message does not point back with a pronoun and
     carries a number the plan has not used, nothing is carried: every earlier
     ref comes out, and the extractor fills those fields from the message. */
  if (!POINTS_BACK_PRONOUN.test(String(message || ''))) {
    const used = new Set();
    for (const step of steps) for (const v of Object.values((step && step.input) || {})) if (typeof v === 'number') used.add(v);
    const unused = [...typed].filter(n => ![...used].some(u => same(u, n)));
    if (unused.length) {
      for (const step of steps) {
        if (!step || !step.input) continue;
        for (const [field, value] of Object.entries(step.input)) {
          if (typeof value === 'string' && isRef(value) && value.startsWith('$prev.')) {
            repairs.push({ step: step.id, field, from: value, to: null, why: `your message gives its own number (${unused[0]})` });
            delete step.input[field];
          }
        }
      }
    }
  }
  return { plan: { ...plan, steps }, repairs };
}

/* Only a pronoun points back strongly enough to outweigh a number in the
   message: "the price per kg of 2.5 kg for 7.50" names a price and gives it. */
const POINTS_BACK_PRONOUN = /\b(?:that|it|this|those|them)\b/i;
