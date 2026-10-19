#!/usr/bin/env python3
"""Build category-router training-data-v5 (Pigeon, branch qwen3vl-category).

Runs standalone from the repo: everything it reads is either v1
(model/training-data/) or vendored into model/training-data-v5/sources/.
Deterministic (fixed seed). Writes, in this folder only:
  SYSTEM.txt   byte copy of model/training-data/SYSTEM.txt
  train.jsonl  v1 chat format (system / user text / assistant category)
  valid.jsonl  byte copy of v1 valid.jsonl
  DATASET.txt, report.md

Composition (the router data plan, sections 2, 3, 5):
  v1 train, with block A (690 statement->ask rewrites) and block B2 (150 refusal
  rewrites) replacing their "orig" rows in place
  + B1  550 new real requests with loose openings
  + C   250 idiom/real pairs (500 rows)
  + 750 real requests picked from sources/pool-real.jsonl (bank headroom,
        sibling-only messages, pairs.json, skill-card examples)
Every non-v1 row goes through the full section-3 gate; the build stops if any
gated row would land in train.jsonl.

Usage: python3 build_v5.py [--check]   (--check: build in memory, write nothing)
"""
import collections, hashlib, json, math, os, random, re, shutil, sys
from datetime import date

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "sources")
PROBES = os.path.join(HERE, "probes")
V1 = os.path.join(os.path.dirname(HERE), "training-data")
sys.path.insert(0, SRC)
from catrouter_gate import Gate, normalise, content  # vendored byte copy of a Flight School gate script

SEED = 5
BUILT = "2026-10-03"
N_PICK = 750                       # new real requests from the pools (plan section 5)
TARGET_ROWS = 7942
PRIORITY = ("files", "health", "decisions")   # grow most
MAX_RATIO = 4.0                    # largest / smallest category (real categories)
OPENING_MAX_SHARE = 0.95           # no common opening (n >= 20) over this share one label
OPENING_MIN_N = 20
WRITE = "--check" not in sys.argv

def jl(path): return [json.loads(l) for l in open(path, encoding="utf-8") if l.strip()]
def key(t): return " ".join(normalise(t))

# ---------------------------------------------------------------- inputs
SYSTEM = open(os.path.join(V1, "SYSTEM.txt"), encoding="utf-8").read()
CATS = SYSTEM.split("Categories:")[1].strip().split(", ")
LABELS = set(CATS) | {"none"}

def chat_rows(path):
    out = []
    for r in jl(path):
        m = r["messages"]
        assert m[0]["content"] == SYSTEM, path
        out.append((m[1]["content"], m[2]["content"]))
    return out
v1_train = chat_rows(os.path.join(V1, "train.jsonl"))
v1_valid = chat_rows(os.path.join(V1, "valid.jsonl"))
grade = [r["text"] for r in jl(os.path.join(V1, "grade.jsonl"))]
dev = [r["text"] for r in jl(os.path.join(V1, "dev-labelled.jsonl"))]

A = jl(os.path.join(SRC, "A-rewrites.jsonl"))
B1 = jl(os.path.join(SRC, "B1-loose.jsonl"))
B2 = jl(os.path.join(SRC, "B2-refusal-rewrites.jsonl"))
C = jl(os.path.join(SRC, "C-pairs.jsonl"))
POOL = jl(os.path.join(SRC, "pool-real.jsonl"))
SKILLS = {s["name"]: s for s in json.load(open(os.path.join(SRC, "skills.json"), encoding="utf-8"))}
V1_SKILL = json.load(open(os.path.join(SRC, "v1-skills.json"), encoding="utf-8"))
BENCH = json.load(open(os.path.join(SRC, "bench-gate.json"), encoding="utf-8"))
HOLD = [m for m, _ in BENCH["HOLDOUT"]]; NOSK = BENCH["NO_SKILL"]; FAIL = BENCH["FAILING"]
PROBE_ROWS = jl(os.path.join(PROBES, "v5-contrast-holdout.jsonl")) + jl(os.path.join(PROBES, "v5-loose-probe.jsonl"))
PROBE_TEXTS = [r["text"] for r in PROBE_ROWS]
assert len(HOLD) == 308 and len(NOSK) == 100 and len(FAIL) == 57 and len(PROBE_TEXTS) == 260

# ---------------------------------------------------------------- statement / opening helpers
SUBJ = {"the", "my", "our", "his", "her", "he", "she", "they", "we", "someone", "everyone", "it", "its",
        "there", "that", "their", "this"}
REQ_AFTER_I = re.compile(r"^i\s+(need|want|wanna|'d|d|would|have to|must|am trying to|am looking|'m trying|'m looking|keep needing|should)\b")
REQ_AFTER_THIS = re.compile(r"^(this|that)\s+(as|in|into|to|but|with)\b")
def statement(t):
    """Subject-led statement, not an ask (plan section 1 / scratchpad subjectled.py)."""
    s = t.lower().strip(); w = re.findall(r"[a-z']+", s)
    if not w or "?" in s: return False
    if w[0] == "i": return not REQ_AFTER_I.search(s)
    if w[0] in ("this", "that") and (REQ_AFTER_THIS.search(s) or len(w) < 3): return False
    return w[0] in SUBJ

