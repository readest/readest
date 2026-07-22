---
name: review-perf-slice-not-quadratic
description: "Don't claim str.slice(i) in a loop is O(n^2) — V8 SlicedString makes it O(1); isolate the variable before reporting any perf finding"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 6c867dae-8902-43e4-ac52-ab0d7ed83f88
---

In PR #5121 review I flagged `text.slice(i).match(/^&.../)` inside a per-char loop as O(n^2) ("O(n) copy per ampersand"). It is NOT. V8 implements `String.prototype.slice` as an O(1) `SlicedString` (a view into the parent) for slices >= 13 chars, and a `^`-anchored `.match()` only reads the prefix — so the tail is never copied. The original code is already O(n).

**Why:** My first benchmark grew the document as it added ampersands (`'x&y '.repeat(n)`), conflating size with ampersand count, and cold-start/GC noise made it look superlinear. The decisive test held size fixed (1.6MB) and varied only density: 266k ampersands = 168ms vs 3.2k ampersands = 142ms → 1.19x for 83x more ampersands = flat = O(1) per slice. My "sticky regex" fix was actually 1.5-2x slower.

**How to apply:** Never assert an algorithmic complexity (esp. O(n^2)) for a review finding without isolating the variable at a FIXED input size and measuring with warmup + best-of-N. For JS string ops specifically, remember `.slice()` is a cheap view, not a copy. A perf claim that changes what code ships must be observed, not reasoned from "looks quadratic." Relates to [[feedback_no_test_seams_in_prod]] verify-before-claiming discipline and the OPDS proxy in [[opds-firefox-strict-xml-4479]] area.
