# Round 2 — overnight results (2026-09-04)
## category adapter, dev-labelled (182)
shipped:  overall accuracy   168/182 = 92.3%   PASS (target 80%) refusals           21/25 = 84.0% 
round 2:  overall accuracy   167/182 = 91.8%   PASS (target 80%) refusals           21/25 = 84.0% 
## control
    answered right  200 / 302   (66%)
    wrong skill      37
    asked for a arg   4
    asked, honest    48   (right skill; the message lacked the value the planner had invented)
    correct incl. honest asks 248 / 302   (82%)
    skill failed      9
    declined         46
    no-skill leaks    8 / 50
    avg latency     1985ms
    verifier        fired 12 · switched 0 (→right 0, →wrong 0) · rescued declines 12 (right 11, wrong 1, leaked 0)
    failed           want nextWeekday            got nextWeekday            "when is the next thursday"
    failed           want generatePalette        got generatePalette        "give me tints and shades of #556B2F"
    failed           want base64Decode           got base64Decode           "un-base64 this blob"
    asked            want binaryDecode           got binaryDecode           "these 1s and 0s spell what"
    failed           want decompressText         got decompressText         "unpack this compressed blob"
    failed           want hashText               got hashText               "sha512 digest of this phrase"
## category-v2
    answered right  194 / 302   (64%)
    wrong skill      39
    asked for a arg   4
    asked, honest    42   (right skill; the message lacked the value the planner had invented)
    correct incl. honest asks 236 / 302   (78%)
    skill failed     10
    declined         54
    no-skill leaks    9 / 50
    avg latency     1879ms
    verifier        fired 11 · switched 0 (→right 0, →wrong 0) · rescued declines 11 (right 10, wrong 1, leaked 0)
    failed           want nextWeekday            got nextWeekday            "when is the next thursday"
    declined         want listTimezoneOffsets    got —                      "clock times right now in Paris Delhi and"
    failed           want generatePalette        got generatePalette        "give me tints and shades of #556B2F"
    failed           want base64Decode           got base64Decode           "un-base64 this blob"
    asked            want binaryDecode           got binaryDecode           "these 1s and 0s spell what"
    failed           want decompressText         got decompressText         "unpack this compressed blob"
    failed           want hashText               got hashText               "sha512 digest of this phrase"
## sibling
    answered right  195 / 302   (65%)
    wrong skill      40
    asked for a arg   4
    asked, honest    49   (right skill; the message lacked the value the planner had invented)
    correct incl. honest asks 244 / 302   (81%)
    skill failed     10
    declined         46
    no-skill leaks    8 / 50
    avg latency     2310ms
    verifier        fired 291 · switched 18 (→right 4, →wrong 7) · rescued declines 12 (right 11, wrong 1, leaked 0)
    failed           want nextWeekday            got nextWeekday            "when is the next thursday"
    failed           want generatePalette        got generatePalette        "give me tints and shades of #556B2F"
    failed           want base64Decode           got base64Decode           "un-base64 this blob"
    asked            want binaryDecode           got binaryDecode           "these 1s and 0s spell what"
    failed           want decompressText         got decompressText         "unpack this compressed blob"
    failed           want hashText               got hashText               "sha512 digest of this phrase"
  291 verifier events written to <repo>/model/round2/logs/vlog-sibling.json
## both
    answered right  189 / 302   (63%)
    wrong skill      41
    asked for a arg   4
    asked, honest    44   (right skill; the message lacked the value the planner had invented)
    correct incl. honest asks 233 / 302   (77%)
    skill failed     11
    declined         54
    no-skill leaks    9 / 50
    avg latency     2047ms
    verifier        fired 283 · switched 16 (→right 3, →wrong 5) · rescued declines 11 (right 10, wrong 1, leaked 0)
    failed           want nextWeekday            got nextWeekday            "when is the next thursday"
    declined         want listTimezoneOffsets    got —                      "clock times right now in Paris Delhi and"
    failed           want generatePalette        got generatePalette        "give me tints and shades of #556B2F"
    failed           want base64Decode           got base64Decode           "un-base64 this blob"
    asked            want binaryDecode           got binaryDecode           "these 1s and 0s spell what"
    failed           want decompressText         got decompressText         "unpack this compressed blob"
    failed           want hashText               got hashText               "sha512 digest of this phrase"
  283 verifier events written to <repo>/model/round2/logs/vlog-both.json
## Ship rules
- category v2 ships if: leaks ≤ 4 AND correct incl. honest asks ≥ control AND dev accuracy ≥ shipped.
- sibling ships if: verifier (→right − →wrong) ≥ +8 AND correct ≥ control AND leaks ≤ control.