# opening/label balance frames: scratchpad frames.py F + balance_b.py additions
FRAMES = {
    "tell me about": r"^tell me about\b", "show me": r"^show me\b",
    "turn my/these/this X into": r"^turn (my|these|this|that|the)\b.*\binto\b",
    "put my/these X on/in/into": r"^put (my|these|this|the)\b", "plan (out)?": r"^plan\b",
    "... properly": r"\bproperly\b", "X from these Y (noun-led, no verb)": r"^[a-z ]+ from (these|this|my)\b",
    "help me": r"^help me\b", "sort out": r"\bsort out\b", "go through": r"\bgo through\b",
    "can i get / could i get": r"^(can|could) i (get|have)\b",
    "i've got / i have": r"^(i've got|i have got|i have|ive got)\b",
    "do/does/did i (self-check)": r"^(did|do|am|have) i\b", "as i go / as we go": r"\bas (i|we) go\b",
    "can you": r"^can you\b", "give me": r"^give me\b", "write": r"^write\b",
    "do the … thing": r"^do (the|that|your)\b.*\bthing\b",
}
FRAMES_RE = {k: re.compile(v) for k, v in FRAMES.items()}
def frames_of(t):
    s = t.lower(); return [k for k, r in FRAMES_RE.items() if r.search(s)]
def opening2(t):
    w = re.findall(r"[a-z']+", t.lower()); return " ".join(w[:2]) if w else "<num>"

# ---------------------------------------------------------------- the section-3 gate
G_HOLD, G_NOSK, G_GD, G_PROBE, G_VALID = Gate(HOLD), Gate(NOSK), Gate(grade + dev), Gate(PROBE_TEXTS), Gate([t for t, _ in v1_valid])
G_PROBE_REV = [(p, Gate([p])) for p in PROBE_TEXTS]
FAILC = [(m, set(content(m))) for m in FAIL]
PROBEC = [(p, set(content(p))) for p in PROBE_TEXTS]
def _strict(c, refs):
    for m, fc in refs:
        if len(fc) >= 2 and fc <= c and len(c) <= len(fc) + 3: return m
        if len(fc) >= 2 and c and len(c & fc) / len(c | fc) >= 0.5: return m
    return None
def gate(t):
    """All section-3 hits for one new row: list of (rule, reference)."""
    hits = []
    for name, g in (("bench-holdout", G_HOLD), ("bench-noskill", G_NOSK), ("grade/dev", G_GD),
                    ("probes", G_PROBE), ("v1-valid", G_VALID)):
        h = g.check(t)
        if h: hits.append((f"{name} r{h[0]}", h[1]))
    tg = Gate([t])
    for p, _ in G_PROBE_REV:            # reverse direction: the row as reference, each probe checked
        h = tg.check(p)
        if h: hits.append((f"probes-rev r{h[0]}", p)); break
    c = set(content(t))
    s = _strict(c, FAILC)
    if s: hits.append(("strict-failing", s))
    s = _strict(c, PROBEC)
    if s: hits.append(("strict-probe", s))
    return hits

# ---------------------------------------------------------------- near-identical index (whole set)
class NearIndex:
    """Candidate pairs for the 5 gate rules without an all-pairs scan, verified with the real Gate."""
    def __init__(self, texts):
        self.texts = texts
        ns = [normalise(t) for t in texts]; cs = [content(t) for t in texts]
        df = collections.Counter(w for c in cs for w in set(c))
        tris = [Gate([t]).items[0][4] for t in texts]
        tdf = collections.Counter(x for s in tris for x in s)
        buckets = collections.defaultdict(set)
        for i, (n, c, tr) in enumerate(zip(ns, cs, tris)):
            buckets[("n", tuple(n))].add(i)
            if len(c) >= 2: buckets[("c", tuple(sorted(c)))].add(i)
            if len(n) >= 3:
                for j in range(len(n)): buckets[("d", tuple(n[:j] + n[j + 1:]))].add(i)
                buckets[("d", tuple(n))].add(i)
            if len(c) >= 2:
                sc = sorted(set(c), key=lambda w: (df[w], w)); p = len(sc) - math.ceil(0.75 * len(sc)) + 1
                for w in sc[:p]: buckets[("j", w)].add(i)
            if len(c) >= 3 and tr:
                st = sorted(tr, key=lambda x: (tdf[x], x)); p = len(st) - math.ceil(0.85 ** 2 * len(st)) + 1
                for x in st[:p]: buckets[("t", x)].add(i)
        self.pairs = set()
        for b in buckets.values():
            if len(b) > 1:
                b = sorted(b)
                for x in range(len(b)):
                    for y in range(x + 1, len(b)): self.pairs.add((b[x], b[y]))
    def near_pairs(self):
        out = []
        for a, b in sorted(self.pairs):
            h = Gate([self.texts[a]]).check(self.texts[b])
            if h: out.append((a, b, h[0]))
        return out

