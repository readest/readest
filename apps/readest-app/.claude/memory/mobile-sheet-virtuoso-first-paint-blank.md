---
name: mobile-sheet-virtuoso-first-paint-blank
description: PRE-EXISTING bug — mobile sidebar sheet renders BooknoteView/TOC virtuoso blank on first open until first touch; A/B-proven at pre-hub base; no issue filed yet
metadata: 
  node_type: memory
  type: project
  originSessionId: 138d91ff-f7d6-465b-8a89-35b703957a3c
  modified: 2026-08-02T16:31:15.539Z
---

On the mobile bottom-sheet sidebar (window < 640px), the annotations/TOC list first-paints BLANK after opening the sheet: virtuoso reports full scrollHeight (e.g. 15485px) but renders 0 rows at scrollTop 0; ANY scroll tick materializes the rows correctly. Verified 2026-08-03 on web dev at 399x688 CSS.

**Not caused by the annotations hub**: reproduced byte-identically with branch-base (5569160) BooknoteView/BooknoteItem swapped in on a clean server + fresh reload + fresh sheet open. The earlier "base works" impression was an HMR remount into an already-animated sheet — an unfair A/B.

**Why:** `initialTopMostItemIndex={index: nearestIndex, align: 'center'}` (far index at a deep reading position) races the sheet slide-in animation + deferred OverlayScrollbars init; the `initialized` rAF re-apply doesn't recover it. The desktop docked sidebar is unaffected (no entry animation).

**How to apply:** file/fix as its own issue, NOT inside feature branches touching BooknoteView (the tuned scroll wiring is easy to break). Candidate fix direction: delay virtuoso mount (or re-assert scrollToIndex) until the sheet's transitionend, or listen for the first ResizeObserver tick before applying initialTopMostItemIndex.
