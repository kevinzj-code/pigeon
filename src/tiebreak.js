/* tiebreak.js — one more question, asked only when two skills are twins.
 *
 * The planner chooses from a shortlist of up to twenty, in one pass, having to
 * decide both WHICH skill and WHAT arguments. Most of its remaining mistakes are
 * not wild: it picks a near-twin of the right skill, in the right category —
 * `factorial` against `product` for "multiply 1 through 8 together",
 * `simpleInterest` against `compoundInterest` for "non-compounding interest".
 *
 * Contrastive descriptions removed nineteen of those. What is left is the
 * genuinely hard half, where the two skills answer overlapping questions and the
 * distinction is a single detail in the message — "non-compounding", "1 through
 * 8", "a saturday". That is a much easier question asked on its own than buried
 * in a twenty-way choice, so this asks it on its own.
 *
 * Deliberately NOT a general re-ranker. It sees two skills, answers with one
 * name under a grammar that admits nothing else, and cannot introduce a skill
 * the router never offered.
 *
 * ── IT DOES NOT WORK, AND THE NUMBERS ARE WHY IT IS STILL HERE ──────────────
 *
 * Measured on the same 308 holdout questions, with Qwen3.5-2B:
 *
 *                        answered right     sibling confusions
 *   no tie-break         232 / 308 (75%)    16
 *   ask when close       208 / 302 (69%)    33
 *   ask on disagreement  223 / 308 (72%)    24
 *
 * It costs answers and ADDS confusions. The reason is not hard to see once the
 * numbers are in front of you: the planner reads the whole message against
 * twenty candidates, and this reads two cards. Asked in isolation the question
 * looks easier, but the context that resolves it has been thrown away — and a
 * confident second opinion formed on less information is exactly how you talk
 * someone out of a right answer.
 *
 * So this is NOT wired into the app. It stays as a seam the benchmark can turn
 * on with --tiebreak, because the idea is reasonable and a better model may yet
 * make it pay; what is not reasonable is building it again without knowing it
 * was tried. If you re-test it, the number to beat is 232 of 308 at 16.
 */

const cardFor = (registry, name) => {
  const c = registry.compactCard(name);
  if (!c) return name;
  const lines = [`${c.name} — ${c.description}`];
  if (c.required.length) lines.push(`  needs: ${c.required.join(', ')}`);
  if (c.example) lines.push(`  e.g. "${c.example.text}"`);
  return lines.join('\n');
};

export const TIEBREAK_SYSTEM =
`Two skills could both plausibly answer the user's message. Pick the one that fits better.

Read what each skill NEEDS and what its example looks like — the difference is usually there rather than in the description. If the message names a detail only one of them handles, that is your answer.

Reply with one skill name and nothing else.`;

/**
 * @returns {(opts:{message:string,a:string,b:string}) => Promise<string|null>}
 *   resolves to the chosen name, or null if the model was unreachable or
 *   answered with something that was not one of the two.
 */
export function llmTieBreak ({ complete, registry }) {
  return async function tieBreak ({ message, a, b }) {
    if (!a || !b || a === b) return null;
    const grammar = `root ::= ${[a, b].map(n => JSON.stringify(n)).join(' | ')}`;
    try {
      const out = await complete({
        messages: [
          { role: 'system', content: TIEBREAK_SYSTEM },
          { role: 'user', content: `${cardFor(registry, a)}\n\n${cardFor(registry, b)}\n\nMESSAGE\n${message}` }
        ],
        grammar,
        maxTokens: 12,
        temperature: 0
      });
      const said = out.text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
      return said === a || said === b ? said : null;
    } catch {
      /* No model, or it failed. The planner's choice stands — a tie-break that
         cannot run must never be the reason a turn fails. */
      return null;
    }
  };
}

/**
 * The best same-category rival to `chosen` among the router's candidates, or
 * null when there is nothing close enough to be worth asking about.
 *
 * `margin` is what keeps this from firing on every turn. A rival scoring far
 * below the pick is not a tie, it is a wrong answer that happened to be in the
 * same category, and paying a model call to reject it would buy nothing.
 */
export function rivalFor (routing, registry, chosen, { onlyWhenOutranked = true } = {}) {
  if (!routing || !Array.isArray(routing.candidates)) return null;
  const skill = registry.skill(chosen);
  if (!skill) return null;

  const scoreOf = new Map(routing.candidates.map(c => [c.name, c.score]));
  const mine = scoreOf.get(chosen) ?? 0;

  for (const c of routing.candidates) {
    if (c.name === chosen) continue;
    const other = registry.skill(c.name);
    if (!other || other.category !== skill.category) continue;
    /* Candidates arrive ranked, so the first same-category rival is the best.
     *
     * Asking whenever a rival was merely CLOSE was measured and it was worse:
     * 230 of 302 became 208, because the question fires on most turns and every
     * firing is a chance to talk the planner out of a right answer. The signal
     * that carries information is disagreement — the router ranked something
     * above what the planner chose. That is rare, and it is the only case where
     * a second opinion has anything to add. */
    if (onlyWhenOutranked) return c.score > mine ? c.name : null;
    return c.name;
  }
  return null;
}