# ---------------------------------------------------------------- label fixes (near-identical texts, different labels)
# Found by NearIndex (the 5 gate rules run across the whole set) plus a search of each family.
# Each fix gives the label the bench / skill cards imply; it is applied to every row with that exact text.
_TZ = ("reference", "timezoneLookup", "one named place's current time is timezoneLookup (card: 'current time in "
       "London', 'time in Tokyo'); currentTime is 'in your own time zone'; several places stay dates")
_SPOON = ("conversion", "convertVolume", "spoon-to-spoon with no ingredient is a plain volume conversion (card "
          "convertVolume '3 teaspoons in tablespoons'; bench 'how much is 6 tablespoons in millilitres' -> conversion)")
_DUR = ("conversion", "convertTime", "one plain unit to another is convertTime (card '90 minutes in seconds'); "
        "dates/parseDuration is kept for compound or shorthand durations (bench 'turn 2h 15m into seconds')")
LABEL_FIXES = {
    "what time is it in tokyo": _TZ,
    "clock hour in tokyo now": _TZ,
    "what hour is it over in tokyo": _TZ,
    "convert 4 teaspoons to tablespoons": _SPOON,
    "4 tsp to tbsp": _SPOON,
    "4 teaspoons as tablespoons": _SPOON,
    "how long is 45 minutes in seconds": _DUR,
    "i need 45 minutes in seconds": _DUR,
    "45 minutes counted in seconds": _DUR,
    "make this heading look like a book title": ("writing", "checkTitleCase",
        "same ask as v1 'make this look like a book title' (writing); bench 'capitalise this headline properly' -> writing"),
    "just pick for me, i cannot decide": ("lists", "pickRandom",
        "same ask as 'pick a restaurant for me, i cannot decide' (lists); picking one option is pickRandom, "
        "the magic eight ball answers yes/no questions"),
    "collapse the repeats in this stack": ("lists", "dedupeList",
        "same ask as v1 'collapse the repeats in this' (lists); bench 'strip the repeats out of this list' -> lists"),
}
# rows dropped rather than relabelled
DROP = {}
# Near pairs (by the gate rules) whose labels differ because the asks differ: one swapped content word
# that names a different thing (hypotenuse/gcd, binary/jwt, lines/names...). Reviewed, kept as contrasts.
REVIEWED_DISTINCT = {frozenset(p) for p in [
    ("can you find the hypotenuse of 7 and 24", "can you find the gcd of 48 and 18"),
    ("read 03/04/2026 as a date", "read $3,400 as a number"),
    ("XLII as a number", "read $3,400 as a number"),
    ("are there any dates here", "are there any typos here"),
    ("boil this contract down for me", "boil this fraction down for me"),
    ("every day or not", "2000 extra day or not"),
    ("can you decode this binary for me", "can you decode this jwt for me"),
    ("what did the whole spreadsheet come to", "what did the whole shop come to"),
    ("i need 20 percent of 85.50", "i need 15 percent off 19.99"),
    ("is +44 123 a real number", "is 91 a prime number"),
    ("what number is XLII", "what number is 1.2k"),
    ("collapse just one level down", "collapse this json to one level"),
    ("what is a .woff2 file", "what is a json file"),
    ("flatten deeply nested groups", "flatten deeply nested json"),
    ("5400 seconds expressed in hours", "2 days 4 hours expressed in seconds"),
    ("can you tell me what NOK means", "can you tell me what http 404 means"),
    ("42 written as a word", "21 written as a position"),
    ("shuffle these cards with seed 42", "shuffle these with seed 7"),
    ("1000000 put into words", "90 seconds put into words"),
    ("can you tell me what country +44 is", "can you tell me what timestamp 1788255000 is"),
    ("can you tell me what country +44 is", "can you tell me what day 14 November 2026 is"),
    ("pick one of two for me at random", "can you pick one of these at random"),
    ("compare two identical strings", "compare two identical versions"),
    ("compare two identical texts", "compare two identical versions"),
    ("can you rank these tasks for me", "can you rank these scores for me"),
    ("sort these lines alphabetically", "sort these names alphabetically"),
    ("convert 2 days 4 hours to seconds", "convert 3 hours to seconds"),
    ("can you convert 2 days 4 hours to seconds", "convert 3 hours to seconds"),
    ("convert the shorthand #abc", "check the shorthand #abc"),
    ("convert 777 octal to hex", "convert hello to hex"),
    ("what are the parts of 0.1.0", "what are the quartiles of 4 8 15 16 23 42"),
]}

