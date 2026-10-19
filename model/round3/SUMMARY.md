# Round 3 — sibling adapter on paraphrases (2026-09-04)
set: 12888 train · 1132 valid
## control
    answered right  200 / 302   (66%)
    wrong skill      37
    asked for a arg   4
    asked, honest    48   (right skill; the message lacked the value the planner had invented)
    correct incl. honest asks 248 / 302   (82%)
    skill failed      9
    declined         46
    no-skill leaks    8 / 50
    avg latency     1986ms
    verifier        fired 12 · switched 0 (→right 0, →wrong 0) · rescued declines 12 (right 11, wrong 1, leaked 0)
    failed           want nextWeekday            got nextWeekday            "when is the next thursday"
    failed           want generatePalette        got generatePalette        "give me tints and shades of #556B2F"
    failed           want base64Decode           got base64Decode           "un-base64 this blob"
    asked            want binaryDecode           got binaryDecode           "these 1s and 0s spell what"
    failed           want decompressText         got decompressText         "unpack this compressed blob"
    failed           want hashText               got hashText               "sha512 digest of this phrase"
## sibling-v3
    answered right  204 / 302   (68%)
    wrong skill      32
    asked for a arg   4
    asked, honest    48   (right skill; the message lacked the value the planner had invented)
    correct incl. honest asks 252 / 302   (83%)
    skill failed     10
    declined         46
    no-skill leaks    8 / 50
    avg latency     2315ms
    verifier        fired 291 · switched 12 (→right 6, →wrong 1) · rescued declines 12 (right 11, wrong 1, leaked 0)
    failed           want nextWeekday            got nextWeekday            "when is the next thursday"
    failed           want generatePalette        got generatePalette        "give me tints and shades of #556B2F"
    failed           want base64Decode           got base64Decode           "un-base64 this blob"
    asked            want binaryDecode           got binaryDecode           "these 1s and 0s spell what"
    failed           want decompressText         got decompressText         "unpack this compressed blob"
    failed           want hashText               got hashText               "sha512 digest of this phrase"
  291 verifier events written to <repo>/model/round3/logs/vlog-sibling-v3.json
## Ship rule
- sibling v3 ships if: verifier (→right − →wrong) ≥ +8 AND correct ≥ control AND leaks ≤ control.
