"""Asks Pen and Peek through pigeon.py (Task 3), the way Flight School will.

    python3 -I test_pigeon.py --no-model <engine.json> <good.pigeon> <refused.pigeon>
    python3 -I test_pigeon.py <engine.json> <patch.nest> <picture.png>

Prints what it saw; exits 0 only if every check held.
"""

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pigeon import Engine, PigeonError, version  # noqa: E402

failures = 0


def expect(cond, what):
    global failures
    if not cond:
        print("   FAILED:", what)
        failures += 1


def main():
    no_model = sys.argv[1] == "--no-model"
    args = sys.argv[2:] if no_model else sys.argv[1:]
    with open(args[0]) as f:
        config = json.load(f)
    print("version:", version())
    expect(version().startswith("libpigeon 0.1.0 (llama.cpp "), "the version string")
    try:
        Engine({"backend": "cuda"})
        expect(False, "a bad config raises")
    except PigeonError as e:
        print("bad config raises:", e)
        expect(e.code == "bad_request", "bad_request")
    with Engine(config) as e:
        if no_model:
            good, refused = args[1], args[2]
            r = e.check(good)
            print("check", os.path.basename(good), "→", r["result"], r.get("base_match"))
            expect(r["result"] == "accepted", "accepted")
            r = e.check(refused)
            print("check", os.path.basename(refused), "→", r["result"], r.get("code"), json.dumps(r.get("needs")))
            expect(r.get("code") == "wrong_base" and r.get("needs"), "wrong_base with needs")
        else:
            nest, picture = args[1], args[2]
            # Pen, by callback, streaming.
            pen = e.load(nest, "pen.pigeon")
            expect("prompt_unchecked" not in json.dumps(pen.get("warnings")), "Pen's prompt_check proven")
            pieces = []
            ans = e.ask(pen["pigeon"], "Name three things pigeons are good at, in one sentence.", options={"stream": True},
                        on_event=lambda ev: pieces.append(ev["text"]) if ev["type"] == "piece" else None)
            print("Pen (callback,", len(pieces), "pieces):", ans["answer"].get("value"), ans["stats"])
            expect(ans["answer"]["kind"] == "text" and "".join(pieces).strip() == ans["raw"], "the pieces make the answer")
            # Peek, with a picture, drained by poll.
            peek = e.load(nest, "peek.pigeon")
            expect("prompt_unchecked" not in json.dumps(peek.get("warnings")), "Peek's prompt_check proven")
            with open(picture, "rb") as f:
                png = f.read()
            evs = list(e.ask_events(peek["pigeon"], "What is the total on this receipt?", picture=png))
            final = evs[-1]
            print("Peek (poll,", len(evs), "events):", final.get("answer", {}).get("value", final), final.get("stats"))
            expect(final["type"] == "answer", "Peek answers")
            # Flight School's shape.
            rows = [{"question": "Say hello in four words."}, {"question": "Say goodbye in four words."}]
            got = e.ride(nest, rows, member="pen.pigeon")
            for g in got:
                print("ride:", g["question"], "→", g["event"].get("answer", {}).get("value"), f"({g['ms']} ms)")
            expect(len(got) == 2 and all(g["event"]["type"] == "answer" for g in got), "ride answers every row")
            print("info:", json.dumps(e.info())[:400])
    print("PASSED" if not failures else "FAILED")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