# ---------------------------------------------------------------- assemble
def build():
    rng = random.Random(SEED)
    rep = {}
    for blk, rows in (("A", A), ("B2", B2)):
        for r in rows:
            assert r["orig"] not in rep, r["orig"]
            assert r["category"] in LABELS
            rep[r["orig"]] = (blk, r)
    v1_text = {t: c for t, c in v1_train}
    for o, (blk, r) in rep.items():
        assert o in v1_text, f"{blk} orig not in v1: {o!r}"
        assert v1_text[o] == r["category"], f"{blk} label changed: {o!r}"
    rows = []   # dicts: text, category, block, skill, (pair)
    for t, c in v1_train:
        if t in rep:
            blk, r = rep[t]
            rows.append({"text": r["text"], "category": r["category"], "block": blk, "skill": r.get("skill") or V1_SKILL.get(t), "orig": t})
        else:
            rows.append({"text": t, "category": c, "block": "v1", "skill": V1_SKILL.get(t)})
    for r in B1:
        rows.append({"text": r["text"], "category": r["category"], "block": "B1", "skill": r.get("skill")})
    for r in C:
        rows.append({"text": r["text"], "category": r["category"], "block": "C-" + r["half"], "skill": r.get("skill"), "pair": r["pair"]})
    for r in rows: assert r["category"] in LABELS, r

    log = {"gate": collections.Counter(), "pool_gate": collections.Counter(), "gate_rows": [], "dropped": [], "fixes": [], "dup": []}

    # label fixes and drops (whole set, applied consistently)
    for r in rows:
        if r["text"] in LABEL_FIXES and r["category"] != LABEL_FIXES[r["text"]][0]:
            lab, sk, why = LABEL_FIXES[r["text"]]
            log["fixes"].append((r["text"], r["category"], lab, r["block"], why))
            r["category"], r["skill"] = lab, sk
    kept = []
    for r in rows:
        if r["text"] in DROP: log["dropped"].append((r["block"], r["text"], DROP[r["text"]])); continue
        kept.append(r)
    rows = kept

    # gate every non-v1 row; a failing in-place rewrite falls back to its v1 original,
    # a failing pair half takes its partner out too (pairs stay whole)
    bad_pairs = set(); kept = []
    for r in rows:
        if r["block"] == "v1": kept.append(r); continue
        h = gate(r["text"])
        if not h: kept.append(r); continue
        for rule, ref in h: log["gate"][rule] += 1
        log["gate_rows"].append((r["block"], r["text"], h))
        if r["block"] in ("A", "B2"):
            kept.append({"text": r["orig"], "category": r["category"], "block": "v1", "skill": V1_SKILL.get(r["orig"])})
            log["dropped"].append((r["block"], r["text"], "gate -> v1 original kept"))
        elif r["block"].startswith("C-"):
            bad_pairs.add(r["pair"])
        else:
            log["dropped"].append((r["block"], r["text"], "gate"))
    rows = []
    for r in kept:
        if r.get("pair") is not None and r["pair"] in bad_pairs:
            log["dropped"].append((r["block"], r["text"], "pair partner gated")); continue
        rows.append(r)

    # one row per normalised key (first wins: v1 order, then B1, C)
    seen = {}; kept = []
    for r in rows:
        k = key(r["text"])
        if k in seen:
            first = seen[k]
            log["dup"].append((r["block"], r["text"], first["block"], first["text"], r["category"] == first["category"]))
            if r.get("pair") is not None: bad_pairs.add(r["pair"])
            continue
        seen[k] = r; kept.append(r)
    rows = [r for r in kept if not (r.get("pair") is not None and r["pair"] in bad_pairs)]
    for r in kept:
        if r.get("pair") is not None and r["pair"] in bad_pairs:
            log["dropped"].append((r["block"], r["text"], "pair partner duplicated")); seen.pop(key(r["text"]), None)

    # ---- pick real requests from the pools
    cat_n = collections.Counter(r["category"] for r in rows)
    skill_open = collections.defaultdict(set); skill_n = collections.Counter()
    for r in rows:
        if r["skill"]:
            skill_open[r["skill"]].add(opening2(r["text"])); skill_n[r["skill"]] += 1
    frame_n = {k: collections.Counter() for k in FRAMES}
    for r in rows:
        for f in frames_of(r["text"]): frame_n[f]["none" if r["category"] == "none" else "real"] += 1
    cand_by_cat = collections.defaultdict(list); pool_skip = collections.Counter()
    for r in POOL:
        t = r["text"]
        if r["web"] or SKILLS.get(r["skill"], {}).get("needsNetwork"): pool_skip["web"] += 1; continue
        if r["category"] not in CATS: pool_skip["no category"] += 1; continue
        if SKILLS.get(r["skill"], {}).get("unbuilt"): pool_skip["unbuilt skill"] += 1; continue
        if statement(t): pool_skip["statement form"] += 1; continue
        if not 3 <= len(t.split()) <= 15: pool_skip["length"] += 1; continue
        if key(t) in seen: pool_skip["already in set"] += 1; continue
        if t in DROP: pool_skip["dropped"] += 1; continue
        cand_by_cat[r["category"]].append(dict(r))
    for c in cand_by_cat: rng.shuffle(cand_by_cat[c])
    n_pick = N_PICK + max(0, TARGET_ROWS - N_PICK - len(rows))
    picked = []; gated_pool = 0
    def frame_ok(t):
        for f in frames_of(t):
            n = frame_n[f]; real, neg = n["real"] + 1, n["none"]
            if real + neg >= OPENING_MIN_N and real / (real + neg) > OPENING_MAX_SHARE: return False
        return True
    def take(c):
        nonlocal gated_pool
        pool = cand_by_cat[c]
        while pool:
            # prefer an opening new for that skill, then the least-used skill, then pool order (seeded)
            best = min(range(len(pool)), key=lambda i: (opening2(pool[i]["text"]) in skill_open[pool[i]["skill"]],
                                                         skill_n[pool[i]["skill"]], i))
            r = pool.pop(best); t = r["text"]
            if key(t) in seen or not frame_ok(t): continue
            h = gate(t)
            if h:
                gated_pool += 1
                for rule, _ in h: log["pool_gate"][rule] += 1   # recorded, never kept
                continue
            row = {"text": t, "category": c, "block": "P-" + r["source"], "skill": r["skill"], "sources": r["sources"]}
            if t in LABEL_FIXES:
                lab, sk, why = LABEL_FIXES[t]
                log["fixes"].append((t, c, lab, row["block"], why)); row["category"], row["skill"] = lab, sk
            seen[key(t)] = row; picked.append(row); cat_n[row["category"]] += 1
            skill_open[r["skill"]].add(opening2(t)); skill_n[r["skill"]] += 1
            for f in frames_of(t): frame_n[f]["real"] += 1
            return True
        return False
    # priority categories first, in turn, until each is exhausted or a quarter of the picks is used
    pr_cap = n_pick // 4
    while len(picked) < pr_cap and any(cand_by_cat[c] for c in PRIORITY):
        for c in sorted(PRIORITY, key=lambda c: (cat_n[c], c)):
            if cand_by_cat[c] and len(picked) < pr_cap: take(c)
    # then water-fill: always grow the smallest real category that still has candidates
    while len(picked) < n_pick:
        open_c = [c for c in CATS if cand_by_cat[c]]
        if not open_c: break
        c = min(open_c, key=lambda c: (cat_n[c], c))
        take(c)
    rows += picked

    # ---- label conflicts between near-identical texts (whole set)
    idx = NearIndex([r["text"] for r in rows])
    conflicts, reviewed = [], []
    for a, b, rule in idx.near_pairs():
        if rows[a]["category"] == rows[b]["category"]: continue
        pair = (rows[a], rows[b], rule)
        (reviewed if frozenset((rows[a]["text"], rows[b]["text"])) in REVIEWED_DISTINCT else conflicts).append(pair)
    log["reviewed"] = reviewed

    rng.shuffle(rows)
    log["pool_avail"] = {c: sum(1 for r in POOL if r["category"] == c and not r["web"]) for c in PRIORITY}
    return rows, log, conflicts, pool_skip, gated_pool, n_pick

