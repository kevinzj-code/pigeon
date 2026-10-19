# Round 4 — sibling adapter on paraphrases (2026-09-08)
set: 13488 train · 1180 valid
## control
    answered right  176 / 308   (57%)
    wrong skill      32
    asked for a arg   0
    asked, honest    94   (right skill; the message lacked the value the planner had invented)
    correct incl. honest asks 272 / 308   (88%)
    skill failed      0
    declined         84
    no-skill leaks   20 / 100
    avg latency     1859ms
    verifier        fired 11 · switched 0 (→right 0, →wrong 0) · rescued declines 11 (right 10, wrong 1, leaked 0)
    declined         want diffText               got —                      "what changed between the old and new ver"
    declined         want findRepeatedWords      got —                      "am I overusing any words here"
    declined         want spellCheck             got —                      "any misspellings in this paragraph"
## sibling-v4
    answered right  177 / 308   (57%)
    wrong skill      30
    asked for a arg   0
    asked, honest    94   (right skill; the message lacked the value the planner had invented)
    correct incl. honest asks 273 / 308   (89%)
    skill failed      1
    declined         84
    no-skill leaks   20 / 100
    avg latency     2221ms
    verifier        fired 304 · switched 6 (→right 3, →wrong 1) · rescued declines 11 (right 10, wrong 1, leaked 0)
    declined         want diffText               got —                      "what changed between the old and new ver"
    declined         want findRepeatedWords      got —                      "am I overusing any words here"
    declined         want spellCheck             got —                      "any misspellings in this paragraph"
  304 verifier events written to <repo>/model/round4/logs/vlog-sibling-v4.json
## Ship rule
- sibling v4 ships if: verifier (→right − →wrong) ≥ +8 AND correct ≥ control AND leaks ≤ control.
- control is measured in THIS run, so the widened bench (308 + 100) and workstream 1 are already in it.
- if the ungated ledger misses +8, read vlog-sibling-v4.json for the round-3 gate (chosen == lexical top), which was +4 with zero harm.

## Verdict: NOT SHIPPED

Net +2 against a rule of +8. 273 vs 272 correct is inside the noise band, and
the verifier costs 362 ms a turn (1859 → 2221).

Switched 6 of 304 fired:

| draft | chosen | wanted | |
|---|---|---|---|
| loremIpsum | generateChecklist | generateChecklist | right |
| streakCount | convertTime | convertTime | right |
| intersectLists | unionLists | unionLists | right |
| lcm | gcd | lcm | wrong |
| ratioSolve | fractionSimplify | aspectRatio | neutral |
| countOccurrences | syllableCount | scrabbleScore | neutral |

Round 3's rescue — gating on `chosen == lexical top` — does not transfer:
2 right / 1 wrong here, against +4 / 0 harm there. Eleven turns still keep the
wrong skill with the right one in the offered list, the same wall as rounds
1–3.

## Three rounds of this idea

| round | data | net |
|---|---|---|
| 2 | the skills' own examples | −3 (4 right / 7 broke) |
| 3 | Flight School paraphrases | +5 (6 right / 1 broke) |
| 4 | + 300 contrastive pair messages | +2 (3 right / 1 broke) |

The most targeted data yet did worse than round 3. The same day's prompt batch
says why: `no-example-cards` cost 39 answers, so the card's `e.g.` line is
where the discrimination lives — and a verifier shown two cards has already
thrown away the message context that resolves them. Asked alone the question
looks easier; it is not. That is the same finding `tiebreak.js` records from
the prompted 2B, now reproduced with a trained model on three different sets.

**Stop training pairwise verifiers for sibling confusion.** The measured lever
is the cards themselves: contrasting descriptions took confusions 32 → 13 on
main, with no model involved.
