#!/usr/bin/env python3
"""Near-copy detection between generated rows and the held-out question set.

Shared by build_category_router.py and its tests. Kept in its own module so the
gate can be re-run against the written files INDEPENDENTLY of the generation
that produced them — a gate that only ever runs inside the generator proves
nothing about what landed on disk.

The rule the plan states: two questions are the same if they differ only by
their numbers, by punctuation or capitalisation, or by a single swapped
stopword. That is implemented as five rules over a normalised form.

LENGTH GUARDS ARE LOAD-BEARING. Digit stripping collapses short questions hard:

    seed      "reduce -4/8"        (fractionSimplify)  -> ['reduce']
    forbidden "reduce 249 by 30%"  (applyDiscount)     -> ['reduce', 'by']

Those are unrelated questions. Rule 2 matches them on content words, and rule 3
matches them at edit distance 1 — so flooring rules 2/4/5 at three content words
is NOT enough on its own; rule 3 needs a token floor too. Measured over the 1510
seeds: no guards drops 58, guarding 2/4/5 only drops 47 (both kill the seed
above), guarding 2/3/4/5 drops 35 and the seed survives.

Rule 1 stays unguarded at any length, so an exact reproduction is always caught.
"""
import re

# Deliberately broad: every word here is one the plan would call a stopword,
# so a pair differing only in these is "the same question".
STOPWORDS = set("""
a an the this that these those is are was were be been being am to of in on for
with and or my me i you your it its at as from what how many much do does did
can could would should will please give show tell need want into out up down by
so if any some there here get got make made just now then than about over under
""".split())

# Month, weekday and holiday names are the NUMERIC ARGUMENTS of a date question
# spelled as words. "12 july 2026" and "3 march 2027" differ only in their data,
# so july/march must strip exactly like 12/2026 does, or the gate lets a date
# question through that differs from an exam item only by its date.
_DATE_WORDS = set("""
january february march april may june july august september october november
december jan feb mar apr jun jul aug sep sept oct nov dec
monday tuesday wednesday thursday friday saturday sunday
mon tue tues wed thu thur thurs fri sat sun
christmas xmas easter halloween thanksgiving newyear
""".split())

_DIGITS = re.compile(r"\d+")
_NONALPHA = re.compile(r"[^a-z\s]")


def normalise(text):
    """Lowercase, strip ALL digits (including inside tokens: 3d6->d, 1h->h) and
    all date words, drop punctuation, collapse whitespace. Returns a token list."""
    t = _DIGITS.sub("", text.lower())
    t = _NONALPHA.sub(" ", t)
    return [w for w in t.split() if w not in _DATE_WORDS]


def content(text):
    """Normalised tokens with stopwords removed."""
    return [w for w in normalise(text) if w not in STOPWORDS]


def _edit_distance_le1(a, b):
    """True when token sequences a and b are within one edit of each other."""
    if abs(len(a) - len(b)) > 1:
        return False
    if a == b:
        return True
    if len(a) > len(b):
        a, b = b, a
    # a is now the shorter (or equal) sequence
    i = j = 0
    used = False
    while i < len(a) and j < len(b):
        if a[i] == b[j]:
            i += 1
            j += 1
            continue
        if used:
            return False
        used = True
        if len(a) == len(b):
            i += 1
        j += 1
    return True


def _trigrams(text):
    s = " " + " ".join(normalise(text)) + " "
    return {s[k:k + 3] for k in range(max(0, len(s) - 2))}


class Gate:
    """Holds the held-out set and answers 'is this row a near-copy of it'."""

    # Measured floor, not a guessed one. These two pairs bracket it exactly:
    #   "round 12.3456 at 2 dp" / "round 88.4567 to 3 dp"  -> both ['round','dp']
    #        the SAME question, one swapped stopword: must block, 2 content words
    #   "reduce -4/8" / "reduce 249 by 30%"                 -> both ['reduce']
    #        DIFFERENT questions: must survive, 1 content word
    # So the floor is 2. A floor of 3 (the obvious guess) lets the round pair
    # through; no floor at all kills the reduce pair.
    MIN_CONTENT = 2   # floor for rules 2 and 4
    MIN_TRIGRAM = 3   # floor for rule 5, which is noisy on very short strings
    MIN_TOKENS = 4    # floor for rule 3
    JACCARD = 0.75
    TRIGRAM_COSINE = 0.85

    def __init__(self, forbidden):
        self.items = []
        for q in forbidden:
            n = normalise(q)
            c = content(q)
            self.items.append((q, n, c, tuple(sorted(c)), _trigrams(q)))
        self._exact = {tuple(n) for _, n, _, _, _ in self.items}

    def check(self, text):
        """Return (rule_number, forbidden_question) for the first rule that
        fires, or None. Rules are ordered cheapest-first."""
        n = normalise(text)
        c = content(text)
        if tuple(n) in self._exact:
            for q, fn, _, _, _ in self.items:
                if fn == n:
                    return 1, q
        cs = tuple(sorted(c))
        cset = set(c)
        tri = _trigrams(text) if len(c) >= self.MIN_TRIGRAM else None
        for q, fn, fc, fcs, ftri in self.items:
            long_enough_content = len(c) >= self.MIN_CONTENT and len(fc) >= self.MIN_CONTENT
            if long_enough_content and cs == fcs:
                return 2, q
            if max(len(n), len(fn)) >= self.MIN_TOKENS and _edit_distance_le1(n, fn):
                return 3, q
            if long_enough_content:
                fset = set(fc)
                union = cset | fset
                if union and len(cset & fset) / len(union) >= self.JACCARD \
                        and abs(len(c) - len(fc)) <= 1:
                    return 4, q
                if tri and ftri and len(fc) >= self.MIN_TRIGRAM:
                    inter = len(tri & ftri)
                    if inter and inter / ((len(tri) ** 0.5) * (len(ftri) ** 0.5)) >= self.TRIGRAM_COSINE:
                        return 5, q
        return None

    def blocks(self, text):
        return self.check(text) is not None