rows, log, conflicts, pool_skip, gated_pool, n_pick = build()

# ---------------------------------------------------------------- final checks
final_hits = collections.Counter()
for r in rows:
    if r["block"] != "v1":
        for rule, _ in gate(r["text"]): final_hits[rule] += 1
v1_hits = collections.Counter()          # v1 rows against the bench (5 rules); plan: 0
for r in rows:
    if r["block"] == "v1":
        for name, g in (("bench-holdout", G_HOLD), ("bench-noskill", G_NOSK), ("grade/dev", G_GD)):
            h = g.check(r["text"])
            if h: v1_hits[f"{name} r{h[0]}"] += 1
valid_keys = {key(t) for t, _ in v1_valid}
valid_overlap = sum(1 for r in rows if key(r["text"]) in valid_keys)
keys = collections.Counter(key(r["text"]) for r in rows)
dups = sum(n - 1 for n in keys.values() if n > 1)
cat_n = collections.Counter(r["category"] for r in rows)
real_n = {c: cat_n[c] for c in CATS}
ratio = max(real_n.values()) / min(real_n.values())
refusal = cat_n["none"] / len(rows)
frame_tab = []
for f, rx in FRAMES_RE.items():
    real = sum(1 for r in rows if r["category"] != "none" and rx.search(r["text"].lower()))
    neg = sum(1 for r in rows if r["category"] == "none" and rx.search(r["text"].lower()))
    n = real + neg; sh = max(real, neg) / n if n else 0
    frame_tab.append((f, real, neg, sh, n >= OPENING_MIN_N and sh > OPENING_MAX_SHARE))
max_common = max((sh for f, real, neg, sh, _ in frame_tab if real + neg >= OPENING_MIN_N), default=0)
over = [f for f, *_, flag in frame_tab if flag]

print(f"rows {len(rows)} (target {TARGET_ROWS}) | refusals {cat_n['none']} = {refusal:.2%} | "
      f"ratio {ratio:.2f} | dup keys {dups} | gate hits in final {sum(final_hits.values())} | "
      f"conflicts {len(conflicts)} | openings over {OPENING_MAX_SHARE:.0%}: {over or 0} | max common share {max_common:.1%}")
