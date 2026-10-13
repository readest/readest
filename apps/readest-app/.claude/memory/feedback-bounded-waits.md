---
name: feedback-bounded-waits
description: "chrox wants every shell command capped (2 min) and no wait >1 min; never use `until grep` loops; a book that doesn't open in ~1 min is a bug to profile, not to wait out"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 70e7020c-ae67-429e-b529-b986e53fda54
  modified: 2026-10-08T04:41:39.608Z
---

Cap every shell command (`timeout`, tool timeout <= 2 min) and never wait more than ~1 minute for a page/book to load. Do not use `until grep ...; do sleep; done` loops: they hung or looped forever repeatedly in the KJV session (2026-10-07). Use bounded `for i in $(seq 1 N)` polls or `timeout`, and background long jobs (full test suites) with their own timeout, then poll in short bounded steps.

**Why:** "it makes no sense to open a book for more than 10 seconds ... if it still does not load the page for one minute there could be something really wrong and we need to find it." Long waits hid the real bug and wasted session time.

**How to apply:** when a reader action exceeds ~1 min, stop waiting and profile (Chrome trace / CPU profile / bisect) instead. Related: [[huge-section-hangs-kjv-1711]].