print("blocks", dict(collections.Counter(r["block"] for r in rows)))
print("gate hits on block rows (removed):", dict(log["gate"]), "| pool candidates gated:", gated_pool)
print("pool skips", dict(pool_skip))
for b, t, h in log["gate_rows"]: print("  GATED", b, repr(t), h)
for d in log["dup"]: print("  DUP", d)
for d in log["dropped"]: print("  DROP", d)
if "--conflicts" in sys.argv:
    for a, b, rule in conflicts:
        print(f"  CONFLICT r{rule} [{a['block']}:{a['category']}:{a.get('skill')}] {a['text']!r}  <>  [{b['block']}:{b['category']}:{b.get('skill')}] {b['text']!r}")

if "--dump" in sys.argv:
    with open(sys.argv[sys.argv.index("--dump") + 1], "w") as f:
        for r in rows: f.write(json.dumps(r, ensure_ascii=False) + "\n")
ok = (sum(final_hits.values()) == 0 and not v1_hits and valid_overlap == 0 and dups == 0 and not conflicts and ratio < MAX_RATIO
      and 0.125 <= refusal <= 0.135 and not over)
if not ok:
    print("NOT OK: refusing to write"); sys.exit(1)
if not WRITE:
    print("check only: nothing written"); sys.exit(0)

# ---------------------------------------------------------------- write
def dumps(t, c):
    return json.dumps({"messages": [{"role": "system", "content": SYSTEM}, {"role": "user", "content": t},
                                    {"role": "assistant", "content": c}]}, ensure_ascii=False)
shutil.copyfile(os.path.join(V1, "SYSTEM.txt"), os.path.join(HERE, "SYSTEM.txt"))
shutil.copyfile(os.path.join(V1, "valid.jsonl"), os.path.join(HERE, "valid.jsonl"))
with open(os.path.join(HERE, "train.jsonl"), "w", encoding="utf-8") as f:
    for r in rows: f.write(dumps(r["text"], r["category"]) + "\n")
assert open(os.path.join(HERE, "SYSTEM.txt"), "rb").read() == open(os.path.join(V1, "SYSTEM.txt"), "rb").read()
sha = hashlib.sha256(open(os.path.join(HERE, "train.jsonl"), "rb").read()).hexdigest()[:16]
v1_ref = sum(1 for _, c in v1_train if c == "none") / len(v1_train)
with open(os.path.join(HERE, "DATASET.txt"), "w") as f:
    f.write(f"category v5\nbuilt    {BUILT}\nrows     {len(rows)} train · {len(v1_valid)} valid\n"
            f"refusals {100 * refusal:.1f}%   (v1 {100 * v1_ref:.1f}% · v5 adds idiom/real pairs and statement->ask rewrites, valid = v1)\n"
            f"seq      256\nsha      {sha}\n")

# ---------------------------------------------------------------- report.md
v1_cat = collections.Counter(c for _, c in v1_train)
blk_order = ["v1", "A", "B2", "B1", "C-real", "C-idiom", "P-bank", "P-sibling", "P-pairs", "P-card"]
blk_desc = {"v1": "v1 train rows kept as they are", "A": "statement -> ask rewrites of v1 real requests (in place)",
            "B2": "refusal rewrites into one-label openings (in place)", "B1": "new real requests, loose openings",
            "C-real": "idiom pairs: real half", "C-idiom": "idiom pairs: idiom half (`none`)",
            "P-bank": "picked: Flight School bank headroom", "P-sibling": "picked: sibling-only messages",
            "P-pairs": "picked: sibling-v4 pairs.json", "P-card": "picked: skill-card examples"}
bc = collections.Counter(r["block"] for r in rows); bneg = collections.Counter(r["block"] for r in rows if r["category"] == "none")
picked_rows = [r for r in rows if r["block"].startswith("P-")]
pick_cat = collections.Counter(r["category"] for r in picked_rows)
def real_stmt(rs):
    real = [t for t, c in rs if c != "none"]
    return sum(statement(t) for t in real), len(real)
s1, n1 = real_stmt(v1_train); s5, n5 = real_stmt([(r["text"], r["category"]) for r in rows])
v1_frames = []
for f, rx in FRAMES_RE.items():
    real = sum(1 for t, c in v1_train if c != "none" and rx.search(t.lower()))
    neg = sum(1 for t, c in v1_train if c == "none" and rx.search(t.lower()))
    v1_frames.append((real, neg))
# picks whose two-word opening was new for their skill at pick time is not kept; recompute against v1+blocks
base_open = collections.defaultdict(set)
for r in rows:
    if not r["block"].startswith("P-") and r["skill"]: base_open[r["skill"]].add(opening2(r["text"]))
new_open = sum(1 for r in picked_rows if opening2(r["text"]) not in base_open[r["skill"]])

L = []
w = L.append
w("# Category router training-data-v5: build report\n")
w(f"Built {BUILT} by `build_v5.py` (seed {SEED}, deterministic; re-running gives the same sha). Plan: "
  "the router data plan, sections 2, 3 and 5.\n")
w(f"`train.jsonl` **{len(rows)}** rows · `valid.jsonl` **{len(v1_valid)}** rows (v1's file, byte copy) · "
  f"sha256 of train.jsonl `{sha}`.\n")
w("Every row has the v1 system prompt, byte-identical to `SYSTEM.txt` (copied from `model/training-data/`), "
  "the request as the user turn, and the bare category name as the answer. Rows are shuffled with the fixed seed.\n")
w("Direction labels: **(higher is better)** or **(lower is better)**. Plain counts are marked *(descriptive)*.\n")
w("## 1. Rows by block\n")
w("| block | what it is | rows *(descriptive)* | refusals *(descriptive)* |\n|---|---|---:|---:|")
for b in blk_order:
    if bc[b]: w(f"| {b} | {blk_desc[b]} | {bc[b]} | {bneg[b]} |")
w(f"| **total** | | **{len(rows)}** | **{cat_n['none']}** |\n")
nA = sum(1 for r in rows if r['block'] == 'A'); nC = bc['C-real']
w(f"Against the plan: A is {nA} of 690 (one rewrite failed the gate and its v1 original stays), B2 150 of 150, "
  f"B1 550 of 550, C {nC} of 250 pairs (pairs whose real half failed the stricter probe check were dropped whole), "
  f"and {len(picked_rows)} pool picks instead of 750 so the total still lands on {TARGET_ROWS}.\n")
w("## 2. Refusal share and statement share\n")
w(f"- Refusals: **{cat_n['none']} of {len(rows)} = {100 * refusal:.2f}%**. Target band 12.5–13.5% (inside the band is the pass; v1 was {100 * v1_ref:.2f}%).")
w(f"- Statement-form real requests (subject-led, not an ask; the plan's main problem): v1 **{s1} of {n1} = {100 * s1 / n1:.1f}%** → "
  f"v5 **{s5} of {n5} = {100 * s5 / n5:.1f}%** (lower is better). Bench holdout is 1.3%.\n")
w("## 3. Rows by category\n")
w("Growth is pool-limited: files, health and decisions have the smallest clean pools, so they were taken first "
  "(up to a quarter of the picks), then each pick went to the smallest category that still had candidates.\n")
w("| category | v1 train *(descriptive)* | v5 train *(descriptive)* | change *(descriptive)* | of which picked *(descriptive)* |\n|---|---:|---:|---:|---:|")
for c in sorted(CATS + ["none"], key=lambda c: -cat_n[c]):
    w(f"| `{c}` | {v1_cat[c]} | {cat_n[c]} | {cat_n[c] - v1_cat[c]:+d} ({100 * (cat_n[c] - v1_cat[c]) / v1_cat[c]:+.0f}%) | {pick_cat[c]} |")
mx = max(real_n, key=real_n.get); mn = min(real_n, key=real_n.get)
v1_real = {c: v1_cat[c] for c in CATS}
w(f"\nLargest real category `{mx}` {real_n[mx]}, smallest `{mn}` {real_n[mn]}: ratio **{ratio:.2f}:1** "
  f"(lower is better; must stay under {MAX_RATIO:.0f}). v1 was {max(v1_real.values()) / min(v1_real.values()):.2f}:1.\n")
w(f"Pool picks by source *(descriptive)*: " + ", ".join(f"{b[2:]} {bc[b]}" for b in blk_order if b.startswith("P-") and bc[b]) +
  ". Every pairs.json and card-example candidate is also a sibling (or bank) message, so it is counted there; "
  f"of the picks, {sum('pairs' in r['sources'] for r in picked_rows)} are also in pairs.json and "
  f"{sum('card' in r['sources'] for r in picked_rows)} are skill-card examples.")
w("Priority categories, picked of clean candidates in the pool *(descriptive)*: " + ", ".join(
  f"{c} {pick_cat[c]} of {log['pool_avail'][c]}" for c in PRIORITY) + ". They took every candidate that passed the filters and the "
  "gate, which is why their growth is capped by the pool, not by the picker.")
w(f"Picks whose two-word opening is new for their skill: **{new_open} of {len(picked_rows)} = {100 * new_open / len(picked_rows):.0f}%** (higher is better).")
w(f"Pool candidates skipped *(descriptive)*: " + ", ".join(f"{k} {v}" for k, v in sorted(pool_skip.items())) +
  f", gated {gated_pool} (by rule: " + ", ".join(f"{k} {v}" for k, v in sorted(log['pool_gate'].items())) + ").\n")
w("## 4. Opening / label balance\n")
w(f"Frames are `frames.py` plus `balance_b.py`'s additions. Pass: no opening with at least {OPENING_MIN_N} rows has more than "
  f"{100 * OPENING_MAX_SHARE:.0f}% one label.\n")
w("| opening | v1 real | v1 refusals | v1 max share one label (lower is better) | v5 real | v5 refusals | v5 max share one label (lower is better) |\n|---|---:|---:|---:|---:|---:|---:|")
for (f, real, neg, sh, flag), (r1, n1_) in zip(frame_tab, v1_frames):
    t1 = r1 + n1_; s1_ = max(r1, n1_) / t1 if t1 else 0
    mark = lambda n, s: (f"{100 * s:.1f}%" + (" **over**" if n >= OPENING_MIN_N and s > OPENING_MAX_SHARE else "")) if n else "–"
    w(f"| {f} | {r1} | {n1_} | {mark(t1, s1_)} | {real} | {neg} | {mark(real + neg, sh)} |")
w(f"\nHighest share among openings with at least {OPENING_MIN_N} rows: **{100 * max_common:.1f}%** (lower is better). "
  f"Openings over {100 * OPENING_MAX_SHARE:.0f}%: **{len(over)}** (lower is better).\n")
w("## 5. Contamination gate (plan section 3)\n")
w("Every non-v1 row (A, B1, B2, C, picks) was checked against: the 5 gate rules (vendored `sources/catrouter_gate.py`, "
  "byte copy of Flight School's) vs the 408 bench messages (308 holdout + 100 no-skill), vs grade + dev-labelled, vs both "
  "probe files in both directions (probe set as reference, and each row as reference with every probe checked), and vs v1 "
  "valid; the stricter check vs the 57 bench messages either router gets wrong; and the same stricter check vs the probes.\n")
rules = ["bench-holdout", "bench-noskill", "grade/dev", "probes", "probes-rev", "v1-valid"]
w("| reference | r1 | r2 | r3 | r4 | r5 |\n|---|---:|---:|---:|---:|---:|")
for ref in rules:
    w(f"| {ref} | " + " | ".join(str(final_hits[f'{ref} r{k}']) for k in range(1, 6)) + " |")
w(f"| strict vs 57 failing bench messages | {final_hits['strict-failing']} | | | | |")
w(f"| strict vs probes | {final_hits['strict-probe']} | | | | |")
w(f"\nHits in the final set: **{sum(final_hits.values())}** (lower is better). v1 rows vs the bench and grade/dev: "
  f"**{sum(v1_hits.values())}** (lower is better). Rows whose normalised key is also in v1 valid: **{valid_overlap}** (lower is better). "
  f"Duplicate normalised keys: **{dups}** (lower is better).\n")
w("Rows the gate removed while building *(descriptive)*:\n")
for b, t, h in log["gate_rows"]:
    w(f"- {b} `{t}` — " + "; ".join(f"{rule} ~ `{ref}`" for rule, ref in h))
for b, t, why in log["dropped"]:
    if "partner" in why or "->" in why: w(f"  - {b} `{t}`: {why}")
w("")
w("## 6. Label fixes\n")
w("Near-identical texts (any of the 5 gate rules, run across the whole set with an index, then verified with the real gate) "
  "with different labels were reviewed. Where the ask is the same, the label the bench or skill cards imply was applied to "
  "every row with that text, and each family was searched for further members.\n")
w("| text | block | was | now | why |\n|---|---|---|---|---|")
for t, old, new, b, why in log["fixes"]:
    w(f"| {t} | {b} | {old} | **{new}** | {why} |")
w(f"\nNear pairs with different labels left as they are (reviewed: the asks differ by one word naming a different thing, "
  f"for example `can you decode this binary for me` encoding vs `can you decode this jwt for me` developer): "
  f"**{len(log['reviewed'])}**. Unreviewed conflicts left: **{len(conflicts)}** (lower is better).\n")
w("## 7. Sources\n")
w("Everything the builder reads besides v1 is vendored in `sources/` so it runs from the repo alone:\n")
w("- `catrouter_gate.py`: byte copy of a Flight School gate script that is not in its public source.")
w("- `A-rewrites.jsonl`, `B2-refusal-rewrites.jsonl` (field `orig` = the v1 row replaced), `B1-loose.jsonl`, `C-pairs.jsonl`: the hand-written blocks.")
w("- `pool-real.jsonl`: the clean candidate pools from `overlap.py` (bank paraphrases, sibling v1+v3+v4 messages, sibling-v4 pairs.json, "
  "skill-card examples), one row per normalised key, with skill and source attached; `web` marks webAnswer/webSearch rows, which are excluded.")
w("- `skills.json`: skill → category (the `category:` field of each card in `skills/*.js`).")
w("- `v1-skills.json`: v1 train text → skill (seeds and bank), used for 'opening new for that skill'.")
w("- `bench-gate.json`: the 408 bench messages and the 57 failing ones. **Gate input only, never training.**")
w("\n`probes/` holds the held-out sets (`v5-contrast-holdout.jsonl`, `v5-loose-probe.jsonl`, and `bench-router.jsonl`, "
  "the 408 bench messages for the router-only pass). They are evaluation only and are never read into train or valid.\n")
open(os.path.join(HERE, "report.md"), "w").write("\n".join(L) + "\n")
print("written: train.jsonl", len(rows), "sha", sha)
